/* GET /api/properties/media?listingId=<uuid>

   The controlled read path for property media. Before this existed, the
   only way to display a photo was the permanent R2_PUBLIC_BASE_URL link
   recorded in property_media.public_url — a forever-valid address that
   worked no matter what state the listing was in.

   This endpoint replaces that with two gates:

     1. property_media.visibility must be 'published'. That column is a
        projection of the listing lifecycle maintained in
        functions/utils/lifecycle.js, so pending, draft, rejected,
        archived and deleted media are simply never selected here. The
        filter is applied in the QUERY, not in JavaScript afterwards —
        an unpublished row never leaves the database.

     2. Each returned URL is a short-lived presigned GET against the
        bucket's S3 endpoint, minted per request. A link that leaks stops
        working; it is not a permanent public address.

   Unauthenticated by design: everything it can return is, by definition,
   media the site publishes to the public. It cannot be coaxed into
   returning anything else, because the visibility filter is not a
   caller-supplied parameter.

   Private/sensitive documents (CNIC etc.) live in the `documents` table
   under the private/ key prefix and are never in property_media, so they
   are unreachable through this route. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { presignGetUrl } from '../../utils/r2.js';

export async function onRequestOptions(context) { return preflight(context.env); }

/* Long enough to load a gallery and click through it, short enough that a
   copied URL is not a lasting hole. */
var URL_TTL_SECONDS = 600;

export async function onRequestGet(context) {
  var env = context.env;
  var listingId = new URL(context.request.url).searchParams.get('listingId') || '';

  if (!isNonEmptyString(listingId, 60)) {
    return json(env, { error: 'listingId is required.' }, 422);
  }

  try {
    var db = getServiceClient(env);

    var res = await db.from('property_media')
      .select('id, kind, r2_key, sort_order')
      .eq('listing_id', listingId)
      .eq('visibility', 'published')
      .order('sort_order');

    if (res.error) throw res.error;

    var rows = res.data || [];
    var media = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      /* A signing failure on one object must not blank the whole gallery. */
      try {
        media.push({
          id: r.id,
          kind: r.kind,
          sortOrder: r.sort_order,
          url: await presignGetUrl(env, r.r2_key, { expiresSeconds: URL_TTL_SECONDS })
        });
      } catch (e) { /* skip this object */ }
    }

    return json(env, { media: media, expiresIn: URL_TTL_SECONDS });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load media.' }, 500);
  }
}
