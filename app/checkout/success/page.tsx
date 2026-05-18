/**
 * @file app/checkout/success/page.tsx
 * @description Stripe checkout success landing page.
 *   Shown after successful Stripe payment redirect (?session_id=...).
 *   Polls subscription status until plan is upgraded (webhook may arrive slightly after redirect).
 * @security No payment data displayed. session_id not forwarded to backend — Stripe webhook handles activation.
 * @dependencies lib/supabase/client, lib/api
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { SubscriptionStatus } from '@/lib/api';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;

export default function CheckoutSuccessPage() {
  const supabase = createClient();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll(attempt: number) {
      if (cancelled || attempt > MAX_POLLS) {
        setReady(true);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? '';
        if (!token) {
          setReady(true);
          return;
        }

        const s = await api.billing.subscription(token);
        setStatus(s);
        setPollCount(attempt);

        if (s.plan !== 'free') {
          setReady(true);
          return;
        }
      } catch {
        // keep polling silently
      }

      setTimeout(() => poll(attempt + 1), POLL_INTERVAL_MS);
    }

    poll(0);
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const planActivated = status && status.plan !== 'free';

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {!ready ? (
          <>
            <div className="w-12 h-12 border-4 border-brand-teal border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <h1 className="text-2xl font-display font-bold text-white mb-2">
              Confirming your plan…
            </h1>
            <p className="text-neutral-400 text-sm">
              Hang tight — we&apos;re activating your subscription.
            </p>
          </>
        ) : planActivated ? (
          <>
            <div className="w-16 h-16 rounded-full bg-brand-teal/20 flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-brand-teal"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-display font-bold text-white mb-2">
              Welcome to {capitalize(status.plan)}!
            </h1>
            <p className="text-neutral-300 text-sm mb-2">
              Your plan is now active.
            </p>
            {status.tokenBalance !== null && (
              <p className="text-neutral-400 text-sm mb-8">
                {status.tokenBalance.toLocaleString()} AI tokens ready to use.
              </p>
            )}
            <Link
              href="/dashboard/products"
              className="inline-block bg-brand-teal text-neutral-900 font-semibold text-sm px-6 py-3 rounded-lg hover:bg-brand-teal/90 transition-colors"
            >
              Go to dashboard →
            </Link>
          </>
        ) : (
          <>
            {/* Webhook hasn't fired yet after MAX_POLLS — reassure user */}
            <div className="w-16 h-16 rounded-full bg-brand-amber/20 flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-brand-amber"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-display font-bold text-white mb-2">
              Payment received!
            </h1>
            <p className="text-neutral-300 text-sm mb-2">
              Your plan will activate within a minute.
            </p>
            <p className="text-neutral-400 text-xs mb-8">
              If it takes longer, check your email or contact support.
            </p>
            <Link
              href="/dashboard/products"
              className="inline-block bg-brand-purple text-white font-semibold text-sm px-6 py-3 rounded-lg hover:bg-brand-purple/90 transition-colors"
            >
              Go to dashboard
            </Link>
          </>
        )}

        {/* Subtle poll indicator */}
        {!ready && pollCount > 0 && (
          <p className="text-neutral-600 text-xs mt-8">
            Checking… ({pollCount}/{MAX_POLLS})
          </p>
        )}
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
