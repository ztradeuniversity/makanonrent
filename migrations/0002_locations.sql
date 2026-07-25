-- MakanOnRent — Migration 0002: Location Data Bank
-- ============================================================================
-- Durable storage for locations published through location-manager.html.
-- The browser keeps a localStorage copy for instant, offline-capable
-- search; this table is the multi-device / durable source of truth that
-- functions/api/locations/* reads and writes.
--
-- Hierarchy (docs/04 §3.2 geography + Phase 6 engine tiers):
--   country → province → city → main area (locality) → sub area
-- Stored as a single self-referencing table because that is exactly how
-- the frontend engine models it — one adjacency list, not a table per
-- tier, so a new tier never needs a schema change.
--
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── locations: the data bank ───────────────────────────────────────────────
create table if not exists locations (
  id           uuid primary key default gen_random_uuid(),
  -- Engine-side id (e.g. 'pk/punjab/lahore/johar-town'), stable across
  -- re-publishes; this is what the frontend hydrates against.
  node_id      text not null unique,
  parent_node_id text references locations(node_id) on delete cascade,
  name         text not null,
  slug         text not null,
  type         text not null check (type in (
                 'country','province','division','district','tehsil',
                 'city','locality','society','subarea','phase','block',
                 'road','street','landmark')),
  -- 'approved' is live; user suggestions land as 'pending' and are
  -- invisible to every public read until an admin approves them.
  status       text not null default 'approved'
                 check (status in ('approved','pending','rejected','disabled')),
  active       boolean not null default true,
  sort_order   int not null default 0,
  aliases      text[] not null default '{}',
  -- Future maps: populated later, never guessed.
  lat          numeric,
  lng          numeric,
  -- Provenance: how this row entered the bank.
  source       text not null default 'bank'
                 check (source in ('fixture','bank','suggestion')),
  note         text,
  suggested_by text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- No two live children of the same parent may share a name — the
-- "no duplicated names" rule, enforced by the database rather than by
-- convention. Partial index so rejected/disabled rows never block a
-- legitimate re-use of a name.
create unique index if not exists uq_locations_parent_slug
  on locations (parent_node_id, slug)
  where status in ('approved','pending');

create index if not exists idx_locations_parent on locations (parent_node_id);
create index if not exists idx_locations_type on locations (type);
create index if not exists idx_locations_status on locations (status);
-- Prefix/substring search support for large cities (5,000+ sub areas).
-- pg_trgm makes ILIKE '%term%' index-assisted instead of a seq scan.
create extension if not exists "pg_trgm";
create index if not exists idx_locations_name_trgm
  on locations using gin (name gin_trgm_ops);

-- ── location_suggestions: audit trail of user submissions ──────────────────
-- The suggested node itself lives in `locations` with status='pending';
-- this table records WHO asked for it and what happened, which the
-- locations row alone does not preserve after approval/rejection.
create table if not exists location_suggestions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  parent_node_id text not null,
  parent_name    text,
  note           text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  suggested_by   text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_location_suggestions_status
  on location_suggestions (status);

-- ── updated_at maintenance ─────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_locations_updated_at on locations;
create trigger trg_locations_updated_at
  before update on locations
  for each row execute function set_updated_at();

-- ── RLS: deny-by-default (Doc 03 §3, Doc 12) ───────────────────────────────
-- Only the service role — used exclusively inside functions/, never in
-- web/ — may read or write. The public site does not query Supabase
-- directly; it reads the bank through functions/api/locations.
alter table locations enable row level security;
alter table location_suggestions enable row level security;
-- Intentionally no policies: RLS on + zero policies = deny for every
-- role except service_role, which bypasses RLS in Supabase.
