/**
 * @file supabaseAdmin.ts
 * @description Supabase admin client using the service role key.
 *   Bypasses RLS — use ONLY in server-side route handlers, never in frontend code.
 *   All founder-scoped reads must still filter by founder_id explicitly.
 * @security Service role key grants full DB access. Never return this client or its
 *   raw results to the frontend. Import only from backend/src.
 * @dependencies @supabase/supabase-js
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase admin client.
 * Lazy-initialised so tests can set env vars before first call.
 * @returns SupabaseClient with service role privileges.
 * @throws  {Error} If SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set.
 * @security Never expose this client or its JWT to the frontend.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}
