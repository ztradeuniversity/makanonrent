/* GET  /api/admin/users        → identities the caller may see
   POST /api/admin/users        → { action: 'create' | 'update' | 'set-status' | 'reset-password', ... }

   Authority flows strictly downward (rbac.canManageRole):
     CEO           → Assistant CEOs, Area Managers ('manager') and Field Officers
     Assistant CEO → Area Managers and Field Officers   ("cannot control CEO")
     Area Manager  → Field Officers only
     Field Officer → nobody

   There is no delete. Doc 18 Article 2.4 forbids hard deletes on business
   entities; the Team UI's "Delete" action is status='archived', which
   preserves every verification and approval the account ever signed. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, canManageRole, can } from '../../utils/rbac.js';
import { hashPassword, generateTempPassword, validatePasswordStrength } from '../../utils/password.js';
import { revokeAllUserSessions } from '../../utils/session.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var FROZEN_ROLE = {
  ceo: 'exec', assistant_ceo: 'city_manager', manager: 'area_manager', field_officer: 'field_officer'
};

/* Downward visibility only, same shape as canManageRole but for LISTING
   rather than acting: a role may see everyone it is entitled to manage,
   never a peer or a superior — that would leak the org chart upward. */
var VISIBLE_ROLES = {
  assistant_ceo: ['manager', 'field_officer'],
  manager: ['field_officer']
};

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'users.list');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var q = db.from('admin_users')
      .select('id, username, full_name, email, role, status, last_login_at, last_verification_at, created_at')
      .neq('status', 'archived')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    var visible = VISIBLE_ROLES[auth.user.role];
    if (visible) q = q.in('role', visible);

    var res = await q;
    if (res.error) throw res.error;

    return json(env, {
      users: (res.data || []).map(function (u) {
        return {
          id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role,
          status: u.status, lastLoginAt: u.last_login_at,
          lastVerificationAt: u.last_verification_at, createdAt: u.created_at,
          manageable: canManageRole(auth.user.role, u.role)
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load users.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

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
    var audit = auditFor(env, auth.user, context.request);

    /* ── create ─────────────────────────────────────────────────────── */
    if (body.action === 'create') {
      var role = body.role;
      if (['assistant_ceo', 'manager', 'field_officer'].indexOf(role) === -1) {
        return json(env, { error: "role must be 'assistant_ceo', 'manager' or 'field_officer'." }, 422);
      }
      var cap = 'users.create.' + role;
      if (!can(auth.user.role, cap)) {
        return json(env, { error: 'Your role cannot create that role.' }, 403);
      }
      if (!isNonEmptyString(body.username, 60)) return json(env, { error: 'username is required.' }, 422);
      if (!isNonEmptyString(body.fullName, 160)) return json(env, { error: 'fullName is required.' }, 422);
      if (!/^[a-zA-Z0-9._-]+$/.test(body.username)) {
        return json(env, { error: 'Username may contain only letters, numbers, dot, underscore and hyphen.' }, 422);
      }
      /* Registered Gmail/email is what the login-time OTP is sent to
         (see functions/api/admin/login.js), so it is required for every
         newly created team member — not optional the way it was when
         email only existed for later self-service verification. */
      if (!isNonEmptyString(body.email, 200) || body.email.indexOf('@') === -1) {
        return json(env, { error: 'A valid Gmail/email is required.' }, 422);
      }
      var email = String(body.email).trim().toLowerCase();

      /* Password is REQUIRED at creation — the CEO/Assistant CEO/Area
         Manager creating this account must set it explicitly. No
         auto-generation fallback: an account the creator never actually
         set a password for is exactly the gap that would let the
         username+password+email+OTP login flow start from a password
         nobody chose. reset-password (below) still generates one, which
         is the correct place for that — a RESET is explicitly requested,
         a CREATE must not be silently substituted. */
      if (!isNonEmptyString(body.password, 200)) {
        return json(env, { error: 'A password is required to create a team member.' }, 422);
      }
      var weak = validatePasswordStrength(body.password);
      if (weak) return json(env, { error: weak }, 422);

      var pw = await hashPassword(body.password);
      var ins = await db.from('admin_users').insert({
        username: String(body.username).trim().toLowerCase(),
        full_name: body.fullName,
        email: email,
        role: role,
        frozen_role: FROZEN_ROLE[role],
        password_hash: pw.hash, password_salt: pw.salt, password_algo: pw.algo,
        must_change_password: true,
        created_by: auth.user.id,
        status: 'active'
      }).select('id, username').single();

      if (ins.error) {
        if (String(ins.error.message || '').indexOf('uq_admin_users_username') > -1) {
          return json(env, { error: 'That username is already taken.' }, 409);
        }
        if (String(ins.error.message || '').indexOf('uq_admin_users_email') > -1) {
          return json(env, { error: 'That email is already registered to another account.' }, 409);
        }
        throw ins.error;
      }

      await audit('create_user', 'admin_user', ins.data.id, { role: role, username: ins.data.username });

      /* No temporaryPassword in this response — the CEO/manager set the
         password themselves, so there is nothing generated to echo back.
         The password itself is never stored in readable form or written
         to the audit detail. */
      return json(env, { ok: true, userId: ins.data.id, username: ins.data.username }, 201);
    }

    /* ── update (edit allowed profile fields) ─────────────────────────── */
    if (body.action === 'update') {
      if (!can(auth.user.role, 'users.edit')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var editTarget = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (editTarget.error) throw editTarget.error;
      if (!editTarget.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, editTarget.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var patchFields = {};
      if (body.fullName != null) {
        if (!isNonEmptyString(body.fullName, 160)) return json(env, { error: 'fullName cannot be empty.' }, 422);
        patchFields.full_name = body.fullName;
      }
      if (body.email != null) {
        if (!isNonEmptyString(body.email, 200) || body.email.indexOf('@') === -1) {
          return json(env, { error: 'A valid email is required.' }, 422);
        }
        patchFields.email = String(body.email).trim().toLowerCase();
        patchFields.email_verified_at = null;
      }
      if (!Object.keys(patchFields).length) {
        return json(env, { error: 'Nothing to update.' }, 422);
      }

      var editUpd = await db.from('admin_users').update(patchFields).eq('id', body.userId);
      if (editUpd.error) {
        if (String(editUpd.error.message || '').indexOf('uq_admin_users_email') > -1) {
          return json(env, { error: 'That email is already registered to another account.' }, 409);
        }
        throw editUpd.error;
      }

      await audit('update_user', 'admin_user', body.userId, { fields: Object.keys(patchFields), username: editTarget.data.username });
      return json(env, { ok: true });
    }

    /* ── set-status (disable / enable / archive) ─────────────────────── */
    if (body.action === 'set-status') {
      if (!can(auth.user.role, 'users.toggle_status')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);
      if (['active', 'disabled', 'archived'].indexOf(body.status) === -1) {
        return json(env, { error: "status must be 'active', 'disabled' or 'archived'." }, 422);
      }
      if (body.userId === auth.user.id) {
        return json(env, { error: 'You cannot change your own status.' }, 403);
      }

      var target = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, target.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var patch = { status: body.status };
      if (body.status === 'archived') patch.archived_at = new Date().toISOString();

      var upd = await db.from('admin_users').update(patch).eq('id', body.userId);
      if (upd.error) throw upd.error;

      /* Revocation must be immediate, not at cookie expiry — a disabled
         user loses access on their next request (session.resolveSession
         re-checks status on every call, this kills the token outright). */
      if (body.status !== 'active') await revokeAllUserSessions(env, body.userId);

      await audit('set_user_status', 'admin_user', body.userId,
        { status: body.status, username: target.data.username });
      return json(env, { ok: true });
    }

    /* ── reset-password ─────────────────────────────────────────────── */
    if (body.action === 'reset-password') {
      if (!can(auth.user.role, 'users.reset_password')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var t = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, t.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var temp = generateTempPassword();
      var newPw = await hashPassword(temp);
      var r = await db.from('admin_users').update({
        password_hash: newPw.hash, password_salt: newPw.salt, password_algo: newPw.algo,
        must_change_password: true
      }).eq('id', body.userId);
      if (r.error) throw r.error;

      await revokeAllUserSessions(env, body.userId);
      await audit('reset_password', 'admin_user', body.userId, { username: t.data.username });

      return json(env, { ok: true, temporaryPassword: temp });
    }

    return json(env, { error: "action must be 'create', 'update', 'set-status' or 'reset-password'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'User request failed.' }, 500);
  }
}
