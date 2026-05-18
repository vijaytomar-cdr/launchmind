/**
 * @file app/auth/callback/route.ts
 * @description Supabase Auth callback route handler.
 *   Exchanges the PKCE code (from email magic links and OAuth) for a session.
 *   Used by: password reset emails, future OAuth providers.
 *   After exchange, redirects to `next` param (default: /dashboard).
 * @security
 *   - Code exchange happens server-side via the Supabase server client.
 *   - Session cookie is written into the HTTP response before any redirect.
 *   - `next` param is validated against an allowlist to prevent open redirect.
 * @dependencies lib/supabase/server, next/server
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_NEXT_PATHS = ['/dashboard', '/reset-password', '/dashboard/products'];

function isSafeNextPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  return ALLOWED_NEXT_PATHS.some((allowed) => path === allowed || path.startsWith(allowed + '/'));
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const safePath = isSafeNextPath(next) ? next : '/dashboard';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safePath}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
