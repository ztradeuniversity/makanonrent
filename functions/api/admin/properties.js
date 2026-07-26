/* GET  /api/admin/properties      → properties visible to the caller
   POST /api/admin/properties      → { action: 'archive' | 'restore' }

   "Remove properties / Restore properties" is CEO-only and is an ARCHIVE
   toggle, never a DELETE — Doc 18 Article 2.4 / NFR-17 forbid hard
   deletes on business entities, and a removed property still has to
   explain itself in a dispute months later.

   Adding a property is NOT here: it goes through the existing
   /api/properties/submit pipeline so admin-added and owner-submitted
   properties travel one code path. The admin-specific part of that
   (stamping added_by_admin_id, which is what the separation-of-duty rule
   keys off) is a follow-up on that endpoint — see the summary notes. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { transition, STATE_LABEL } from '../../utils/lifecycle.js';
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
    var includeArchived = url.searchParams.get('archived') === '1';

    var q = db.from('listings')
      .select('id, status, lifecycle_state, approval_state, availability_state, rent_amount_minor, published_at, archived_at, deleted_at, created_at, units!inner(id, properties!inner(id, business_code, property_type, city_name, area_name, area_node_id, added_by_admin_id))')
      .order('created_at', { ascending: false })
      .limit(500);

    /* Archived AND deleted are both hidden by default. Neither is ever
       removed from the table — 'deleted' is a state, not a DELETE
       (ADR 0002 §4). */
    if (!includeArchived) q = q.is('archived_at', null).is('deleted_at', null);

    var res = await q;
    if (res.error) throw res.error;

    var scope = await getScopeNodeIds(env, auth.user);
    var rows = (res.data || [])
      .map(function (l) {
        var p = l.units.properties;
        return {
          listingId: l.id,
          propertyId: p.id,
          businessCode: p.business_code,
          propertyType: p.property_type,
          cityName: p.city_name,
          areaName: p.area_name,
          areaNodeId: p.area_node_id,
          status: l.status,
          /* The operational state the console shows. `status` is kept in
             the payload for any consumer still reading the frozen enum. */
          lifecycleState: l.lifecycle_state,
          lifecycleLabel: STATE_LABEL[l.lifecycle_state] || l.lifecycle_state,
          approvalState: l.approval_state,
          availabilityState: l.availability_state,
          rentAmountMinor: l.rent_amount_minor,
          publishedAt: l.published_at,
          archivedAt: l.archived_at,
          deletedAt: l.deleted_at,
          selfAdded: p.added_by_admin_id === auth.user.id,
          createdAt: l.created_at
        };
      })
      .filter(function (r) { return isWithinScope(scope, r.areaNodeId); });

    return json(env, { properties: rows });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load properties.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var capability = body.action === 'restore' ? 'properties.restore' : 'properties.archive';
  var auth = await requireCapability(context, capability);
  if (auth.response) return auth.response;

  if (body.action !== 'archive' && body.action !== 'restore') {
    return json(env, { error: "action must be 'archive' or 'restore'." }, 422);
  }
  if (!isNonEmptyString(body.listingId, 60)) return json(env, { error: 'listingId is required.' }, 422);

  try {
    var db = getServiceClient(env);
    var cur = await db.from('listings')
      .select('id, status, lifecycle_state, archived_at').eq('id', body.listingId).maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return json(env, { error: 'No such listing.' }, 404);

    if (body.action === 'archive' && !isNonEmptyString(body.reason, 2000)) {
      return json(env, { error: 'A reason is required when removing a property.' }, 422);
    }

    /* Routed through the lifecycle service rather than patched here: it
       is the only writer of listings.status (Doc 16 AM-3.3, ADR 0002 §5),
       and it is what records the status-history row the CEO audit reads.
       Restoring lands in Pending Review, never straight back to Published
       — something removed for a reason gets re-examined. */
    var t = await transition(env, {
      listingId: body.listingId,
      toState: body.action === 'archive' ? 'archived' : 'pending_review',
      actor: auth.user,
      reason: body.reason || (body.action === 'restore' ? 'Restored by CEO' : null)
    });

    if (!t.ok) {
      var code = t.code === 'forbidden' ? 403 : t.code === 'not_found' ? 404 : 409;
      return json(env, { error: t.error }, code);
    }

    if (body.action === 'restore') {
      /* Re-opening the approval chain is approval-state bookkeeping, not
         trust state, so it is ours to write. */
      var upd = await db.from('listings')
        .update({ approval_state: 'pending_manager', published_at: null })
        .eq('id', body.listingId);
      if (upd.error) throw upd.error;
    }

    await auditFor(env, auth.user, context.request)(
      body.action === 'archive' ? 'archive_property' : 'restore_property',
      'listing', body.listingId, { from: t.from, to: t.to, reason: body.reason || null });

    return json(env, { ok: true, from: t.from, to: t.to, warning: t.warning || undefined });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Request failed.' }, 500);
  }
}
