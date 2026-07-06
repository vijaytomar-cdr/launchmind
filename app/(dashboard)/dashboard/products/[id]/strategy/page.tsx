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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/api';
import type { ContentAsset } from '@/lib/types/content';
import { CHANNEL_ORDER, groupAssetsByChannel } from '@/lib/types/content';
import { AssetBlock } from '@/components/launchmind/AssetBlock';
import { BudgetRealityCard } from '@/components/launchmind/BudgetRealityCard';
import { VideoConceptPicker } from '@/components/launchmind/VideoConceptPicker';
import { trackOnboarding } from '@/lib/analytics';

type Phase = '30d' | '60d' | '90d';
type Market = 'usa' | 'india';

// ── Content generation checklist ──────────────────────────────────────────────

interface ContentStage {
  key: string;
  icon: string;
  label: string;
  detail: string;
  etaLabel: string;
  warning?: boolean;
  types: string[];
}

const CONTENT_STAGES: ContentStage[] = [
  {
    key: 'copy',
    icon: '📝',
    label: 'Ad copy & messaging',
    detail: 'WhatsApp, Meta, Email, Google, LinkedIn, ASO',
    etaLabel: '~60–90s',
    types: ['whatsapp_broadcast', 'meta_headline', 'meta_body', 'google_uac_variants',
            'email_day1', 'email_day5', 'email_day14', 'linkedin_founder_story',
            'linkedin_data_post', 'aso_subtitle', 'aso_description', 'aso_keywords'],
  },
  {
    key: 'community',
    icon: '🤝',
    label: 'Community & social proof',
    detail: 'WhatsApp group, Facebook, IndieHackers, Twitter/X, review templates',
    etaLabel: '~45–60s',
    types: ['community_whatsapp_group', 'community_facebook', 'community_indiehackers',
            'community_twitter_thread', 'social_proof_case_study', 'social_proof_testimonial',
            'social_proof_review_response', 'social_proof_producthunt'],
  },
  {
    key: 'voice',
    icon: '🎙️',
    label: 'Voice note',
    detail: 'WhatsApp voice message via ElevenLabs',
    etaLabel: '~60–90s',
    types: ['whatsapp_voice_note'],
  },
  {
    key: 'visual',
    icon: '🖼️',
    label: 'Visual assets',
    detail: 'Meta image brief, carousel brief',
    etaLabel: '~60–90s',
    types: ['meta_image_brief', 'carousel_brief'],
  },
  {
    key: 'video',
    icon: '🎬',
    label: 'Video ads',
    detail: 'Reels 30s, Shorts 60s, App Store preview — rendered by Creatomate',
    etaLabel: '2–4 min',
    warning: true,
    types: ['video_reels_30s', 'video_shorts_60s', 'video_app_preview'],
  },
];

