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

/* "  asif   BLOCK " and "Asif Block" are the same request typed twice.
   Collapsing runs of whitespace (including the non-breaking space a
   phone keyboard can produce) is what makes the duplicate check below
   see them as one. Case is NOT forced here — the submitter's own
   capitalisation is what an approver reads and publishes; it is only
   folded for comparison. */
function tidy(v) {
  return String(v == null ? '' : v).replace(/[\s ]+/g, ' ').trim();
}
function normalize(v) {
  return tidy(v).toLowerCase();
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var name = tidy(body.name);
  if (!isNonEmptyString(name, 160)) return json(env, { error: 'name is required.' }, 422);
  if (!isNonEmptyString(body.parentId, 200)) return json(env, { error: 'parentId is required.' }, 422);

  /* A name that slugifies to nothing (punctuation or emoji only) would
     otherwise become the parent's own node_id with a trailing slash. */
  if (!slugify(name)) return json(env, { error: 'Enter the area name in letters or numbers.' }, 422);

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);

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

    var slug = slugify(name);
    var nodeId = parent.data.node_id + '/' + slug;

    /* Duplicate check BEFORE writing anything. The upsert below is keyed
       on node_id, so without this an existing row would be silently
       overwritten — including an already-approved one, which would drag a
       live location back through review. Every sibling is compared on
       normalized name and on its aliases, so "DHA Phase 5", "dha  phase 5"
       and an alias of the same place all resolve to "already exists". */
    var siblings = await db.from('locations')
      .select('node_id, name, slug, status, aliases')
      .eq('parent_node_id', parent.data.node_id)
      .in('status', ['approved', 'pending']);
    if (siblings.error) throw siblings.error;

    var wanted = normalize(name);
    var existing = null;
    (siblings.data || []).forEach(function (s) {
      if (existing) return;
      if (s.slug === slug || s.node_id === nodeId) { existing = s; return; }
      if (normalize(s.name) === wanted) { existing = s; return; }
      var hit = (s.aliases || []).some(function (a) { return normalize(a) === wanted; });
      if (hit) existing = s;
    });

    if (existing) {
      /* Two different answers, because they need two different actions:
         an approved location is already selectable, so the user is told to
         pick it; a pending one means someone already asked and the queue
         should not grow a second identical row. */
      if (existing.status === 'approved') {
        return json(env, {
          error: '“' + existing.name + '” already exists here — please select it instead of suggesting it.',
          existing: { nodeId: existing.node_id, name: existing.name, status: 'approved' }
        }, 409);
      }
      return json(env, {
        error: '“' + existing.name + '” has already been suggested and is waiting for review.',
        existing: { nodeId: existing.node_id, name: existing.name, status: 'pending' }
      }, 409);
    }

    var suggestedBy = isNonEmptyString(body.suggestedBy, 200) ? tidy(body.suggestedBy) : null;
    var note = isNonEmptyString(body.note, 2000) ? tidy(body.note) : null;

    /* The sibling check above only considers approved/pending rows, which
       is what the partial index uq_locations_parent_slug enforces. But
       locations.node_id is unconditionally unique, so a row left behind by
       an earlier REJECTED suggestion still occupies this id — inserting
       over it would fail on the constraint. A rejected name is allowed to
       be suggested again, so that row is revived rather than duplicated:
       same canonical node_id, same parent, back to pending for review. */
    var fields = {
      parent_node_id: parent.data.node_id,
      name: name, slug: slug, type: 'subarea',
      status: 'pending', active: true, source: 'suggestion',
      note: note, suggested_by: suggestedBy
    };

    var prior = await db.from('locations')
      .select('node_id, status')
      .eq('node_id', nodeId)
      .maybeSingle();
    if (prior.error) throw prior.error;

    if (prior.data) {
      var revive = await db.from('locations').update(fields).eq('node_id', nodeId);
      if (revive.error) throw revive.error;
    } else {
      var ins = await db.from('locations').insert(Object.assign({ node_id: nodeId }, fields));
      if (ins.error) throw ins.error;
    }

    var aud = await db.from('location_suggestions').insert({
      name: name, parent_node_id: parent.data.node_id,
      parent_name: parent.data.name || tidy(body.parentName) || null,
      note: note, status: 'pending', suggested_by: suggestedBy
    });
    if (aud.error) throw aud.error;

    return json(env, { ok: true, status: 'pending' }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Suggestion failed.' }, 500);
  }
}
