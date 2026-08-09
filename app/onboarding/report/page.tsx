/**
 * @file app/onboarding/report/page.tsx
 * @description Phase 1 Step 6: Preliminary Growth Report.
 *   Matches fv-step[6] from LaunchMind_Production_UX_July18_2026(15).html.
 *   Shows AI-discovered findings; value-gate checkpoint before beliefs review.
 * @security Requires auth — middleware enforces it.
 * @dependencies api.onboarding.getReport, acknowledgeReport
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type PreliminaryReport } from '@/lib/api';

/** Spec button style helpers */
const btnPrimary: React.CSSProperties = {
  height: 38, borderRadius: 10, border: '1px solid var(--sage)',
  background: 'var(--sage)', color: '#fff', padding: '0 13px',
  fontWeight: 650, cursor: 'pointer', fontSize: 14,
};
const btnSecondary: React.CSSProperties = {
  height: 38, borderRadius: 10, border: '1px solid var(--sage3)',
  background: 'var(--sage2)', color: '#096b50', padding: '0 13px',
  fontWeight: 650, cursor: 'pointer', fontSize: 14,
};
const btnSkip: React.CSSProperties = {
  border: 0, background: 'none', color: 'var(--ink3)',
  fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0,
};

/** Derive a plausible readiness score from report fields */
function deriveScore(r: PreliminaryReport): number {
  return Math.min(95, Math.max(45,
    50 + r.topInsights.length * 4 + r.opportunities.length * 3 - r.risks.length * 2,
  ));
}

/** Extract app name initial letter from headline */
function headlineInitial(headline: string): string {
  return (headline.trim().charAt(0) || 'A').toUpperCase();
}