function useElapsedTimer(isActive: boolean) {
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    if (!isActive) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id); // cleanup freezes elapsed at last value
  }, [isActive]);
  return elapsed;
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function ContentGeneratingChecklist({ contentAssets, isActive }: { contentAssets: ContentAsset[]; isActive: boolean }) {
  const elapsed = useElapsedTimer(isActive);

  // Concepts = scripts generated, waiting for owner to select/render — count as "done" for checklist
  const doneTypes = new Set(contentAssets.map((a) => a.asset_type));

  // A stage is "done" if ANY of its types has appeared in the DB
  const stageDone = (types: readonly string[]) => types.some((t) => doneTypes.has(t as ContentAsset['asset_type']));

  // First non-done stage = currently active
  const activeIdx = CONTENT_STAGES.findIndex((s) => !stageDone(s.types));
  const allDone = activeIdx === -1;

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{ background: 'var(--surface)', border: `1.5px solid ${allDone && !isActive ? 'var(--border)' : 'var(--sage-b)'}` }}
    >
      {/* Header */}
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {isActive ? (
          <div
            className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
        ) : (
          <span style={{ fontSize: 15, color: allDone ? 'var(--sage)' : 'var(--ink3)', flexShrink: 0 }}>
            {allDone ? '✓' : '○'}
          </span>
        )}
        <div style={{ flex: 1 }}>
          <p className="font-semibold" style={{ fontSize: 13, color: isActive ? 'var(--ink)' : allDone ? 'var(--sage)' : 'var(--ink2)' }}>
            {isActive ? 'Generating your content…' : allDone ? 'Content ready' : 'Generation stages'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>
            {isActive
              ? 'Assets appear as each stage completes — text first, video last'
              : allDone
                ? 'All stages complete — see content below'
                : 'Click Generate content to start'}
          </p>
        </div>
        {/* Timer: live when active, frozen when just finished, hidden when loaded from existing */}
        {(isActive || elapsed > 0) && (
          <span style={{
            fontFamily: 'DM Mono, monospace',
            fontSize: 12,
            color: isActive && elapsed > 120 ? 'var(--amber)' : allDone && !isActive ? 'var(--sage)' : 'var(--ink3)',
            background: 'var(--raised)',
            border: '1px solid var(--border2)',
            borderRadius: 4,
            padding: '2px 8px',
            flexShrink: 0,
          }}>
            {!isActive && allDone ? `✓ ${formatElapsed(elapsed)}` : formatElapsed(elapsed)}
          </span>
        )}
      </div>

      {/* Stage rows */}
      <div style={{ padding: '8px 0' }}>
        {CONTENT_STAGES.map((stage, idx) => {
          const done = stageDone(stage.types);
          const active = !done && idx === activeIdx;
          const pending = !done && !active;

          return (
            <div
              key={stage.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 18px',
                opacity: pending ? 0.45 : 1,
                borderBottom: idx < CONTENT_STAGES.length - 1 ? '1px solid var(--border)' : undefined,
              }}
            >
              {/* Status icon */}
              <div style={{ flexShrink: 0, width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done ? (
                  <span style={{ fontSize: 15, color: 'var(--sage)' }}>✓</span>
                ) : active && isActive ? (
                  <div
                    className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: stage.warning ? 'var(--amber)' : 'var(--sage)', borderTopColor: 'transparent' }}
                  />
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink3)' }}>○</span>
                )}
              </div>

              {/* Asset icon + label */}
              <span style={{ fontSize: 16, flexShrink: 0 }}>{stage.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: done ? 500 : 400, color: done ? 'var(--sage)' : active ? 'var(--ink)' : 'var(--ink3)' }}>
                  {stage.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {stage.detail}
                </p>
              </div>

              {/* Status badge */}
              <div style={{ flexShrink: 0 }}>
                {done ? (
                  <span style={{
                    fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                    background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)',
                  }}>
                    Ready
                  </span>
                ) : active ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                      background: stage.warning ? 'var(--amber-d)' : 'var(--raised)',
                      border: `1px solid ${stage.warning ? 'var(--amber-b)' : 'var(--border2)'}`,
                      color: stage.warning ? 'var(--amber)' : 'var(--ink3)',
                      fontFamily: 'DM Mono, monospace',
                    }}>
                      ETA {stage.etaLabel}
                    </span>
                    {isActive && (
                      <span style={{
                        fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                        background: elapsed > 90 ? 'var(--amber-d)' : 'var(--raised)',
                        border: `1px solid ${elapsed > 90 ? 'var(--amber-b)' : 'var(--border2)'}`,
                        color: elapsed > 90 ? 'var(--amber)' : 'var(--ink2)',
                        fontFamily: 'DM Mono, monospace',
                      }}>
                        ⏱ {formatElapsed(elapsed)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                    background: stage.warning ? 'var(--amber-d)' : 'var(--raised)',
                    border: `1px solid ${stage.warning ? 'var(--amber-b)' : 'var(--border2)'}`,
                    color: stage.warning ? 'var(--amber)' : 'var(--ink3)',
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontFamily: 'DM Mono, monospace',
                  }}>
                    {stage.warning && <span>⏱</span>}
                    {stage.etaLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer tip */}
      <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--raised)' }}>
        <p style={{ fontSize: 11, color: 'var(--ink3)', lineHeight: 1.5 }}>
          💡 You can review and edit each asset as it appears. Video renders run in the background — the page will update automatically.
        </p>
      </div>
    </div>
  );
}

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

