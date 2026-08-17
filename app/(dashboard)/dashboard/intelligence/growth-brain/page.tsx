/**
 * @file app/(dashboard)/dashboard/intelligence/growth-brain/page.tsx
 * @description Growth Brain page — matches spec #brain panel exactly.
 *   3 context cards (Context / Context delta / Learning) + brain-intelligence-card
 *   with 6 dimension bars and a recommended-next-source aside.
 *   Fetches live data from GET /intelligence/coverage.
 *   Inline modals: Update Context, Edit Delta, View Learning Log.
 * @security JWT required; coverage endpoint reads only founder-owned rows (RLS).
 * @dependencies api.intelligence.coverage, api.intelligence.learningLog,
 *   api.products.updateContext, api.products.updateContextDelta
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type GrowthBrainRecommendation, type GrowthBrainRecommendations, type GrowthBrainCoverage, type IntelligenceDimension } from '@/lib/api';
import { Dialog } from '@/components/launchmind/Dialog';
import { LearningLog } from '@/components/launchmind/LearningLog';

/* ─── shared primitives ──────────────────────────────────────────── */

const CARD: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
};

/* ─── context row ─────────────────────────────────────────────────── */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--ink3)', minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500, lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

/* ─── dimension bar ───────────────────────────────────────────────── */

function DimensionBar({ dim }: { dim: IntelligenceDimension }) {
  const pct = `${dim.score}%`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1fr) 40px', gap: '6px 12px', alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: dim.missing ? 'var(--ink3)' : 'var(--ink)' }}>{dim.label}</span>
        <span style={{ display: 'block', fontSize: 8.5, color: 'var(--ink3)' }}>{dim.description}</span>
      </div>
      <span style={{ fontStyle: 'normal', fontWeight: 850, fontSize: 11, textAlign: 'right', color: dim.missing ? 'var(--ink3)' : 'var(--ink)' }}>
        {dim.score}%
      </span>
      <div style={{ gridColumn: '1/3', height: 6, background: '#edf1ee', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          width: pct,
          height: '100%',
          borderRadius: 999,
          background: dim.missing
            ? '#cbd4cf'
            : 'linear-gradient(90deg,var(--sage),#56c9a7)',
          transition: 'width .5s ease',
        }} />
      </div>
    </div>
  );
}

/* ─── skeleton ────────────────────────────────────────────────────── */

function Skeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ height: 32, width: '30%', background: 'var(--raised)', borderRadius: 8 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {[0,1,2].map(i => <div key={i} style={{ height: 200, background: 'var(--raised)', borderRadius: 14 }} />)}
      </div>
      <div style={{ height: 320, background: 'var(--raised)', borderRadius: 14 }} />
    </div>
  );
}

/* Modals use the shared accessible Dialog (role="dialog", aria-modal, focus trap,
   focus restoration, Escape). The bespoke overlay this replaced had none of those. */

/* ─── field helper ────────────────────────────────────────────────── */

function FieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5, fontWeight: 700 }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--sage)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border2)'; }}
      />
    </div>
  );
}

/* ─── page ────────────────────────────────────────────────────────── */

/**
 * TOP PRIORITIES — the owner-facing answer to "what should I do?".
 *
 * Deliberately not a debug view. The owner sees what to do, why now, what it is
 * based on and what to do next. Authority tiers, retrieval scores, lifecycle
 * states and policy codes stay out; the only governance that surfaces is
 * translated into plain English on the source line.
 */
