/* GET  /api/admin/lifecycle?listingId=…  → current state, legal next moves,
                                             and the complete status history
   POST /api/admin/lifecycle              → { listingId, toState, reason }

   The single HTTP entry point for moving a property through the eight
   operational states. All the rules (legal transitions, which role may
   drive which, when a reason is mandatory) live in
   functions/utils/lifecycle.js — this file is transport, scope and
   notification only.

   "Every status change must be stored": the history rows come from the
   transition itself, not from this handler remembering to log. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { transition, availableTransitions, STATE_LABEL } from '../../utils/lifecycle.js';
import { auditFor } from '../../utils/audit.js';
import { publish } from '../../utils/notify.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

/* Resolves the listing plus the property context every check needs. */
async function loadListing(db, listingId) {
  var res = await db.from('listings')
    .select('id, lifecycle_state, status, units!inner(property_id, properties!inner(id, business_code, area_node_id, added_by_admin_id))')
    .eq('id', listingId).maybeSingle();
  if (res.error) throw res.error;
  return res.data;
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var listingId = new URL(context.request.url).searchParams.get('listingId');
  if (!isNonEmptyString(listingId, 60)) {
    return json(env, { error: 'listingId is required.' }, 422);
  }

  try {
    var db = getServiceClient(env);
    var l = await loadListing(db, listingId);
    if (!l) return json(env, { error: 'No such listing.' }, 404);

    var prop = l.units.properties;
    var scope = await getScopeNodeIds(env, auth.user);
    if (!isWithinScope(scope, prop.area_node_id)) {
      return json(env, { error: 'That property is outside your assigned areas.' }, 403);
    }

    var state = l.lifecycle_state || 'submitted';
    var hist = await db.from('listing_status_history')
      .select('id, from_state, to_state, actor_id, actor_role, actor_kind, reason, before_value, after_value, at, admin_users(full_name)')
      .eq('listing_id', listingId)
      .order('at', { ascending: false });
    if (hist.error) throw hist.error;

    return json(env, {
      listingId: listingId,
      businessCode: prop.business_code,
      state: state,
      stateLabel: STATE_LABEL[state],
      /* Only the moves THIS role may actually make — the console renders
         buttons from this, so it cannot offer a transition the API would
         then refuse. */
      availableTransitions: availableTransitions(auth.user.role, state).map(function (s) {
        return { state: s, label: STATE_LABEL[s] };
      }),
      history: (hist.data || []).map(function (h) {
        return {
          id: h.id,
          from: h.from_state, fromLabel: h.from_state ? STATE_LABEL[h.from_state] : null,
          to: h.to_state, toLabel: STATE_LABEL[h.to_state],
          actorName: h.admin_users ? h.admin_users.full_name : (h.actor_kind === 'system' ? 'System' : null),
          actorRole: h.actor_role,
          actorKind: h.actor_kind,
          reason: h.reason,
          before: h.before_value,
          after: h.after_value,
          at: h.at
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load lifecycle.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.listingId, 60)) return json(env, { error: 'listingId is required.' }, 422);
  if (!isNonEmptyString(body.toState, 40)) return json(env, { error: 'toState is required.' }, 422);

  try {
    var db = getServiceClient(env);
    var l = await loadListing(db, body.listingId);
    if (!l) return json(env, { error: 'No such listing.' }, 404);

    var prop = l.units.properties;
    var scope = await getScopeNodeIds(env, auth.user);
    if (!isWithinScope(scope, prop.area_node_id)) {
      return json(env, { error: 'That property is outside your assigned areas.' }, 403);
    }

    /* Separation of duties carries into the lifecycle: the person who
       added a property cannot be the one who declares it Verified or
       pushes it Published (ADR 0001 §4 — the same rule the DB enforces
       for verifications and approvals). */
    if ((body.toState === 'verified' || body.toState === 'published') &&
        prop.added_by_admin_id && prop.added_by_admin_id === auth.user.id) {
      return json(env, {
        error: 'Separation of duties: you added this property, so someone else must ' +
               (body.toState === 'verified' ? 'verify' : 'publish') + ' it.'
      }, 403);
    }

    var result = await transition(env, {
      listingId: body.listingId,
      toState: body.toState,
      actor: auth.user,
      reason: body.reason
    });

    if (!result.ok) {
      var status = result.code === 'forbidden' ? 403
        : result.code === 'not_found' ? 404
        : result.code === 'db' ? 500 : 409;
      return json(env, { error: result.error, code: result.code }, status);
    }

    await auditFor(env, auth.user, context.request)(
      'lifecycle_transition', 'listing', body.listingId, {
        from: result.from, to: result.to, reason: body.reason || null
      });

    /* Notifications go through the bus, never sent from here directly
       (Doc 18 Article 4.4). The bus decides who hears about it. */
    var notifyType = body.toState === 'published' ? 'property.published'
      : body.toState === 'rejected' ? 'property.rejected'
      : body.toState === 'deleted' ? 'property.deleted'
      : null;
    if (notifyType) {
      await publish(env, {
        type: notifyType,
        entityType: 'listing', entityId: body.listingId,
        areaNodeId: prop.area_node_id,
        actorId: auth.user.id,
        body: prop.business_code + ' — ' + STATE_LABEL[result.to] +
              (body.reason ? ': ' + body.reason : '')
      });
    }

    return json(env, {
      ok: true, from: result.from, to: result.to,
      stateLabel: STATE_LABEL[result.to],
      warning: result.warning || undefined
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Transition failed.' }, 500);
  }
}
