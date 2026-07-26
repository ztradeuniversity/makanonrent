/* GET /api/admin/monitor        → the CEO monitoring table
   GET /api/admin/monitor?audit=1 → recent audit events (CEO only)

   Every column the brief specifies for the CEO dashboard comes from the
   admin_manager_overview VIEW, not from SQL assembled here. That is
   deliberate: a future AI performance analyser (ADR §6) must read exactly
   the same numbers the CEO sees, and two hand-written queries would drift
   apart the first time either is edited. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { requireCapability } from '../../utils/rbac.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  var url = new URL(context.request.url);

  if (url.searchParams.get('audit')) return auditFeed(context);

  var auth = await requireCapability(context, 'monitor.read');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var q = db.from('admin_manager_overview').select('*').order('full_name', { ascending: true });

    /* An Assistant CEO monitors Managers; the CEO monitors everyone. */
    if (auth.user.role === 'assistant_ceo') q = q.eq('role', 'manager');

    var res = await q;
    if (res.error) throw res.error;

    /* Average response time = mean hours from a property entering the
       system to its first verification. Computed here rather than in the
       view because it is the one metric that needs a per-user join over
       two tables with a time delta, and folding it into the view would
       make every dashboard load pay for it. */
    var avg = await averageResponseHours(db);

    return json(env, {
      managers: (res.data || []).map(function (m) {
        return {
          userId: m.user_id,
          name: m.full_name,
          username: m.username,
          role: m.role,
          status: m.status,
          assignedAreas: m.assigned_area_count,
          pendingTasks: m.pending_tasks,
          completedTasks: m.completed_tasks,
          verificationPct: m.verification_pct,
          availableProperties: m.available_properties,
          unavailableProperties: m.unavailable_properties,
          newPropertiesAdded: m.new_properties_added,
          averageResponseHours: avg[m.user_id] != null ? avg[m.user_id] : null,
          lastLoginAt: m.last_login_at,
          lastVerificationAt: m.last_verification_at
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load monitoring data.' }, 500);
  }
}

async function averageResponseHours(db) {
  var res = await db.from('property_verifications')
    .select('verified_by, verified_at, properties!inner(created_at)')
    .order('verified_at', { ascending: false })
    .limit(2000);
  if (res.error || !res.data) return {};

  var acc = {};
  res.data.forEach(function (v) {
    var created = v.properties && v.properties.created_at;
    if (!created) return;
    var hours = (new Date(v.verified_at) - new Date(created)) / 3600000;
    if (!(hours >= 0)) return;
    if (!acc[v.verified_by]) acc[v.verified_by] = { sum: 0, n: 0 };
    acc[v.verified_by].sum += hours;
    acc[v.verified_by].n += 1;
  });

  var out = {};
  Object.keys(acc).forEach(function (k) {
    out[k] = Math.round(10 * acc[k].sum / acc[k].n) / 10;
  });
  return out;
}

async function auditFeed(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'audit.read');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var url = new URL(context.request.url);
    var limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

    var q = db.from('admin_audit_log')
      .select('id, actor_id, actor_role, action, entity_type, entity_id, detail, ip, at')
      .order('at', { ascending: false })
      .limit(limit);

    var actorId = url.searchParams.get('actorId');
    if (actorId) q = q.eq('actor_id', actorId);

    var res = await q;
    if (res.error) throw res.error;

    return json(env, {
      events: (res.data || []).map(function (e) {
        return {
          id: e.id, actorId: e.actor_id, actorRole: e.actor_role, action: e.action,
          entityType: e.entity_type, entityId: e.entity_id, detail: e.detail,
          ip: e.ip, at: e.at
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load the audit log.' }, 500);
  }
}
