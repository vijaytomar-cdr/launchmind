/**
 * @file app/(dashboard)/layout.tsx
 * @description Dashboard shell layout: sidebar navigation + main content area.
 *   Authenticated-only — middleware redirects unauthenticated users to /login.
 *   Sidebar items: Products, Campaigns, Briefs, Channels, Settings.
 *   PostHogIdentify wired here to identify the founder on every dashboard page.
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
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      <PostHogIdentify founderId={user.id} />
      <Sidebar userEmail={user.email ?? ''} />
      <main className="flex-1 overflow-auto">{children}</main>
      <FeedbackWidget />
    </div>
  );
}
