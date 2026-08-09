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
import { Topbar } from '@/components/launchmind/Topbar';

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
  let activeProductName: string | undefined;
  let activeProductPlatform: string | undefined;
  let activeProductMarkets: string[] | undefined;
  let sidebarOpportunityCount = 0;
  let sidebarApprovalCount = 0;
  let totalProductCount = 1;
  let unreadNotificationCount = 0;

  if (session?.access_token) {
    // Fire session init, billing fetch, product list, and badge counts in parallel — all non-fatal
    await Promise.allSettled([
      // Idempotent session init: ensures workspace exists, sets active_workspace_id
      fetch(`${apiBase}/founders/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
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
      // Active product (cached 30s) — pick first non-archived product
      fetch(`${apiBase}/products`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        next: { revalidate: 30 },
      }).then(async res => {
        if (res.ok) {
          const body = await res.json() as { products?: Array<{ name: string; platform: string; markets: string[]; archived_at: string | null }> };
          const products = body.products ?? (Array.isArray(body) ? body : []) as Array<{ name: string; platform: string; markets: string[]; archived_at: string | null }>;
          const active = products.find((p) => !p.archived_at);
          totalProductCount = products.filter((p) => !p.archived_at).length;
          if (active) {
            activeProductName = active.name;
            activeProductPlatform = active.platform;
            activeProductMarkets = active.markets;
          }
        }
      }),
      // Sidebar badge counts (cached 30s) — lightweight, non-fatal
      fetch(`${apiBase}/owner/counts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        next: { revalidate: 30 },
      }).then(async res => {
        if (res.ok) {
          const counts = await res.json() as { opportunities: number; approvals: number; notifications: number };
          sidebarOpportunityCount  = counts.opportunities  ?? 0;
          sidebarApprovalCount     = counts.approvals      ?? 0;
          unreadNotificationCount  = counts.notifications  ?? 0;
        }
      }),
    ]);
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page)' }}>
      <PostHogIdentify founderId={user.id} />
      <Sidebar
        userEmail={user.email ?? ''}
        isAdmin={isAdmin}
        tokenBalance={tokenBalance}
        plan={plan}
        productName={activeProductName}
        productPlatform={activeProductPlatform}
        productMarkets={activeProductMarkets}
        opportunityCount={sidebarOpportunityCount}
        approvalCount={sidebarApprovalCount}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar plan={plan} productName={activeProductName} productCount={totalProductCount} unreadNotifications={unreadNotificationCount} />
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">{children}</main>
      </div>
      <FeedbackWidget />
      <MobileNav />
    </div>
  );
}
