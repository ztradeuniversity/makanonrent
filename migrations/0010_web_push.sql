-- MakanOnRent — Migration 0010: Web Push subscriptions + broadcasts
-- ============================================================================
-- Additive only. Adds the three things browser push needs and nothing else:
-- who is subscribed, what has already been sent to them, and the admin
-- broadcast record.
--
-- What this deliberately does NOT do:
--
--   · It does not create a second saved-search table.
--     property_notify_requests remains the home of EMAIL saved searches, and
--     functions/utils/alert-match.js remains the one matcher. A push
--     subscriber's interests live in a bounded jsonb column on their own
--     subscription row (below) because a push subscriber is not a contact —
--     they have no email, no phone and no identity to key a request row on.
--     The criteria objects stored there are the SAME shape the site already
--     serialises, so the existing matcher reads them unchanged.
--
--   · It does not create a second notification architecture. The admin
--     Notification Bus (functions/utils/notify.js) addresses STAFF by role
--     and area; this addresses anonymous visitors by subscription. They are
--     different audiences with no overlap, so neither can serve the other.
--
-- Same conventions as 0001-0009: IF NOT EXISTS throughout, no DROP, no
-- DELETE, idempotent and safe to re-run, RLS enabled with zero policies
-- (service_role only — the browser never queries these tables directly).
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER 0009.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── 1. Subscriptions ────────────────────────────────────────────────────
-- One row per browser push subscription.
--
-- visitor_id is a random value the browser generates for itself
-- (crypto.randomUUID) and stores in localStorage. It is NOT derived from
-- anything about the device or the person — it exists so the same visitor
-- re-subscribing after clearing a subscription can have their preferences
-- carried over, and so a visitor can be forgotten in one statement. No IP,
-- no user agent and no contact detail is stored here on purpose: push needs
-- none of them, and what is not collected cannot leak.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  visitor_id   text not null,

  -- The push service URL for this browser. Unique because it IS the
  -- identity of a subscription: re-subscribing the same browser must
  -- update the existing row, never add a second one that would deliver
  -- the same notification twice.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,

  -- Two independent consents. Both default FALSE: a subscription that
  -- exists is not consent to send anything — the visitor chooses each
  -- stream, and either can be turned off without dropping the other.
  property_interest_enabled boolean not null default false,
  site_updates_enabled      boolean not null default false,

  -- Bounded interest profile, written by the browser:
  --   { "searches": [ <criteria object>, ... max 10 ],
  --     "viewed":   [ <listing uuid>,    ... max 20 ] }
  -- The criteria objects are exactly what the search page already builds,
  -- so functions/utils/alert-match.js matches them with no translation.
  -- The cap is enforced server-side in the subscribe endpoint, not merely
  -- trusted from the client.
  interests    jsonb not null default '{}'::jsonb,

  -- Set when the push service reports the subscription is gone (404/410)
  -- or when the visitor turns notifications off. Never deleted, so a
  -- resubscribe is an update and the send ledger keeps its foreign key.
  revoked_at   timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The two access paths that actually run: "every live subscriber who wants
-- property matches" and "every live subscriber who wants announcements".
create index if not exists idx_push_subs_property
  on push_subscriptions (property_interest_enabled)
  where revoked_at is null and property_interest_enabled;
create index if not exists idx_push_subs_updates
  on push_subscriptions (site_updates_enabled)
  where revoked_at is null and site_updates_enabled;
create index if not exists idx_push_subs_visitor on push_subscriptions (visitor_id);

drop trigger if exists trg_push_subs_updated_at on push_subscriptions;
create trigger trg_push_subs_updated_at
  before update on push_subscriptions
  for each row execute function set_updated_at();

-- ── 2. Per-(subscription, listing) send ledger ──────────────────────────
-- The same guard shape as property_alert_sends (migration 0008): the row is
-- inserted BEFORE the push is sent, so a repeat run, a concurrent run, or a
-- listing that is unpublished and published again collides on the unique
-- index and skips instead of notifying the same browser twice.
create table if not exists push_sends (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  listing_id      uuid not null references listings(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_push_send
  on push_sends (subscription_id, listing_id);
create index if not exists idx_push_sends_listing on push_sends (listing_id);

-- ── 3. Admin broadcasts ─────────────────────────────────────────────────
-- "New city launched", "new service", and similar. Never automatic: a row
-- is created by an authorised admin and sent only when that admin sends it,
-- which is why status starts at 'draft' and sent_at stays null until then.
create table if not exists push_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  url         text,

  -- Kept as a column rather than assumed, so a future "this city only"
  -- broadcast does not need a schema change.
  audience    text not null default 'site_updates'
                check (audience in ('site_updates')),

  status      text not null default 'draft'
                check (status in ('draft', 'sending', 'sent', 'failed')),

  created_by  uuid references admin_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_count  int not null default 0,
  failed_count int not null default 0
);
create index if not exists idx_push_broadcasts_created on push_broadcasts (created_at desc);

-- ── RLS: deny-by-default, same posture as every prior migration ─────────
-- RLS on + zero policies = no role except service_role (used only inside
-- functions/) can read or write. Subscription keys are sending credentials;
-- nothing in web/ may ever query these tables directly.
alter table push_subscriptions enable row level security;
alter table push_sends enable row level security;
alter table push_broadcasts enable row level security;
