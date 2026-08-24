/* GET  /api/admin/assignments?userId=…   → active area assignments
   POST /api/admin/assignments            → { action: 'assign' | 'revoke', … }

   Areas are the existing location tree from migration 0002 — City →
   Main Location → Sub Location. No second geography is invented here
   (Doc 04 §3.1: IDs, never free text; one master source).

   "Each area belongs to only one active manager" is enforced by a partial
   unique index in the database (uq_area_one_active_manager), not by a
   check in this handler — two concurrent assignments would race past any
   application-level test. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, canManageRole, getScopeNodeIds, isWithinScope, getVisibleSubordinateIds, cascadeInvalidateChildren } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

/* node_id is a path: 'lahore' | 'lahore/johar-town' | 'lahore/johar-town/block-a'.
   Depth IS the tier, so the level is derived rather than trusted from the
   client — a caller cannot mislabel a sub-location as a city to widen its
   own scope. */
function levelFromNodeId(nodeId) {
  var depth = String(nodeId).split('/').length;
  if (depth === 1) return 'city';
  if (depth === 2) return 'main';
  if (depth === 3) return 'sub';
  return null;
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'areas.list');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var url = new URL(context.request.url);
    var userId = url.searchParams.get('userId');

    /* A Manager or Field Officer may only ever read their own assignments. */
    if (auth.user.role === 'manager' || auth.user.role === 'field_officer') userId = auth.user.id;

    /* admin_area_assignments carries TWO FKs to admin_users (user_id AND
       assigned_by — migration 0004), so a bare `admin_users!inner(...)`
       embed is ambiguous to PostgREST ("more than one relationship was
       found"). Disambiguated via the FK-name hint, same convention
       tasks.js already uses for admin_tasks (assigned_to/assigned_by). */
    /* !inner + admin_users.status filter: an archived/disabled member's
       assignment must not surface here even though the row itself is
       still active=true (audited root cause, 2026-08-24 — removing a
       member never touched their standing assignments, so they kept
       appearing as if still operational). The row and its history are
       untouched; this only changes what this read returns. */
    var q = db.from('admin_area_assignments')
      .select('id, user_id, node_id, scope_level, created_at, admin_users!admin_area_assignments_user_id_fkey!inner(full_name, role, status), locations!inner(name)')
      .eq('active', true)
      .eq('admin_users.status', 'active')
      .order('node_id', { ascending: true });
    if (userId) q = q.eq('user_id', userId);

    var res = await q;
    if (res.error) throw res.error;

    return json(env, {
      assignments: (res.data || []).map(function (a) {
        return {
          id: a.id, userId: a.user_id, nodeId: a.node_id, level: a.scope_level,
          areaName: a.locations && a.locations.name,
          userName: a.admin_users && a.admin_users.full_name,
          userRole: a.admin_users && a.admin_users.role,
          createdAt: a.created_at
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load assignments.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'areas.assign');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    var audit = auditFor(env, auth.user, context.request);

    if (body.action === 'assign') {
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);
      if (!isNonEmptyString(body.nodeId, 200)) return json(env, { error: 'nodeId is required.' }, 422);

      var level = levelFromNodeId(body.nodeId);
      if (!level) return json(env, { error: 'nodeId is not a City / Main / Sub location path.' }, 422);

      var target = await db.from('admin_users').select('id, role, full_name, status').eq('id', body.userId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, target.data.role)) {
        return json(env, { error: 'You cannot assign areas to that user.' }, 403);
      }
      /* Role-level authority alone is not enough (a Manager and an
         unrelated system-wide Field Officer both pass canManageRole) —
         the target must actually be IN this caller's own hierarchy.
         Same shared definition users.js uses to decide what the caller
         can even see, so the picker and this check can never disagree. */
      if (auth.user.role !== 'ceo') {
        var hierarchyIds = await getVisibleSubordinateIds(env, auth.user);
        if (hierarchyIds.indexOf(body.userId) === -1) {
          return json(env, { error: 'That team member is outside your own hierarchy.' }, 403);
        }
      }
      /* A stale client-supplied userId (a removed/disabled member the UI
         no longer lists) must be rejected here, server-side — hiding it
         from selectors is not enforcement. */
      if (target.data.status !== 'active') {
        return json(env, { error: 'That team member is not active and cannot receive new assignments.' }, 409);
      }

      /* An Assistant CEO can only delegate territory they themselves hold
         — otherwise a scoped role could grant itself reach by proxy. */
      if (auth.user.role !== 'ceo') {
        var scope = await getScopeNodeIds(env, auth.user);
        if (!isWithinScope(scope, body.nodeId)) {
          return json(env, { error: 'That area is outside your own assigned scope.' }, 403);
        }
      }

      var area = await db.from('locations').select('node_id, name').eq('node_id', body.nodeId).maybeSingle();
      if (area.error) throw area.error;
      if (!area.data) return json(env, { error: 'No such location.' }, 404);

      var ins = await db.from('admin_area_assignments').insert({
        user_id: body.userId,
        node_id: body.nodeId,
        scope_level: level,
        scope_role: target.data.role,   // re-synced by trg_area_assignment_role
        assigned_by: auth.user.id,
        active: true
      }).select('id').single();

      if (ins.error) {
        if (String(ins.error.message || '').indexOf('uq_area_one_active_manager') > -1) {
          return json(env, {
            error: 'That area already has an active manager. Revoke the existing assignment first.'
          }, 409);
        }
        throw ins.error;
      }

      await audit('assign_area', 'admin_area_assignment', ins.data.id,
        { userId: body.userId, nodeId: body.nodeId, level: level });
      return json(env, { ok: true, assignmentId: ins.data.id }, 201);
    }

    /* "Remove" in the UI IS this action — 'revoke' was already the real
       removal (active=false, history kept), just under a less clear
       name. No second action was created; the UI now labels the exact
       same operation "Remove". */
    if (body.action === 'revoke') {
      if (!isNonEmptyString(body.assignmentId, 60)) {
        return json(env, { error: 'assignmentId is required.' }, 422);
      }

      var row = await db.from('admin_area_assignments')
        .select('id, user_id, node_id, scope_level, active, admin_users!admin_area_assignments_user_id_fkey(role)')
        .eq('id', body.assignmentId).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data) return json(env, { error: 'No such assignment.' }, 404);
      if (!canManageRole(auth.user.role, row.data.admin_users.role)) {
        return json(env, { error: 'You cannot change that assignment.' }, 403);
      }
      if (auth.user.role !== 'ceo') {
        var revokeHierarchyIds = await getVisibleSubordinateIds(env, auth.user);
        if (revokeHierarchyIds.indexOf(row.data.user_id) === -1) {
          return json(env, { error: 'That team member is outside your own hierarchy.' }, 403);
        }
      }

      /* City/main removal cascades to every active descendant row for
         THIS SAME user (node_id prefix match, same scheme rbac.js's
         isWithinScope uses) — removing "Lahore" must not leave "Lahore /
         Johar Town" looking like it's still assigned. A specific
         sub-location removes only itself. Never touches another user's
         rows even if they hold the identical node_id. */
      var toRevoke = [body.assignmentId];
      if (row.data.scope_level !== 'sub') {
        var desc = await db.from('admin_area_assignments')
          .select('id').eq('user_id', row.data.user_id).eq('active', true)
          .like('node_id', row.data.node_id + '/%');
        if (desc.error) throw desc.error;
        toRevoke = toRevoke.concat((desc.data || []).map(function (d) { return d.id; }));
      }

      /* Revoke, never delete: the assignment history explains who was
         responsible for an area at the time a verification was signed. */
      var upd = await db.from('admin_area_assignments')
        .update({ active: false, revoked_at: new Date().toISOString() })
        .in('id', toRevoke);
      if (upd.error) throw upd.error;

      await audit('revoke_area', 'admin_area_assignment', body.assignmentId,
        { userId: row.data.user_id, nodeId: row.data.node_id, cascadedCount: toRevoke.length });

      /* If the account that JUST LOST this area itself delegates areas
         downward (assistant_ceo/manager), the loss may have pushed one of
         THEIR subordinates' areas outside that now-smaller scope —
         CHILD_SCOPE ⊆ PARENT_SCOPE must keep holding after a reduction,
         not just at the moment it was granted. Keyed on the assignment's
         OWNER (row.data.user_id), not the caller: a superior revoking a
         subordinate's area is the common case here, not a self-revoke. */
      await cascadeInvalidateChildren(env, audit, row.data.user_id);

      return json(env, { ok: true, removedCount: toRevoke.length });
    }

    /* Bulk — "Remove all assigned locations". Same revoke semantics,
       every active row for one user in one audited action instead of a
       loop of individual clicks. */
    if (body.action === 'revoke-all') {
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var bulkTarget = await db.from('admin_users').select('id, role').eq('id', body.userId).maybeSingle();
      if (bulkTarget.error) throw bulkTarget.error;
      if (!bulkTarget.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, bulkTarget.data.role)) {
        return json(env, { error: 'You cannot change that user\'s assignments.' }, 403);
      }
      if (auth.user.role !== 'ceo') {
        var bulkHierarchyIds = await getVisibleSubordinateIds(env, auth.user);
        if (bulkHierarchyIds.indexOf(body.userId) === -1) {
          return json(env, { error: 'That team member is outside your own hierarchy.' }, 403);
        }
      }

      var bulkRows = await db.from('admin_area_assignments')
        .select('id').eq('user_id', body.userId).eq('active', true);
      if (bulkRows.error) throw bulkRows.error;
      var bulkIds = (bulkRows.data || []).map(function (r) { return r.id; });

      if (bulkIds.length) {
        var bulkUpd = await db.from('admin_area_assignments')
          .update({ active: false, revoked_at: new Date().toISOString() })
          .in('id', bulkIds);
        if (bulkUpd.error) throw bulkUpd.error;
      }

      await audit('revoke_area', 'admin_area_assignment', body.userId, { userId: body.userId, bulk: true, count: bulkIds.length });

      /* Same cascade rationale as single revoke — the account whose whole
         area set was just cleared may itself have subordinates who now
         hold areas outside a scope that no longer exists at all. */
      await cascadeInvalidateChildren(env, audit, body.userId);

      return json(env, { ok: true, removedCount: bulkIds.length });
    }

    /* Transfer — moves active responsibility to a new eligible owner
       without destroying history: the old row(s) are revoked (same
       cascade as 'revoke') and a fresh active row is inserted for the
       recipient, exactly like a normal 'assign' would. Two audited
       actions under one request rather than a UI-level revoke+assign,
       so a half-completed transfer (revoked but never re-assigned) can
       never happen from a network failure between two separate calls. */
    if (body.action === 'transfer') {
      if (!isNonEmptyString(body.assignmentId, 60)) return json(env, { error: 'assignmentId is required.' }, 422);
      if (!isNonEmptyString(body.toUserId, 60)) return json(env, { error: 'toUserId is required.' }, 422);

      var src = await db.from('admin_area_assignments')
        .select('id, user_id, node_id, scope_level, active, admin_users!admin_area_assignments_user_id_fkey(role)')
        .eq('id', body.assignmentId).maybeSingle();
      if (src.error) throw src.error;
      if (!src.data) return json(env, { error: 'No such assignment.' }, 404);
      if (!canManageRole(auth.user.role, src.data.admin_users.role)) {
        return json(env, { error: 'You cannot change that assignment.' }, 403);
      }
      if (body.toUserId === src.data.user_id) {
        return json(env, { error: 'Cannot transfer an assignment to the same owner.' }, 422);
      }

      var recip = await db.from('admin_users').select('id, role, status').eq('id', body.toUserId).maybeSingle();
      if (recip.error) throw recip.error;
      if (!recip.data || recip.data.status !== 'active') {
        return json(env, { error: 'Transfer recipient must be an active team member.' }, 422);
      }
      if (!canManageRole(auth.user.role, recip.data.role)) {
        return json(env, { error: 'You cannot assign areas to that recipient.' }, 403);
      }
      if (auth.user.role !== 'ceo') {
        var xferScope = await getScopeNodeIds(env, auth.user);
        if (!isWithinScope(xferScope, src.data.node_id)) {
          return json(env, { error: 'That area is outside your own assigned scope.' }, 403);
        }
        /* Both ends of the transfer must be this caller's own hierarchy —
           otherwise a scoped role could launder an area between two
           accounts neither of which reports to them. */
        var xferHierarchyIds = await getVisibleSubordinateIds(env, auth.user);
        if (xferHierarchyIds.indexOf(src.data.user_id) === -1 || xferHierarchyIds.indexOf(body.toUserId) === -1) {
          return json(env, { error: 'Both the current and new owner must be within your own hierarchy.' }, 403);
        }
      }

      /* Same cascade rule as revoke: transferring a city/main moves its
         whole active subtree, not just the top row. */
      var xferRows = [{ id: src.data.id, node_id: src.data.node_id, scope_level: src.data.scope_level }];
      if (src.data.scope_level !== 'sub') {
        var xferDesc = await db.from('admin_area_assignments')
          .select('id, node_id, scope_level').eq('user_id', src.data.user_id).eq('active', true)
          .like('node_id', src.data.node_id + '/%');
        if (xferDesc.error) throw xferDesc.error;
        xferRows = xferRows.concat(xferDesc.data || []);
      }

      var oldIds = xferRows.map(function (r) { return r.id; });
      var revokeXfer = await db.from('admin_area_assignments')
        .update({ active: false, revoked_at: new Date().toISOString() }).in('id', oldIds);
      if (revokeXfer.error) throw revokeXfer.error;

      var newIds = [];
      var xferErrors = [];
      for (var xi = 0; xi < xferRows.length; xi++) {
        var xr = xferRows[xi];
        var xins = await db.from('admin_area_assignments').insert({
          user_id: body.toUserId, node_id: xr.node_id, scope_level: xr.scope_level,
          scope_role: recip.data.role, assigned_by: auth.user.id, active: true
        }).select('id').single();
        /* uq_area_one_active_manager can legitimately block one node in a
           larger transfer (recipient already manages it another way) —
           reported per-node rather than aborting the whole transfer,
           since the old rows are already revoked and cannot silently
           un-revoke themselves. */
        if (xins.error) {
          if (String(xins.error.message || '').indexOf('uq_area_one_active_manager') === -1) throw xins.error;
          xferErrors.push(xr.node_id);
        } else {
          newIds.push(xins.data.id);
        }
      }

      await audit('transfer_area', 'admin_area_assignment', body.assignmentId, {
        fromUserId: src.data.user_id, toUserId: body.toUserId, nodeId: src.data.node_id,
        transferredCount: newIds.length, conflicts: xferErrors
      });

      /* The FROM side just lost this area — same cascade rationale as a
         plain revoke, since a transfer is a revoke on that side under the
         hood. The TO side only ever gains scope from a transfer, which
         cannot orphan anything, so no cascade check is needed there. */
      await cascadeInvalidateChildren(env, audit, src.data.user_id);

      return json(env, { ok: true, transferredCount: newIds.length, conflicts: xferErrors });
    }

    return json(env, { error: "action must be 'assign', 'revoke', 'revoke-all' or 'transfer'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Assignment request failed.' }, 500);
  }
}
