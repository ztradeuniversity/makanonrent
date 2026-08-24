/* POST /api/admin/otp
   { action: 'request', purpose: 'email_verify'|'password_reset', email? }
   { action: 'verify',  purpose, email, code }
   Wires migrations/0007's admin_email_otp + email_delivery_queue to the
   existing session/audit/hash utilities. No new hashing scheme — reuses
   hashToken() (sha256 hex) from session.js, same as session tokens. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth } from '../../utils/rbac.js';
import { hashToken } from '../../utils/session.js';
import { sendQueuedEmail } from '../../utils/mailer.js';
import { logAudit } from '../../utils/audit.js';

export async function onRequestOptions(context) { return preflight(context.env); }

/* Exported so functions/api/admin/login.js can reuse the exact same code
   generator for the login-time OTP step instead of inventing a second one
   — same table (admin_email_otp), same hashing (hashToken), same shape,
   different `purpose` value ('login'). */
export function genCode() {
  var n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var body;
  try { body = await context.request.json(); } catch (e) { return json(env, { error: 'Request body must be valid JSON.' }, 400); }

  if (['email_verify', 'password_reset'].indexOf(body.purpose) === -1) {
    return json(env, { error: "purpose must be 'email_verify' or 'password_reset'." }, 422);
  }

  try {
    var db = getServiceClient(env);

    if (body.action === 'request') {
      var email = isNonEmptyString(body.email, 200) ? body.email : null;
      if (!email) {
        var u = await db.from('admin_users').select('email').eq('id', auth.user.id).maybeSingle();
        email = u.data && u.data.email;
      }
      if (!email) return json(env, { error: 'No email on file to send an OTP to.' }, 422);

      var code = genCode();
      var codeHash = await hashToken(code);
      var ins = await db.from('admin_email_otp').insert({
        admin_user_id: auth.user.id, email: email, code_hash: codeHash,
        purpose: body.purpose, expires_at: new Date(Date.now() + 10 * 60000).toISOString()
      }).select('id').single();
      if (ins.error) throw ins.error;

      /* Synchronous send — see sendQueuedEmail's comment in mailer.js.
         Resend IS wired (functions/utils/mailer.js); the stale comment
         this replaced predates that and was simply wrong. */
      var delivery = await sendQueuedEmail(env, db, {
        toEmail: email, template: 'admin_otp_' + body.purpose,
        payload: { code: code, expiresInMinutes: 10 }
      });

      await logAudit(env, {
        actorId: auth.user.id, actorRole: auth.user.role, action: 'otp_requested',
        entityType: 'admin_user', entityId: auth.user.id,
        detail: { purpose: body.purpose, delivered: delivery.sent, error: delivery.sent ? undefined : delivery.error },
        request: context.request
      });

      if (!delivery.sent) {
        return json(env, { error: 'Could not send the verification code right now. Please try again in a moment.' }, 502);
      }
      return json(env, { ok: true, otpId: ins.data.id });
    }

    if (body.action === 'verify') {
      if (!isNonEmptyString(body.code, 10)) return json(env, { error: 'code is required.' }, 422);
      var codeHash2 = await hashToken(body.code);
      var row = await db.from('admin_email_otp')
        .select('id, admin_user_id, expires_at, consumed_at, attempts')
        .eq('admin_user_id', auth.user.id).eq('purpose', body.purpose).eq('code_hash', codeHash2)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data || row.data.consumed_at || new Date(row.data.expires_at) < new Date()) {
        return json(env, { error: 'Invalid or expired code.' }, 401);
      }
      await db.from('admin_email_otp').update({ consumed_at: new Date().toISOString() }).eq('id', row.data.id);
      await logAudit(env, { actorId: auth.user.id, actorRole: auth.user.role, action: 'otp_verified', entityType: 'admin_user', entityId: auth.user.id, detail: { purpose: body.purpose }, request: context.request });
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be 'request' or 'verify'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'OTP request failed.' }, 500);
  }
}
