/* POST /api/locations/cities
   Durable sync for City Management (Location Manager's "Manage Cities"
   panel — Add / Rename / Disable / Enable / Delete). location-manager.js
   has already applied the change locally via MOR_LOC (so the admin's UI
   never waits on the network); this makes it durable and cross-device.

   Cities are ROOT rows: node_id === slug, parent_node_id NULL — must
   match the flat scheme migrations/0003_city_seed.sql seeds, or every
   Main Location publish would FK-fail against a parent that doesn't
   exist (see location-fixture.js's header comment for the same note
   on the frontend side).

   Request:  { action: 'add' | 'rename' | 'disable' | 'enable' | 'delete', name?, nodeId? }
     add:     { action:'add', name }           → creates/refreshes a city
     rename:  { action:'rename', nodeId, name } → display name only,
                                                    node_id/slug never change
     disable: { action:'disable', nodeId }      → active=false, status='disabled';
                                                    hides it (and reads through it)
                                                    everywhere without touching its
                                                    Main/Sub Locations
     enable:  { action:'enable', nodeId }       → reverses disable
     delete:  { action:'delete', nodeId }       → ONLY if the city has zero
                                                    Main/Sub Location rows; refused
                                                    (409) otherwise — disable is the
                                                    correct action for a city that
                                                    still has data under it
   Response: { ok: true, ... } or { error, childCount? }

   ⚠ ADMIN AUTH IS NOT IMPLEMENTED — same caveat as publish.js/suggest.js.
   Do not expose this endpoint publicly until it sits behind Cloudflare
   Access or an equivalent check. */
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

/* GET /api/locations/cities
   The durable City master list — every city seeded by migrations/
   0003_city_seed.sql PLUS every city added since through this admin
   panel. This is what lets Step 1's picker and the Manage Cities panel
   show the full district+tehsil bank instead of only the handful of
   cities hardcoded in pk-locations.js/location-fixture.js (the old,
   pre-Data-Bank seed). Includes disabled cities too — the admin needs
   to see them here to re-enable. Never exposes any other type. */
export async function onRequestGet(context) {
  var env = context.env;
  try {
    var db = getServiceClient(env);
    var res = await db
      .from('locations')
      .select('node_id, name, slug, active')
      .eq('type', 'city')
      .order('name', { ascending: true });
    if (res.error) throw res.error;

    var cities = (res.data || []).map(function (r) {
      return { nodeId: r.node_id, name: r.name, slug: r.slug, active: !!r.active };
    });
    return json(env, { cities: cities });
  } catch (e) {
    /* Same degrade-gracefully contract as GET /api/locations: a missing
       table/secret falls back to whatever the browser already has
       (fixture + localStorage), never a broken page. */
    return json(env, { cities: [], warning: (e && e.message) || 'unavailable' }, 200);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var db = getServiceClient(env);
  var action = body && body.action;

  try {
    if (action === 'add') {
      if (!isNonEmptyString(body.name, 120)) return json(env, { error: 'name is required.' }, 422);
      var slug = slugify(body.name);
      if (!slug) return json(env, { error: 'That name has no usable characters.' }, 422);

      var res = await db.from('locations').upsert({
        node_id: slug, parent_node_id: null, name: body.name, slug: slug,
        type: 'city', status: 'approved', active: true, sort_order: 0, source: 'bank'
      }, { onConflict: 'node_id' });
      if (res.error) throw res.error;
      return json(env, { ok: true, nodeId: slug }, 201);
    }

    if (action === 'rename') {
      if (!isNonEmptyString(body.nodeId, 120)) return json(env, { error: 'nodeId is required.' }, 422);
      if (!isNonEmptyString(body.name, 120)) return json(env, { error: 'name is required.' }, 422);

      /* Display name only — node_id/slug are permanent identifiers that
         property records and Main Location parent_node_ids may already
         reference; renaming must never move them. */
      var upd = await db.from('locations')
        .update({ name: body.name })
        .eq('node_id', body.nodeId)
        .eq('type', 'city');
      if (upd.error) throw upd.error;
      return json(env, { ok: true });
    }

    if (action === 'disable' || action === 'enable') {
      if (!isNonEmptyString(body.nodeId, 120)) return json(env, { error: 'nodeId is required.' }, 422);

      var toggled = await db.from('locations')
        .update(action === 'disable'
          ? { active: false, status: 'disabled' }
          : { active: true, status: 'approved' })
        .eq('node_id', body.nodeId)
        .eq('type', 'city');
      if (toggled.error) throw toggled.error;
      return json(env, { ok: true });
    }

    if (action === 'delete') {
      if (!isNonEmptyString(body.nodeId, 120)) return json(env, { error: 'nodeId is required.' }, 422);

      var count = await db.from('locations')
        .select('node_id', { count: 'exact', head: true })
        .eq('parent_node_id', body.nodeId);
      if (count.error) throw count.error;
      var childCount = count.count || 0;

      /* Delete only if no dependencies — a city with any Main/Sub
         Location rows is always refused. Disable is the correct action
         for a city that still has data under it; there is no cascade
         path here by design. */
      if (childCount > 0) {
        return json(env, {
          error: 'This city has ' + childCount + ' Main/Sub Location row(s). Disable it instead, or delete those rows first.',
          childCount: childCount
        }, 409);
      }

      var del = await db.from('locations').delete().eq('node_id', body.nodeId).eq('type', 'city');
      if (del.error) throw del.error;
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be one of: 'add', 'rename', 'disable', 'enable', 'delete'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'City management request failed.' }, 500);
  }
}
