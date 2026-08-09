/**
 * @file app/(onboarding)/page.tsx
 * @description Phase 1 onboarding entry — checks session state and redirects to
 *   the correct step page. Creates a session if none exists.
 * @security Requires auth (middleware). Session is founder-scoped.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default async function OnboardingEntryPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login?next=/onboarding');
  }

  // Ask the backend for the current session state
  try {
    const res = await fetch(`${API_URL}/onboarding/session`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });

    if (res.ok) {
      const json = await res.json();
      const nextRoute = json.data?.nextRoute as string | undefined;
      if (nextRoute) {
        redirect(nextRoute);
      }
    }
  } catch { /* fall through to default */ }

  // Default: start from workspace step
  redirect('/onboarding/workspace');
}
