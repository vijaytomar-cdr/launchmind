/**
 * @file client.ts
 * @description Supabase browser client for Next.js client components.
 *   Uses @supabase/ssr for cookie-based session management.
 *   Never imports or uses the service role key.
 * @security NEXT_PUBLIC_SUPABASE_ANON_KEY is safe to expose (RLS enforces access).
 *   Never use this client for admin operations — use the backend API instead.
 * @dependencies @supabase/ssr
 */

import { createBrowserClient } from '@supabase/ssr';

/**
 * Returns a Supabase browser client for use in Client Components.
 * @returns SupabaseClient configured for browser cookie auth.
 * @security Only the anon key is used — RLS enforces all row-level access.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
