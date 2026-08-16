/* GET /api/locations
   Returns the published Location Data Bank so any device hydrates the
   same locations the admin published. Approved rows only — pending
   suggestions, rejected and disabled rows are never served publicly.

   Response: { bank: { version, entries: [{ cityId, citySlug, cityName,
                                            main, subs[], publishedAt }] } }
   The shape matches what location-bank.js stores locally, so the
   frontend hydration path is identical whether data came from
   localStorage or from here. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  try {
    var db = getServiceClient(env);

    var res = await db
      .from('locations')
      .select('node_id, parent_node_id, name, slug, type, sort_order, aliases')
      .eq('status', 'approved')
      .eq('active', true)
      .in('type', ['city', 'locality', 'society', 'subarea'])
      .order('sort_order', { ascending: true });

    if (res.error) throw res.error;
    var rows = res.data || [];

    var byNode = {};
    rows.forEach(function (r) { byNode[r.node_id] = r; });

    /* Rebuild main-area entries with their sub areas. */
    var entries = [];
    var mains = rows.filter(function (r) { return r.type === 'locality' || r.type === 'society'; });

    mains.forEach(function (m) {
      var city = byNode[m.parent_node_id];
      if (!city || city.type !== 'city') return;
      var subs = rows
        .filter(function (r) { return r.type === 'subarea' && r.parent_node_id === m.node_id; })
        .map(function (r) { return r.name; });
      entries.push({
        cityId: city.node_id, citySlug: city.slug, cityName: city.name,
        main: m.name, aliases: m.aliases || [], subs: subs, publishedAt: null
      });
    });

    return json(env, { bank: { version: 1, entries: entries } });
  } catch (e) {
    /* The frontend treats any failure as "use the local bank + fixture",
       so a missing table or unset secret degrades to the shipped
       dataset rather than an empty, broken search. */
    return json(env, { bank: { version: 1, entries: [] }, warning: (e && e.message) || 'unavailable' }, 200);
  }
}