function TypeTag({ type }: { type: 'OBSERVATION' | 'INFERENCE' | 'RECOMMENDATION' }) {
  const style = {
    OBSERVATION:    { bg: 'var(--sage-d)',  bd: 'var(--sage-b)',  fg: '#087253' },
    INFERENCE:      { bg: 'var(--ai-d)',    bd: 'var(--ai-b)',    fg: 'var(--ai)' },
    RECOMMENDATION: { bg: 'var(--indigo-d)',bd: 'var(--indigo-b)',fg: 'var(--indigo)' },
  }[type];
  const label = { OBSERVATION: 'Observed', INFERENCE: 'Interpretation', RECOMMENDATION: 'Recommendation' }[type];
  return (
    <span style={{ background: style.bg, border: `1px solid ${style.bd}`, color: style.fg,
      borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
  );
}

function DecisionControls({ rec }: { rec: GrowthBrainRecommendation }) {
  const [status, setStatus] = useState(rec.decisionStatus ?? 'RECOMMENDED');
  const [exec, setExec]     = useState(rec.executionStatus ?? 'NOT_STARTED');
  const [busy, setBusy]     = useState<string | null>(null);
  const [err, setErr]       = useState<string | null>(null);

  if (!rec.id) return null;

  const decide = async (action: 'APPROVE' | 'DISMISS' | 'DEFER') => {
    setBusy(action); setErr(null);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) { setErr('Please sign in again.'); return; }
      const res = await api.intelligence.decideRecommendation(
        rec.id!,
        {
          action,
          // Approving something that opposes stated direction is an explicit,
          // acknowledged act — never a silent one.
          acknowledgeFounderConflict: action === 'APPROVE' && Boolean(rec.founderConflict),
        },
        session.access_token,
      );
      // State updates ONLY after the server confirms. No optimistic success.
      setStatus(res.decisionStatus as typeof status);
      setExec(res.executionStatus as typeof exec);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your decision.');
    } finally { setBusy(null); }
  };

  const label: Record<string, string> = {
    APPROVED: exec === 'READY_FOR_ACTION' ? 'Approved · ready for action' : 'Approved',
    DISMISSED: 'Dismissed',
    DEFERRED: 'Saved for later',
  };

  if (status !== 'RECOMMENDED') {
    return (
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: '#087253',
          borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{label[status]}</span>
        {status === 'APPROVED' && exec === 'READY_FOR_ACTION' && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>LaunchMind has not acted on this yet.</span>
        )}
      </div>
    );
  }

  const btn = {
    height: 32, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 650,
    cursor: 'pointer', border: '1px solid var(--border)', background: 'white', color: 'var(--ink)',
  } as const;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ ...btn, background: 'var(--sage)', color: 'white', border: '1px solid var(--sage)' }}
          disabled={busy !== null} onClick={() => decide('APPROVE')}>
          {busy === 'APPROVE' ? 'Saving…' : rec.founderConflict ? 'Approve anyway' : 'Approve'}
        </button>
        <button style={btn} disabled={busy !== null} onClick={() => decide('DEFER')}>
          {busy === 'DEFER' ? 'Saving…' : 'Save for later'}
        </button>
        <button style={btn} disabled={busy !== null} onClick={() => decide('DISMISS')}>
          {busy === 'DISMISS' ? 'Saving…' : 'Dismiss'}
        </button>
      </div>
      {err && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>{err}</p>}
    </div>
  );
}

