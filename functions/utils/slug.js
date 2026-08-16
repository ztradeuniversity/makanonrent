/* MakanOnRent — node_id/slug generation (Cloudflare Pages Functions).

   The ONE server-side copy of the rule, previously duplicated verbatim
   in functions/api/locations/publish.js and cities.js. It must stay
   byte-identical in behaviour to slugify() in web/assets/js/
   location-engine.js: the browser derives a node id locally and the
   server derives it again from the same name, and a publish only lands
   on the right parent when both produce the same string.

   The FNV-1a fallback exists because the ASCII-only rule strips a wholly
   non-Latin name (Urdu, Arabic, Chinese…) to the empty string, which
   produced degenerate ids like 'lahore/' that were identical for every
   such name in a city. */
export function slugify(v) {
  var s = String(v).toLowerCase().trim()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s) return s;
  var str = String(v).trim();
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 'loc-' + h.toString(36);
}
