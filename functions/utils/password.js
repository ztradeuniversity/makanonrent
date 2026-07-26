/* MakanOnRent — password hashing for internal admin identities.
   Implements docs/adr/0001-admin-management-rbac.md §5.

   PBKDF2-SHA256 via Web Crypto, which the Workers runtime provides
   natively — no dependency is added for this. bcrypt/argon2 would each
   pull in a WASM or native module that Pages Functions cannot load, so
   PBKDF2 is the strongest option actually available on this runtime,
   not a preference.

   The iteration count is baked into `algo` PER ROW (see
   migrations/0004_admin_rbac.sql) so it can be raised later and existing
   hashes upgraded transparently on the next successful login — without a
   migration and without locking anyone out. That is what needsRehash()
   is for. */

var DEFAULT_ITERATIONS = 210000;   // OWASP 2023 floor for PBKDF2-SHA256
var SALT_BYTES = 16;
var KEY_BITS = 256;

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

export function algoLabel(iterations) {
  return 'pbkdf2-sha256-' + (iterations || DEFAULT_ITERATIONS);
}

/* Parses the iteration count back out of the stored algo label. An
   unrecognised label is a hard failure rather than a silent fallback to
   the default — silently verifying against the wrong iteration count
   would reject every valid password with no explanation. */
function iterationsFromAlgo(algo) {
  var m = /^pbkdf2-sha256-(\d+)$/.exec(String(algo || ''));
  if (!m) throw new Error('Unsupported password algorithm: ' + algo);
  return Number(m[1]);
}

async function derive(password, saltBytes, iterations) {
  var key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
    key, KEY_BITS);
  return new Uint8Array(bits);
}

/* Returns { hash, salt, algo } ready to write straight onto admin_users. */
export async function hashPassword(password, opts) {
  var iterations = (opts && opts.iterations) || DEFAULT_ITERATIONS;
  var salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  var out = await derive(password, salt, iterations);
  return { hash: b64encode(out), salt: b64encode(salt), algo: algoLabel(iterations) };
}

/* Constant-time comparison. A plain === on the base64 strings leaks
   position-of-first-difference through timing; with an attacker-supplied
   password that is a usable oracle. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.password_hash || !stored.password_salt) return false;
  var iterations;
  try {
    iterations = iterationsFromAlgo(stored.password_algo);
  } catch (e) {
    return false;
  }
  var expected = b64decode(stored.password_hash);
  var actual = await derive(password, b64decode(stored.password_salt), iterations);
  return timingSafeEqual(expected, actual);
}

/* True when a row was hashed with a weaker iteration count than we now
   require, so the caller can re-hash on successful login. */
export function needsRehash(stored) {
  try {
    return iterationsFromAlgo(stored && stored.password_algo) < DEFAULT_ITERATIONS;
  } catch (e) {
    return true;
  }
}

/* Password policy. Deliberately minimal and length-first: length is the
   only property that reliably resists offline cracking, and complexity
   rules mostly produce predictable substitutions. */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters.';
  }
  if (password.length > 200) return 'Password must be 200 characters or fewer.';
  if (/^\s|\s$/.test(password)) return 'Password cannot start or end with a space.';
  return null;
}

/* Temporary password for admin-created accounts. The account is created
   with must_change_password = true, so this value only ever survives
   until first login. */
export function generateTempPassword() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var bytes = crypto.getRandomValues(new Uint8Array(14));
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
