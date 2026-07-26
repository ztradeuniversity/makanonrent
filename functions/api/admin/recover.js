/* POST /api/admin/recover — public (no session), for forgot-password.
   { action:'request', username } / { action:'reset', username, code, newPassword }
   Reuses hashToken (session.js), hashPassword/validatePasswordStrength
   (password.js), revokeAllUserSessions — no new crypto. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { hashToken, revokeAllUserSessions } from '../../utils/session.js';
import { hashPassword, validatePasswordStrength } from '../../utils/password.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) { return preflight(context.env); }

function genCode() {
  var n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try { body = await context.request.json(); } catch (e) { return json(env, { error: 'Request body must be valid JSON.' }, 400); }
  if (!isNonEmptyString(body.username, 60)) return json(env, { error: 'username is required.' }, 422);

  try {
    var db = getServiceClient(env);
    var username = String(body.username).trim().toLowerCase();
    var u = await db.from('admin_users').select('id, email, status').eq('username', username).maybeSingle();

    if (body.action === 'request') {
      /* Same response regardless of match/email/status — never lets a
         caller enumerate valid usernames (matches login.js's posture). */
      if (u.data && u.data.email && u.data.status === 'active') {
        var code = genCode();
        var ins = await db.from('admin_email_otp').insert({
          admin_user_id: u.data.id, email: u.data.email, code_hash: await hashToken(code),
          purpose: 'password_reset', expires_at: new Date(Date.now() + 10 * 60000).toISOString()
        }).select('id').single();
        if (!ins.error) {
          await db.from('email_delivery_queue').insert({
            to_email: u.data.email, template: 'admin_password_reset', payload: { code: code }
          });
        }
      }
      return json(env, { ok: true, message: 'If that account has an email on file, a code was sent.' });
    }

    if (body.action === 'reset') {
      if (!u.data) return json(env, { error: 'Invalid code or username.' }, 401);
      if (!isNonEmptyString(body.code, 10)) return json(env, { error: 'code is required.' }, 422);
      var weak = validatePasswordStrength(body.newPassword);
      if (weak) return json(env, { error: weak }, 422);

      var row = await db.from('admin_email_otp')
        .select('id, expires_at, consumed_at')
        .eq('admin_user_id', u.data.id).eq('purpose', 'password_reset').eq('code_hash', await hashToken(body.code))
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!row.data || row.data.consumed_at || new Date(row.data.expires_at) < new Date()) {
        return json(env, { error: 'Invalid or expired code.' }, 401);
      }

      var pw = await hashPassword(body.newPassword);
      await db.from('admin_users').update({
        password_hash: pw.hash, password_salt: pw.salt, password_algo: pw.algo, must_change_password: false
      }).eq('id', u.data.id);
      await db.from('admin_email_otp').update({ consumed_at: new Date().toISOString() }).eq('id', row.data.id);
      await revokeAllUserSessions(env, u.data.id);
      await logAudit(env, { actorId: u.data.id, actorRole: null, action: 'password_reset_via_otp', entityType: 'admin_user', entityId: u.data.id, request: context.request });
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be 'request' or 'reset'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Recovery failed.' }, 500);
  }
}
