/* GET  /api/locations/suggestions?status=pending  → the review queue
   POST /api/locations/suggestions { action, id }  → approve | reject

   The missing half of the Suggest Your Address flow. Everything else was
   already here: /api/locations/suggest writes the node as
   locations.status='pending' plus a location_suggestions audit row, and
   /api/locations serves approved rows only — so a suggestion was already
   stored, and already invisible to the public.

   What did not exist was any way for an admin to act on it. The Location
   Manager's Approve/Reject buttons called MOR_LOC.approveLocation(), which
   only mutates the browser's own copy of the engine: the database row
   stayed 'pending' for ever, the audit row was never reviewed, and a
   suggestion made on one device was invisible to an admin on another.
   This endpoint is that missing bridge, and it is the ONLY way a
   suggestion becomes public.

   Approval never creates anything: the node was created under its
   canonical parent at suggestion time with type 'subarea'. Approving
   flips one status column, so the node_id, the parent, and the
   canonical Main Area are all exactly what they were — no new main
   area, no new alias, no second node.

   Requires 'locations.manage' (CEO / Assistant CEO — functions/utils/
   rbac.js). A normal user can reach /suggest and nothing else, so they
   can never publish a location. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireCapability } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var STATUSES = ['pending', 'approved', 'rejected'];

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'locations.manage');
  if (auth.response) return auth.response;

  var status = new URL(context.request.url).searchParams.get('status') || 'pending';
  if (STATUSES.indexOf(status) === -1) {
    return json(env, { error: 'status must be pending, approved or rejected.' }, 422);
  }

  try {
    var db = getServiceClient(env);

    var res = await db.from('location_suggestions')
      .select('id, name, parent_node_id, parent_name, note, status, suggested_by, reviewed_by, reviewed_at, created_at')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(500);
    if (res.error) throw res.error;

    var rows = res.data || [];
    if (!rows.length) return json(env, { suggestions: [] });

    /* The city is the main area's parent — read it so the queue can show
       City › Main Area without the reviewer opening anything. */
    var parentIds = [];
    rows.forEach(function (r) {
      if (r.parent_node_id && parentIds.indexOf(r.parent_node_id) === -1) parentIds.push(r.parent_node_id);
    });

    var parents = await db.from('locations')
      .select('node_id, name, parent_node_id, type')
      .in('node_id', parentIds);
    if (parents.error) throw parents.error;

    var byNode = {};
    (parents.data || []).forEach(function (p) { byNode[p.node_id] = p; });

    var cityIds = [];
    (parents.data || []).forEach(function (p) {
      if (p.parent_node_id && cityIds.indexOf(p.parent_node_id) === -1) cityIds.push(p.parent_node_id);
    });

    var cities = { data: [] };
    if (cityIds.length) {
      cities = await db.from('locations').select('node_id, name').in('node_id', cityIds);
      if (cities.error) throw cities.error;
    }
    var cityByNode = {};
    (cities.data || []).forEach(function (c) { cityByNode[c.node_id] = c; });

    /* The suggested node itself, so the reviewer acts on the real row and
       the queue can show one that was already dealt with elsewhere. */
    var nodeIds = rows.map(function (r) { return nodeIdFor(r); });
    var nodes = await db.from('locations')
      .select('node_id, name, slug, status, source, suggested_by, created_at')
      .in('node_id', nodeIds);
    if (nodes.error) throw nodes.error;
    var nodeByid = {};
    (nodes.data || []).forEach(function (n) { nodeByid[n.node_id] = n; });

    var out = rows.map(function (r) {
      var parent = byNode[r.parent_node_id];
      var city = parent && parent.parent_node_id ? cityByNode[parent.parent_node_id] : null;
      var node = nodeByid[nodeIdFor(r)];
      return {
        id: r.id,
        name: r.name,
        nodeId: nodeIdFor(r),
        cityName: city ? city.name : null,
        mainName: (parent && parent.name) || r.parent_name || null,
        parentNodeId: r.parent_node_id,
        note: r.note || null,
        status: r.status,
        /* Whatever contact reference the submitter had. There is no public
           login yet, so this is null for most rows — the column is shown
           when it holds something and omitted when it does not. */
        suggestedBy: r.suggested_by || (node && node.suggested_by) || null,
        reviewedBy: r.reviewed_by || null,
        reviewedAt: r.reviewed_at || null,
        createdAt: r.created_at,
        /* True when the node is gone or already resolved — the queue row
           is then stale and acting on it would be a no-op. */
        nodeStatus: node ? node.status : null
      };
    });

    return json(env, { suggestions: out });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load suggestions.' }, 500);
  }
}

