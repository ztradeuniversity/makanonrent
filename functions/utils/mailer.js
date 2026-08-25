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

/* Role → the exact display label the CEO/Assistant CEO/Area Manager
   assignment emails use, shared across every template below so "CEO",
   "Assistant CEO" and "Area Manager" are spelled identically everywhere
   an assignment email mentions who did the assigning. */
var ASSIGN_ROLE_LABEL = { ceo: 'CEO', assistant_ceo: 'Assistant CEO', manager: 'Area Manager', field_officer: 'Field Officer' };

/* "CEO Zubair has assigned an area to you." / "Your Assistant CEO, Maria
   Rani, has assigned this work to you." / "Your Area Manager, Muhammad
   Jan, has assigned an area to you." — one sentence, reused by BOTH the
   area and task assignment templates (assignment-wiring pass, audited
   2026-08-25) so the phrasing can never drift between the two emails.
   `thing` is "an area" or "this work" — the only difference between the
   two callers. CEO gets the plain "CEO [Name]" form (there is no "Your
   CEO" — everyone reports to the CEO); Assistant CEO/Manager get the
   "Your <role>, [Name]," form the brief specifies verbatim. */
function assignerIntro(assignerName, assignerRole, thing) {
  var name = assignerName || 'MakanOnRent management';
  if (assignerRole === 'ceo') return 'CEO ' + name + ' has assigned ' + thing + ' to you.';
  var label = ASSIGN_ROLE_LABEL[assignerRole] || 'Your manager';
  return 'Your ' + label + ', ' + name + ', has assigned ' + thing + ' to you.';
}

export function renderTemplate(template, payload) {
  if (template === 'admin_otp_email_verify' || template === 'admin_otp_password_reset' || template === 'admin_password_reset' || template === 'admin_otp_login') {
    return { subject: 'Your MakanOnRent verification code', text: 'Your code is ' + payload.code + '. Expires in ' + (payload.expiresInMinutes || 10) + ' minutes.' };
  }
  if (template === 'admin_task_assigned') {
    var l = [
      'Hi ' + (payload.recipientName || 'there') + ',',
      '',
      assignerIntro(payload.assignedByName, payload.assignedByRole, 'this work'),
      '',
      'Task: ' + (payload.title || 'Task'),
      'Task type: ' + (payload.taskType || '—')
    ];
    if (payload.areaName) l.push('Area: ' + payload.areaName);
    if (payload.notes) l.push('Instructions: ' + payload.notes);
    l.push('Due: ' + (payload.dueDate || '—'));
    l.push('', 'Assigned by: ' + (payload.assignedByName || 'MakanOnRent management') +
      (payload.assignedByRole ? ' — ' + (ASSIGN_ROLE_LABEL[payload.assignedByRole] || payload.assignedByRole) : ''));
    l.push('Assigned at: ' + (payload.assignedAt || '—'));
    l.push('', 'Please check your MakanOnRent dashboard for the complete task and instructions.');
    return { subject: 'New task assigned: ' + (payload.title || 'Task'), text: l.join('\n') };
  }
  if (template === 'area_assigned') {
    /* Assignment-wiring pass (audited 2026-08-25): area assignment/
       delegation NEVER sent an email at all — confirmed root cause,
       there was no template and no sendQueuedEmail() call anywhere in
       assignments.js. This is the new template; the send site is in
       assignments.js. */
    var al = [
      'Hi ' + (payload.recipientName || 'there') + ',',
      '',
      assignerIntro(payload.assignedByName, payload.assignedByRole, 'an area'),
      '',
      'Area: ' + (payload.areaName || payload.nodeId || 'an area'),
      'Assigned at: ' + (payload.assignedAt || '—'),
      '',
      'Assigned by: ' + (payload.assignedByName || 'MakanOnRent management') +
        (payload.assignedByRole ? ' — ' + (ASSIGN_ROLE_LABEL[payload.assignedByRole] || payload.assignedByRole) : ''),
      '',
      'Please check your MakanOnRent dashboard for the full details and next actions.'
    ];
    return { subject: 'New area assigned — MakanOnRent', text: al.join('\n') };
  }
  if (template === 'owner_property_published') {
    var pl = [
      'Hi ' + (payload.ownerName || 'there') + ',',
      '',
      'Good news — your property listing on MakanOnRent has been approved and is now live.'
    ];
    if (payload.reference) pl.push('', 'Reference: ' + payload.reference);
    if (payload.title) pl.push('Listing: ' + payload.title);
    if (payload.locationName) pl.push('Location: ' + payload.locationName);
    if (payload.url) pl.push('', 'View your live listing: ' + payload.url);
    pl.push('', 'Thank you for listing with MakanOnRent.');
    return { subject: 'Your property is now live on MakanOnRent', text: pl.join('\n') };
  }
  if (template === 'owner_property_rejected' || template === 'owner_property_returned') {
    var isReturned = template === 'owner_property_returned';
    var rl = [
      'Hi ' + (payload.ownerName || 'there') + ',',
      '',
      isReturned
        ? 'Your property listing on MakanOnRent needs a correction before it can continue through review.'
        : 'Your property listing on MakanOnRent was not approved.'
    ];
    if (payload.reference) rl.push('', 'Reference: ' + payload.reference);
    if (payload.title) rl.push('Listing: ' + payload.title);
    if (payload.reason) rl.push('', (isReturned ? 'What needs to change: ' : 'Reason: ') + payload.reason);
    rl.push('', isReturned
      ? 'Once corrected, your listing will continue through review — no need to resubmit from scratch.'
      : 'If you believe this is a mistake, you can contact MakanOnRent for clarification.');
    return {
      subject: isReturned ? 'Action needed on your MakanOnRent listing' : 'Update on your MakanOnRent listing',
      text: rl.join('\n')
    };
  }
  if (template === 'ceo_message') {
    var ml = [
      'Hi ' + (payload.recipientName || 'there') + ',',
      '',
      'MESSAGE FROM CEO' + (payload.messageType ? ' — ' + payload.messageType : ''),
      '',
      payload.body || ''
    ];
    return { subject: 'Message from CEO' + (payload.messageType ? ' — ' + payload.messageType : ''), text: ml.join('\n') };
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
