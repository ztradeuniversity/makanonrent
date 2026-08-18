-- MakanOnRent — Migration 0008: Criteria-based Notify Me alerts
-- ============================================================================
-- Additive only. Extends the EXISTING property_notify_requests table rather
-- than introducing a parallel subscriptions table, because the contact
-- columns (email/phone), the kind enum and the fulfilled_at dedup marker are
-- already exactly right — the only thing missing was somewhere to keep the
-- search criteria, and the fact that entity_id was mandatory.
--
-- Why this was necessary at all: the table as shipped in 0007 can only
-- express "tell me about THIS listing" (entity_id uuid NOT NULL). A visitor
-- who searches, gets no results and asks to be told when something suitable
-- appears has no listing to point at — the request is a saved SEARCH.
--
-- Same conventions as 0001-0007: IF NOT EXISTS throughout, no DROP of any
-- table/column, no DELETE, idempotent and safe to re-run, RLS enabled with
-- zero policies (service_role only).
--
-- Run in the Supabase SQL editor AFTER 0007.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── 1. Saved search criteria ────────────────────────────────────────────
-- The whole criteria object as the site already serialises it (city, area,
-- subarea, category, type, beds, budgetMin/Max, areaSize/Unit, needs[]).
-- Kept as jsonb rather than 10 columns so a future filter needs no schema
-- change — the matcher reads named keys, so unknown keys are simply ignored.
alter table property_notify_requests add column if not exists criteria jsonb;

-- entity_id becomes optional: a saved-search request has no target listing.
-- The check below keeps every row meaningful (one of the two must exist),
-- so this relaxes the constraint without losing the guarantee.
alter table property_notify_requests alter column entity_id drop not null;

-- 'search' joins the existing polymorphic entity_type values.
alter table property_notify_requests
  drop constraint if exists property_notify_requests_entity_type_check;
alter table property_notify_requests
  add constraint property_notify_requests_entity_type_check
  check (entity_type in ('property', 'listing', 'search'));

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_notify_target_present') then
    alter table property_notify_requests
      add constraint chk_notify_target_present
      check (entity_id is not null or criteria is not null);
  end if;
end $$;

create index if not exists idx_notify_requests_open_search
  on property_notify_requests (created_at)
  where fulfilled_at is null and criteria is not null;

-- ── 2. Per-(request, listing) send ledger ───────────────────────────────
-- fulfilled_at alone answers "has this request been satisfied at all", which
-- is not the same question as "have we already emailed THIS person about
-- THIS listing". The unique index is the actual duplicate guard: the insert
-- happens BEFORE the email is queued, so a concurrent or repeated run
-- collides on the index and skips instead of sending twice.
create table if not exists property_alert_sends (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references property_notify_requests(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_property_alert_send
  on property_alert_sends (request_id, listing_id);
create index if not exists idx_property_alert_sends_listing
  on property_alert_sends (listing_id);

-- ── RLS: deny-by-default, same posture as every prior migration ─────────
alter table property_alert_sends enable row level security;
