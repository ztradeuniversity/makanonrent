/* POST /api/properties/submit
   Backend endpoint for the Submit Wizard's final step. Receives the
   property payload plus already-uploaded media (R2 keys/URLs — the
   wizard uploads files to R2 via /api/uploads/presign BEFORE calling
   this endpoint) and writes the enterprise-shaped rows described in
   migrations/0001_init_properties.sql, following docs/04's entity
   model (contact → owner_profile → property → unit → listing).

   Request: {
     draftId, property: {...state from wizard.js}, owner: {...},
     media: [{ key, publicUrl, kind }], verification?: { cnicFrontKey, cnicBackKey }
   }
   Response: { ref, status, propertyId, listingId }

   Inserts are sequential (Supabase JS has no client-side multi-table
   transaction). On a later failure, rows already created for this
   request are deleted so no half-written property survives — real
   atomicity would replace this with a single Postgres RPC function;
   flagged as follow-up work rather than silently accepted as final. */
import { json, preflight } from '../../utils/cors.js';
import { validateSubmitRequest } from '../../utils/validate.js';
import { getServiceClient } from '../../utils/supabase.js';
import { resolveSession } from '../../utils/session.js';
import { resolveOwner, contactForOwner } from '../../utils/owner-auth.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

/* Resolves the area node for a submission so admin-added properties land
   inside a manager's assigned scope. Returns null when the slugs do not
   correspond to a real location row — area_node_id is a foreign key, so
   guessing a path that does not exist would fail the whole insert.
   Public submissions are unaffected either way. */
async function resolveAreaNodeId(db, citySlug, areaSlug, subAreaSlug) {
  if (!citySlug) return null;

  /* Most specific first: city/main/sub → city/main → city. The Sub
     Location needs no new column — pinning area_node_id at the deepest
     node identifies it exactly, and joining `locations` recovers its
     name. Falls back cleanly when a level is absent, so submissions that
     predate the cascade (city + main only) resolve exactly as before. */
  var candidates = [];
  if (areaSlug && subAreaSlug) candidates.push(citySlug + '/' + areaSlug + '/' + subAreaSlug);
  if (areaSlug) candidates.push(citySlug + '/' + areaSlug);
  candidates.push(citySlug);

  for (var i = 0; i < candidates.length; i++) {
    var res = await db.from('locations').select('node_id').eq('node_id', candidates[i]).maybeSingle();
    if (!res.error && res.data) return res.data.node_id;
  }
  return null;
}

function normalizePkPhone(raw) {
  var digits = String(raw || '').replace(/\D/g, '');
  if (digits.indexOf('92') === 0) digits = digits.slice(2);
  if (digits.indexOf('0') === 0) digits = digits.slice(1);
  return '+92' + digits;
}

