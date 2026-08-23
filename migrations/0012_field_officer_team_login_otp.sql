-- MakanOnRent — Migration 0012: Field Officer role + team-member login OTP
-- ============================================================================
-- Extends the EXISTING RBAC (migration 0004) and EXISTING email/OTP queue
-- (migration 0007) rather than creating parallel structures.
--
-- 1. Adds 'field_officer' as a fourth operational role. 'ceo', 'assistant_ceo'
--    and 'manager' ("Area Manager" in the CEO Team UI) are UNCHANGED and
--    reused as-is — this migration only widens the existing CHECK
--    constraints and role-mapping trigger data, it does not rename or
--    replace anything.
-- 2. Widens admin_area_assignments.scope_role so a Field Officer can hold an
--    area assignment through the SAME table Area Managers already use — no
--    second assignment table.
-- 3. Widens admin_email_otp.purpose to add 'login', so the team-member
--    login flow (username + password + email → OTP → session) reuses the
--    SAME hashed-code table migration 0007 already created for
--    email-verify/password-reset OTPs, instead of a new one.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. admin_users: add 'field_officer' ────────────────────────────────────
alter table admin_users drop constraint if exists admin_users_role_check;
alter table admin_users add constraint admin_users_role_check
  check (role in ('ceo', 'assistant_ceo', 'manager', 'field_officer'));

alter table admin_users drop constraint if exists admin_users_frozen_role_check;
alter table admin_users add constraint admin_users_frozen_role_check
  check (frozen_role in ('exec', 'city_manager', 'area_manager', 'field_officer'));

alter table admin_users drop constraint if exists ck_admin_users_role_mapping;
alter table admin_users add constraint ck_admin_users_role_mapping check (
  (role = 'ceo'           and frozen_role = 'exec') or
  (role = 'assistant_ceo' and frozen_role = 'city_manager') or
  (role = 'manager'       and frozen_role = 'area_manager') or
  (role = 'field_officer' and frozen_role = 'field_officer')
);

-- ── 2. admin_area_assignments: Field Officers hold areas the same way ──────
alter table admin_area_assignments drop constraint if exists admin_area_assignments_scope_role_check;
alter table admin_area_assignments add constraint admin_area_assignments_scope_role_check
  check (scope_role in ('assistant_ceo', 'manager', 'field_officer'));

-- uq_area_one_active_manager (0004) stays scoped to scope_role = 'manager'
-- on purpose: several Field Officers legitimately share one Area Manager's
-- territory, only "one active manager per area" is a hard rule.

-- ── 3. admin_email_otp: add 'login' purpose ─────────────────────────────────
alter table admin_email_otp drop constraint if exists admin_email_otp_purpose_check;
alter table admin_email_otp add constraint admin_email_otp_purpose_check
  check (purpose in ('email_verify', 'password_reset', 'login'));

-- property_approvals.actor_role / property_verifications carry no role
-- CHECK of their own (actor_role there is unconstrained text, verified_by
-- is a plain FK) — Field Officers already fit through those unchanged.
