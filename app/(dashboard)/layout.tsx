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
import { BusinessScopeProvider } from '@/lib/business/scope';

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
  let activeBusinessId: string | undefined;
  let activeBusinessName: string | undefined;
  let activeMaturity: string | undefined;
  let businesses: Array<{
    workspaceId: string; name: string; productName: string | null;
    platform: string | null; markets: string[]; maturity: string | null; isActive: boolean;
  }> = [];
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
      // THE ACTIVE BUSINESS — explicit, server-resolved, never guessed.
      //
      // This previously read a founder-wide /products list and took
      // `products.find(p => !p.archived_at)` — the first non-archived product
      // the founder owned, regardless of which business it belonged to. With one
      // business that looked like a sensible default. With two it silently
      // decides which company the owner is looking at, and the chrome could name
      // one business while the content described another.
      //
      // /businesses resolves it from founders.active_workspace_id with
      // membership re-verified server-side, and returns `active: null` rather
      // than substituting a default when nothing is selected.
      fetch(`${apiBase}/businesses`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',   // switching must take effect on the very next render
      }).then(async res => {
        if (res.ok) {
          const body = await res.json() as {
            businesses?: Array<{ workspaceId: string; name: string; productName: string | null;
                                 platform: string | null; markets: string[]; maturity: string | null;
                                 isActive: boolean }>;
            active?: { workspaceId: string; name: string; productName: string | null;
                       platform: string | null; markets: string[]; maturity: string | null } | null;
          };
          businesses = body.businesses ?? [];
          totalProductCount = businesses.length;
          if (body.active) {
            activeBusinessId    = body.active.workspaceId;
            activeBusinessName  = body.active.name;
            activeProductName   = body.active.productName ?? undefined;
            activeProductPlatform = body.active.platform ?? undefined;
            activeProductMarkets  = body.active.markets;
            activeMaturity      = body.active.maturity ?? undefined;
          }
          // No active business leaves everything undefined on purpose. The
          // chrome then shows "Select a business" rather than inventing one.
        }
      }),
      // Sidebar badge counts (cached 30s) — lightweight, non-fatal
      // NO-STORE. These badge counts are business-dependent, and a 30s revalidate
      // window meant that for half a minute after switching, the sidebar showed
      // the PREVIOUS company's opportunity and approval counts — the same
      // contamination as the pages, just smaller and on every screen.
      fetch(`${apiBase}/owner/counts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
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
        businessName={activeBusinessName}
        maturity={activeMaturity}
        opportunityCount={sidebarOpportunityCount}
        approvalCount={sidebarApprovalCount}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          plan={plan}
          productName={activeProductName}
          productCount={totalProductCount}
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          activeBusinessName={activeBusinessName}
          activeMaturity={activeMaturity}
        />
        {/* REMOUNT ON BUSINESS SWITCH.
            `router.refresh()` re-runs server components but does NOT remount
            client ones, so a page that fetches in useEffect kept the previous
            company's state — and an AllignX request still in flight could
            resolve after the switch and setState into LaunchMind's view. No
            dashboard fetch uses AbortController, so nothing else prevents that.

            Keying the subtree on the active business discards that state and
            re-runs every effect: a late response lands on an unmounted tree and
            is thrown away instead of painted. One key, whole class of race. */}
        {/* The key discards React state; the provider lets client components
            partition anything they persist OUTSIDE React (sessionStorage), which
            the key cannot reach. Both are needed — Morning Brief remounted
            correctly and then re-read the previous company's cached brief. */}
        <main key={activeBusinessId ?? 'no-business'} className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <BusinessScopeProvider businessId={activeBusinessId ?? null}>{children}</BusinessScopeProvider>
        </main>
      </div>
      <FeedbackWidget />
      <MobileNav />
    </div>
  );
}
