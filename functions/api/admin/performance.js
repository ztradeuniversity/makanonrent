/* GET /api/admin/performance[?userId=…]  → the manager performance card

   Serves the brief's Manager dashboard block: today's / weekly / monthly
   tasks, verification %, approval %, rejected %, inactive days.

   A Manager may only ever read their own card. A CEO or Assistant CEO may
   read anyone's — and reads the SAME view the manager sees, so a
   performance conversation is never two people quoting different numbers
   at each other (that is why admin_manager_performance is one view and
   not per-dashboard SQL). */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { requireAuth, can, canManageRole } from '../../utils/rbac.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var requested = new URL(context.request.url).searchParams.get('userId');
  var targetId = auth.user.id;

  if (requested && requested !== auth.user.id) {
    /* Reading someone else's performance is an oversight action. */
    if (!can(auth.user.role, 'monitor.read')) {
      return json(env, { error: 'You can only view your own performance.' }, 403);
    }
    targetId = requested;
  }

  try {
    var db = getServiceClient(env);

    var res = await db.from('admin_manager_performance')
      .select('*').eq('user_id', targetId).maybeSingle();
    if (res.error) throw res.error;

    /* A CEO has no row in this view (it covers managers and assistant
       CEOs). That is correct, not an error — the CEO has no assigned
       targets to be measured against. */
    if (!res.data) {
      return json(env, {
        performance: null,
        note: auth.user.id === targetId && auth.user.role === 'ceo'
          ? 'The CEO role carries no assigned verification targets, so there is no performance card.'
          : 'No performance record for that user.'
      });
    }

    /* An Assistant CEO may inspect Managers, not peers. */
    if (auth.user.role === 'assistant_ceo' && targetId !== auth.user.id &&
        !canManageRole(auth.user.role, res.data.role)) {
      return json(env, { error: 'You cannot view that user\'s performance.' }, 403);
    }

    var p = res.data;
    return json(env, {
      performance: {
        userId: p.user_id,
        name: p.full_name,
        role: p.role,
        status: p.status,
        tasksToday: p.tasks_today,
        tasksWeek: p.tasks_week,
        tasksMonth: p.tasks_month,
        verificationPct: p.verification_pct,
        approvalPct: p.approval_pct,
        rejectedPct: p.rejected_pct,
        approvalsGiven: p.approvals_given,
        rejectionsGiven: p.rejections_given,
        /* Days since real work, not since last login — logging in is not
           activity (see the view definition). null = never verified. */
        inactiveDays: p.inactive_days,
        lastLoginAt: p.last_login_at,
        lastVerificationAt: p.last_verification_at
      }
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load performance.' }, 500);
  }
}
