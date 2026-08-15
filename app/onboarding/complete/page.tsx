/**
 * @file app/onboarding/complete/page.tsx
 * @description Onboarding complete — what LaunchMind can truthfully say it knows.
 *
 *   REPLACES A FABRICATED SCORE. This screen showed "18% → 96%" as two string
 *   literals and six hardcoded "✓" cards. Nothing was read from the session, so
 *   every founder saw the same numbers and the same claims — including
 *   "Public facts and evidence recorded" for a pre-launch product with no public
 *   presence, and "Founder corrections saved" for one with zero claims to
 *   correct. On the screen whose entire job is to establish trust.
 *
 *   TWO DIMENSIONS, NEVER MERGED. "What the founder taught us" and "what we have
 *   observed" are different questions; averaging them is what made a number
 *   sound like a measurement. Neither is shown as a percentage, because anything
 *   shaped like a score reads as one.
 *
 * @security Reads only this session's own state through the authenticated API.
 * @dependencies api.onboarding.getReadiness
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type OnboardingReadiness } from '@/lib/api';

export default function CompletePage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [readiness, setReadiness] = useState<OnboardingReadiness | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read the session id BEFORE clearing it — the summary is derived from it.
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (sid && session) {
          const r = await api.onboarding.getReadiness(sid, session.access_token);
          if (!cancelled) setReadiness(r);
        }
      } catch {
        // Non-fatal. Onboarding IS complete either way; the screen degrades to
        // the honest generic statement rather than inventing specifics.
      } finally {
        if (!cancelled) setLoaded(true);
        sessionStorage.removeItem('onboarding_session_id');
        try { localStorage.removeItem('lm_resume_hint'); } catch { /* ignore */ }
      }
    })();
    const t = setTimeout(() => setVisible(true), 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  function goToDashboard() { router.push('/dashboard/brief'); }

  const ev = readiness?.observedEvidence;
  // Colour follows real state, and is always paired with words.
  const evidenceTone =
    ev?.level === 'connected' ? { bg: 'var(--sage-d)', bd: 'var(--sage-b)', fg: 'var(--sage)' }
      : ev?.level === 'public' ? { bg: 'var(--blue2)', bd: 'var(--border2)', fg: 'var(--blue)' }
        : { bg: 'var(--raised)', bd: 'var(--border2)', fg: 'var(--ink2)' };

  const pill: React.CSSProperties = {
    borderRadius: 12, padding: '13px 15px', textAlign: 'left', border: '1px solid',
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '48px 24px',
      opacity: visible ? 1 : 0, transition: 'opacity .5s ease',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', paddingTop: 16, width: '100%' }}>

        <div style={{
          width: 68, height: 68, borderRadius: '50%',
          background: 'linear-gradient(135deg,#2ed39f,#0b8f69)',
          display: 'grid', placeItems: 'center',
          color: '#fff', fontSize: 28, fontWeight: 900,
          margin: '0 auto 18px', boxShadow: '0 12px 36px rgba(11,143,105,.22)',
        }}>✓</div>

        <div style={{
          fontSize: 10, fontWeight: 850, letterSpacing: '.14em',
          textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 10,
        }}>Discovery + Alignment complete</div>

        <h1 style={{
          fontFamily: 'Syne, sans-serif', fontSize: 30, lineHeight: 1.15,
          margin: '0 0 12px', color: 'var(--ink)',
        }}>
          Your AI CMO has enough context to start helping.
        </h1>

        {/* The one honest sentence for THIS business. */}
        <p style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.65, margin: '0 0 22px' }}>
          {readiness?.summary
            ?? (loaded
              ? 'LaunchMind understands the context you provided during setup.'
              : 'Preparing your summary…')}
        </p>

        {/* TWO DIMENSIONS, SIDE BY SIDE — never one blended figure. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 0 18px',
        }} className="lm-ready-grid">
          <div style={{ ...pill, background: 'var(--sage-d)', borderColor: 'var(--sage-b)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
              Founder context
            </div>
            <div style={{ fontSize: 15, fontWeight: 780, color: 'var(--sage)', marginTop: 3 }}>
              {readiness?.founderContext.label ?? '—'}
            </div>
            {readiness && readiness.founderContext.missing.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 3 }}>
                Still to add: {readiness.founderContext.missing.join(', ')}
              </div>
            )}
          </div>

          <div style={{ ...pill, background: evidenceTone.bg, borderColor: evidenceTone.bd }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
              Observed evidence
            </div>
            <div style={{ fontSize: 15, fontWeight: 780, color: evidenceTone.fg, marginTop: 3 }}>
              {ev?.label ?? '—'}
            </div>
            {ev && ev.sources.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 3 }}>
                {ev.sources.join(' · ')}
              </div>
            )}
          </div>
        </div>

        {/* Cards derived from persisted state, one per real fact. */}
        {readiness && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9,
            textAlign: 'left', margin: '0 0 18px',
          }} className="lm-ready-grid">
            {readiness.cards.map(card => (
              <div key={card.key} style={{
                background: 'var(--raised)', borderRadius: 10, padding: '12px 13px',
                opacity: card.present ? 1 : .75,
              }}>
                <b style={{ display: 'block', fontSize: 13, fontWeight: 750, color: 'var(--ink)', marginBottom: 3 }}>
                  {/* ✓ only when the thing genuinely exists. */}
                  {card.present ? '✓ ' : '· '}{card.title}
                </b>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', lineHeight: 1.5 }}>
                  {card.detail}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Honest about what is still missing, without implying failure. */}
        <div style={{
          background: 'var(--sage2)', border: '1px solid var(--sage3)',
          borderRadius: 11, padding: '13px 15px', fontSize: 12,
          textAlign: 'left', display: 'grid', gap: 5, margin: '0 0 18px',
        }}>
          <b style={{ color: 'var(--ink)', fontWeight: 750 }}>What &quot;complete&quot; means</b>
          <span style={{ color: 'var(--ink2)', lineHeight: 1.55 }}>
            {ev?.level === 'connected'
              ? 'LaunchMind can recommend using your confirmed context and the performance data it observes. It still asks before acting on your behalf.'
              : "You're ready to start. LaunchMind can provide positioning, strategy and draft recommendations from your confirmed context. Connect performance sources later to replace assumptions with observed results."}
          </span>
        </div>

        <button onClick={goToDashboard} style={{
          height: 48, padding: '0 22px', background: 'var(--sage)', color: '#fff',
          border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', width: '100%',
        }}>
          Open my Marketing Command Center →
        </button>
      </div>
    </div>
  );
}
