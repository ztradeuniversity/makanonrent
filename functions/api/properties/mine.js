/* GET /api/properties/mine → the signed-in owner's own properties.

   The isolation boundary for owner data. Two things make it hold:

     1. The owner is resolved from the session cookie by GoTrue, never
        from anything the request claims about itself. There is no
        ownerId/email/contactId parameter to forge — this endpoint takes
        no input at all.

     2. The query is rooted at THAT owner's ownership claims. It is not a
        "fetch everything then filter in JavaScript" read: a property the
        caller does not own is never selected, so it cannot leak through
        a mapping bug later in this file.

   Returns the review-facing truth an owner is entitled to — lifecycle
   state, approval state, and the reason a listing was rejected or
   returned — and nothing about the staff who decided it. Manager names,
   internal comments, verification GPS and audit rows stay out. */
import { json, jsonWithHeaders, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { resolveOwner, contactForOwner } from '../../utils/owner-auth.js';
import { STATE_LABEL } from '../../utils/lifecycle.js';

export async function onRequestOptions(context) { return preflight(context.env); }

var TYPE_LABEL = {
  house: 'House', flat: 'Flat', portion: 'Portion',
  office: 'Office', shop: 'Shop', room: 'Room', other: 'Other'
};

/* What the owner dashboard groups by. The lifecycle has eight states and
   an owner does not need that vocabulary — they need to know whether it
   is live, still being looked at, refused, or put away. */
function ownerStatus(lifecycleState) {
  if (lifecycleState === 'published') return 'live';
  if (lifecycleState === 'rejected') return 'rejected';
  if (lifecycleState === 'archived' || lifecycleState === 'deleted') return 'archived';
  return 'pending_review';
}

var APPROVAL_LABEL = {
  pending_manager: 'With the area manager',
  pending_assistant_ceo: 'With the assistant CEO',
  pending_ceo: 'With the CEO',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned for correction'
};

function title(unit, property) {
  var size = Number(unit && unit.size_value);
  var sizeText = (isFinite(size) ? String(size) : '') +
                 (unit && unit.size_unit === 'marla' ? ' Marla' : ' Sq Ft');
  var type = TYPE_LABEL[(unit && unit.unit_type) || (property && property.property_type)] || 'Property';
  return (sizeText.trim() + ' ' + type).trim() +
         (property && property.area_name ? ' in ' + property.area_name : '');
}

export async function onRequestGet(context) {
  var env = context.env;

  var owner;
  try {
    owner = await resolveOwner(env, context.request);
  } catch (e) {
    return json(env, { error: 'Could not verify your session.' }, 401);
  }
  if (!owner) return json(env, { error: 'Sign in to see your properties.' }, 401);

  try {
    var db = getServiceClient(env);
    var contact = await contactForOwner(env, owner);

    var profile = await db.from('owner_profiles').select('id').eq('contact_id', contact.id).maybeSingle();
    if (profile.error) throw profile.error;
    /* Signed in but has never submitted anything — an empty list, not an
       error, and not a reason to create an ownership record. */
    if (!profile.data) return respond(env, owner, { properties: [] });

    var claims = await db.from('property_ownership_claims')
      .select('property_id')
      .eq('owner_profile_id', profile.data.id);
    if (claims.error) throw claims.error;

    var propertyIds = (claims.data || []).map(function (c) { return c.property_id; });
    if (!propertyIds.length) return respond(env, owner, { properties: [] });

    /* Rooted at the owner's own property ids — the scope is in the WHERE
       clause, not in a filter afterwards. */
    var res = await db.from('listings')
      .select('id, lifecycle_state, approval_state, rent_amount_minor, advance_amount_minor, ' +
              'currency, published_at, created_at, updated_at, archived_at, deleted_at, ' +
              'units!inner(unit_type, beds, baths, size_value, size_unit, property_id, ' +
              'properties!inner(id, business_code, category, property_type, city_name, ' +
              'area_name, area_node_id, landmark))')
      .in('units.property_id', propertyIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error) throw res.error;

    var rows = (res.data || []).filter(function (l) {
      /* Belt and braces: the embedded filter above is the real gate, but
         a row whose property is not in the claim set must never survive a
         change to how that filter is expressed. */
      return l.units && l.units.properties && propertyIds.indexOf(l.units.properties.id) > -1;
    });

    /* The reason a listing was rejected or returned. Read from the
       lifecycle history the transition service already writes, so there
       is no second explanation to keep in step. */
    var reasons = {};
    var needReason = rows.filter(function (l) {
      return l.lifecycle_state === 'rejected' || l.approval_state === 'returned';
    }).map(function (l) { return l.id; });

    if (needReason.length) {
      var hist = await db.from('listing_status_history')
        .select('listing_id, to_state, reason, at')
        .in('listing_id', needReason)
        .order('at', { ascending: false });
      if (!hist.error) {
        (hist.data || []).forEach(function (h) {
          if (!reasons[h.listing_id] && h.reason) reasons[h.listing_id] = h.reason;
        });
      }
    }

    var out = rows.map(function (l) {
      var u = l.units || {};
      var p = u.properties || {};
      var sub = p.area_node_id ? String(p.area_node_id).split('/') : [];
      return {
        listingId: l.id,
        reference: p.business_code || null,
        title: title(u, p),
        category: p.category,
        type: u.unit_type || p.property_type,
        city: p.city_name || null,
        mainLocation: p.area_name || null,
        /* The sub location is the deepest segment of the node path, and
           only when the property was actually recorded that deep. */
        subLocation: sub.length >= 3 ? sub[sub.length - 1].replace(/-/g, ' ') : null,
        landmark: p.landmark || null,
        beds: u.beds,
        baths: u.baths,
        rent: l.rent_amount_minor == null ? 0 : Math.round(l.rent_amount_minor) / 100,
        advance: l.advance_amount_minor == null ? 0 : Math.round(l.advance_amount_minor) / 100,
        currency: l.currency || 'PKR',
        submittedAt: l.created_at,
        updatedAt: l.updated_at || l.created_at,
        publishedAt: l.published_at || null,
        lifecycleState: l.lifecycle_state,
        lifecycleLabel: STATE_LABEL[l.lifecycle_state] || l.lifecycle_state,
        approvalState: l.approval_state || null,
        approvalLabel: l.approval_state ? (APPROVAL_LABEL[l.approval_state] || l.approval_state) : null,
        status: ownerStatus(l.lifecycle_state),
        published: l.lifecycle_state === 'published',
        reason: reasons[l.id] || null
      };
    });

    return respond(env, owner, { properties: out });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load your properties.' }, 500);
  }
}

function respond(env, owner, body) {
  return owner.setCookie
    ? jsonWithHeaders(env, body, 200, { 'Set-Cookie': owner.setCookie })
    : json(env, body);
}
