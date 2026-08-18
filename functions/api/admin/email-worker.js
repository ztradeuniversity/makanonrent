/* POST /api/admin/email-worker — the scheduler entrypoint.
   Cloudflare Pages Functions have no scheduled()/cron entrypoint (that's
   a Workers Modules-syntax feature; Pages is file-based routing only),
   so wrangler.toml's [triggers] crons cannot invoke this directly. This
   endpoint IS the minimum unit a Cron Trigger on a companion Worker (or
   any external scheduler) calls on an interval. One call does all three
   jobs — no duplicate per-job endpoints, no new DB objects, reuses the
   existing email queue, notify requests, and admin_tasks tables. Gated
   by a shared secret header, same convention as bootstrap.js. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { sendEmail, renderTemplate } from '../../utils/mailer.js';
import { dispatchAlertsForListing } from '../../utils/alert-match.js';

export async function onRequestOptions(context) { return preflight(context.env); }

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function onRequestPost(context) {
  var env = context.env;
  if (!env.EMAIL_WORKER_TOKEN || !safeEqual(context.request.headers.get('X-Email-Worker-Token') || '', env.EMAIL_WORKER_TOKEN)) {
    return json(env, { error: 'Not authorized.' }, 403);
  }

  try {
    var db = getServiceClient(env);
    var rows = await db.from('email_delivery_queue').select('*').eq('status', 'pending').order('created_at').limit(25);
    if (rows.error) throw rows.error;

    var sent = 0, failed = 0;
    for (var i = 0; i < (rows.data || []).length; i++) {
      var r = rows.data[i];
      try {
        var tpl = renderTemplate(r.template, r.payload || {});
        await sendEmail(env, r.to_email, tpl.subject, tpl.text);
        await db.from('email_delivery_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
        sent++;
      } catch (e) {
        await db.from('email_delivery_queue').update({ status: 'failed', last_error: (e && e.message) || 'send failed', attempts: (r.attempts || 0) + 1 }).eq('id', r.id);
        failed++;
      }
    }
    /* Notify Me — entity requests ("tell me about THIS listing"): fulfil
       the ones whose listing is now live by enqueueing onto the SAME
       email_delivery_queue (no second send path). */
    var notified = 0;
    var pending = await db.from('property_notify_requests').select('id, entity_id, email').is('fulfilled_at', null).not('entity_id', 'is', null).not('email', 'is', null).limit(50);
    if (!pending.error) {
      for (var j = 0; j < (pending.data || []).length; j++) {
        var n = pending.data[j];
        var live = await db.from('listings').select('id').eq('id', n.entity_id).eq('lifecycle_state', 'published').maybeSingle();
        if (live.data) {
          await db.from('email_delivery_queue').insert({ to_email: n.email, template: 'notify_available', payload: { entityId: n.entity_id, listingId: n.entity_id } });
          await db.from('property_notify_requests').update({ fulfilled_at: new Date().toISOString() }).eq('id', n.id);
          notified++;
        }
      }
    }

    /* Notify Me — saved searches. These are normally dispatched the moment
       a listing publishes (functions/utils/lifecycle.js), so this pass is a
       SAFETY NET: it catches requests saved after a property went live, and
       anything the inline dispatch missed because of a transient DB error.
       property_alert_sends makes it idempotent, so re-running cannot email
       anyone twice. Bounded to recent listings to keep the sweep cheap. */
    var swept = 0;
    var openSearches = await db.from('property_notify_requests')
      .select('id').is('fulfilled_at', null).not('criteria', 'is', null).limit(1);
    if (!openSearches.error && (openSearches.data || []).length) {
      var recent = await db.from('listings')
        .select('id').eq('lifecycle_state', 'published')
        .order('published_at', { ascending: false }).limit(50);
      for (var m = 0; m < ((recent && recent.data) || []).length; m++) {
        var res = await dispatchAlertsForListing(env, db, recent.data[m].id);
        swept += res.queued;
      }
    }

    /* 24h reverification: published listings with no verification in the
       last 24h get a 'verify_properties' admin_tasks row — reuses the
       existing task/assignment workflow, no new table, no new logic. */
    var reverified = 0;
    var stale = await db.from('listings').select('id, units!inner(properties!inner(id, area_node_id, added_by_admin_id))').eq('lifecycle_state', 'published').lt('lifecycle_changed_at', new Date(Date.now() - 24 * 3600000).toISOString()).limit(50);
    if (!stale.error) {
      for (var k = 0; k < (stale.data || []).length; k++) {
        var s = stale.data[k];
        var prop = s.units.properties;
        /* admin_tasks.assigned_to is NOT NULL — no "unassigned" sentinel
           exists and adding one would be a schema change, so a property
           with no admin owner (e.g. a public-wizard submission) is
           skipped here rather than inserted with an invalid value. An
           assigned manager for its area is the correct real fix, out of
           scope for this task. */
        if (!prop.added_by_admin_id) continue;
        var recent = await db.from('property_verifications').select('id').eq('property_id', prop.id).gte('verified_at', new Date(Date.now() - 24 * 3600000).toISOString()).limit(1);
        if (!recent.data || !recent.data.length) {
          await db.from('admin_tasks').insert({ assigned_to: prop.added_by_admin_id, task_type: 'verify_properties', title: 'Reverify property (24h)', target_count: 1, due_date: new Date().toISOString().slice(0, 10), area_node_id: prop.area_node_id, source: 'system' }).select('id');
          reverified++;
        }
      }
    }

    return json(env, { ok: true, sent: sent, failed: failed, notified: notified, swept: swept, reverified: reverified });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Worker failed.' }, 500);
  }
}
