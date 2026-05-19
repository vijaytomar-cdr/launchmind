/**
 * @file app/api/admin/stats/route.ts
 * @description Next.js API route proxy for /admin/stats.
 *   Verifies the requester is the admin founder (ADMIN_FOUNDER_ID env var).
 *   Proxies to the Fastify backend with the X-Admin-Secret header.
 * @security ADMIN_FOUNDER_ID checked via Supabase session. Admin secret never exposed to browser.
 * @dependencies lib/supabase/server
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/stats
 * Proxies to the Fastify backend admin stats endpoint.
 * Only the ADMIN_FOUNDER_ID user may call this.
 * @returns JSON stats from the backend, or 403/502 on failure.
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
    res = await fetch(`${apiUrl}/admin/stats`, {
      headers: { 'X-Admin-Secret': process.env.ADMIN_SECRET ?? '' },
      next: { revalidate: 60 },
    });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'Backend error' }, { status: res.status });
  }

  const raw = await res.json();

  // Transform backend's onboardingFunnel object into the funnel array the admin page expects
  const funnelMap: Record<string, string> = {
    registered:        'signup_complete',
    icpConfirmed:      'icp_confirmed',
    strategyGenerated: 'strategy_generated',
    channelConnected:  'channel_connected',
    briefReceived:     'brief_received',
    feedbackSubmitted: 'feedback_submitted',
  };
  const funnel = Object.entries(raw.onboardingFunnel ?? {}).map(([key, count]) => ({
    step:  funnelMap[key] ?? key,
    label: key,
    count: count as number,
  }));

  return NextResponse.json({ ...raw, funnel });
}
