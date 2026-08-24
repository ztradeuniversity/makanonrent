-- MakanOnRent — Migration 0016: Custom display designation
-- ============================================================================
-- CEO Team redesign (audited 2026-08-24): the CEO wants to optionally label a
-- member "Senior Field Coordinator" / "Regional Field Lead" etc. without that
-- text having any bearing on what the account can DO. Adding a plain nullable
-- text column is the entire schema change — nothing about permissions reads
-- it, only display surfaces do (Team tree, profile view, create/edit forms).
--
-- Explicitly NOT a role, NOT a second RBAC table, NOT a free-text field the
-- server ever branches on. functions/utils/rbac.js continues to authorise
-- exclusively on admin_users.role ('ceo' | 'assistant_ceo' | 'manager' |
-- 'field_officer') — display_title never appears in a permission check.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_users add column if not exists display_title text;

-- A title is a short label, not a biography — same order of magnitude as
-- full_name's practical length, enforced so this can never become a place to
-- paste unrelated text.
alter table admin_users drop constraint if exists ck_admin_users_display_title_length;
alter table admin_users add constraint ck_admin_users_display_title_length
  check (display_title is null or char_length(display_title) <= 120);
