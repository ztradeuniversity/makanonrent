/* GET  /api/admin/comments?entityType=…&entityId=…  → thread
   POST /api/admin/comments                          → { entityType, entityId, body, parentId? }

   Internal comments for all three roles. `parentId` is what makes
   "Manager can reply to review comments" a thread rather than a second
   disconnected note — a reply carries the id of the comment it answers.

   Comments are never edited or deleted: they are the written record
   attached to an approval or a rejection, and a mutable record is not
   evidence. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var ENTITY_TYPES = ['listing', 'property', 'task', 'user', 'verification'];

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var url = new URL(context.request.url);
  var entityType = url.searchParams.get('entityType');
  var entityId = url.searchParams.get('entityId');

  if (ENTITY_TYPES.indexOf(entityType) === -1) {
    return json(env, { error: 'entityType must be one of: ' + ENTITY_TYPES.join(', ') + '.' }, 422);
  }
  if (!isNonEmptyString(entityId, 60)) return json(env, { error: 'entityId is required.' }, 422);

  try {
    var db = getServiceClient(env);
    var res = await db.from('admin_comments')
      .select('id, parent_id, body, created_at, admin_users!inner(id, full_name, role)')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;

    return json(env, {
      comments: (res.data || []).map(function (c) {
        return {
          id: c.id, parentId: c.parent_id, body: c.body, createdAt: c.created_at,
          author: { id: c.admin_users.id, name: c.admin_users.full_name, role: c.admin_users.role }
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load comments.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'comments.create');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (ENTITY_TYPES.indexOf(body.entityType) === -1) {
    return json(env, { error: 'entityType must be one of: ' + ENTITY_TYPES.join(', ') + '.' }, 422);
  }
  if (!isNonEmptyString(body.entityId, 60)) return json(env, { error: 'entityId is required.' }, 422);
  if (!isNonEmptyString(body.body, 4000)) return json(env, { error: 'A comment body is required.' }, 422);

  try {
    var db = getServiceClient(env);
    var ins = await db.from('admin_comments').insert({
      entity_type: body.entityType,
      entity_id: body.entityId,
      author_id: auth.user.id,
      parent_id: isNonEmptyString(body.parentId, 60) ? body.parentId : null,
      body: body.body
    }).select('id, created_at').single();
    if (ins.error) throw ins.error;

    await auditFor(env, auth.user, context.request)(
      'create_comment', body.entityType, body.entityId, { commentId: ins.data.id });

    return json(env, { ok: true, commentId: ins.data.id, createdAt: ins.data.created_at }, 201);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not post that comment.' }, 500);
  }
}
