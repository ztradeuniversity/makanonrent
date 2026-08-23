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

export function renderTemplate(template, payload) {
  if (template === 'admin_otp_email_verify' || template === 'admin_otp_password_reset' || template === 'admin_password_reset' || template === 'admin_otp_login') {
    return { subject: 'Your MakanOnRent verification code', text: 'Your code is ' + payload.code + '. Expires in ' + (payload.expiresInMinutes || 10) + ' minutes.' };
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
