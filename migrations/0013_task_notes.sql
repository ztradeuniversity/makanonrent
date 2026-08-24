-- MakanOnRent — Migration 0013: task notes/instructions
-- ============================================================================
-- Additive only. admin_tasks already exists (migration 0004); this adds
-- ONE nullable column rather than a second task table or a parallel
-- "custom task" model. `title` stays a short label — `notes` is where the
-- CEO/manager writes free-form instructions, most relevant when
-- task_type = 'custom' but not restricted to it.
--
-- admin_task_progress (0004) is a view over admin_tasks; it is
-- CREATE OR REPLACE'd here purely to also select the new column — the
-- completed_count/derivation logic is untouched.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_tasks add column if not exists notes text;

-- CREATE OR REPLACE VIEW requires the existing columns to stay in their
-- existing order — a new column may only be appended at the END of the
-- list, never inserted between existing ones, or Postgres rejects the
-- replace outright. `notes` therefore goes after completed_count, not
-- next to `title` where it reads more naturally.
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
  t.notes
from admin_tasks t;
