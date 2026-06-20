/**
 * @file page.tsx
 * @description Insights page — cross-product performance dashboard.
 *   Fetches aggregated founder insights from GET /founders/me/insights
 *   and displays top channel, avg installs/week, best product, and channel breakdown.
 * @security Requires a valid Supabase session; redirects to /login if unauthenticated.
 *   Bearer token is sent to the backend; never logged or stored beyond component state.
 * @dependencies api.founders.insights, FounderInsights type, @supabase/ssr browser client
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { FounderInsights } from '@/lib/api';

const CHANNEL_ICONS: Record<string, string> = {
  meta: '📘',
  google: '🔍',
  whatsapp: '💬',
  linkedin: '💼',
  email: '📧',
};

/**
 * Cross-product insights page.
 * @returns Insights dashboard showing top channel, avg installs, best product, and channel bar chart.
 */
export default function InsightsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [insights, setInsights] = useState<FounderInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setToken(data.session.access_token);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    api.founders
      .insights(token)
      .then(setInsights)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const card = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 20,
  };
  const metricBlock = {
    background: 'var(--raised)',
    borderRadius: 6,
    padding: '11px 13px',
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1
          className="font-display font-bold"
          style={{ fontSize: 22, color: 'var(--ink)' }}
        >
          Insights
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
          Cross-product performance across all your campaigns.
        </p>
      </div>

      {loading && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
            style={{
              borderColor: 'var(--sage)',
              borderTopColor: 'transparent',
            }}
          />
          <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
            Loading insights…
          </p>
        </div>
      )}

      {!loading && !insights?.topChannel && !insights?.bestPerformingProduct && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: 22, marginBottom: 8 }}>📊</p>
          <p
            className="font-semibold"
            style={{ fontSize: 14, color: 'var(--ink)' }}
          >
            No data yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Launch campaigns and collect metrics to see cross-product insights
            here.
          </p>
        </div>
      )}

      {!loading &&
        insights &&
        (insights.topChannel || insights.bestPerformingProduct) && (
          <div className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-4">
              <div style={metricBlock}>
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--ink3)',
                    marginBottom: 4,
                  }}
                >
                  Top channel
                </p>
                <p
                  className="font-display font-bold"
                  style={{ fontSize: 20, color: 'var(--ink)' }}
                >
                  {insights.topChannel ? (
                    <span>
                      {CHANNEL_ICONS[insights.topChannel] ?? '📣'}{' '}
                      {insights.topChannel}
                    </span>
                  ) : (
                    '—'
                  )}
                </p>
              </div>
              <div style={metricBlock}>
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--ink3)',
                    marginBottom: 4,
                  }}
                >
                  Avg installs / week
                </p>
                <p
                  className="font-mono font-bold"
                  style={{ fontSize: 20, color: 'var(--ink)' }}
                >
                  {insights.avgInstallsPerWeek.toLocaleString()}
                </p>
              </div>
              <div style={metricBlock}>
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--ink3)',
                    marginBottom: 4,
                  }}
                >
                  Best product
                </p>
                <p
                  className="font-display font-bold"
                  style={{ fontSize: 15, color: 'var(--ink)' }}
                >
                  {insights.bestPerformingProduct?.name ?? '—'}
                </p>
                {insights.bestPerformingProduct && (
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--sage)',
                      marginTop: 2,
                    }}
                  >
                    {insights.bestPerformingProduct.installs.toLocaleString()}{' '}
                    installs
                  </p>
                )}
              </div>
            </div>

            {/* Channel breakdown */}
            {insights.channelBreakdown.length > 0 && (
              <div style={card}>
                <h2
                  className="font-display font-semibold mb-4"
                  style={{ fontSize: 14, color: 'var(--ink)' }}
                >
                  Channel breakdown
                </h2>
                <div className="space-y-2">
                  {insights.channelBreakdown.map((ch) => {
                    const maxInstalls = Math.max(
                      ...insights.channelBreakdown.map((c) => c.totalInstalls),
                      1
                    );
                    const pct = Math.round(
                      (ch.totalInstalls / maxInstalls) * 100
                    );
                    return (
                      <div key={ch.channel}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: 14 }}>
                              {CHANNEL_ICONS[ch.channel] ?? '📣'}
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                color: 'var(--ink)',
                                textTransform: 'capitalize',
                              }}
                            >
                              {ch.channel}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-4"
                            style={{ fontSize: 12, color: 'var(--ink2)' }}
                          >
                            <span>
                              {ch.totalInstalls.toLocaleString()} installs
                            </span>
                            {ch.avgCPI != null && (
                              <span>${ch.avgCPI.toFixed(2)} CPI</span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            height: 4,
                            background: 'var(--raised)',
                            borderRadius: 2,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: 'var(--sage)',
                              borderRadius: 2,
                              transition: 'width 0.4s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
