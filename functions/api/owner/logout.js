/* POST /api/owner/logout → clears the owner session.

   Tells GoTrue to revoke the refresh token as well as dropping the
   cookie: clearing the cookie alone would leave a token that still works
   for anyone who captured it. A failure upstream never blocks the local
   sign-out — the browser must end up signed out either way. */
import { corsHeaders, preflight } from '../../utils/cors.js';
import { readCookie, OWNER_COOKIE, clearedCookies } from '../../utils/owner-auth.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestPost(context) {
  var env = context.env;
  var raw = readCookie(context.request, OWNER_COOKIE);

  if (raw && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      var pad = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (pad.length % 4) pad += '=';
      var session = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(pad), function (c) { return c.charCodeAt(0); })));
      if (session && session.a) {
        await fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/logout', {
          method: 'POST',
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.a }
        });
      }
    } catch (e) { /* the cookie is cleared regardless */ }
  }

  /* Built with append rather than an object literal: two Set-Cookie
     headers cannot share one key. */
  var h = new Headers(Object.assign(
    { 'Content-Type': 'application/json' }, corsHeaders(env)));
  clearedCookies().forEach(function (c) { h.append('Set-Cookie', c); });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}
