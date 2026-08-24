-- MakanOnRent — Migration 0017: Permanently-remove-from-history presentation flag
-- ============================================================================
-- Team redesign (audited 2026-08-24), ISSUE 15/16: the CEO needs a
-- "Permanently Remove" action on a FORMER (already archived) team member that
-- drops them out of the "Removed team members" presentation list — WITHOUT
-- touching any immutable audit/security/verification/task/assignment record.
--
-- This is a single nullable timestamp, not a delete and not a second status.
-- admin_users.status stays 'archived' forever (Doc 18 Article 2.4 — no hard
-- deletes on business entities); history_hidden_at only changes what the
-- CEO-only "?archived=1" presentation query returns. Every row this account
-- ever touched — property_verifications.verified_by, admin_tasks.assigned_to,
-- admin_area_assignments.user_id, admin_audit_log.actor_id — keeps its
-- foreign key untouched; none of those tables are written to by this
-- migration or by the action that sets this column.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_users add column if not exists history_hidden_at timestamptz;

create index if not exists idx_admin_users_history_hidden
  on admin_users (history_hidden_at) where history_hidden_at is not null;
