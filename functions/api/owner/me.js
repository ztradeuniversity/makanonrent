/* GET /api/owner/me → { signedIn, owner? }

   The page's answer to "who am I". Returns 200 with signedIn:false rather
   than 401 for an anonymous visitor, because not being signed in is a
   normal state for a public page, not an error it should log.

   Only the identity is exposed — never a token, never the auth user id,
   never anything about other people. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { resolveOwner, contactForOwner } from '../../utils/owner-auth.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestGet(context) {
  var env = context.env;

  try {
    var owner = await resolveOwner(env, context.request);
    if (!owner) return json(env, { signedIn: false });

    var contact = await contactForOwner(env, owner);

    var body = {
      signedIn: true,
      owner: {
        name: contact.full_name || owner.name || owner.email,
        email: owner.email,
        phone: contact.phone_e164 || null
      }
    };

    /* A rotated access token has to reach the browser or the next request
       repeats the refresh. */
    return owner.setCookie
      ? jsonWithHeaders(env, body, 200, { 'Set-Cookie': owner.setCookie })
      : json(env, body);
  } catch (e) {
    return json(env, { signedIn: false, error: (e && e.message) || 'Could not read the session.' }, 200);
  }
}
