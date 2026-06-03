'use client';
/**
 * @file app/(dashboard)/dashboard/products/new/page.tsx
 * @description Step 1: Multi-URL entry with platform auto-detection.
 *   At least one app store URL required to enable Continue.
 *   On Continue: POST /products/scrape (async) → store productId + jobId in
 *   sessionStorage → navigate to Step 2 (/context).
 * @security Auth token from Supabase session. Never stored outside memory.
 * @dependencies lib/api, lib/supabase/client, lib/types/intake, next/navigation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE } from '@/lib/types/intake';

function detectPlatform(url: string): 'play_store' | 'app_store' | 'website' | null {
  if (url.includes('play.google.com')) return 'play_store';
  if (url.includes('apps.apple.com')) return 'app_store';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'website';
  return null;
}

export default function NewProductPage() {
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken] = useState('');
  const [playStoreUrl, setPlayStoreUrl] = useState('');
  const [appStoreUrl, setAppStoreUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setToken(data.session.access_token);
    });
    // Clear any previous intake state
    Object.values(INTAKE_STORAGE).forEach((k) => sessionStorage.removeItem(k));
  }, []);

  const hasStoreUrl = !!(playStoreUrl.trim() || appStoreUrl.trim());
  const playPlatform = detectPlatform(playStoreUrl);
  const appPlatform  = detectPlatform(appStoreUrl);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!hasStoreUrl) return;
    setError('');
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    const freshToken = session?.access_token;
    if (!freshToken) { setError('Session expired — please refresh the page'); setLoading(false); return; }

    try {
      const result = await api.products.scrapeMulti(
        {
          playStoreUrl: playStoreUrl.trim() || undefined,
          appStoreUrl:  appStoreUrl.trim()  || undefined,
          websiteUrl:   websiteUrl.trim()   || undefined,
        },
        freshToken
      );

      sessionStorage.setItem(INTAKE_STORAGE.productId, result.productId);
      sessionStorage.setItem(INTAKE_STORAGE.jobId,     result.jobId);
      sessionStorage.setItem(INTAKE_STORAGE.urls, JSON.stringify({
        playStoreUrl: playStoreUrl.trim() || undefined,
        appStoreUrl:  appStoreUrl.trim()  || undefined,
        websiteUrl:   websiteUrl.trim()   || undefined,
      }));

      router.push('/dashboard/products/new/context');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start analysis — try again');
      setLoading(false);
    }
  }

  return (
    <div>
      <IntakeSteps currentStep="urls" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Where is your app?
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Add any URLs you have — all optional. LaunchMind works with one but gets smarter with more.
        </p>
      </div>

      <form onSubmit={handleContinue} className="space-y-4">
        {/* Play Store */}
        <UrlSlot
          label="Play Store"
          icon="▶"
          iconColor="var(--sage)"
          placeholder="https://play.google.com/store/apps/details?id=…"
          value={playStoreUrl}
          onChange={setPlayStoreUrl}
          detected={playPlatform === 'play_store' ? 'Play Store detected' : playStoreUrl ? 'Not a Play Store URL' : undefined}
          detectedOk={playPlatform === 'play_store'}
          borderColor={playPlatform === 'play_store' ? 'var(--sage-b)' : undefined}
        />

        {/* App Store */}
        <UrlSlot
          label="App Store"
          icon="◉"
          iconColor="var(--indigo)"
          placeholder="https://apps.apple.com/app/…"
          value={appStoreUrl}
          onChange={setAppStoreUrl}
          detected={appPlatform === 'app_store' ? 'App Store detected' : appStoreUrl ? 'Not an App Store URL' : undefined}
          detectedOk={appPlatform === 'app_store'}
          borderColor={appPlatform === 'app_store' ? 'var(--indigo-b)' : undefined}
        />

        {/* Website */}
        <div
          className="rounded-[10px] p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Website</span>
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ fontSize: 10, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)' }}
            >
              New · Optional
            </span>
          </div>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://yourapp.com"
            className="autofill-light w-full rounded-[6px] px-3 py-2 outline-none"
            style={{
              background: 'var(--raised)',
              border: `1px solid ${detectPlatform(websiteUrl) === 'website' && websiteUrl ? 'var(--indigo-b)' : 'var(--border2)'}`,
              color: 'var(--ink)',
              fontSize: 13,
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>
            Adds SEO keywords, existing testimonials, and pricing signals to the analysis
          </p>
        </div>

        {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}

        {!hasStoreUrl && (
          <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
            Enter at least one Play Store or App Store URL to continue.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!hasStoreUrl || !token || loading}
            className="rounded-[6px] px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span
                  className="rounded-full border-2 border-t-transparent animate-spin"
                  style={{ display: 'inline-block', width: 13, height: 13, borderColor: '#fff', borderTopColor: 'transparent' }}
                />
                Starting analysis…
              </span>
            ) : 'Continue →'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface UrlSlotProps {
  label: string;
  icon: string;
  iconColor: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  detected?: string;
  detectedOk?: boolean;
  borderColor?: string;
}

function UrlSlot({ label, icon, iconColor, placeholder, value, onChange, detected, detectedOk, borderColor }: UrlSlotProps) {
  return (
    <div
      className="rounded-[10px] p-4"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${borderColor ?? 'var(--border)'}`,
        transition: 'border-color 0.2s',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: 14, color: iconColor }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</span>
      </div>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="autofill-light w-full rounded-[6px] px-3 py-2 outline-none"
        style={{
          background: 'var(--raised)',
          border: `1px solid ${borderColor ?? 'var(--border2)'}`,
          color: 'var(--ink)',
          fontSize: 13,
        }}
      />
      {detected && (
        <p
          style={{
            fontSize: 12,
            marginTop: 6,
            color: detectedOk ? 'var(--sage)' : 'var(--amber)',
          }}
        >
          {detectedOk ? '✓ ' : '⚠ '}
          {detected}
        </p>
      )}
    </div>
  );
}
