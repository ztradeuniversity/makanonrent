/* POST /api/locations/publish
   Durable sync for the Location Data Bank. location-manager.html has
   already applied the publish locally (so search updates instantly);
   this persists it so other devices and a fresh browser get the same
   data. Upserts by node_id, so re-publishing an area updates it rather
   than creating a duplicate.

   Request:  { bank: { version, entries: [{ cityId, citySlug, cityName,
                                            main, subs[] }] } }
   Response: { synced: true, mainAreas, subAreas }

   Requires the 'locations.manage' capability (CEO / Assistant CEO) —
   see functions/utils/rbac.js. Nothing here is reachable anonymously. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireCapability } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

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
  var auth = await requireCapability(context, 'locations.manage');
  if (auth.response) return auth.response;

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

  var rows = [];
  var mainCount = 0, subCount = 0;
  /* The client applies a publish to its local engine (and shows
     "Published") the instant it's clicked, then syncs to this endpoint
     in the background — it never waits for the city's own sync to land
     first. If that city sync hasn't reached the DB yet (or failed),
     the mains upsert below fails its parent_node_id FK and the whole
     publish silently doesn't persist, even though the UI already said
     it worked. Upserting the referenced cities here first closes that
     race without requiring any change to the client's flow. */
  var cities = {};

  for (var i = 0; i < bank.entries.length; i++) {
    var e = bank.entries[i];
    if (!isNonEmptyString(e.cityId, 200) || !isNonEmptyString(e.main, 160)) continue;

    if (isNonEmptyString(e.citySlug, 200) && isNonEmptyString(e.cityName, 160)) {
      cities[e.cityId] = {
        node_id: e.cityId, parent_node_id: null, name: e.cityName,
        slug: e.citySlug, type: 'city', status: 'approved',
        active: true, sort_order: 0, source: 'bank'
      };
    }

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
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);

    /* Parents must exist before children (FK on parent_node_id), so
       cities, then main areas, then sub areas. ignoreDuplicates so an
       already-synced (possibly renamed/disabled) city is never
       clobbered back to its stale name/active state — this step only
       fills in a city that's missing, it never corrects one that's
       already there. */
    var cityRows = Object.keys(cities).map(function (k) { return cities[k]; });
    if (cityRows.length) {
      var r0 = await db.from('locations').upsert(cityRows, { onConflict: 'node_id', ignoreDuplicates: true });
      if (r0.error) throw r0.error;
    }

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

    await auditFor(env, auth.user, context.request)(
      'publish_locations', 'locations_bank', null,
      { mainAreas: mainCount, subAreas: subCount });

    return json(env, { synced: true, mainAreas: mainCount, subAreas: subCount });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Publish failed.' }, 500);
  }
}
