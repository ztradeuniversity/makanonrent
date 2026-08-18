/* MakanOnRent — Notify Me matcher (Cloudflare Pages Functions only).

   Answers one question: when a listing becomes PUBLISHED, which saved
   searches does it satisfy? The predicates below deliberately mirror
   MOR_DATA.query() in web/assets/js/property-data.js one-for-one, so a
   visitor is emailed about exactly the properties the site would have
   shown them had they searched again — the alert and the search must not
   disagree.

   Deliberate rules carried over from that function:
     - every stated criterion is an AND; there is no partial match here
       (the "closest matches" idea is a browse-time affordance, not a
       reason to email someone),
     - "beds" and "budgetMin" are minimums, "budgetMax" a maximum,
     - a criterion the visitor left blank is not a filter,
     - a property field that is NULL/absent can never satisfy a stated
       criterion. Unknown is not a yes — emailing someone about a property
       that merely might have parking is worse than staying silent. */

/* Canonical requirement keys, same list as MOR_CONFIG.propertyNeeds.
   car_parking lives on units.car_porch; the rest are tags in
   listings.features (both columns exist since migration 0001). */
function hasNeed(row, key) {
  if (key === 'car_parking') return row.carPorch === true;
  return Array.isArray(row.features) && row.features.indexOf(key) > -1;
}

function needList(v) {
  if (!v) return [];
  var arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map(function (s) { return String(s).trim(); }).filter(Boolean);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

/* `row` is the flattened published listing (see loadListingForMatch).
   `criteria` is the saved search object exactly as the browser stored it. */
export function criteriaMatches(criteria, row) {
  var c = criteria || {};

  if (c.city && row.citySlug !== c.city) return false;

  /* area is always the CANONICAL main-location slug — home.js resolves an
     alias option back to its canonical node before building the URL, so an
     alias never reaches this comparison. */
  if (c.area && row.areaSlug !== c.area) return false;

  /* Sub location. properties.area_node_id is the full location path
     (e.g. 'lahore/allama-iqbal-town-lahore/asif-block'), so the sub area
     is its last segment. A property recorded only down to the main area
     cannot satisfy a sub-area request. */
  if (c.subarea) {
    if (!row.areaNodeId) return false;
    var seg = String(row.areaNodeId).split('/').pop();
    if (seg !== c.subarea) return false;
  }

  if (c.category && row.category !== c.category) return false;
  if (c.type && row.propertyType !== c.type) return false;

  var beds = num(c.beds);
  if (beds !== null) {
    if (row.beds === null || row.beds === undefined) return false;
    if (Number(row.beds) < beds) return false;
  }

  /* Budget is entered in whole rupees; listings.rent_amount_minor stores
     rupees * 100 (functions/api/properties/submit.js). Compare in minor
     units so no rounding is introduced here. */
  var rent = num(row.rentMinor);
  var min = num(c.budgetMin), max = num(c.budgetMax);
  if (min !== null) { if (rent === null || rent < min * 100) return false; }
  if (max !== null) { if (rent === null || rent > max * 100) return false; }

  /* Size tolerance identical to MOR_DATA.query(): -25% / +35% around the
     requested figure, compared in square feet (1 marla = 225 sq ft). */
  var size = num(c.areaSize);
  if (size !== null) {
    var want = c.areaUnit === 'sqft' ? size : size * 225;
    var have = row.sizeUnit === 'sqft' ? num(row.sizeValue)
             : (num(row.sizeValue) === null ? null : num(row.sizeValue) * 225);
    if (have === null) return false;
    if (have < want * 0.75 || have > want * 1.35) return false;
  }

  var needs = needList(c.needs);
  for (var i = 0; i < needs.length; i++) {
    if (!hasNeed(row, needs[i])) return false;
  }

  return true;
}

/* Reads one listing and flattens the listing→unit→property chain into the
   shape criteriaMatches expects. Returns null when the listing is not
   published — the caller must never alert on a draft, pending, rejected or
   withdrawn listing, so that check lives here rather than at each call
   site. */
export async function loadListingForMatch(db, listingId) {
  var res = await db.from('listings')
    .select('id, lifecycle_state, rent_amount_minor, features, ' +
            'units!inner(beds, car_porch, size_value, size_unit, ' +
            'properties!inner(city_slug, area_slug, area_node_id, category, property_type, business_code))')
    .eq('id', listingId)
    .maybeSingle();

  if (res.error || !res.data) return null;
  if (res.data.lifecycle_state !== 'published') return null;

  var u = res.data.units || {};
  var p = u.properties || {};
  return {
    id: res.data.id,
    rentMinor: res.data.rent_amount_minor,
    features: res.data.features || [],
    beds: u.beds,
    carPorch: u.car_porch === true,
    sizeValue: u.size_value,
    sizeUnit: u.size_unit,
    citySlug: p.city_slug,
    areaSlug: p.area_slug,
    areaNodeId: p.area_node_id,
    category: p.category,
    propertyType: p.property_type,
    businessCode: p.business_code
  };
}

/* Matches a newly published listing against every open saved search and
   enqueues one email per match onto the existing email_delivery_queue.

   Ordering matters for the duplicate guard: the property_alert_sends row
   is inserted FIRST, and only a successful insert (i.e. this pairing was
   not already recorded) leads to an enqueue. A repeat run, a concurrent
   run, or a listing that is unpublished and published again therefore
   cannot produce a second email for the same person and property.

   Never throws: publication must succeed even if alerting cannot. */
export async function dispatchAlertsForListing(env, db, listingId, opts) {
  var out = { matched: 0, queued: 0, skipped: 0, errors: [] };
  try {
    var row = await loadListingForMatch(db, listingId);
    if (!row) return out;

    var reqs = await db.from('property_notify_requests')
      .select('id, email, criteria')
      .is('fulfilled_at', null)
      .not('criteria', 'is', null)
      .not('email', 'is', null)
      .limit((opts && opts.limit) || 500);

    if (reqs.error) { out.errors.push(reqs.error.message); return out; }

    var siteUrl = (env.SITE_URL || '').replace(/\/+$/, '');

    for (var i = 0; i < (reqs.data || []).length; i++) {
      var r = reqs.data[i];
      if (!criteriaMatches(r.criteria, row)) continue;
      out.matched++;

      var claim = await db.from('property_alert_sends')
        .insert({ request_id: r.id, listing_id: row.id })
        .select('id').single();

      /* Unique-index collision = already emailed for this pairing. */
      if (claim.error) { out.skipped++; continue; }

      var q = await db.from('email_delivery_queue').insert({
        to_email: r.email,
        template: 'notify_available',
        payload: {
          listingId: row.id,
          reference: row.businessCode || null,
          url: siteUrl ? siteUrl + '/property.html?id=' + encodeURIComponent(row.id) : null
        }
      });
      if (q.error) { out.errors.push(q.error.message); continue; }

      await db.from('property_notify_requests')
        .update({ fulfilled_at: new Date().toISOString() })
        .eq('id', r.id);
      out.queued++;
    }
  } catch (e) {
    out.errors.push((e && e.message) || 'alert dispatch failed');
  }
  return out;
}
