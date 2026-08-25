-- MakanOnRent — Migration 0018: Task delegation chain
-- ============================================================================
-- Work-hierarchy fix (audited 2026-08-25): CEO → Assistant CEO → Area
-- Manager → Field Officer delegation must be traceable as ONE chain per
-- piece of work ("Maria assigned to Muhammad, Muhammad delegated to
-- Ahmad, Ahmad completed it"), not three unrelated admin_tasks rows a UI
-- has to guess are connected by matching titles.
--
-- admin_tasks (migration 0004) already has everything needed to describe
-- ONE assignment (assigned_to, assigned_by, created_at, status) — the one
-- thing missing is a link from a DELEGATED task back to the task it was
-- delegated FROM. parent_task_id is that one link, nullable (a root
-- assignment — e.g. CEO → Assistant CEO — has no parent).
--
-- Deliberately NOT a second task table: reusing admin_tasks keeps the
-- existing admin_task_progress view, existing email/notification wiring,
-- and existing Today-tab rendering working unchanged for every row that
-- ISN'T part of a delegation chain (the overwhelming majority today).
--
-- CORRECTED (production run failed, 42P16): the first version of this
-- migration inserted assigned_to_name/assigned_by_name in the MIDDLE of
-- the admin_task_progress column list (right after assigned_to/
-- assigned_by respectively). CREATE OR REPLACE VIEW requires every
-- pre-existing output column to keep its exact name AND ordinal
-- position — new columns may only be APPENDED at the end. Inserting
-- mid-list shifted every following column's position by one, which
-- Postgres reports as an illegal column rename and refuses outright. No
-- rename was ever actually intended, so ALTER VIEW ... RENAME COLUMN is
-- not the fix — the fix is simply appending all four new columns
-- (assigned_to_name, assigned_by_name, parent_task_id, created_at) after
-- the original 11, in their original names and order, exactly the same
-- append-only discipline migration 0013 already used when it added
-- `notes`. No other statement in this file changed.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_tasks add column if not exists parent_task_id uuid references admin_tasks(id) on delete set null;

create index if not exists idx_admin_tasks_parent on admin_tasks (parent_task_id) where parent_task_id is not null;

-- admin_task_progress (migrations 0004, 0013) is an explicit column list,
-- not select * — parent_task_id would not appear in it without this, and
-- neither would created_at, which the work-hierarchy history/lineage view
-- needs for exact "assigned at" timestamps (Doc brief: day/month/year/
-- hour/minute/second). assigned_by_name/assigned_to_name are added the
-- same way rather than as a second round-trip PostgREST embed against a
-- view (which does not carry the FK metadata a real table embed needs) —
-- everything the delegation-chain UI needs comes back in one row.
--
-- Original 11 columns (task_id … notes) are UNCHANGED in name and
-- position from migration 0013 — every existing query against this view
-- keeps working exactly as before. The four new columns are appended
-- after them, which is the only ordering CREATE OR REPLACE VIEW permits.
create or replace view admin_task_progress as
select
  t.id            as task_id,
  t.assigned_to,
  t.assigned_by,
  t.task_type,
  t.title,
  t.target_count,
  t.due_date,
  t.status,
  t.area_node_id,
  case
    when t.task_type = 'verify_properties' then (
      select count(*) from property_verifications v
       where v.verified_by = t.assigned_to
         and v.verified_at::date = t.due_date
    )
    when t.task_type = 'add_properties' then (
      select count(*) from properties p
       where p.added_by_admin_id = t.assigned_to
         and p.created_at::date = t.due_date
    )
    else 0
  end             as completed_count,
  t.notes,
  assignee.full_name as assigned_to_name,
  assigner.full_name as assigned_by_name,
  t.parent_task_id,
  t.created_at
from admin_tasks t
left join admin_users assignee on assignee.id = t.assigned_to
left join admin_users assigner on assigner.id = t.assigned_by;
