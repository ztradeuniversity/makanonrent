/* MakanOnRent — shared response helpers for functions/api/*.
   The site and the API are same-origin under Cloudflare Pages, so this
   is defense-in-depth (blocks other origins from calling the API
   directly), not a requirement for the frontend to work. */

export function corsHeaders(env) {
  var origin = (env && env.SITE_URL) || '*';
  var headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bootstrap-Token',
    'Vary': 'Origin'
  };
  /* The admin console authenticates with an HttpOnly cookie, which a
     browser only sends cross-origin when credentials are allowed — and
     the spec forbids pairing credentials with a wildcard origin. So this
     is set only when SITE_URL pins a real origin; with the wildcard
     default it is omitted rather than sent and silently ignored.
     Same-origin admin requests (the normal case under Pages) never
     consult CORS at all. */
  if (env && env.SITE_URL) headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export function json(env, body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(env))
  });
}

/* Same as json(), plus caller-supplied headers — used by the admin auth
   endpoints, which must attach Set-Cookie alongside the JSON body. */
export function jsonWithHeaders(env, body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      corsHeaders(env),
      extraHeaders || {}
    )
  });
}

export function preflight(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
