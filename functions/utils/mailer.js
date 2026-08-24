/* Minimal Resend HTTP sender — no SDK/dependency, plain fetch, same
   style as functions/utils/r2.js. Credentials read from env only. */
import { requireEnv } from './env.js';

export async function sendEmail(env, to, subject, text) {
  requireEnv(env, ['RESEND_API_KEY', 'EMAIL_FROM']);
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: subject, text: text })
  });
  if (!res.ok) throw new Error('Resend send failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return true;
}

/* Root cause of "OTP/task email never arrives" (audited 2026-08-24):
   every caller only ever INSERTED into email_delivery_queue. Nothing
   consumes that queue in production — email-worker.js is a Cloudflare
   Pages Function, which has no scheduled() entrypoint of its own, and no
   Cron Trigger/companion Worker was ever configured to call it (confirmed
   live: a real OTP row sat in the queue with attempts=0, sent_at=null).
   That gap is real infrastructure the CEO/ops must set up (see the final
   report), but OTP and task-assignment mail are time-sensitive and must
   not depend on it existing. sendQueuedEmail() closes the gap the
   MINIMUM way: keep the exact same queue row (audit trail + a target for
   the worker once it exists) but also attempt real, synchronous delivery
   right now via the SAME sendEmail()/renderTemplate() this file already
   had — no second mailer, no second queue, no second send path. */
export async function sendQueuedEmail(env, db, opts) {
  var toEmail = opts.toEmail, template = opts.template, payload = opts.payload || {};

  var ins = await db.from('email_delivery_queue').insert({
    to_email: toEmail, template: template, payload: payload
  }).select('id').single();
  var queueId = (!ins.error && ins.data) ? ins.data.id : null;

  try {
    var tpl = renderTemplate(template, payload);
    await sendEmail(env, toEmail, tpl.subject, tpl.text);
    if (queueId) {
      await db.from('email_delivery_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', queueId);
    }
    return { sent: true };
  } catch (e) {
    var message = (e && e.message) || 'send failed';
    /* Leaves the row 'failed' rather than 'pending' so a future cron
       sweep does not just repeat the same failure silently forever —
       failed sends need the same human attention a stuck queue would
       have needed, not automatic retry into the same error. */
    if (queueId) {
      await db.from('email_delivery_queue')
        .update({ status: 'failed', last_error: message.slice(0, 500), attempts: 1 })
        .eq('id', queueId);
    }
    return { sent: false, error: message };
  }
}

export function renderTemplate(template, payload) {
  if (template === 'admin_otp_email_verify' || template === 'admin_otp_password_reset' || template === 'admin_password_reset' || template === 'admin_otp_login') {
    return { subject: 'Your MakanOnRent verification code', text: 'Your code is ' + payload.code + '. Expires in ' + (payload.expiresInMinutes || 10) + ' minutes.' };
  }
  if (template === 'admin_task_assigned') {
    var l = [
      'Hi ' + (payload.recipientName || 'there') + ',',
      '',
      'You have been assigned a new task on MakanOnRent (' + (payload.roleLabel || 'Team') + ').',
      '',
      'Task: ' + (payload.title || 'Task'),
      'Target: ' + (payload.targetCount != null ? payload.targetCount : '—'),
      'Due: ' + (payload.dueDate || '—')
    ];
    if (payload.areaName) l.push('Area: ' + payload.areaName);
    if (payload.notes) l.push('', 'Instructions: ' + payload.notes);
    l.push('', 'Assigned by: ' + (payload.assignedByName || 'MakanOnRent management'));
    l.push('', 'Sign in to your dashboard to see the full details and log your progress.');
    return { subject: 'New task assigned: ' + (payload.title || 'Task'), text: l.join('\n') };
  }
  if (template === 'notify_available') {
    var lines = [
      'Good news — a verified property matching what you asked for is now available on MakanOnRent.',
      ''
    ];
    if (payload.reference) lines.push('Reference: ' + payload.reference);
    if (payload.url) lines.push('View it here: ' + payload.url);
    lines.push('', 'You are receiving this because you asked to be notified when a suitable property was listed.');
    return { subject: 'A property matching your search is now available', text: lines.join('\n') };
  }
  return { subject: 'MakanOnRent notification', text: JSON.stringify(payload || {}) };
}
