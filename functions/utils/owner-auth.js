/* MakanOnRent — owner identity (Cloudflare Pages Functions only).

   Google sign-in for property owners, run through Supabase Auth (GoTrue)
   — the auth service of the database this project already uses. That
   choice is what keeps this from being a second authentication system:

     · No password scheme. Google verifies the person; GoTrue verifies
       the token. Nothing here hashes or stores a credential.
     · No second session table. GoTrue issues the access/refresh pair and
       is the authority on whether it is still valid, so there is nothing
       to persist and nothing to expire on our side.
     · No Google client secret in this repository. It lives in the
       Supabase dashboard, which is what exchanges the code with Google.
     · No library in the browser. The whole flow is redirects plus
       server-side fetch, so web/ ships no SDK and the production CSP
       (script-src 'self') is untouched.

   admin_sessions is NOT reused and NOT reachable from here. An owner
   token can never resolve to an admin identity: different cookie,
   different issuer, different resolver (functions/utils/session.js).

   The flow is PKCE, because it is the only variant a server can complete:
   the implicit flow returns tokens in the URL fragment, which never
   reaches the server at all.

     /api/owner/login    → 302 to GoTrue authorize (Google)
     Google → Supabase   → 302 back to /api/owner/callback?code=…
     /api/owner/callback → exchanges the code, sets the session cookie */
import { requireEnv } from './env.js';
import { getServiceClient } from './supabase.js';

export var OWNER_COOKIE = 'mor_owner_session';
export var VERIFIER_COOKIE = 'mor_owner_pkce';

/* ── small helpers ─────────────────────────────────────────────────── */
function b64url(bytes) {
  var b = new Uint8Array(bytes), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readCookie(request, name) {
  var header = request.headers.get('Cookie') || '';
  var parts = header.split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim();
    var eq = kv.indexOf('=');
    if (eq > -1 && kv.slice(0, eq) === name) return kv.slice(eq + 1);
  }
  return null;
}

/* Secure is set unconditionally: every deployment of this site is https,
   and a cookie that would survive a plaintext request is a downgrade
   waiting to happen. SameSite=Lax so the cookie still arrives on the
   top-level redirect back from Google. */
function cookie(name, value, maxAgeSeconds) {
  return name + '=' + value +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAgeSeconds;
}

export function sessionCookie(tokens) {
  /* Both tokens travel in one HttpOnly cookie. The browser cannot read
     it (no JS access), and nothing else needs to. */
  var payload = b64url(new TextEncoder().encode(JSON.stringify({
    a: tokens.access_token, r: tokens.refresh_token
  })));
  return cookie(OWNER_COOKIE, payload, 30 * 24 * 3600);
}

export function clearedCookies() {
  return [
    OWNER_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    VERIFIER_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  ];
}

function decodeSession(raw) {
  try {
    var pad = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (pad.length % 4) pad += '=';
    var json = new TextDecoder().decode(
      Uint8Array.from(atob(pad), function (c) { return c.charCodeAt(0); }));
    var o = JSON.parse(json);
    return (o && o.a) ? { access_token: o.a, refresh_token: o.r } : null;
  } catch (e) { return null; }
}

/* ── PKCE ──────────────────────────────────────────────────────────── */
export async function createPkce() {
  var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier: verifier, challenge: b64url(digest) };
}

export function verifierCookie(verifier) {
  /* Ten minutes is longer than any real sign-in and short enough that an
     abandoned attempt leaves nothing behind. */
  return cookie(VERIFIER_COOKIE, verifier, 600);
}

export function authorizeUrl(env, challenge) {
  requireEnv(env, ['SUPABASE_URL', 'SITE_URL']);
  var redirect = env.SITE_URL.replace(/\/+$/, '') + '/api/owner/callback';
  return env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/authorize' +
    '?provider=google' +
    '&redirect_to=' + encodeURIComponent(redirect) +
    '&code_challenge=' + encodeURIComponent(challenge) +
    '&code_challenge_method=s256';
}

/* GoTrue needs the anon key on every /auth/v1 call. It is a PUBLIC
   publishable key — it grants nothing on its own, RLS still applies, and
   it is never served to the browser here regardless. */
