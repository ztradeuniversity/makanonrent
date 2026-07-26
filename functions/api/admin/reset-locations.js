/* POST /api/admin/reset-locations — CEO ONLY.
   Deletes every City, Main Location and Sub Location from `locations`.
   Requires an explicit confirmation token in the body so it can never
   fire from a stray click or a replayed request.

   Scoped strictly to the location tree: properties, listings, users and
   every other table are untouched. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { requireAuth } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) { return preflight(context.env); }

var CONFIRM = 'RESET ALL LOCATIONS';

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  /* CEO only — not a capability grant, an explicit role gate, so no
     future capability edit can widen access to this by accident. */
  if (auth.user.role !== 'ceo') {
    return json(env, { error: 'Only the CEO can reset locations.' }, 403);
  }

  var body;
  try { body = await context.request.json(); }
  catch (e) { return json(env, { error: 'Request body must be valid JSON.' }, 400); }

  if (body.confirm !== CONFIRM) {
    return json(env, { error: 'Confirmation token required. Send { "confirm": "' + CONFIRM + '" }.' }, 428);
  }

  try {
    var db = getServiceClient(env);

    /* Children before parents — locations.parent_node_id is self
       referencing, so deleting deepest-first avoids FK ordering errors. */
    var counts = {};
    var tiers = ['subarea', 'locality', 'society', 'city'];
    for (var i = 0; i < tiers.length; i++) {
      var head = await db.from('locations').select('node_id', { count: 'exact', head: true }).eq('type', tiers[i]);
      counts[tiers[i]] = (head.count || 0);
      var del = await db.from('locations').delete().eq('type', tiers[i]);
      if (del.error) throw del.error;
    }

    await auditFor(env, auth.user, context.request)(
      'reset_locations', 'locations', null, counts);

    return json(env, { ok: true, deleted: counts });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Reset failed.' }, 500);
  }
}
