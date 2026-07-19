/**
 * @file app/(dashboard)/dashboard/intelligence/market/page.tsx
 * @description Market Intelligence — competitor tracking, category benchmarks, and trend signals.
 *   Data sources: products.competitor_set, playbook_signals (benchmarks), intelligence_trends.
 * @security All data is founder-scoped. Benchmark data is anonymous (no cross-tenant leakage).
 * @dependencies api.benchmarks, api.owner, Tabler icons v3
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type BenchmarkResult, type TrendSummary } from '@/lib/api';
import { ErrorState } from '@/components/launchmind/ErrorState';
import { toRecord, toStringArray } from '@/lib/coerce';
import {
  IconWorld, IconTrendingUp, IconTrendingDown, IconMinus,
  IconChartBar, IconRefresh, IconAlertTriangle, IconSparkles,
  IconStar, IconDeviceMobile, IconBrandGoogle, IconBrandApple,
} from '@tabler/icons-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string | null;
  markets: string[] | null;
  platform: string;
  competitor_set: Competitor[] | null;
  scraped_meta: { rating?: number; ratingCount?: number; category?: string } | null;
}

interface Competitor {
  name: string;
  developer?: string;
  rating?: number;
  category?: string;
  priceTier?: string;
  platform?: string;
  storeUrl?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TrendBadge({ direction }: { direction: TrendSummary['direction'] }) {
  const config = {
    up:       { icon: IconTrendingUp,   color: 'var(--sage)',    bg: 'var(--sage-d)',   border: 'var(--sage-b)',   label: 'Trending up' },
    down:     { icon: IconTrendingDown, color: 'var(--danger)',     bg: 'var(--danger-d)',    border: 'var(--danger-b)',    label: 'Trending down' },
    flat:     { icon: IconMinus,        color: 'var(--ink2)',    bg: 'var(--raised)',   border: 'var(--border2)',  label: 'Stable' },
    volatile: { icon: IconAlertTriangle,color: 'var(--amber)',   bg: 'var(--amber-d)', border: 'var(--amber-b)', label: 'Volatile' },
  };
  const c = config[direction] ?? config.flat;
  const Icon = c.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <Icon size={11} />
      {c.label}
    </span>
  );
}

function BenchmarkBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: 6, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 400ms ease' }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketIntelligencePage() {
  const [products, setProducts]         = useState<Product[]>([]);
  const [selectedProduct, setSelected]  = useState<Product | null>(null);
  const [benchmark, setBenchmark]       = useState<BenchmarkResult | null>(null);
  const [trends, setTrends]             = useState<TrendSummary[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const loadBenchmark = useCallback(async (product: Product, token: string) => {
    if (!product.category) return;
    const market = (product.markets ?? ['usa'])[0] ?? 'usa';

    const [bRes, tRes] = await Promise.all([
      api.benchmarks.get({ category: product.category, market }, token),
      api.benchmarks.trends({ category: product.category, market }, token),
    ]);

    setBenchmark(bRes.benchmark ?? null);
    setTrends(tRes.trends ?? []);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError('Not authenticated'); setLoading(false); return; }
        const token = session.access_token;

        // Fetch founder's products with competitor data
        const { data: prods, error: pe } = await supabase
          .from('products')
          .select('id, name, category, markets, platform, competitor_set, scraped_meta')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (pe) throw pe;

        const list = (prods ?? []) as Product[];
        setProducts(list);

        if (list.length > 0) {
          setSelected(list[0]);
          await loadBenchmark(list[0], token);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [loadBenchmark]);

  const handleSelectProduct = async (product: Product) => {
    setSelected(product);
    setRefreshing(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await loadBenchmark(product, session.access_token);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 80, background: 'var(--raised)', borderRadius: 10, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
        <ErrorState onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <IconWorld size={36} style={{ color: 'var(--ink3)', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>No products yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Add a product to see market intelligence and competitor benchmarks.</div>
        </div>
      </div>
    );
  }

  const rawCompetitors = selectedProduct?.competitor_set;
  const competitors: Competitor[] = Array.isArray(rawCompetitors)
    ? rawCompetitors as Competitor[]
    : rawCompetitors != null && typeof rawCompetitors === 'object'
      ? Object.values(rawCompetitors as Record<string, unknown>).filter(Boolean) as Competitor[]
      : [];

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            Market Intelligence
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '4px 0 0' }}>
            Category benchmarks and competitor landscape
          </p>
        </div>
        {refreshing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink3)' }}>
            <IconRefresh size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Refreshing…
          </div>
        )}
      </div>

      {/* Product tabs */}
      {products.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {products.map(p => (
            <button
              key={p.id}
              onClick={() => handleSelectProduct(p)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: '1px solid',
                background: selectedProduct?.id === p.id ? 'var(--sage-d)' : 'var(--surface)',
                borderColor: selectedProduct?.id === p.id ? 'var(--sage-b)' : 'var(--border)',
                color: selectedProduct?.id === p.id ? 'var(--sage)' : 'var(--ink2)',
                fontWeight: selectedProduct?.id === p.id ? 600 : 400,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>

        {/* Benchmark card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <IconChartBar size={16} style={{ color: 'var(--sage)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {selectedProduct?.category ?? 'Category'} Benchmarks
            </span>
            <span style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 4,
              background: 'var(--raised)', color: 'var(--ink3)', border: '1px solid var(--border)',
            }}>
              {(selectedProduct?.markets ?? ['usa'])[0]?.toUpperCase()}
            </span>
          </div>

          {benchmark ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Install delta */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Avg. install delta</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
                    {benchmark.avgInstallDeltaPct > 0 ? '+' : ''}{benchmark.avgInstallDeltaPct}%
                  </span>
                </div>
                <BenchmarkBar value={Math.abs(benchmark.avgInstallDeltaPct)} max={50} color="var(--sage)" />
              </div>

              {/* Conversion rate */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Avg. conversion rate</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
                    {(benchmark.avgConversionRate * 100).toFixed(1)}%
                  </span>
                </div>
                <BenchmarkBar value={benchmark.avgConversionRate * 100} max={10} color="var(--indigo)" />
              </div>

              {/* D7 retention */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Avg. D7 retention</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
                    {(benchmark.avgRetentionD7 * 100).toFixed(1)}%
                  </span>
                </div>
                <BenchmarkBar value={benchmark.avgRetentionD7 * 100} max={50} color="var(--amber)" />
              </div>

              <div style={{ display: 'flex', gap: 12, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Top channel</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{benchmark.topChannel ?? '–'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Signal count</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{benchmark.signalCount}</div>
                </div>
              </div>
              {benchmark.signalCount < 20 && (
                <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8, lineHeight: 1.4 }}>
                  Based on industry estimates — live benchmarks unlock as more apps report data.
                </p>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <IconSparkles size={20} style={{ color: 'var(--ink3)', display: 'block', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 4px', fontWeight: 500 }}>Not enough market signal yet</p>
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
                Benchmarks unlock once 3+ similar apps report data for this category.
              </p>
            </div>
          )}
        </div>

        {/* Trends card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <IconTrendingUp size={16} style={{ color: 'var(--sage)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>30-day Trends</span>
          </div>

          {trends.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {trends.map((t, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink2)', flex: 1 }}>
                      {t.trendType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                    <TrendBadge direction={t.direction} />
                  </div>
                  {t.summary && (
                    <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0, lineHeight: 1.4 }}>
                      {t.summary}
                    </p>
                  )}
                  {i < trends.length - 1 && <div style={{ height: 1, background: 'var(--border)' }} />}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink3)', fontSize: 13 }}>
              <IconMinus size={20} style={{ display: 'block', margin: '0 auto 8px' }} />
              No trend data yet. Trends compute weekly from the Intelligence Network.
            </div>
          )}
        </div>
      </div>

      {/* Competitors grid */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <IconWorld size={16} style={{ color: 'var(--sage)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            Competitor Landscape
          </span>
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 4,
            background: 'var(--raised)', color: 'var(--ink3)',
          }}>
            {competitors.length} tracked
          </span>
        </div>

        {competitors.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {competitors.map((c, i) => (
              <div key={i} style={{
                background: 'var(--raised)', borderRadius: 8, padding: '12px 14px',
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>{c.name}</div>
                  {c.platform === 'app_store'
                    ? <IconBrandApple size={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
                    : <IconBrandGoogle size={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {c.developer && (
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{c.developer}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {c.rating != null && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--amber)' }}>
                        <IconStar size={10} />
                        {c.rating.toFixed(1)}
                      </span>
                    )}
                    {c.category && (
                      <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{c.category}</span>
                    )}
                    {c.priceTier && (
                      <span style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 3,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        color: 'var(--ink2)',
                      }}>
                        {c.priceTier}
                      </span>
                    )}
                  </div>
                  {c.storeUrl && (
                    <a
                      href={c.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: 'var(--sage)', textDecoration: 'none' }}
                    >
                      View in store →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink3)', fontSize: 13 }}>
            <IconDeviceMobile size={24} style={{ display: 'block', margin: '0 auto 10px' }} />
            No competitors tracked yet.
            <br />
            <span style={{ color: 'var(--ink2)' }}>
              Competitors are detected during product intake and can be added manually.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
