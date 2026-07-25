/* MakanOnRent — server-side Supabase client (Cloudflare Pages Functions
   only). This is the ONE place a Supabase client is constructed for the
   backend — every function under functions/api imports getServiceClient
   from here rather than creating its own, so there is never a second,
   divergent client configuration.

   SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security by design — it
   must never reach the browser. It is read from the Pages Functions
   `env` binding (Cloudflare secret), not from any bundled file, so it
   physically cannot end up in the static web/ output. */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

var cached = null;
var cachedUrl = null;

export function getServiceClient(env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (cached && cachedUrl === env.SUPABASE_URL) return cached;

  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  cachedUrl = env.SUPABASE_URL;
  return cached;
}
