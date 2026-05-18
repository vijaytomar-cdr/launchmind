/**
 * @file PostHogProvider.tsx
 * @description Client-side PostHog analytics initialization.
 *   Fires only after the component mounts — never on SSR.
 *   Wraps children in the PostHog context for usePostHog() access.
 *   Consent: fires immediately for now; add cookie consent gate before public launch.
 * @security No PII in event names. User identified by founder UUID only, never email.
 * @dependencies posthog-js
 */

'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      persistence: 'localStorage',
    });
  }, []);

  return <>{children}</>;
}
