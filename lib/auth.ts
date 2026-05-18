/**
 * @file lib/auth.ts
 * @description Server-side session helper for Server Components and Route Handlers.
 *   Wraps Supabase getUser() into a typed result for easy consumption.
 *   Returns null if no session — callers should redirect to /login.
 * @security Uses anon key + cookie store. Never exposes service role key.
 * @dependencies lib/supabase/server
 */

import { createClient } from '@/lib/supabase/server';

export interface ServerSession {
  userId: string;
  email: string | null;
}

/**
 * Returns the authenticated user's session for Server Components.
 * @returns ServerSession or null if not authenticated
 * @security Reads from HttpOnly cookie; never from localStorage or URL params.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
  };
}
