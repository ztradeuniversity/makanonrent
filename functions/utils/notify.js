/* MakanOnRent — Notification Bus.
   Doc 18 Article 4.4 / FR-A3-1: "Notifications must publish through the
   Notification Bus — no module sends messages directly."

   Modules call publish(env, event). They do NOT insert into
   `notifications`, and they do NOT decide who receives what — recipient
   resolution lives here, once, so a change to "who hears about a
   rejection" is one edit rather than a hunt through every handler.

   Delivery is in-app only today (the table + the console badge). Adding
   WhatsApp/SMS/email is a change INSIDE this module: every caller already
   speaks in events, not channels, so no handler changes when that lands
   (ADR 0002 §7). */
import { getServiceClient } from './supabase.js';

/* The event catalogue, straight from the brief's Notifications section.
   `audience` is resolved at publish time against roles + area scope.

   audience values:
     'assigned_managers' — managers whose assigned area covers the entity
     'managers'          — a specific manager (event supplies recipientId)
     'assistant_ceos'    — Assistant CEOs whose territory covers the area
     'ceo'               — every active CEO */
export var EVENTS = {
  /* → Manager */
  'property.submitted':      { audience: ['assigned_managers'], severity: 'info',
                               title: 'New property submitted' },
  'task.assigned':           { audience: ['managers'],          severity: 'info',
                               title: 'New task assigned' },
  'review.returned':         { audience: ['managers'],          severity: 'warning',
                               title: 'Review returned to you' },
  'area.changed':            { audience: ['managers'],          severity: 'info',
                               title: 'Your assigned areas changed' },

  /* → Assistant CEO */
  'task.completed':          { audience: ['assistant_ceos'],    severity: 'info',
                               title: 'Manager completed a task' },
  'approval.pending':        { audience: ['assistant_ceos'],    severity: 'warning',
                               title: 'Property awaiting your approval' },

  /* → CEO */
  'approval.by_assistant':   { audience: ['ceo'],               severity: 'info',
                               title: 'Assistant CEO approved a property' },
  'report.critical':         { audience: ['ceo'],               severity: 'critical',
                               title: 'Critical report' },
  'manager.performance':     { audience: ['ceo'],               severity: 'warning',
                               title: 'Manager performance alert' },

  /* Lifecycle events that matter to more than one tier. */
  'property.rejected':       { audience: ['assigned_managers', 'ceo'], severity: 'warning',
                               title: 'Property rejected' },
  'property.published':      { audience: ['assistant_ceos'],    severity: 'info',
                               title: 'Property published' },
  'property.deleted':        { audience: ['ceo'],               severity: 'critical',
                               title: 'Property removed' }
};

/* node_id is a path, so an assignment covers its descendants — the same
   prefix rule rbac.isWithinScope uses. Duplicated here rather than
   imported because rbac.js pulls in the request/response layer, and the
   bus must be callable from anywhere.

   Two copies of a security-critical prefix rule can drift, and a drifted
   copy here would silently misroute notifications across area boundaries.
   So it is EXPORTED purely so tests/permission-matrix.html can assert
   that it agrees with isWithinScope on every case — the claim in this
   comment is checked, not trusted. */
export function covers(assignedNodeId, targetNodeId) {
  if (!assignedNodeId || !targetNodeId) return false;
  return targetNodeId === assignedNodeId || targetNodeId.indexOf(assignedNodeId + '/') === 0;
}

async function resolveRecipients(db, spec, event) {
  var ids = {};

  for (var i = 0; i < spec.audience.length; i++) {
    var group = spec.audience[i];

    if (group === 'managers') {
      if (event.recipientId) ids[event.recipientId] = true;
      continue;
    }

    if (group === 'ceo') {
      var ceos = await db.from('admin_users').select('id').eq('role', 'ceo').eq('status', 'active');
      if (!ceos.error) (ceos.data || []).forEach(function (u) { ids[u.id] = true; });
      continue;
    }

    /* Area-scoped groups. Without an area we cannot target anyone
       meaningfully, so we send to nobody rather than to everybody —
       broadcasting on missing data is how notification systems become
       noise people learn to ignore. */
    if (!event.areaNodeId) continue;

    var role = group === 'assistant_ceos' ? 'assistant_ceo' : 'manager';
    var rows = await db.from('admin_area_assignments')
      .select('user_id, node_id, admin_users!inner(id, role, status)')
      .eq('active', true)
      .eq('scope_role', role);
    if (rows.error) continue;

    (rows.data || []).forEach(function (a) {
      if (!a.admin_users || a.admin_users.status !== 'active') return;
      if (covers(a.node_id, event.areaNodeId)) ids[a.user_id] = true;
    });
  }

  /* Never notify someone about their own action — an inbox full of your
     own keystrokes is an inbox nobody reads. */
  if (event.actorId) delete ids[event.actorId];

  return Object.keys(ids);
}

/* Publishes one event to everyone the catalogue says should hear it.

   Fire-and-forget from the caller's perspective: a failed notification
   must never fail the business action that triggered it. Losing a message
   is bad; losing a verification because a message failed is worse. */
export async function publish(env, event) {
  try {
    var spec = EVENTS[event.type];
    if (!spec) {
      console.error('notify: unknown event type', event.type);
      return { sent: 0 };
    }

    var db = getServiceClient(env);
    var recipients = await resolveRecipients(db, spec, event);
    if (!recipients.length) return { sent: 0 };

    var rows = recipients.map(function (rid) {
      return {
        recipient_id: rid,
        event_type: event.type,
        title: event.title || spec.title,
        body: event.body || null,
        entity_type: event.entityType || null,
        entity_id: event.entityId != null ? String(event.entityId) : null,
        actor_id: event.actorId || null,
        area_node_id: event.areaNodeId || null,
        severity: event.severity || spec.severity,
        source: event.source || 'system'
      };
    });

    var res = await db.from('notifications').insert(rows);
    if (res.error) {
      console.error('notify: insert failed', event.type, res.error.message);
      return { sent: 0 };
    }
    return { sent: rows.length };
  } catch (e) {
    console.error('notify: threw', event && event.type, e && e.message);
    return { sent: 0 };
  }
}

export async function markRead(env, userId, ids) {
  var db = getServiceClient(env);
  var q = db.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)          // scoped: you can only read your own
    .is('read_at', null);
  if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
  var res = await q;
  if (res.error) throw res.error;
  return { ok: true };
}

export async function listFor(env, userId, opts) {
  var db = getServiceClient(env);
  var limit = Math.min((opts && opts.limit) || 50, 200);
  var q = db.from('notifications')
    .select('id, event_type, title, body, entity_type, entity_id, severity, read_at, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts && opts.unreadOnly) q = q.is('read_at', null);

  var res = await q;
  if (res.error) throw res.error;
  return res.data || [];
}

export async function unreadCount(env, userId) {
  var db = getServiceClient(env);
  var res = await db.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (res.error) return 0;
  return res.count || 0;
}
