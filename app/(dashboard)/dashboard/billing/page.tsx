/**
 * @file app/(dashboard)/dashboard/billing/page.tsx
 * @description Billing & plan page — current plan summary, plan comparison grid, token top-ups.
 *   Initiates Stripe (USD) or Razorpay (INR) checkout via Fastify backend.
 *   Shows both USD and INR prices side-by-side on each plan and top-up card.
 * @security Auth token from Supabase session. Payment handled server-side; no keys in frontend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { SubscriptionStatus, TokenTopupBody } from '@/lib/api';

type Plan = 'free' | 'solo' | 'builder' | 'studio';

const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free', solo: 'Solo', builder: 'Builder', studio: 'Studio',
};
const PLAN_PRICE_USD: Record<Plan, string> = {
  free: '$0', solo: '$19', builder: '$49', studio: '$99',
};
const PLAN_PRICE_INR: Record<Plan, string> = {
  free: '₹0', solo: '₹999', builder: '₹2,499', studio: '₹4,999',
};
const PLAN_FEATURES: Record<Plan, { text: string; yes: boolean }[]> = {
  free: [
    { text: '1 product', yes: true },
    { text: 'Strategy preview', yes: true },
    { text: 'No posting', yes: false },
    { text: 'No weekly brief', yes: false },
  ],
  solo: [
    { text: '1 product', yes: true },
    { text: 'Full strategy', yes: true },
    { text: '1 channel', yes: true },
    { text: 'Weekly brief', yes: true },
  ],
  builder: [
    { text: '3 products', yes: true },
    { text: 'All channels', yes: true },
    { text: 'Meta + Google', yes: true },
    { text: 'USA + India', yes: true },
  ],
  studio: [
    { text: '10 products', yes: true },
    { text: 'Workspaces', yes: true },
    { text: 'White-label', yes: true },
    { text: 'API access', yes: true },
  ],
};

const TOP_UPS: { tokens: string; usd: string; inr: string; featured: boolean; packSize: number }[] = [
  { tokens: '500',   usd: '$9',  inr: '₹749',   featured: false, packSize: 500 },
  { tokens: '1,500', usd: '$19', inr: '₹1,499', featured: true,  packSize: 1500 },
  { tokens: '5,000', usd: '$49', inr: '₹3,999', featured: false, packSize: 5000 },
];

export default function BillingPage() {
  const supabase = createClient();
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<Plan | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const data = await api.billing.subscription(session.access_token);
      setSub(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load billing info');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleUpgrade(plan: Plan) {
    if (plan === 'free' || plan === currentPlan) return;
    setCheckoutBusy(plan);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Default to USD for Stripe; user can switch via Razorpay on the checkout page
      const result = await api.billing.checkout({ plan: plan as 'solo' | 'builder' | 'studio', currency: 'usd' }, session.access_token);
      if ('url' in result) {
        window.location.href = result.url;
      } else {
        window.open(`https://checkout.razorpay.com/v1/checkout.js?order_id=${result.orderId}`, '_blank');
      }
    } catch {
      setError('Could not start checkout. Please try again.');
    } finally {
      setCheckoutBusy(null);
    }
  }

  async function handleCancel() {
    if (!cancelConfirm) { setCancelConfirm(true); return; }
    setCancelBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await api.billing.cancel(session.access_token);
      setCancelConfirm(false);
      await load();
    } catch {
      setError('Could not cancel plan. Contact support@launchmind.com.');
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleTopUp(packSize: number) {
    setTopUpBusy(packSize);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const result = await api.billing.topup({ packSize: packSize as TokenTopupBody['packSize'], currency: 'usd' }, session.access_token);
      if ('url' in result) {
        window.location.href = result.url;
      } else {
        window.open(`https://checkout.razorpay.com/v1/checkout.js?order_id=${result.orderId}`, '_blank');
      }
    } catch {
      setError('Could not start top-up. Please try again.');
    } finally {
      setTopUpBusy(null);
    }
  }

  const currentPlan: Plan = (sub?.plan as Plan) ?? 'free';
  const upgradePlan: Plan | null =
    currentPlan === 'free' ? 'solo'
    : currentPlan === 'solo' ? 'builder'
    : currentPlan === 'builder' ? 'studio'
    : null;

  return (
    <div style={{ padding: '0 0 48px' }}>
      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 56, padding: '0 clamp(16px, 4vw, 32px)',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', marginBottom: 32,
      }}>
        <span className="font-display font-bold" style={{ fontSize: 18, color: 'var(--ink)' }}>
          Billing &amp; plan
        </span>
      </div>

      <div style={{ padding: '0 clamp(16px, 4vw, 32px)' }}>
        {error && (
          <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', color: 'var(--ink3)', fontSize: 13 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border2)', borderTopColor: 'var(--sage)', animation: 'spin 0.7s linear infinite' }} />
            Loading…
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (
          <>
            {/* Current plan card */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '20px 24px', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24,
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Current plan</div>
                <div className="font-display font-semibold" style={{ fontSize: 20, color: 'var(--ink)' }}>
                  {PLAN_LABEL[currentPlan]}{' '}
                  <span style={{ color: 'var(--indigo)' }}>
                    {PLAN_PRICE_USD[currentPlan]}{currentPlan !== 'free' ? '/mo' : ''}
                  </span>
                  {currentPlan !== 'free' && (
                    <span style={{ fontSize: 13, color: 'var(--ink3)', fontWeight: 400 }}>
                      {' '}· {PLAN_PRICE_INR[currentPlan]}/mo
                    </span>
                  )}
                </div>
                {sub?.renewalNote && (
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>{sub.renewalNote}</div>
                )}
                {sub?.tokenBalance != null && (
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                    {sub.tokenBalance} tokens remaining
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {upgradePlan && (
                  <button
                    onClick={() => handleUpgrade(upgradePlan)}
                    disabled={checkoutBusy !== null}
                    style={{
                      fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', border: 'none',
                      background: 'var(--sage)', color: '#fff', opacity: checkoutBusy ? 0.7 : 1,
                    }}>
                    {checkoutBusy === upgradePlan ? 'Redirecting…' : `Upgrade to ${PLAN_LABEL[upgradePlan]}`}
                  </button>
                )}
                {currentPlan !== 'free' && (
                  <div>
                    {cancelConfirm ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--danger)' }}>Confirm cancel?</span>
                        <button onClick={() => setCancelConfirm(false)}
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink2)' }}>
                          No
                        </button>
                        <button onClick={handleCancel} disabled={cancelBusy}
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--danger)', color: '#fff', cursor: cancelBusy ? 'not-allowed' : 'pointer', opacity: cancelBusy ? 0.7 : 1 }}>
                          {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
                        </button>
                      </div>
                    ) : (
                      <button onClick={handleCancel}
                        style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink2)' }}>
                        Cancel plan
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Plan comparison grid */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" style={{ marginBottom: 24 }}>
              {(['free', 'solo', 'builder', 'studio'] as Plan[]).map((plan) => {
                const isCurrent = plan === currentPlan;
                return (
                  <div key={plan} style={{
                    position: 'relative',
                    background: 'var(--surface)',
                    border: isCurrent ? '1.5px solid var(--indigo-b)' : '1px solid var(--border)',
                    borderRadius: 10, padding: '24px 16px 16px',
                  }}>
                    {isCurrent && (
                      <div style={{
                        position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                        fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 9999,
                        background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)',
                        whiteSpace: 'nowrap',
                      }}>
                        Current plan
                      </div>
                    )}
                    <div className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>
                      {PLAN_LABEL[plan]}
                    </div>
                    <div className="font-mono" style={{ fontSize: 22, fontWeight: 500, color: isCurrent ? 'var(--indigo)' : 'var(--ink)', marginBottom: 0 }}>
                      {PLAN_PRICE_USD[plan]}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>
                      {PLAN_PRICE_INR[plan]} / month
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, marginTop: 10 }}>
                      {PLAN_FEATURES[plan].map(({ text, yes }) => (
                        <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span style={{ color: yes ? 'var(--sage)' : 'var(--ink3)', fontWeight: 700, flexShrink: 0 }}>{yes ? '✓' : '✗'}</span>
                          <span style={{ color: yes ? 'var(--ink2)' : 'var(--ink3)' }}>{text}</span>
                        </div>
                      ))}
                    </div>
                    {plan !== 'free' && !isCurrent && (
                      <button
                        onClick={() => handleUpgrade(plan)}
                        disabled={checkoutBusy !== null}
                        style={{
                          width: '100%', fontSize: 12, fontWeight: 500, padding: '7px 0', borderRadius: 6,
                          cursor: checkoutBusy ? 'not-allowed' : 'pointer', border: 'none',
                          background: 'var(--sage-d)', color: 'var(--sage)',
                          opacity: checkoutBusy ? 0.6 : 1,
                        }}>
                        {checkoutBusy === plan ? 'Redirecting…' : 'Select plan'}
                      </button>
                    )}
                    {isCurrent && (
                      <div style={{ width: '100%', fontSize: 12, textAlign: 'center', color: 'var(--ink3)', padding: '7px 0' }}>
                        Current plan
                      </div>
                    )}
                    {plan === 'free' && !isCurrent && (
                      <div style={{ width: '100%', fontSize: 12, textAlign: 'center', color: 'var(--ink3)', padding: '7px 0' }}>
                        Downgrade via support
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Token top-ups */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
              <div className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>
                Token top-ups{' '}
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)' }}>· one-time, no subscription</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
                Use tokens for AI strategy generation, weekly briefs, and content assets.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TOP_UPS.map(({ tokens, usd, inr, featured, packSize }) => (
                  <div key={tokens} style={{
                    background: 'var(--raised)', borderRadius: 6, padding: 16, textAlign: 'center',
                    border: featured ? '1px solid var(--sage-b)' : '1px solid transparent',
                  }}>
                    <div className="font-mono" style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{tokens}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 8 }}>tokens</div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--sage)', marginBottom: 1 }}>{usd}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>{inr} · one-time</div>
                    <button
                      onClick={() => handleTopUp(packSize)}
                      disabled={topUpBusy !== null}
                      style={{
                        width: '100%', fontSize: 12, fontWeight: 500, padding: '7px 0', borderRadius: 6,
                        cursor: topUpBusy ? 'not-allowed' : 'pointer',
                        border: featured ? 'none' : '1px solid var(--border2)',
                        background: featured ? 'var(--sage)' : 'var(--surface)',
                        color: featured ? '#fff' : 'var(--ink2)',
                        opacity: topUpBusy ? 0.6 : 1,
                      }}>
                      {topUpBusy === packSize ? 'Redirecting…' : 'Buy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
