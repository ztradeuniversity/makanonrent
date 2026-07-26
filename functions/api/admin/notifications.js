/* GET  /api/admin/notifications           → this user's notifications
   GET  /api/admin/notifications?count=1   → unread count only (badge poll)
   POST /api/admin/notifications           → { action: 'mark-read', ids? }

   A user can only ever read or modify their OWN notifications — the
   recipient filter is applied server-side from the session, never from a
   parameter, so there is no id a caller could supply to read someone
   else's inbox. */
import { json, preflight } from '../../utils/cors.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth } from '../../utils/rbac.js';
import { listFor, markRead, unreadCount } from '../../utils/notify.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var url = new URL(context.request.url);

  try {
    if (url.searchParams.get('count')) {
      return json(env, { unread: await unreadCount(env, auth.user.id) });
    }

    var rows = await listFor(env, auth.user.id, {
      unreadOnly: url.searchParams.get('unread') === '1',
      limit: Number(url.searchParams.get('limit')) || 50
    });

    return json(env, {
      notifications: rows.map(function (n) {
        return {
          id: n.id, type: n.event_type, title: n.title, body: n.body,
          entityType: n.entity_type, entityId: n.entity_id,
          severity: n.severity, readAt: n.read_at, createdAt: n.created_at
        };
      }),
      unread: await unreadCount(env, auth.user.id)
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load notifications.' }, 500);
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

  if (body.action !== 'mark-read') {
    return json(env, { error: "action must be 'mark-read'." }, 422);
  }

  try {
    /* Omitting ids marks the whole inbox read. Both paths are scoped to
       the session user inside markRead(). */
    await markRead(env, auth.user.id, Array.isArray(body.ids) ? body.ids : null);
    return json(env, { ok: true, unread: await unreadCount(env, auth.user.id) });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not update notifications.' }, 500);
  }
}
