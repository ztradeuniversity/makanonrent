-- MakanOnRent — Migration 0005: Property Operations
-- ============================================================================
-- Implements docs/adr/0002-property-operations.md (Minor CR, arch v1.2.0).
-- READ THAT ADR FIRST. Several constructs here exist to satisfy a frozen
-- shared-service rule (AM-3.2 Evidence, AM-3.3 Trust-Status Authority),
-- not because they were convenient.
--
-- Adds: the 8-state operational lifecycle + full history, the Evidence
-- Service columns (hash/seal/anti-reuse/documents), the Notification Bus,
-- audit before/after/reason, and the performance + reporting views.
--
-- NOTHING here repurposes listings.status. The operational vocabulary
-- lives in listings.lifecycle_state and is PROJECTED onto the frozen
-- status column, so every existing reader keeps working unchanged
-- (ADR 0002 §3.1).
--
-- Run AFTER 0001–0004. Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── the operational lifecycle column ───────────────────────────────────────
alter table listings add column if not exists lifecycle_state text
  check (lifecycle_state in (
    'submitted', 'pending_review', 'verified', 'published',
    'unavailable', 'rejected', 'archived', 'deleted'));

alter table listings add column if not exists lifecycle_changed_at timestamptz;
alter table listings add column if not exists lifecycle_changed_by uuid
  references admin_users(id) on delete set null;
-- 'deleted' is a STATE, never a DELETE (ADR 0002 §4 / Doc 18 Article 2.4).
alter table listings add column if not exists deleted_at timestamptz;
alter table listings add column if not exists deleted_by uuid
  references admin_users(id) on delete set null;

-- Backfill from the frozen status so no row starts life in an undefined
-- condition ("No entity ever sits in an undefined condition" — Doc 05 §0).
-- Inverse of the ADR 0002 §3.1 projection table.
update listings set lifecycle_state = case
    when archived_at is not null      then 'archived'
    when status = 'verified_live'     then 'published'
    when status = 'unconfirmed'       then 'unavailable'
    when status = 'rejected'          then 'rejected'
    when status = 'withdrawn'         then 'archived'
    when status = 'pending_verification' then 'pending_review'
    else 'submitted'
  end
  where lifecycle_state is null;

-- Every NEW listing must start in a defined state too. Without this
-- default, rows inserted by /api/properties/submit.js (the public wizard,
-- which knows nothing about this migration) would land with a NULL
-- lifecycle_state and vanish from the workload report. Setting it at the
-- column level covers every insert path, including ones added later.
alter table listings alter column lifecycle_state set default 'submitted';

-- Dashboard access path: "everything at state X in area Y" is the single
-- most common query in the console (Doc 04 §1.3 composite-index rule).
create index if not exists idx_listings_lifecycle on listings (lifecycle_state)
  where deleted_at is null;

-- ── listing_status_history: every status change, permanently ───────────────
-- Append-only. A correction is a NEW row; the history is the evidence the
-- CEO audit reads, and mutable evidence is not evidence.
create table if not exists listing_status_history (
  id           bigserial primary key,
  listing_id   uuid not null references listings(id) on delete cascade,
  property_id  uuid references properties(id) on delete cascade,
  from_state   text,
  to_state     text not null,
  -- Who. NULL actor = a system/automatic transition, which is a real and
  -- different thing from an unknown one.
  actor_id     uuid references admin_users(id) on delete set null,
  actor_role   text,
  -- 'ai' is accepted so a future AI agent's transitions stay attributable
  -- and separable from a human's (ADR 0002 §10). Nothing writes it today.
  actor_kind   text not null default 'human' check (actor_kind in ('human', 'system', 'ai')),
  -- Why.
  reason       text,
  -- Old value / new value, for the CEO audit's five questions.
  before_value jsonb,
  after_value  jsonb,
  at           timestamptz not null default now()
);
create index if not exists idx_status_history_listing on listing_status_history (listing_id, at desc);
create index if not exists idx_status_history_actor on listing_status_history (actor_id, at desc);
create index if not exists idx_status_history_state on listing_status_history (to_state, at desc);

-- ── Evidence Service (Doc 16 AM-3.2) ───────────────────────────────────────
-- Extends the ADR 0001 media table in place rather than creating a second
-- one: Doc 18 Article 2.2 forbids renaming a contract, and two evidence
-- tables would be exactly the "three reimplementations" AM-3.2 exists to
-- prevent. This table IS the Evidence Service store.
alter table property_verification_media add column if not exists sha256 text;
alter table property_verification_media add column if not exists byte_size bigint;
alter table property_verification_media add column if not exists captured_at timestamptz;
alter table property_verification_media add column if not exists device_fingerprint text;
alter table property_verification_media add column if not exists gps_lat numeric;
alter table property_verification_media add column if not exists gps_lng numeric;
alter table property_verification_media add column if not exists note text;