function authHeaders(env) {
  requireEnv(env, ['SUPABASE_ANON_KEY']);
  return { 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
}

export async function exchangeCode(env, code, verifier) {
  requireEnv(env, ['SUPABASE_URL']);
  var res = await fetch(
    env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/token?grant_type=pkce',
    { method: 'POST', headers: authHeaders(env),
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });

  var data = await res.json().catch(function () { return null; });
  if (!res.ok || !data || !data.access_token) {
    return { ok: false, error: (data && (data.error_description || data.msg || data.error)) || 'Sign-in could not be completed.' };
  }
  return { ok: true, tokens: data, user: data.user || null };
}

async function refresh(env, refreshToken) {
  var res = await fetch(
    env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token',
    { method: 'POST', headers: authHeaders(env),
      body: JSON.stringify({ refresh_token: refreshToken }) });
  var data = await res.json().catch(function () { return null; });
  if (!res.ok || !data || !data.access_token) return null;
  return data;
}

async function fetchUser(env, accessToken) {
  var res = await fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: Object.assign(authHeaders(env), { 'Authorization': 'Bearer ' + accessToken })
  });
  if (!res.ok) return null;
  return res.json().catch(function () { return null; });
}

/* ── the guard every owner route starts with ───────────────────────── */
/* Resolves the cookie to a VERIFIED identity by asking GoTrue, never by
   trusting anything the request said about itself. Returns null when
   there is no valid session — callers turn that into a 401.

   `setCookie` is returned when the access token was refreshed, so the
   caller can persist the rotated pair. */
export async function resolveOwner(env, request) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  var raw = readCookie(request, OWNER_COOKIE);
  if (!raw) return null;
  var session = decodeSession(raw);
  if (!session) return null;

  var user = await fetchUser(env, session.access_token);
  var setCookie = null;

  if (!user && session.refresh_token) {
    /* Access tokens are short-lived by design; a stale one is the normal
       case for a returning owner, not a failure. */
    var rotated = await refresh(env, session.refresh_token);
    if (!rotated) return null;
    user = rotated.user || await fetchUser(env, rotated.access_token);
    if (!user) return null;
    setCookie = sessionCookie(rotated);
  }

  if (!user || !user.id) return null;

  /* An unverified address must never key ownership. Google always
     supplies a verified one, so this only ever rejects a provider that
     did not. */
  var email = user.email || null;
  var verified = user.email_confirmed_at != null ||
                 (user.user_metadata && user.user_metadata.email_verified === true);
  if (!email || !verified) return null;

  return {
    authUserId: user.id,
    email: String(email).toLowerCase(),
    name: (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || null,
    setCookie: setCookie
  };
}

/* ── identity → the existing contact record ────────────────────────── */
/* Returns the contacts row this signed-in person IS, creating or claiming
   one as needed. This is the ONLY place auth_user_id is written.

   Claiming: a contact that already carries this email but has never been
   linked is adopted rather than duplicated — that is the owner who
   submitted a property by phone before signing in, and the address is now
   verified by Google. A contact already linked to a DIFFERENT identity is
   never touched. */
export async function contactForOwner(env, owner) {
  var db = getServiceClient(env);

  var linked = await db.from('contacts')
    .select('id, full_name, email, phone_e164, auth_user_id')
    .eq('auth_user_id', owner.authUserId)
    .maybeSingle();
  if (linked.error) throw linked.error;

  if (linked.data) {
    await db.from('contacts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', linked.data.id);
    return linked.data;
  }

  var byEmail = await db.from('contacts')
    .select('id, full_name, email, phone_e164, auth_user_id')
    .ilike('email', owner.email)
    .is('auth_user_id', null)
    .limit(1);
  if (byEmail.error) throw byEmail.error;

  if (byEmail.data && byEmail.data.length) {
    var claim = byEmail.data[0];
    var upd = await db.from('contacts').update({
      auth_user_id: owner.authUserId,
      email_verified: true,
      email: owner.email,
      last_login_at: new Date().toISOString()
    }).eq('id', claim.id);
    if (upd.error) throw upd.error;
    claim.auth_user_id = owner.authUserId;
    return claim;
  }

  var created = await db.from('contacts').insert({
    full_name: owner.name || owner.email,
    email: owner.email,
    email_verified: true,
    auth_user_id: owner.authUserId,
    phone_e164: null,
    source: 'google_signin',
    last_login_at: new Date().toISOString()
  }).select('id, full_name, email, phone_e164, auth_user_id').single();
  if (created.error) throw created.error;
  return created.data;
}

/* The owner_profile that owns properties. Created on demand so a person
   who signs in but never submits does not get an empty ownership record. */
export async function ownerProfileFor(env, contactId, opts) {
  var db = getServiceClient(env);
  var existing = await db.from('owner_profiles').select('id').eq('contact_id', contactId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;
  if (opts && opts.createIfMissing === false) return null;

  var created = await db.from('owner_profiles').insert({ contact_id: contactId }).select('id').single();
  if (created.error) throw created.error;
  return created.data.id;
}
