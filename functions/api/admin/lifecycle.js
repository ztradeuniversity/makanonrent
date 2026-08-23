/* GET  /api/admin/lifecycle?listingId=…  → the full property review: state,
                                             legal next moves, status history,
                                             property/location detail, owner
                                             identity, assigned manager, and
                                             every media item (any visibility)
   POST /api/admin/lifecycle              → { listingId, toState, reason }

   This is the CEO/manager "open a property and see everything" surface.
   It was previously state-and-history only; the property/owner/media
   sections below were added here — the existing drill-in endpoint and
   drawer the console already had — rather than as a second review screen,
   per the standing rule against parallel admin architecture.

   All lifecycle RULES (legal transitions, which role may drive which,
   when a reason is mandatory) still live in functions/utils/lifecycle.js
   — this file remains transport, scope, notification, and now review data.

   "Every status change must be stored": the history rows come from the
   transition itself, not from this handler remembering to log. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { transition, availableTransitions, STATE_LABEL } from '../../utils/lifecycle.js';
import { auditFor } from '../../utils/audit.js';
import { publish } from '../../utils/notify.js';
import { presignGetUrl, deleteObjects } from '../../utils/r2.js';

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

var TYPE_LABEL = {
  house: 'House', flat: 'Flat', portion: 'Portion',
  office: 'Office', shop: 'Shop', room: 'Room', other: 'Other'
};

/* The deepest active assignment whose node_id covers this property's
   area_node_id — same prefix rule isWithinScope uses, so "who is
   assigned here" and "who can see this" never disagree. Longest node_id
   wins: a sub-location assignment is more specific than the city-level
   one that also technically covers it. */
function primaryAssignment(assignments, areaNodeId) {
  if (!areaNodeId) return null;
  var covering = assignments.filter(function (a) {
    return areaNodeId === a.node_id || areaNodeId.indexOf(a.node_id + '/') === 0;
  });
  if (!covering.length) return null;
  covering.sort(function (a, b) { return b.node_id.length - a.node_id.length; });
  return covering[0];
}

/* Everything a reviewer needs about the property itself, its owner, its
   assigned manager, and its media — reusing exactly the tables and the
   R2 signer every other read path already uses. No new table, no new
   media API: media is read straight from property_media and signed with
   the same presignGetUrl() the public gallery route calls, the only
   difference being every visibility state is included here (this is an
   authenticated, scoped staff read, not the public one). */
