/* MakanOnRent — Evidence Service.
   Implements docs/adr/0002-property-operations.md §6 and Doc 16 AM-3.2:
   "Consolidate the capture-flow, hashing, GPS/time-sealing and
   perceptual-dedup logic … into ONE service consumed by every
   evidence-gated task."

   Every evidence write in the product goes through attachEvidence(). No
   module inserts into property_verification_media directly — that is the
   "three reimplementations" AM-3.2 exists to prevent, and re-implementing
   this inside a module is a rejectable offence under Doc 18 Article 4.5.

   Four responsibilities, per AM-3.2:
     capture  — kind/URL/key metadata (bytes live in R2, Doc 04 §1.1)
     hash     — SHA-256 of the file
     seal     — captured_at + device fingerprint + GPS travel WITH the file
     anti-reuse — the same bytes can never be proof for two properties

   ⚠ HONEST LIMITATION (ADR 0002 §6, §11.1): the hash is supplied by the
   CLIENT. A malicious client can send a plausible hash for bytes it never
   uploaded, which makes anti-reuse a strong control against careless
   recycling and a weak one against a determined insider. Real sealing
   needs server-side hashing of the R2 object, or a capture-only mobile
   app (Doc 05 §2.2.1 "no gallery uploads"). Do not describe this as
   tamper-proof until that lands. */
import { getServiceClient } from './supabase.js';

export var EVIDENCE_KINDS = ['image', 'video', 'document'];

/* Per-kind ceilings, mirroring functions/utils/validate.js UPLOAD_KINDS so
   the two boundaries cannot disagree about what is acceptable. */
var MAX_ITEMS = 40;

function isSha256(v) {
  return typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);
}

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/* GPS sanity. Out-of-range coordinates are dropped rather than stored:
   a nonsense fix is worse than no fix, because it looks like evidence. */
function coord(lat, lng) {
  var la = num(lat), ln = num(lng);
  if (la === null || ln === null) return { lat: null, lng: null };
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return { lat: null, lng: null };
  return { lat: la, lng: ln };
}

/* Normalises one caller-supplied item into a storable row, or returns a
   reason it cannot be stored. */
export function normaliseItem(raw, verificationId, index) {
  if (!raw || typeof raw !== 'object') return { error: 'Evidence item must be an object.' };
  if (EVIDENCE_KINDS.indexOf(raw.kind) === -1) {
    return { error: "kind must be one of: " + EVIDENCE_KINDS.join(', ') + '.' };
  }
  if (typeof raw.key !== 'string' || !raw.key.trim() || raw.key.length > 400) {
    return { error: 'An R2 object key is required for each evidence item.' };
  }
  if (raw.sha256 != null && !isSha256(raw.sha256)) {
    return { error: 'sha256 must be a 64-character hex digest.' };
  }

  var gps = coord(raw.gpsLat, raw.gpsLng);
  return {
    row: {
      verification_id: verificationId,
      kind: raw.kind,
      r2_key: raw.key.trim(),
      public_url: typeof raw.url === 'string' ? raw.url : null,
      sha256: raw.sha256 ? String(raw.sha256).toLowerCase() : null,
      byte_size: raw.byteSize != null ? num(raw.byteSize) : null,
      /* An absent capture time is recorded as absent, not backfilled with
         now() — a fabricated timestamp is worse than a missing one. */
      captured_at: raw.capturedAt || null,
      device_fingerprint: typeof raw.device === 'string' ? raw.device.slice(0, 200) : null,
      gps_lat: gps.lat,
      gps_lng: gps.lng,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 2000) : null,
      sort_order: index
    }
  };
}

/* Attaches evidence to a verification.

   Returns { attached: [...], rejected: [{ index, reason }] }. Partial
   success is a real outcome — one recycled photo in a batch of twenty
   should not discard the manager's other nineteen. */
export async function attachEvidence(env, verificationId, items) {
  var db = getServiceClient(env);

  if (!Array.isArray(items) || !items.length) return { attached: [], rejected: [] };
  if (items.length > MAX_ITEMS) {
    return { attached: [], rejected: [{ index: null, reason: 'At most ' + MAX_ITEMS + ' evidence items per verification.' }] };
  }

  /* Candidates carry the CALLER's index alongside the row. Filtering a
     plain row array and reporting the filter callback's index would name
     the wrong file the moment anything earlier was dropped — telling a
     manager that photo 3 was rejected when it was actually photo 7 is
     worse than saying nothing. The r2_key is reported too, since that is
     what the client can actually match against. */
  var candidates = [];
  var rejected = [];

  items.forEach(function (raw, i) {
    var out = normaliseItem(raw, verificationId, i);
    if (out.error) rejected.push({ index: i, key: (raw && raw.key) || null, reason: out.error });
    else candidates.push({ row: out.row, index: i });
  });

  if (!candidates.length) return { attached: [], rejected: rejected };

  /* ANTI-REUSE. Checked here for a readable error, and enforced for real
     by uq_evidence_sha256 in the database — so a concurrent double-submit
     that races past this check still cannot land twice. */
  var hashes = candidates.map(function (c) { return c.row.sha256; }).filter(Boolean);
  if (hashes.length) {
    var dupes = await db.from('property_verification_media')
      .select('sha256, verification_id')
      .in('sha256', hashes);
    if (dupes.error) throw dupes.error;

    var seen = {};
    (dupes.data || []).forEach(function (d) { seen[d.sha256] = d.verification_id; });

    candidates = candidates.filter(function (c) {
      if (c.row.sha256 && seen[c.row.sha256]) {
        rejected.push({
          index: c.index, key: c.row.r2_key,
          reason: 'This exact file has already been submitted as proof elsewhere. Capture a new photo.'
        });
        return false;
      }
      return true;
    });

    /* Duplicates WITHIN one batch: the DB index would reject the second
       insert and fail the whole statement, so they are caught here. */
    var inBatch = {};
    candidates = candidates.filter(function (c) {
      if (!c.row.sha256) return true;
      if (inBatch[c.row.sha256]) {
        rejected.push({
          index: c.index, key: c.row.r2_key,
          reason: 'The same file was submitted twice in this batch.'
        });
        return false;
      }
      inBatch[c.row.sha256] = true;
      return true;
    });
  }

  if (!candidates.length) return { attached: [], rejected: rejected };

  var rows = candidates.map(function (c) { return c.row; });
  var ins = await db.from('property_verification_media').insert(rows).select('id, kind, r2_key, sha256');
  if (ins.error) {
    if (String(ins.error.message || '').indexOf('uq_evidence_sha256') > -1) {
      return { attached: [], rejected: rejected.concat([{ index: null, reason: 'Duplicate evidence detected.' }]) };
    }
    throw ins.error;
  }

  return { attached: ins.data || [], rejected: rejected };
}

/* Reads evidence for a verification, newest verification first. */
export async function listEvidence(env, verificationId) {
  var db = getServiceClient(env);
  var res = await db.from('property_verification_media')
    .select('id, kind, r2_key, public_url, sha256, byte_size, captured_at, device_fingerprint, gps_lat, gps_lng, note, sort_order')
    .eq('verification_id', verificationId)
    .order('sort_order', { ascending: true });
  if (res.error) throw res.error;

  return (res.data || []).map(function (m) {
    return {
      id: m.id, kind: m.kind, url: m.public_url, key: m.r2_key,
      sha256: m.sha256, byteSize: m.byte_size, capturedAt: m.captured_at,
      device: m.device_fingerprint, note: m.note,
      gps: (m.gps_lat != null && m.gps_lng != null) ? { lat: m.gps_lat, lng: m.gps_lng } : null
    };
  });
}
