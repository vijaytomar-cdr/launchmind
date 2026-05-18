/**
 * @file PostHogIdentify.tsx
 * @description Identifies the current founder with PostHog on dashboard load.
 *   Called from the dashboard layout. Uses the founder UUID — never email.
 * @security No PII passed to PostHog. Founder identified by UUID only.
 * @dependencies lib/analytics, next/navigation
 */

'use client';

import { useEffect } from 'react';
import { identifyFounder, trackPageView } from '@/lib/analytics';
import { usePathname } from 'next/navigation';

/**
 * Client component that identifies the founder in PostHog and tracks pageviews.
 * Renders nothing to the DOM.
 * @param founderId - Supabase auth UUID for the current user. Never email.
 */
export function PostHogIdentify({ founderId }: { founderId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    identifyFounder(founderId);
  }, [founderId]);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
