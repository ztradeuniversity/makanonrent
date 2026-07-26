-- MakanOnRent — Migration 0004: Admin Management (RBAC, tasks, verification)
-- ============================================================================
-- Implements docs/adr/0001-admin-management-rbac.md (Minor CR, arch v1.1.0).
-- READ THAT ADR BEFORE CHANGING ANYTHING IN THIS FILE — several constructs
-- here exist to satisfy a frozen governance control, not because they were
-- convenient, and removing them silently would violate Doc 18 Article 1.3.
--
-- Hierarchy:  CEO → Assistant CEO → Manager
-- Each operational role carries a `frozen_role` mapping back into the
-- Doc 03 §1.2 role set, which this migration EXTENDS rather than replaces.
--
-- NAMESPACE NOTE: Doc 04 §1.2 specifies a `core:` schema namespace for
-- identities/roles/sessions. Migrations 0001–0003 realised their namespaces
-- flat (contacts, properties, locations) rather than as Postgres schemas, so
-- this file stays consistent with the shipped convention: `admin_*` IS the
-- `core` namespace, realised flat. Changing to real schemas is a separate
-- CR affecting all four migrations, not something to do halfway here.
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER 0001–0003.
-- Idempotent: safe to run multiple times.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── admin_users: internal identities ───────────────────────────────────────
-- No self-registration by design (ADR §5): rows are only ever created by an
-- existing CEO/Assistant CEO through /api/admin/users, or once by the
-- one-time bootstrap endpoint. There is no public signup path to this table.
create table if not exists admin_users (
  id                uuid primary key default gen_random_uuid(),
  username          text not null,
  full_name         text not null,
  -- Operational role (ADR §3 Option B).
  role              text not null check (role in ('ceo', 'assistant_ceo', 'manager')),
  -- Doc 03 §1.2 role this maps onto. Stored, not derived, so a future
  -- permission-matrix test can assert the mapping without reading app code.
  frozen_role       text not null check (frozen_role in ('exec', 'city_manager', 'area_manager')),

  -- Credentials. PBKDF2-SHA256 via Web Crypto (functions/utils/password.js).
  -- `password_algo` is stored per-row so the iteration count can be raised
  -- later and old hashes upgraded on next successful login, without a
  -- migration and without locking anyone out.
  password_hash     text not null,
  password_salt     text not null,
  password_algo     text not null default 'pbkdf2-sha256-210000',
  must_change_password boolean not null default true,

  -- MFA: schema-ready, NOT enforced. See ADR §5 — Article 9.4 is deferred,
  -- not waived. Leaving these unused is the whole point; enabling TOTP later
  -- must not require a migration.
  totp_secret       text,
  mfa_enforced      boolean not null default false,

  -- No hard deletes (Doc 18 Article 2.4 / NFR-17).
  status            text not null default 'active'
                      check (status in ('active', 'disabled', 'archived')),
  created_by        uuid references admin_users(id) on delete restrict,
  last_login_at     timestamptz,
  last_verification_at timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Usernames are case-insensitive to a human. Enforced on lower(username)
-- rather than with citext so no extension is required.
create unique index if not exists uq_admin_users_username on admin_users (lower(username));
create index if not exists idx_admin_users_role on admin_users (role) where status = 'active';

-- The operational→frozen role mapping is a contract (ADR §3), not a
-- convention. A row that violates it would silently break the permission
-- matrix tests required by Doc 18 Article 6.2.
alter table admin_users drop constraint if exists ck_admin_users_role_mapping;
alter table admin_users add constraint ck_admin_users_role_mapping check (
  (role = 'ceo'           and frozen_role = 'exec') or
  (role = 'assistant_ceo' and frozen_role = 'city_manager') or
  (role = 'manager'       and frozen_role = 'area_manager')
);

-- ── admin_sessions ─────────────────────────────────────────────────────────
-- Only the SHA-256 of the session token is stored (ADR §5): a dump of this
-- table yields no usable session. Expiry is enforced in SQL-visible data so
-- a stale row can never be silently treated as live by application code.
create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references admin_users(id) on delete cascade,
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
create index if not exists idx_admin_sessions_user on admin_sessions (user_id);
create index if not exists idx_admin_sessions_live on admin_sessions (expires_at) where revoked_at is null;

-- ── admin_area_assignments: City → Main Location → Sub Location ────────────
-- Reuses locations(node_id) from migration 0002 — the area tree already
-- exists and is already the thing the Location Manager publishes into.
-- Inventing a second geography here would fork master data (Doc 04 §3.1).
create table if not exists admin_area_assignments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references admin_users(id) on delete cascade,
  node_id      text not null references locations(node_id) on delete cascade,
  scope_level  text not null check (scope_level in ('city', 'main', 'sub')),
  -- Denormalised from admin_users.role purely so the partial unique index
  -- below can be expressed. Kept in sync by trg_area_assignment_role.
  scope_role   text not null check (scope_role in ('assistant_ceo', 'manager')),
  assigned_by  uuid references admin_users(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists idx_area_assignments_user on admin_area_assignments (user_id) where active;
create index if not exists idx_area_assignments_node on admin_area_assignments (node_id) where active;

-- "Each area belongs to only one active manager." Managers only — Assistant
-- CEOs may share territory, which is why scope_role is in the predicate.
create unique index if not exists uq_area_one_active_manager
  on admin_area_assignments (node_id)
  where active and scope_role = 'manager';

-- Keeps scope_role honest without making the caller pass it correctly.
create or replace function sync_area_assignment_role() returns trigger as $$
begin
  select role into new.scope_role from admin_users where id = new.user_id;
  if new.scope_role = 'ceo' then
    raise exception 'The CEO has global authority and is never area-assigned.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_area_assignment_role on admin_area_assignments;
create trigger trg_area_assignment_role
  before insert or update of user_id on admin_area_assignments
  for each row execute function sync_area_assignment_role();

-- ── admin_tasks: daily targets ─────────────────────────────────────────────
create table if not exists admin_tasks (
  id            uuid primary key default gen_random_uuid(),
  assigned_to   uuid not null references admin_users(id) on delete cascade,
  assigned_by   uuid references admin_users(id) on delete set null,
  task_type     text not null check (task_type in ('verify_properties', 'add_properties', 'custom')),
  title         text not null,
  target_count  int not null default 1 check (target_count > 0),
  due_date      date not null,
  area_node_id  text references locations(node_id) on delete set null,
  status        text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  -- AI seam (ADR §6). An AI assigner writes source='ai' + ai_rationale and
  -- needs no schema change. Nothing reads 'ai' today.
  source        text not null default 'human' check (source in ('human', 'ai')),
  ai_rationale  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_admin_tasks_assignee_date on admin_tasks (assigned_to, due_date);

-- ── property_verifications: the verification history ───────────────────────
-- Insert-only by design ("Complete history must remain"). A correction is a
-- NEW row, never an UPDATE — enforced by trg_verifications_append_only.
create table if not exists property_verifications (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  listing_id      uuid references listings(id) on delete set null,
  verified_by     uuid not null references admin_users(id) on delete restrict,
  task_id         uuid references admin_tasks(id) on delete set null,
  status          text not null check (status in ('available', 'unavailable')),
  previous_status text,
  phone_number    text,
  comments        text,
  gps_lat         numeric,
  gps_lng         numeric,
  verified_at     timestamptz not null default now()
);
create index if not exists idx_verifications_property on property_verifications (property_id, verified_at desc);
create index if not exists idx_verifications_user_date on property_verifications (verified_by, verified_at);

-- Proof media. Mirrors property_media's shape (R2 key + metadata only,
-- Doc 04 §1.1) rather than inventing a second media convention.
create table if not exists property_verification_media (
  id              uuid primary key default gen_random_uuid(),
  verification_id uuid not null references property_verifications(id) on delete cascade,
  kind            text not null check (kind in ('image', 'video')),
  r2_key          text not null,
  public_url      text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_verification_media on property_verification_media (verification_id);

-- ── property_approvals: the approval chain audit ───────────────────────────
create table if not exists property_approvals (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  actor_id     uuid not null references admin_users(id) on delete restrict,
  actor_role   text not null check (actor_role in ('ceo', 'assistant_ceo', 'manager')),
  stage        text not null check (stage in ('manager', 'assistant_ceo', 'ceo')),
  decision     text not null check (decision in ('approve', 'reject', 'return')),
  comment      text,
  decided_at   timestamptz not null default now()
);
create index if not exists idx_property_approvals_listing on property_approvals (listing_id, decided_at);

-- ── admin_comments: internal comments, all three roles ─────────────────────
create table if not exists admin_comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('listing', 'property', 'task', 'user', 'verification')),
  entity_id   uuid not null,
  author_id   uuid not null references admin_users(id) on delete restrict,
  parent_id   uuid references admin_comments(id) on delete cascade,  -- manager replies
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_admin_comments_entity on admin_comments (entity_type, entity_id, created_at);

-- ── admin_audit_log: append-only ───────────────────────────────────────────
-- "Every action logged / edit / delete / approval / login."
create table if not exists admin_audit_log (
  id          bigserial primary key,
  actor_id    uuid references admin_users(id) on delete set null,
  actor_role  text,
  action      text not null,          -- login|logout|create_user|approve|verify|...
  entity_type text,
  entity_id   text,
  detail      jsonb,
  ip          text,
  user_agent  text,
  at          timestamptz not null default now()
);
create index if not exists idx_admin_audit_actor on admin_audit_log (actor_id, at desc);
create index if not exists idx_admin_audit_entity on admin_audit_log (entity_type, entity_id, at desc);

-- Append-only is enforced by trigger, NOT by RLS. This matters: the service
-- role bypasses RLS entirely, so an RLS policy would protect nothing from
-- the only client that can reach this table. Triggers still fire for it.
create or replace function block_mutation() returns trigger as $$
begin
  raise exception 'Table % is append-only (Doc 18 Article 9.5).', TG_TABLE_NAME;
end;
$$ language plpgsql;

drop trigger if exists trg_audit_append_only on admin_audit_log;
create trigger trg_audit_append_only
  before update or delete on admin_audit_log
  for each row execute function block_mutation();

drop trigger if exists trg_verifications_append_only on property_verifications;
create trigger trg_verifications_append_only
  before update or delete on property_verifications
  for each row execute function block_mutation();

-- ── admin_settings: approval chain + auto publish ──────────────────────────
create table if not exists admin_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into admin_settings (key, value) values
  -- manager_only | manager_aceo | manager_ceo | manager_aceo_ceo
  ('approval_chain', '"manager_only"'::jsonb),
  ('auto_publish',   'false'::jsonb)
on conflict (key) do nothing;   -- never clobber a live configured value

-- ── additive columns on existing tables ────────────────────────────────────
-- All nullable: existing rows keep behaving exactly as before (ADR §7).
alter table properties add column if not exists added_by_admin_id uuid references admin_users(id) on delete set null;
alter table properties add column if not exists area_node_id text references locations(node_id) on delete set null;
create index if not exists idx_properties_area_node on properties (area_node_id);

alter table listings add column if not exists approval_state text
  check (approval_state in ('pending_manager', 'pending_assistant_ceo', 'pending_ceo', 'approved', 'rejected', 'returned'));
alter table listings add column if not exists approved_by uuid references admin_users(id) on delete set null;
alter table listings add column if not exists approved_at timestamptz;
alter table listings add column if not exists availability_state text
  check (availability_state in ('available', 'unavailable'));
-- "Remove properties / Restore properties" = archive/restore, never DELETE.
alter table listings add column if not exists archived_at timestamptz;
alter table listings add column if not exists archived_by uuid references admin_users(id) on delete set null;
create index if not exists idx_listings_approval_state on listings (approval_state) where archived_at is null;

-- ── SEPARATION OF DUTIES (ADR §4) ──────────────────────────────────────────
-- THE control this whole design turns on. A cross-table rule cannot be a
-- CHECK constraint, so it is a trigger — but it is still the DATABASE
-- enforcing it, not application code and not the UI (Doc 18 Article 9.1).
-- Do not "simplify" these away.
create or replace function enforce_verification_sod() returns trigger as $$
declare adder uuid;
begin
  select added_by_admin_id into adder from properties where id = new.property_id;
  -- NULL adder = submitted through the public wizard; anyone may verify it.
  if adder is not null and adder = new.verified_by then
    raise exception
      'Separation of duties: the user who added this property cannot verify it (Doc 03 §3.4, Doc 16 AM-5.1, ADR 0001 §4).';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_verification_sod on property_verifications;
create trigger trg_verification_sod
  before insert on property_verifications
  for each row execute function enforce_verification_sod();

create or replace function enforce_approval_sod() returns trigger as $$
declare adder uuid;
begin
  select p.added_by_admin_id into adder
    from listings l
    join units u on u.id = l.unit_id
    join properties p on p.id = u.property_id
   where l.id = new.listing_id;

  if adder is not null and adder = new.actor_id and new.decision = 'approve' then
    raise exception
      'Separation of duties: the user who added this property cannot approve its listing (Doc 03 §3.4, Doc 16 AM-5.1, ADR 0001 §4).';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_approval_sod on property_approvals;
create trigger trg_approval_sod
  before insert on property_approvals
  for each row execute function enforce_approval_sod();

-- ── updated_at maintenance (set_updated_at() defined in 0002) ──────────────
drop trigger if exists trg_admin_users_updated_at on admin_users;
create trigger trg_admin_users_updated_at
  before update on admin_users
  for each row execute function set_updated_at();

drop trigger if exists trg_admin_tasks_updated_at on admin_tasks;
create trigger trg_admin_tasks_updated_at
  before update on admin_tasks
  for each row execute function set_updated_at();

-- ── read models ────────────────────────────────────────────────────────────
-- Views, not per-dashboard SQL, so the CEO dashboard and a future AI
-- performance analyser read the SAME numbers (ADR §6).

-- Task progress: completion is DERIVED from real work, never self-reported.
create or replace view admin_task_progress as
select
  t.id            as task_id,
  t.assigned_to,
  t.assigned_by,
  t.task_type,
  t.title,
  t.target_count,
  t.due_date,
  t.status,
  t.area_node_id,
  case
    when t.task_type = 'verify_properties' then (
      select count(*) from property_verifications v
       where v.verified_by = t.assigned_to
         and v.verified_at::date = t.due_date
    )
    when t.task_type = 'add_properties' then (
      select count(*) from properties p
       where p.added_by_admin_id = t.assigned_to
         and p.created_at::date = t.due_date
    )
    else 0
  end             as completed_count
from admin_tasks t;

-- CEO monitoring dashboard, one row per manager/assistant CEO.
create or replace view admin_manager_overview as
select
  u.id                                       as user_id,
  u.full_name,
  u.username,
  u.role,
  u.status,
  u.last_login_at,
  u.last_verification_at,
  coalesce(a.area_count, 0)                  as assigned_area_count,
  coalesce(tk.pending_tasks, 0)              as pending_tasks,
  coalesce(tk.completed_tasks, 0)            as completed_tasks,
  coalesce(v.available_count, 0)             as available_properties,
  coalesce(v.unavailable_count, 0)           as unavailable_properties,
  coalesce(p.added_count, 0)                 as new_properties_added,
  case
    when coalesce(tk.target_total, 0) = 0 then null
    else round(100.0 * coalesce(tk.done_total, 0) / tk.target_total, 1)
  end                                        as verification_pct
from admin_users u
left join (
  select user_id, count(*) as area_count
    from admin_area_assignments where active group by user_id
) a on a.user_id = u.id
left join (
  select assigned_to,
         count(*) filter (where status = 'open')      as pending_tasks,
         count(*) filter (where status = 'completed') as completed_tasks,
         sum(target_count)                            as target_total,
         sum(least(completed_count, target_count))    as done_total
    from admin_task_progress group by assigned_to
) tk on tk.assigned_to = u.id
left join (
  select verified_by,
         count(*) filter (where status = 'available')   as available_count,
         count(*) filter (where status = 'unavailable') as unavailable_count
    from property_verifications group by verified_by
) v on v.verified_by = u.id
left join (
  select added_by_admin_id, count(*) as added_count
    from properties where added_by_admin_id is not null group by added_by_admin_id
) p on p.added_by_admin_id = u.id
where u.role in ('manager', 'assistant_ceo');

-- ── RLS: deny-by-default (Doc 03 §3.1, Doc 12) ─────────────────────────────
-- Same posture as 0001/0002: RLS on + zero policies = only service_role,
-- which is used exclusively inside functions/ and never reaches web/.
alter table admin_users               enable row level security;
alter table admin_sessions            enable row level security;
alter table admin_area_assignments    enable row level security;
alter table admin_tasks               enable row level security;
alter table property_verifications    enable row level security;
alter table property_verification_media enable row level security;
alter table property_approvals        enable row level security;
alter table admin_comments            enable row level security;
alter table admin_audit_log           enable row level security;
alter table admin_settings            enable row level security;

-- ── BOOTSTRAP ──────────────────────────────────────────────────────────────
-- No CEO row is seeded here on purpose: a password hash committed to git is
-- a backdoor, and PBKDF2 cannot be computed in SQL without pgcrypto gymnastics
-- that would put the plaintext in query logs. Create the first CEO once via
--   POST /api/admin/bootstrap   with header  X-Bootstrap-Token: $ADMIN_BOOTSTRAP_TOKEN
-- That endpoint refuses to run once any CEO exists. See functions/api/admin/
-- bootstrap.js and the deployment notes in the ADR.
