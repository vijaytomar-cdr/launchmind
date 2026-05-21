/**
 * @file app/api/admin/mrr/route.ts
 * @description Next.js API route proxy for /admin/mrr.
 *   Verifies the requester is the admin founder (ADMIN_FOUNDER_ID env var).
 *   Proxies to the Fastify backend with the X-Admin-Secret header.
 * @security ADMIN_FOUNDER_ID checked via Supabase session. Admin secret never exposed to browser.
 * @dependencies lib/supabase/server
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/mrr
 * Returns MRR aggregation: totalMrrUSD, mrrByTier, mrrByMarket, totalPayingFounders.
 * Only the ADMIN_FOUNDER_ID user may call this.
 * @security Requires valid Supabase session matching ADMIN_FOUNDER_ID.
 */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.id !== process.env.ADMIN_FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/admin/mrr`, {
      headers: { 'X-Admin-Secret': process.env.ADMIN_SECRET ?? '' },
      next: { revalidate: 300 },
    });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'Backend error' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
