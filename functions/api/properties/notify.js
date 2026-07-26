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

  if (['property', 'listing'].indexOf(body.entityType) === -1) return json(env, { error: 'entityType must be property or listing.' }, 422);
  if (!isNonEmptyString(body.entityId, 60)) return json(env, { error: 'entityId is required.' }, 422);
  if (!isNonEmptyString(body.phone, 20) && !isNonEmptyString(body.email, 200)) {
    return json(env, { error: 'A phone or email is required.' }, 422);
  }

  try {
    var db = getServiceClient(env);
    var ins = await db.from('property_notify_requests').insert({
      entity_type: body.entityType, entity_id: body.entityId,
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
