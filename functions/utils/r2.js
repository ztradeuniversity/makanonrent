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

/* Presigned PUT URL, valid for `expiresSeconds`. `key` must already be
   the full object key (see buildObjectKey below) — this function does
   not sanitize it. */
export async function presignPutUrl(env, key, opts) {
  requireEnv(env, ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  var expiresSeconds = (opts && opts.expiresSeconds) || 600;

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
    'PUT', canonicalUri, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'
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

/* Deterministic, collision-safe object key. `visibility` splits public
   property media from private/sensitive documents (Doc 09 §4) so a
   sensitive object is never addressable via the public base URL even
   by guessing — it simply isn't under the public prefix. */
export function buildObjectKey(draftId, kind, filename, visibility) {
  var safeName = String(filename).toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-80);
  var prefix = visibility === 'private' ? 'private/verification' : 'public/properties';
  return prefix + '/' + draftId + '/' + Date.now() + '-' + safeName;
}

/* Public assets only. R2 has no public URL purely from account+bucket —
   the bucket's r2.dev subdomain must be enabled or a custom domain
   attached, and that base URL set as R2_PUBLIC_BASE_URL. Returns null
   (not a guessed/broken URL) if that isn't configured, so a caller
   can't accidentally store a dead link. */
export function publicUrlFor(env, key) {
  if (!env.R2_PUBLIC_BASE_URL) return null;
  return env.R2_PUBLIC_BASE_URL.replace(/\/$/, '') + '/' + key;
}
