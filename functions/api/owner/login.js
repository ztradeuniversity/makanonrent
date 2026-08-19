/* GET /api/owner/login → 302 to Google, via Supabase Auth.

   Step one of the PKCE flow. The verifier is generated here, kept in a
   short-lived HttpOnly cookie, and never leaves the server in readable
   form; only its SHA-256 challenge is sent upstream. That is what stops a
   stolen authorization code from being redeemed by anyone else.

   `next` lets the caller say where to land afterwards (the wizard sends
   the owner back to Submit Property, the dashboard link sends them to My
   Properties). It is deliberately restricted to a path on this site — an
   open redirect here would let a phishing page borrow our domain. */
import { json, preflight } from '../../utils/cors.js';
import { createPkce, verifierCookie, authorizeUrl } from '../../utils/owner-auth.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestGet(context) {
  var env = context.env;

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SITE_URL) {
    return json(env, { error: 'Owner sign-in is not configured on this deployment.' }, 503);
  }

  var next = new URL(context.request.url).searchParams.get('next') || '/dashboard.html';
  /* Same-site paths only: must start with a single '/', and '//host' is
     a protocol-relative URL to somewhere else entirely. */
  if (next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard.html';

  try {
    var pkce = await createPkce();
    var headers = new Headers();
    headers.append('Set-Cookie', verifierCookie(pkce.verifier));
    /* Where to land after the callback, carried in its own short-lived
       cookie rather than in the redirect_to URL — Supabase must be given
       one fixed, allow-listed redirect target. */
    headers.append('Set-Cookie',
      'mor_owner_next=' + encodeURIComponent(next) +
      '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
    headers.set('Location', authorizeUrl(env, pkce.challenge));
    headers.set('Cache-Control', 'no-store');

    return new Response(null, { status: 302, headers: headers });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not start sign-in.' }, 500);
  }
}
