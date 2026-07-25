-- MakanOnRent — Migration 0001: Property Submission schema
-- ============================================================================
-- Scope: the subset of docs/04-database-architecture.md's entity model
-- needed for the Submit Property flow (functions/api/properties/submit.js).
-- Table and column names follow Doc 04 §2.3/§2.4 exactly where those
-- entities are named there (contact, owner_profile, ownership_claim,
-- property, unit, listing, verification_case) — this is a scoped MVP
-- subset of that model, not a different schema. Full-scale entities not
-- yet needed by any shipped feature (leads, tasks, CRM, planner, KPI,
-- deals, dealers, employees, ...) are intentionally NOT created here —
-- adding them speculatively would be inventing schema nobody reads yet.
--
-- Run via the Supabase SQL editor or `supabase db push`. Idempotent:
-- safe to re-run (uses IF NOT EXISTS throughout).
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ── contact: the universal person record (Doc 04 §2.3) ─────────────────────
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone_e164    text not null unique,
  whatsapp_ok   boolean not null default true,
  email         text,
  language_pref text not null default 'en',
  source        text not null default 'submit_wizard',
  created_at    timestamptz not null default now()
);

-- ── owner_profile *—1 contact (Doc 04 §2.3) ────────────────────────────────
create table if not exists owner_profiles (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null unique references contacts(id) on delete restrict,
  consent_tier text not null default 'submission',
  created_at   timestamptz not null default now()
);

-- ── property (Doc 04 §2.3) ──────────────────────────────────────────────────
-- city/area are denormalized text for now — the Smart Location Engine
-- (docs/13 Phase 6/6.5) is frontend-only; once it has a backend-synced
-- `locations` table, city_slug/area_slug become FK columns instead.
-- This migration does not invent that table speculatively.
create table if not exists properties (
  id                 uuid primary key default gen_random_uuid(),
  business_code      text not null unique,
  category           text not null check (category in ('homes', 'commercial')),
  property_type      text not null,          -- house|flat|portion|office|shop|room|other
  city_slug          text not null,
  city_name          text not null,
  area_slug          text,
  area_name          text not null,
  landmark           text,
  road_width_ft       numeric,
  first_discovered_via text not null default 'owner' check (first_discovered_via in ('owner', 'dealer', 'referral', 'web', 'tolet')),
  created_at         timestamptz not null default now()
);
create index if not exists idx_properties_city_area on properties (city_slug, area_slug);

-- ── ownership_claim: property *—* owner_profile (Doc 04 §2.3) ──────────────
create table if not exists property_ownership_claims (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references properties(id) on delete cascade,
  owner_profile_id uuid not null references owner_profiles(id) on delete restrict,
  claim_type       text not null default 'sole' check (claim_type in ('sole', 'joint', 'poa', 'caretaker')),
  verified_level   text not null default 'unverified',
  created_at       timestamptz not null default now()
);

-- ── unit: property 1—* unit (Doc 04 §2.3) ──────────────────────────────────
create table if not exists units (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  unit_type    text not null,     -- house|flat|portion|office|shop|room|other
  beds         int not null default 0,
  baths        int not null default 0,
  car_porch    boolean not null default false,
  size_value   numeric not null,
  size_unit    text not null check (size_unit in ('marla', 'sqft')),
  created_at   timestamptz not null default now()
);

-- ── listing: listing *—1 unit (Doc 04 §2.3) ────────────────────────────────
-- status enum matches Doc 04 §2.3 exactly; the Submit Wizard's "Pending
-- Review" copy is a display-layer label for status='intake', not a
-- separate DB value (see functions/api/properties/submit.js).
create table if not exists listings (
  id                 uuid primary key default gen_random_uuid(),
  unit_id            uuid not null unique references units(id) on delete cascade,
  status             text not null default 'intake' check (status in (
                       'draft', 'intake', 'pending_verification', 'verified_live',
                       'unconfirmed', 'paused', 'rented', 'withdrawn', 'rejected')),
  currency           text not null default 'PKR',
  rent_amount_minor  bigint not null,
  advance_amount_minor bigint,
  negotiable         boolean not null default false,
  features           text[] not null default '{}',
  note               text,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_listings_status on listings (status);

-- ── property_media: photos/videos, R2 metadata only (Doc 04 §1.1 "Files/
--    media: object storage with CDN; DB stores metadata + hashes only") ────
create table if not exists property_media (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  kind        text not null check (kind in ('image', 'video')),
  r2_key      text not null,
  public_url  text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_property_media_listing on property_media (listing_id);

-- ── verification_case (Doc 04 §2.4) — one row when an owner opts into
--    verification in the wizard's optional step 9 ──────────────────────────
create table if not exists verification_cases (
  id              uuid primary key default gen_random_uuid(),
  case_code       text not null unique,
  unit_id         uuid not null references units(id) on delete cascade,
  listing_id      uuid references listings(id) on delete set null,
  type            text not null default 'initial' check (type in ('initial', 'renewal', 're_audit', 'complaint_triggered')),
  state           text not null default 'opened',
  result          text,
  validity_until  timestamptz,
  created_at      timestamptz not null default now()
);

-- ── documents (Doc 09 §4) — CNIC images live here, class:'sensitive',
--    never in property_media, never given a public_url ────────────────────
create table if not exists documents (
  id           uuid primary key default gen_random_uuid(),
  class        text not null check (class in ('public', 'internal', 'sensitive')),
  owner_module text not null default 'verification',
  entity_type  text not null,     -- 'verification_case' for now
  entity_id    uuid not null,
  r2_key       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_documents_entity on documents (entity_type, entity_id);

-- ── RLS: deny-by-default (Doc 03 §3, Doc 12 §1.2.2). Only the service
--    role (used exclusively inside functions/, never in web/) can read or
--    write these tables until a public read policy is deliberately added
--    for a future listings-read API. ────────────────────────────────────────
alter table contacts enable row level security;
alter table owner_profiles enable row level security;
alter table properties enable row level security;
alter table property_ownership_claims enable row level security;
alter table units enable row level security;
alter table listings enable row level security;
alter table property_media enable row level security;
alter table verification_cases enable row level security;
alter table documents enable row level security;
-- No policies created: with RLS enabled and zero policies, every role
-- except service_role (which bypasses RLS entirely in Supabase) is
-- denied by default. This is intentional, not an oversight.
