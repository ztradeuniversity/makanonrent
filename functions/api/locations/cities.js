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

   GET is public/unauthenticated by design — it is how every page's
   Location Engine hydrates the full city list (see location-bank.js
   pullCitiesFromApi()). POST requires the 'locations.manage' capability
   (CEO / Assistant CEO) — see functions/utils/rbac.js. */
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
  var auth = await requireCapability(context, 'locations.manage');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var action = body && body.action;
  var audit = auditFor(env, auth.user, context.request);

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);

    if (action === 'add') {
      if (!isNonEmptyString(body.name, 120)) return json(env, { error: 'name is required.' }, 422);
      var slug = slugify(body.name);
      if (!slug) return json(env, { error: 'That name has no usable characters.' }, 422);

      var res = await db.from('locations').upsert({
        node_id: slug, parent_node_id: null, name: body.name, slug: slug,
        type: 'city', status: 'approved', active: true, sort_order: 0, source: 'bank'
      }, { onConflict: 'node_id' });
      if (res.error) throw res.error;
      await audit('add_city', 'location', slug, { name: body.name });
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
      await audit('rename_city', 'location', body.nodeId, { name: body.name });
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
      await audit(action === 'disable' ? 'disable_city' : 'enable_city', 'location', body.nodeId, null);
      return json(env, { ok: true });
    }

    if (action === 'delete') {
      if (!isNonEmptyString(body.nodeId, 120)) return json(env, { error: 'nodeId is required.' }, 422);

      var count = await db.from('locations')
        .select('node_id', { count: 'exact', head: true })
        .eq('parent_node_id', body.nodeId);
      if (count.error) throw count.error;
      var childCount = count.count || 0;

      /* Explicit cascade (single confirmation on the client). node_id is
         a path ('city/main/sub'), so every descendant matches one LIKE
         query — no recursion needed. Without cascade, a city with
         dependencies is refused as before; Disable remains the
         non-destructive alternative. */
      if (childCount > 0 && !body.cascade) {
        return json(env, {
          error: 'This city has ' + childCount + ' Main/Sub Location row(s). Disable it instead, or confirm cascade delete.',
          childCount: childCount
        }, 409);
      }

      if (childCount > 0) {
        var delKids = await db.from('locations').delete().like('node_id', body.nodeId + '/%');
        if (delKids.error) throw delKids.error;
      }

      var del = await db.from('locations').delete().eq('node_id', body.nodeId).eq('type', 'city');
      if (del.error) throw del.error;
      await audit('delete_city', 'location', body.nodeId, { cascadedChildren: childCount });
      return json(env, { ok: true, deletedChildren: childCount });
    }

    if (action === 'delete-node') {
      /* Deletes a Main or Sub Location (never a city — use 'delete' for
         that) and, for a Main Location, every Sub Location beneath it.
         Always cascades — a Main Location without its subs is never a
         valid outcome the client offers. */
      if (!isNonEmptyString(body.nodeId, 200)) return json(env, { error: 'nodeId is required.' }, 422);

      var node = await db.from('locations').select('node_id, type').eq('node_id', body.nodeId).maybeSingle();
      if (node.error) throw node.error;
      if (!node.data) return json(env, { error: 'No such location.' }, 404);
      if (node.data.type === 'city') return json(env, { error: "Use action 'delete' for a city." }, 422);

      var delSub = await db.from('locations').delete().like('node_id', body.nodeId + '/%');
      if (delSub.error) throw delSub.error;
      var delSelf = await db.from('locations').delete().eq('node_id', body.nodeId);
      if (delSelf.error) throw delSelf.error;

      await audit('delete_location_node', 'location', body.nodeId, { type: node.data.type });
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be one of: 'add', 'rename', 'disable', 'enable', 'delete', 'delete-node'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'City management request failed.' }, 500);
  }
}
