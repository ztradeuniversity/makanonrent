-- MakanOnRent — Migration 0019: Team member Phone + WhatsApp (encrypted at rest)
-- ============================================================================
-- Adds a contact number and a WhatsApp number to admin_users. Both are
-- PERSONAL DATA of an internal staff member, so unlike `email` (which the
-- login OTP flow must read in the clear on every sign-in) they are stored
-- ENCRYPTED and are only ever decrypted for a caller the hierarchy rule in
-- functions/utils/rbac.js#getFullContactUserIds actually authorises.
--
-- Why four columns instead of two:
--
--   phone_enc / whatsapp_enc
--     AES-GCM ciphertext produced by functions/utils/contact-crypto.js,
--     stored as 'v1:<base64(iv || ciphertext||tag)>'. Text rather than
--     bytea so it round-trips through PostgREST unchanged — the same
--     choice migration 0004 already made for password_hash/password_salt.
--     The key lives ONLY in the CONTACT_ENCRYPTION_KEY environment
--     variable, never in this database: a dump of admin_users yields no
--     phone numbers.
--
--   phone_last4 / whatsapp_last4
--     The last 4 digits, in the clear, ON PURPOSE. A caller who may see
--     that a colleague HAS a number but is not authorised to read it gets
--     '••• ••• 4821' — enough to confirm identity or match against a
--     number they were given verbally, without disclosing the number. This
--     is what lets the masked path avoid touching the decryption key at
--     all: a redaction that still requires the plaintext to compute is a
--     redaction that can leak.
--
-- Deliberately NOT added:
--   * No unique index. Two team members legitimately share one office
--     landline, and a uniqueness error on an encrypted column would leak
--     "somebody else already has this number" to whoever hit it. Also,
--     AES-GCM uses a fresh random IV per encryption, so equal plaintexts
--     do not produce equal ciphertexts — a unique index could not detect
--     duplicates anyway.
--   * No CHECK on the ciphertext shape. Format is the encoder's contract
--     (contact-crypto.js), and a constraint here would have to be relaxed
--     the moment a 'v2:' key rotation ships.
--
-- All columns are nullable and every existing row keeps behaving exactly as
-- before (additive expand, same posture as migrations 0007/0014/0016).
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table admin_users add column if not exists phone_enc        text;
alter table admin_users add column if not exists phone_last4      text;
alter table admin_users add column if not exists whatsapp_enc     text;
alter table admin_users add column if not exists whatsapp_last4   text;

-- last4 is a display hint, not a number: exactly four digits or nothing.
-- Cheap to enforce, and it stops a bug that wrote the FULL number here
-- (the one mistake in this design that would silently defeat the masking).
alter table admin_users drop constraint if exists ck_admin_users_phone_last4;
alter table admin_users add constraint ck_admin_users_phone_last4
  check (phone_last4 is null or phone_last4 ~ '^[0-9]{4}$');

alter table admin_users drop constraint if exists ck_admin_users_whatsapp_last4;
alter table admin_users add constraint ck_admin_users_whatsapp_last4
  check (whatsapp_last4 is null or whatsapp_last4 ~ '^[0-9]{4}$');

-- The two halves of one field must be set or cleared together — a
-- ciphertext with no last4 renders as "has a number" with nothing to show,
-- and a last4 with no ciphertext renders as a number that can never be
-- revealed. Both are application bugs, and both are cheaper to catch here.
alter table admin_users drop constraint if exists ck_admin_users_phone_pair;
alter table admin_users add constraint ck_admin_users_phone_pair
  check ((phone_enc is null) = (phone_last4 is null));

alter table admin_users drop constraint if exists ck_admin_users_whatsapp_pair;
alter table admin_users add constraint ck_admin_users_whatsapp_pair
  check ((whatsapp_enc is null) = (whatsapp_last4 is null));

-- admin_users already has RLS enabled with zero policies (migration 0004):
-- only the service role reaches this table, and it does so exclusively from
-- functions/. Nothing about these columns changes that posture, so there is
-- no RLS statement here — adding one would be the misleading half-measure
-- 0004's own comment warns about.
--
-- No audit-table change either: admin_audit_log.action is unconstrained
-- text, so the new 'view_contact' / 'update_contact' actions this feature
-- writes need no migration and no widened CHECK.
