/**
 * @file app/(dashboard)/dashboard/metrics/page.tsx
 * @description Campaign performance metrics dashboard.
 *   Displays weekly summaries, channel/market breakdown, and top performers
 *   for a selected product. Requires solo plan or higher.
 * @security All data fetched via backend API with founder JWT — no direct Supabase calls.
 * @dependencies lib/supabase/client, lib/api
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product, ProductMetrics, WeeklySummary, ChannelBreakdown, TopPerformer } from '@/lib/api';

const CHANNEL_ICON: Record<string, string> = {
  whatsapp: '💬', meta: '📘', google: '🔍', linkedin: '💼', email: '✉️',
};

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(decimals);
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

const TH_STYLE: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--ink3)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid var(--border)',
};

const TD_STYLE: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 13,
  color: 'var(--ink)',
  borderBottom: '1px solid var(--border)',
};

function MarketBadge({ market }: { market: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 font-medium"
      style={{
        fontSize: 11,
        background: market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
        color: market === 'india' ? 'var(--amber)' : 'var(--sage)',
      }}
    >
      {market.toUpperCase()}
    </span>
  );
}

function WeeklySummaryRow({ s }: { s: WeeklySummary }) {
  return (
    <tr>
      <td style={TD_STYLE} className="font-mono">{s.weekOf}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>{s.totalImpressions.toLocaleString()}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>{s.totalClicks.toLocaleString()}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right', fontWeight: 600 }}>{s.totalInstalls.toLocaleString()}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>{fmtPct(s.avgCtr)}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>${fmt(s.avgCpi, 2)}</td>
      <td
        style={{
          ...TD_STYLE,
          textAlign: 'right',
          fontWeight: 600,
          color: (s.avgRoas ?? 0) >= 1 ? 'var(--sage)' : 'var(--danger)',
        }}
      >
        {fmt(s.avgRoas)}x
      </td>
    </tr>
  );
}

function ChannelRow({ c }: { c: ChannelBreakdown }) {
  return (
    <tr>
      <td style={TD_STYLE}>
        <span className="flex items-center gap-2">
          {CHANNEL_ICON[c.channel] ?? '📡'} {c.channel}
        </span>
      </td>
      <td style={TD_STYLE}><MarketBadge market={c.market} /></td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>{c.impressions.toLocaleString()}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right', fontWeight: 600 }}>{c.installs.toLocaleString()}</td>
      <td
        style={{
          ...TD_STYLE,
          textAlign: 'right',
          fontWeight: 600,
          color: (c.avgRoas ?? 0) >= 1 ? 'var(--sage)' : 'var(--danger)',
        }}
      >
        {fmt(c.avgRoas)}x
      </td>
      <td style={{ ...TD_STYLE, textAlign: 'right', color: 'var(--ink3)' }}>{c.campaignCount}</td>
    </tr>
  );
}

function TopPerformerRow({ t }: { t: TopPerformer }) {
  return (
    <tr>
      <td style={TD_STYLE}>
        <span className="flex items-center gap-2">
          {CHANNEL_ICON[t.channel] ?? '📡'} {t.channel}
        </span>
      </td>
      <td style={TD_STYLE}><MarketBadge market={t.market} /></td>
      <td style={{ ...TD_STYLE, color: 'var(--ink3)', fontFamily: 'monospace', fontSize: 12 }}>{t.hookType ?? '—'}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right', fontWeight: 600 }}>{t.installs.toLocaleString()}</td>
      <td style={{ ...TD_STYLE, textAlign: 'right' }}>{fmtPct(t.ctr)}</td>
      <td
        style={{
          ...TD_STYLE,
          textAlign: 'right',
          fontWeight: 600,
          color: (t.roas ?? 0) >= 1 ? 'var(--sage)' : 'var(--danger)',
        }}
      >
        {fmt(t.roas)}x
      </td>
    </tr>
  );
}

export default function MetricsPage() {
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [metrics, setMetrics] = useState<ProductMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekCount, setWeekCount] = useState(8);

  const loadProducts = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const list = await api.products.list(session.access_token);
      setProducts(list);
      if (list.length > 0 && !selectedProductId) setSelectedProductId(list[0].id);
    } catch {
      setError('Failed to load products');
    }
  }, [supabase, selectedProductId]);

  const loadMetrics = useCallback(async (productId: string) => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const data = await api.products.metrics(productId, session.access_token, weekCount);
      setMetrics(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Metrics require a Solo plan or higher. Upgrade to access.');
      } else {
        setError('Failed to load metrics. Ensure you have campaign data for this product.');
      }
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [supabase, weekCount]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => {
    if (selectedProductId) loadMetrics(selectedProductId);
  }, [selectedProductId, loadMetrics]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const selectStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    color: 'var(--ink)',
    fontSize: 13,
    borderRadius: 6,
    padding: '6px 12px',
    outline: 'none',
  };

  const tableCard: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  };

  return (
    <div className="py-4 sm:py-6 lg:py-8 px-4 sm:px-6 lg:px-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Campaign Metrics
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Weekly performance across all channels and markets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            style={selectStyle}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {products.length === 0 && <option value="">No products</option>}
          </select>
          <select
            value={weekCount}
            onChange={(e) => setWeekCount(Number(e.target.value))}
            style={selectStyle}
          >
            {[4, 8, 12, 26, 52].map((n) => (
              <option key={n} value={n}>{n} weeks</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div
          className="rounded-[8px] px-4 py-3"
          style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-16" style={{ fontSize: 13, color: 'var(--ink3)' }}>
          Loading metrics…
        </div>
      )}

      {!loading && metrics && (
        <>
          {/* Summary cards */}
          {metrics.weeklySummaries.length > 0 && (() => {
            const latest = metrics.weeklySummaries[0];
            const prev = metrics.weeklySummaries[1];
            const installDelta = prev && prev.totalInstalls > 0
              ? ((latest.totalInstalls - prev.totalInstalls) / prev.totalInstalls * 100).toFixed(0)
              : null;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Installs (latest week)', value: latest.totalInstalls.toLocaleString(), delta: installDelta ? `${Number(installDelta) >= 0 ? '+' : ''}${installDelta}% WoW` : null, positive: Number(installDelta ?? 0) >= 0 },
                  { label: 'Impressions', value: latest.totalImpressions.toLocaleString(), delta: null, positive: true },
                  { label: 'Avg ROAS', value: `${fmt(latest.avgRoas)}x`, delta: null, positive: (latest.avgRoas ?? 0) >= 1 },
                  { label: 'Avg CTR', value: fmtPct(latest.avgCtr), delta: null, positive: true },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="rounded-[10px] p-5"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>{card.label}</p>
                    <p className="font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>{card.value}</p>
                    {card.delta && (
                      <p className="font-medium mt-1" style={{ fontSize: 12, color: card.positive ? 'var(--sage)' : 'var(--danger)' }}>
                        {card.delta}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Weekly breakdown */}
          <div style={tableCard}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>Weekly Summary</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    {['Week', 'Impressions', 'Clicks', 'Installs', 'CTR', 'CPI', 'ROAS'].map((h) => (
                      <th key={h} style={{ ...TH_STYLE, textAlign: h !== 'Week' ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.weeklySummaries.map((s) => (
                    <WeeklySummaryRow key={s.weekOf} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Channel breakdown */}
          <div style={tableCard}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
                Channel × Market Breakdown
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    {['Channel', 'Market', 'Impressions', 'Installs', 'ROAS', 'Campaigns'].map((h) => (
                      <th key={h} style={{ ...TH_STYLE, textAlign: ['Impressions', 'Installs', 'ROAS', 'Campaigns'].includes(h) ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.channelBreakdown.map((c, i) => (
                    <ChannelRow key={`${c.channel}-${c.market}-${i}`} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top performers */}
          {metrics.topPerformers.length > 0 && (
            <div style={tableCard}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <h2 className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>Top Performers</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      {['Channel', 'Market', 'Hook Type', 'Installs', 'CTR', 'ROAS'].map((h) => (
                        <th key={h} style={{ ...TH_STYLE, textAlign: ['Installs', 'CTR', 'ROAS'].includes(h) ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.topPerformers.map((t, i) => (
                      <TopPerformerRow key={`${t.campaignId}-${i}`} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {metrics.weeklySummaries.length === 0 && metrics.channelBreakdown.length === 0 && (
            <div className="text-center py-12" style={{ fontSize: 13, color: 'var(--ink3)' }}>
              No campaign metrics yet for {selectedProduct?.name ?? 'this product'}.
              <br />
              Launch campaigns and come back after the first week.
            </div>
          )}
        </>
      )}

      {!loading && !metrics && !error && (
        <div className="text-center py-16" style={{ fontSize: 13, color: 'var(--ink3)' }}>
          Select a product to view metrics.
        </div>
      )}
    </div>
  );
}
