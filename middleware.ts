/**
 * @file middleware.ts
 * @description Next.js edge middleware. Refreshes Supabase session on every request.
 *   Protects dashboard routes — redirects unauthenticated users to /login.
 * @security Session token refresh happens in edge runtime before any page code runs.
 * @dependencies lib/supabase/middleware
 */

import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