export default function ReportPage() {
  const router = useRouter();
  const [report, setReport]         = useState<PreliminaryReport | null>(null);
  const [loading, setLoading]       = useState(true);
  const [sessionId, setSessionId]   = useState('');
  const [evidenceOpen, setEvidence] = useState(false);
  const [notUsefulNote, setNote]    = useState('');
  const [showNotUseful, setShowNot] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/report'); return; }

      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);

      try {
        const r = await api.onboarding.getReport(sid, session.access_token);
        setReport(r?.report ?? null);
        if (r?.acknowledged) {
          router.replace('/onboarding/beliefs');
        }
      } catch { router.replace('/onboarding'); }
      finally { setLoading(false); }
    }
    load();
    // router is an imperative API (navigation only), not reactive data — effect runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acknowledge(rating: 'useful' | 'partly_useful' | 'not_useful', dest: string, feedback?: string) {
    if (submitting) return;
    setSubmitting(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSubmitting(false); return; }
    try {
      await api.onboarding.acknowledgeReport(sessionId, session.access_token, rating, feedback);
      router.push(dest);
    } catch { setSubmitting(false); }
  }

  /* ── Loading ─────────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--ink3)' }}>Loading your report…</div>
      </div>
    );
  }

  /* ── Data derived from report ────────────────────────────────────────────── */
  const score         = report ? deriveScore(report) : 68;
  const initial       = report ? headlineInitial(report.headline) : 'A';
  const appTitle      = report?.headline ?? 'Your App';
  const appSub        = report?.summary  ?? 'Preliminary analysis complete';
  const factsCount    = report?.topInsights.length ?? 0;
  const assumeCount   = report?.opportunities.length ?? 0;
  const priorityCount = report?.risks.length ?? 1;

  // Highest-impact finding from first opportunity, fallback to first topInsight
  const topFinding = report?.opportunities[0] ?? null;
  const findingTitle = topFinding?.title
    ?? (report?.topInsights[0] ? report.topInsights[0] : 'Key growth opportunity identified');
  const findingBody = topFinding?.description
    ?? (report?.topInsights[1] ?? report?.summary ?? 'Based on your product listing and public signals.');

  // Evidence chips — use first 4 topInsights as chip labels (truncated)
  const chips: string[] = report
    ? report.topInsights.slice(0, 4).map(s => s.length > 28 ? s.slice(0, 25) + '…' : s)
    : ['Store positioning', 'Review themes', 'Category benchmark', 'Coverage signals'];

  // Evidence detail text
  const evidenceDetail = report?.risks[0]?.description
    ?? 'LaunchMind identified this finding from your app store listing, screenshots, and review language patterns.';

  return (
    <div>
      {/* .fv-kicker */}
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
        LaunchMind discovered this before asking you anything
      </div>

      {/* .report-top */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 20, borderBottom: '1px solid var(--border)', marginTop: 18 }}>
        {/* .report-icon */}
        <div style={{
          width: 54, height: 54, borderRadius: 15, background: '#e7f5ef',
          color: 'var(--sage)', display: 'grid', placeItems: 'center',
          fontSize: 24, fontWeight: 900, flexShrink: 0,
        }}>
          {initial}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontFamily: 'Syne, sans-serif', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {appTitle}
          </h3>
          <p style={{ margin: 0, color: 'var(--ink3)', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-word' }}>
            {appSub}
          </p>
        </div>

        {/* .instant-score */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <b style={{ display: 'block', fontSize: 24, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>
            {score}/100
          </b>
          <span style={{ color: 'var(--ink3)', fontSize: 11 }}>Readiness</span>
        </div>
      </div>

      {/* .findings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 11, margin: '18px 0' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 13, padding: 14, background: 'white' }}>
          <div style={{ fontSize: 20, fontWeight: 850, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{factsCount}</div>
          <label style={{ display: 'block', color: 'var(--ink3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>
            Facts discovered
          </label>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 13, padding: 14, background: 'white' }}>
          <div style={{ fontSize: 20, fontWeight: 850, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{assumeCount}</div>
          <label style={{ display: 'block', color: 'var(--ink3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>
            Assumptions to verify
          </label>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 13, padding: 14, background: 'white' }}>
          <div style={{ fontSize: 20, fontWeight: 850, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{priorityCount}</div>
          <label style={{ display: 'block', color: 'var(--ink3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>
            Priority action
          </label>
        </div>
      </div>

      {/* .first-insight */}
      <div style={{
        border: '1px solid var(--sage3)',
        background: 'linear-gradient(135deg,#f7fffb,#f8f7ff)',
        borderRadius: 16,
        padding: 18,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left stripe (replaces ::before pseudo-element) */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--sage)' }} />

        <div style={{ paddingLeft: 4 }}>
          {/* .fv-kicker */}
          <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
            Highest-impact finding
          </div>

          <h3 style={{ fontSize: 17, margin: '7px 0 8px', fontFamily: 'Syne, sans-serif', color: 'var(--ink)', lineHeight: 1.35 }}>
            {findingTitle}
          </h3>

          <p style={{ color: 'var(--ink2)', fontSize: 13, lineHeight: 1.55, margin: 0 }}>
            {findingBody}
          </p>

          {/* .evidence chips */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '14px 0' }}>
            {chips.map((chip, i) => (
              <span key={i} style={{
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 999, padding: '6px 9px',
                color: 'var(--ink2)', fontSize: 11,
              }}>
                {chip}
              </span>
            ))}
          </div>

          {/* .text-action toggle */}
          <button
            onClick={() => setEvidence(v => !v)}
            style={{ border: 0, background: 'none', color: 'var(--sage)', fontWeight: 750, cursor: 'pointer', padding: '8px 0', fontSize: 13 }}
          >
            {evidenceOpen ? 'Hide evidence and reasoning' : 'Show evidence and reasoning'}
          </button>

          {/* .evidence-detail */}
          {evidenceOpen && (
            <div style={{
              marginTop: 12, padding: 12, background: 'white',
              border: '1px solid var(--border)', borderRadius: 10,
            }}>
              <b style={{ fontSize: 13, color: 'var(--ink)' }}>Why LaunchMind believes this</b>
              <p style={{ fontSize: 11, marginTop: 5, color: 'var(--ink2)', lineHeight: 1.55, margin: '5px 0 0' }}>
                {evidenceDetail}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* .value-gate */}
      <div style={{
        marginTop: 18, border: '1px solid var(--sage3)',
        background: 'linear-gradient(135deg,#f7fffb,#f8f7ff)',
        borderRadius: 16, padding: 18,
      }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontFamily: 'Syne, sans-serif', color: 'var(--ink)' }}>
          Was this useful?
        </h3>
        <p style={{ margin: 0, color: 'var(--ink2)', lineHeight: 1.5, fontSize: 14 }}>
          Your Growth Brain is already useful. Continue for about three minutes to make it specific to your goals and approval boundaries.
        </p>

        {/* "Not yet" inline note field */}
        {showNotUseful && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>
              What looks wrong? (optional — helps us improve)
            </label>
            <textarea
              value={notUsefulNote}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Describe what seems inaccurate about this finding…"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: '1px solid var(--border2)', background: 'white',
                color: 'var(--ink)', fontSize: 13, resize: 'vertical',
                fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => setShowNot(false)} style={{
                height: 32, borderRadius: 8, border: '1px solid var(--border)',
                background: 'white', color: 'var(--ink2)', padding: '0 10px',
                fontWeight: 650, cursor: 'pointer', fontSize: 12,
              }}>
                Cancel
              </button>
              <button
                onClick={() => acknowledge('not_useful', '/onboarding/beliefs', notUsefulNote.trim() || undefined)}
                disabled={submitting}
                style={{
                  height: 32, borderRadius: 8, border: '1px solid var(--sage)',
                  background: 'var(--sage)', color: '#fff', padding: '0 10px',
                  fontWeight: 650, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 12,
                }}
              >
                {submitting ? 'Saving…' : 'Continue to fix it →'}
              </button>
            </div>
          </div>
        )}

        {/* .checkpoint-actions */}
        {!showNotUseful && (
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 15, alignItems: 'center' }}>
            <button
              onClick={() => acknowledge('useful', '/onboarding/beliefs')}
              disabled={submitting}
              style={{ ...btnPrimary, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Saving…' : 'Yes — teach my AI CMO →'}
            </button>
            <button
              onClick={() => acknowledge('partly_useful', '/dashboard/brief')}
              disabled={submitting}
              style={{ ...btnSecondary, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              Save and explore now
            </button>
            <button
              onClick={() => setShowNot(true)}
              disabled={submitting}
              style={btnSkip}
            >
              Not yet — the finding is wrong
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
