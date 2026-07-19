/**
 * @file app/(dashboard)/dashboard/settings/billing/page.tsx
 * @description Billing settings — current plan badge, token balance, renewal note,
 *   plan upgrade/downgrade CTAs, and cancel subscription button.
 * @security All billing mutations proxy through the Fastify backend (/billing/*).
 *   Frontend never calls Stripe or Razorpay directly.
 * @dependencies lib/supabase/client, lib/api
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { SubscriptionStatus } from '@/lib/api';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  solo: 'Solo',
  builder: 'Builder',
  studio: 'Studio',
};

const PLAN_BADGE_STYLE: Record<string, React.CSSProperties> = {
  free:    { background: 'var(--raised)', color: 'var(--ink2)' },
  solo:    { background: 'var(--sage-d)', color: 'var(--sage)' },
  builder: { background: 'var(--indigo-d)', color: 'var(--indigo)' },
  studio:  { background: 'var(--amber-d)', color: 'var(--amber)' },
};

const UPGRADES = [
  { id: 'solo',    label: 'Solo',    usd: 19,  inr: 999  },
  { id: 'builder', label: 'Builder', usd: 49,  inr: 2499 },
  { id: 'studio',  label: 'Studio',  usd: 99,  inr: 4999 },
] as const;

type PlanId = 'solo' | 'builder' | 'studio';

export default function BillingSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [currency, setCurrency] = useState<'usd' | 'inr'>('usd');

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, [supabase]);

  useEffect(() => {
    const locale = navigator.language ?? '';
    if (
      locale.includes('IN') ||
      Intl.DateTimeFormat().resolvedOptions().timeZone?.includes('Asia/Kolkata')
    ) {
      setCurrency('inr');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const data = await api.billing.subscription(token);
        setStatus(data);
      } catch {
        setError('Failed to load subscription status.');
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  useEffect(() => {
    const plan = searchParams.get('plan') as PlanId | null;
    const cur = searchParams.get('currency') as 'usd' | 'inr' | null;
    if (plan && cur) {
      setCurrency(cur);
      handleCheckout(plan, cur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheckout(plan: PlanId, cur: 'usd' | 'inr') {
    setCheckoutLoading(plan);
    setError(null);
    try {
      const token = await getToken();
      const result = await api.billing.checkout({ plan, currency: cur }, token);
      if ('url' in result) {
        window.location.href = result.url;
      } else {
        router.push(
          `/checkout/razorpay?orderId=${result.orderId}&amount=${result.amount}&currency=${result.currency}&keyId=${result.keyId}&plan=${plan}`
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checkout failed. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await api.billing.cancel(token);
      setSuccessMsg(res.message);
      setCancelConfirm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancellation failed. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-5 w-48 rounded animate-pulse mb-4" style={{ background: 'var(--raised)' }} />
        <div className="h-32 rounded-[10px] animate-pulse" style={{ background: 'var(--surface)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
        Billing
      </h1>
      <p className="mb-8" style={{ fontSize: 13, color: 'var(--ink2)' }}>
        Manage your plan and subscription.
      </p>

      {error && (
        <div
          className="mb-5 px-4 py-3 rounded-[8px]"
          style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="mb-5 px-4 py-3 rounded-[8px]"
          style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 13 }}
        >
          {successMsg}
        </div>
      )}

      {status && (
        <div
          className="rounded-[10px] p-6 mb-8"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>Current plan</h2>
            <span
              className="rounded-full px-3 py-1 font-semibold"
              style={{ fontSize: 11, ...(PLAN_BADGE_STYLE[status.plan] ?? PLAN_BADGE_STYLE.free) }}
            >
              {PLAN_LABELS[status.plan] ?? status.plan}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Token balance</p>
              <p className="font-medium" style={{ fontSize: 13, color: 'var(--ink)' }}>
                {status.tokenBalance !== null ? status.tokenBalance.toLocaleString() : '—'}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Renewal</p>
              <p className="font-medium" style={{ fontSize: 13, color: 'var(--ink)' }}>
                {status.renewalNote}
              </p>
            </div>
          </div>

          {status.plan !== 'free' && !successMsg && (
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
              {cancelConfirm ? (
                <div className="flex items-center gap-3">
                  <p className="flex-1" style={{ fontSize: 13, color: 'var(--ink2)' }}>
                    Access continues until end of billing period.
                  </p>
                  <button
                    onClick={handleCancel}
                    disabled={cancelLoading}
                    className="font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
                    style={{ fontSize: 13, color: 'var(--danger)' }}
                  >
                    {cancelLoading ? 'Cancelling…' : 'Confirm cancel'}
                  </button>
                  <button
                    onClick={() => setCancelConfirm(false)}
                    className="transition-opacity hover:opacity-80"
                    style={{ fontSize: 13, color: 'var(--ink2)' }}
                  >
                    Keep plan
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCancelConfirm(true)}
                  className="transition-colors hover:opacity-80"
                  style={{ fontSize: 13, color: 'var(--ink3)' }}
                >
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>
            {status?.plan === 'free' ? 'Choose a plan' : 'Change plan'}
          </h2>
          <div
            className="flex items-center gap-1 rounded-[8px] p-1"
            style={{ background: 'var(--raised)', border: '1px solid var(--border)' }}
          >
            {(['usd', 'inr'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className="rounded-[6px] px-3 py-1 font-medium transition-colors"
                style={{
                  fontSize: 11,
                  background: currency === c ? 'var(--sage)' : 'transparent',
                  color: currency === c ? '#fff' : 'var(--ink2)',
                }}
              >
                {c === 'usd' ? '🇺🇸 USD' : '🇮🇳 INR'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {UPGRADES.filter((p) => p.id !== status?.plan).map((plan) => (
            <div
              key={plan.id}
              className="flex items-center justify-between rounded-[10px] px-5 py-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div>
                <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  {plan.label}
                </p>
                <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
                  {currency === 'inr'
                    ? `₹${plan.inr.toLocaleString('en-IN')}/month`
                    : `$${plan.usd}/month`}
                </p>
              </div>
              <button
                onClick={() => handleCheckout(plan.id, currency)}
                disabled={checkoutLoading !== null}
                className="rounded-[6px] px-4 py-2 font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ background: 'var(--indigo)', color: '#fff', fontSize: 13 }}
              >
                {checkoutLoading === plan.id ? 'Loading…' : `Switch to ${plan.label}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
