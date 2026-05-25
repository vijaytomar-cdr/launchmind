/**
 * @file app/(dashboard)/dashboard/products/new/confirm/page.tsx
 * @description Confirm ICP step: founder reviews and edits the scraped ICP brief before saving.
 *   Reads scrape data from sessionStorage (set by /products/new after successful scrape).
 *   Redirects to /products/new if no sessionStorage data found.
 *   On confirm → POST /products/confirm → redirect to /dashboard/products/:id/strategy.
 * @security Auth token fetched from Supabase session. Confirm runs server-side via Fastify API.
 * @dependencies lib/api, lib/supabase/client, next/navigation
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { ICPBrief, CompetitorApp, ScrapedMeta } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';

const STEPS = ['Enter URL', 'Analyse', 'Confirm ICP', 'Generate strategy'];

interface SessionScrapeData {
  url: string;
  platform: 'app_store' | 'play_store';
  scraped: ScrapedMeta;
  icpBrief: ICPBrief;
  competitors: CompetitorApp[];
}

export default function ConfirmIcpPage() {
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken] = useState('');
  const [data, setData] = useState<SessionScrapeData | null>(null);
  const [icp, setIcp] = useState<ICPBrief | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: session }) => {
      if (session.session?.access_token) setToken(session.session.access_token);
    });
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('lm_scrape');
    if (!raw) {
      router.replace('/dashboard/products/new');
      return;
    }
    try {
      const parsed: SessionScrapeData = JSON.parse(raw);
      setData(parsed);
      setIcp(parsed.icpBrief);
    } catch {
      router.replace('/dashboard/products/new');
    }
  }, [router]);

  async function handleConfirm() {
    if (!data || !icp || !token) return;
    setError('');
    setSaving(true);

    try {
      const product = await api.products.confirm(
        {
          url: data.url,
          platform: data.platform,
          scraped: data.scraped,
          icpBrief: icp,
          competitors: data.competitors,
        },
        token
      );
      sessionStorage.removeItem('lm_scrape');
      trackOnboarding('icp_confirmed');
      router.push(`/dashboard/products/${product.id}/strategy`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save product — try again');
      setSaving(false);
    }
  }

  if (!data || !icp) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

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
                  background: i < 2 ? 'var(--sage)' : i === 2 ? 'var(--sage)' : 'var(--raised)',
                  color: i <= 2 ? '#fff' : 'var(--ink3)',
                  border: i <= 2 ? 'none' : '1px solid var(--border2)',
                }}
              >
                {i < 2 ? (
                  <svg width="10" height="10" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (i + 1)}
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: i === 2 ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: i === 2 ? 500 : 400,
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
                  background: i < 2 ? 'var(--sage)' : 'var(--border2)',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Confirm ICP brief
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Review and edit the ICP brief before we generate your strategy.
        </p>
      </div>

      <div className="space-y-6">
        {/* App header */}
        <div
          className="rounded-[10px] p-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start gap-4 mb-6">
            <div>
              <h2 className="font-display font-semibold" style={{ fontSize: 18, color: 'var(--ink)' }}>
                {data.scraped.name}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
                {data.scraped.developer} ·{' '}
                <span style={{ color: 'var(--sage)' }}>{data.scraped.category}</span>
              </p>
              <div className="flex items-center gap-4 mt-2" style={{ fontSize: 12, color: 'var(--ink3)' }}>
                <span>★ {data.scraped.rating.toFixed(1)}</span>
                <span>{data.scraped.ratingCount.toLocaleString()} ratings</span>
                <span
                  className="rounded-full px-2 py-0.5 font-medium"
                  style={{
                    fontSize: 11,
                    background: data.platform === 'app_store' ? 'var(--indigo-d)' : 'var(--sage-d)',
                    color: data.platform === 'app_store' ? 'var(--indigo)' : 'var(--sage)',
                  }}
                >
                  {data.platform === 'app_store' ? 'App Store' : 'Play Store'}
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
            <EditableList
              label="Pain points"
              items={icp.painPoints}
              onChange={(items) => setIcp({ ...icp, painPoints: items })}
            />
            <EditableList
              label="Competitor gaps"
              items={icp.competitorGaps}
              onChange={(items) => setIcp({ ...icp, competitorGaps: items })}
            />
          </div>
        </div>

        {data.competitors.length > 0 && (
          <CompetitorSection competitors={data.competitors} />
        )}

        {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => router.push('/dashboard/products/new')}
            className="rounded-[6px] px-4 py-2.5 transition-opacity hover:opacity-80"
            style={{ fontSize: 13, color: 'var(--ink2)', border: '1px solid var(--border2)' }}
          >
            Start over
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !token}
            className="flex-1 rounded-[6px] px-4 py-2.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            {saving ? 'Saving…' : 'Confirm & generate strategy →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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

function TagList({ label, items, getStyle }: { label: string; items: string[]; getStyle: (item: string) => React.CSSProperties }) {
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

function EditableList({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
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