-- Documents join images and videos (additive CHECK value).
alter table property_verification_media drop constraint if exists property_verification_media_kind_check;
alter table property_verification_media add constraint property_verification_media_kind_check
  check (kind in ('image', 'video', 'document'));

-- ANTI-REUSE. The highest-value anti-fraud control in this migration:
-- recycling one photograph across fifty "visits" is the cheapest possible
-- fabrication, and this makes it impossible rather than merely detectable.
-- Partial so historical rows with no hash never block a legitimate insert.
create unique index if not exists uq_evidence_sha256
  on property_verification_media (sha256)
  where sha256 is not null;

-- ── Notification Bus (Doc 18 Article 4.4 / FR-A3-1) ────────────────────────
-- Modules NEVER insert here directly — they call publish() in
-- functions/utils/notify.js, which is the single publisher. Delivery is
-- in-app today; adding WhatsApp/SMS/email is a change inside the bus.
create table if not exists notifications (
  id           bigserial primary key,
  recipient_id uuid not null references admin_users(id) on delete cascade,
  event_type   text not null,
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    text,
  -- Routing provenance: which actor/area caused this. Lets the CEO answer
  -- "why did this manager get told about that property?"
  actor_id     uuid references admin_users(id) on delete set null,
  area_node_id text,
  severity     text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  source       text not null default 'system' check (source in ('system', 'human', 'ai')),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
-- The unread badge polls this constantly — index the exact predicate.
create index if not exists idx_notifications_unread
  on notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_recipient
  on notifications (recipient_id, created_at desc);

-- ── audit: who / when / why / old / new (ADR 0002 §8) ──────────────────────
alter table admin_audit_log add column if not exists before_value jsonb;
alter table admin_audit_log add column if not exists after_value jsonb;
alter table admin_audit_log add column if not exists reason text;

-- ── append-only enforcement (block_mutation() defined in 0004) ─────────────
drop trigger if exists trg_status_history_append_only on listing_status_history;
create trigger trg_status_history_append_only
  before update or delete on listing_status_history
  for each row execute function block_mutation();

-- ── TRUST-STATUS AUTHORITY guard (Doc 16 AM-3.3) ───────────────────────────
-- "None writes the public trust state directly." functions/utils/lifecycle.js
-- is the single writer, and it always sets both columns together. Any other
-- code path that changes `status` alone — the exact violation ADR 0001 §8
-- shipped with — now fails loudly instead of silently publishing something.
create or replace function guard_listing_status() returns trigger as $$
begin
  if new.status is distinct from old.status
     and new.lifecycle_state is not distinct from old.lifecycle_state then
    raise exception
      'listings.status is derived from lifecycle_state — route this change through functions/utils/lifecycle.js (Doc 16 AM-3.3, ADR 0002 §5).';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_listing_status_guard on listings;
create trigger trg_listing_status_guard
  before update on listings
  for each row execute function guard_listing_status();

-- ── performance read model (manager dashboard) ─────────────────────────────
-- One view, so the manager's own numbers and the CEO's view of that manager
-- are the SAME numbers by construction — two queries would drift.
create or replace view admin_manager_performance as
with windows as (
  select
    u.id as user_id, u.full_name, u.username, u.role, u.status,
    u.last_login_at, u.last_verification_at
  from admin_users u
  where u.role in ('manager', 'assistant_ceo')
)
select
  w.*,
  -- task counts by window
  coalesce((select count(*) from admin_task_progress t
             where t.assigned_to = w.user_id and t.due_date = current_date), 0) as tasks_today,
  coalesce((select count(*) from admin_task_progress t
             where t.assigned_to = w.user_id
               and t.due_date >= current_date - interval '7 day'), 0) as tasks_week,
  coalesce((select count(*) from admin_task_progress t
             where t.assigned_to = w.user_id
               and t.due_date >= current_date - interval '30 day'), 0) as tasks_month,
  -- verification completion against assigned targets
  (select case when sum(t.target_count) = 0 then null
               else round(100.0 * sum(least(t.completed_count, t.target_count)) / sum(t.target_count), 1) end
     from admin_task_progress t
    where t.assigned_to = w.user_id
      and t.due_date >= current_date - interval '30 day')          as verification_pct,
  -- approval / rejection outcomes on this user's decisions
  (select count(*) from property_approvals a
    where a.actor_id = w.user_id and a.decision = 'approve')        as approvals_given,
  (select count(*) from property_approvals a
    where a.actor_id = w.user_id and a.decision = 'reject')         as rejections_given,
  (select case when count(*) = 0 then null
               else round(100.0 * count(*) filter (where decision = 'approve') / count(*), 1) end
     from property_approvals a where a.actor_id = w.user_id)        as approval_pct,
  (select case when count(*) = 0 then null
               else round(100.0 * count(*) filter (where decision = 'reject') / count(*), 1) end
     from property_approvals a where a.actor_id = w.user_id)        as rejected_pct,
  -- Inactive days = days since they last did real work, not since they last
  -- logged in. Logging in is not activity.
  (select case
            when max(v.verified_at) is null then null
            else extract(day from now() - max(v.verified_at))::int
          end
     from property_verifications v where v.verified_by = w.user_id) as inactive_days
from windows w;

-- ── CEO reporting read models ──────────────────────────────────────────────
-- Manager ranking. Best/worst is the SAME ordered view read from either end
-- — two views would let "best" and "worst" disagree about the middle.
create or replace view admin_report_manager_ranking as
select
  p.user_id, p.full_name, p.role, p.status,
  p.verification_pct, p.approval_pct, p.rejected_pct, p.inactive_days,
  coalesce(v.total_verifications, 0) as total_verifications,
  /* Composite score: throughput weighted by target attainment, penalised
     for inactivity. Deliberately simple and inspectable — a score nobody
     can explain is a score nobody should be ranked by. */
  round(
    coalesce(p.verification_pct, 0) * 0.6
    + least(coalesce(v.total_verifications, 0), 100) * 0.4
    - least(coalesce(p.inactive_days, 0), 30) * 1.0
  , 1) as performance_score
from admin_manager_performance p
left join (
  select verified_by, count(*) as total_verifications
    from property_verifications group by verified_by
) v on v.verified_by = p.user_id;

-- Area performance: supply and verification health per area.
create or replace view admin_report_area_performance as
select
  coalesce(pr.area_node_id, 'unassigned')          as area_node_id,
  max(pr.city_name)                                as city_name,
  max(pr.area_name)                                as area_name,
  count(distinct pr.id)                            as total_properties,
  count(distinct l.id) filter (where l.lifecycle_state = 'published')   as published,
  count(distinct l.id) filter (where l.lifecycle_state = 'unavailable') as unavailable,
  count(distinct l.id) filter (where l.lifecycle_state in ('submitted', 'pending_review')) as pending,
  count(distinct l.id) filter (where l.lifecycle_state = 'rejected')    as rejected,
  count(distinct v.id)                             as verifications
from properties pr
left join units u on u.property_id = pr.id
left join listings l on l.unit_id = u.id and l.deleted_at is null
left join property_verifications v on v.property_id = pr.id
group by coalesce(pr.area_node_id, 'unassigned');

-- Property growth: new properties per day for trend charting.
create or replace view admin_report_property_growth as
select
  created_at::date            as day,
  count(*)                    as properties_added,
  count(*) filter (where added_by_admin_id is not null) as added_by_staff,
  count(*) filter (where added_by_admin_id is null)     as added_by_public
from properties
group by created_at::date
order by day desc;

-- Verification trend: daily volume and availability split.
create or replace view admin_report_verification_trend as
select
  verified_at::date  as day,
  count(*)           as total,
  count(*) filter (where status = 'available')   as available,
  count(*) filter (where status = 'unavailable') as unavailable
from property_verifications
group by verified_at::date
order by day desc;

-- Pending workload: what is queued, and how stale it is.
create or replace view admin_report_pending_workload as
select
  l.lifecycle_state,
  count(*)                                                   as listings,
  round(avg(extract(epoch from (now() - coalesce(l.lifecycle_changed_at, l.created_at))) / 86400.0), 1) as avg_age_days,
  max(extract(epoch from (now() - coalesce(l.lifecycle_changed_at, l.created_at))) / 86400.0)::int       as oldest_age_days
from listings l
where l.deleted_at is null
  and l.lifecycle_state in ('submitted', 'pending_review', 'verified', 'unavailable')
group by l.lifecycle_state;

-- ── RLS: deny-by-default, same posture as 0001/0002/0004 ───────────────────
alter table listing_status_history enable row level security;
alter table notifications          enable row level security;
