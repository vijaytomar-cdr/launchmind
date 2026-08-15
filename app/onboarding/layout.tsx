/**
 * @file app/onboarding/layout.tsx
 * @description Phase 1 onboarding shell — spec-accurate two-panel layout.
 *   Matches fv-shell.phase1-shell from LaunchMind_Production_UX_July18_2026(15).html.
 *   Layout CSS lives in globals.css (.ob-outer / .ob-shell / .ob-side / .ob-main).
 * @security Requires auth — middleware enforces it.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  PHASE_STAGES, ALIGNMENT_COUNT, resolveStep,
} from '@/lib/onboarding/steps';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const meta     = resolveStep(pathname);

  // (no body-lock — page scrolls naturally; shell grows with content)
  const { stage, label, progress, backPath, substep } = meta;

  return (
    <div className="ob-outer">

      {/* ── Shell ── */}
      <div className="ob-shell">

        {/* ── Left panel ── */}
        <aside className="ob-side" style={{
          background: 'linear-gradient(160deg,#12241f,#18382f)',
          color: 'white',
          padding: 38,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 850 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 12,
              background: 'linear-gradient(135deg,#43ddb1,#0a8c68)',
              display: 'grid', placeItems: 'center',
              color: 'white', fontWeight: 900, fontSize: 14,
            }}>LM</div>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, letterSpacing: '-0.02em' }}>LaunchMind</span>
          </div>

          {/* Side copy — matches spec .phase-label / .phase-side-copy */}
          <div style={{ marginTop: 44 }}>
            <div style={{ color: '#57d8b1', fontSize: 10, letterSpacing: '.16em', fontWeight: 850, textTransform: 'uppercase' }}>TEACH YOUR AI CMO</div>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 33, margin: '10px 0 10px', letterSpacing: '-0.04em', lineHeight: 1.1 }}>
              Discovery + Alignment
            </h1>
            <p style={{ color: '#b8cdc5', fontSize: 15, lineHeight: 1.65, margin: 0 }}>
              LaunchMind does the research. You provide the truth only you know.
            </p>
          </div>

          {/* Phase map */}
          <div style={{ display: 'grid', gap: 7, marginTop: 36 }}>
            {PHASE_STAGES.map((s, i) => {
              const isDone   = i < stage;
              const isActive = i === stage;
              return (
                <div key={s.key} style={{
                  display: 'flex', gap: 11, padding: 11, borderRadius: 11,
                  color: isActive ? '#fff' : isDone ? '#9fdac8' : '#769289',
                  background: isActive ? 'rgba(67,221,177,.12)' : 'transparent',
                }}>
                  <div style={{
                    width: 26, height: 26,
                    border: `1px solid ${isDone ? '#168565' : 'rgba(255,255,255,.14)'}`,
                    borderRadius: 8,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                    fontSize: 10, fontWeight: 850,
                    background: isDone ? '#168565' : 'transparent',
                    color: isDone ? 'white' : 'inherit',
                  }}>
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span>
                    <b style={{ display: 'block', fontSize: 12 }}>{s.label}</b>
                    {/* §4 · the three states kept distinct: completed (✓ above),
                        currently viewing (this substep line), and not yet reached.
                        The substep is shown only on the stage being viewed, so the
                        rail describes the ROUTE rather than a persisted field that
                        may not have advanced yet. */}
                    {isActive && substep ? (
                      <small style={{ display: 'block', fontSize: 10, marginTop: 2, color: '#57d8b1', fontWeight: 700 }}>
                        Alignment {substep} of {ALIGNMENT_COUNT} — {label}
                      </small>
                    ) : (
                      <small style={{ display: 'block', fontSize: 10, marginTop: 2, color: isActive ? 'rgba(255,255,255,.6)' : 'inherit' }}>{s.sub}</small>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 'auto' }}>
            <button
              onClick={() => router.push('/dashboard/brief')}
              style={{ display: 'block', border: 0, background: 'none', color: 'rgba(255,255,255,.55)', fontWeight: 700, cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 5, fontFamily: 'inherit' }}
            >
              Save &amp; finish later
            </button>
            <span style={{ color: 'rgba(255,255,255,.35)', fontSize: 11 }}>Progress saved automatically</span>
          </div>
        </aside>

        {/* ── Right panel — scrolls as a whole (ob-main in globals.css) ── */}
        <main className="ob-main">

          {/* flow-top: back / step label / × */}
          <div className="ob-top" style={{ display: 'flex', alignItems: 'center', marginBottom: 25 }}>
            {backPath !== '/' && (
              <button
                onClick={() => router.push(backPath)}
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink3)', fontWeight: 750, padding: 0, fontSize: 13 }}
              >
                ← Back
              </button>
            )}
            <div style={{ margin: 'auto', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink3)', fontSize: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--sage)', display: 'block', flexShrink: 0 }} />
              {label}
            </div>
            <button
              onClick={() => router.push('/dashboard/brief')}
              style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink3)', fontWeight: 750, fontSize: 22, marginLeft: backPath === '/' ? 'auto' : undefined, padding: 0, lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          {/* Step content */}
          {children}

          {/* Bottom progress bar */}
          <div className="ob-prog">
            <div style={{ height: 4, background: '#edf1ef', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--sage)', width: `${progress}%`, transition: 'width .35s ease', borderRadius: 999 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink3)', fontSize: 10, marginTop: 7 }}>
              <span>{PHASE_STAGES[stage]?.label}</span>
              {/* WAS "Growth Brain confidence · N%" using a per-route literal.
                  Those numbers measured nothing — they were fixed per URL, so a
                  founder who typed one sentence and one who supplied a full
                  product history saw identical "confidence". Route position is
                  progress; calling it confidence made setup completion look like
                  knowledge. Real readiness is derived on the completion screen. */}
              <span>Step {stage + 1} of {PHASE_STAGES.length}</span>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
