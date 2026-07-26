/* GET  /api/admin/approvals?listingId=…  → decision history for a listing
   GET  /api/admin/approvals?queue=1      → listings awaiting THIS caller
   POST /api/admin/approvals              → { listingId, decision, comment }

   Property Approval Workflow:
     User submits → Manager review → Assistant CEO (optional)
                  → CEO (optional) → Published

   Which of those tiers actually run is the CEO-configured chain in
   admin_settings (functions/utils/approval-chain.js). Auto Publish, when
   enabled, short-circuits the tiers after Manager.

   What Auto Publish CANNOT do is let one identity both submit and approve
   — enforce_approval_sod rejects that in the database (ADR §4). */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { getWorkflowConfig, currentStage, nextStage, STAGE_STATE } from '../../utils/approval-chain.js';
import { transition } from '../../utils/lifecycle.js';
import { publish } from '../../utils/notify.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var url = new URL(context.request.url);
    var listingId = url.searchParams.get('listingId');

    if (listingId) {
      var hist = await db.from('property_approvals')
        .select('id, stage, decision, comment, decided_at, admin_users!inner(id, full_name, role)')
        .eq('listing_id', listingId)
        .order('decided_at', { ascending: true });
      if (hist.error) throw hist.error;

      return json(env, {
        history: (hist.data || []).map(function (h) {
          return {
            id: h.id, stage: h.stage, decision: h.decision, comment: h.comment,
            decidedAt: h.decided_at,
            actor: { id: h.admin_users.id, name: h.admin_users.full_name, role: h.admin_users.role }
          };
        })
      });
    }

    /* Queue: listings whose current stage matches the caller's role. */
    var cfg = await getWorkflowConfig(env);
    var myState = STAGE_STATE[auth.user.role];
    if (!myState || cfg.chain.indexOf(auth.user.role) === -1) {
      return json(env, { listings: [], chain: cfg.chainKey, autoPublish: cfg.autoPublish });
    }

    var q = db.from('listings')
      .select('id, status, approval_state, rent_amount_minor, created_at, units!inner(id, properties!inner(id, business_code, city_name, area_name, area_node_id, added_by_admin_id))')
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(300);

    /* The first stage also picks up listings that have no approval_state
       yet — every pre-existing row and every fresh public submission. */
    if (cfg.chain[0] === auth.user.role) {
      q = q.or('approval_state.is.null,approval_state.eq.' + myState + ',approval_state.eq.returned');
    } else {
      q = q.eq('approval_state', myState);
    }

    var res = await q;
    if (res.error) throw res.error;

    var scope = await getScopeNodeIds(env, auth.user);
    var rows = (res.data || [])
      .map(function (l) {
        var p = l.units.properties;
        return {
          listingId: l.id, status: l.status, approvalState: l.approval_state,
          rentAmountMinor: l.rent_amount_minor,
          property: {
            id: p.id, businessCode: p.business_code, cityName: p.city_name,
            areaName: p.area_name, areaNodeId: p.area_node_id
          },
          selfAdded: p.added_by_admin_id === auth.user.id,
          createdAt: l.created_at
        };
      })
      .filter(function (r) { return isWithinScope(scope, r.property.areaNodeId); });

    return json(env, { listings: rows, chain: cfg.chainKey, autoPublish: cfg.autoPublish });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load approvals.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'properties.approve');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.listingId, 60)) return json(env, { error: 'listingId is required.' }, 422);
  if (['approve', 'reject', 'return'].indexOf(body.decision) === -1) {
    return json(env, { error: "decision must be 'approve', 'reject' or 'return'." }, 422);
  }
  /* A rejection or a return without a reason is unusable to the manager
     receiving it, so the comment is mandatory for both. */
  if (body.decision !== 'approve' && !isNonEmptyString(body.comment, 2000)) {
    return json(env, { error: 'A comment is required when rejecting or returning a property.' }, 422);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    var audit = auditFor(env, auth.user, context.request);
    var cfg = await getWorkflowConfig(env);

    var lres = await db.from('listings')
      .select('id, status, approval_state, archived_at, units!inner(property_id, properties!inner(id, area_node_id, added_by_admin_id))')
      .eq('id', body.listingId).maybeSingle();
    if (lres.error) throw lres.error;
    if (!lres.data) return json(env, { error: 'No such listing.' }, 404);
    if (lres.data.archived_at) return json(env, { error: 'That listing is archived.' }, 409);

    var prop = lres.data.units.properties;

    var scope = await getScopeNodeIds(env, auth.user);
    if (!isWithinScope(scope, prop.area_node_id)) {
      return json(env, { error: 'That property is outside your assigned areas.' }, 403);
    }

    var stage = currentStage(cfg.chain, lres.data.approval_state);
    if (!stage) {
      return json(env, { error: 'That listing has already completed its approval workflow.' }, 409);
    }
    /* The CEO overrides every decision (per the brief), so they may act at
       any stage. Everyone else may only act at their own stage. */
    if (stage !== auth.user.role && auth.user.role !== 'ceo') {
      return json(env, { error: 'That property is not awaiting your approval.' }, 409);
    }

    if (body.decision === 'approve' && prop.added_by_admin_id === auth.user.id) {
      return json(env, {
        error: 'Separation of duties: you added this property, so someone else must approve it.'
      }, 403);
    }

    /* A manager may only approve a property that has actually been
       verified Available. Doc 04 §1.4 rule 2 forbids a listing entering
       verified_live without an approved verification behind it — this is
       where that rule is honoured rather than asserted. */
    if (body.decision === 'approve' && stage === 'manager') {
      var v = await db.from('property_verifications')
        .select('status').eq('property_id', prop.id)
        .order('verified_at', { ascending: false }).limit(1).maybeSingle();
      if (v.error) throw v.error;
      if (!v.data || v.data.status !== 'available') {
        return json(env, {
          error: 'Verify this property as Available before approving it.'
        }, 409);
      }
    }

    var actingStage = auth.user.role === 'ceo' && stage !== 'ceo' ? stage : auth.user.role;
    var ins = await db.from('property_approvals').insert({
      listing_id: body.listingId,
      actor_id: auth.user.id,
      actor_role: auth.user.role,
      stage: actingStage,
      decision: body.decision,
      comment: isNonEmptyString(body.comment, 2000) ? body.comment : null
    }).select('id').single();
    if (ins.error) throw ins.error;   // SoD trigger surfaces here

    var patch = {};
    var published = false;
    var lifecycleTarget = null;
    var nextRole = null;

    if (body.decision === 'reject') {
      patch = { approval_state: 'rejected' };
      lifecycleTarget = 'rejected';
    } else if (body.decision === 'return') {
      patch = { approval_state: 'returned' };
    } else {
      var next = nextStage(cfg.chain, actingStage, cfg.autoPublish);
      if (next) {
        patch = { approval_state: STAGE_STATE[next] };
        nextRole = next;
      } else {
        patch = {
          approval_state: 'approved',
          approved_by: auth.user.id,
          approved_at: new Date().toISOString()
        };
        lifecycleTarget = 'published';
        published = true;
      }
    }

    /* approval_state is the approval-chain column and is ours to write.
       listings.status is PUBLIC TRUST STATE and is NOT — it moves only
       through the lifecycle service (Doc 16 AM-3.3, ADR 0002 §5). ADR
       0001 shipped a direct `status: 'verified_live'` write here; that is
       now both removed and impossible — trg_listing_status_guard rejects
       a status write that does not come with a lifecycle_state change. */
    var upd = await db.from('listings').update(patch).eq('id', body.listingId);
    if (upd.error) throw upd.error;

    var warning;
    if (lifecycleTarget) {
      var t = await transition(env, {
        listingId: body.listingId,
        toState: lifecycleTarget,
        actor: auth.user,
        reason: body.comment || (lifecycleTarget === 'published'
          ? 'Approved via ' + cfg.chainKey + (cfg.autoPublish ? ' (auto publish)' : '')
          : null)
      });
      if (!t.ok) {
        /* The decision is already recorded in property_approvals, so the
           approval stands but the property did not move. Reported, never
           swallowed — a silent half-completed approval is how a listing
           ends up stuck in a state nobody can explain. */
        warning = 'Decision recorded, but the property could not move to ' +
                  lifecycleTarget + ': ' + t.error;
        published = false;
      } else {
        warning = t.warning;
      }
    }

    await audit('approval_decision', 'listing', body.listingId, {
      decision: body.decision, stage: actingStage, published: published,
      chain: cfg.chainKey, autoPublish: cfg.autoPublish
    });

    /* Notifications via the bus only (Doc 18 Article 4.4). */
    if (body.decision === 'return') {
      await publish(env, {
        type: 'review.returned', recipientId: prop.added_by_admin_id,
        entityType: 'listing', entityId: body.listingId,
        areaNodeId: prop.area_node_id, actorId: auth.user.id,
        body: body.comment
      });
    } else if (nextRole) {
      await publish(env, {
        type: 'approval.pending',
        entityType: 'listing', entityId: body.listingId,
        areaNodeId: prop.area_node_id, actorId: auth.user.id,
        body: 'Awaiting ' + nextRole.replace('_', ' ') + ' approval.'
      });
      if (auth.user.role === 'assistant_ceo') {
        await publish(env, {
          type: 'approval.by_assistant',
          entityType: 'listing', entityId: body.listingId,
          areaNodeId: prop.area_node_id, actorId: auth.user.id
        });
      }
    }

    return json(env, {
      ok: true, decision: body.decision, published: published,
      approvalState: patch.approval_state,
      warning: warning || undefined
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Approval failed.' }, 500);
  }
}
