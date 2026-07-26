/* Catch-all for any /api/* path that does not match a specific Function
   file (e.g. a typo'd route, a retired endpoint, a wrong method on a
   real one). Pages Functions routes exact/more-specific files first, so
   this only ever fires when nothing else matched.

   Without this, Cloudflare Pages' static-asset fallback served the
   homepage with 200 for a wrong API URL — indistinguishable from success
   to any client that only checks res.ok (see the production audit).
   This returns a real 404 JSON response instead. */
import { json, preflight } from '../utils/cors.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequest(context) {
  return json(context.env, { error: 'No such API route.' }, 404);
}
