/**
 * @file app/onboarding/discovery/recovery/page.tsx
 * @description Phase 1 Step 5: Discovery error recovery.
 *   Matches fv-step[5] from LaunchMind_Production_UX_July18_2026(15).html.
 *   Shows the error-state layout when discovery fails, or a candidate-selection
 *   list when multiple matches are found.
 * @security Requires auth — middleware enforces it.
 * @dependencies api.onboarding.getDiscovery, retryDiscovery, selectMatch
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type OnboardingDiscoveryJob, type CandidateMatch } from '@/lib/api';

const ERROR_COPY: Record<string, { title: string; guidance: string }> = {
  APP_NOT_FOUND:      { title: 'We could not find that app.', guidance: 'The URL didn\'t match a live app listing. Check that the URL is correct and the app is publicly available.' },
  STORE_PARSE_FAILED: { title: 'We could not read that product link.', guidance: 'The app store returned data in an unexpected format. This sometimes resolves on retry.' },
  INVALID_URL:        { title: 'We could not read that product link.', guidance: 'The URL you entered wasn\'t recognised. Please use a direct link to your app on the App Store or Play Store.' },
  SCRAPE_FAILED:      { title: 'We could not read that product link.', guidance: 'We couldn\'t access the store listing right now. This is usually temporary — try again in a minute.' },
  UNEXPECTED_ERROR:   { title: 'We could not read that product link.', guidance: 'Something went wrong. Please retry — if this keeps happening, contact support.' },
};

/** Inline style helpers matching spec class values */
const btn = {
  primary: {
    height: 38, borderRadius: 10, border: '1px solid var(--sage)',
    background: 'var(--sage)', color: '#fff', padding: '0 13px',
    fontWeight: 650, cursor: 'pointer', fontSize: 13,
  } as React.CSSProperties,
  ghost: {
    height: 38, borderRadius: 10, border: '1px solid var(--border)',
    background: 'white', color: 'var(--ink)', padding: '0 13px',
    fontWeight: 650, cursor: 'pointer', fontSize: 13,
  } as React.CSSProperties,
};

