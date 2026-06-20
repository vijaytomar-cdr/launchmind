'use client';
/**
 * @file markets/page.tsx — Step 6: Markets + channel selection
 * @description Founder picks target markets (multi) and a Week 1 primary channel (single).
 *   Amber warning shown if selected channel was previously tried and failed.
 *   Sage tip shown if peak season is within 8 weeks.
 *   Stores { selectedMarkets, primaryChannel, excludedChannels } in sessionStorage.
 * @security productId from sessionStorage.
 * @dependencies lib/types/intake, next/navigation
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE, type FounderContext } from '@/lib/types/intake';

interface MarketOption {
  id: string;
  flag: string;
  label: string;
  sublabel: string;
}

const MARKETS: MarketOption[] = [
  { id: 'usa',       flag: '🇺🇸', label: 'USA',        sublabel: 'English · Stripe · USD' },
  { id: 'india',     flag: '🇮🇳', label: 'India',      sublabel: 'English/Hindi · Razorpay · INR' },
  { id: 'se_asia',   flag: '🇸🇬', label: 'SE Asia',    sublabel: 'English · Regional PSPs' },
  { id: 'uk',        flag: '🇬🇧', label: 'UK',         sublabel: 'English · Stripe · GBP' },
];

interface ChannelOption {
  id: string;
  label: string;
  icon: string;
  cpiEstimates: Record<string, string>; // market → CPI string
}

const CHANNELS: ChannelOption[] = [
  {
    id: 'meta',
    label: 'Meta (Facebook / Instagram)',
    icon: '◈',
    cpiEstimates: { usa: '$2.50–4.00', india: '₹28–55', se_asia: '$1.20–2.50', uk: '£2.00–3.50' },
  },
  {
    id: 'google',
    label: 'Google UAC',
    icon: '◉',
    cpiEstimates: { usa: '$1.80–3.50', india: '₹22–45', se_asia: '$0.90–2.00', uk: '£1.50–3.00' },
  },
  {
    id: 'aso_rewrite',
    label: 'ASO Rewrite',
    icon: '◆',
    cpiEstimates: { usa: 'Organic', india: 'Organic', se_asia: 'Organic', uk: 'Organic' },
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Broadcast',
    icon: '◎',
    cpiEstimates: { usa: '$0.80–1.50', india: '₹8–18', se_asia: '$0.60–1.20', uk: '£0.70–1.30' },
  },
  {
    id: 'email',
    label: 'Email Sequences',
    icon: '◇',
    cpiEstimates: { usa: '$0.50–1.20', india: '₹6–14', se_asia: '$0.40–1.00', uk: '£0.45–1.10' },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Ads',
    icon: '▣',
    cpiEstimates: { usa: '$5.00–9.00', india: '₹80–140', se_asia: '$3.50–7.00', uk: '£4.50–8.00' },
  },
];

const PEAK_SEASON_LABELS: Record<string, string> = {
  q4_holiday:  'Q4 holiday (Oct–Dec)',
  summer:      'Summer (Jun–Aug)',
  new_year:    'New Year (Jan)',
  back_school: 'Back to school (Aug–Sep)',
  diwali:      'Diwali (Oct–Nov)',
  valentines:  'Valentine\'s Day (Feb)',
};

function weeksUntilPeakSeason(peak: string | undefined): number | null {
  if (!peak) return null;
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const ranges: Record<string, [number, number]> = {
    q4_holiday:  [9, 11],
    summer:      [5, 7],
    new_year:    [0, 0],
    back_school: [7, 8],
    diwali:      [9, 10],
    valentines:  [1, 1],
  };
  const range = ranges[peak];
  if (!range) return null;
  const [startM] = range;
  let monthsAway = startM - month;
  if (monthsAway < 0) monthsAway += 12;
  return Math.round(monthsAway * 4.33);
}

export default function MarketsPage() {
  const router = useRouter();

  const [productId, setProductId] = useState('');
  const [context, setContext]     = useState<FounderContext | null>(null);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['usa']);
  const [primaryChannel, setPrimaryChannel]   = useState('');
  const [excludedChannels, setExcludedChannels] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    const pid = sessionStorage.getItem(INTAKE_STORAGE.productId);
    if (!pid) { router.replace('/dashboard/products/new'); return; }
    setProductId(pid);

    const ctxRaw = sessionStorage.getItem(INTAKE_STORAGE.context);
    if (ctxRaw) {
      try { setContext(JSON.parse(ctxRaw)); } catch { /* ignore */ }
    }

    // Restore selections (saved either on Continue or by the auto-save effect below)
    const mktRaw = sessionStorage.getItem(INTAKE_STORAGE.markets);
    if (mktRaw) {
      try {
        const saved = JSON.parse(mktRaw);
        if (saved.selectedMarkets) setSelectedMarkets(saved.selectedMarkets);
        if (saved.primaryChannel)  setPrimaryChannel(saved.primaryChannel);
        if (saved.excludedChannels) setExcludedChannels(saved.excludedChannels);
      } catch { /* ignore */ }
    }
    loadedRef.current = true;
  }, [router]);

  // Auto-save whenever selections change (after initial load), so refresh restores state
  useEffect(() => {
    if (!loadedRef.current) return;
    sessionStorage.setItem(
      INTAKE_STORAGE.markets,
      JSON.stringify({ selectedMarkets, primaryChannel, excludedChannels })
    );
  }, [selectedMarkets, primaryChannel, excludedChannels]);

  function toggleMarket(id: string) {
    setSelectedMarkets((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((m) => m !== id) : prev) : [...prev, id]
    );
  }

  function pickChannel(id: string) {
    setPrimaryChannel(id);
    // Mark other channels as excluded (not the newly selected one)
    setExcludedChannels(CHANNELS.filter((c) => c.id !== id).map((c) => c.id));
  }

  function handleContinue() {
    sessionStorage.setItem(
      INTAKE_STORAGE.markets,
      JSON.stringify({ selectedMarkets, primaryChannel, excludedChannels })
    );
    router.push('/dashboard/products/new/confirm');
  }

  const triedChannels = context?.channelsTried ?? [];
  const primaryIsTried = primaryChannel ? triedChannels.includes(primaryChannel) : false;
  const weeksAway = weeksUntilPeakSeason(context?.peakSeason);
  const showPeakTip = weeksAway !== null && weeksAway <= 8;

  // CPI label for a channel in the first selected market
  function cpiLabel(channel: ChannelOption): string {
    const market = selectedMarkets[0] ?? 'usa';
    return channel.cpiEstimates[market] ?? '—';
  }

  return (
    <div>
      <IntakeSteps currentStep="markets" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Where do your users live?
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Pick markets and your Week 1 growth channel. Start focused — you can expand later.
        </p>
      </div>

      {/* Market selection */}
      <div
        className="rounded-[10px] p-5 mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="font-semibold mb-3" style={{ fontSize: 13, color: 'var(--ink)' }}>
          Target markets
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink3)', marginLeft: 8 }}>
            select all that apply
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MARKETS.map((m) => {
            const active = selectedMarkets.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMarket(m.id)}
                className="rounded-[8px] p-3 text-left transition-all"
                style={{
                  background: active ? 'var(--sage-d)' : 'var(--raised)',
                  border: `1px solid ${active ? 'var(--sage-b)' : 'var(--border2)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 18 }}>{m.flag}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 500, color: active ? 'var(--sage)' : 'var(--ink)' }}>
                      {m.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>{m.sublabel}</p>
                  </div>
                  {active && (
                    <span style={{ marginLeft: 'auto', color: 'var(--sage)', fontSize: 14, fontWeight: 700 }}>✓</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Channel selection */}
      <div
        className="rounded-[10px] p-5 mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="font-semibold mb-1" style={{ fontSize: 13, color: 'var(--ink)' }}>
          Week 1 primary channel
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12 }}>
          Pick ONE. Estimated CPI based on your first target market.
        </p>
        <div className="space-y-2">
          {CHANNELS.map((ch) => {
            const isActive  = primaryChannel === ch.id;
            const isTried   = triedChannels.includes(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => pickChannel(ch.id)}
                className="w-full rounded-[8px] px-4 py-3 flex items-center justify-between text-left transition-all"
                style={{
                  background: isActive ? 'var(--sage-d)' : isTried ? 'var(--amber-d)' : 'var(--raised)',
                  border: `1px solid ${isActive ? 'var(--sage-b)' : isTried ? 'var(--amber-b)' : 'var(--border2)'}`,
                }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 16, color: isActive ? 'var(--sage)' : isTried ? 'var(--amber)' : 'var(--ink3)' }}>
                    {ch.icon}
                  </span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--sage)' : 'var(--ink)' }}>
                      {ch.label}
                    </p>
                    {isTried && !isActive && (
                      <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 1 }}>
                        Tried before — amber flag applied
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className="rounded-full px-2.5 py-0.5 font-mono"
                    style={{
                      fontSize: 11,
                      background: isActive ? 'var(--sage)' : 'var(--raised)',
                      color: isActive ? '#fff' : 'var(--ink2)',
                      border: isActive ? 'none' : '1px solid var(--border2)',
                    }}
                  >
                    ~{cpiLabel(ch)} CPI
                  </span>
                  {isActive && (
                    <span style={{ color: 'var(--sage)', fontSize: 16, fontWeight: 700 }}>✓</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Amber warning — tried channel selected */}
      {primaryIsTried && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-start gap-3"
          style={{ background: 'var(--amber-d)', border: '1px solid var(--amber-b)' }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)' }}>
              You tried this channel before
            </p>
            <p style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>
              LaunchMind will study what went wrong and build a differentiated playbook — but consider testing a fresh
              channel for faster Week 1 signal.
            </p>
          </div>
        </div>
      )}

      {/* Sage tip — peak season coming */}
      {showPeakTip && context?.peakSeason && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-start gap-3"
          style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)' }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>✦</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--sage)' }}>
              {PEAK_SEASON_LABELS[context.peakSeason] ?? context.peakSeason} is {weeksAway} week{weeksAway !== 1 ? 's' : ''} away
            </p>
            <p style={{ fontSize: 12, color: 'var(--sage)', marginTop: 2 }}>
              Your strategy will front-load creative testing so campaigns are ready to scale into your peak window.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
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
          onClick={handleContinue}
          disabled={!primaryChannel}
          className="rounded-[6px] px-5 py-2.5 font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
