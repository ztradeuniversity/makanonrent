/* GET /api/properties/detail?id=<listing uuid>

   The public read path for ONE published listing.

   Until now the public property page had no server source at all: it
   resolved `property.html?id=…` against the local fixture in
   web/assets/js/property-data.js. That left a real hole — the Notify Me
   alert email links to `/property.html?id=<listings.id>` (see
   functions/utils/alert-match.js), a real UUID the fixture can never
   contain, so every alert a renter clicked landed on "Property not
   available". This endpoint is what that link needs, and it is what
   supplies the real listingId the signed media route already expects.

   Route style follows the sibling media.js — a flat Function file with a
   query parameter — rather than a dynamic [id].js, so both public
   property reads look and route the same way.

   Publication gate: lifecycle_state must be 'published'. That column is
   the canonical operational state written only by functions/utils/
   lifecycle.js, so submitted, pending_review, verified, unavailable,
   rejected, archived and deleted listings are simply never selected.
   The check is on the ROW, and a listing that fails it returns the same
   404 as an id that does not exist — a caller cannot use this endpoint
   to discover that an unpublished property exists.

   Privacy: the listing→unit→property chain read here holds no personal
   data. Owner identity lives in contacts/owner_profiles (phone, email),
   evidence in documents/verification_cases (CNIC and the private/ key
   prefix), and review history in the approval/audit tables — none of
   those are joined, so none of them can leak through this shape. The
   only thing taken from property_verifications is whether at least one
   row exists (the badge boolean); no column of it is returned.

   Media is NOT returned here. Photos and video stay behind the signed,
   short-lived URLs of GET /api/properties/media?listingId= — this
   endpoint only hands the client the listingId to ask with. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';

export async function onRequestOptions(context) { return preflight(context.env); }

/* listings.id is a uuid (migrations/0001). Rejecting anything else before
   the query keeps a malformed id from reaching Postgres as a cast error,
   and makes the fixture's own ids ('L-LHR-1041') a clean 404 here. */
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Same labels the frontend uses (web/assets/js/shared.js typeLabel), kept
   here because the title is composed server-side from real columns. */
var TYPE_LABEL = {
  house: 'House', flat: 'Flat', portion: 'Portion',
  office: 'Office', shop: 'Shop', room: 'Room', other: 'Other'
};

/* The schema has no listing title — the Submit wizard never asks for one.
   Composing it from size + type + area gives every real listing the same
   headline the fixture records carry, without inventing a stored field. */
function titleFor(unit, property) {
  var size = Number(unit.size_value);
  var sizeText = (isFinite(size) ? String(size) : '') +
                 (unit.size_unit === 'marla' ? ' Marla' : ' Sq Ft');
  var type = TYPE_LABEL[unit.unit_type || property.property_type] || 'Property';
  return (sizeText.trim() + ' ' + type).trim() +
         (property.area_name ? ' in ' + property.area_name : '');
}

/* Money is stored in minor units (submit.js writes rent * 100). */
function fromMinor(v) {
  return v == null ? 0 : Math.round(Number(v)) / 100;
}

export async function onRequestGet(context) {
  var env = context.env;
  var id = new URL(context.request.url).searchParams.get('id') || '';

  if (!isNonEmptyString(id, 60) || !UUID_RE.test(id)) {
    return json(env, { error: 'No such property.' }, 404);
  }

  try {
    var db = getServiceClient(env);

    var res = await db.from('listings')
      .select('id, lifecycle_state, archived_at, deleted_at, currency, ' +
              'rent_amount_minor, advance_amount_minor, negotiable, features, ' +
              'published_at, updated_at, ' +
              'units!inner(unit_type, beds, baths, car_porch, size_value, size_unit, ' +
              'properties!inner(id, business_code, category, property_type, ' +
              'city_slug, city_name, area_slug, area_name, landmark, road_width_ft))')
      .eq('id', id)
      .maybeSingle();

    if (res.error) throw res.error;

    var l = res.data;
    /* One 404 for "not published" and "does not exist" alike. archived_at/
       deleted_at are re-checked even though the lifecycle already covers
       them: two independent gates on the same row cost nothing and mean a
       single mis-set column cannot publish a removed property. */
    if (!l || l.lifecycle_state !== 'published' || l.archived_at || l.deleted_at) {
      return json(env, { error: 'No such property.' }, 404);
    }

    var u = l.units || {};
    var p = u.properties || {};

    /* Existence only — the badge claims a manager physically visited, so
       it must not be inferred from publication alone. No column of
       property_verifications (visitor id, GPS, phone, comments) is read
       into the response. */
    var verified = false;
    if (p.id) {
      var v = await db.from('property_verifications').select('id').eq('property_id', p.id).limit(1);
      verified = !v.error && !!(v.data && v.data.length);
    }

    return json(env, {
      property: {
        /* The public identity of a listing is its listings.id — the same
           value property.html?id= carries and the media route signs for. */
        id: l.id,
        listingId: l.id,
        reference: p.business_code || null,
        title: titleFor(u, p),
        category: p.category,
        type: u.unit_type || p.property_type,
        city: p.city_name,
        citySlug: p.city_slug,
        area: p.area_name,
        areaSlug: p.area_slug,
        landmark: p.landmark || null,
        rent: fromMinor(l.rent_amount_minor),
        advance: fromMinor(l.advance_amount_minor),
        currency: l.currency || 'PKR',
        negotiable: l.negotiable === true,
        beds: u.beds,
        baths: u.baths,
        carPorch: u.car_porch === true,
        size: Number(u.size_value),
        sizeUnit: u.size_unit,
        roadWidthFt: p.road_width_ft == null ? null : Number(p.road_width_ft),
        features: l.features || [],
        verified: verified,
        updatedAt: l.published_at || l.updated_at,
        /* Empty by contract: the gallery calls the signed media route with
           listingId. A permanent image URL is never returned here. */
        images: [],
        /* Inspection sections are not captured by any shipped table yet;
           the page renders its "Pending" state for each of them. */
        details: {}
      }
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load property.' }, 500);
  }
}
