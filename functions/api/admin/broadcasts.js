/* GET  /api/admin/broadcasts        → recent broadcasts + audience size
   POST /api/admin/broadcasts        → { title, body, url?, send? }

   The site-wide announcement channel: "new city launched", "new service",
   "important update". Deliberately manual — a broadcast is only ever sent
   because an authorised admin pressed send on this endpoint. Nothing in
   the codebase sends one automatically, and there is no schedule.

   Reuses, rather than restates:
     · functions/utils/push.js        for VAPID + payload encryption
     · push_subscriptions             the one subscriber table
     · rbac.requireCapability         the existing permission model
     · auditFor                       the existing audit trail

   Audience is only ever subscribers with site_updates_enabled and no
   revoked_at. A visitor who allowed property alerts but not announcements
   is not in it — the two consents are independent and this endpoint can
   only ever read the announcement one.

   Permissions follow the existing settings model, because a message to
   every subscriber is a company-wide act rather than an area one:
   'settings.read' (CEO + Assistant CEO) to review what has been sent,
   'settings.write' (CEO only) to create or send. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireCapability } from '../../utils/rbac.js';
import { auditFor } from '../../utils/audit.js';
import { sendPush } from '../../utils/push.js';

export async function onRequestOptions(context) { return preflight(context.env); }

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'settings.read');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);

    var res = await db.from('push_broadcasts')
      .select('id, title, body, url, audience, status, created_at, sent_at, sent_count, failed_count')
      .order('created_at', { ascending: false })
      .limit(50);
    if (res.error) throw res.error;

    /* How many browsers would actually receive one right now — the number
       an admin needs before pressing send. */
    var subs = await db.from('push_subscriptions')
      .select('id')
      .is('revoked_at', null)
      .eq('site_updates_enabled', true)
      .limit(10000);
    if (subs.error) throw subs.error;

    return json(env, {
      broadcasts: res.data || [],
      audienceSize: (subs.data || []).length,
      configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load broadcasts.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'settings.write');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(body.title, 120)) {
    return json(env, { error: 'A title is required (120 characters or fewer).' }, 422);
  }
  if (!isNonEmptyString(body.body, 300)) {
    return json(env, { error: 'A message is required (300 characters or fewer).' }, 422);
  }
  if (body.url && !isNonEmptyString(body.url, 500)) {
    return json(env, { error: 'The link is too long.' }, 422);
  }
  /* A broadcast opens a page in the user's browser, so the destination is
     restricted to this site — an admin account cannot be used to push an
     arbitrary external link to every subscriber. */
  var target = null;
  if (body.url) {
    var site = (env.SITE_URL || '').replace(/\/+$/, '');
    var raw = String(body.url).trim();
    if (raw.indexOf('/') === 0) target = site + raw;
    else if (site && raw.indexOf(site + '/') === 0) target = raw;
    else return json(env, { error: 'The link must be a path on this site, e.g. /rent.html.' }, 422);
  }

  try {
    var db = getServiceClient(env);

    var created = await db.from('push_broadcasts').insert({
      title: body.title.trim(),
      body: body.body.trim(),
      url: target,
      audience: 'site_updates',
      status: body.send === true ? 'sending' : 'draft',
      created_by: (auth.user && auth.user.id) || null
    }).select('id').single();
    if (created.error) throw created.error;

    var id = created.data.id;

    await auditFor(env, auth.user, context.request)(
      'create_broadcast', 'broadcast', id,
      { title: body.title, send: body.send === true });

    /* Saving and sending are separate on purpose: a draft can be written
       and reviewed without anything leaving the building. */
    if (body.send !== true) {
      return json(env, { ok: true, id: id, status: 'draft', sent: 0 }, 201);
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      await db.from('push_broadcasts').update({ status: 'failed' }).eq('id', id);
      return json(env, { error: 'Push is not configured on this deployment.' }, 503);
    }

    var subs = await db.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .is('revoked_at', null)
      .eq('site_updates_enabled', true)
      .limit(10000);
    if (subs.error) throw subs.error;

    var payload = {
      kind: 'update',
      title: body.title.trim(),
      body: body.body.trim(),
      url: target || (env.SITE_URL || '/')
    };

    var list = subs.data || [];
    var sent = 0, failed = 0, revoked = 0;

    for (var i = 0; i < list.length; i++) {
      var res = await sendPush(env, list[i], payload);
      if (res.ok) { sent++; continue; }
      failed++;
      if (res.gone) {
        revoked++;
        await db.from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', list[i].id);
      }
    }

    var upd = await db.from('push_broadcasts').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_count: sent,
      failed_count: failed
    }).eq('id', id);
    if (upd.error) throw upd.error;

    await auditFor(env, auth.user, context.request)(
      'send_broadcast', 'broadcast', id, { sent: sent, failed: failed, revoked: revoked });

    return json(env, {
      ok: true, id: id, status: 'sent',
      sent: sent, failed: failed, revoked: revoked, audienceSize: list.length
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Broadcast failed.' }, 500);
  }
}