interface BudgetTierCard {
  rangeLabel: string;
  name: string;
  channels: string[];
  lockedChannels?: string[];
  planRequiredForLocked?: string;
  projectedInstalls: string;
  projectedInstallsWithPlan?: string;
}

interface BudgetReality {
  currentTier: 'seed' | 'growth' | 'scale';
  currentMonthlyUSD: number;
  assessment: string;
  seed: BudgetTierCard;
  growth: BudgetTierCard;
  scale: BudgetTierCard;
}

interface Strategy {
  thirtyDay: ChannelPlan[];
  sixtyDay: ChannelPlan[];
  ninetyDay: ChannelPlan[];
  usa: MarketStrategy;
  india: MarketStrategy;
  executiveSummary: string;
  generatedAt: string;
  budgetReality?: BudgetReality;
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
  const [applyingBudget, setApplyingBudget] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState('');
  const [isPremium, setIsPremium] = useState(false);
  const [copied, setCopied] = useState('');
  const [plan, setPlan] = useState('free');
  const [showTopUpDialog, setShowTopUpDialog] = useState(false);

  // Content assets (from content_assets table — video, voice, text)
  const [contentAssets, setContentAssets] = useState<ContentAsset[]>([]);
  const [contentAssetsLoading, setContentAssetsLoading] = useState(false);
  const [generatingContent, setGeneratingContent] = useState(false);
  const tokenRef = useRef('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoContentPolled = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
        // Fetch plan
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/billing/subscription`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        }).then(r => r.ok ? r.json() : null).then(sub => { if (sub?.plan) setPlan(sub.plan); });
      }
    });
  }, []);

  useEffect(() => {
    const indiaEnabled = (plan === 'builder' || plan === 'studio') && (product?.markets ?? []).includes('india');
    if (!indiaEnabled && market === 'india') {
      setMarket('usa');
    }
  }, [plan, product, market]);

  useEffect(() => {
    if (!token) return;
    api.products.get(params.id, token)
      .then(setProduct)
      .catch(() => router.push('/dashboard/products'));
  }, [token, params.id, router]);

  useEffect(() => {
    if (!token) return;
    api.products.getStrategy(params.id, token)
      .then((data) => {
        if (data.fullStrategy) {
          setStrategy(data.fullStrategy as unknown as Strategy);
          setIsPremium(true);
        }
      })
      .catch(() => {});
  }, [token, params.id]);

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const freshToken = session?.access_token;
      if (!freshToken) { setError('Session expired — please refresh'); setGenerating(false); return; }

      const data = await api.products.generateStrategy(params.id, freshToken);
      setStrategy(data as unknown as Strategy);
      setIsPremium(true);
      const channelCount = [
        ...((data.thirtyDay as unknown[]) ?? []),
        ...((data.sixtyDay as unknown[]) ?? []),
        ...((data.ninetyDay as unknown[]) ?? []),
      ].length;
      trackOnboarding('strategy_generated', { channel_count: channelCount });
      // Backend fire-and-forget content pipeline started — auto-poll so the UI updates when done
      startContentPolling();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) { setShowTopUpDialog(true); return; }
      setError(err instanceof ApiError ? err.message : 'Strategy generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleApplyBudget(budgetOverride: string) {
    setError('');
    setApplyingBudget(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const freshToken = session?.access_token;
      if (!freshToken) { setError('Session expired — please refresh'); return; }
      const data = await api.products.generateStrategy(params.id, freshToken, { budgetOverride });
      setStrategy(data as unknown as Strategy);
      startContentPolling();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) { setShowTopUpDialog(true); return; }
      setError(err instanceof ApiError ? err.message : 'Failed to apply budget — please retry');
    } finally {
      setApplyingBudget(false);
    }
  }

  const handleLoadAssets = useCallback(async (channel: string) => {
    setLoadingAssets(true);
    setActiveChannel(channel);
    setAssets(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const freshToken = session?.access_token ?? token;
      const data = await api.products.generateAssets(params.id, channel, market, freshToken);
      setAssets(data as unknown as ContentAssets);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) { setShowTopUpDialog(true); return; }
      setError('Failed to generate assets — retry');
    } finally {
      setLoadingAssets(false);
    }
  }, [token, params.id, market, supabase]);

  // ── Content assets (video, voice, text from content_assets table) ──────────

  const loadContentAssets = useCallback(async (freshToken?: string) => {
    const tok = freshToken ?? tokenRef.current;
    if (!tok) return;
    setContentAssetsLoading(true);
    try {
      const { assets: data } = await api.contentAssets.list(params.id, tok, { limit: 100 });
      setContentAssets(data);
    } catch { /* silent — table may not have rows yet */ } finally {
      setContentAssetsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (!token) return;
    tokenRef.current = token;
    loadContentAssets(token);
  }, [token, loadContentAssets]);

  // Silent background poll — checks every 6s if a BullMQ content job completed while
  // the user had the page open. Does NOT set generatingContent=true, so the checklist
  // spinner and timer never appear for background work the user didn't explicitly trigger.
  // The checklist only shows when the user clicks "Regenerate strategy" or "Generate content".
  useEffect(() => {
    if (!strategy || !token || autoContentPolled.current) return;
    if (contentAssets.length > 0 || contentAssetsLoading || generatingContent) return;
    autoContentPolled.current = true;

    const check = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const tok = session?.access_token ?? tokenRef.current;
      if (session?.access_token) tokenRef.current = session.access_token;
      const { assets: data } = await api.contentAssets.list(params.id, tok, { limit: 1 }).catch(() => ({ assets: [] as ContentAsset[] }));
      if (data.length > 0) {
        clearInterval(check);
        loadContentAssets(tok);
      }
    }, 6000);

    // Stop after 10 minutes — if nothing appeared, user can click "Generate content"
    const cap = setTimeout(() => clearInterval(check), 600_000);
    return () => { clearInterval(check); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, contentAssets.length, contentAssetsLoading, generatingContent, token]);

  // Poll every 15 s while a video/voice render is in progress
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasRendering = contentAssets.some(
      (a) => a.status === 'pending' && a.render_started_at && !a.media_url
    );
    if (!hasRendering) return;
    pollRef.current = setInterval(() => loadContentAssets(), 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [contentAssets, loadContentAssets]);

  // Called when the owner clicks "Render this →" on a concept card
  function handleRenderStarted(assetId: string) {
    setContentAssets((prev) => prev.map((a) =>
      a.id === assetId
        ? { ...a, status: 'pending' as const, render_started_at: new Date().toISOString() }
        : a
    ));
  }

  async function handleApproveAsset(id: string) {
    await api.contentAssets.approve(id, tokenRef.current);
    setContentAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: 'approved' } : a));
  }

  async function handleHoldAsset(id: string) {
    await api.contentAssets.hold(id, tokenRef.current);
    setContentAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: 'held' } : a));
  }

  async function handleRegenAsset(id: string, reason: string, note?: string) {
    await api.contentAssets.regenerate(id, tokenRef.current, reason, note);
    setContentAssets((prev) => prev.map((a) => a.id === id ? { ...a, regen_count: a.regen_count + 1 } : a));
    setTimeout(() => loadContentAssets(), 3000);
  }

  async function handleGenerateImage(assetId: string, style?: 'photorealistic' | 'graphic' | 'mockup') {
    const { data: { session } } = await supabase.auth.getSession();
    const tok = session?.access_token ?? tokenRef.current;
    await api.contentAssets.generateImage(assetId, tok, style);
    // Mark render started locally for immediate UI feedback
    setContentAssets((prev) => prev.map((a) =>
      a.id === assetId ? { ...a, render_started_at: new Date().toISOString() } : a
    ));
    // Poll every 5s for up to 2 min until media_url appears
    const imageCheck = setInterval(async () => {
      const { data: { session: s } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const t = s?.access_token ?? tokenRef.current;
      const result = await api.contentAssets.list(params.id, t, { limit: 50 }).catch(() => null);
      if (result) {
        const updated = result.assets.find((a) => a.id === assetId);
        if (updated?.media_url) {
          clearInterval(imageCheck);
          setContentAssets((prev) => prev.map((a) => a.id === assetId ? updated : a));
        }
      }
    }, 5000);
    setTimeout(() => clearInterval(imageCheck), 120_000);
  }

  // Polls every 6 s until at least one content asset appears, then loads all assets.
  // Called both after manual "Generate all content" and automatically after strategy generation
  // (since the backend fire-and-forget content pipeline starts immediately after strategy returns).
  // Each tick refreshes the session token so polls don't fail after JWT expiry (15 min).
  // baseline = number of assets already in DB before this generation run.
  // Poll stops only when total exceeds baseline — prevents stopping early on pre-existing assets.
  function startContentPolling(baseline = 0) {
    setGeneratingContent(true);
    const check = setInterval(async () => {
      // Always get a fresh token — tokenRef.current expires after 15 min
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const tok = session?.access_token ?? tokenRef.current;
      if (session?.access_token) tokenRef.current = session.access_token;
      const result = await api.contentAssets.list(params.id, tok, { limit: 1 }).catch(() => ({ assets: [] as ContentAsset[], total: baseline }));
      if ((result.total ?? result.assets.length) > baseline) {
        clearInterval(check);
        setGeneratingContent(false);
        loadContentAssets(tok);
      }
    }, 6000);
    // Safety cap — stop after 6 minutes (videos can take 3–4 min to render)
    setTimeout(() => { clearInterval(check); setGeneratingContent(false); }, 360_000);
  }

  async function handleGenerateContent(force = false) {
    setGeneratingContent(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? tokenRef.current;
      const baseline = force ? 0 : contentAssets.length;
      if (force) setContentAssets([]);
      const result = await api.contentAssets.generate(params.id, tok, force);
      // 200 all_done = nothing was missing, no background work started — stop immediately
      if (result.message === 'all_done') {
        setGeneratingContent(false);
        loadContentAssets(tok);
        return;
      }
      // 202 = generation in progress — start polling for new assets
      startContentPolling(baseline);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        startContentPolling(0);
      } else {
        setGeneratingContent(false);
      }
    }
  }

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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Insufficient tokens dialog */}
      {showTopUpDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }} onClick={() => setShowTopUpDialog(false)}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '28px 32px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          }} onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-bold" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 8 }}>
              Out of tokens
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
              Strategy generation requires tokens. Your balance is too low to proceed.
              Buy a token pack to continue — top-ups are one-time and never expire.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <a href="/dashboard/billing"
                style={{
                  flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 6, textDecoration: 'none',
                  background: 'var(--sage)', color: '#fff',
                }}>
                Buy tokens →
              </a>
              <button onClick={() => setShowTopUpDialog(false)}
                style={{
                  fontSize: 13, padding: '9px 16px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--ink2)',
                }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 8 }}>
          {strategy && (
            <button
              onClick={handleGenerate}
              disabled={generating || applyingBudget || !token}
              className="rounded-[6px] px-4 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
              style={{ border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--ink2)', fontSize: 13 }}
            >
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
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

          {/* Budget Reality Check */}
          {strategy.budgetReality && (
            <BudgetRealityCard
              budgetReality={strategy.budgetReality}
              plan={plan}
              onApplyBudget={handleApplyBudget}
              applying={applyingBudget}
            />
          )}

          {/* Playbook insights */}
          <div style={{ background: 'var(--indigo-d)', border: '1.5px solid var(--indigo-b)', borderRadius: 10, padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ fontSize: 13 }}>✦</span>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo)' }}>Playbook insights</p>
              {(plan === 'builder' || plan === 'studio') && (
                <span style={{ fontSize: 10, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>
                  From 52 similar apps
                </span>
              )}
            </div>
            {(plan === 'builder' || plan === 'studio') ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {strategy.thirtyDay.slice(0, 3).map((cp, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--ink2)', display: 'flex', gap: 6 }}>
                    <span style={{ color: 'var(--indigo)', flexShrink: 0 }}>•</span>
                    <span>
                      <span style={{ textTransform: 'capitalize' }}>{cp.channel}</span>
                      {' '}{cp.hookType?.replace('_', '-')} hooks —{' '}
                      <span style={{ color: cp.projectedPerformance === 'high' ? 'var(--sage)' : cp.projectedPerformance === 'medium' ? 'var(--amber)' : 'var(--ink3)' }}>
                        {cp.projectedPerformance} potential
                      </span>
                      {' '}· suggested ${cp.suggestedWeeklySpendUSD}/wk
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 16 }}>🔒</span>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--indigo)', fontWeight: 500 }}>Upgrade to Builder for playbook insights</p>
                  <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>See which channels + hooks are working for similar apps.</p>
                </div>
                <a href="/pricing" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--indigo)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>Upgrade →</a>
              </div>
            )}
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
              {(['usa', ...(
                (plan === 'builder' || plan === 'studio') && (product?.markets ?? []).includes('india')
                  ? ['india']
                  : []
              )] as Market[]).map((m) => (
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

          {/* ── Generated content assets (video, voice, text) ───────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
                Generated content
              </h3>
              {!generatingContent && (() => {
                // Which stages are missing? Concepts count as done (script exists, just not rendered)
                const doneTypes = new Set(contentAssets.map((a) => a.asset_type));
                const missingCount = CONTENT_STAGES.filter((s) => !s.types.some((t) => doneTypes.has(t as ContentAsset['asset_type']))).length;
                const allDone = missingCount === 0 && contentAssets.length > 0;
                const someExist = contentAssets.length > 0 && !allDone;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Primary: generate missing or first-time */}
                    {!allDone && (
                      <button
                        onClick={() => handleGenerateContent(false)}
                        disabled={contentAssetsLoading}
                        className="rounded-[6px] px-3 py-1.5 font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ fontSize: 12, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
                      >
                        {someExist ? `✦ Generate remaining (${missingCount})` : '✦ Generate content'}
                      </button>
                    )}
                    {/* Secondary: regenerate everything (always available if any content exists) */}
                    {contentAssets.length > 0 && (
                      <button
                        onClick={() => handleGenerateContent(true)}
                        disabled={contentAssetsLoading}
                        className="rounded-[6px] px-3 py-1.5 font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ fontSize: 12, color: 'var(--ink2)', border: '1px solid var(--border2)' }}
                      >
                        ↺ Regenerate all
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Checklist — always visible when generating OR assets exist */}
            {(generatingContent || contentAssets.length > 0) && (
              <ContentGeneratingChecklist
                contentAssets={contentAssets}
                isActive={generatingContent}
              />
            )}

            {/* Empty state — only before first generation */}
            {!generatingContent && contentAssets.length === 0 && !contentAssetsLoading && (
              <div className="rounded-[10px] p-6 text-center mt-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="font-medium mb-1" style={{ fontSize: 13, color: 'var(--ink)' }}>No content generated yet</p>
                <p style={{ fontSize: 12, color: 'var(--ink2)' }}>
                  Click <strong>Generate content</strong> above to create ads, emails, videos and more across all your channels.
                </p>
              </div>
            )}

            {/* Loading state */}
            {contentAssetsLoading && contentAssets.length === 0 && (
              <div className="rounded-[10px] p-8 text-center mt-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading content assets…</p>
              </div>
            )}

            {/* Asset grid — shown below checklist as stages complete */}
            {contentAssets.length > 0 && (() => {
              const videoConcepts = contentAssets.filter((a) => a.status === 'concept');
              const regularAssets = contentAssets.filter((a) => a.status !== 'concept');
              return (
                <div className="space-y-6 mt-4">
                  {videoConcepts.length > 0 && (
                    <VideoConceptPicker
                      concepts={videoConcepts}
                      token={tokenRef.current}
                      onRenderStarted={handleRenderStarted}
                    />
                  )}
                  {CHANNEL_ORDER.map((channel) => {
                    const grouped = groupAssetsByChannel(regularAssets);
                    const channelAssets = grouped[channel];
                    if (!channelAssets?.length) return null;
                    return (
                      <div key={channel}>
                        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                          {channel}
                        </p>
                        <div className="space-y-3">
                          {channelAssets.map((asset) => (
                            <AssetBlock
                              key={asset.id}
                              asset={asset}
                              onApprove={handleApproveAsset}
                              onHold={handleHoldAsset}
                              onRegen={handleRegenAsset}
                              onGenerateImage={handleGenerateImage}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

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
