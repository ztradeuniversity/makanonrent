/* MakanOnRent — admin session management.
   Implements docs/adr/0001-admin-management-rbac.md §5.

   Only the SHA-256 of the token is persisted (admin_sessions.token_hash).
   The raw token exists in exactly two places: the Set-Cookie response and
   the browser's cookie jar. A dump of the database therefore yields no
   usable session — this is the reason the column is called token_hash and
   not token, and it must stay that way. */
import { getServiceClient } from './supabase.js';

export var SESSION_COOKIE = 'mor_admin_session';
var SESSION_HOURS = 12;

function toHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function newToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

function clientMeta(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || null,
    user_agent: (request.headers.get('User-Agent') || '').slice(0, 400) || null
  };
}

/* SameSite=Strict: the admin console is never legitimately reached by a
   cross-site navigation, so Strict costs nothing and removes CSRF as a
   class rather than mitigating it. Secure is unconditional — Pages serves
   HTTPS everywhere including previews. */
export function buildSetCookie(token) {
  return SESSION_COOKIE + '=' + token +
    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + (SESSION_HOURS * 3600);
}

export function buildClearCookie() {
  return SESSION_COOKIE + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
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

export async function createSession(env, userId, request) {
  var db = getServiceClient(env);
  var token = newToken();
  var meta = clientMeta(request);
  var expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();

  var res = await db.from('admin_sessions').insert({
    user_id: userId,
    token_hash: await hashToken(token),
    expires_at: expires,
    ip: meta.ip,
    user_agent: meta.user_agent
  }).select('id').single();

  if (res.error) throw res.error;
  return { token: token, sessionId: res.data.id, expiresAt: expires };
}

/* Resolves the caller. Returns null for every failure mode — absent
   cookie, unknown token, revoked, expired, or a user who has since been
   disabled/archived — so no caller can accidentally distinguish them and
   turn this into an account-enumeration oracle.

   The disabled-user check is here rather than only at login because
   Doc 16 requires revocation to take effect within seconds: a user
   disabled mid-session must lose access on their very next request, not
   when their 12-hour cookie happens to expire. */
export async function resolveSession(env, request) {
  var token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  var db = getServiceClient(env);
  var res = await db.from('admin_sessions')
    .select('id, user_id, expires_at, revoked_at, admin_users!inner(id, username, full_name, role, frozen_role, status, must_change_password, reports_to_user_id)')
    .eq('token_hash', await hashToken(token))
    .maybeSingle();

  if (res.error || !res.data) return null;
  var s = res.data;
  if (s.revoked_at) return null;
  if (new Date(s.expires_at).getTime() <= Date.now()) return null;

  var user = s.admin_users;
  if (!user || user.status !== 'active') return null;

  /* Sliding activity marker for the CEO monitoring view. Fire-and-forget:
     a failed touch must never fail an otherwise-valid request. */
  db.from('admin_sessions').update({ last_seen_at: new Date().toISOString() })
    .eq('id', s.id).then(function () {}, function () {});

  return { sessionId: s.id, user: user };
}

export async function revokeSession(env, request) {
  var token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  var db = getServiceClient(env);
  await db.from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', await hashToken(token));
}

/* Used when an account is disabled or its password reset: kills every
   live session for that identity immediately. */
export async function revokeAllUserSessions(env, userId) {
  var db = getServiceClient(env);
  await db.from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
}
