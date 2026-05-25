/**
 * @file app/(dashboard)/dashboard/products/new/page.tsx
 * @description Discover step: founder pastes a store URL → scrape → saves to sessionStorage → redirect to confirm.
 *   Step 1: URL input with platform auto-detection badge (App Store vs Play Store)
 *   Step 2: Scraping loading state with animated step indicators
 *   After scrape: data saved to sessionStorage, redirects to /dashboard/products/new/confirm
 * @security Auth token fetched client-side from Supabase session. Never stored in localStorage.
 *   Scrape result is never persisted to DB until founder confirms on /confirm page.
 * @dependencies lib/api, lib/supabase/client, next/navigation
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';

type Step = 'url-input' | 'scraping';

const SCRAPE_STEPS = [
  'Connecting to store…',
  'Reading app metadata…',
  'Analysing reviews…',
  'Identifying competitors…',
  'Building ICP brief…',
];

const EXTRACT_CHECKLIST = [
  'App name, category & price tier',
  'Developer & release history',
  'Star rating & review sentiment',
  'Pain points from 1-2★ reviews',
  'Target user persona (ICP)',
  'Top 5 competitors + gaps',
  'Suggested markets (USA / India)',
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

const STEPS = ['Enter URL', 'Analyse', 'Confirm ICP', 'Generate strategy'];

export default function NewProductPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>('url-input');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<'app_store' | 'play_store' | null>(null);
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
      sessionStorage.setItem('lm_scrape', JSON.stringify({
        url,
        platform: platform ?? 'play_store',
        scraped: result.scraped,
        icpBrief: result.icpBrief,
        competitors: result.competitors,
      }));
      router.push('/dashboard/products/new/confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Scrape failed — try again');
      setStep('url-input');
    } finally {
      clearInterval(interval);
      setScrapeStep(0);
    }
  }

  const activeStepIndex = step === 'url-input' ? 0 : 1;

  return (
    <div className="p-8 max-w-3xl">
      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{
                  background: i < activeStepIndex ? 'var(--sage)' : i === activeStepIndex ? 'var(--sage)' : 'var(--raised)',
                  color: i <= activeStepIndex ? '#fff' : 'var(--ink3)',
                  border: i <= activeStepIndex ? 'none' : '1px solid var(--border2)',
                }}
              >
                {i < activeStepIndex ? (
                  <svg width="10" height="10" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (i + 1)}
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: i === activeStepIndex ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: i === activeStepIndex ? 500 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="mx-3"
                style={{
                  width: 24,
                  height: 1,
                  background: i < activeStepIndex ? 'var(--sage)' : 'var(--border2)',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Add a product
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Paste your App Store or Play Store URL to generate an ICP brief.
        </p>
      </div>

      {step === 'url-input' && (
        <div className="space-y-6">
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
                  disabled={!platform || !token}
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

          {/* What LaunchMind extracts */}
          <div
            className="rounded-[10px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p className="font-semibold mb-3" style={{ fontSize: 12, color: 'var(--ink2)' }}>
              What LaunchMind extracts
            </p>
            <ul className="space-y-2">
              {EXTRACT_CHECKLIST.map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <div
                    className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--sage-d)' }}
                  >
                    <svg width="8" height="8" fill="none" stroke="var(--sage)" strokeWidth="2" viewBox="0 0 12 12">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                    </svg>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
    </div>
  );
}
