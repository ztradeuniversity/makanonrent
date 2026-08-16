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
import { slugify } from '../../utils/slug.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
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

    /* ── Main/Sub Location management (Published Data panel) ──────────
       These address rows by their STORED node_id, which the client gets
       from GET /api/locations. node_id is never recomputed from a name. */

    if (action === 'add-node') {
      /* Creates ONE Main Location (under a city) or ONE Sub Location
         (under a main). Aliases are written onto this single row — an
         alias never becomes a row of its own. */
      if (!isNonEmptyString(body.parentNodeId, 200)) return json(env, { error: 'parentNodeId is required.' }, 422);
      if (!isNonEmptyString(body.name, 160)) return json(env, { error: 'name is required.' }, 422);

      var parent = await db.from('locations').select('node_id, type').eq('node_id', body.parentNodeId).maybeSingle();
      if (parent.error) throw parent.error;
      if (!parent.data) return json(env, { error: 'Parent location does not exist.' }, 404);

      var childType;
      if (parent.data.type === 'city') childType = 'locality';
      else if (parent.data.type === 'locality' || parent.data.type === 'society') childType = 'subarea';
      else return json(env, { error: 'A location cannot be added under a ' + parent.data.type + '.' }, 422);

      var newSlug = slugify(body.name);
      if (!newSlug) return json(env, { error: 'That name has no usable characters.' }, 422);
      var newNode = body.parentNodeId + '/' + newSlug;

      var exists = await db.from('locations').select('node_id').eq('node_id', newNode).maybeSingle();
      if (exists.error) throw exists.error;
      if (exists.data) return json(env, { error: 'A location with that name already exists here.' }, 409);

      var addAliases = (childType === 'locality' && Array.isArray(body.aliases))
        ? body.aliases.filter(function (a) { return isNonEmptyString(a, 160); })
        : [];

      var ins = await db.from('locations').insert({
        node_id: newNode, parent_node_id: body.parentNodeId, name: body.name,
        slug: newSlug, type: childType, status: 'approved', active: true,
        sort_order: Number(body.sortOrder) || 0, source: 'bank', aliases: addAliases
      });
      if (ins.error) throw ins.error;

      await audit('add_location_node', 'location', newNode, { type: childType, name: body.name });
      return json(env, { ok: true, nodeId: newNode, type: childType }, 201);
    }

    if (action === 'rename-node') {
      /* DISPLAY NAME ONLY — node_id and slug are deliberately untouched.
         node_id is the identity that sub locations reference as their
         parent, that properties.area_node_id points at, and that admin
         area assignments are keyed on. Re-deriving it from a new name
         would strand every one of those references, so a rename here
         changes what is shown and searched, never what is referenced.
         This is the same rule the city 'rename' action already follows. */
      if (!isNonEmptyString(body.nodeId, 200)) return json(env, { error: 'nodeId is required.' }, 422);
      if (!isNonEmptyString(body.name, 160)) return json(env, { error: 'name is required.' }, 422);

      var target = await db.from('locations').select('node_id, type').eq('node_id', body.nodeId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json(env, { error: 'No such location.' }, 404);
      if (target.data.type === 'city') return json(env, { error: "Use action 'rename' for a city." }, 422);

      var ren = await db.from('locations').update({ name: body.name }).eq('node_id', body.nodeId);
      if (ren.error) throw ren.error;
      await audit('rename_location_node', 'location', body.nodeId, { name: body.name, type: target.data.type });
      return json(env, { ok: true, nodeId: body.nodeId });
    }

    if (action === 'set-aliases') {
      /* Replaces the alias list on ONE canonical Main Location row. This
         is the add/edit/remove path for "Also Known As" — because aliases
         are a column on the canonical row, changing them can never create
         a second parent and can never move the sub locations. */
      if (!isNonEmptyString(body.nodeId, 200)) return json(env, { error: 'nodeId is required.' }, 422);
      if (!Array.isArray(body.aliases)) return json(env, { error: 'aliases must be an array.' }, 422);

      var aliasTarget = await db.from('locations').select('node_id, type').eq('node_id', body.nodeId).maybeSingle();
      if (aliasTarget.error) throw aliasTarget.error;
      if (!aliasTarget.data) return json(env, { error: 'No such location.' }, 404);
      if (aliasTarget.data.type !== 'locality' && aliasTarget.data.type !== 'society') {
        return json(env, { error: 'Only a Main Location can carry Also Known As names.' }, 422);
      }

      var cleanAliases = [];
      var seenAlias = {};
      body.aliases.forEach(function (a) {
        if (!isNonEmptyString(a, 160)) return;
        var k = String(a).trim().toLowerCase();
        if (seenAlias[k]) return;
        seenAlias[k] = 1;
        cleanAliases.push(String(a).trim());
      });

      var setA = await db.from('locations').update({ aliases: cleanAliases }).eq('node_id', body.nodeId);
      if (setA.error) throw setA.error;
      await audit('set_location_aliases', 'location', body.nodeId, { count: cleanAliases.length });
      return json(env, { ok: true, nodeId: body.nodeId, aliases: cleanAliases });
    }

    if (action === 'delete-node') {
      /* Deletes a Main or Sub Location (never a city — use 'delete' for
         that) and, for a Main Location, every Sub Location beneath it.

         Deleting a location row is NOT self-contained. Per the schema:
           locations.parent_node_id          → ON DELETE CASCADE
           admin_area_assignments.node_id    → ON DELETE CASCADE  (!)
           admin_tasks.area_node_id          → ON DELETE SET NULL
           properties.area_node_id           → ON DELETE SET NULL
         so a delete can silently destroy a manager's area assignment and
         detach live properties — and properties.city_slug/area_slug are
         plain text with no FK at all, so they are left dangling with no
         database protection whatsoever.

         Therefore this refuses (409) whenever anything depends on the
         node and reports exactly what would be affected; the caller must
         come back with confirm:true. Same shape as the city 'delete'
         action's existing childCount refusal, so the client pattern is
         unchanged. */
      if (!isNonEmptyString(body.nodeId, 200)) return json(env, { error: 'nodeId is required.' }, 422);

      var node = await db.from('locations').select('node_id, type').eq('node_id', body.nodeId).maybeSingle();
      if (node.error) throw node.error;
      if (!node.data) return json(env, { error: 'No such location.' }, 404);
      if (node.data.type === 'city') return json(env, { error: "Use action 'delete' for a city." }, 422);

      /* A missing optional table must not block a legitimate delete, so a
         failed count is reported as null ("unknown") rather than thrown. */
      async function countWhere(table, column, value, op) {
        try {
          var q = db.from(table).select(column, { count: 'exact', head: true });
          q = op === 'like' ? q.like(column, value) : q.eq(column, value);
          var res = await q;
          if (res.error) return null;
          return res.count || 0;
        } catch (err) { return null; }
      }

      var deps = {
        subLocations: await countWhere('locations', 'node_id', body.nodeId + '/%', 'like'),
        properties: await countWhere('properties', 'area_node_id', body.nodeId),
        areaAssignments: await countWhere('admin_area_assignments', 'node_id', body.nodeId),
        tasks: await countWhere('admin_tasks', 'area_node_id', body.nodeId)
      };
      var blocking = (deps.properties || 0) + (deps.areaAssignments || 0) + (deps.tasks || 0) + (deps.subLocations || 0);

      if (blocking > 0 && !body.confirm) {
        return json(env, {
          error: 'This location has dependent records. Confirm to proceed.',
          requiresConfirmation: true,
          dependents: deps
        }, 409);
      }

      var delSub = await db.from('locations').delete().like('node_id', body.nodeId + '/%');
      if (delSub.error) throw delSub.error;
      var delSelf = await db.from('locations').delete().eq('node_id', body.nodeId);
      if (delSelf.error) throw delSelf.error;

      await audit('delete_location_node', 'location', body.nodeId, {
        type: node.data.type, dependents: deps, confirmed: !!body.confirm
      });
      return json(env, { ok: true, deleted: deps });
    }

    return json(env, { error: "action must be one of: 'add', 'rename', 'disable', 'enable', 'delete', 'add-node', 'rename-node', 'set-aliases', 'delete-node'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'City management request failed.' }, 500);
  }
}
