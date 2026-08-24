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
import { requireAuth, requireCapability, canManageRole, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
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

    if (body.action === 'revoke') {
      if (!isNonEmptyString(body.assignmentId, 60)) {
        return json(env, { error: 'assignmentId is required.' }, 422);
      }

      var row = await db.from('admin_area_assignments')
        .select('id, user_id, node_id, active, admin_users!admin_area_assignments_user_id_fkey(role)')
        .eq('id', body.assignmentId).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data) return json(env, { error: 'No such assignment.' }, 404);
      if (!canManageRole(auth.user.role, row.data.admin_users.role)) {
        return json(env, { error: 'You cannot change that assignment.' }, 403);
      }

      /* Revoke, never delete: the assignment history explains who was
         responsible for an area at the time a verification was signed. */
      var upd = await db.from('admin_area_assignments')
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq('id', body.assignmentId);
      if (upd.error) throw upd.error;

      await audit('revoke_area', 'admin_area_assignment', body.assignmentId,
        { userId: row.data.user_id, nodeId: row.data.node_id });
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be 'assign' or 'revoke'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Assignment request failed.' }, 500);
  }
}
