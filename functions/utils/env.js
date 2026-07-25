/* MakanOnRent — server-side env helper (Cloudflare Pages Functions only).
   Never import this from web/assets/js/* — it exists so functions/ fail
   loudly and specifically when a secret is missing, instead of throwing
   an opaque error deep inside a client library. */

export function requireEnv(env, names) {
  var missing = names.filter(function (n) { return !env[n]; });
  if (missing.length) {
    var err = new Error('Missing required environment variable(s): ' + missing.join(', '));
    err.missing = missing;
    throw err;
  }
}

export function jsonError(message, status, extra) {
  var body = Object.assign({ error: message }, extra || {});
  return new Response(JSON.stringify(body), {
    status: status || 400,
    headers: { 'Content-Type': 'application/json' }
  });
}
