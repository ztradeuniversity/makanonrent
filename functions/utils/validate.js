/* MakanOnRent — minimal request validation for functions/api/*.
   Deliberately small: reject obviously-bad payloads before they reach
   Supabase or R2. Not a schema-validation library — the DB migration
   (migrations/0001_init_properties.sql) is the actual source of truth
   and enforces NOT NULL / CHECK constraints server-side too. */

export function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= (maxLen || 500);
}

export function isNumberLike(v) {
  return v !== '' && v != null && !isNaN(Number(v));
}

/* Allowlists mirror web/assets/js/config.js CFG.submit limits — the
   client's limits are UX only, these are the actual boundary. */
export var UPLOAD_KINDS = {
  'property-image': { contentTypes: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 15, public: true },
  'property-video': { contentTypes: ['video/mp4', 'video/quicktime', 'video/webm'], maxMB: 100, public: true },
  'cnic': { contentTypes: ['image/jpeg', 'image/png'], maxMB: 10, public: false }
};

export function validatePresignRequest(body) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (!isNonEmptyString(body.draftId, 80)) return 'draftId is required.';
  if (!isNonEmptyString(body.filename, 255)) return 'filename is required.';
  if (!UPLOAD_KINDS[body.kind]) return 'kind must be one of: ' + Object.keys(UPLOAD_KINDS).join(', ');
  var kind = UPLOAD_KINDS[body.kind];
  if (!kind.contentTypes.includes(body.contentType)) {
    return 'contentType ' + body.contentType + ' is not allowed for kind ' + body.kind + '.';
  }
  if (body.sizeBytes != null && Number(body.sizeBytes) > kind.maxMB * 1024 * 1024) {
    return 'File exceeds the ' + kind.maxMB + 'MB limit for ' + body.kind + '.';
  }
  return null;
}

export function validateSubmitRequest(body) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (!isNonEmptyString(body.draftId, 80)) return 'draftId is required.';

  var p = body.property;
  if (!p || typeof p !== 'object') return 'property is required.';
  if (!isNonEmptyString(p.category, 40)) return 'property.category is required.';
  if (!isNonEmptyString(p.type, 40)) return 'property.type is required.';
  /* Field names match wizard.js's `state` object exactly (city/area are
     already slugs there — see assets/js/wizard.js state init). */
  if (!isNonEmptyString(p.city, 80)) return 'property.city is required.';
  if (!isNonEmptyString(p.cityName, 120)) return 'property.cityName is required.';
  if (!isNonEmptyString(p.areaName, 160)) return 'property.areaName is required.';
  if (!isNumberLike(p.size) || Number(p.size) <= 0) return 'property.size must be a positive number.';
  if (!isNumberLike(p.rent) || Number(p.rent) <= 0) return 'property.rent must be a positive number.';

  var owner = body.owner;
  if (!owner || typeof owner !== 'object') return 'owner is required.';
  if (!isNonEmptyString(owner.name, 160)) return 'owner.name is required.';
  if (!isNonEmptyString(owner.whatsapp, 20)) return 'owner.whatsapp is required.';

  if (body.media && !Array.isArray(body.media)) return 'media must be an array.';
  return null;
}
