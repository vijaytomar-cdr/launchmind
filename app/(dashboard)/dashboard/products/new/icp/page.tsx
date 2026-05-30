'use client';
/**
 * @file icp/page.tsx — Step 4: Interactive ICP review
 * @description Every field editable inline. AI reasoning shown per field.
 *   Pain points as removable chips. Copy signals as accept/reject toggles.
 *   Edits tracked; AI review skipped if no edits made.
 *   Stores edited ICP in sessionStorage for Step 7 confirm.
 * @security productId from sessionStorage — ownership verified server-side.
 * @dependencies lib/api, lib/types/intake, next/navigation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

interface ScrapedMeta {
  name: string;
  developer: string;
  category: string;
  rating: number;
  ratingCount: number;
  priceTier: string;
  screenshots: string[];
  platform?: string;
  storeUrl?: string;
}

interface ScrapeResult {
  scraped?: ScrapedMeta;
  icpBrief?: IcpBrief;
  competitors?: Array<{ name: string; rating: number; developer?: string; priceTier?: string }>;
}

function emptyIcp(): IcpBrief {
  return {
    targetUser: '',
    geography: ['usa'],
    priceTier: 'freemium',
    painPoints: [],
    competitorGaps: [],
    suggestedMarkets: ['usa'],
  };
}

interface FieldRowProps {
  label: string;
  value: string;
  reasoning: string;
  onSave: (v: string) => void;
}

function FieldRow({ label, value, reasoning, onSave }: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  return (
    <div
      className="flex items-start gap-4 py-3"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span
        style={{ width: 120, flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--ink3)', paddingTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      <div className="flex-1">
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="w-full rounded-[6px] px-3 py-1.5 outline-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--sage-b)', color: 'var(--ink)', fontSize: 13 }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { onSave(draft); setEditing(false); }}
                className="rounded-[4px] px-3 py-1 font-medium hover:opacity-90 transition-opacity"
                style={{ fontSize: 12, background: 'var(--sage)', color: '#fff' }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setDraft(value); setEditing(false); }}
                className="rounded-[4px] px-3 py-1 hover:opacity-70 transition-opacity"
                style={{ fontSize: 12, color: 'var(--ink3)', border: '1px solid var(--border2)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="icp-val" style={{ fontSize: 13, color: 'var(--ink)' }}>{value || '—'}</p>
        )}
        <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>{reasoning}</p>
      </div>
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[4px] px-2 py-1 hover:opacity-70 transition-opacity flex-shrink-0"
          style={{ fontSize: 12, color: 'var(--ink3)', border: '1px solid var(--border2)' }}
        >
          Edit
        </button>
      )}
    </div>
  );
}

export default function IcpPage() {
  const router = useRouter();

  const [productId, setProductId]     = useState('');
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [icp, setIcp]                 = useState<IcpBrief>(emptyIcp());
  const [customPainPoints, setCustomPainPoints] = useState('');
  const [hasEdits, setHasEdits]       = useState(false);
  const [context, setContext]         = useState<FounderContext | null>(null);

  useEffect(() => {
    const pid = sessionStorage.getItem(INTAKE_STORAGE.productId);
    if (!pid) { router.replace('/dashboard/products/new'); return; }
    setProductId(pid);

    const raw = sessionStorage.getItem(INTAKE_STORAGE.scrapeResult);
    if (raw) {
      try {
        const result: ScrapeResult = JSON.parse(raw);
        setScrapeResult(result);
        if (result.icpBrief) {
          setIcp(result.icpBrief);
        }
      } catch { /* use defaults */ }
    }

    const ctxRaw = sessionStorage.getItem(INTAKE_STORAGE.context);
    if (ctxRaw) {
      try { setContext(JSON.parse(ctxRaw)); } catch { /* ignore */ }
    }
  }, [router]);

  function updateIcp(partial: Partial<IcpBrief>) {
    setIcp((prev) => ({ ...prev, ...partial }));
    setHasEdits(true);
  }

  function removePainPoint(i: number) {
    updateIcp({ painPoints: icp.painPoints.filter((_, j) => j !== i) });
  }

  function addPainPoint() {
    const trimmed = customPainPoints.trim();
    if (!trimmed) return;
    updateIcp({ painPoints: [...icp.painPoints, trimmed] });
    setCustomPainPoints('');
  }

  function handleContinue() {
    const edited = { ...icp };
    if (!productId) return;
    sessionStorage.setItem(INTAKE_STORAGE.editedIcp, JSON.stringify(edited));

    // Store competitors too
    if (scrapeResult?.competitors) {
      sessionStorage.setItem(
        INTAKE_STORAGE.competitors,
        JSON.stringify(scrapeResult.competitors.map((c) => ({ ...c, confirmed: true })))
      );
    }

    router.push('/dashboard/products/new/competitors');
  }

  const scraped = scrapeResult?.scraped;

  return (
    <div>
      <IntakeSteps currentStep="icp_review" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Review Your Analysis
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Your ICP brief + context, built from store data and your answers. Edit anything that looks off.
        </p>
      </div>

      {/* App header */}
      {scraped && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-center gap-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div>
            <p className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)' }}>
              {scraped.name}
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink2)' }}>
              {scraped.developer} · {scraped.category} ·{' '}
              <span style={{ color: 'var(--sage)' }}>★ {scraped.rating?.toFixed(1)}</span>
              {' '}({scraped.ratingCount?.toLocaleString()} ratings)
            </p>
          </div>
        </div>
      )}

      {/* ICP fields */}
      <div
        className="rounded-[10px] overflow-hidden mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--sage-b)', borderWidth: '1.5px' }}
      >
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>ICP Brief</p>
        </div>
        <div className="px-5">
          <FieldRow
            label="Target user"
            value={icp.targetUser}
            reasoning="Identified from top-rated review patterns"
            onSave={(v) => updateIcp({ targetUser: v })}
          />
          <FieldRow
            label="Price tier"
            value={icp.priceTier}
            reasoning="Matched to app store listing"
            onSave={(v) => updateIcp({ priceTier: v })}
          />
          <FieldRow
            label="Markets"
            value={icp.suggestedMarkets.join(', ').toUpperCase()}
            reasoning="Based on review geography and competitor distribution"
            onSave={(v) => updateIcp({ suggestedMarkets: v.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) })}
          />
          {context?.moat && (
            <FieldRow
              label="Your MOAT"
              value={context.moat}
              reasoning="You provided"
              onSave={(v) => {
                const updated = { ...context, moat: v };
                setContext(updated);
                sessionStorage.setItem(INTAKE_STORAGE.context, JSON.stringify(updated));
              }}
            />
          )}
          {context?.firstUserAction && (
            <FieldRow
              label="First action"
              value={context.firstUserAction}
              reasoning="You said"
              onSave={(v) => {
                const updated = { ...context, firstUserAction: v };
                setContext(updated);
                sessionStorage.setItem(INTAKE_STORAGE.context, JSON.stringify(updated));
              }}
            />
          )}
          {context?.dropOffPoint && (
            <FieldRow
              label="Drop-off"
              value={context.dropOffPoint}
              reasoning="You said"
              onSave={(v) => {
                const updated = { ...context, dropOffPoint: v };
                setContext(updated);
                sessionStorage.setItem(INTAKE_STORAGE.context, JSON.stringify(updated));
              }}
            />
          )}
          {context?.peakSeason && (
            <FieldRow
              label="Peak season"
              value={context.peakSeason}
              reasoning="You said"
              onSave={(v) => {
                const updated = { ...context, peakSeason: v };
                setContext(updated);
                sessionStorage.setItem(INTAKE_STORAGE.context, JSON.stringify(updated));
              }}
            />
          )}
        </div>
      </div>

      {/* Pain points */}
      <div
        className="rounded-[10px] p-5 mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="font-semibold mb-3" style={{ fontSize: 13, color: 'var(--ink)' }}>Customer pain points</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {icp.painPoints.map((point, i) => (
            <span
              key={i}
              className="pain-chip flex items-center gap-1.5 rounded-full px-3 py-1"
              style={{ fontSize: 12, background: 'var(--red-d)', color: 'var(--red)', border: '1px solid var(--red-b)' }}
            >
              {point}
              <button
                type="button"
                onClick={() => removePainPoint(i)}
                style={{ color: 'var(--red)', lineHeight: 1 }}
                className="hover:opacity-70 transition-opacity"
              >
                <i style={{ fontStyle: 'normal', fontSize: 11 }}>✕</i>
              </button>
            </span>
          ))}
          {icp.painPoints.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>No pain points yet — add one below</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customPainPoints}
            onChange={(e) => setCustomPainPoints(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPainPoint(); } }}
            placeholder="Add a customer pain point we missed…"
            className="flex-1 rounded-[6px] px-3 py-1.5 outline-none"
            style={{ background: 'var(--raised)', border: '1px dashed var(--indigo-b)', color: 'var(--ink)', fontSize: 12 }}
          />
          <button
            type="button"
            onClick={addPainPoint}
            className="rounded-[6px] px-3 py-1.5 hover:opacity-90 transition-opacity"
            style={{ fontSize: 12, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Competitor gaps */}
      {icp.competitorGaps.length > 0 && (
        <div
          className="rounded-[10px] p-5 mb-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="font-semibold mb-3" style={{ fontSize: 13, color: 'var(--ink)' }}>Competitor gaps</p>
          <div className="space-y-2">
            {icp.competitorGaps.map((gap, i) => (
              <div key={i} className="flex items-start gap-2">
                <span style={{ color: 'var(--sage)', marginTop: 1, flexShrink: 0 }}>✓</span>
                <p style={{ fontSize: 13, color: 'var(--ink2)' }}>{gap}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasEdits && (
        <div
          className="rounded-[10px] p-4 mb-4 flex items-start gap-3"
          style={{ background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)' }}
        >
          <span style={{ fontSize: 16 }}>✦</span>
          <p style={{ fontSize: 13, color: 'var(--indigo)' }}>
            Your edits are saved locally. LaunchMind will apply them when generating your strategy.
          </p>
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
          className="rounded-[6px] px-5 py-2.5 font-medium hover:opacity-90 transition-opacity"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          Looks right → Continue
        </button>
      </div>
    </div>
  );
}
