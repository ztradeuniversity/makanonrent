/* POST /api/locations/publish
   Durable sync for the Location Data Bank. location-manager.html has
   already applied the publish locally (so search updates instantly);
   this persists it so other devices and a fresh browser get the same
   data. Upserts by node_id, so re-publishing an area updates it rather
   than creating a duplicate.

   Request:  { bank: { version, entries: [{ cityId, citySlug, cityName,
                                            main, subs[] }] } }
   Response: { synced: true, mainAreas, subAreas }

   ⚠ ADMIN AUTH IS NOT IMPLEMENTED. There is no auth system in the
   project yet (the Submit Wizard's Google step is still a frontend
   stub), so this endpoint is currently unauthenticated. Do NOT expose
   the deployed URL publicly until Cloudflare Access — or an equivalent
   check — is placed in front of /api/locations/publish. See the
   report's "Manual steps" for the exact one-time setup. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

function slugify(v) {
  return String(v).toLowerCase().trim()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var bank = body && body.bank;
  if (!bank || !Array.isArray(bank.entries)) {
    return json(env, { error: 'bank.entries is required.' }, 422);
  }

  var db = getServiceClient(env);
  var rows = [];
  var mainCount = 0, subCount = 0;

  for (var i = 0; i < bank.entries.length; i++) {
    var e = bank.entries[i];
    if (!isNonEmptyString(e.cityId, 200) || !isNonEmptyString(e.main, 160)) continue;

    var mainSlug = slugify(e.main);
    var mainNode = e.cityId + '/' + mainSlug;

    rows.push({
      node_id: mainNode, parent_node_id: e.cityId, name: e.main,
      slug: mainSlug, type: 'locality', status: 'approved',
      active: true, sort_order: 0, source: 'bank'
    });
    mainCount++;

    (e.subs || []).forEach(function (subName, si) {
      if (!isNonEmptyString(subName, 160)) return;
      var subSlug = slugify(subName);
      rows.push({
        node_id: mainNode + '/' + subSlug, parent_node_id: mainNode,
        name: subName, slug: subSlug, type: 'subarea', status: 'approved',
        active: true, sort_order: si, source: 'bank'
      });
      subCount++;
    });
  }

  if (!rows.length) return json(env, { error: 'Nothing publishable in bank.entries.' }, 422);

  try {
    /* Parents must exist before children (FK on parent_node_id), so
       cities/main areas are written before sub areas. */
    var mains = rows.filter(function (r) { return r.type === 'locality'; });
    var subs = rows.filter(function (r) { return r.type === 'subarea'; });

    var r1 = await db.from('locations').upsert(mains, { onConflict: 'node_id' });
    if (r1.error) throw r1.error;

    if (subs.length) {
      /* Chunked so a very large city (5,000+ sub areas) never exceeds
         the request size limit. */
      for (var s = 0; s < subs.length; s += 500) {
        var chunk = subs.slice(s, s + 500);
        var r2 = await db.from('locations').upsert(chunk, { onConflict: 'node_id' });
        if (r2.error) throw r2.error;
      }
    }

    return json(env, { synced: true, mainAreas: mainCount, subAreas: subCount });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Publish failed.' }, 500);
  }
}
