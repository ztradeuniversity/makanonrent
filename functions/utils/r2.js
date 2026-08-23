/* MakanOnRent — reusable R2 upload service (Cloudflare Pages Functions
   only). Generates short-lived, presigned PUT URLs so the BROWSER
   uploads file bytes directly to R2 — the Function never receives or
   proxies the binary, never base64-encodes it, and never writes it to
   any local/temp storage. Only the resulting object key + (for public
   assets) its public URL are ever stored in Supabase.

   Hand-rolled AWS SigV4 (Web Crypto only — no aws-sdk, which does not
   run in the Workers runtime without heavy Node polyfills). R2's
   S3-compatible API accepts standard SigV4 presigned requests with
   region "auto" and service "s3". Reference: Cloudflare R2 + AWS SigV4
   presigned-URL specification.

   If a native R2 bucket binding (env.R2_BUCKET, see wrangler.toml) is
   configured, presigning is skipped entirely in favour of no-key-
   material proxy uploads — see uploadViaBinding() below. Neither path
   requires the caller (functions/api/uploads/presign.js) to know which
   one is active. */
import { requireEnv } from './env.js';

function toHex(buf) {
  var bytes = new Uint8Array(buf);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function sha256Hex(message) {
  var data = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  var digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function hmac(keyBytes, message) {
  var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, typeof message === 'string' ? new TextEncoder().encode(message) : message);
}

function amzDate(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
function dateStamp(d) {
  return amzDate(d).slice(0, 8);
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

/* Shared SigV4 presigner. Extracted verbatim from presignPutUrl so the
   upload path is byte-for-byte what it always was; the only variable is
   the HTTP method, which is the single difference between a presigned
   upload and a presigned read. */
async function presignUrl(env, key, method, expiresSeconds) {
  requireEnv(env, ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);

  var host = env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com';
  var region = 'auto';
  var service = 's3';
  var now = new Date();
  var xAmzDate = amzDate(now);
  var stamp = dateStamp(now);
  var credentialScope = stamp + '/' + region + '/' + service + '/aws4_request';
  var credential = env.R2_ACCESS_KEY_ID + '/' + credentialScope;

  var canonicalUri = '/' + env.R2_BUCKET_NAME + '/' + key.split('/').map(encodeRfc3986).join('/');

  var queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': xAmzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  };
  var canonicalQuery = Object.keys(queryParams).sort()
    .map(function (k) { return encodeRfc3986(k) + '=' + encodeRfc3986(queryParams[k]); })
    .join('&');

  var canonicalHeaders = 'host:' + host + '\n';
  var canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'
  ].join('\n');

  var stringToSign = [
    'AWS4-HMAC-SHA256', xAmzDate, credentialScope, await sha256Hex(canonicalRequest)
  ].join('\n');

  var kDate = await hmac(new TextEncoder().encode('AWS4' + env.R2_SECRET_ACCESS_KEY), stamp);
  var kRegion = await hmac(kDate, region);
  var kService = await hmac(kRegion, service);
  var kSigning = await hmac(kService, 'aws4_request');
  var signature = toHex(await hmac(kSigning, stringToSign));

  return 'https://' + host + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

/* Presigned PUT URL, valid for `expiresSeconds` (default 600). `key` must
   already be the full object key (see buildObjectKey below) — this
   function does not sanitize it. */
export async function presignPutUrl(env, key, opts) {
  return presignUrl(env, key, 'PUT', (opts && opts.expiresSeconds) || 600);
}

/* Deletes one object from R2, executed server-side (not a presigned URL
   handed to the browser — a delete is never something the client should
   be trusted to trigger on its own). Reuses presignUrl's exact SigV4
   signer with method 'DELETE'; the request is then made immediately
   rather than returned as a link.

   Callers are the only guard against deleting the wrong thing: this
   function trusts `key` completely and does not verify it belongs to any
   particular listing. Every caller must compute `key` from a
   property_media row already scoped to the correct listing_id — never
   from anything the client sent.

   Returns { ok, status } and never throws for an R2-side failure (a 404
   for an object already gone is treated as success — the end state,
   "not in the bucket", is what was asked for). A network-level failure
   still resolves rather than rejecting, so a batch delete can report
   partial failure instead of losing track of which keys succeeded. */
export async function deleteObject(env, key) {
  try {
    var url = await presignUrl(env, key, 'DELETE', 60);
    var res = await fetch(url, { method: 'DELETE' });
    var ok = res.status === 204 || res.status === 200 || res.status === 404;
    return { key: key, ok: ok, status: res.status };
  } catch (e) {
    return { key: key, ok: false, status: 0, error: (e && e.message) || 'delete failed' };
  }
}

/* Best-effort batch delete. Every key is attempted even if an earlier one
   fails, and the caller gets a full per-key report — a partial failure
   here must be visible, never silently swallowed into a bare "done". */
export async function deleteObjects(env, keys) {
  var out = [];
  for (var i = 0; i < keys.length; i++) out.push(await deleteObject(env, keys[i]));
  return out;
}

/* Presigned GET URL — the controlled read path for media whose listing is
   published. Deliberately short-lived: the URL is minted per page view, so
   a link that escapes (shared screenshot, referrer log, cached HTML) stops
   working quickly instead of being a permanent public address the way an
   R2_PUBLIC_BASE_URL link is.

   This works against the bucket's S3 endpoint and is therefore independent
   of whether the public custom domain is enabled — which is what lets the
   read path be switched over and verified BEFORE public access is turned
   off in the dashboard. */
export async function presignGetUrl(env, key, opts) {
  return presignUrl(env, key, 'GET', (opts && opts.expiresSeconds) || 600);
}

/* Deterministic, collision-safe object key. `visibility` splits public
   property media from private/sensitive documents (Doc 09 §4) so a
   sensitive object is never addressable via the public base URL even
   by guessing — it simply isn't under the public prefix. */
export function buildObjectKey(draftId, kind, filename, visibility) {
  var safeName = String(filename).toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-80);
  var prefix = visibility === 'private' ? 'private/verification' : 'public/properties';
  return prefix + '/' + draftId + '/' + Date.now() + '-' + safeName;
}

/* NOTE ON DISPLAY: this permanent link is no longer how property media is
   shown. Public display goes through GET /api/properties/media, which
   returns short-lived presigned URLs and only for listings whose media is
   'published'. The value is still recorded in property_media.public_url as
   provenance, and nothing reads it for rendering — so once the bucket's
   public access is switched off (the documented manual step) these stored
   links stop resolving without affecting any page.

   Public assets only. R2 has no public URL purely from account+bucket —
   the bucket's r2.dev subdomain must be enabled or a custom domain
   attached, and that base URL set as R2_PUBLIC_BASE_URL. Returns null
   (not a guessed/broken URL) if that isn't configured, so a caller
   can't accidentally store a dead link. */
export function publicUrlFor(env, key) {
  if (!env.R2_PUBLIC_BASE_URL) return null;
  return env.R2_PUBLIC_BASE_URL.replace(/\/$/, '') + '/' + key;
}
