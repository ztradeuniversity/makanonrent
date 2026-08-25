/* MakanOnRent — reversible encryption for team-member contact numbers.

   Why this file exists at all: password.js HASHES (one-way, PBKDF2), which
   is right for a credential and useless for a phone number the CEO has to
   be able to read back. This is the only reversible-encryption utility in
   the project, and it exists for exactly one job — admin_users.phone_enc /
   whatsapp_enc (migration 0019). It is deliberately narrow: no generic
   "encrypt anything" surface that a future caller could point at a field
   whose threat model is different.

   AES-256-GCM via Web Crypto, which the Workers runtime provides natively —
   the same constraint that forced PBKDF2 in password.js (no WASM/native
   modules on Pages Functions) applies here, and AES-GCM is what the runtime
   actually offers. GCM rather than CBC because it is authenticated: a
   tampered ciphertext fails to decrypt rather than yielding attacker-chosen
   plaintext.

   Storage format:  'v1:' + base64( iv(12 bytes) || ciphertext||tag )
   The version prefix is not decoration — it is what makes a future key
   rotation ('v2:') a code change rather than a migration, since old rows
   stay readable while new writes use the new scheme.

   The key comes from CONTACT_ENCRYPTION_KEY (base64, 32 bytes) and lives
   ONLY in the environment. It is never written to the database, never
   logged, and never included in an audit detail. */
import { requireEnv } from './env.js';

var IV_BYTES = 12;          // 96-bit nonce — the size AES-GCM is specified for
var KEY_BYTES = 32;         // AES-256
var VERSION = 'v1';

/* Importing a CryptoKey costs a syscall-ish hop, and these functions run
   once per contact field per reveal. Cached per raw key string so a key
   rotation (a different env value) is never served a stale key object.
   Module scope = per-isolate, which is the correct lifetime: it dies with
   the isolate and is never shared across accounts. */
var keyCache = new Map();

function b64encode(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(str) {
  var bin = atob(str);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(env) {
  requireEnv(env, ['CONTACT_ENCRYPTION_KEY']);
  var raw = String(env.CONTACT_ENCRYPTION_KEY);

  var cached = keyCache.get(raw);
  if (cached) return cached;

  var bytes;
  try {
    bytes = b64decode(raw);
  } catch (e) {
    throw new Error('CONTACT_ENCRYPTION_KEY must be base64-encoded.');
  }
  /* A short key is a silent downgrade to weaker encryption, so it is a hard
     failure at first use rather than something that "works" in staging. */
  if (bytes.length !== KEY_BYTES) {
    throw new Error('CONTACT_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }

  var key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(raw, key);
  return key;
}

/* ── phone-number normalisation ────────────────────────────────────────
   Stored in a single canonical shape so the same human number entered as
   "+92 300 1234567", "0300-1234567" or "03001234567" does not produce
   three different-looking reveals for three different viewers.

   Deliberately NOT a full E.164 validator with a country-code table: this
   is an internal staff directory, numbers are entered by the CEO from a
   real conversation, and rejecting a legitimate format the table did not
   anticipate is a worse failure here than storing a slightly loose string.
   Digits (with an optional leading '+') and a length band is the bar. */
export function normalisePhone(input) {
  if (input == null) return null;
  var raw = String(input).trim();
  if (!raw) return null;

  var plus = raw.charAt(0) === '+';
  var digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;

  return (plus ? '+' : '') + digits;
}

/* The four digits stored in the clear for the masked view. Read off the
   NORMALISED number so the mask matches the reveal digit-for-digit. */
export function lastFour(normalised) {
  var digits = String(normalised || '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/* What a caller who may see that a number EXISTS, but not what it is,
   receives. Built from last4 alone — this function never sees, and never
   needs, the plaintext or the key. */
export function maskFromLastFour(last4) {
  return last4 ? '••• ••• ' + last4 : null;
}

export async function encryptContact(env, plaintext) {
  var key = await getKey(env);
  var iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  var data = new TextEncoder().encode(String(plaintext));

  var ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv, tagLength: 128 }, key, data
  ));

  var packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return VERSION + ':' + b64encode(packed);
}

/* Returns null rather than throwing for anything unreadable — a row whose
   ciphertext predates a mishandled key rotation, or was hand-edited, must
   render as "no number on file" and must never take down the whole Team
   list for every other member alongside it. A genuine misconfiguration
   (missing/invalid key) still throws from getKey, because that one IS worth
   surfacing loudly instead of silently blanking every number in the org. */
export async function decryptContact(env, stored) {
  if (!stored) return null;
  var key = await getKey(env);

  var s = String(stored);
  var sep = s.indexOf(':');
  if (sep === -1 || s.slice(0, sep) !== VERSION) return null;

  try {
    var packed = b64decode(s.slice(sep + 1));
    if (packed.length <= IV_BYTES) return null;
    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES), tagLength: 128 },
      key,
      packed.slice(IV_BYTES)
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;
  }
}
