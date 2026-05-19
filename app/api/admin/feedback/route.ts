/**
 * @file app/api/admin/feedback/route.ts
 * @description Next.js API route proxy for /admin/feedback.
 *   Verifies the requester is the admin founder (ADMIN_FOUNDER_ID env var).
 *   Proxies to the Fastify backend with the X-Admin-Secret header.
 * @security ADMIN_FOUNDER_ID checked via Supabase session. Admin secret never exposed to browser.
 * @dependencies lib/supabase/server
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/feedback
 * Proxies to the Fastify backend admin feedback endpoint.
 * Only the ADMIN_FOUNDER_ID user may call this.
 * @returns JSON feedback list from the backend, or 403/502 on failure.
 * @security Requires valid Supabase session matching ADMIN_FOUNDER_ID.
 *   X-Admin-Secret injected server-side — never returned to the browser.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== process.env.ADMIN_FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/admin/feedback`, {
      headers: { 'X-Admin-Secret': process.env.ADMIN_SECRET ?? '' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'Backend error' }, { status: res.status });
  }

  const raw = await res.json();

  // Normalise snake_case DB fields → camelCase for the admin page
  const feedback = (raw.feedback ?? []).map((item: Record<string, unknown>) => ({
    id:        item.id,
    rating:    item.rating,
    body:      item.body ?? null,
    context:   item.context ?? null,
    productId: (item.products as Record<string, unknown> | null)?.name ?? null,
    createdAt: item.created_at,
  }));

  return NextResponse.json({ feedback, total: raw.total ?? feedback.length });
}