function reference(citySlug) {
  var code = (citySlug || 'pk').slice(0, 3).toUpperCase();
  var d = new Date();
  var ymd = String(d.getFullYear()).slice(2) +
            ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  var rand = String(Math.floor(1000 + Math.random() * 9000));
  return 'MOR-' + code + '-' + ymd + '-' + rand;
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var error = validateSubmitRequest(body);
  if (error) return json(env, { error: error }, 422);

  var p = body.property, owner = body.owner, media = body.media || [];
  var created = { verificationCaseId: null, listingId: null, unitId: null, ownershipClaimId: null, propertyId: null };

  async function rollback() {
    if (created.listingId) await db.from('property_media').delete().eq('listing_id', created.listingId);
    if (created.verificationCaseId) await db.from('documents').delete().eq('entity_id', created.verificationCaseId);
    if (created.verificationCaseId) await db.from('verification_cases').delete().eq('id', created.verificationCaseId);
    if (created.listingId) await db.from('listings').delete().eq('id', created.listingId);
    if (created.unitId) await db.from('units').delete().eq('id', created.unitId);
    if (created.ownershipClaimId) await db.from('property_ownership_claims').delete().eq('id', created.ownershipClaimId);
    if (created.propertyId) await db.from('properties').delete().eq('id', created.propertyId);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception.
       `var` is function-scoped, so rollback() below still closes over it. */
    var db = getServiceClient(env);

    /* OPTIONAL admin attribution. The public Submit Wizard sends no
       session cookie and this stays null, so the wizard's behaviour is
       byte-for-byte unchanged. When a signed-in Manager / Assistant CEO /
       CEO adds a property, stamping added_by_admin_id is what later lets
       the database refuse to let that same person verify or approve it
       (enforce_verification_sod / enforce_approval_sod, ADR 0001 §4).
       Without this stamp the separation-of-duty control would silently
       never trigger. */
    var adminSession = await resolveSession(env, context.request).catch(function () { return null; });
    var addedByAdminId = adminSession ? adminSession.user.id : null;

    var phone = normalizePkPhone(owner.whatsapp);

    /* contact: the person this property belongs to.

       A signed-in owner is identified by their VERIFIED Google identity,
       not by the phone number typed into the form — otherwise two people
       sharing a handset, or one owner mistyping a digit, would silently
       land the property on someone else's dashboard. The phone is still
       recorded (it is how the team actually reaches them), it just stops
       being the identity.

       With no owner session this is byte-for-byte the previous
       behaviour: phone-keyed reuse, exactly as every existing submission
       was recorded. The wizard therefore keeps working unchanged for
       anyone who has not signed in. */
    var contactId;
    var signedInOwner = await resolveOwner(env, context.request).catch(function () { return null; });

    if (signedInOwner) {
      var ownerContact = await contactForOwner(env, signedInOwner);
      contactId = ownerContact.id;

      /* Fill in what the form supplies without overwriting the verified
         address, and never clear a detail the contact already had. */
      var patch = {};
      if (phone && !ownerContact.phone_e164) patch.phone_e164 = phone;
      if (owner.name && !ownerContact.full_name) patch.full_name = owner.name;
      if (Object.keys(patch).length) {
        var fill = await db.from('contacts').update(patch).eq('id', contactId);
        /* A phone already held by a different contact row must not fail
           the whole submission — the property is still theirs. */
        if (fill.error && String(fill.error.message || '').indexOf('duplicate') === -1) throw fill.error;
      }
    } else {
      var existingContact = await db.from('contacts').select('id').eq('phone_e164', phone).maybeSingle();
      if (existingContact.error) throw existingContact.error;
      if (existingContact.data) {
        contactId = existingContact.data.id;
      } else {
        var newContact = await db.from('contacts').insert({
          full_name: owner.name, phone_e164: phone, whatsapp_ok: true,
          email: owner.email || null, source: 'submit_wizard'
        }).select('id').single();
        if (newContact.error) throw newContact.error;
        contactId = newContact.data.id;
      }
    }

    /* owner_profile *—1 contact */
    var ownerProfileId;
    var existingProfile = await db.from('owner_profiles').select('id').eq('contact_id', contactId).maybeSingle();
    if (existingProfile.error) throw existingProfile.error;
    if (existingProfile.data) {
      ownerProfileId = existingProfile.data.id;
    } else {
      var newProfile = await db.from('owner_profiles').insert({ contact_id: contactId }).select('id').single();
      if (newProfile.error) throw newProfile.error;
      ownerProfileId = newProfile.data.id;
    }

    /* property — p.city/p.area are already slugs (see wizard.js state) */
    var businessCode = reference(p.city);
    var propRes = await db.from('properties').insert({
      business_code: businessCode,
      category: p.category, property_type: p.type,
      city_slug: p.city, city_name: p.cityName,
      area_slug: p.area || null, area_name: p.areaName,
      landmark: p.landmark || null,
      road_width_ft: p.roadWidth ? Number(p.roadWidth) : null,
      first_discovered_via: 'owner',
      added_by_admin_id: addedByAdminId,
      area_node_id: await resolveAreaNodeId(db, p.city, p.area, p.subArea)
    }).select('id').single();
    if (propRes.error) throw propRes.error;
    created.propertyId = propRes.data.id;

    /* ownership_claim: property *—* owner_profile */
    var claimRes = await db.from('property_ownership_claims').insert({
      property_id: created.propertyId, owner_profile_id: ownerProfileId, claim_type: 'sole'
    }).select('id').single();
    if (claimRes.error) throw claimRes.error;
    created.ownershipClaimId = claimRes.data.id;

    /* unit: property 1—* unit */
    var unitRes = await db.from('units').insert({
      property_id: created.propertyId, unit_type: p.type,
      beds: Number(p.beds) || 0, baths: Number(p.baths) || 0,
      car_porch: !!Number(p.parking), size_value: Number(p.size), size_unit: p.sizeUnit
    }).select('id').single();
    if (unitRes.error) throw unitRes.error;
    created.unitId = unitRes.data.id;

    /* listing *—1 unit */
    var listingRes = await db.from('listings').insert({
      unit_id: created.unitId, status: 'intake', currency: p.currency || 'PKR',
      rent_amount_minor: Math.round(Number(p.rent) * 100),
      advance_amount_minor: p.advance ? Math.round(Number(p.advance) * 100) : null,
      negotiable: !!Number(p.negotiable), features: p.features || []
    }).select('id').single();
    if (listingRes.error) throw listingRes.error;
    created.listingId = listingRes.data.id;

    /* property_media: one row per uploaded file.

       visibility is set explicitly rather than left to the column default,
       so the intent is visible at the insert site: a public submission has
       not been reviewed, therefore its files are NOT publishable yet.
       functions/utils/lifecycle.js moves them on when the listing is. */
    if (media.length) {
      var mediaRows = media.map(function (m, i) {
        return {
          listing_id: created.listingId, kind: m.kind, r2_key: m.key,
          public_url: m.publicUrl || null, sort_order: i, visibility: 'draft'
        };
      });
      var mediaRes = await db.from('property_media').insert(mediaRows);
      if (mediaRes.error) throw mediaRes.error;
    }

    /* optional verification request: case + sensitive CNIC documents */
    var v = body.verification;
    if (v && (v.cnicFrontKey || v.cnicBackKey)) {
      var caseCode = 'VC-' + businessCode.replace(/^MOR-/, '');
      var caseRes = await db.from('verification_cases').insert({
        case_code: caseCode, unit_id: created.unitId, listing_id: created.listingId,
        type: 'initial', state: 'opened'
      }).select('id').single();
      if (caseRes.error) throw caseRes.error;
      created.verificationCaseId = caseRes.data.id;

      var docRows = [];
      if (v.cnicFrontKey) docRows.push({ class: 'sensitive', entity_type: 'verification_case', entity_id: created.verificationCaseId, r2_key: v.cnicFrontKey });
      if (v.cnicBackKey) docRows.push({ class: 'sensitive', entity_type: 'verification_case', entity_id: created.verificationCaseId, r2_key: v.cnicBackKey });
      if (docRows.length) {
        var docRes = await db.from('documents').insert(docRows);
        if (docRes.error) throw docRes.error;
      }
    }

    return json(env, {
      ref: businessCode, status: 'pending_review',
      propertyId: created.propertyId, listingId: created.listingId
    }, 201);
  } catch (e) {
    await rollback().catch(function () {});
    return json(env, { error: (e && e.message) || 'Submission failed.' }, 500);
  }
}
