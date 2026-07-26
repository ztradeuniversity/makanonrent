/* GET  /api/admin/tasks?date=YYYY-MM-DD&userId=…  → tasks + live progress
   POST /api/admin/tasks                            → { action: 'create' | 'cancel', … }

   Completion is DERIVED, never self-reported: the admin_task_progress view
   counts real verification rows and real property rows for that user on
   that date. A manager cannot mark their own target met — the only way the
   number moves is by doing the work. That is deliberate and is why the
   view exists instead of a completed_count column. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, canManageRole, can } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var TASK_TYPES = ['verify_properties', 'add_properties', 'custom'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var url = new URL(context.request.url);
    var date = url.searchParams.get('date') || todayISO();
    var userId = url.searchParams.get('userId');

    /* A Manager sees only their own tasks, whatever they ask for. */
    if (!can(auth.user.role, 'tasks.list.any')) userId = auth.user.id;

    var q = db.from('admin_task_progress')
      .select('task_id, assigned_to, assigned_by, task_type, title, target_count, due_date, status, area_node_id, completed_count')
      .eq('due_date', date);
    if (userId) q = q.eq('assigned_to', userId);

    var res = await q;
    if (res.error) throw res.error;

    var tasks = (res.data || []).map(function (t) {
      var done = Math.min(t.completed_count, t.target_count);
      return {
        id: t.task_id, assignedTo: t.assigned_to, taskType: t.task_type,
        title: t.title, targetCount: t.target_count, completedCount: t.completed_count,
        dueDate: t.due_date, status: t.status, areaNodeId: t.area_node_id,
        pendingCount: Math.max(0, t.target_count - done),
        completionPct: t.target_count ? Math.round(1000 * done / t.target_count) / 10 : 0
      };
    });

    /* The four numbers the Manager dashboard is specified to show. */
    var targetTotal = tasks.reduce(function (n, t) { return n + t.targetCount; }, 0);
    var doneTotal = tasks.reduce(function (n, t) { return n + Math.min(t.completedCount, t.targetCount); }, 0);

    return json(env, {
      date: date,
      tasks: tasks,
      summary: {
        total: tasks.length,
        completed: tasks.filter(function (t) { return t.completedCount >= t.targetCount; }).length,
        pending: tasks.filter(function (t) { return t.completedCount < t.targetCount; }).length,
        completionPct: targetTotal ? Math.round(1000 * doneTotal / targetTotal) / 10 : 0
      }
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load tasks.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'tasks.assign');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var db = getServiceClient(env);
  var audit = auditFor(env, auth.user, context.request);

  try {
    if (body.action === 'create') {
      if (!isNonEmptyString(body.assignedTo, 60)) return json(env, { error: 'assignedTo is required.' }, 422);
      if (TASK_TYPES.indexOf(body.taskType) === -1) {
        return json(env, { error: 'taskType must be one of: ' + TASK_TYPES.join(', ') + '.' }, 422);
      }
      var target = Number(body.targetCount);
      if (!Number.isFinite(target) || target < 1 || target > 10000) {
        return json(env, { error: 'targetCount must be between 1 and 10000.' }, 422);
      }
      var dueDate = body.dueDate || todayISO();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return json(env, { error: 'dueDate must be YYYY-MM-DD.' }, 422);
      }

      var t = await db.from('admin_users').select('id, role, full_name').eq('id', body.assignedTo).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, t.data.role)) {
        return json(env, { error: 'You cannot assign tasks to that user.' }, 403);
      }

      var ins = await db.from('admin_tasks').insert({
        assigned_to: body.assignedTo,
        assigned_by: auth.user.id,
        task_type: body.taskType,
        title: isNonEmptyString(body.title, 200) ? body.title : defaultTitle(body.taskType, target),
        target_count: target,
        due_date: dueDate,
        area_node_id: isNonEmptyString(body.areaNodeId, 200) ? body.areaNodeId : null,
        /* Always 'human' here. An AI assigner would write source='ai' via
           the same table — see ADR §6; nothing sets it today. */
        source: 'human'
      }).select('id').single();
      if (ins.error) throw ins.error;

      await audit('create_task', 'admin_task', ins.data.id, {
        assignedTo: body.assignedTo, taskType: body.taskType, targetCount: target, dueDate: dueDate
      });
      return json(env, { ok: true, taskId: ins.data.id }, 201);
    }

    if (body.action === 'cancel') {
      if (!isNonEmptyString(body.taskId, 60)) return json(env, { error: 'taskId is required.' }, 422);

      var row = await db.from('admin_tasks')
        .select('id, assigned_to, admin_users!admin_tasks_assigned_to_fkey(role)')
        .eq('id', body.taskId).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data) return json(env, { error: 'No such task.' }, 404);
      if (!canManageRole(auth.user.role, row.data.admin_users.role)) {
        return json(env, { error: 'You cannot change that task.' }, 403);
      }

      var upd = await db.from('admin_tasks').update({ status: 'cancelled' }).eq('id', body.taskId);
      if (upd.error) throw upd.error;

      await audit('cancel_task', 'admin_task', body.taskId, null);
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be 'create' or 'cancel'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Task request failed.' }, 500);
  }
}

function defaultTitle(taskType, count) {
  if (taskType === 'verify_properties') return 'Verify ' + count + ' properties';
  if (taskType === 'add_properties') return 'Add ' + count + ' new properties';
  return 'Task';
}
