-- MakanOnRent — Migration 0009: property_media visibility state
-- ============================================================================
-- Additive only. Adds ONE column plus an index, backfills it from the state
-- each media row's listing is already in, and changes nothing else. No DROP,
-- no RENAME, no destructive UPDATE — every existing row keeps its id, key,
-- public_url and sort_order exactly as-is.
--
-- WHY: property_media rows are created at UPLOAD time, which happens before
-- a listing is reviewed. Nothing in the table recorded whether those files
-- were cleared for public display, so "stored in R2" and "published to the
-- public site" were indistinguishable at the data layer.
--
-- SCOPE — read this before relying on it:
-- This column governs what the APPLICATION may treat as publicly published
-- media. It does NOT revoke access to an R2 object. The bucket is served by
-- a public custom domain, so any object key that has leaked remains
-- fetchable regardless of this value. Closing that requires either a private
-- bucket with signed URLs, or moving keys on publish — a storage-architecture
-- decision deliberately NOT taken here (see the report accompanying this
-- migration).
--
-- Run in the Supabase SQL editor AFTER 0008. Idempotent; safe to re-run.
-- ============================================================================

-- ── 1. visibility column ────────────────────────────────────────────────
-- Default 'draft' is the safe default: a freshly uploaded file is not
-- publishable until a lifecycle transition says otherwise.
alter table property_media
  add column if not exists visibility text not null default 'draft';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_property_media_visibility') then
    alter table property_media
      add constraint chk_property_media_visibility
      check (visibility in ('draft', 'pending_review', 'rejected', 'published'));
  end if;
end $$;

-- Media is always fetched per listing, and public reads additionally filter
-- on visibility, so the composite is the index those reads want.
create index if not exists idx_property_media_visibility
  on property_media (listing_id, visibility);

-- ── 2. Backfill from the listing's CURRENT lifecycle state ──────────────
-- Existing rows predate the column and would otherwise all read 'draft',
-- which would hide media belonging to properties that are legitimately live
-- today. This maps each row to what its listing already is:
--
--   published                     -> published      (stays visible)
--   rejected / archived / deleted -> rejected       (not active public media)
--   pending_review / verified /
--   unavailable                   -> pending_review (not public, not refused)
--   anything else (submitted…)    -> draft
--
-- 'archived' and 'deleted' collapse into 'rejected' because the required
-- state set has exactly one non-public terminal value; the listing itself
-- remains the authority on WHY it is not public.
--
-- Guarded by `visibility = 'draft'` so re-running never overwrites a value
-- the application has since set.
update property_media m
   set visibility = case
         when l.lifecycle_state = 'published' then 'published'
         when l.lifecycle_state in ('rejected', 'archived', 'deleted') then 'rejected'
         when l.lifecycle_state in ('pending_review', 'verified', 'unavailable') then 'pending_review'
         else 'draft'
       end
  from listings l
 where l.id = m.listing_id
   and m.visibility = 'draft';

-- ── Rollback ────────────────────────────────────────────────────────────
-- alter table property_media drop constraint if exists chk_property_media_visibility;
-- drop index if exists idx_property_media_visibility;
-- alter table property_media drop column if exists visibility;
-- (Dropping the column loses only the derived state; it can be rebuilt by
--  re-running the backfill above, since listings.lifecycle_state is the
--  source of truth.)
