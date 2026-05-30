'use client';
/**
 * @file confirm/page.tsx — Step 7: Intake confirmation summary
 * @description Shows a 3-column summary grid of all founder decisions.
 *   MOAT box in indigo. Strategy preview card with 30/60/90 day hints.
 *   "Generate strategy — 50 tokens →" calls confirmEnriched + POST strategy.
 *   On success: navigates to /dashboard/products/:id/strategy.
 * @security productId from sessionStorage — ownership verified server-side.
 * @dependencies lib/api, lib/supabase/client, lib/types/intake, next/navigation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE, type FounderContext } from '@/lib/types/intake';

interface IcpBrief {
  targetUser: string;
  geography: string[];
  priceTier: string;
  painPoints: string[];
  competitorGaps: string[];
  suggestedMarkets: string[];
}

interface CompetitorEntry {
  name: string;
  developer?: string;
  rating?: number;
  priceTier?: string;
  platform?: string;
  gap?: string;
  topComplaint?: string;
  confirmed: boolean;
}

interface ScrapedMeta {
  name: string;
  developer?: string;
  category?: string;
  rating?: number;
  ratingCount?: number;
  priceTier?: string;
  platform?: string;
}

interface MarketData {
  selectedMarkets: string[];
  primaryChannel: string;
  excludedChannels: string[];
}

const CHANNEL_LABELS: Record<string, string> = {
  meta:        'Meta (Facebook / Instagram)',
  google:      'Google UAC',
  aso_rewrite: 'ASO Rewrite',
  whatsapp:    'WhatsApp Broadcast',
  email:       'Email Sequences',
  linkedin:    'LinkedIn Ads',
};

const MARKET_FLAGS: Record<string, string> = {
  usa:     '🇺🇸 USA',
  india:   '🇮🇳 India',
  se_asia: '🇸🇬 SE Asia',
  uk:      '🇬🇧 UK',
};

export default function ConfirmPage() {
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken]         = useState('');
  const [productId, setProductId] = useState('');
  const [scraped, setScraped]     = useState<ScrapedMeta | null>(null);
  const [icp, setIcp]             = useState<IcpBrief | null>(null);
  const [context, setContext]     = useState<FounderContext | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [markets, setMarkets]     = useState<MarketData | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setToken(data.session.access_token);
    });

    const pid = sessionStorage.getItem(INTAKE_STORAGE.productId);
    if (!pid) { router.replace('/dashboard/products/new'); return; }
    setProductId(pid);

    const srRaw = sessionStorage.getItem(INTAKE_STORAGE.scrapeResult);
    if (srRaw) {
      try { setScraped(JSON.parse(srRaw)?.scraped ?? null); } catch { /* ignore */ }
    }

    const icpRaw = sessionStorage.getItem(INTAKE_STORAGE.editedIcp);
    if (icpRaw) {
      try { setIcp(JSON.parse(icpRaw)); } catch { /* ignore */ }
    }

    const ctxRaw = sessionStorage.getItem(INTAKE_STORAGE.context);
    if (ctxRaw) {
      try { setContext(JSON.parse(ctxRaw)); } catch { /* ignore */ }
    }

    const compRaw = sessionStorage.getItem(INTAKE_STORAGE.competitors);
    if (compRaw) {
      try { setCompetitors(JSON.parse(compRaw)); } catch { /* ignore */ }
    }

    const mktRaw = sessionStorage.getItem(INTAKE_STORAGE.markets);
    if (mktRaw) {
      try { setMarkets(JSON.parse(mktRaw)); } catch { /* ignore */ }
    }
  }, [router]);

  async function handleGenerate() {
    if (!productId || !icp || !token) return;
    setSaving(true);
    setError('');

    try {
      const confirmedComps = competitors.filter((c) => c.confirmed);

      // Step 1: Confirm / update the product record
      const product = await api.products.confirmEnriched(
        {
          productId,
          icpBrief: icp as Parameters<typeof api.products.confirmEnriched>[0]['icpBrief'],
          competitorSet: (confirmedComps as unknown) as Parameters<typeof api.products.confirmEnriched>[0]['competitorSet'],
          selectedMarkets: markets?.selectedMarkets,
          primaryChannel:  markets?.primaryChannel,
          excludedChannels: markets?.excludedChannels,
        },
        token
      );

      // Step 2: Trigger strategy generation
      await api.products.generateStrategy(product.id, token);

      // Clear intake state
      Object.values(INTAKE_STORAGE).forEach((k) => sessionStorage.removeItem(k));

      router.push(`/dashboard/products/${product.id}/strategy`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate strategy — try again');
      setSaving(false);
    }
  }

  if (!icp) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="rounded-full border-2 border-t-transparent animate-spin"
          style={{ width: 32, height: 32, borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  const confirmedComps = competitors.filter((c) => c.confirmed);

  return (
    <div>
      <IntakeSteps currentStep="confirm" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Ready to launch
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Everything looks good. Review the summary and generate your 30/60/90 day strategy.
        </p>
      </div>

      {/* 3-column summary grid */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* ICP */}
        <SummaryCard title="ICP Brief" accent="sage">
          <SummaryRow label="Target user" value={icp.targetUser || '—'} />
          <SummaryRow label="Price tier"  value={icp.priceTier || '—'} />
          {icp.painPoints.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>PAIN POINTS</p>
              {icp.painPoints.slice(0, 3).map((pp, i) => (
                <p key={i} style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 2 }}>· {pp}</p>
              ))}
              {icp.painPoints.length > 3 && (
                <p style={{ fontSize: 11, color: 'var(--ink3)' }}>+{icp.painPoints.length - 3} more</p>
              )}
            </div>
          )}
        </SummaryCard>

        {/* Markets & channels */}
        <SummaryCard title="Markets & Channel" accent="indigo">
          {markets ? (
            <>
              <div>
                <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>MARKETS</p>
                {markets.selectedMarkets.map((m) => (
                  <p key={m} style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 2 }}>
                    {MARKET_FLAGS[m] ?? m}
                  </p>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>WEEK 1 CHANNEL</p>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--indigo)' }}>
                  {CHANNEL_LABELS[markets.primaryChannel] ?? markets.primaryChannel}
                </p>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>Not set</p>
          )}
        </SummaryCard>

        {/* Competitors */}
        <SummaryCard title={`Competitors (${confirmedComps.length})`} accent="amber">
          {confirmedComps.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>None confirmed</p>
          ) : (
            confirmedComps.slice(0, 4).map((c, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{c.name}</p>
                {c.priceTier && (
                  <p style={{ fontSize: 11, color: 'var(--ink3)' }}>{c.priceTier}</p>
                )}
              </div>
            ))
          )}
          {confirmedComps.length > 4 && (
            <p style={{ fontSize: 11, color: 'var(--ink3)' }}>+{confirmedComps.length - 4} more</p>
          )}
        </SummaryCard>
      </div>

      {/* MOAT box */}
      {context?.moat && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-start gap-3"
          style={{ background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)' }}
        >
          <span style={{ fontSize: 16, color: 'var(--indigo)', flexShrink: 0 }}>✦</span>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--indigo)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              Your MOAT
            </p>
            <p style={{ fontSize: 13, color: 'var(--indigo)' }}>{context.moat}</p>
          </div>
        </div>
      )}

      {/* Strategy preview card */}
      <div
        className="rounded-[10px] p-5 mb-6"
        style={{ background: 'var(--surface)', border: '1.5px solid var(--sage-b)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span style={{ fontSize: 14, color: 'var(--sage)' }}>✦</span>
          <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
            Strategy preview — what you're about to get
          </p>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <StrategyPeriod
            period="Week 1–4"
            label="30-day sprint"
            color="var(--sage)"
            items={[
              `Launch ${CHANNEL_LABELS[markets?.primaryChannel ?? ''] || 'primary channel'}`,
              'A/B test 3 hooks from pain points',
              'Set up tracking + UTM links',
            ]}
          />
          <StrategyPeriod
            period="Week 5–8"
            label="60-day scale"
            color="var(--indigo)"
            items={[
              'Double down on winning hook',
              'Expand to second market',
              'Weekly brief + retargeting loop',
            ]}
          />
          <StrategyPeriod
            period="Week 9–13"
            label="90-day growth"
            color="var(--amber)"
            items={[
              'Open second channel',
              'ASO rewrite from learnings',
              'Build seasonal campaign',
            ]}
          />
        </div>
      </div>

      {/* App name banner */}
      {scraped?.name && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-center gap-3"
          style={{ background: 'var(--raised)', border: '1px solid var(--border)' }}
        >
          <div
            className="flex items-center justify-center rounded-[6px] font-semibold flex-shrink-0"
            style={{ width: 36, height: 36, background: 'var(--sage-d)', color: 'var(--sage)', fontSize: 13 }}
          >
            {scraped.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>{scraped.name}</p>
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
              {[scraped.developer, scraped.category, scraped.rating ? `★ ${scraped.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span
              className="rounded-full px-2.5 py-1 font-medium"
              style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
            >
              Ready to generate
            </span>
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{error}</p>
      )}

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={() => router.back()}
          style={{ fontSize: 13, color: 'var(--ink3)' }}
          className="hover:opacity-70 transition-opacity"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={saving || !token}
          className="rounded-[6px] px-6 py-2.5 font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          {saving ? (
            <>
              <span
                className="rounded-full border-2 border-t-transparent animate-spin"
                style={{ display: 'inline-block', width: 14, height: 14, borderColor: '#fff', borderTopColor: 'transparent' }}
              />
              Generating…
            </>
          ) : (
            'Generate strategy — 50 tokens →'
          )}
        </button>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  accent: 'sage' | 'indigo' | 'amber';
  children: React.ReactNode;
}

function SummaryCard({ title, accent, children }: SummaryCardProps) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    sage:   { bg: 'var(--sage-d)',   border: 'var(--sage-b)',   text: 'var(--sage)' },
    indigo: { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', text: 'var(--indigo)' },
    amber:  { bg: 'var(--amber-d)',  border: 'var(--amber-b)',  text: 'var(--amber)' },
  };
  const c = colors[accent];

  return (
    <div
      className="rounded-[10px] p-4"
      style={{ background: 'var(--surface)', border: `1.5px solid ${c.border}` }}
    >
      <p
        className="font-semibold mb-3 pb-2"
        style={{ fontSize: 12, color: c.text, borderBottom: `1px solid ${c.border}` }}
      >
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
        {label}
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink)' }}>{value}</p>
    </div>
  );
}

interface StrategyPeriodProps {
  period: string;
  label: string;
  color: string;
  items: string[];
}

function StrategyPeriod({ period, label, color, items }: StrategyPeriodProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.02em' }}>{period}</p>
          <p style={{ fontSize: 10, color: 'var(--ink3)' }}>{label}</p>
        </div>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 12, color: 'var(--ink2)', paddingLeft: 12, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, color: 'var(--ink3)' }}>·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
