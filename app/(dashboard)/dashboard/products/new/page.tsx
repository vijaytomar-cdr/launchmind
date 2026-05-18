/**
 * @file app/(dashboard)/dashboard/products/new/page.tsx
 * @description Discover step: founder pastes a store URL → scrape → ICP brief → confirm.
 *   Step 1: URL input with platform auto-detection badge (App Store vs Play Store)
 *   Step 2: Scraping loading state with step indicators
 *   Step 3: Editable ICP brief card + collapsible competitor cards
 *   Step 4: Confirm → POST /products/confirm → redirect to /dashboard/products/:id
 *   Free tier plan-limit error surfaces inline (422 from API, not just UI gate).
 * @security Auth token fetched client-side from Supabase session. Never stored in localStorage.
 *   All confirm logic runs server-side via the Fastify API.
 * @dependencies lib/api, lib/supabase/client, next/navigation
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { ScrapeResult, ICPBrief, CompetitorApp } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';

type Step = 'url-input' | 'scraping' | 'review' | 'saving';

const SCRAPE_STEPS = [
  'Connecting to store…',
  'Reading app metadata…',
  'Analysing reviews…',
  'Identifying competitors…',
  'Building ICP brief…',
];

function detectPlatformFromUrl(url: string): 'app_store' | 'play_store' | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('apps.apple.com')) return 'app_store';
    if (parsed.hostname.includes('play.google.com')) return 'play_store';
    return null;
  } catch {
    return null;
  }
}

export default function NewProductPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>('url-input');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<'app_store' | 'play_store' | null>(null);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [icp, setIcp] = useState<ICPBrief | null>(null);
  const [scrapeStep, setScrapeStep] = useState(0);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setToken(data.session.access_token);
    });
  }, []);

  useEffect(() => {
    setPlatform(detectPlatformFromUrl(url));
  }, [url]);

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStep('scraping');

    const interval = setInterval(() => {
      setScrapeStep((s) => Math.min(s + 1, SCRAPE_STEPS.length - 1));
    }, 3000);

    try {
      const result = await api.products.scrape(url, token);
      setScrapeResult(result);
      setIcp(result.icpBrief);
      setStep('review');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Scrape failed — try again');
      setStep('url-input');
    } finally {
      clearInterval(interval);
      setScrapeStep(0);
    }
  }

  async function handleConfirm() {
    if (!scrapeResult || !icp) return;
    setError('');
    setStep('saving');

    try {
      const product = await api.products.confirm(
        {
          url,
          platform: platform ?? 'play_store',
          scraped: scrapeResult.scraped,
          icpBrief: icp,
          competitors: scrapeResult.competitors,
        },
        token
      );
      trackOnboarding('icp_confirmed');
      router.push(`/dashboard/products/${product.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save product — try again'
      );
      setStep('review');
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Add a product
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Paste your App Store or Play Store URL to generate an ICP brief.
        </p>
      </div>

      {step === 'url-input' && (
        <form onSubmit={handleScrape} className="space-y-4">
          <div>
            <label className="block mb-1.5 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
              Store URL
            </label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://play.google.com/store/apps/details?id=…"
                  className="autofill-light w-full rounded-[6px] px-4 py-2.5 outline-none pr-32"
                  style={{
                    background: 'var(--raised)',
                    border: '1px solid var(--border2)',
                    color: 'var(--ink)',
                    fontSize: 13,
                  }}
                />
                {platform && (
                  <span
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 font-medium"
                    style={{
                      fontSize: 11,
                      background: platform === 'app_store' ? 'var(--indigo-d)' : 'var(--sage-d)',
                      color: platform === 'app_store' ? 'var(--indigo)' : 'var(--sage)',
                    }}
                  >
                    {platform === 'app_store' ? 'App Store' : 'Play Store'}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={!platform}
                className="rounded-[6px] px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90 whitespace-nowrap"
                style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
              >
                Analyse app
              </button>
            </div>
            {url && !platform && (
              <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>
                Only App Store and Play Store URLs are supported
              </p>
            )}
          </div>
          {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}
        </form>
      )}

      {step === 'scraping' && (
        <div
          className="rounded-[10px] p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-6"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
          <h3 className="font-semibold mb-6" style={{ fontSize: 15, color: 'var(--ink)' }}>
            Analysing your app
          </h3>
          <div className="space-y-3 text-left max-w-xs mx-auto">
            {SCRAPE_STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-3">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: i < scrapeStep ? 'var(--sage)' : 'transparent',
                    border: i < scrapeStep ? 'none' : i === scrapeStep ? '2px solid var(--sage)' : '1px solid var(--border2)',
                  }}
                >
                  {i < scrapeStep && (
                    <svg style={{ width: 10, height: 10, color: '#fff' }} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 13, color: i <= scrapeStep ? 'var(--ink)' : 'var(--ink3)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'review' && scrapeResult && icp && (
        <div className="space-y-6">
          <div
            className="rounded-[10px] p-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start gap-4 mb-6">
              <div>
                <h2 className="font-display font-semibold" style={{ fontSize: 18, color: 'var(--ink)' }}>
                  {scrapeResult.scraped.name}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
                  {scrapeResult.scraped.developer} ·{' '}
                  <span style={{ color: 'var(--sage)' }}>{scrapeResult.scraped.category}</span>
                </p>
                <div className="flex items-center gap-4 mt-2" style={{ fontSize: 12, color: 'var(--ink3)' }}>
                  <span>★ {scrapeResult.scraped.rating.toFixed(1)}</span>
                  <span>{scrapeResult.scraped.ratingCount.toLocaleString()} ratings</span>
                  <span
                    className="rounded-full px-2 py-0.5 font-medium"
                    style={{
                      fontSize: 11,
                      background: platform === 'app_store' ? 'var(--indigo-d)' : 'var(--sage-d)',
                      color: platform === 'app_store' ? 'var(--indigo)' : 'var(--sage)',
                    }}
                  >
                    {platform === 'app_store' ? 'App Store' : 'Play Store'}
                  </span>
                </div>
              </div>
            </div>

            <h3 className="font-semibold mb-4" style={{ fontSize: 12, color: 'var(--ink2)' }}>
              ICP Brief <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(edit as needed)</span>
            </h3>

            <div className="space-y-4">
              <Field label="Target user" value={icp.targetUser} onChange={(v) => setIcp({ ...icp, targetUser: v })} />
              <Field label="Price tier" value={icp.priceTier} onChange={(v) => setIcp({ ...icp, priceTier: v })} />
              <TagList
                label="Suggested markets"
                items={icp.suggestedMarkets}
                getStyle={(m) => ({
                  background: m === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
                  color: m === 'india' ? 'var(--amber)' : 'var(--sage)',
                })}
              />
              <EditableList label="Pain points" items={icp.painPoints} onChange={(items) => setIcp({ ...icp, painPoints: items })} />
              <EditableList label="Competitor gaps" items={icp.competitorGaps} onChange={(items) => setIcp({ ...icp, competitorGaps: items })} />
            </div>
          </div>

          {scrapeResult.competitors.length > 0 && (
            <CompetitorSection competitors={scrapeResult.competitors} />
          )}

          {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('url-input'); setScrapeResult(null); setIcp(null); }}
              className="rounded-[6px] px-4 py-2.5 transition-opacity hover:opacity-80"
              style={{ fontSize: 13, color: 'var(--ink2)', border: '1px solid var(--border2)' }}
            >
              Start over
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 rounded-[6px] px-4 py-2.5 font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
            >
              Confirm &amp; save product →
            </button>
          </div>
        </div>
      )}

      {step === 'saving' && (
        <div
          className="rounded-[10px] p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
          <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
            Saving your product…
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block mb-1 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[6px] px-3 py-2 outline-none"
        style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
      />
    </div>
  );
}

function TagList({
  label,
  items,
  getStyle,
}: {
  label: string;
  items: string[];
  getStyle: (item: string) => React.CSSProperties;
}) {
  return (
    <div>
      <p className="mb-1 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full px-2.5 py-1 font-medium"
            style={{ fontSize: 11, ...getStyle(item) }}
          >
            {item === 'usa' ? '🇺🇸 USA' : '🇮🇳 India'}
          </span>
        ))}
      </div>
    </div>
  );
}

function EditableList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-2 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>{label}</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-[6px] px-3 py-1.5 outline-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="px-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--ink3)', fontSize: 13 }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="hover:underline"
          style={{ fontSize: 12, color: 'var(--sage)' }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function CompetitorSection({ competitors }: { competitors: CompetitorApp[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 font-medium transition-colors"
        style={{ fontSize: 13, color: 'var(--ink)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--raised)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span>Competitors ({competitors.length})</span>
        <span style={{ color: 'var(--ink3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-6 pb-4 space-y-3">
          {competitors.map((c, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}
            >
              <div>
                <p className="font-medium" style={{ fontSize: 13, color: 'var(--ink)' }}>{c.name}</p>
                <p style={{ fontSize: 12, color: 'var(--ink2)' }}>{c.developer}</p>
              </div>
              <div className="text-right">
                <p style={{ fontSize: 13, color: 'var(--ink)' }}>★ {c.rating.toFixed(1)}</p>
                <p style={{ fontSize: 12, color: 'var(--ink3)' }}>{c.priceTier}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
