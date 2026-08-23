/* POST /api/admin/login
   Two-step flow when the account has a registered email:

     step 1 — { step: 'credentials', username, password, email }
              → { ok, otpRequired: true, otpId, maskedEmail }
              NO session is issued here. A wrong username, password OR
              email all produce the SAME generic error (account
              enumeration resistance) and none of them sends an OTP.

     step 2 — { step: 'otp', otpId, code }
              → { ok, user: { id, fullName, username, role }, mustChangePassword }
              + Set-Cookie: mor_admin_session

   Accounts created before migration 0007/0012 (no email on file) skip the
   OTP step entirely and authenticate on step 1 exactly as before — this is
   what keeps the CEO's own already-live session from being locked out by
   an OTP requirement it never opted into. Every account created through
   /api/admin/users going forward has email required, so it always gets
   the OTP step.

   OTP codes reuse migrations/0007's admin_email_otp table (purpose='login')
   and the existing hashed-code convention (hashToken from session.js) —
   no second OTP table, no second hashing scheme.

   ⚠ MFA is NOT a general TOTP factor here — Doc 18 Article 9.4 / ADR 0001
   §5 still defers that. This is specifically the login-time email-OTP flow
   the Team Management brief asked for, layered on top of the same
   password check that already existed. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { verifyPassword, needsRehash, hashPassword } from '../../utils/password.js';
import { createSession, buildSetCookie, hashToken } from '../../utils/session.js';
import { genCode } from './otp.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var MAX_FAILED = 8;
var WINDOW_MINUTES = 15;
var OTP_MINUTES = 10;
var MAX_OTP_ATTEMPTS = 5;

/* Throttle credential stuffing using the audit log we already write —
   no KV, no Durable Object, no extra table. Counts failures for THIS
   username rather than this IP: an attacker rotating IPs is the realistic
   case, and locking by IP would let one bad actor lock out a whole office
   behind a single NAT. Also covers OTP guessing: a wrong-code attempt logs
   the same 'login_failed' action against the same username. */
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

function maskEmail(email) {
  var at = email.indexOf('@');
  if (at < 2) return email;
  return email.slice(0, 2) + '***' + email.slice(at);
}

async function finishLogin(env, db, user, request) {
  var session = await createSession(env, user.id, request);
  await db.from('admin_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  await logAudit(env, {
    actorId: user.id, actorRole: user.role, action: 'login',
    entityType: 'admin_user', entityId: user.id, request: request
  });

  return jsonWithHeaders(env, {
    ok: true,
    user: { id: user.id, fullName: user.full_name, username: user.username, role: user.role },
    mustChangePassword: user.must_change_password
  }, 200, { 'Set-Cookie': buildSetCookie(session.token) });
}

