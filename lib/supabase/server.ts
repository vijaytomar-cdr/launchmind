/**
 * @file server.ts
 * @description Supabase server client for Next.js Server Components and Route Handlers.
 *   Uses @supabase/ssr cookie store to carry the user session server-side.
 *   Never imports or uses the service role key — that lives in backend/src/lib/supabaseAdmin.ts.
 * @security Reads cookies from the request; never logs session tokens.
 *   For admin ops (bypassing RLS) use the Fastify backend, not this client.
 * @dependencies @supabase/ssr, next/headers
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Returns a Supabase server client scoped to the current request's session.
 * @returns SupabaseClient with cookie-based auth for Server Components.
 * @security Only anon key used. RLS enforces row-level access per auth.uid().
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr 0.3.x uses get/set/remove (not getAll/setAll)
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          } catch {
            // Server Component — cookies are read-only here; ignore in that context
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set(name, '', {
              ...(options as Parameters<typeof cookieStore.set>[2]),
              maxAge: 0,
            });
          } catch {
            // Server Component — read-only
          }
        },
      },
    }
  );
}