function TopPriorities({ data, loading }: { data: GrowthBrainRecommendations | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>Working out your top priorities…</p>
      </div>
    );
  }
  if (!data) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase',
        color: 'var(--ink3)', margin: '0 0 10px' }}>Top priorities</h2>

      {data.recommendations.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0 }}>
            {data.reason ?? 'Nothing to recommend yet.'}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {data.recommendations.map((r, i) => (
          <article key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink3)' }}>{i + 1}</span>
              <TypeTag type="RECOMMENDATION" />
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.evidenceStrength}</span>
              {r.requiresApproval && (
                <span style={{ background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: '#8d4f08',
                  borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>Needs your approval</span>
              )}
              {r.founderConflict && (
                <span style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)',
                  borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>Conflicts with what you told us</span>
              )}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>
              {r.what}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 10px', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--ink)' }}>Why now:</strong> {r.whyNow}
            </p>

            {r.supporting.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', display: 'grid', gap: 6 }}>
                {r.supporting.map((s, j) => (
                  <li key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <TypeTag type={s.type} />
                    <span style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5 }}>{s.text}</span>
                  </li>
                ))}
              </ul>
            )}

            {r.expectedEffect && (
              <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '0 0 10px' }}>
                <strong style={{ color: 'var(--ink)' }}>Could affect:</strong> {r.expectedEffect}
              </p>
            )}

            <details style={{ marginBottom: 10 }}>
              <summary style={{ fontSize: 12, fontWeight: 650, color: 'var(--sage)', cursor: 'pointer' }}>
                Why am I seeing this?
              </summary>
              <ul style={{ listStyle: 'none', padding: '8px 0 0', margin: 0, display: 'grid', gap: 6 }}>
                {r.supportedBy.map((p, k) => (
                  <li key={k} style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--ink)', fontWeight: 650 }}>{p.label}</span>
                    {p.detail ? <span style={{ color: 'var(--ink3)' }}> — {p.detail}</span> : null}
                    {typeof p.evidenceCount === 'number' && p.evidenceCount > 0 && (
                      <span style={{ color: 'var(--ink3)' }}> · {p.evidenceCount} supporting record(s)</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>

            {r.founderConflict && (
              <p style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 8px' }}>
                This goes against “{r.founderConflict.withDirection}”. LaunchMind is not
                recommending it as settled — it is yours to decide.
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>
              <strong>Next step:</strong> {r.nextStep}
            </p>

            <DecisionControls rec={r} />
          </article>
        ))}
      </div>

      {data.unavailable.length > 0 && (
        <div style={{ marginTop: 12, background: 'var(--raised)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', margin: '0 0 6px',
            textTransform: 'uppercase', letterSpacing: '.08em' }}>What LaunchMind can&apos;t see yet</p>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {data.unavailable.map((u, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function GrowthBrainPage() {
  const [coverage, setCoverage] = useState<GrowthBrainCoverage | null>(null);
  const [recs, setRecs] = useState<GrowthBrainRecommendations | null>(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [loading,  setLoading]  = useState(true);
  const [token,    setToken]    = useState('');
  const [productId, setProductId] = useState<string | null>(null);

  // Modal state
  const [ctxModalOpen,      setCtxModalOpen]      = useState(false);
  const [deltaModalOpen,    setDeltaModalOpen]     = useState(false);
  const [learningModalOpen, setLearningModalOpen]  = useState(false);

  // Form state
  const [ctxForm,   setCtxForm]   = useState({ positioning: '', audience: '', topSignal: '' });
  const [deltaForm, setDeltaForm] = useState({ nextInitiative: '', primaryGoal: '', targetWindow: '' });
  const [saving,    setSaving]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) { setLoading(false); return; }
      setToken(session.access_token);

      // Resolve productId from sessionStorage
      try {
        const pid = sessionStorage.getItem('lm_product_id') ??
          (JSON.parse(sessionStorage.getItem('lm_resume_hint') ?? '{}') as { productId?: string }).productId ??
          null;
        setProductId(pid ?? null);
      } catch { /* ignore */ }

      api.intelligence.coverage(session.access_token)
        .then(cov => {
          setCoverage(cov);
          setLoading(false);
          // Pre-populate forms from coverage context
          const c = cov.contextSummary;
          setCtxForm({ positioning: c.positioning ?? '', audience: c.audience ?? '', topSignal: c.topSignal ?? '' });
          setDeltaForm({ nextInitiative: c.nextInitiative ?? '', primaryGoal: c.primaryGoal ?? '', targetWindow: c.targetWindow ?? '' });
        })
        .catch(() => setLoading(false));

      // Recommendations load independently: they involve a model call, and the
      // rest of the page must not wait on it.
      api.intelligence.recommendations(session.access_token)
        .then(r => { setRecs(r); setRecsLoading(false); })
        .catch(() => setRecsLoading(false));
    });
  }, []);

  const handleSaveCtx = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    try {
      if (productId) {
        await api.products.updateContext(productId, ctxForm, token);
        setCoverage(prev => prev ? { ...prev, contextSummary: { ...prev.contextSummary, ...ctxForm } } : prev);
      } else {
        setSaveMsg('Saved locally');
      }
      setCtxModalOpen(false);
    } catch {
      setSaveMsg('Save failed — try again');
    } finally {
      setSaving(false);
    }
  }, [ctxForm, productId, token]);

  const handleSaveDelta = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    try {
      if (productId) {
        await api.products.updateContextDelta(productId, deltaForm, token);
        setCoverage(prev => prev ? { ...prev, contextSummary: { ...prev.contextSummary, ...deltaForm } } : prev);
      } else {
        setSaveMsg('Saved locally');
      }
      setDeltaModalOpen(false);
    } catch {
      setSaveMsg('Save failed — try again');
    } finally {
      setSaving(false);
    }
  }, [deltaForm, productId, token]);

  if (loading) return <Skeleton />;

  const ctx  = coverage?.contextSummary;
  const dims = coverage?.dimensions ?? [];
  const rec  = coverage?.recommendedSource;
  const learn = coverage?.lastLearning;
  // No fabricated default. When coverage is unavailable we show "—", never a number
  // that looks like a real measurement of this founder's Growth Brain.
  const score = coverage?.overallScore ?? null;
  const scoreText = score === null ? '—' : `${score}%`;
  const connectedCount = coverage?.connections.connectedCount ?? 0;

  const BTN_LINK: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: 'var(--sage)',
    padding: '12px 0 0',
    fontWeight: 600,
    display: 'block',
    textAlign: 'left',
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Connected sources notice */}
      {connectedCount > 0 && (
        <div style={{ background: 'var(--sage2)', border: '1px solid var(--sage3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#087253' }}>
          ✓ Growth Brain updated from connected sources — {connectedCount} source{connectedCount > 1 ? 's' : ''} active
        </div>
      )}

      {/* ── TOP PRIORITIES (Phase 3.3C) ─────────────────────────────────── */}
      <TopPriorities data={recs} loading={recsLoading} />

      {/* Page head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1, color: 'var(--ink)', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>
            Growth Brain
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0 }}>
            LaunchMind&apos;s living model of your product, market, and direction.
          </p>
        </div>
        <Link
          href="/onboarding/context-delta"
          style={{ height: 38, padding: '0 14px', border: '1px solid var(--border)', background: 'white', color: 'var(--ink)', borderRadius: 10, fontWeight: 650, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
        >
          Update launch context
        </Link>
      </div>

      {/* 3-card risk-grid */}
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 16, marginBottom: 16 }}>

        {/* Card 1 — Context */}
        <div style={CARD}>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', padding: '3px 8px', borderRadius: 9999, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', marginBottom: 12 }}>
            Context
          </span>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>What the market sees</h3>
          <p style={{ margin: '0 0 12px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.55 }}>
            App Store positioning, store reviews, public pricing signals, and homepage promise extracted at intake.
          </p>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <Row label="Positioning"  value={ctx?.positioning  ?? 'Not observed yet'} />
            <Row label="Audience"     value={ctx?.audience     ?? 'Not confirmed'} />
            <Row label="Top signal"   value={ctx?.topSignal    ?? 'Demand from public signals'} />
          </div>
          <button style={BTN_LINK} onClick={() => setCtxModalOpen(true)}>Update context →</button>
        </div>

        {/* Card 2 — Context delta */}
        <div style={CARD}>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', padding: '3px 8px', borderRadius: 9999, background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: 'var(--amber)', marginBottom: 12 }}>
            Context delta
          </span>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>What you are launching next</h3>
          <p style={{ margin: '0 0 12px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.55 }}>
            The gap between what the market sees and what you are about to launch. LaunchMind uses this to bias strategy.
          </p>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <Row label="Next initiative" value={ctx?.nextInitiative ?? 'Not set'} />
            <Row label="Primary goal"    value={ctx?.primaryGoal    ?? 'Not set'} />
            <Row label="Target window"   value={ctx?.targetWindow   ?? 'Not set'} />
          </div>
          <button style={BTN_LINK} onClick={() => setDeltaModalOpen(true)}>Edit delta →</button>
        </div>

        {/* Card 3 — Learning */}
        <div style={CARD}>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', padding: '3px 8px', borderRadius: 9999, background: 'var(--violet2)', border: '1px solid #d7d0ff', color: 'var(--ai)', marginBottom: 12 }}>
            Learning
          </span>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>What changed strategy</h3>
          <p style={{ margin: '0 0 12px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.55 }}>
            The most recent signal that caused LaunchMind to update its recommendation.
          </p>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {learn ? (
              <>
                <Row label="Trigger"      value={learn.trigger} />
                <Row label="Action taken" value={learn.actionTaken} />
                <Row label="Confidence"   value={learn.confidenceLift} />
                {/* Who decided this — the same distinction the full log draws. */}
                <Row
                  label="Decided by"
                  value={learn.origin === 'founder_confirmed' ? 'You confirmed this' : 'LaunchMind concluded this'}
                />
              </>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>No learning events yet. Strategy will update after the first weekly brief cycle.</p>
            )}
          </div>
          <button style={BTN_LINK} onClick={() => setLearningModalOpen(true)}>View learning log →</button>
        </div>

      </div>

      {/* brain-intelligence-card */}
      <div style={{ ...CARD, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 330px', gap: 28, marginTop: 0 }}>

        {/* Left: understanding header + dimensions */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ink3)', margin: '0 0 4px' }}>
                Growth Brain understanding
              </p>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: '0 0 4px', fontFamily: 'Syne, sans-serif' }}>
                {score === null ? 'Understanding unavailable' : `${score}% grounded in evidence`}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
                {coverage?.overallCopy ?? 'LaunchMind could not read your Growth Brain coverage just now. Nothing has changed — try again in a moment.'}
              </p>
            </div>
            {/* Score pill */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <b style={{ fontSize: 34, display: 'block', letterSpacing: '-.04em', color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{scoreText}</b>
              <span style={{ fontSize: 9, color: 'var(--ink3)' }}>Overall understanding</span>
            </div>
          </div>

          {/* 6 dimension bars */}
          <div style={{ display: 'grid', gap: 13 }}>
            {dims.length > 0 ? (
              dims.map(d => <DimensionBar key={d.label} dim={d} />)
            ) : (
              /* No placeholder dimension scores. Inventing numbers here would show
                 the owner a confidence level LaunchMind has not actually measured. */
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0, lineHeight: 1.6 }}>
                Coverage could not be loaded. Your Growth Brain is unchanged — reload to try again.
              </p>
            )}
          </div>
        </div>

        {/* Right: next intelligence source */}
        <aside style={{ background: '#13231f', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#91a79e', margin: 0, textTransform: 'uppercase' }}>
            Best next source
          </p>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 8px', fontFamily: 'Syne, sans-serif' }}>
              {/* OBSERVATION HONESTY: this fell back to the literal 'App Store
                  Connect' and its full description whenever no source was
                  recommended — including for a pre-launch product with no app at
                  all, which is the "we think you have an app" defect the backend
                  already refuses to make. */}
              {rec?.name ?? 'No source available yet'}
            </h3>
            <p style={{ fontSize: 12, color: '#91a79e', margin: 0, lineHeight: 1.55 }}>
              {rec?.description ?? 'No connectable source is available for this product yet.'}
            </p>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <p style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#91a79e', margin: '0 0 3px' }}>Decision improved</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: 0 }}>{rec?.decisionImproved ?? '—'}</p>
            </div>
            <div>
              <p style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#91a79e', margin: '0 0 3px' }}>Expected understanding</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#47d9ae', margin: 0 }}>{rec?.expectedGain ?? '—'}</p>
            </div>
            <div>
              <p style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#91a79e', margin: '0 0 3px' }}>Access</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: 0 }}>{rec?.accessType ?? '—'}</p>
            </div>
          </div>
          <Link
            href="/dashboard/channels"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 10, background: 'var(--sage)', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 650, marginTop: 'auto' }}
          >
            Preview what this unlocks →
          </Link>
          <p style={{ fontSize: 10, color: '#617b70', margin: 0, textAlign: 'center' }}>No publishing, campaign, or spend access.</p>
        </aside>

      </div>

      {/* ── Context Modal ── */}
      {ctxModalOpen && (
        <Dialog label="Update context" onClose={() => setCtxModalOpen(false)} maxWidth={520} panelClassName="lm-modal-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Update Context</h2>
            <button onClick={() => setCtxModalOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
          </div>
          <FieldRow label="Positioning" value={ctxForm.positioning} onChange={v => setCtxForm(f => ({ ...f, positioning: v }))} />
          <FieldRow label="Audience" value={ctxForm.audience} onChange={v => setCtxForm(f => ({ ...f, audience: v }))} />
          <FieldRow label="Top signal" value={ctxForm.topSignal} onChange={v => setCtxForm(f => ({ ...f, topSignal: v }))} />
          {saveMsg && <p role="status" style={{ fontSize: 12, color: 'var(--sage)', marginBottom: 8 }}>{saveMsg}</p>}
          <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setCtxModalOpen(false)} style={{ height: 38, padding: '0 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button onClick={handleSaveCtx} disabled={saving} style={{ height: 38, padding: '0 16px', borderRadius: 14, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 650, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Delta Modal ── */}
      {deltaModalOpen && (
        <Dialog label="Edit context delta" onClose={() => setDeltaModalOpen(false)} maxWidth={520} panelClassName="lm-modal-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Edit Context Delta</h2>
            <button onClick={() => setDeltaModalOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
          </div>
          <FieldRow label="Next initiative" value={deltaForm.nextInitiative} onChange={v => setDeltaForm(f => ({ ...f, nextInitiative: v }))} />
          <FieldRow label="Primary goal"    value={deltaForm.primaryGoal}    onChange={v => setDeltaForm(f => ({ ...f, primaryGoal: v }))} />
          <FieldRow label="Target window"   value={deltaForm.targetWindow}   onChange={v => setDeltaForm(f => ({ ...f, targetWindow: v }))} />
          {saveMsg && <p role="status" style={{ fontSize: 12, color: 'var(--sage)', marginBottom: 8 }}>{saveMsg}</p>}
          <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setDeltaModalOpen(false)} style={{ height: 38, padding: '0 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button onClick={handleSaveDelta} disabled={saving} style={{ height: 38, padding: '0 16px', borderRadius: 14, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 650, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Learning Log Modal ── */}
      {learningModalOpen && (
        <Dialog label="Learning log" onClose={() => setLearningModalOpen(false)} maxWidth={760} panelClassName="lm-modal-pad">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <div>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Learning Log</h2>
              <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '5px 0 0', lineHeight: 1.55, maxWidth: 560 }}>
                Every change to what LaunchMind understands about your product — what triggered it,
                the evidence behind it, and whether LaunchMind concluded it or you confirmed it.
              </p>
            </div>
            <button onClick={() => setLearningModalOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
          </div>

          <div style={{ marginTop: 16 }}>
            <LearningLog token={token} productId={productId} />
          </div>

          <div className="lm-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={() => setLearningModalOpen(false)} style={{ height: 38, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Close</button>
          </div>
        </Dialog>
      )}

    </div>
  );
}
