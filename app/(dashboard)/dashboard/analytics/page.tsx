'use client';

import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/launchmind/ErrorState';
import { createClient }        from '@/lib/supabase/client';
import { api, AnalyticsSummary, KPIPoint, FunnelResult, ROIResult, OptimizationInsight } from '@/lib/api';
import {
  IconChartBar, IconArrowUpRight, IconArrowDownRight, IconMinus,
  IconRoute, IconCurrencyDollar, IconTarget, IconSparkles, IconCheck, IconX,
} from '@tabler/icons-react';

// ── Sub-components ─────────────────────────────────────────────────────────────

function KPICard({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  const hasUp   = delta !== null && delta !== undefined && delta > 0;
  const hasDown = delta !== null && delta !== undefined && delta < 0;
  return (
    <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px]">
      <div className="text-xs font-medium text-ink3 mb-2">{label}</div>
      <div className="font-mono text-2xl font-semibold text-ink mb-1">{value}</div>
      {delta !== null && delta !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${hasUp ? 'text-sage' : hasDown ? 'text-red-500' : 'text-ink3'}`}>
          {hasUp ? <IconArrowUpRight size={13} /> : hasDown ? <IconArrowDownRight size={13} /> : <IconMinus size={13} />}
          {delta > 0 ? '+' : ''}{delta}% vs last week
        </div>
      )}
      {sub && <div className="text-xs text-ink3 mt-1">{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, total, rate }: { label: string; value: number; total: number; rate: string }) {
  const pct = total > 0 ? Math.max(4, (value / total) * 100) : 4;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink2 font-medium">{label}</span>
        <span className="font-mono text-ink">{value.toLocaleString()} <span className="text-ink3">({rate})</span></span>
      </div>
      <div className="bg-raised rounded-full h-2 overflow-hidden">
        <div className="h-2 bg-sage rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InsightRow({ insight, token, onUpdate }: {
  insight: OptimizationInsight;
  token: string;
  onUpdate: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const handle = async (status: 'applied' | 'dismissed') => {
    if (!insight.id) return;
    setLoading(true);
    await api.analytics.updateInsight(insight.id, status, token);
    onUpdate();
    setLoading(false);
  };
  const confidenceColor = (insight.confidence ?? 0) >= 0.8 ? 'text-sage' : (insight.confidence ?? 0) >= 0.6 ? 'text-amber' : 'text-ink3';
  return (
    <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px] flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink mb-1">{insight.title}</div>
          <div className="text-xs text-ink2">{insight.description}</div>
          {insight.impactEstimate && (
            <div className="mt-1.5 text-xs font-medium text-sage">{insight.impactEstimate}</div>
          )}
        </div>
        <span className={`text-xs font-mono font-semibold ${confidenceColor} shrink-0`}>
          {Math.round((insight.confidence ?? 0) * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs px-2 py-0.5 rounded-full bg-raised text-ink2 border border-[--border2]">
          {(insight.insightType ?? '').replace(/_/g, ' ')}
        </span>
        <div className="flex-1" />
        <button
          disabled={loading}
          onClick={() => handle('dismissed')}
          className="flex items-center gap-1 text-xs text-ink3 hover:text-red-500 border border-[--border2] rounded-[6px] px-2 py-1"
        >
          <IconX size={12} />Dismiss
        </button>
        <button
          disabled={loading}
          onClick={() => handle('applied')}
          className="flex items-center gap-1 text-xs text-sage bg-[--sage-d] border border-[--sage-b] rounded-[6px] px-2 py-1"
        >
          <IconCheck size={12} />Apply
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const supabase = createClient();
  const [token,    setToken]    = useState<string | null>(null);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const [summary,   setSummary]   = useState<AnalyticsSummary | null>(null);
  const [kpi,       setKpi]       = useState<KPIPoint[]>([]);
  const [funnel,    setFunnel]    = useState<FunnelResult | null>(null);
  const [roi,       setRoi]       = useState<ROIResult | null>(null);
  const [insights,  setInsights]  = useState<OptimizationInsight[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Load session + products
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);

      const { data: prods } = await supabase
        .from('products')
        .select('id, name')
        .eq('founder_id', session.user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      setProducts((prods ?? []) as { id: string; name: string }[]);
      if (prods && prods.length > 0) setSelected((prods[0] as { id: string; name: string }).id);

      const sumData = await api.analytics.summary(session.access_token).catch(() => null);
      if (sumData) setSummary(sumData);
    })();
  }, []);

  // Load per-product data when selection changes
  useEffect(() => {
    if (!token || !selected) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [kpiRes, funnelRes, roiRes, insightsRes] = await Promise.all([
          api.analytics.kpi(selected, token, 12).catch(() => null),
          api.analytics.funnel(selected, token).catch(() => null),
          api.analytics.roi(selected, token).catch(() => null),
          api.analytics.insights(selected, token).catch(() => null),
        ]);
        if (kpiRes)      setKpi(kpiRes.weeks ?? []);
        if (funnelRes)   setFunnel(funnelRes as unknown as FunnelResult);
        if (roiRes)      setRoi(roiRes as unknown as ROIResult);
        if (insightsRes) setInsights((insightsRes as unknown as { insights: OptimizationInsight[] }).insights ?? []);
      } catch {
        setError('analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, selected]);

  const totals = summary?.totals;
  const latestKpi = kpi[0];
  const prevKpi   = kpi[1];

  const installDelta = latestKpi && prevKpi && prevKpi.installs > 0
    ? Math.round(((latestKpi.installs - prevKpi.installs) / prevKpi.installs) * 10000) / 100
    : null;

  const handleOptimize = async () => {
    if (!token || !selected) return;
    await api.analytics.optimize(selected, token).catch(() => null);
    const res = await api.analytics.insights(selected, token).catch(() => null);
    if (res) setInsights((res as unknown as { insights: OptimizationInsight[] }).insights ?? []);
  };

  const refreshInsights = async () => {
    if (!token || !selected) return;
    const res = await api.analytics.insights(selected, token).catch(() => null);
    if (res) setInsights((res as unknown as { insights: OptimizationInsight[] }).insights ?? []);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Analytics</h1>
          <p className="text-sm text-ink2 mt-0.5">Channel performance, funnel, ROI — per product</p>
        </div>
        {/* Product selector */}
        {products.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`text-xs rounded-[6px] px-3 py-1.5 border font-medium transition-colors ${
                  selected === p.id
                    ? 'bg-[--sage-d] border-[--sage-b] text-sage'
                    : 'bg-surface border-[--border2] text-ink2 hover:bg-raised'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPI cards — cross-product totals */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KPICard
            label="Total Installs"
            value={totals.totalInstalls.toLocaleString()}
            delta={installDelta}
          />
          <KPICard
            label="Total Impressions"
            value={totals.totalImpressions.toLocaleString()}
          />
          <KPICard
            label="Avg CPI"
            value={totals.avgCpi !== null ? `$${totals.avgCpi}` : 'N/A'}
            sub="cost per install"
          />
          <KPICard
            label="Avg ROAS"
            value={totals.avgRoas !== null ? `${totals.avgRoas}×` : 'N/A'}
            sub="return on ad spend"
          />
        </div>
      )}

      {!loading && selected && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Left column: Funnel + ROI */}
          <div className="xl:col-span-2 space-y-4">
            {/* Funnel */}
            {funnel && (
              <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px]">
                <div className="flex items-center gap-2 mb-4">
                  <IconRoute size={16} className="text-ink3" />
                  <span className="text-sm font-semibold text-ink">Install Funnel</span>
                  {funnel.overallFunnelRate !== null && (
                    <span className="ml-auto text-xs font-mono text-ink2">
                      Overall: {(funnel.overallFunnelRate * 100).toFixed(3)}%
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  <FunnelBar
                    label="Impressions"
                    value={funnel.impressions}
                    total={funnel.impressions}
                    rate="100%"
                  />
                  <FunnelBar
                    label="Clicks"
                    value={funnel.clicks}
                    total={funnel.impressions}
                    rate={funnel.impressionToClickRate !== null ? `${(funnel.impressionToClickRate * 100).toFixed(2)}% CTR` : '—'}
                  />
                  <FunnelBar
                    label="Installs"
                    value={funnel.installs}
                    total={funnel.impressions}
                    rate={funnel.clickToInstallRate !== null ? `${(funnel.clickToInstallRate * 100).toFixed(2)}% conv` : '—'}
                  />
                </div>

                {/* Per-channel breakdown */}
                {funnel.byChannel.length > 0 && (
                  <div className="mt-4 border-t border-[--border] pt-3">
                    <div className="text-xs font-medium text-ink3 mb-2">By channel</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ minWidth: 400 }}>
                        <thead>
                          <tr className="text-ink3">
                            <th className="text-left pb-2 font-medium">Channel</th>
                            <th className="text-right pb-2 font-medium">Impr</th>
                            <th className="text-right pb-2 font-medium">Clicks</th>
                            <th className="text-right pb-2 font-medium">Installs</th>
                            <th className="text-right pb-2 font-medium">CTR</th>
                            <th className="text-right pb-2 font-medium">Conv</th>
                          </tr>
                        </thead>
                        <tbody>
                          {funnel.byChannel.map(c => (
                            <tr key={`${c.channel}:${c.market}`} className="border-t border-[--border]">
                              <td className="py-1.5">
                                <span className="font-medium text-ink capitalize">{c.channel}</span>
                                <span className="text-ink3 ml-1">/{c.market}</span>
                              </td>
                              <td className="text-right py-1.5 font-mono text-ink2">{c.impressions.toLocaleString()}</td>
                              <td className="text-right py-1.5 font-mono text-ink2">{c.clicks.toLocaleString()}</td>
                              <td className="text-right py-1.5 font-mono text-ink">{c.installs.toLocaleString()}</td>
                              <td className="text-right py-1.5 font-mono text-ink2">
                                {c.ctr !== null ? `${(c.ctr * 100).toFixed(2)}%` : '—'}
                              </td>
                              <td className="text-right py-1.5 font-mono text-ink2">
                                {c.conversionRate !== null ? `${(c.conversionRate * 100).toFixed(2)}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ROI table */}
            {roi && (
              <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px]">
                <div className="flex items-center gap-2 mb-4">
                  <IconCurrencyDollar size={16} className="text-ink3" />
                  <span className="text-sm font-semibold text-ink">ROI by Channel</span>
                  <span className="ml-auto text-xs text-ink3">spend proxy: CPI × installs</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: 420 }}>
                    <thead>
                      <tr className="text-ink3">
                        <th className="text-left pb-2 font-medium">Channel</th>
                        <th className="text-right pb-2 font-medium">Est. Spend</th>
                        <th className="text-right pb-2 font-medium">Est. Revenue</th>
                        <th className="text-right pb-2 font-medium">ROAS</th>
                        <th className="text-right pb-2 font-medium">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roi.byChannel.map(c => (
                        <tr key={`${c.channel}:${c.market}`} className="border-t border-[--border]">
                          <td className="py-1.5">
                            <span className="font-medium text-ink capitalize">{c.channel}</span>
                            <span className="text-ink3 ml-1">/{c.market}</span>
                          </td>
                          <td className="text-right py-1.5 font-mono text-ink2">${c.estimatedSpend.toFixed(2)}</td>
                          <td className="text-right py-1.5 font-mono text-ink2">${c.estimatedRevenue.toFixed(2)}</td>
                          <td className="text-right py-1.5 font-mono text-ink2">{c.roas !== null ? `${c.roas}×` : '—'}</td>
                          <td className={`text-right py-1.5 font-mono font-semibold ${(c.roi ?? 0) >= 0 ? 'text-sage' : 'text-red-500'}`}>
                            {c.roi !== null ? `${c.roi > 0 ? '+' : ''}${c.roi}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-[--border]">
                      <tr>
                        <td className="py-2 text-xs font-semibold text-ink">Total</td>
                        <td className="text-right py-2 font-mono font-semibold text-ink">${roi.estimatedSpend.toFixed(2)}</td>
                        <td className="text-right py-2 font-mono font-semibold text-ink">${roi.estimatedRevenue.toFixed(2)}</td>
                        <td />
                        <td className={`text-right py-2 font-mono font-bold ${(roi.overallROI ?? 0) >= 0 ? 'text-sage' : 'text-red-500'}`}>
                          {roi.overallROI !== null ? `${roi.overallROI > 0 ? '+' : ''}${roi.overallROI}%` : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right column: Optimization insights */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconSparkles size={16} className="text-ink3" />
                <span className="text-sm font-semibold text-ink">AI Insights</span>
                {insights.length > 0 && (
                  <span className="text-xs font-mono bg-[--indigo-d] border border-[--indigo-b] text-indigo px-1.5 py-0.5 rounded-full">
                    {insights.length}
                  </span>
                )}
              </div>
              <button
                onClick={handleOptimize}
                className="text-xs bg-sage text-white rounded-[6px] px-3 py-1.5 font-medium flex items-center gap-1"
              >
                <IconTarget size={13} />Generate
              </button>
            </div>

            {insights.length === 0 ? (
              <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px] text-center">
                <div className="text-sm text-ink2">No active insights</div>
                <div className="text-xs text-ink3 mt-1">Click Generate to analyze your metrics</div>
              </div>
            ) : (
              insights.map(ins => (
                <InsightRow
                  key={ins.id ?? ins.title}
                  insight={ins}
                  token={token ?? ''}
                  onUpdate={refreshInsights}
                />
              ))
            )}

            {/* KPI Sparkline — last 12 weeks */}
            {kpi.length > 0 && (
              <div className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px]">
                <div className="flex items-center gap-2 mb-3">
                  <IconChartBar size={16} className="text-ink3" />
                  <span className="text-sm font-semibold text-ink">Weekly Installs</span>
                </div>
                <div className="space-y-1.5">
                  {kpi.slice(0, 8).reverse().map(w => {
                    const max = Math.max(...kpi.map(k => k.installs), 1);
                    const pct = Math.max(4, (w.installs / max) * 100);
                    return (
                      <div key={w.weekOf} className="flex items-center gap-2 text-xs">
                        <span className="text-ink3 w-20 shrink-0">{w.weekOf}</span>
                        <div className="flex-1 bg-raised rounded-full h-1.5 overflow-hidden">
                          <div className="h-1.5 bg-sage rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-ink w-10 text-right">{w.installs}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <ErrorState onRetry={() => { setError(null); setLoading(true); }} />
      )}

      {loading && selected && !error && (
        <div className="flex items-center justify-center h-40">
          <div className="flex items-center gap-2 text-ink2">
            <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
            <span className="text-sm">Loading analytics…</span>
          </div>
        </div>
      )}

      {!selected && !loading && !error && (
        <div className="flex items-center justify-center h-40">
          <div className="text-center">
            <p className="text-[14px] font-medium text-ink mb-1">No campaign data yet</p>
            <p className="text-[13px] text-ink2">Launch a campaign to see performance.</p>
          </div>
        </div>
      )}
    </div>
  );
}
