/* POST /api/admin/bootstrap
   Creates the FIRST CEO account, once, and then permanently refuses.

   Why this exists at all: migrations/0004_admin_rbac.sql deliberately
   seeds no CEO row, because a password hash committed to git is a
   backdoor that outlives everyone who knew about it. But the console has
   no self-registration path (ADR §5), so without this endpoint there
   would be no way to create the first identity either. This is the
   narrowest possible answer: one account, one role, gated on a secret
   that only the deployer holds, self-disabling afterwards.

   Guards, all of which must pass:
     1. ADMIN_BOOTSTRAP_TOKEN is set in the environment.
     2. The request carries it in X-Bootstrap-Token (constant-time match).
     3. Zero CEO rows currently exist.

   After first use, guard 3 fails forever. Unset ADMIN_BOOTSTRAP_TOKEN
   once you have logged in — see the deployment notes in the ADR.

   Request:  { username, fullName, password }
   Response: { ok: true, userId } */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { hashPassword, validatePasswordStrength } from '../../utils/password.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  var env = context.env;

  if (!env.ADMIN_BOOTSTRAP_TOKEN) {
    return json(env, { error: 'Bootstrap is not enabled on this deployment.' }, 404);
  }
  if (!safeEqual(context.request.headers.get('X-Bootstrap-Token') || '', env.ADMIN_BOOTSTRAP_TOKEN)) {
    return json(env, { error: 'Invalid bootstrap token.' }, 403);
  }

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.username, 60)) return json(env, { error: 'username is required.' }, 422);
  if (!isNonEmptyString(body.fullName, 160)) return json(env, { error: 'fullName is required.' }, 422);
  var weak = validatePasswordStrength(body.password);
  if (weak) return json(env, { error: weak }, 422);

  var db = getServiceClient(env);

  try {
    var existing = await db.from('admin_users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ceo');
    if (existing.error) throw existing.error;
    if ((existing.count || 0) > 0) {
      return json(env, { error: 'A CEO account already exists. Bootstrap is closed.' }, 409);
    }

    var pw = await hashPassword(body.password);
    var res = await db.from('admin_users').insert({
      username: String(body.username).trim().toLowerCase(),
      full_name: body.fullName,
      role: 'ceo',
      frozen_role: 'exec',
      password_hash: pw.hash,
      password_salt: pw.salt,
      password_algo: pw.algo,
      /* The bootstrapper chose this password directly rather than being
         issued a temporary one, so there is nothing to force a change of. */
      must_change_password: false,
      status: 'active'
    }).select('id').single();

    if (res.error) throw res.error;

    await logAudit(env, {
      actorId: res.data.id, actorRole: 'ceo', action: 'bootstrap_ceo',
      entityType: 'admin_user', entityId: res.data.id,
      detail: { username: body.username }, request: context.request
    });

    return json(env, { ok: true, userId: res.data.id }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Bootstrap failed.' }, 500);
  }
}
