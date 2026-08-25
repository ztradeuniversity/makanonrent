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
import { requireAuth, requireCapability, canManageRole, can, getManagedManagerIds, getScopeNodeIds, isWithinScope, getVisibleSubordinateIds, getDelegationTargets } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';
import { sendQueuedEmail } from '../../utils/mailer.js';
import { publish } from '../../utils/notify.js';

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

    /* ── recipients: who this caller may delegate work to (ISSUE 3/19) ──
       ONE tier down, never further — getDelegationTargets, not the
       broader team-VISIBILITY set. Returned with names/roles so the
       frontend never has to re-derive eligibility from the Team list
       (which deliberately includes people who are NOT valid recipients,
       e.g. an Assistant CEO's Field Officers). */
    if (url.searchParams.get('recipients')) {
      var targets = await getDelegationTargets(env, auth.user);
      var rq = db.from('admin_users').select('id, full_name, role, username').eq('status', 'active');
      if (targets !== null) {
        if (!targets.length) return json(env, { recipients: [] });
        rq = rq.in('id', targets);
      }
      var rres = await rq.order('full_name', { ascending: true });
      if (rres.error) throw rres.error;
      return json(env, {
        recipients: (rres.data || []).map(function (u) {
          return { id: u.id, fullName: u.full_name, role: u.role, username: u.username };
        })
      });
    }

    /* ── chain: the full delegation history for one task (ISSUE 15/3B) ──
       Walks parent_task_id both up (to the root assignment) and down (to
       every delegated child), then returns everything in one flat,
       chronologically-sortable list — CEO → Assistant CEO → Manager →
       Field Officer, exactly the chain the brief asks for, built from the
       ONE link migration 0018 added rather than a second history table. */
    var chainTaskId = url.searchParams.get('chain');
    if (chainTaskId) {
      var chainRootRes = await db.from('admin_task_progress')
        .select('task_id, assigned_to, assigned_to_name, assigned_by, assigned_by_name, title, status, parent_task_id, created_at')
        .eq('task_id', chainTaskId).maybeSingle();
      if (chainRootRes.error) throw chainRootRes.error;
      if (!chainRootRes.data) return json(env, { error: 'No such task.' }, 404);

      /* Walk up to the root (a delegated task's parent, grandparent, …). */
      var chainRows = [chainRootRes.data];
      var cursor = chainRootRes.data;
      var guard = 0;
      while (cursor.parent_task_id && guard++ < 20) {
        var upRes = await db.from('admin_task_progress')
          .select('task_id, assigned_to, assigned_to_name, assigned_by, assigned_by_name, title, status, parent_task_id, created_at')
          .eq('task_id', cursor.parent_task_id).maybeSingle();
        if (upRes.error || !upRes.data) break;
        chainRows.push(upRes.data);
        cursor = upRes.data;
      }
      var rootId = cursor.task_id;

      /* Then every descendant of the root, at any depth — a Manager may
         have delegated to more than one Field Officer, or a chain could
         in principle run deeper than one hop. */
      var seen = {};
      chainRows.forEach(function (r) { seen[r.task_id] = true; });
      var frontier = [rootId];
      var depthGuard = 0;
      while (frontier.length && depthGuard++ < 20) {
        var downRes = await db.from('admin_task_progress')
          .select('task_id, assigned_to, assigned_to_name, assigned_by, assigned_by_name, title, status, parent_task_id, created_at')
          .in('parent_task_id', frontier);
        if (downRes.error) break;
        var nextFrontier = [];
        (downRes.data || []).forEach(function (r) {
          if (seen[r.task_id]) return;
          seen[r.task_id] = true;
          chainRows.push(r);
          nextFrontier.push(r.task_id);
        });
        frontier = nextFrontier;
      }

      /* Hierarchy scope: every row surfaced here must belong to someone
         within the caller's own authorised visibility (or be the caller's
         own task) — otherwise a crafted ?chain= for an unrelated task
         could leak an unrelated part of the org chart. */
      if (auth.user.role !== 'ceo') {
        var chainHierarchyIds = await getVisibleSubordinateIds(env, auth.user);
        var chainAllowed = chainHierarchyIds.concat([auth.user.id]);
        var forbidden = chainRows.some(function (r) {
          return chainAllowed.indexOf(r.assigned_to) === -1 && chainAllowed.indexOf(r.assigned_by) === -1;
        });
        if (forbidden) return json(env, { error: 'That task is outside your own hierarchy.' }, 403);
      }

      chainRows.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      return json(env, {
        chain: chainRows.map(function (r) {
          return {
            id: r.task_id, title: r.title, status: r.status,
            assignedTo: r.assigned_to, assignedToName: r.assigned_to_name,
            assignedBy: r.assigned_by, assignedByName: r.assigned_by_name,
            parentTaskId: r.parent_task_id, createdAt: r.created_at
          };
        })
      });
    }

    var date = url.searchParams.get('date') || todayISO();
    var userId = url.searchParams.get('userId');
    /* Explicit oversight request (ISSUE 8/11/17, work-hierarchy fix,
       audited 2026-08-25) — "MY TEAM'S DELEGATED WORK" as a DIFFERENT
       question from "MY WORK". Without this, granting 'manager' the
       tasks.list.any capability (below) would silently change what a
       bare GET with no params returns for a Manager on the shared Today
       tab — from "my own received work" to "my whole team's work" —
       breaking the existing personal task list every other role still
       gets from that same call. Manager's default stays self; team
       aggregate is opt-in. */
    var teamScope = !!url.searchParams.get('team');

    /* Field Officer never had tasks.list.any and still doesn't — always
       self. Manager is newly granted the capability (work-hierarchy fix)
       but must keep defaulting to "my own work" exactly as before,
       reached only by an explicit ?team=1 or ?userId now. Assistant
       CEO's and CEO's EXISTING default (team/company aggregate when no
       userId is given) is untouched — changing that was not requested
       and would have silently emptied their own Today-tab task list. */
    if (!can(auth.user.role, 'tasks.list.any')) {
      userId = auth.user.id;
    } else if (auth.user.role === 'manager' && !userId && !teamScope) {
      userId = auth.user.id;
    }

    var q = db.from('admin_task_progress')
      .select('task_id, assigned_to, assigned_to_name, assigned_by, assigned_by_name, task_type, title, notes, ' +
        'target_count, due_date, status, area_node_id, completed_count, parent_task_id, created_at')
      .eq('due_date', date);

    /* tasks.list.any grants the CAPABILITY to pass a userId/?team=1, but
       for Assistant CEO/Manager it must still stop at the hierarchy
       boundary — "any" meant "not just yourself", never "anyone in the
       company" (migration 0014, approved 2026-08-24). Same reports_to +
       area-overlap FO resolution as users.js's Team list scoping for
       Assistant CEO; Manager's own Field Officers (reports_to = self)
       for Manager — the SAME set getDelegationTargets uses for
       delegation authority, since "whose work can I oversee" and "who
       can I delegate to" are the same people for a Manager (unlike an
       Assistant CEO, who oversees FOs they cannot delegate to directly). */
    if (auth.user.role === 'assistant_ceo') {
      var hierarchyIds = await getManagedManagerIds(env, auth.user.id);
      var aceoScope = await getScopeNodeIds(env, auth.user);
      var foRows = await db.from('admin_area_assignments')
        .select('user_id, node_id, admin_users!admin_area_assignments_user_id_fkey!inner(role, status)')
        .eq('active', true).eq('admin_users.role', 'field_officer').eq('admin_users.status', 'active');
      (!foRows.error ? (foRows.data || []) : []).forEach(function (r) {
        if (isWithinScope(aceoScope, r.node_id) && hierarchyIds.indexOf(r.user_id) === -1) hierarchyIds.push(r.user_id);
      });

      if (userId && userId !== auth.user.id) {
        if (hierarchyIds.indexOf(userId) === -1) {
          return json(env, { error: 'That team member is outside your hierarchy.' }, 403);
        }
      } else if (!userId) {
        q = hierarchyIds.length ? q.in('assigned_to', hierarchyIds) : q.eq('assigned_to', '00000000-0000-0000-0000-000000000000');
      }
    } else if (auth.user.role === 'manager' && teamScope && !userId) {
      var mgrFoIds = await getDelegationTargets(env, auth.user);
      q = mgrFoIds.length ? q.in('assigned_to', mgrFoIds) : q.eq('assigned_to', '00000000-0000-0000-0000-000000000000');
    }

    if (userId) q = q.eq('assigned_to', userId);

    var res = await q;
    if (res.error) throw res.error;

    var tasks = (res.data || []).map(function (t) {
      var done = Math.min(t.completed_count, t.target_count);
      return {
        id: t.task_id, assignedTo: t.assigned_to, assignedToName: t.assigned_to_name,
        assignedBy: t.assigned_by, assignedByName: t.assigned_by_name, taskType: t.task_type,
        title: t.title, notes: t.notes || null, targetCount: t.target_count, completedCount: t.completed_count,
        dueDate: t.due_date, status: t.status, areaNodeId: t.area_node_id,
        pendingCount: Math.max(0, t.target_count - done),
        completionPct: t.target_count ? Math.round(1000 * done / t.target_count) / 10 : 0,
        parentTaskId: t.parent_task_id || null,
        createdAt: t.created_at
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

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    var audit = auditFor(env, auth.user, context.request);
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

      var t = await db.from('admin_users').select('id, role, full_name, email, status').eq('id', body.assignedTo).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, t.data.role)) {
        return json(env, { error: 'You cannot assign tasks to that user.' }, 403);
      }
      /* Work-hierarchy fix (audited 2026-08-25): role-level authority
         alone would let an Assistant CEO assign a task to any Manager OR
         FIELD OFFICER system-wide — canManageRole('assistant_ceo',
         'field_officer') is true, and the OLD check here
         (getVisibleSubordinateIds) is the team-VISIBILITY set, which
         intentionally includes an Assistant CEO's Field Officers too.
         getDelegationTargets is the separate, stricter answer: ONE
         tier down, never further — "Assistant CEO cannot assign directly
         to FO" is a hard business rule, enforced here regardless of what
         the client sent. Manager now reaches this too (tasks.assign
         grants it, work-hierarchy fix) and is equally restricted to only
         their own Field Officers. */
      if (auth.user.role !== 'ceo') {
        var taskTargets = await getDelegationTargets(env, auth.user);
        if (!taskTargets || taskTargets.indexOf(body.assignedTo) === -1) {
          return json(env, {
            error: auth.user.role === 'assistant_ceo'
              ? 'Assistant CEO may only assign work to an Area Manager in your own hierarchy — not directly to a Field Officer.'
              : 'You may only assign work to a Field Officer who reports to you.'
          }, 403);
        }
      }
      if (t.data.status !== 'active') {
        return json(env, { error: 'That team member is not active and cannot receive new tasks.' }, 409);
      }

      /* Delegation chain (ISSUE 6/7/15, migration 0018): an optional link
         back to the task THIS caller received, so "Manager delegated to
         FO" is a traceable child of "Assistant CEO assigned to Manager"
         rather than two coincidentally-similar rows. Only accepted when
         the parent task is genuinely the caller's own received work —
         otherwise a crafted parentTaskId could graft a new assignment
         onto someone else's chain. */
      var parentTaskId = null;
      if (isNonEmptyString(body.parentTaskId, 60)) {
        var parentTask = await db.from('admin_tasks').select('id, assigned_to').eq('id', body.parentTaskId).maybeSingle();
        if (parentTask.error) throw parentTask.error;
        if (!parentTask.data || parentTask.data.assigned_to !== auth.user.id) {
          return json(env, { error: 'parentTaskId must be a task currently assigned to you.' }, 422);
        }
        parentTaskId = body.parentTaskId;
      }

      /* Instructions are most relevant for task_type='custom' (the UI
         only shows the field then) but the column isn't restricted to
         it — a predefined task can carry a short note too. */
      var notes = isNonEmptyString(body.notes, 4000) ? body.notes.trim() : null;
      var title = isNonEmptyString(body.title, 200) ? body.title : defaultTitle(body.taskType, target);
      var areaNodeId = isNonEmptyString(body.areaNodeId, 200) ? body.areaNodeId : null;

      var ins = await db.from('admin_tasks').insert({
        assigned_to: body.assignedTo,
        assigned_by: auth.user.id,
        task_type: body.taskType,
        title: title,
        notes: notes,
        target_count: target,
        due_date: dueDate,
        area_node_id: areaNodeId,
        parent_task_id: parentTaskId,
        /* Always 'human' here. An AI assigner would write source='ai' via
           the same table — see ADR §6; nothing sets it today. */
        source: 'human'
      }).select('id').single();
      if (ins.error) throw ins.error;

      await audit('create_task', 'admin_task', ins.data.id, {
        assignedTo: body.assignedTo, taskType: body.taskType, targetCount: target, dueDate: dueDate,
        parentTaskId: parentTaskId
      });

      /* In-app notification (ISSUE 23): 'task.assigned' has been in the
         Notification Bus catalogue (notify.js) since it was written, but
         nothing ever actually called publish() for it — the bell icon
         never lit up for a new task, only email did. Reusing the exact
         same bus every other event in this console fires through; no
         second notification path. Fire-and-forget, same as every other
         publish() call — never blocks or fails the task creation above. */
      await publish(env, {
        type: 'task.assigned', recipientId: body.assignedTo, actorId: auth.user.id,
        entityType: 'admin_task', entityId: ins.data.id,
        areaNodeId: areaNodeId, body: title
      });

      /* Task email — same admin_users.email, same sendQueuedEmail() the
         OTP flow uses (see mailer.js). A missing email on legacy accounts
         is not an error here: the task itself is already created and
         visible on the dashboard either way. */
      if (t.data.email) {
        var areaName = null;
        if (areaNodeId) {
          var loc = await db.from('locations').select('name').eq('node_id', areaNodeId).maybeSingle();
          areaName = (!loc.error && loc.data) ? loc.data.name : null;
        }
        var delivery = await sendQueuedEmail(env, db, {
          toEmail: t.data.email, template: 'admin_task_assigned',
          payload: {
            recipientName: t.data.full_name, roleLabel: t.data.role, title: title, notes: notes,
            targetCount: target, dueDate: dueDate, areaName: areaName, assignedByName: auth.user.full_name
          }
        });
        if (!delivery.sent) {
          await audit('task_email_failed', 'admin_task', ins.data.id, { error: delivery.error });
        }
      }

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
