/* MakanOnRent — property-match push dispatch (Cloudflare Pages Functions).

   The push counterpart of dispatchAlertsForListing in alert-match.js, and
   deliberately a thin one: it imports that module's criteriaMatches and
   loadListingForMatch rather than restating either. There is ONE matcher
   and ONE definition of a published listing in this codebase; an email
   subscriber and a push subscriber must never be told different things
   about the same property.

   The only real difference is who is being matched. alert-match.js reads
   property_notify_requests, where each row is one saved search belonging
   to a contact. Here each row is a browser subscription carrying up to ten
   recent searches, and a match on ANY of them is a match — the visitor
   never explicitly saved a search, so their recent searches are the
   statement of interest.

   Never throws: publication must succeed even if notifying cannot. */
import { criteriaMatches, loadListingForMatch } from './alert-match.js';
import { sendPush } from './push.js';

var TYPE_LABEL = {
  house: 'House', flat: 'Flat', portion: 'Portion',
  office: 'Office', shop: 'Shop', room: 'Room', other: 'Other'
};

/* "3 Bedroom Portion in Allama Iqbal Town" — assembled from the same
   flattened row the matcher used, so the text can never describe a
   property the match was not actually about. */
export function notificationFor(row, siteUrl) {
  var type = TYPE_LABEL[row.propertyType] || 'Property';
  var beds = Number(row.beds);
  var lead = (beds > 0 ? beds + ' Bedroom ' : '') + type;

  var where = row.areaName || row.areaSlug || row.cityName || row.citySlug || '';
  where = String(where).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });

  var base = (siteUrl || '').replace(/\/+$/, '');
  return {
    kind: 'property',
    title: 'New property available',
    body: lead + (where ? ' in ' + where : ''),
    url: base ? base + '/property.html?id=' + encodeURIComponent(row.id)
              : '/property.html?id=' + encodeURIComponent(row.id),
    listingId: row.id
  };
}

/* Any one of the visitor's recent searches matching is enough. A
   subscription with no stored searches is NOT notified: an empty interest
   profile is not a wildcard, and treating it as one would turn "I allowed
   notifications" into "send me everything". */
export function subscriptionWants(sub, row) {
  var interests = sub.interests || {};
  var searches = Array.isArray(interests.searches) ? interests.searches : [];
  if (!searches.length) return false;
  for (var i = 0; i < searches.length; i++) {
    if (criteriaMatches(searches[i], row)) return true;
  }
  return false;
}

export async function dispatchPushForListing(env, db, listingId, opts) {
  var out = { considered: 0, matched: 0, sent: 0, skipped: 0, revoked: 0, errors: [] };

  /* No VAPID configured = push is not enabled on this deployment. Not an
     error, and not something that should appear in a publication result. */
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return out;

  try {
    var row = await loadListingForMatch(db, listingId);
    /* Returns null unless the listing is published — the publication gate
       lives there, so it is not restated (or forgotten) here. */
    if (!row) return out;

    var subs = await db.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, interests')
      .is('revoked_at', null)
      .eq('property_interest_enabled', true)
      .limit((opts && opts.limit) || 1000);

    if (subs.error) { out.errors.push(subs.error.message); return out; }

    var notification = notificationFor(row, env.SITE_URL);
    var list = subs.data || [];
    out.considered = list.length;

    for (var i = 0; i < list.length; i++) {
      var sub = list[i];
      if (!subscriptionWants(sub, row)) continue;
      out.matched++;

      /* Claim BEFORE sending, exactly as property_alert_sends does: the
         unique index on (subscription_id, listing_id) is what makes a
         repeat run, a concurrent run, or an unpublish/republish cycle
         unable to notify the same browser twice. */
      var claim = await db.from('push_sends')
        .insert({ subscription_id: sub.id, listing_id: row.id })
        .select('id').single();
      if (claim.error) { out.skipped++; continue; }

      var res = await sendPush(env, sub, notification);
      if (res.ok) { out.sent++; continue; }

      if (res.gone) {
        /* The browser threw the subscription away. Stop sending to it
           rather than failing on it for ever. */
        out.revoked++;
        await db.from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', sub.id);
        continue;
      }
      out.errors.push('push ' + (res.status || 0) + (res.error ? ': ' + res.error : ''));
    }
  } catch (e) {
    out.errors.push((e && e.message) || 'push dispatch failed');
  }
  return out;
}
