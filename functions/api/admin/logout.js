/* POST /api/admin/logout
   Revokes the current session server-side AND clears the cookie. Both
   matter: clearing only the cookie would leave a live token row that
   still authenticates if the value was captured. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { revokeSession, buildClearCookie } from '../../utils/session.js';
import { resolveSession } from '../../utils/session.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestPost(context) {
  var env = context.env;
  try {
    var session = await resolveSession(env, context.request);
    await revokeSession(env, context.request);

    if (session) {
      await logAudit(env, {
        actorId: session.user.id, actorRole: session.user.role, action: 'logout',
        entityType: 'admin_user', entityId: session.user.id, request: context.request
      });
    }
    /* Always reports success: logging out an already-invalid session is
       not an error condition from the caller's point of view. */
    return jsonWithHeaders(env, { ok: true }, 200, { 'Set-Cookie': buildClearCookie() });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Logout failed.' }, 500);
  }
}
