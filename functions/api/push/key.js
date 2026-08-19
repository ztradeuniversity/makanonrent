/* GET /api/push/key → { key } — the VAPID PUBLIC key.

   The browser needs this to call pushManager.subscribe(). It is public by
   definition: it is what the push service uses to verify our signature,
   and it is embedded in every subscription request the browser makes.

   Served from the server rather than hardcoded in web/assets/js/config.js
   so that rotating the VAPID pair is an environment change, not a code
   change — and so config.js, which is a public file, never carries a key
   that could be confused for the private one.

   VAPID_PRIVATE_KEY is never read here. */
import { json, preflight } from '../../utils/cors.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestGet(context) {
  var env = context.env;
  if (!env.VAPID_PUBLIC_KEY) {
    /* 503, not 500: push is simply not configured on this deployment, and
       the client treats it as "notifications unavailable" and hides the
       prompt rather than offering something that cannot work. */
    return json(env, { error: 'Push notifications are not configured.' }, 503);
  }
  return json(env, { key: env.VAPID_PUBLIC_KEY });
}
