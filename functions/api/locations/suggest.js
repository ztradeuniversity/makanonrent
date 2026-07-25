/* POST /api/locations/suggest
   Records a user's SUB AREA suggestion. Two rows are written:
     • locations           — the node itself, status 'pending' (so it is
                             invisible to every public read until approved)
     • location_suggestions — the audit trail of who asked and why
   Users can never create a Main Area: the parent must already exist and
   be a locality/society, and the created node type is always 'subarea'.
   This mirrors the same rule enforced client-side in location-bank.js —
   the client guard is convenience, this one is the boundary.

   Request:  { name, parentId, parentName?, note? }
   Response: { ok: true, status: 'pending' } */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

function slugify(v) {
  return String(v).toLowerCase().trim()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.name, 160)) return json(env, { error: 'name is required.' }, 422);
  if (!isNonEmptyString(body.parentId, 200)) return json(env, { error: 'parentId is required.' }, 422);

  var db = getServiceClient(env);

  try {
    /* The parent must exist AND be a main area — this is what stops a
       user from attaching a "sub area" directly to a city (which would
       effectively create a main area). */
    var parent = await db.from('locations')
      .select('node_id, type, name')
      .eq('node_id', body.parentId)
      .maybeSingle();
    if (parent.error) throw parent.error;
    if (!parent.data) return json(env, { error: 'Unknown parent location.' }, 422);
    if (['locality', 'society'].indexOf(parent.data.type) === -1) {
      return json(env, { error: 'Suggestions can only be added inside a main area.' }, 422);
    }

    var slug = slugify(body.name);
    var nodeId = parent.data.node_id + '/' + slug;

    var ins = await db.from('locations').upsert({
      node_id: nodeId, parent_node_id: parent.data.node_id,
      name: body.name, slug: slug, type: 'subarea',
      status: 'pending', active: true, source: 'suggestion',
      note: body.note || null
    }, { onConflict: 'node_id' });
    if (ins.error) throw ins.error;

    var aud = await db.from('location_suggestions').insert({
      name: body.name, parent_node_id: parent.data.node_id,
      parent_name: parent.data.name || body.parentName || null,
      note: body.note || null, status: 'pending'
    });
    if (aud.error) throw aud.error;

    return json(env, { ok: true, status: 'pending' }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Suggestion failed.' }, 500);
  }
}