export default function DiscoveryRecoveryPage() {
  const router = useRouter();
  const [job, setJob]             = useState<OnboardingDiscoveryJob | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [candidates, setCandidates] = useState<CandidateMatch[]>([]);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [retrying, setRetrying]   = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding'); return; }

      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      setSessionId(sid);

      // Candidates stored by progress page when multiple matches found
      const raw = sessionStorage.getItem('onboarding_candidates');
      if (raw) {
        try { setCandidates(JSON.parse(raw)); } catch { /* ignore */ }
      }

      if (sid) {
        try {
          const r = await api.onboarding.getDiscovery(sid, session.access_token);
          setJob(r?.job ?? null);
          if (r?.job?.candidate_matches?.length) {
            setCandidates(prev => prev.length ? prev : (r.job.candidate_matches ?? []));
          }
        } catch { /* show error state */ }
      }
    }
    load();
  }, [router]);

  async function handleSelectCandidate(matchId: string) {
    if (!sessionId || selecting) return;
    setSelecting(matchId);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSelecting(null); return; }
    try {
      await api.onboarding.selectMatch(sessionId, matchId, session.access_token);
      sessionStorage.removeItem('onboarding_candidates');
      router.push('/onboarding/report');
    } catch { setSelecting(null); }
  }

  async function handleDescribeProduct() {
    if (!sessionId || retrying) return;
    setRetrying(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setRetrying(false); return; }
    try {
      await api.onboarding.retryDiscovery(sessionId, session.access_token);
      router.push('/onboarding/discovery/progress');
    } catch { setRetrying(false); }
  }

  const errorCode = job?.error_code ?? 'UNEXPECTED_ERROR';
  const errorCopy = ERROR_COPY[errorCode] ?? ERROR_COPY.UNEXPECTED_ERROR;

  /* ── Multiple candidates view ─────────────────────────────────────────────── */
  if (candidates.length > 0) {
    return (
      <div style={{ textAlign: 'center', maxWidth: 650, margin: 'auto', paddingTop: 25 }}>
        {/* Icon */}
        <div style={{
          width: 65, height: 65, borderRadius: 20,
          background: 'var(--amber-d)', color: 'var(--amber)',
          display: 'grid', placeItems: 'center',
          margin: '0 auto 18px', fontSize: 30, fontWeight: 850,
        }}>?</div>

        {/* Kicker */}
        <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
          Multiple matches found
        </div>

        {/* Title */}
        <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, letterSpacing: '-1px', margin: '11px 0 9px', color: 'var(--ink)' }}>
          We found a few options. Which is yours?
        </h2>

        {/* Lead */}
        <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
          Select the app you want to analyse to continue building your Growth Brain.
        </p>

        {/* Candidate list */}
        <div style={{ display: 'grid', gap: 10, textAlign: 'left', marginBottom: 20 }}>
          {candidates.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 13,
              border: '1px solid var(--border)', background: 'white',
            }}>
              {c.icon ? (
                <img src={c.icon} alt={c.name} style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: 42, height: 42, borderRadius: 10, background: 'var(--raised)',
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                  fontSize: 18, fontWeight: 900, color: 'var(--sage)',
                }}>
                  {c.name.charAt(0)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 13 }}>{c.name}</b>
                {c.description && (
                  <small style={{ display: 'block', color: 'var(--ink3)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description}
                  </small>
                )}
                {c.rating != null && (
                  <small style={{ color: 'var(--ink3)', fontSize: 11 }}>
                    ★ {c.rating.toFixed(1)}{c.review_count ? ` · ${c.review_count.toLocaleString()} reviews` : ''}
                  </small>
                )}
              </div>
              <button
                onClick={() => handleSelectCandidate(c.id)}
                disabled={!!selecting}
                style={{ ...btn.primary, cursor: selecting ? 'not-allowed' : 'pointer', flexShrink: 0 }}
              >
                {selecting === c.id ? 'Selecting…' : 'This is mine →'}
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <button onClick={() => router.push('/onboarding/discovery')} style={btn.ghost}>
            Try another link
          </button>
          <button
            onClick={handleDescribeProduct}
            disabled={retrying}
            style={{ ...btn.primary, cursor: retrying ? 'not-allowed' : 'pointer' }}
          >
            {retrying ? 'Retrying…' : 'Describe my product →'}
          </button>
        </div>
      </div>
    );
  }

  /* ── Error state view (spec fv-step[5]) ──────────────────────────────────── */
  return (
    <div style={{ textAlign: 'center', maxWidth: 650, margin: 'auto', paddingTop: 25 }}>

      {/* .error-icon */}
      <div style={{
        width: 65, height: 65, borderRadius: 20,
        background: 'var(--danger2)', color: 'var(--danger)',
        display: 'grid', placeItems: 'center',
        margin: '0 auto 18px', fontSize: 30, fontWeight: 850,
      }}>!</div>

      {/* .fv-kicker */}
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
        Discovery needs your help
      </div>

      {/* h2 */}
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, letterSpacing: '-1px', margin: '11px 0 9px', color: 'var(--ink)' }}>
        {errorCopy.title}
      </h2>

      {/* .lead */}
      <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
        {errorCopy.guidance} Your workspace and progress are safe.
      </p>

      {/* .error-options (empty — no candidates in simple error state) */}
      <div />

      {/* .report-actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={() => router.push('/onboarding/discovery')} style={btn.ghost}>
          Try another link
        </button>
        <button
          onClick={handleDescribeProduct}
          disabled={retrying}
          style={{ ...btn.primary, cursor: retrying ? 'not-allowed' : 'pointer' }}
        >
          {retrying ? 'Retrying…' : 'Describe my product →'}
        </button>
      </div>
    </div>
  );
}
