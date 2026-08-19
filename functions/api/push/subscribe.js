/* POST /api/push/subscribe   — create or update a browser subscription
   POST /api/push/subscribe   with { revoke: true } — turn everything off

   Anonymous by design: a push subscription needs no account, no email and
   no phone. What it stores is the endpoint the browser handed us, the two
   keys required to encrypt to it, the two consent flags, and a bounded
   interest profile. Nothing about the device or the person is recorded —
   no IP, no user agent — so there is nothing here to fingerprint with.

   The endpoint is the subscription's identity and is UNIQUE in the schema,
   so re-subscribing the same browser updates that row. Without that, a
   visitor who toggled notifications off and on would accumulate rows and
   receive the same notification several times.

   Request:
     { visitorId, subscription: { endpoint, keys: { p256dh, auth } },
       propertyInterest?: bool, siteUpdates?: bool,
       interests?: { searches: [...], viewed: [...] } }
   Response: { ok: true, propertyInterest, siteUpdates } */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';

export async function onRequestOptions(context) { return preflight(context.env); }

/* Caps enforced HERE, not merely in the browser: the client is not a
   trusted place to bound what the server stores. */
var MAX_SEARCHES = 10;
var MAX_VIEWED = 20;

/* Only the keys the existing matcher (functions/utils/alert-match.js)
   actually reads are kept. Anything else a client sends is dropped rather
   than stored, so this can never become a general-purpose bucket for
   whatever the browser felt like uploading. */
var CRITERIA_KEYS = [
  'city', 'area', 'subarea', 'category', 'type',
  'beds', 'budgetMin', 'budgetMax', 'areaSize', 'areaUnit', 'needs'
];

function cleanCriteria(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var out = {};
  var kept = 0;
  CRITERIA_KEYS.forEach(function (k) {
    var v = raw[k];
    if (v === null || v === undefined || v === '') return;
    if (k === 'needs') {
      var arr = (Array.isArray(v) ? v : String(v).split(','))
        .map(function (s) { return String(s).trim().slice(0, 40); })
        .filter(Boolean)
        .slice(0, 20);
      if (!arr.length) return;
      out.needs = arr;
      kept++;
      return;
    }
    out[k] = typeof v === 'number' ? v : String(v).slice(0, 80);
    kept++;
  });
  return kept ? out : null;
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanInterests(raw) {
  var out = { searches: [], viewed: [] };
  if (!raw || typeof raw !== 'object') return out;

  if (Array.isArray(raw.searches)) {
    raw.searches.slice(0, MAX_SEARCHES).forEach(function (s) {
      var c = cleanCriteria(s);
      if (c) out.searches.push(c);
    });
  }
  if (Array.isArray(raw.viewed)) {
    raw.viewed.forEach(function (v) {
      if (out.viewed.length >= MAX_VIEWED) return;
      if (typeof v === 'string' && UUID_RE.test(v) && out.viewed.indexOf(v) === -1) out.viewed.push(v);
    });
  }
  return out;
}

/* Push service endpoints are https URLs. Rejecting anything else stops the
   table being used to point our own sender at an arbitrary host. */
function validEndpoint(v) {
  if (!isNonEmptyString(v, 2000)) return false;
  try { return new URL(v).protocol === 'https:'; } catch (e) { return false; }
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var sub = body.subscription || {};
  var keys = sub.keys || {};

  if (!validEndpoint(sub.endpoint)) {
    return json(env, { error: 'A valid https subscription endpoint is required.' }, 422);
  }
  if (!isNonEmptyString(keys.p256dh, 200) || !isNonEmptyString(keys.auth, 100)) {
    return json(env, { error: 'Subscription keys are required.' }, 422);
  }
  if (!isNonEmptyString(body.visitorId, 100)) {
    return json(env, { error: 'visitorId is required.' }, 422);
  }

  try {
    var db = getServiceClient(env);

    /* Revoke: keep the row (the send ledger references it) and stamp it,
       so a later resubscribe is an update and history is not rewritten. */
    if (body.revoke === true) {
      var rev = await db.from('push_subscriptions')
        .update({
          revoked_at: new Date().toISOString(),
          property_interest_enabled: false,
          site_updates_enabled: false
        })
        .eq('endpoint', sub.endpoint);
      if (rev.error) throw rev.error;
      return json(env, { ok: true, revoked: true, propertyInterest: false, siteUpdates: false });
    }

    var propertyInterest = body.propertyInterest === true;
    var siteUpdates = body.siteUpdates === true;
    var interests = cleanInterests(body.interests);

    /* A push service can rotate an endpoint on its own; the service worker
       reports that as previousEndpoint. Carrying the old row's consent and
       interests across is what keeps a rotation invisible to the visitor —
       without it they would be silently unsubscribed by their own browser.
       Only ever copied from a row that is still live, and only when the
       caller did not state its own preferences. */
    if (isNonEmptyString(body.previousEndpoint, 2000) && body.previousEndpoint !== sub.endpoint) {
      var prev = await db.from('push_subscriptions')
        .select('id, visitor_id, property_interest_enabled, site_updates_enabled, interests, revoked_at')
        .eq('endpoint', body.previousEndpoint)
        .maybeSingle();
      if (!prev.error && prev.data && !prev.data.revoked_at) {
        if (body.propertyInterest === undefined) propertyInterest = prev.data.property_interest_enabled === true;
        if (body.siteUpdates === undefined) siteUpdates = prev.data.site_updates_enabled === true;
        if (body.interests === undefined && prev.data.interests) interests = cleanInterests(prev.data.interests);
        if (!isNonEmptyString(body.visitorId, 100) || body.visitorId === 'rotated') {
          body.visitorId = prev.data.visitor_id;
        }
        /* The old address is dead the moment the new one works. */
        await db.from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', prev.data.id);
      }
    }

    var row = {
      visitor_id: String(body.visitorId).slice(0, 100),
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      property_interest_enabled: propertyInterest,
      site_updates_enabled: siteUpdates,
      interests: interests,
      /* A resubscribe after a revoke is a fresh, live subscription. */
      revoked_at: null
    };

    /* onConflict endpoint — the unique index is what makes re-subscribing
       idempotent instead of duplicating the browser. */
    var up = await db.from('push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' });
    if (up.error) throw up.error;

    return json(env, {
      ok: true,
      propertyInterest: propertyInterest,
      siteUpdates: siteUpdates
    }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not save the subscription.' }, 500);
  }
}
