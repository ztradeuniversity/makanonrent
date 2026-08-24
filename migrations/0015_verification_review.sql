-- MakanOnRent — Migration 0015: Field Report review (Manager → returned/reviewed)
-- ============================================================================
-- Audited 2026-08-24: the Field Visit / Field Report submission path
-- ALREADY EXISTS end-to-end and already works for Field Officers today —
-- property_verifications (migration 0004) is the field report itself
-- (findings via `comments`, GPS, task_id linkage), property_verification_media
-- is the media/evidence attachment, and functions/api/admin/verifications.js
-- already accepts and stores all of it, scoped to the caller's assigned
-- areas via the same getScopeNodeIds/isWithinScope every other endpoint
-- uses. Nothing above is duplicated here.
--
-- The one genuinely missing piece is a Manager/Assistant CEO/CEO REVIEW
-- decision on a submitted report ("reviewed" vs "returned for
-- correction" + a reason). property_verifications is deliberately
-- insert-only (trg_verifications_append_only, migration 0004) — a
-- correction is a new row, never an edit — so a review decision cannot be
-- written onto that table without breaking that guarantee. This table
-- follows the SAME append-only philosophy for the SAME reason: a review
-- is itself a small, permanent decision record, not a mutable status
-- field. The verification's current review state is simply its latest
-- row here (or "pending" if none exists yet) — no second source of
-- truth to keep in sync.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists property_verification_reviews (
  id              uuid primary key default gen_random_uuid(),
  verification_id uuid not null references property_verifications(id) on delete cascade,
  reviewer_id     uuid not null references admin_users(id) on delete restrict,
  decision        text not null check (decision in ('reviewed', 'returned')),
  comment         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_verification_reviews_verification
  on property_verification_reviews (verification_id, created_at desc);

alter table property_verification_reviews enable row level security;
