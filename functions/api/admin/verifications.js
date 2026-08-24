/* GET  /api/admin/verifications?propertyId=…  → full history for a property
   GET  /api/admin/verifications?queue=1       → properties awaiting verification
                                                  in the caller's assigned areas
   POST /api/admin/verifications               → { verifications: [ … ] }
                                                  ("Publish Verification")

   THE VERIFICATION WORKFLOW, exactly as specified:
     Manager opens assigned area → property list → checks Available or
     Unavailable per property → Publish Verification. Only the properties
     included in the POST move. Anything omitted stays pending — which is
     why this endpoint takes an explicit array and never operates on
     "everything in the area".

   History is permanent. property_verifications has an append-only trigger
   (migrations/0004): a correction is a new row, never an edit, so
   "Previous Status" stays truthful forever. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, can, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { attachEvidence, listEvidence } from '../../utils/evidence.js';
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
    var propertyId = url.searchParams.get('propertyId');
    var mine = url.searchParams.get('mine');
    var reviewQueue = url.searchParams.get('reviewQueue');

    /* ── history for one property ─────────────────────────────────── */
    if (propertyId) {
      var hist = await db.from('property_verifications')
        .select('id, property_id, status, previous_status, phone_number, comments, gps_lat, gps_lng, verified_at, admin_users!inner(id, full_name, role)')
        .eq('property_id', propertyId)
        .order('verified_at', { ascending: false });
      if (hist.error) throw hist.error;

      var reviewMap = await latestReviewsFor(db, (hist.data || []).map(function (r) { return r.id; }));

      /* Evidence is read through the Evidence Service so the seal fields
         (hash, captured_at, device, GPS) come back consistently wherever
         evidence is displayed — a second inline select would drift. */
      var out = [];
      for (var h = 0; h < (hist.data || []).length; h++) {
        var row = hist.data[h];
        out.push({
          id: row.id,
          status: row.status,
          previousStatus: row.previous_status,
          phoneNumber: row.phone_number,
          comments: row.comments,
          gps: (row.gps_lat != null && row.gps_lng != null) ? { lat: row.gps_lat, lng: row.gps_lng } : null,
          verifiedAt: row.verified_at,
          manager: { id: row.admin_users.id, name: row.admin_users.full_name, role: row.admin_users.role },
          proof: await listEvidence(env, row.id),
          review: reviewMap[row.id] || null
        });
      }
      return json(env, { history: out });
    }

    /* ── "my submitted field reports" — a Field Officer's own history +
       review status, without needing to look them up property by
       property. Any role may call this for itself; it is always scoped
       to the caller's own verified_by rows. ─────────────────────────── */
    if (mine) {
      var mineRes = await db.from('property_verifications')
        .select('id, property_id, status, comments, verified_at, properties!inner(business_code, city_name, area_name)')
        .eq('verified_by', auth.user.id)
        .order('verified_at', { ascending: false })
        .limit(100);
      if (mineRes.error) throw mineRes.error;

      var mineReviewMap = await latestReviewsFor(db, (mineRes.data || []).map(function (r) { return r.id; }));
      return json(env, {
        submissions: (mineRes.data || []).map(function (r) {
          return {
            id: r.id, propertyId: r.property_id, status: r.status, comments: r.comments,
            verifiedAt: r.verified_at,
            businessCode: r.properties.business_code, cityName: r.properties.city_name, areaName: r.properties.area_name,
            review: mineReviewMap[r.id] || null
          };
        })
      });
    }

    /* ── review queue: submitted field reports awaiting a decision,
       inside the caller's own assigned areas — same scope mechanism as
       the verify queue below, just one more step down the workflow.
       "Pending" = no review row exists yet for that verification. ──── */
    if (reviewQueue) {
      if (!can(auth.user.role, 'verification.review')) {
        return json(env, { error: 'Your role does not permit reviewing field reports.' }, 403);
      }
      var rqScope = await getScopeNodeIds(env, auth.user);
      if (rqScope !== null && !rqScope.length) return json(env, { reports: [] });

      var recent = await db.from('property_verifications')
        .select('id, property_id, status, comments, verified_at, admin_users!inner(id, full_name, role), properties!inner(business_code, city_name, area_name, area_node_id)')
        .order('verified_at', { ascending: false })
        .limit(300);
      if (recent.error) throw recent.error;

      var inScope = (recent.data || []).filter(function (r) { return isWithinScope(rqScope, r.properties.area_node_id); });
      var reviewedIds = await latestReviewsFor(db, inScope.map(function (r) { return r.id; }));

      var pending = inScope.filter(function (r) { return !reviewedIds[r.id]; });
      var reports = [];
      for (var p = 0; p < pending.length; p++) {
        var pr = pending[p];
        reports.push({
          id: pr.id, propertyId: pr.property_id, status: pr.status, comments: pr.comments, verifiedAt: pr.verified_at,
          fieldOfficer: { id: pr.admin_users.id, name: pr.admin_users.full_name, role: pr.admin_users.role },
          businessCode: pr.properties.business_code, cityName: pr.properties.city_name, areaName: pr.properties.area_name,
          proof: await listEvidence(env, pr.id)
        });
      }
      return json(env, { reports: reports });
    }

    /* ── the queue: properties inside the caller's assigned areas ──── */
    var scope = await getScopeNodeIds(env, auth.user);

    /* A scoped role with zero assignments sees nothing — not everything.
       Deny-by-default: an empty scope is an empty result, never an
       unfiltered query (Doc 03 §3.2). */
    if (scope !== null && !scope.length) return json(env, { properties: [] });

    var res = await db.from('properties')
      .select('id, business_code, city_name, area_name, area_node_id, added_by_admin_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (res.error) throw res.error;

    /* Scope filtering happens here rather than in the query because
       node_id is a PATH and descendants are prefix matches — expressing
       that as a PostgREST or()/like() chain is brittle, and isWithinScope
       is the same helper approvals.js and properties.js already use, so
       all three endpoints resolve scope identically by construction. */
    return json(env, {
      properties: (res.data || [])
        .filter(function (p) { return isWithinScope(scope, p.area_node_id); })
        .map(function (p) {
          return {
            id: p.id, businessCode: p.business_code,
            cityName: p.city_name, areaName: p.area_name, areaNodeId: p.area_node_id,
            /* The UI uses this to block the checkbox with an explanation
               rather than letting the manager submit and hit a DB error. */
            selfAdded: p.added_by_admin_id === auth.user.id,
            createdAt: p.created_at
          };
        })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load verifications.' }, 500);
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

  /* ── review (Manager/Assistant CEO/CEO decide on a submitted field
     report) — a distinct action from the "publish verifications" flow
     below, gated on 'verification.review' rather than 'properties.verify'
     so a Field Officer (who holds the latter) cannot review reports,
     including their own. */
  if (body && body.action === 'review') {
    if (!can(auth.user.role, 'verification.review')) {
      return json(env, { error: 'Your role does not permit reviewing field reports.' }, 403);
    }
    if (!isNonEmptyString(body.verificationId, 60)) {
      return json(env, { error: 'verificationId is required.' }, 422);
    }
    if (['reviewed', 'returned'].indexOf(body.decision) === -1) {
      return json(env, { error: "decision must be 'reviewed' or 'returned'." }, 422);
    }
    if (body.decision === 'returned' && !isNonEmptyString(body.comment, 2000)) {
      return json(env, { error: 'A correction reason is required when returning a report.' }, 422);
    }

    try {
      var rDb = getServiceClient(env);
      var rAudit = auditFor(env, auth.user, context.request);

      var v = await rDb.from('property_verifications')
        .select('id, verified_by, properties!inner(area_node_id, business_code)')
        .eq('id', body.verificationId).maybeSingle();
      if (v.error) throw v.error;
      if (!v.data) return json(env, { error: 'No such field report.' }, 404);

      var rScope = await getScopeNodeIds(env, auth.user);
      if (!isWithinScope(rScope, v.data.properties.area_node_id)) {
        return json(env, { error: 'That report is outside your assigned areas.' }, 403);
      }

      var rIns = await rDb.from('property_verification_reviews').insert({
        verification_id: body.verificationId,
        reviewer_id: auth.user.id,
        decision: body.decision,
        comment: isNonEmptyString(body.comment, 2000) ? body.comment : null
      }).select('id').single();
      if (rIns.error) throw rIns.error;

      await rAudit(body.decision === 'returned' ? 'report_returned' : 'report_reviewed',
        'property_verification', body.verificationId,
        { propertyBusinessCode: v.data.properties.business_code, targetUserId: v.data.verified_by, comment: body.comment || null });

      /* The Field Officer hears about it through the same in-app bus
         every other cross-tier notification already uses — no new
         channel, no email (not requested, and the OTP/task-email
         infrastructure this session already fixed is explicitly
         off-limits for this phase). */
      if (body.decision === 'returned') {
        await publish(env, {
          type: 'review.returned', recipientId: v.data.verified_by,
          entityType: 'verification', entityId: body.verificationId,
          areaNodeId: v.data.properties.area_node_id, actorId: auth.user.id,
          body: body.comment
        });
      }

      return json(env, { ok: true });
    } catch (e) {
      return json(env, { error: (e && e.message) || 'Review failed.' }, 500);
    }
  }

  if (!can(auth.user.role, 'properties.verify')) {
    return json(env, { error: 'Your role does not permit this action.' }, 403);
  }

  var items = body && body.verifications;
  if (!Array.isArray(items) || !items.length) {
    return json(env, { error: 'verifications must be a non-empty array.' }, 422);
  }
  if (items.length > 200) {
    return json(env, { error: 'Publish at most 200 verifications at a time.' }, 422);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    var audit = auditFor(env, auth.user, context.request);
    var scope = await getScopeNodeIds(env, auth.user);
    var applied = [];
    var rejected = [];

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!isNonEmptyString(it.propertyId, 60)) {
        rejected.push({ propertyId: it.propertyId || null, reason: 'propertyId is required.' });
        continue;
      }
      if (it.status !== 'available' && it.status !== 'unavailable') {
        rejected.push({ propertyId: it.propertyId, reason: "status must be 'available' or 'unavailable'." });
        continue;
      }

      var prop = await db.from('properties')
        .select('id, area_node_id, added_by_admin_id')
        .eq('id', it.propertyId).maybeSingle();
      if (prop.error) throw prop.error;
      if (!prop.data) {
        rejected.push({ propertyId: it.propertyId, reason: 'No such property.' });
        continue;
      }

      if (!isWithinScope(scope, prop.data.area_node_id)) {
        rejected.push({ propertyId: it.propertyId, reason: 'Outside your assigned areas.' });
        continue;
      }

      /* Checked in the handler purely to return a readable message. The
         REAL enforcement is the enforce_verification_sod trigger — if this
         check were ever removed the insert would still fail (ADR §4). */
      if (prop.data.added_by_admin_id && prop.data.added_by_admin_id === auth.user.id) {
        rejected.push({
          propertyId: it.propertyId,
          reason: 'Separation of duties: you added this property, so someone else must verify it.'
        });
        continue;
      }

      /* Previous status comes from the last recorded verification, not
         from the listing, so the history chain is self-consistent even if
         a listing is edited by another route. */
      var prev = await db.from('property_verifications')
        .select('status').eq('property_id', it.propertyId)
        .order('verified_at', { ascending: false }).limit(1).maybeSingle();
      if (prev.error) throw prev.error;

      var listingId = await resolveListingId(db, it.propertyId);

      var ins = await db.from('property_verifications').insert({
        property_id: it.propertyId,
        listing_id: listingId,
        verified_by: auth.user.id,
        task_id: isNonEmptyString(it.taskId, 60) ? it.taskId : null,
        status: it.status,
        previous_status: prev.data ? prev.data.status : null,
        phone_number: isNonEmptyString(it.phoneNumber, 40) ? it.phoneNumber : null,
        comments: isNonEmptyString(it.comments, 2000) ? it.comments : null,
        gps_lat: it.gps && isFinite(Number(it.gps.lat)) ? Number(it.gps.lat) : null,
        gps_lng: it.gps && isFinite(Number(it.gps.lng)) ? Number(it.gps.lng) : null
      }).select('id').single();

      if (ins.error) {
        /* The SoD trigger raises here if the handler check was bypassed. */
        rejected.push({ propertyId: it.propertyId, reason: ins.error.message });
        continue;
      }

      /* Proof goes through the Evidence Service — never inserted here.
         It owns hashing, sealing (captured_at/device/GPS) and anti-reuse
         across images, videos AND documents (Doc 16 AM-3.2; duplicating
         it inside a module is a rejectable offence under Article 4.5). */
      var evidenceResult = { attached: [], rejected: [] };
      if (Array.isArray(it.proof) && it.proof.length) {
        evidenceResult = await attachEvidence(env, ins.data.id, it.proof);
      }

      /* availability_state is availability bookkeeping, not public trust
         state, so it is ours to write directly. */
      if (listingId) {
        await db.from('listings').update({ availability_state: it.status }).eq('id', listingId);

        /* The lifecycle move. 'submitted' has no legal edge straight to
           'verified' — a property must enter review before it can leave
           it — so the intermediate step is taken explicitly and recorded
           as a system transition rather than being skipped. That keeps
           the history an honest account of what happened. */
        var target = it.status === 'available' ? 'verified' : 'unavailable';
        var cur = await db.from('listings').select('lifecycle_state').eq('id', listingId).maybeSingle();
        var state = (cur.data && cur.data.lifecycle_state) || 'submitted';

        if (state === 'submitted') {
          await transition(env, {
            listingId: listingId, toState: 'pending_review',
            actor: auth.user, actorKind: 'system',
            reason: 'Verification visit recorded'
          });
        }
        var t = await transition(env, {
          listingId: listingId, toState: target, actor: auth.user,
          reason: it.comments || 'Verified ' + it.status + ' on site'
        });
        /* A no-op or illegal move is not a failure of the verification —
           the verification row is already stored, permanently. Reported
           on the item so the manager sees it, not swallowed. */
        if (!t.ok && t.code !== 'noop') {
          evidenceResult.rejected.push({ index: null, reason: 'Status not changed: ' + t.error });
        }
      }

      applied.push({
        propertyId: it.propertyId, verificationId: ins.data.id, status: it.status,
        areaNodeId: prop.data.area_node_id,
        evidenceAttached: evidenceResult.attached.length,
        evidenceRejected: evidenceResult.rejected
      });
    }

    if (applied.length) {
      await db.from('admin_users')
        .update({ last_verification_at: new Date().toISOString() })
        .eq('id', auth.user.id);
      await audit('publish_verification', 'property', null, {
        applied: applied.length, rejected: rejected.length,
        statuses: applied.reduce(function (acc, a) { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {})
      });

      /* Tells the Assistant CEO tier that field work landed. Published
         through the bus, which resolves recipients from area scope. */
      await publish(env, {
        type: 'task.completed',
        entityType: 'verification', entityId: String(applied.length),
        areaNodeId: applied[0] ? applied[0].areaNodeId : null,
        actorId: auth.user.id,
        body: auth.user.full_name + ' published ' + applied.length + ' verification(s).'
      });
    }

    /* Partial success is a real outcome here (some properties out of
       scope, some self-added): report both sides rather than failing the
       whole batch and losing the manager's good work. */
    return json(env, { ok: true, applied: applied, rejected: rejected });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Verification failed.' }, 500);
  }
}

/* One query for the LATEST review decision per verification id, keyed by
   verification_id. property_verification_reviews (migration 0015) is
   append-only like property_verifications itself — the newest row per
   verification IS its current review state, there is no separate status
   column to fall out of sync with it. */
async function latestReviewsFor(db, verificationIds) {
  var map = {};
  var ids = (verificationIds || []).filter(Boolean);
  if (!ids.length) return map;

  var res = await db.from('property_verification_reviews')
    .select('verification_id, decision, comment, created_at, admin_users!inner(id, full_name)')
    .in('verification_id', ids)
    .order('created_at', { ascending: false });
  if (res.error) return map;

  (res.data || []).forEach(function (r) {
    if (map[r.verification_id]) return;   // first hit per id = newest, thanks to the order() above
    map[r.verification_id] = {
      decision: r.decision, comment: r.comment, at: r.created_at,
      reviewer: { id: r.admin_users.id, name: r.admin_users.full_name }
    };
  });
  return map;
}

/* A property has units, and a unit has at most one listing. Returns the
   first listing found, or null for a property with no listing yet. */
async function resolveListingId(db, propertyId) {
  var units = await db.from('units').select('id').eq('property_id', propertyId);
  if (units.error || !units.data || !units.data.length) return null;
  var ids = units.data.map(function (u) { return u.id; });
  var l = await db.from('listings').select('id').in('unit_id', ids).limit(1).maybeSingle();
  if (l.error || !l.data) return null;
  return l.data.id;
}
