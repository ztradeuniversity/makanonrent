/* POST /api/admin/login
   Username + password → session cookie. No self-registration exists;
   every account reaching this endpoint was created by a CEO or Assistant
   CEO (ADR §5).

   Request:  { username, password }
   Response: { ok, user: { id, fullName, role }, mustChangePassword }
             + Set-Cookie: mor_admin_session

   ⚠ MFA is NOT enforced here. Doc 18 Article 9.4 requires it for internal
   roles; ADR 0001 §5 defers rather than waives it, and the schema is
   already MFA-ready (admin_users.totp_secret / mfa_enforced). This is a
   known open compliance item, not a finished control. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { verifyPassword, needsRehash, hashPassword } from '../../utils/password.js';
import { createSession, buildSetCookie } from '../../utils/session.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var MAX_FAILED = 8;
var WINDOW_MINUTES = 15;

/* Throttle credential stuffing using the audit log we already write —
   no KV, no Durable Object, no extra table. Counts failures for THIS
   username rather than this IP: an attacker rotating IPs is the realistic
   case, and locking by IP would let one bad actor lock out a whole office
   behind a single NAT. */
async function recentFailures(db, username) {
  var since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  var res = await db.from('admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'login_failed')
    .eq('entity_type', 'admin_login')
    .eq('entity_id', username)
    .gte('at', since);
  if (res.error) return 0;   // never let the throttle itself block login
  return res.count || 0;
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.username, 60) || !isNonEmptyString(body.password, 200)) {
    return json(env, { error: 'Username and password are required.' }, 422);
  }

  var username = String(body.username).trim().toLowerCase();
  var db = getServiceClient(env);

  try {
    if (await recentFailures(db, username) >= MAX_FAILED) {
      await logAudit(env, {
        action: 'login_throttled', entityType: 'admin_login', entityId: username,
        request: context.request
      });
      return json(env, {
        error: 'Too many failed attempts. Try again in ' + WINDOW_MINUTES + ' minutes.'
      }, 429);
    }

    var res = await db.from('admin_users')
      .select('id, username, full_name, role, frozen_role, status, password_hash, password_salt, password_algo, must_change_password')
      .eq('username', username)
      .maybeSingle();
    if (res.error) throw res.error;

    var user = res.data;
    /* Verify even when the user does not exist, against a dummy hash, so
       response time does not reveal which usernames are real. */
    var ok = user
      ? await verifyPassword(body.password, user)
      : await verifyPassword(body.password, {
          password_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          password_salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          password_algo: 'pbkdf2-sha256-210000'
        });

    /* One message for every failure mode — wrong user, wrong password,
       disabled, archived. Distinguishing them would enumerate accounts. */
    if (!user || !ok || user.status !== 'active') {
      await logAudit(env, {
        actorId: user ? user.id : null,
        action: 'login_failed', entityType: 'admin_login', entityId: username,
        detail: { reason: !user ? 'no_such_user' : (!ok ? 'bad_password' : 'inactive:' + user.status) },
        request: context.request
      });
      return json(env, { error: 'Incorrect username or password.' }, 401);
    }

    /* Transparent hash upgrade when the iteration floor has been raised
       since this password was set (functions/utils/password.js). */
    if (needsRehash(user)) {
      var upgraded = await hashPassword(body.password);
      await db.from('admin_users').update({
        password_hash: upgraded.hash, password_salt: upgraded.salt, password_algo: upgraded.algo
      }).eq('id', user.id);
    }

    var session = await createSession(env, user.id, context.request);
    await db.from('admin_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    await logAudit(env, {
      actorId: user.id, actorRole: user.role, action: 'login',
      entityType: 'admin_user', entityId: user.id, request: context.request
    });

    return jsonWithHeaders(env, {
      ok: true,
      user: { id: user.id, fullName: user.full_name, username: user.username, role: user.role },
      mustChangePassword: user.must_change_password
    }, 200, { 'Set-Cookie': buildSetCookie(session.token) });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Login failed.' }, 500);
  }
}