/* location_suggestions stores the parent and the display name, not the
   node_id. suggest.js derives the child id the same way, so the two agree
   by construction. */
function slugify(v) {
  return String(v).toLowerCase().trim()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function nodeIdFor(row) {
  return row.parent_node_id + '/' + slugify(row.name);
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

  if (body.action !== 'approve' && body.action !== 'reject') {
    return json(env, { error: "action must be 'approve' or 'reject'." }, 422);
  }
  if (!isNonEmptyString(body.id, 60)) {
    return json(env, { error: 'id is required.' }, 422);
  }

  var approving = body.action === 'approve';

  try {
    var db = getServiceClient(env);

    var cur = await db.from('location_suggestions')
      .select('id, name, parent_node_id, status')
      .eq('id', body.id)
      .maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return json(env, { error: 'No such suggestion.' }, 404);
    if (cur.data.status !== 'pending') {
      return json(env, { error: 'This suggestion was already ' + cur.data.status + '.' }, 409);
    }

    var nodeId = nodeIdFor(cur.data);

    /* Approving must not resurrect a node that has since been removed,
       and must not silently "approve" something that is not there. */
    var node = await db.from('locations')
      .select('node_id, name, parent_node_id, type, status')
      .eq('node_id', nodeId)
      .maybeSingle();
    if (node.error) throw node.error;
    if (!node.data) {
      return json(env, { error: 'The suggested location no longer exists.' }, 409);
    }

    if (approving) {
      /* The parent must still be a main area. Re-checked at approval and
         not only at submission, because the tree can be edited in
         between — approving into a city would effectively mint a main
         area, which no suggestion is ever allowed to do. */
      var parent = await db.from('locations')
        .select('node_id, type')
        .eq('node_id', cur.data.parent_node_id)
        .maybeSingle();
      if (parent.error) throw parent.error;
      if (!parent.data) return json(env, { error: 'The parent location no longer exists.' }, 409);
      if (['locality', 'society'].indexOf(parent.data.type) === -1) {
        return json(env, { error: 'The parent is no longer a main area.' }, 409);
      }
      if (node.data.type !== 'subarea') {
        return json(env, { error: 'Only a sub area can be approved from a suggestion.' }, 409);
      }

      /* An approved sibling with this name may have appeared since the
         suggestion was made. Approving now would mean two live nodes for
         one place, so the reviewer is told to reject this one instead.
         (The partial unique index also blocks it — this turns a raw
         constraint error into an explainable answer.) */
      var clash = await db.from('locations')
        .select('node_id, name')
        .eq('parent_node_id', cur.data.parent_node_id)
        .eq('status', 'approved')
        .ilike('name', String(cur.data.name).trim())
        .limit(1);
      if (clash.error) throw clash.error;
      if (clash.data && clash.data.length && clash.data[0].node_id !== nodeId) {
        return json(env, {
          error: 'A live location named "' + clash.data[0].name + '" already exists here. Reject this suggestion instead.'
        }, 409);
      }
    }

    /* The node's visibility. This single column is the whole difference
       between private and public: /api/locations selects status
       'approved' only. */
    var upd = await db.from('locations')
      .update({ status: approving ? 'approved' : 'rejected' })
      .eq('node_id', nodeId);
    if (upd.error) throw upd.error;

    var reviewer = (auth.user && (auth.user.full_name || auth.user.email || auth.user.id)) || null;
    var aud = await db.from('location_suggestions')
      .update({
        status: approving ? 'approved' : 'rejected',
        reviewed_by: reviewer,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', body.id);
    if (aud.error) throw aud.error;

    await auditFor(env, auth.user, context.request)(
      approving ? 'approve_location_suggestion' : 'reject_location_suggestion',
      'location', nodeId,
      { name: cur.data.name, parent: cur.data.parent_node_id, suggestionId: body.id });

    return json(env, {
      ok: true,
      status: approving ? 'approved' : 'rejected',
      nodeId: nodeId,
      name: cur.data.name,
      parentNodeId: cur.data.parent_node_id
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Review failed.' }, 500);
  }
}
