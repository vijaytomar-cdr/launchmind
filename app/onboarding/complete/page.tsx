/**
 * @file app/onboarding/complete/page.tsx
 * @description Phase 1 Step 16: Phase 1 complete.
 *   Celebration screen confirming the founder has finished onboarding.
 *   Shows confidence jump, learned items grid, and phase-complete disclosure.
 *   Clears onboarding session storage and lm_resume_hint before routing to dashboard.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const LEARNED_ITEMS = [
  { title: '✓ Product understood',        detail: 'Public facts and evidence recorded' },
  { title: '✓ Assumptions reviewed',      detail: 'Founder corrections saved' },
  { title: '✓ Future context learned',    detail: 'Next 30–90 days incorporated' },
  { title: '✓ Success made measurable',   detail: 'Baseline, target, and timeframe set' },
  { title: '✓ Boundaries confirmed',      detail: 'No execution or account access granted' },
  { title: '✓ First direction delivered', detail: '30-day supply-first sequence ready' },
];

export default function CompletePage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Clear onboarding session so a new one can start if ever triggered again
    sessionStorage.removeItem('onboarding_session_id');
    // Clear resume hint from localStorage
    try { localStorage.removeItem('lm_resume_hint'); } catch { /* ignore */ }
    // Fade in after a tick
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  function goToDashboard() {
    router.push('/dashboard/brief');
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px',
      opacity: visible ? 1 : 0, transition: 'opacity .5s ease',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', paddingTop: 16, width: '100%' }}>

        {/* Completion mark */}
        <div style={{
          width: 68, height: 68, borderRadius: '50%',
          background: 'linear-gradient(135deg,#2ed39f,#0b8f69)',
          display: 'grid', placeItems: 'center',
          color: '#fff', fontSize: 28, fontWeight: 900,
          margin: '0 auto 18px',
          boxShadow: '0 12px 36px rgba(11,143,105,.22)',
        }}>
          ✓
        </div>

        {/* Kicker */}
        <div style={{
          fontSize: 10, fontWeight: 850, letterSpacing: '.13em',
          textTransform: 'uppercase', color: 'var(--sage)',
          marginBottom: 10,
        }}>
          Discovery + Alignment complete
        </div>

        <h2 style={{
          fontFamily: 'Syne, sans-serif', fontSize: 30, fontWeight: 700,
          color: 'var(--ink)', margin: '10px 0 9px', lineHeight: 1.2,
        }}>
          Your AI CMO has enough context to start helping.
        </h2>

        <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 22px' }}>
          Product understanding is ready. LaunchMind understands your public product, your private priorities, and the boundaries within which it may work.
        </p>

        {/* Confidence jump */}
        <div style={{
          display: 'flex', gap: 18, justifyContent: 'center',
          alignItems: 'center', margin: '0 0 22px',
        }}>
          <div>
            <div style={{
              fontSize: 24, fontWeight: 900, color: 'var(--ink3)',
              fontFamily: 'DM Mono, monospace',
            }}>
              18%
            </div>
            <small style={{ fontSize: 11, color: 'var(--ink3)' }}>At signup</small>
          </div>
          <div style={{ fontSize: 22, color: 'var(--ink3)' }}>→</div>
          <div>
            <div style={{
              fontSize: 36, fontWeight: 900, color: 'var(--sage)',
              fontFamily: 'DM Mono, monospace',
            }}>
              96%
            </div>
            <small style={{ fontSize: 11, color: 'var(--ink3)' }}>After alignment</small>
          </div>
        </div>

        {/* Learned grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9,
          textAlign: 'left', margin: '0 0 18px',
        }}>
          {LEARNED_ITEMS.map(item => (
            <div key={item.title} style={{
              background: 'var(--raised)', borderRadius: 10, padding: '12px 13px',
            }}>
              <b style={{ display: 'block', fontSize: 13, fontWeight: 750, color: 'var(--ink)', marginBottom: 3 }}>
                {item.title}
              </b>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)' }}>
                {item.detail}
              </span>
            </div>
          ))}
        </div>

        {/* Phase complete disclosure */}
        <div style={{
          background: 'var(--sage2)', border: '1px solid var(--sage3)',
          borderRadius: 11, padding: '13px 15px', fontSize: 12,
          textAlign: 'left', display: 'grid', gap: 5, margin: '0 0 18px',
        }}>
          <b style={{ color: 'var(--ink)', fontWeight: 750 }}>What &quot;complete&quot; means</b>
          <span style={{ color: 'var(--ink2)', lineHeight: 1.55 }}>
            LaunchMind can provide product, market, positioning, strategy, mission, and draft recommendations using public intelligence and your confirmed context. It cannot yet observe private performance data or operate external channels.
          </span>
        </div>

        {/* CTA button */}
        <button
          onClick={goToDashboard}
          style={{
            height: 48, padding: '0 22px',
            background: 'var(--sage)', color: '#fff',
            border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            width: '100%',
          }}
        >
          Open my Marketing Command Center →
        </button>

        {/* Continuous note */}
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--ink3)' }}>
          Your answers can be changed anytime. LaunchMind will keep learning through small, contextual questions rather than another onboarding wizard.
        </div>
      </div>
    </div>
  );
}
