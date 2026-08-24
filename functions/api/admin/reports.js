/* GET /api/admin/reports?report=…  → CEO reporting suite
   GET /api/admin/performance       → see performance.js (manager-facing)

   Reports available (the brief's CEO dashboard list):
     managers   — best and worst, from ONE ranked view read from both ends
     areas      — area performance
     growth     — property growth per day
     trends     — verification trends per day
     workload   — pending workload and how stale it is

   Every figure comes from a view defined in
   migrations/0005_property_operations.sql. Nothing is aggregated in JS
   here: at 100 managers and unlimited properties, per-request aggregation
   in a Worker is the thing that falls over first (ADR 0002 §9). */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { requireCapability, getVisibleSubordinateIds } from '../../utils/rbac.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var REPORTS = ['managers', 'areas', 'growth', 'trends', 'workload'];

export async function onRequestGet(context) {
  var env = context.env;
  /* monitor.read is CEO + Assistant CEO. Reports are oversight, and the
     Assistant CEO's own scope filtering happens per-report below. */
  var auth = await requireCapability(context, 'monitor.read');
  if (auth.response) return auth.response;

  var url = new URL(context.request.url);
  var report = url.searchParams.get('report') || 'managers';
  if (REPORTS.indexOf(report) === -1) {
    return json(env, { error: 'report must be one of: ' + REPORTS.join(', ') + '.' }, 422);
  }

  var days = Math.min(Number(url.searchParams.get('days')) || 30, 365);

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    if (report === 'managers') {
      var q = db.from('admin_report_manager_ranking')
        .select('*')
        .order('performance_score', { ascending: false, nullsFirst: false });
      /* Same hierarchy leak already found and fixed in users.js/
         assignments.js/monitor.js (governance pass, audited 2026-08-24):
         `.eq('role', 'manager')` alone ranked every Manager system-wide
         for any Assistant CEO, not just their own. getVisibleSubordinateIds
         is the same shared definition every other endpoint uses. */
      if (auth.user.role === 'assistant_ceo') {
        var reportMgrIds = await getVisibleSubordinateIds(env, auth.user);
        q = reportMgrIds.length ? q.eq('role', 'manager').in('user_id', reportMgrIds)
          : q.eq('user_id', '00000000-0000-0000-0000-000000000000');
      }

      var res = await q;
      if (res.error) throw res.error;
      var rows = (res.data || []).map(mapManager);

      /* Best and worst are the two ends of ONE ordering. Computing them
         as separate queries would let them disagree about the middle. */
      var ranked = rows.filter(function (r) { return r.performanceScore != null; });
      return json(env, {
        report: 'managers',
        managers: rows,
        best: ranked.slice(0, 5),
        worst: ranked.slice(-5).reverse()
      });
    }

    if (report === 'areas') {
      var ares = await db.from('admin_report_area_performance')
        .select('*')
        .order('total_properties', { ascending: false });
      if (ares.error) throw ares.error;

      return json(env, {
        report: 'areas',
        areas: (ares.data || []).map(function (a) {
          return {
            areaNodeId: a.area_node_id, cityName: a.city_name, areaName: a.area_name,
            totalProperties: a.total_properties, published: a.published,
            unavailable: a.unavailable, pending: a.pending, rejected: a.rejected,
            verifications: a.verifications
          };
        })
      });
    }

    if (report === 'growth') {
      var since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      var gres = await db.from('admin_report_property_growth')
        .select('*').gte('day', since).order('day', { ascending: true });
      if (gres.error) throw gres.error;

      return json(env, {
        report: 'growth', days: days,
        series: (gres.data || []).map(function (g) {
          return {
            day: g.day, added: g.properties_added,
            byStaff: g.added_by_staff, byPublic: g.added_by_public
          };
        })
      });
    }

    if (report === 'trends') {
      var tsince = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      var tres = await db.from('admin_report_verification_trend')
        .select('*').gte('day', tsince).order('day', { ascending: true });
      if (tres.error) throw tres.error;

      return json(env, {
        report: 'trends', days: days,
        series: (tres.data || []).map(function (t) {
          return { day: t.day, total: t.total, available: t.available, unavailable: t.unavailable };
        })
      });
    }

    /* workload */
    var wres = await db.from('admin_report_pending_workload').select('*');
    if (wres.error) throw wres.error;

    return json(env, {
      report: 'workload',
      workload: (wres.data || []).map(function (w) {
        return {
          state: w.lifecycle_state, listings: w.listings,
          avgAgeDays: w.avg_age_days, oldestAgeDays: w.oldest_age_days
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not build that report.' }, 500);
  }
}

function mapManager(m) {
  return {
    userId: m.user_id, name: m.full_name, role: m.role, status: m.status,
    verificationPct: m.verification_pct,
    approvalPct: m.approval_pct,
    rejectedPct: m.rejected_pct,
    inactiveDays: m.inactive_days,
    totalVerifications: m.total_verifications,
    performanceScore: m.performance_score
  };
}
