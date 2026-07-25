/* MakanOnRent — shared response helpers for functions/api/*.
   The site and the API are same-origin under Cloudflare Pages, so this
   is defense-in-depth (blocks other origins from calling the API
   directly), not a requirement for the frontend to work. */

export function corsHeaders(env) {
  var origin = (env && env.SITE_URL) || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

export function json(env, body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(env))
  });
}

export function preflight(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
