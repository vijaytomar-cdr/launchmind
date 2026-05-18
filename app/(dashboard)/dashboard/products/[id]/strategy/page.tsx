/**
 * @file app/(dashboard)/dashboard/products/[id]/strategy/page.tsx
 * @description Execute step: shows the generated 30/60/90-day strategy + content assets.
 *   - 30/60/90 tab navigation
 *   - USA / India market toggle (Builder+ shows both; Solo shows one)
 *   - Channel recommendation cards ranked by projected performance
 *   - Content asset cards with one-tap copy button
 *   - Free tier: upgrade CTA overlay; fullStrategy not in API response (enforced server-side)
 * @security Auth token from Supabase session only. All data fetched from Fastify API.
 * @dependencies lib/api, lib/supabase/client, next/navigation
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';

type Phase = '30d' | '60d' | '90d';
type Market = 'usa' | 'india';

interface ChannelPlan {
  channel: string;
  rationale: string;
  projectedPerformance: 'high' | 'medium' | 'low';
  suggestedWeeklySpendUSD: number;
  suggestedWeeklySpendINR: number;
  hookType: string;
  primaryKPI: string;
}

interface MarketStrategy {
  positioning: string;
  primaryChannels: string[];
  messagingAngle: string;
  pricingAngle: string;
  topObjection: string;
  objectiveFocus: string;
}

interface Strategy {
  thirtyDay: ChannelPlan[];
  sixtyDay: ChannelPlan[];
  ninetyDay: ChannelPlan[];
  usa: MarketStrategy;
  india: MarketStrategy;
  executiveSummary: string;
  generatedAt: string;
}

interface ContentAssets {
  channel: string;
  market: string;
  whatsapp?: Array<{ hookType: string; headline: string; body: string; cta: string }>;
  emailSequence?: Array<{ day: number; subject: string; preview: string; body: string }>;
  metaAds?: Array<{ headline: string; bodyText: string; cta: string }>;
  generatedAt: string;
}

const PHASE_KEYS: Record<Phase, keyof Strategy> = {
  '30d': 'thirtyDay',
  '60d': 'sixtyDay',
  '90d': 'ninetyDay',
};

const PERF_STYLE: Record<string, React.CSSProperties> = {
  high:   { background: 'var(--sage-d)', color: 'var(--sage)' },
  medium: { background: 'var(--amber-d)', color: 'var(--amber)' },
  low:    { background: 'var(--raised)', color: 'var(--ink3)' },
};

const CHANNEL_ICONS: Record<string, string> = {
  meta: '📘', google: '🔍', whatsapp: '💬', linkedin: '💼', email: '📧',
};

export default function StrategyPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [phase, setPhase] = useState<Phase>('30d');
  const [market, setMarket] = useState<Market>('usa');
  const [assets, setAssets] = useState<ContentAssets | null>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState('');
  const [isPremium, setIsPremium] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setToken(data.session.access_token);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    api.products.get(params.id, token)
      .then(setProduct)
      .catch(() => router.push('/dashboard/products'));
  }, [token, params.id, router]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/products/${params.id}/strategy`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.fullStrategy) {
          setStrategy(data.fullStrategy);
          setIsPremium(true);
        }
      })
      .catch(() => {});
  }, [token, params.id]);

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      const res = await fetch(`/api/products/${params.id}/strategy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Generation failed');
      setStrategy(data);
      setIsPremium(true);
      const channelCount = [
        ...(data.thirtyDay ?? []),
        ...(data.sixtyDay ?? []),
        ...(data.ninetyDay ?? []),
      ].length;
      trackOnboarding('strategy_generated', { channel_count: channelCount });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Strategy generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const handleLoadAssets = useCallback(async (channel: string) => {
    setLoadingAssets(true);
    setActiveChannel(channel);
    setAssets(null);
    try {
      const res = await fetch(`/api/products/${params.id}/strategy/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, market }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setAssets(data);
    } catch {
      setError('Failed to generate assets — retry');
    } finally {
      setLoadingAssets(false);
    }
  }, [token, params.id, market]);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  const phaseChannels = strategy
    ? (strategy[PHASE_KEYS[phase]] as ChannelPlan[]).sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.projectedPerformance] - order[b.projectedPerformance];
      })
    : [];

  const marketData = strategy?.[market] as MarketStrategy | undefined;

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6" style={{ fontSize: 13, color: 'var(--ink3)' }}>
        <Link href="/dashboard/products" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink2)' }}>Products</Link>
        <span>/</span>
        <Link href={`/dashboard/products/${params.id}`} className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink2)' }}>
          {product?.name ?? '…'}
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>Strategy</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Marketing Strategy
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>30/60/90-day plan for USA + India</p>
        </div>
        {!strategy && (
          <button
            onClick={handleGenerate}
            disabled={generating || !token}
            className="rounded-[6px] px-5 py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            {generating ? 'Generating…' : 'Generate strategy'}
          </button>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>{error}</p>}

      {!strategy && !generating && (
        <div
          className="rounded-[10px] p-12 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
            No strategy generated yet. Click &ldquo;Generate strategy&rdquo; to build your 30/60/90-day plan.
          </p>
        </div>
      )}

      {generating && (
        <div
          className="rounded-[10px] p-12 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
          <p className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>Building your strategy…</p>
          <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>
            Claude Sonnet is analysing your ICP + playbook signals
          </p>
        </div>
      )}

      {strategy && (
        <div className="space-y-6">
          {/* Executive summary */}
          <div
            className="rounded-[10px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Executive summary</p>
            <p style={{ fontSize: 13, color: 'var(--ink)' }}>{strategy.executiveSummary}</p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div
              className="flex rounded-[8px] p-1 gap-1"
              style={{ background: 'var(--raised)', border: '1px solid var(--border)' }}
            >
              {(['30d', '60d', '90d'] as Phase[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className="rounded-[6px] px-4 py-1.5 font-medium transition-colors"
                  style={{
                    fontSize: 12,
                    background: phase === p ? 'var(--sage)' : 'transparent',
                    color: phase === p ? '#fff' : 'var(--ink2)',
                  }}
                >
                  {p === '30d' ? '30 days' : p === '60d' ? '60 days' : '90 days'}
                </button>
              ))}
            </div>

            <div
              className="flex rounded-[8px] p-1 gap-1"
              style={{ background: 'var(--raised)', border: '1px solid var(--border)' }}
            >
              {(['usa', 'india'] as Market[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMarket(m); setAssets(null); setActiveChannel(null); }}
                  className="rounded-[6px] px-4 py-1.5 font-medium transition-colors"
                  style={{
                    fontSize: 12,
                    background: market === m
                      ? m === 'india' ? 'var(--amber)' : 'var(--sage)'
                      : 'transparent',
                    color: market === m ? '#fff' : 'var(--ink2)',
                  }}
                >
                  {m === 'usa' ? '🇺🇸 USA' : '🇮🇳 India'}
                </button>
              ))}
            </div>
          </div>

          {/* Market positioning */}
          {marketData && (
            <div
              className="rounded-[10px] p-5 grid grid-cols-2 gap-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {[
                { label: 'Positioning', value: marketData.positioning },
                { label: 'Messaging angle', value: marketData.messagingAngle },
                { label: 'Pricing angle', value: marketData.pricingAngle },
                { label: 'Top objection to address', value: marketData.topObjection },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 3 }}>{label}</p>
                  <p style={{ fontSize: 13, color: 'var(--ink)' }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Channel cards */}
          <div>
            <h3 className="font-semibold mb-3" style={{ fontSize: 12, color: 'var(--ink2)' }}>
              Recommended channels — {phase} ({market.toUpperCase()})
            </h3>
            {phaseChannels.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink3)' }}>No channels recommended for this phase.</p>
            ) : (
              <div className="space-y-3">
                {phaseChannels.map((cp) => (
                  <div
                    key={cp.channel}
                    className="rounded-[10px] p-5"
                    style={{
                      background: 'var(--surface)',
                      border: `1px solid ${activeChannel === cp.channel ? 'var(--sage)' : 'var(--border)'}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{CHANNEL_ICONS[cp.channel] ?? '📣'}</span>
                          <span className="font-semibold capitalize" style={{ fontSize: 13, color: 'var(--ink)' }}>
                            {cp.channel}
                          </span>
                          <span
                            className="rounded-full px-2 py-0.5 font-medium"
                            style={{ fontSize: 11, ...PERF_STYLE[cp.projectedPerformance] }}
                          >
                            {cp.projectedPerformance} potential
                          </span>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 6 }}>{cp.rationale}</p>
                        <div className="flex items-center gap-4" style={{ fontSize: 12, color: 'var(--ink3)' }}>
                          <span>Hook: <span style={{ color: 'var(--ink2)' }}>{cp.hookType}</span></span>
                          <span>KPI: <span style={{ color: 'var(--ink2)' }}>{cp.primaryKPI}</span></span>
                          <span>
                            Budget:{' '}
                            <span style={{ color: 'var(--ink2)' }}>
                              {market === 'india'
                                ? `₹${cp.suggestedWeeklySpendINR.toLocaleString('en-IN')}/wk`
                                : `$${cp.suggestedWeeklySpendUSD}/wk`}
                            </span>
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleLoadAssets(cp.channel)}
                        disabled={loadingAssets}
                        className="flex-shrink-0 rounded-[6px] px-3 py-1.5 disabled:opacity-50 transition-opacity hover:opacity-80"
                        style={{ fontSize: 12, color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
                      >
                        {loadingAssets && activeChannel === cp.channel ? 'Loading…' : 'Get copy →'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Content assets panel */}
          {assets && (
            <div
              className="rounded-[10px] p-6"
              style={{ background: 'var(--surface)', border: '2px solid var(--sage)' }}
            >
              <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontSize: 13, color: 'var(--ink)' }}>
                <span>{CHANNEL_ICONS[assets.channel]}</span>
                <span className="capitalize">{assets.channel}</span>
                <span style={{ color: 'var(--ink3)' }}>·</span>
                <span>{market === 'india' ? '🇮🇳 India' : '🇺🇸 USA'} copy</span>
              </h3>

              {assets.whatsapp && (
                <div className="space-y-3">
                  {assets.whatsapp.map((t, i) => (
                    <AssetCard key={i} title={`Template ${i + 1} — ${t.hookType}`}>
                      <p className="font-semibold mb-1" style={{ fontSize: 13, color: 'var(--ink)' }}>{t.headline}</p>
                      <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 6 }}>{t.body}</p>
                      <p style={{ fontSize: 12, color: 'var(--sage)' }}>{t.cta}</p>
                      <CopyBtn text={`${t.headline}\n\n${t.body}\n\n${t.cta}`} id={`wa-${i}`} copied={copied} onCopy={copy} />
                    </AssetCard>
                  ))}
                </div>
              )}

              {assets.emailSequence && (
                <div className="space-y-3">
                  {assets.emailSequence.map((e, i) => (
                    <AssetCard key={i} title={`Day ${e.day} email`}>
                      <p className="font-semibold mb-0.5" style={{ fontSize: 13, color: 'var(--ink)' }}>{e.subject}</p>
                      <p className="italic mb-2" style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.preview}</p>
                      <p style={{ fontSize: 13, color: 'var(--ink2)' }}>{e.body}</p>
                      <CopyBtn text={`Subject: ${e.subject}\n\n${e.body}`} id={`em-${i}`} copied={copied} onCopy={copy} />
                    </AssetCard>
                  ))}
                </div>
              )}

              {assets.metaAds && (
                <div className="space-y-3">
                  {assets.metaAds.map((ad, i) => (
                    <AssetCard key={i} title={`Ad variant ${i + 1}`}>
                      <p className="font-semibold mb-1" style={{ fontSize: 13, color: 'var(--ink)' }}>{ad.headline}</p>
                      <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 6 }}>{ad.bodyText}</p>
                      <p style={{ fontSize: 12, color: 'var(--sage)' }}>{ad.cta}</p>
                      <CopyBtn text={`${ad.headline}\n\n${ad.bodyText}\n\n${ad.cta}`} id={`ad-${i}`} copied={copied} onCopy={copy} />
                    </AssetCard>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Free tier upgrade overlay */}
          {!isPremium && (
            <div
              className="rounded-[10px] p-8 text-center relative overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center flex-col"
                style={{ background: 'rgba(242,243,246,0.92)', backdropFilter: 'blur(4px)' }}
              >
                <p className="font-semibold mb-2" style={{ fontSize: 14, color: 'var(--ink)' }}>
                  Unlock full strategy
                </p>
                <p className="mb-4" style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 320 }}>
                  Upgrade to Solo or higher to access the full 60/90-day plan and content asset generation.
                </p>
                <Link
                  href="/pricing"
                  className="rounded-[6px] px-5 py-2 font-medium transition-opacity hover:opacity-90"
                  style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
                >
                  View plans →
                </Link>
              </div>
              <div className="opacity-10 pointer-events-none select-none space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-[8px]" style={{ background: 'var(--raised)' }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] p-4 relative" style={{ background: 'var(--raised)' }}>
      <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>{title}</p>
      {children}
    </div>
  );
}

function CopyBtn({
  text, id, copied, onCopy,
}: {
  text: string; id: string; copied: string; onCopy: (t: string, k: string) => void;
}) {
  return (
    <button
      onClick={() => onCopy(text, id)}
      className="absolute top-3 right-3 transition-opacity hover:opacity-70"
      style={{ fontSize: 12, color: copied === id ? 'var(--sage)' : 'var(--ink3)' }}
    >
      {copied === id ? '✓ Copied' : 'Copy'}
    </button>
  );
}
