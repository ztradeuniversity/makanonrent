-- MakanOnRent — Migration 0014: Assistant CEO → Area Manager hierarchy
-- + duplicate active-assignment prevention
-- ============================================================================
-- Approved implementation, audited 2026-08-24. Two independent, additive
-- changes bundled because both were found in the same audit pass — neither
-- depends on the other.
--
-- 1. admin_users.reports_to_user_id — the ONE authoritative link for
--    "which Assistant CEO does this Area Manager report to". Self-
--    referencing FK on the SAME table (no second team/hierarchy table).
--    Nullable: a Manager with no Assistant CEO assigned yet is valid
--    (reports directly to CEO in practice, same as today).
--
--    Deliberately NOT constrained by a role CHECK here (e.g. "target must
--    be assistant_ceo") — Postgres CHECK constraints cannot reference
--    another row, so that rule is enforced in application code
--    (functions/api/admin/users.js) instead, same pattern already used
--    for uq_area_one_active_manager-adjacent checks elsewhere in this
--    project. The self-reference guard (a row cannot report to itself)
--    IS expressible as a single-row CHECK, so it lives here.
--
-- 2. uq_area_assignment_active_user_node — the audited root cause of
--    "Maria shows 58 locations, only ~29 are real": nothing ever stopped
--    a second active admin_area_assignments row for the same
--    (user_id, node_id) pair. A partial unique index (only over
--    active=true rows) prevents future duplicates while leaving every
--    existing row — including the ones this migration does NOT touch —
--    untouched. Revoked (active=false) history is explicitly exempt, so
--    "assign → revoke → reassign the same area later" keeps working.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_users add column if not exists reports_to_user_id uuid references admin_users(id) on delete set null;

alter table admin_users drop constraint if exists ck_admin_users_no_self_report;
alter table admin_users add constraint ck_admin_users_no_self_report check (reports_to_user_id is null or reports_to_user_id <> id);

create index if not exists idx_admin_users_reports_to on admin_users(reports_to_user_id) where reports_to_user_id is not null;

-- Duplicate active-assignment prevention.
--
-- IMPORTANT — read before running: CREATE UNIQUE INDEX fails outright if
-- rows that already violate it exist, and Maria Rani's account currently
-- has ~29 such duplicate pairs (audited 2026-08-24: same user_id+node_id,
-- two different assignment ids, both active=true). The statement below
-- resolves that FIRST, but only by REVOKING (active=false,
-- revoked_at=now()) every duplicate except the single oldest row per
-- pair — the exact same soft-revoke semantics assignments.js's own
-- 'revoke' action already uses. Nothing is deleted; every row and its
-- history stays queryable. Review the SELECT below before running the
-- UPDATE if you want to see the exact rows first:
--
--   select id, user_id, node_id, created_at from admin_area_assignments a
--    where active = true and exists (
--      select 1 from admin_area_assignments b
--       where b.user_id = a.user_id and b.node_id = a.node_id and b.active = true
--         and b.created_at < a.created_at
--    );
--
update admin_area_assignments a
   set active = false, revoked_at = now()
 where active = true
   and exists (
     select 1 from admin_area_assignments b
      where b.user_id = a.user_id and b.node_id = a.node_id and b.active = true
        and b.created_at < a.created_at
   );

create unique index if not exists uq_area_assignment_active_user_node
  on admin_area_assignments (user_id, node_id) where active = true;