async function loadReviewDetail(env, db, listing, callerScope) {
  var propertyId = listing.units.property_id;
  var prop = listing.units.properties;

  var unitRes = await db.from('units')
    .select('unit_type, beds, baths, car_porch, size_value, size_unit')
    .eq('property_id', propertyId).limit(1).maybeSingle();
  var unit = (!unitRes.error && unitRes.data) || {};

  var propRes = await db.from('properties')
    .select('category, property_type, city_slug, city_name, area_slug, area_name, landmark, road_width_ft, created_at')
    .eq('id', propertyId).maybeSingle();
  var propFull = (!propRes.error && propRes.data) || {};

  var listRes = await db.from('listings')
    .select('currency, rent_amount_minor, advance_amount_minor, negotiable, features, note, created_at')
    .eq('id', listing.id).maybeSingle();
  var listFull = (!listRes.error && listRes.data) || {};

  var sub = prop.area_node_id ? String(prop.area_node_id).split('/') : [];
  var subLocation = sub.length >= 3 ? sub[sub.length - 1].replace(/-/g, ' ') : null;

  /* Owner: property_ownership_claims → owner_profiles → contacts. A
     property has at most one claim in the current submission flow
     (claim_type 'sole'); the join is written to tolerate more than one
     without breaking, taking the first as the primary owner shown. */
  var claimRes = await db.from('property_ownership_claims')
    .select('owner_profile_id, claim_type, owner_profiles!inner(id, contacts!inner(id, full_name, email, email_verified, phone_e164, auth_user_id))')
    .eq('property_id', propertyId).limit(1).maybeSingle();
  var owner = null;
  if (!claimRes.error && claimRes.data && claimRes.data.owner_profiles) {
    var contact = claimRes.data.owner_profiles.contacts;
    owner = {
      name: contact.full_name || null,
      email: contact.email || null,
      emailVerified: contact.email_verified === true,
      phone: contact.phone_e164 || null,
      /* Not an identity leak: this only says whether the owner has ever
         signed in with Google, not who they are beyond what is already
         shown. Useful for a reviewer weighing how reachable an owner is. */
      hasGoogleAccount: !!contact.auth_user_id
    };
  }

  /* How many OTHER properties this same owner has submitted — cheap
     context for a reviewer (a first-time submitter vs. a repeat one). */
  var priorCount = 0;
  if (claimRes.data && claimRes.data.owner_profile_id) {
    var priorRes = await db.from('property_ownership_claims')
      .select('property_id')
      .eq('owner_profile_id', claimRes.data.owner_profile_id);
    if (!priorRes.error) priorCount = Math.max(0, (priorRes.data || []).length - 1);
  }

  /* Assigned manager: read the same assignment table assignments.js
     writes, filtered to this caller's own visible scope so a manager
     reviewing a property never learns about an assignment outside the
     area they themselves can see. CEO (callerScope === null) sees all. */
  var assignRes = await db.from('admin_area_assignments')
    .select('user_id, node_id, scope_role, admin_users!inner(full_name, role)')
    .eq('active', true);
  var assignments = (!assignRes.error && assignRes.data) || [];
  if (callerScope !== null) {
    assignments = assignments.filter(function (a) { return isWithinScope(callerScope, a.node_id); });
  }
  var primary = primaryAssignment(assignments, prop.area_node_id);
  var assignedManager = primary ? {
    name: primary.admin_users.full_name, role: primary.admin_users.role, nodeId: primary.node_id
  } : null;

  /* Media: every row for this listing regardless of visibility — a
     reviewer must be able to see draft/pending media to review it before
     it can ever become published. Signed the same way
     functions/api/properties/media.js signs published media; the
     visibility gate that route enforces for the public simply does not
     apply to this authenticated, RBAC-scoped read. */
  var mediaRes = await db.from('property_media')
    .select('id, kind, r2_key, visibility, sort_order, created_at')
    .eq('listing_id', listing.id)
    .order('sort_order', { ascending: true });
  var mediaRows = (!mediaRes.error && mediaRes.data) || [];
  var media = [];
  for (var i = 0; i < mediaRows.length; i++) {
    var m = mediaRows[i];
    var url = null;
    try { url = await presignGetUrl(env, m.r2_key, { expiresSeconds: 600 }); } catch (e) { url = null; }
    media.push({
      id: m.id, kind: m.kind, visibility: m.visibility,
      sortOrder: m.sort_order, url: url, createdAt: m.created_at
    });
  }

  return {
    property: {
      reference: prop.business_code,
      category: propFull.category, type: unit.unit_type || propFull.property_type,
      typeLabel: TYPE_LABEL[unit.unit_type || propFull.property_type] || null,
      beds: unit.beds, baths: unit.baths, carPorch: unit.car_porch === true,
      size: unit.size_value, sizeUnit: unit.size_unit, roadWidthFt: propFull.road_width_ft,
      rent: listFull.rent_amount_minor == null ? null : Math.round(listFull.rent_amount_minor) / 100,
      advance: listFull.advance_amount_minor == null ? null : Math.round(listFull.advance_amount_minor) / 100,
      currency: listFull.currency || 'PKR', negotiable: listFull.negotiable === true,
      features: listFull.features || [], note: listFull.note || null,
      submittedAt: listFull.created_at || propFull.created_at
    },
    location: {
      city: propFull.city_name, citySlug: propFull.city_slug,
      mainLocation: propFull.area_name, mainLocationSlug: propFull.area_slug,
      subLocation: subLocation, areaNodeId: prop.area_node_id,
      landmark: propFull.landmark || null
    },
    owner: owner,
    priorSubmissions: priorCount,
    assignedManager: assignedManager,
    media: media
  };
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

    var detail = await loadReviewDetail(env, db, l, scope);

    return json(env, {
      listingId: listingId,
      businessCode: prop.business_code,
      state: state,
      stateLabel: STATE_LABEL[state],
      property: detail.property,
      location: detail.location,
      owner: detail.owner,
      priorSubmissions: detail.priorSubmissions,
      assignedManager: detail.assignedManager,
      media: detail.media,
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

    /* A property already in the terminal 'deleted' state has no legal
       transition back into 'deleted' (that would be a same-state noop),
       so a normal transition() call here would refuse it. But a purge
       that failed to remove every object must be retryable — otherwise
       "surface the failure and preserve recoverability" would be a
       claim with no way to act on it. Recognised narrowly: only when
       the listing is ALREADY deleted, only for the CEO (the only role
       any ->deleted edge is ever granted to), and it does nothing but
       re-run the purge against whatever property_media rows are still
       left — no lifecycle write happens a second time. */
    var alreadyDeleted = body.toState === 'deleted' && l.lifecycle_state === 'deleted';
    if (alreadyDeleted && auth.user.role !== 'ceo') {
      return json(env, { error: 'Your role cannot perform this action.' }, 403);
    }

    var result = alreadyDeleted
      ? { ok: true, from: 'deleted', to: 'deleted' }
      : await transition(env, {
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

    /* The retry path changes nothing about the lifecycle — only a real
       transition is a lifecycle event worth its own audit/notification
       entries. The purge itself is still separately audited below either
       way. */
    if (!alreadyDeleted) {
      await auditFor(env, auth.user, context.request)(
        'lifecycle_transition', 'listing', body.listingId, {
          from: result.from, to: result.to, reason: body.reason || null
        });
    }

    /* Media purge — ONLY on the terminal 'deleted' state, and only after
       the transition itself has already succeeded and been recorded.
       'deleted' is the CEO-only, non-reversible state (TRANSITIONS has no
       outgoing edge from it) — this is what "Permanently Delete" in the
       console actually does. It intentionally does NOT touch the
       properties/units/listings/ownership_claims/verification/approval
       rows: ADR 0002 §4 / Doc 18 Article 2.4 forbid a hard delete of
       those business records, and `transition()` already honours that
       (deleted_at is set, the row stays). property_media is different —
       it is storage metadata for binary files, not the business record
       itself, and there is no equivalent retention rule on it anywhere
       in this schema. Once a property is permanently gone, keeping its
       photos/videos in the bucket (and their rows, which exist only to
       point at them) serves no purpose and is exactly the storage the
       CEO asked to reclaim.

       Every key is computed from property_media rows already scoped to
       THIS listing_id — never a prefix or wildcard — so no other
       property's media can ever be touched by this call. A row is only
       removed once its R2 object is confirmed gone; if the R2 delete
       fails the row is kept, so a failed purge is visible and retryable
       rather than silently losing track of an object still in the
       bucket. */
    var mediaPurge = null;
    if (body.toState === 'deleted') {
      var toPurge = await db.from('property_media')
        .select('id, r2_key').eq('listing_id', body.listingId);
      var rows = (!toPurge.error && toPurge.data) || [];

      if (rows.length) {
        var deletions = await deleteObjects(env, rows.map(function (r) { return r.r2_key; }));
        var byKey = {};
        deletions.forEach(function (d) { byKey[d.key] = d; });

        var removedIds = [];
        var failed = [];
        rows.forEach(function (r) {
          var d = byKey[r.r2_key];
          if (d && d.ok) removedIds.push(r.id);
          else failed.push({ mediaId: r.id, key: r.r2_key, error: d && d.error });
        });

        if (removedIds.length) {
          await db.from('property_media').delete().in('id', removedIds);
        }

        mediaPurge = { requested: rows.length, deleted: removedIds.length, failed: failed };

        await auditFor(env, auth.user, context.request)(
          'purge_property_media', 'listing', body.listingId,
          { requested: rows.length, deleted: removedIds.length, failedCount: failed.length });
      } else {
        mediaPurge = { requested: 0, deleted: 0, failed: [] };
      }
    }

    /* Notifications go through the bus, never sent from here directly
       (Doc 18 Article 4.4). The bus decides who hears about it. */
    var notifyType = body.toState === 'published' ? 'property.published'
      : body.toState === 'rejected' ? 'property.rejected'
      : body.toState === 'deleted' ? 'property.deleted'
      : null;
    if (notifyType && !alreadyDeleted) {
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
      warning: result.warning || undefined,
      mediaPurge: mediaPurge || undefined
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Transition failed.' }, 500);
  }
}
