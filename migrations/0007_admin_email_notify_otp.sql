-- MakanOnRent — Migration 0007: Admin Email, Notify Me, Email/OTP Queue
-- ============================================================================
-- Additive schema only — no application code, UI, or architecture changes.
-- Adds exactly three things:
--   1. admin_users.email (nullable, additive column)
--   2. Notify Me backend table (property_notify_requests)
--   3. Email/OTP queue + verification tables (admin_email_otp, email_delivery_queue)
--
-- Follows the same conventions already established in 0001-0006:
--   - IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout — idempotent.
--   - No DROP, no DELETE, no destructive statement anywhere in this file.
--   - Secrets/codes are stored HASHED (sha256 hex), never in plaintext —
--     same posture as admin_sessions.token_hash (functions/utils/session.js).
--   - Polymorphic entity_type/entity_id shape matches the existing
--     admin_comments convention (migrations/0004_admin_rbac.sql) rather
--     than inventing a new pattern.
--   - RLS enabled with zero policies (deny-by-default via service_role
--     only), same posture as every prior migration.
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER 0001-0005
-- (0006 optional/skipped, per approved production plan). Safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── 1. admin_users.email ────────────────────────────────────────────────
-- Nullable and additive: every existing admin_users row keeps working with
-- email = null, reproducing current behavior exactly (ADR-style expand,
-- no contract break).
alter table admin_users add column if not exists email text;
alter table admin_users add column if not exists email_verified_at timestamptz;

-- Case-insensitive uniqueness, mirroring uq_admin_users_username.
-- Partial (WHERE email is not null) so multiple NULLs never collide.
create unique index if not exists uq_admin_users_email
  on admin_users (lower(email))
  where email is not null;

-- ── 2. Notify Me backend ────────────────────────────────────────────────
-- One row per "notify me" request. entity_type/entity_id is polymorphic
-- (property | listing) to match admin_comments' existing shape rather
-- than adding a second convention. Contact is phone OR email — at least
-- one must be present.
create table if not exists property_notify_requests (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('property', 'listing')),
  entity_id    uuid not null,
  phone_e164   text,
  email        text,
  kind         text not null default 'availability'
                 check (kind in ('availability', 'price_drop')),
  fulfilled_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint chk_notify_contact_present check (phone_e164 is not null or email is not null)
);
create index if not exists idx_notify_requests_entity
  on property_notify_requests (entity_type, entity_id) where fulfilled_at is null;

-- ── 3. Email / OTP queue + verification ─────────────────────────────────
-- OTP codes are stored as a sha256 hash, never plaintext — same posture
-- as admin_sessions.token_hash. `purpose` covers both email-verification
-- and password-recovery OTP flows without needing two tables.
create table if not exists admin_email_otp (
  id           uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  email        text not null,
  code_hash    text not null,
  purpose      text not null check (purpose in ('email_verify', 'password_reset')),
  attempts     int not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_admin_email_otp_user
  on admin_email_otp (admin_user_id, purpose) where consumed_at is null;

-- Generic outbound email dispatch queue — one place any future sender
-- (OTP, Notify Me fulfilment, reverification reminders) enqueues into,
-- mirroring the project's existing "one bus, not N direct senders"
-- convention (functions/utils/notify.js) at the email-delivery layer.
create table if not exists email_delivery_queue (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  template     text not null,
  payload      jsonb,
  status       text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_email_queue_pending
  on email_delivery_queue (created_at) where status = 'pending';

-- ── RLS: deny-by-default, same posture as every prior migration ────────
alter table property_notify_requests enable row level security;
alter table admin_email_otp          enable row level security;
alter table email_delivery_queue     enable row level security;
