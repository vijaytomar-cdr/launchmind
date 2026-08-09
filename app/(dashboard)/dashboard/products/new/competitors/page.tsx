'use client';
/**
 * @file competitors/page.tsx — Step 5: Competitor review
 * @description Founder confirms, rejects, or adds competitors.
 *   Rejected competitors are excluded from positioning copy.
 *   Stores decisions in sessionStorage for Step 7 confirm.
 * @security productId from sessionStorage.
 * @dependencies lib/api, lib/types/intake, next/navigation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE } from '@/lib/types/intake';

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

export default function CompetitorsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [addUrl, setAddUrl]       = useState('');
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState('');

  useEffect(() => {
    const pid = sessionStorage.getItem(INTAKE_STORAGE.productId);
    if (!pid) { router.replace('/dashboard/products/new'); return; }

    const raw = sessionStorage.getItem(INTAKE_STORAGE.competitors);
    if (raw) {
      try { setCompetitors(JSON.parse(raw)); } catch { /* ignore */ }
    } else {
      // Try to read from scrapeResult
      const srRaw = sessionStorage.getItem(INTAKE_STORAGE.scrapeResult);
      if (srRaw) {
        try {
          const sr = JSON.parse(srRaw);
          const comps = (sr.competitors || []).map((c: CompetitorEntry) => ({ ...c, confirmed: true }));
          setCompetitors(comps);
        } catch { /* ignore */ }
      }
    }
  }, [router]);

  function setConfirmed(i: number, value: boolean) {
    setCompetitors((prev) => prev.map((c, j) => j === i ? { ...c, confirmed: value } : c));
  }

  async function handleAddCompetitor() {
    if (!addUrl.trim()) return;
    setAdding(true);
    setAddError('');

    const { data: { session } } = await supabase.auth.getSession();
    const freshToken = session?.access_token;
    if (!freshToken) { setAddError('Session expired — please refresh'); setAdding(false); return; }

    try {
      const trimmed = addUrl.trim();
      const isStoreUrl = trimmed.includes('play.google.com') || trimmed.includes('apps.apple.com');
      const result = isStoreUrl
        ? await api.products.scrape(trimmed, freshToken)
        : await api.products.scrapeCompetitorWebsite(trimmed, freshToken);

      const newComp: CompetitorEntry = {
        name:      result.scraped.name,
        developer: result.scraped.developer,
        rating:    result.scraped.rating,
        priceTier: result.scraped.priceTier,
        platform:  result.scraped.platform as CompetitorEntry['platform'],
        confirmed: true,
      };
      setCompetitors((prev) => [...prev, newComp]);
      setAddUrl('');
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to scrape — check the URL');
    } finally {
      setAdding(false);
    }
  }

  function handleContinue() {
    sessionStorage.setItem(INTAKE_STORAGE.competitors, JSON.stringify(competitors));
    router.push('/dashboard/products/new/markets');
  }

  const initials = (name: string) =>
    name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

  return (
    <div>
      <IntakeSteps currentStep="competitors" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Competitors we found
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Confirm the real ones, remove the wrong ones. Add any we missed — we&apos;ll scrape their weaknesses.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        {competitors.length === 0 && (
          <div
            className="rounded-[10px] p-5 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p style={{ fontSize: 13, color: 'var(--ink3)' }}>
              No competitors found automatically. Add one below.
            </p>
          </div>
        )}

        {competitors.map((comp, i) => (
          <div
            key={i}
            className="rounded-[10px] p-4 flex items-center gap-4"
            style={{
              background: 'var(--surface)',
              border: `1px solid ${comp.confirmed ? 'var(--sage-b)' : 'var(--border)'}`,
              opacity: comp.confirmed ? 1 : 0.5,
              transition: 'all 0.2s',
            }}
          >
            {/* Initials box */}
            <div
              className="flex items-center justify-center rounded-[6px] font-semibold flex-shrink-0"
              style={{
                width: 40,
                height: 40,
                background: comp.confirmed ? 'var(--sage-d)' : 'var(--raised)',
                color: comp.confirmed ? 'var(--sage)' : 'var(--ink3)',
                fontSize: 14,
              }}
            >
              {initials(comp.name)}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  {comp.name}
                </p>
                {comp.confirmed ? (
                  <span
                    className="rounded-full px-2 py-0.5 font-medium flex-shrink-0"
                    style={{ fontSize: 10, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
                  >
                    ✓ Confirmed
                  </span>
                ) : (
                  <span
                    className="rounded-full px-2 py-0.5 font-medium flex-shrink-0"
                    style={{ fontSize: 10, background: 'var(--danger-d)', color: 'var(--danger)', border: '1px solid var(--danger-b)' }}
                  >
                    ✗ Removed
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
                {[comp.developer, comp.priceTier, comp.rating ? `★ ${comp.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}
              </p>
              {comp.gap && (
                <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{comp.gap}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setConfirmed(i, true)}
                disabled={comp.confirmed}
                className="rounded-[4px] px-2.5 py-1 transition-opacity hover:opacity-80 disabled:opacity-30"
                style={{ fontSize: 12, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
              >
                ✓ Real
              </button>
              <button
                type="button"
                onClick={() => setConfirmed(i, false)}
                disabled={!comp.confirmed}
                className="rounded-[4px] px-2.5 py-1 transition-opacity hover:opacity-80 disabled:opacity-30"
                style={{ fontSize: 12, background: 'var(--danger-d)', color: 'var(--danger)', border: '1px solid var(--danger-b)' }}
              >
                ✗ Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add competitor */}
      <div
        className="rounded-[10px] p-4 mb-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="font-medium mb-3" style={{ fontSize: 13, color: 'var(--ink)' }}>
          Know a competitor we missed?
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="App Store URL · Play Store URL · or https://competitor.com"
            className="autofill-light flex-1 rounded-[6px] px-3 py-2 outline-none"
            style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCompetitor(); } }}
          />
          <button
            type="button"
            onClick={handleAddCompetitor}
            disabled={adding || !addUrl.trim()}
            className="rounded-[6px] px-4 py-2 font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', fontSize: 13 }}
          >
            {adding ? 'Scraping…' : 'Scrape gaps'}
          </button>
        </div>
        {addError && (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{addError}</p>
        )}
      </div>

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
          className="rounded-[6px] px-5 py-2.5 font-medium hover:opacity-90 transition-opacity"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
