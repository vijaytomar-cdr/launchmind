/**
 * @file app/(dashboard)/layout.tsx
 * @description Dashboard shell layout: sidebar navigation + main content area.
 *   Authenticated-only — middleware redirects unauthenticated users to /login.
 *   Calls POST /founders/session on every load to guarantee:
 *     - Founder row exists in DB
 *     - Personal workspace exists and active_workspace_id is set
 *   This is idempotent — no duplicate workspaces created on repeat logins.
 * @security Server Component reads session; no secret data rendered client-side.
 *   Founder identified in PostHog by UUID only — never email.
 * @dependencies lib/supabase/server, next/navigation, PostHogIdentify
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/launchmind/Sidebar';
import { PostHogIdentify } from '@/components/launchmind/PostHogIdentify';
import { FeedbackWidget } from '@/components/launchmind/FeedbackWidget';
import { MobileNav } from '@/components/launchmind/MobileNav';

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
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  let tokenBalance: number | null | undefined = undefined;
  let plan = 'free';

  if (session?.access_token) {
    // Fire session init and billing fetch in parallel — both non-fatal if they fail
    await Promise.allSettled([
      // Idempotent session init: ensures workspace exists, sets active_workspace_id
      fetch(`${apiBase}/founders/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        // No cache — must run on every dashboard load to handle new signups
        cache: 'no-store',
      }),
      // Billing subscription (cached 60s)
      fetch(`${apiBase}/billing/subscription`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        next: { revalidate: 60 },
      }).then(async res => {
        if (res.ok) {
          const sub = await res.json() as { plan: string; tokenBalance: number | null };
          plan = sub.plan ?? 'free';
          tokenBalance = sub.tokenBalance;
        }
      }),
    ]);
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      <PostHogIdentify founderId={user.id} />
      <Sidebar userEmail={user.email ?? ''} isAdmin={isAdmin} tokenBalance={tokenBalance} plan={plan} />
      <main className="flex-1 overflow-auto pb-16 lg:pb-0">{children}</main>
      <FeedbackWidget />
      <MobileNav />
    </div>
  );
}
