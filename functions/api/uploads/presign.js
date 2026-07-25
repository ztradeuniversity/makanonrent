/* POST /api/uploads/presign
   Reusable upload service — every image/video/CNIC upload in the
   product (Submit Wizard today; Edit Property, Admin ERP later) calls
   this same endpoint. Returns a short-lived presigned R2 PUT URL; the
   browser uploads the file directly to R2 (no base64, no proxying
   bytes through this Function, nothing written to disk here).

   Request:  { draftId, filename, contentType, kind, sizeBytes? }
             kind: 'property-image' | 'property-video' | 'cnic'
   Response: { key, uploadUrl, publicUrl }
             publicUrl is null for kind:'cnic' — sensitive documents are
             never given a public URL (see functions/utils/r2.js). */
import { json, preflight } from '../../utils/cors.js';
import { jsonError } from '../../utils/env.js';
import { validatePresignRequest } from '../../utils/validate.js';
import { presignPutUrl, buildObjectKey, publicUrlFor } from '../../utils/r2.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestPost(context) {
  var env = context.env;
  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return jsonError('Request body must be valid JSON.', 400);
  }

  var error = validatePresignRequest(body);
  if (error) return json(env, { error: error }, 422);

  var visibility = body.kind === 'cnic' ? 'private' : 'public';
  var key = buildObjectKey(body.draftId, body.kind, body.filename, visibility);

  try {
    var uploadUrl = await presignPutUrl(env, key, { expiresSeconds: 600 });
    return json(env, {
      key: key,
      uploadUrl: uploadUrl,
      publicUrl: visibility === 'public' ? publicUrlFor(env, key) : null
    });
  } catch (e) {
    return json(env, { error: e.message || 'Failed to create upload URL.' }, 500);
  }
}
