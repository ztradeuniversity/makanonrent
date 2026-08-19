/* GET /api/owner/callback?code=… → completes sign-in, then redirects.

   Step two of PKCE. Exchanges the one-time code for a Supabase session
   using the verifier held in the cookie, binds the verified identity to
   the existing contacts record, and sets the owner session cookie.

   Everything about the identity comes from the exchange response — the
   query string is trusted for exactly one thing, the opaque code, and
   even that is worthless without the verifier cookie from this browser. */
import { json } from '../../utils/cors.js';
import {
  readCookie, VERIFIER_COOKIE, exchangeCode, sessionCookie,
  resolveOwner, contactForOwner
} from '../../utils/owner-auth.js';

function redirect(to, cookies) {
  var headers = new Headers();
  headers.set('Location', to);
  headers.set('Cache-Control', 'no-store');
  (cookies || []).forEach(function (c) { headers.append('Set-Cookie', c); });
  return new Response(null, { status: 302, headers: headers });
}

var DROP_VERIFIER = VERIFIER_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
var DROP_NEXT = 'mor_owner_next=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export async function onRequestGet(context) {
  var env = context.env;
  var url = new URL(context.request.url);

  var next = readCookie(context.request, 'mor_owner_next');
  next = next ? decodeURIComponent(next) : '/dashboard.html';
  if (next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard.html';

  /* The provider can refuse, and the owner can cancel. Neither is an
     error worth a stack trace — send them back with a flag the page can
     explain in its own words. */
  var providerError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (providerError) return redirect(next + '?signin=cancelled', [DROP_VERIFIER, DROP_NEXT]);

  var code = url.searchParams.get('code');
  var verifier = readCookie(context.request, VERIFIER_COOKIE);
  if (!code || !verifier) return redirect(next + '?signin=failed', [DROP_VERIFIER, DROP_NEXT]);

  try {
    var ex = await exchangeCode(env, code, verifier);
    if (!ex.ok) return redirect(next + '?signin=failed', [DROP_VERIFIER, DROP_NEXT]);

    var cookie = sessionCookie(ex.tokens);

    /* Re-resolve through the same guard every protected route uses,
       rather than trusting the exchange payload directly — one code path
       decides what a valid owner is. */
    var owner = await resolveOwner(env, {
      headers: { get: function (n) { return n === 'Cookie' ? cookie.split(';')[0] : null; } }
    });
    if (!owner) return redirect(next + '?signin=failed', [DROP_VERIFIER, DROP_NEXT]);

    /* Links the identity to the existing contact record (claiming an
       unlinked one with the same verified address, or creating it). */
    await contactForOwner(env, owner);

    return redirect(next + '?signin=ok', [cookie, DROP_VERIFIER, DROP_NEXT]);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Sign-in failed.' }, 500);
  }
}
