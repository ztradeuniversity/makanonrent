/* MakanOnRent — append-only audit trail for the admin console.
   Doc 18 Article 9.5: "Every mutation and every sensitive read emits an
   audit event. The audit log is append-only."

   Append-only is enforced by a database trigger, not here and not by RLS
   (see migrations/0004_admin_rbac.sql — the service role bypasses RLS, so
   an RLS policy would protect nothing from the only client that can reach
   the table). This module is just the writer. */
import { getServiceClient } from './supabase.js';

/* Fire-and-forget by design. An audit write must never turn a successful
   business action into a failed HTTP response — losing the action is
   worse than losing its log line, and the alternative (failing the request)
   makes the audit log a single point of failure for the whole console.
   Failures surface in Workers logs instead. */
export function logAudit(env, entry) {
  try {
    var db = getServiceClient(env);
    var row = {
      actor_id: entry.actorId || null,
      actor_role: entry.actorRole || null,
      action: entry.action,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId != null ? String(entry.entityId) : null,
      detail: entry.detail || null,
      ip: entry.request ? (entry.request.headers.get('CF-Connecting-IP') || null) : null,
      user_agent: entry.request ? (entry.request.headers.get('User-Agent') || '').slice(0, 400) || null : null
    };
    return db.from('admin_audit_log').insert(row).then(
      function () {},
      function (e) { console.error('audit write failed', entry.action, e && e.message); }
    );
  } catch (e) {
    console.error('audit write threw', e && e.message);
    return Promise.resolve();
  }
}

/* Convenience wrapper for the common "actor did X to Y" shape. */
export function auditFor(env, user, request) {
  return function (action, entityType, entityId, detail) {
    return logAudit(env, {
      actorId: user && user.id,
      actorRole: user && user.role,
      action: action,
      entityType: entityType,
      entityId: entityId,
      detail: detail,
      request: request
    });
  };
}
