/* GET  /api/admin/me           → the signed-in identity, its capabilities
                                   and its assigned areas
   POST /api/admin/me           → { action: 'change-password',
                                    currentPassword, newPassword }

   The GET response is what every admin page boots from: it decides which
   dashboard to render and which controls to show. Those controls are a
   COURTESY — Doc 18 Article 9.1, "UI hiding is never the control." Every
   endpoint re-checks the same capability server-side. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, PERMISSIONS, can } from '../../utils/rbac.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password.js';
import { revokeAllUserSessions, createSession, buildSetCookie } from '../../utils/session.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

function capabilitiesFor(role) {
  return Object.keys(PERMISSIONS).filter(function (cap) { return can(role, cap); });
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var areas = { data: [] };

    if (auth.user.role !== 'ceo') {
      areas = await db.from('admin_area_assignments')
        .select('node_id, scope_level, locations!inner(name)')
        .eq('user_id', auth.user.id)
        .eq('active', true);
      if (areas.error) throw areas.error;
    }

    return json(env, {
      user: {
        id: auth.user.id,
        username: auth.user.username,
        fullName: auth.user.full_name,
        role: auth.user.role,
        frozenRole: auth.user.frozen_role,
        mustChangePassword: auth.user.must_change_password
      },
      capabilities: capabilitiesFor(auth.user.role),
      /* null = global authority (CEO). An empty array means a scoped user
         with nothing assigned yet — a real and different state, which is
         why these are not collapsed into one representation. */
      areas: auth.user.role === 'ceo' ? null : (areas.data || []).map(function (a) {
        return { nodeId: a.node_id, level: a.scope_level, name: a.locations && a.locations.name };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load your profile.' }, 500);
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

  if (body.action !== 'change-password') {
    return json(env, { error: "action must be 'change-password'." }, 422);
  }
  if (!isNonEmptyString(body.currentPassword, 200)) {
    return json(env, { error: 'currentPassword is required.' }, 422);
  }
  var weak = validatePasswordStrength(body.newPassword);
  if (weak) return json(env, { error: weak }, 422);
  if (body.currentPassword === body.newPassword) {
    return json(env, { error: 'The new password must differ from the current one.' }, 422);
  }

  try {
    var db = getServiceClient(env);
    var res = await db.from('admin_users')
      .select('id, password_hash, password_salt, password_algo')
      .eq('id', auth.user.id).single();
    if (res.error) throw res.error;

    if (!await verifyPassword(body.currentPassword, res.data)) {
      await logAudit(env, {
        actorId: auth.user.id, actorRole: auth.user.role, action: 'password_change_failed',
        entityType: 'admin_user', entityId: auth.user.id, request: context.request
      });
      return json(env, { error: 'Your current password is incorrect.' }, 403);
    }

    var pw = await hashPassword(body.newPassword);
    var upd = await db.from('admin_users').update({
      password_hash: pw.hash, password_salt: pw.salt, password_algo: pw.algo,
      must_change_password: false
    }).eq('id', auth.user.id);
    if (upd.error) throw upd.error;

    /* Changing a password invalidates every other session for this user
       — the standard containment behaviour if the old one leaked. The
       caller then gets a fresh session so they are not logged out of the
       tab they just changed it in. */
    await revokeAllUserSessions(env, auth.user.id);
    var session = await createSession(env, auth.user.id, context.request);

    await logAudit(env, {
      actorId: auth.user.id, actorRole: auth.user.role, action: 'password_changed',
      entityType: 'admin_user', entityId: auth.user.id, request: context.request
    });

    return jsonWithHeaders(env, { ok: true }, 200, { 'Set-Cookie': buildSetCookie(session.token) });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Password change failed.' }, 500);
  }
}
