/* MakanOnRent — Web Push transport (Cloudflare Pages Functions only).

   Everything needed to hand an encrypted notification to a browser's push
   service, built on WebCrypto alone — no dependency, nothing to bundle.

   Two specs are implemented here and nothing else:

     · RFC 8292 (VAPID) — proves to the push service that the sender is
       this application. An ES256 JWT signed with the VAPID private key,
       sent as `Authorization: vapid t=<jwt>, k=<public key>`.

     · RFC 8291 / RFC 8188 (aes128gcm) — encrypts the payload so the push
       service, which relays it, cannot read it. The keys come from an
       ECDH between a per-message keypair and the browser's subscription
       key, mixed with the subscription's auth secret.

   VAPID_PRIVATE_KEY never leaves the server: it is read from env inside
   these functions, and nothing here returns it. Only VAPID_PUBLIC_KEY is
   ever handed to a browser, by /api/push/key.

   Deliberately no retry loop: sendPush reports what happened and lets the
   caller decide. A 404/410 from the push service means the subscription is
   gone for good, and is reported as `gone` so the caller can revoke it
   rather than trying again forever. */
import { requireEnv } from './env.js';

/* ── base64url ─────────────────────────────────────────────────────── */
export function b64urlToBytes(s) {
  var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  var bin = atob(t);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  var b = new Uint8Array(bytes);
  var bin = '';
  for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(list) {
  var len = 0, i;
  for (i = 0; i < list.length; i++) len += list[i].length;
  var out = new Uint8Array(len), off = 0;
  for (i = 0; i < list.length; i++) { out.set(list[i], off); off += list[i].length; }
  return out;
}

function utf8(s) { return new TextEncoder().encode(s); }

/* ── HKDF (RFC 5869), the two-step form RFC 8291 spells out ────────── */
async function hmac(keyBytes, data) {
  var key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/* Extract-then-expand with a single-block output (L <= 32), which is all
   Web Push ever needs: the 0x01 counter byte is the whole expand step. */
async function hkdf(salt, ikm, info, length) {
  var prk = await hmac(salt, ikm);
  var okm = await hmac(prk, concat([info, new Uint8Array([1])]));
  return okm.slice(0, length);
}

/* ── VAPID: an ES256 JWT over the push service's origin ────────────── */
async function importVapidPrivateKey(privateB64url, publicB64url) {
  var d = b64urlToBytes(privateB64url);
  var pub = b64urlToBytes(publicB64url);
  /* The public key is the uncompressed point 0x04 || X || Y. */
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error('VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point.');
  }
  var jwk = {
    kty: 'EC', crv: 'P-256',
    d: bytesToB64url(d),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true
  };
  return crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidHeader(env, endpoint, opts) {
  requireEnv(env, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);

  var aud = new URL(endpoint).origin;
  /* RFC 8292 caps this at 24h; 12h leaves room for clock skew either way. */
  var exp = Math.floor(Date.now() / 1000) + ((opts && opts.ttlSeconds) || 12 * 3600);

  var header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var claims = bytesToB64url(utf8(JSON.stringify({
    aud: aud, exp: exp, sub: env.VAPID_SUBJECT
  })));
  var signingInput = utf8(header + '.' + claims);

  var key = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  /* WebCrypto returns the raw r||s pair, which is exactly what JWS ES256
     wants — no DER unwrapping needed. */
  var sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, signingInput));

  var jwt = header + '.' + claims + '.' + bytesToB64url(sig);
  return 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY;
}

/* ── RFC 8291 payload encryption ───────────────────────────────────── */
/* Returns the complete aes128gcm body:
     salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext
   `salt` and `serverKeys` are injectable so a test can pin them; in
   production both are freshly random per message, which is required —
   reusing a keypair across messages would leak. */
export async function encryptPayload(plaintext, p256dhB64url, authB64url, opts) {
  opts = opts || {};
  var uaPublic = b64urlToBytes(p256dhB64url);
  var authSecret = b64urlToBytes(authB64url);

  if (uaPublic.length !== 65 || uaPublic[0] !== 4) {
    throw new Error('Subscription p256dh key is not a valid P-256 point.');
  }
  if (authSecret.length !== 16) {
    throw new Error('Subscription auth secret must be 16 bytes.');
  }

  var salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));

  var serverKeys = opts.serverKeys || await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  var asPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  var uaKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  var ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));

  /* RFC 8291 §3.4. The key_info string binds the derived key to BOTH
     public keys, in this order — receiver first, then sender. */
  var keyInfo = concat([utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic]);
  var ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  var cek = await hkdf(salt, ikm, concat([utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])]), 16);
  var nonce = await hkdf(salt, ikm, concat([utf8('Content-Encoding: nonce'), new Uint8Array([0])]), 12);

  /* A single record, so the padding delimiter is 0x02 ("last record").
     0x01 would tell the receiver another record follows. */
  var padded = concat([utf8(plaintext), new Uint8Array([2])]);

  var aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  var ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  /* RFC 8188 §2 header. rs must be large enough for the whole record. */
  var rs = ciphertext.length + 16 + 1;
  var rsBytes = new Uint8Array([
    (rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255
  ]);

  return concat([salt, rsBytes, new Uint8Array([asPublic.length]), asPublic, ciphertext]);
}

/* ── send ──────────────────────────────────────────────────────────── */
/* Resolves to { ok, status, gone } and never throws for a delivery
   failure: one dead subscription must not stop a broadcast to the rest. */
export async function sendPush(env, subscription, payload, opts) {
  opts = opts || {};
  var endpoint = subscription.endpoint;

  try {
    var body = await encryptPayload(
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      subscription.p256dh, subscription.auth, opts);

    var auth = await vapidHeader(env, endpoint);

    var res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(opts.ttl == null ? 86400 : opts.ttl),
        'Urgency': opts.urgency || 'normal'
      },
      body: body
    });

    /* 404 = endpoint never existed, 410 = the browser dropped it. Both are
       permanent, and the caller revokes on `gone` rather than retrying. */
    var gone = res.status === 404 || res.status === 410;
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: gone };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: (e && e.message) || 'send failed' };
  }
}
