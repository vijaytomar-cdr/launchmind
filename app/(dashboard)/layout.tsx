/**
 * @file app/(dashboard)/layout.tsx
 * @description Dashboard shell layout: sidebar navigation + main content area.
 *   Authenticated-only — middleware redirects unauthenticated users to /login.
 *   Sidebar items: Products, Campaigns, Briefs, Channels, Settings.
 *   PostHogIdentify wired here to identify the founder on every dashboard page.
 *   Fetches token balance + plan from backend to power the sidebar meter.
 * @security Server Component reads session; no secret data rendered client-side.
 *   Founder identified in PostHog by UUID only — never email.
 * @dependencies lib/supabase/server, next/navigation, PostHogIdentify
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/launchmind/Sidebar';
import { PostHogIdentify } from '@/components/launchmind/PostHogIdentify';
import { FeedbackWidget } from '@/components/launchmind/FeedbackWidget';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect('/login');

  const { data: { session } } = await supabase.auth.getSession();

  const isAdmin = user.id === process.env.ADMIN_FOUNDER_ID;

  let tokenBalance: number | null | undefined = undefined;
  let plan = 'free';

  if (session?.access_token) {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/billing/subscription`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        next: { revalidate: 60 },
      });
      if (res.ok) {
        const sub = await res.json() as { plan: string; tokenBalance: number | null };
        plan = sub.plan ?? 'free';
        tokenBalance = sub.tokenBalance;
      }
    } catch {
      // Non-fatal — sidebar renders without meter
    }
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      <PostHogIdentify founderId={user.id} />
      <Sidebar userEmail={user.email ?? ''} isAdmin={isAdmin} tokenBalance={tokenBalance} plan={plan} />
      <main className="flex-1 overflow-auto">{children}</main>
      <FeedbackWidget />
    </div>
  );
}