async function stepCredentials(env, db, body, request) {
  if (!isNonEmptyString(body.username, 60) || !isNonEmptyString(body.password, 200)) {
    return json(env, { error: 'Username and password are required.' }, 422);
  }

  var username = String(body.username).trim().toLowerCase();

  if (await recentFailures(db, username) >= MAX_FAILED) {
    await logAudit(env, {
      action: 'login_throttled', entityType: 'admin_login', entityId: username, request: request
    });
    return json(env, {
      error: 'Too many failed attempts. Try again in ' + WINDOW_MINUTES + ' minutes.'
    }, 429);
  }

  var res = await db.from('admin_users')
    .select('id, username, full_name, role, frozen_role, status, email, password_hash, password_salt, password_algo, must_change_password')
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
        password_algo: 'pbkdf2-sha256-100000'
      });

  /* One message for every failure mode — wrong user, wrong password,
     disabled, archived, or (when the account has an email on file) a
     mismatched email. Distinguishing any of them would enumerate accounts
     or confirm a guessed email address. */
  var genericError = function (reason) {
    return logAudit(env, {
      actorId: user ? user.id : null,
      action: 'login_failed', entityType: 'admin_login', entityId: username,
      detail: { reason: reason }, request: request
    }).then(function () {
      return json(env, { error: 'Incorrect username, password or email.' }, 401);
    });
  };

  if (!user || !ok || user.status !== 'active') {
    return genericError(!user ? 'no_such_user' : (!ok ? 'bad_password' : 'inactive:' + user.status));
  }

  /* Transparent hash upgrade when the iteration floor has been raised
     since this password was set. */
  if (needsRehash(user)) {
    var upgraded = await hashPassword(body.password);
    await db.from('admin_users').update({
      password_hash: upgraded.hash, password_salt: upgraded.salt, password_algo: upgraded.algo
    }).eq('id', user.id);
  }

  /* No email on file (an account created before this account carried
     email) — authenticate exactly as before, no OTP step. Every account
     created through /api/admin/users now requires email, so this branch
     only ever applies to legacy rows. */
  if (!user.email) {
    return finishLogin(env, db, user, request);
  }

  var suppliedEmail = isNonEmptyString(body.email, 200) ? String(body.email).trim().toLowerCase() : '';
  if (!suppliedEmail || suppliedEmail !== user.email.toLowerCase()) {
    return genericError('bad_email');
  }

  var code = genCode();
  var codeHash = await hashToken(code);
  var ins = await db.from('admin_email_otp').insert({
    admin_user_id: user.id, email: user.email, code_hash: codeHash,
    purpose: 'login', expires_at: new Date(Date.now() + OTP_MINUTES * 60000).toISOString()
  }).select('id').single();
  if (ins.error) throw ins.error;

  await db.from('email_delivery_queue').insert({
    to_email: user.email, template: 'admin_otp_login',
    payload: { code: code, expiresInMinutes: OTP_MINUTES }
  });

  await logAudit(env, {
    actorId: user.id, actorRole: user.role, action: 'otp_requested',
    entityType: 'admin_user', entityId: user.id, detail: { purpose: 'login' }, request: request
  });

  return json(env, { ok: true, otpRequired: true, otpId: ins.data.id, maskedEmail: maskEmail(user.email) });
}

async function stepOtp(env, db, body, request) {
  if (!isNonEmptyString(body.otpId, 60) || !isNonEmptyString(body.code, 10)) {
    return json(env, { error: 'otpId and code are required.' }, 422);
  }

  var row = await db.from('admin_email_otp')
    .select('id, admin_user_id, code_hash, expires_at, consumed_at, attempts')
    .eq('id', body.otpId).eq('purpose', 'login').maybeSingle();
  if (row.error) throw row.error;

  if (!row.data || row.data.consumed_at || new Date(row.data.expires_at) < new Date()
      || row.data.attempts >= MAX_OTP_ATTEMPTS) {
    return json(env, { error: 'Invalid or expired code.' }, 401);
  }

  var codeHash = await hashToken(body.code);

  if (row.data.code_hash !== codeHash) {
    await db.from('admin_email_otp').update({ attempts: row.data.attempts + 1 }).eq('id', row.data.id);
    var u = await db.from('admin_users').select('username').eq('id', row.data.admin_user_id).maybeSingle();
    await logAudit(env, {
      actorId: row.data.admin_user_id, action: 'login_failed',
      entityType: 'admin_login', entityId: u.data ? u.data.username : row.data.admin_user_id,
      detail: { reason: 'bad_otp' }, request: request
    });
    return json(env, { error: 'Invalid or expired code.' }, 401);
  }

  var user = await db.from('admin_users')
    .select('id, username, full_name, role, frozen_role, status, must_change_password')
    .eq('id', row.data.admin_user_id).maybeSingle();
  if (user.error) throw user.error;
  if (!user.data || user.data.status !== 'active') {
    return json(env, { error: 'Invalid or expired code.' }, 401);
  }

  await db.from('admin_email_otp').update({ consumed_at: new Date().toISOString() }).eq('id', row.data.id);

  return finishLogin(env, db, user.data, request);
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);

    if (body.step === 'otp') return await stepOtp(env, db, body, context.request);
    return await stepCredentials(env, db, body, context.request);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Login failed.' }, 500);
  }
}
