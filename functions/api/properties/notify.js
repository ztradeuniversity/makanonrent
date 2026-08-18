/* POST /api/properties/notify — public, wires listing.js's existing
   "Notify Me" button to migrations/0007's property_notify_requests. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try { body = await context.request.json(); } catch (e) { return json(env, { error: 'Request body must be valid JSON.' }, 400); }

  /* Two shapes share this endpoint:
       entityType 'property' | 'listing' → watch ONE known record (original)
       entityType 'search'               → watch a saved SEARCH (criteria)
     A saved search has no entity to point at, which is why migration 0008
     made entity_id nullable. */
  var isSearch = body.entityType === 'search';

  if (['property', 'listing', 'search'].indexOf(body.entityType) === -1) {
    return json(env, { error: 'entityType must be property, listing or search.' }, 422);
  }
  if (!isSearch && !isNonEmptyString(body.entityId, 60)) {
    return json(env, { error: 'entityId is required.' }, 422);
  }
  if (!isNonEmptyString(body.phone, 20) && !isNonEmptyString(body.email, 200)) {
    return json(env, { error: 'A phone or email is required.' }, 422);
  }
  if (isSearch && !isNonEmptyString(body.email, 200)) {
    return json(env, { error: 'An email is required for search alerts.' }, 422);
  }

  /* Only the keys the matcher understands are persisted. This is a public,
     unauthenticated endpoint, so an arbitrary caller must not be able to
     push unbounded JSON into the row. */
  var criteria = null;
  if (isSearch) {
    var c = body.criteria || {};
    var pick = ['city', 'area', 'subarea', 'category', 'type', 'beds',
                'budgetMin', 'budgetMax', 'areaSize', 'areaUnit'];
    criteria = {};
    pick.forEach(function (k) {
      if (isNonEmptyString(c[k], 80)) criteria[k] = String(c[k]).trim();
    });
    var needs = Array.isArray(c.needs) ? c.needs : String(c.needs || '').split(',');
    needs = needs.map(function (s) { return String(s).trim(); })
                 .filter(function (s) { return s && s.length <= 40; })
                 .slice(0, 12);
    if (needs.length) criteria.needs = needs;
  }

  try {
    var db = getServiceClient(env);
    var ins = await db.from('property_notify_requests').insert({
      entity_type: body.entityType,
      entity_id: isSearch ? null : body.entityId,
      criteria: criteria,
      phone_e164: isNonEmptyString(body.phone, 20) ? body.phone : null,
      email: isNonEmptyString(body.email, 200) ? body.email : null,
      kind: body.kind === 'price_drop' ? 'price_drop' : 'availability'
    }).select('id').single();
    if (ins.error) throw ins.error;
    return json(env, { ok: true }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not save that request.' }, 500);
  }
}
