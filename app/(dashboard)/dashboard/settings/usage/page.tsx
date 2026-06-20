/**
 * @file app/(dashboard)/dashboard/settings/usage/page.tsx
 * @description Token usage breakdown — past 30 days, grouped by action type.
 *   Shows a progress bar for balance vs. tier allocation, a per-action table,
 *   and a "Buy more tokens" CTA that links to the billing page.
 * @security Auth token from Supabase session. No secrets client-side.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { TokenUsage } from '@/lib/api';

const TIER_MAX: Record<string, number> = {
  free: 50, solo: 300, builder: 1000, studio: 3000,
};

const ACTION_LABEL: Record<string, string> = {
  strategy_generation:   'Strategy generation',
  weekly_brief:          'Weekly brief',
  content_asset_batch:   'Content asset batch',
  review_analysis:       'Review analysis',
  icp_structuring:       'ICP structuring',
  brand_voice_extract:   'Brand voice extract',
  brand_voice_apply:     'Brand voice apply',
  scoring_classify:      'Scoring / classify',
};

export default function TokenUsagePage() {
  const supabase = createClient();
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [plan, setPlan] = useState('free');
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const [usageData, subData] = await Promise.all([
        api.founders.tokenUsage(session.access_token),
        api.billing.subscription(session.access_token),
      ]);
      setUsage(usageData);
      setPlan(subData.plan ?? 'free');
      setTokenBalance(subData.tokenBalance ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const tierMax = TIER_MAX[plan] ?? 300;
  const isUnlimited = tokenBalance === null;
  const balance = tokenBalance ?? 0;
  const pct = isUnlimited ? 100 : Math.min(100, Math.round((balance / tierMax) * 100));
  const isLow = !isUnlimited && pct <= 20;

  return (
    <div style={{ padding: '0 0 48px' }}>
      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 56, padding: '0 32px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', marginBottom: 32,
      }}>
        <div>
          <Link href="/dashboard/settings" style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>
            Settings
          </Link>
          <span style={{ fontSize: 12, color: 'var(--ink3)', margin: '0 6px' }}>›</span>
          <span className="font-display font-bold" style={{ fontSize: 16, color: 'var(--ink)' }}>Token usage</span>
        </div>
        <Link
          href="/dashboard/billing"
          style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 6,
            background: 'var(--sage)', color: '#fff', textDecoration: 'none',
          }}
        >
          Buy more tokens →
        </Link>
      </div>

      <div style={{ padding: '0 clamp(16px, 4vw, 32px)' }}>
        {error && (
          <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: 'var(--red-d)', border: '1px solid var(--red-b)', color: 'var(--red)', fontSize: 13 }}>
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
            {/* Balance card */}
            <div style={{
              background: 'var(--surface)', border: `1px solid ${isLow ? 'var(--red-b)' : 'var(--border)'}`,
              borderRadius: 10, padding: '20px 24px', marginBottom: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Current balance</div>
                  <div className="font-mono" style={{ fontSize: 28, fontWeight: 500, color: isLow ? 'var(--red)' : 'var(--ink)' }}>
                    {isUnlimited ? 'Unlimited' : balance.toLocaleString()}
                    {!isUnlimited && <span style={{ fontSize: 13, color: 'var(--ink3)', marginLeft: 6 }}>/ {tierMax.toLocaleString()} tokens</span>}
                  </div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 9999,
                  background: isLow ? 'var(--red-d)' : isUnlimited ? 'var(--sage-d)' : 'var(--raised)',
                  color: isLow ? 'var(--red)' : isUnlimited ? 'var(--sage)' : 'var(--ink3)',
                  border: `1px solid ${isLow ? 'var(--red-b)' : isUnlimited ? 'var(--sage-b)' : 'var(--border2)'}`,
                  textTransform: 'capitalize' as const,
                }}>
                  {plan}
                </div>
              </div>

              {!isUnlimited && (
                <div style={{ height: 6, borderRadius: 3, background: 'var(--raised)' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', borderRadius: 3,
                    background: isLow ? 'var(--red)' : '#d97706',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              )}

              {isLow && (
                <p style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>
                  Low balance — strategy generation and brief delivery may be paused.{' '}
                  <Link href="/dashboard/billing" style={{ color: 'var(--red)', fontWeight: 600 }}>Top up now →</Link>
                </p>
              )}
            </div>

            {/* 30-day usage breakdown */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Usage breakdown</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                    Last 30 days
                    {usage?.since && ` · since ${new Date(usage.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
                {usage && (
                  <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--ink)' }}>
                    {usage.totalConsumed.toLocaleString()}
                    <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 4 }}>consumed</span>
                  </div>
                )}
              </div>

              {!usage || usage.breakdown.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
                  No token usage in the past 30 days.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Action', 'Count', 'Tokens consumed'].map((h) => (
                        <th key={h} style={{
                          textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--ink3)',
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          padding: '0 8px 10px', borderBottom: '1px solid var(--border)',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usage.breakdown.map((row, i) => (
                      <tr key={row.action} style={{ borderBottom: i < usage.breakdown.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '10px 8px', fontSize: 13, color: 'var(--ink)' }}>
                          {ACTION_LABEL[row.action] ?? row.action}
                        </td>
                        <td className="font-mono" style={{ padding: '10px 8px', fontSize: 13, color: 'var(--ink2)' }}>
                          {row.count}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="font-mono" style={{ fontSize: 13, color: 'var(--ink)', minWidth: 40 }}>
                              {row.totalTokens.toLocaleString()}
                            </span>
                            <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--raised)' }}>
                              <div style={{
                                width: `${Math.round((row.totalTokens / usage.totalConsumed) * 100)}%`,
                                height: '100%', borderRadius: 2, background: 'var(--sage)',
                              }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 8px', fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Total</td>
                      <td />
                      <td className="font-mono" style={{ padding: '10px 8px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                        {usage.totalConsumed.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
