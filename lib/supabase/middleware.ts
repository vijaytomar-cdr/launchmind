/**
 * @file middleware.ts
 * @description Supabase session refresh middleware for Next.js.
 *   Refreshes the auth token on every request so sessions stay alive.
 *   Redirects unauthenticated requests to /login for protected routes.
 * @security Never exposes session tokens. Redirect happens before page renders.
 * @dependencies @supabase/ssr, next/server
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Updates the Supabase session on each request.
 * @param request - Incoming Next.js request
 * @returns NextResponse with refreshed session cookies
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // @supabase/ssr 0.3.x uses get/set/remove (not getAll/setAll)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          request.cookies.set(name, value);
          supabaseResponse = NextResponse.next({ request });
          supabaseResponse.cookies.set(
            name,
            value,
            options as Parameters<typeof supabaseResponse.cookies.set>[2]
          );
        },
        remove(name: string, options: Record<string, unknown>) {
          request.cookies.set(name, '');
          supabaseResponse = NextResponse.next({ request });
          supabaseResponse.cookies.set(name, '', {
            ...(options as Parameters<typeof supabaseResponse.cookies.set>[2]),
            maxAge: 0,
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isDashboard = pathname.startsWith('/dashboard') || pathname === '/';

  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
