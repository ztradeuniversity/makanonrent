-- MakanOnRent — Migration 0011: Owner identity (Google sign-in)
-- ============================================================================
-- Additive only. Binds a verified Google identity to the EXISTING contact
-- record rather than introducing an owner/user table beside it.
--
-- Why contacts and not a new table: docs/04 §2.3 makes `contact` the
-- universal person record, and property ownership already runs
-- contact → owner_profile → property_ownership_claim → property. A second
-- identity table would mean two answers to "who owns this", which is
-- exactly the duplication the architecture avoids. All this adds is the
-- column that says which Supabase Auth user a contact IS.
--
-- Sessions are NOT stored here. Supabase Auth (GoTrue) issues and
-- validates owner tokens, so there is no second session table and no
-- second password scheme; admin_sessions remains admin-only and
-- untouched.
--
-- Same conventions as 0001-0010: IF NOT EXISTS throughout, no DROP of any
-- table, no DELETE, idempotent and safe to re-run.
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER 0010.
-- ============================================================================

-- ── 1. The identity link ────────────────────────────────────────────────
-- auth.users.id of the signed-in owner. Deliberately NOT a foreign key:
-- auth.users lives in a schema owned by Supabase Auth, and coupling a
-- business table to it with an FK makes the auth schema undroppable and
-- migrations order-dependent. The value is written only by
-- functions/utils/owner-auth.js after GoTrue has confirmed the token.
alter table contacts add column if not exists auth_user_id uuid;

-- One contact per signed-in identity. Partial, because the overwhelming
-- majority of contacts are people who never signed in (added by a manager
-- or captured from a phone submission) and must not collide on NULL.
create unique index if not exists uq_contacts_auth_user
  on contacts (auth_user_id)
  where auth_user_id is not null;

-- ── 2. Email becomes meaningful ─────────────────────────────────────────
-- contacts.email already exists but is self-declared and unverified: a
-- submitter can type any address. This flag records that GOOGLE asserted
-- the address, which is what makes it safe to key ownership on.
alter table contacts add column if not exists email_verified boolean not null default false;

-- Case-insensitive lookup for the sign-in path (claiming an existing
-- unclaimed contact that already carries this address).
create index if not exists idx_contacts_email_lower on contacts (lower(email));

-- ── 3. A signed-in owner has no phone yet ───────────────────────────────
-- phone_e164 was NOT NULL because every contact used to originate from the
-- submit wizard, which always collects one. Sign-in now happens BEFORE the
-- wizard asks for a phone, so the contact must be creatable without it.
-- The UNIQUE constraint is untouched, and Postgres never treats two NULLs
-- as equal, so phone-keyed dedup for wizard submissions is unaffected.
alter table contacts alter column phone_e164 drop not null;

-- ── 4. When the owner last signed in ────────────────────────────────────
-- Operational only (support answering "has this owner ever logged in?").
alter table contacts add column if not exists last_login_at timestamptz;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- contacts already has RLS enabled with zero policies (migration 0001), so
-- it stays service-role-only. Owner isolation is enforced in
-- functions/api/properties/mine.js against the verified token — the
-- browser never queries Supabase directly and gets no anon key.
