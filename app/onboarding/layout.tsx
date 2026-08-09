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

const PHASE_STAGES = [
  { key: 'account',    label: 'Create your workspace', sub: 'Save and resume safely' },
  { key: 'discover',   label: 'Discover your product',  sub: 'Public evidence first' },
  { key: 'align',      label: 'Confirm and align',      sub: 'Correct what AI inferred' },
  { key: 'boundaries', label: 'Set boundaries',          sub: 'You remain in control' },
  { key: 'direction',  label: 'Get first direction',     sub: 'A useful plan, not a setup receipt' },
];

type StepMeta = { stage: number; label: string; progress: number; confidence: number; backPath: string };

const STEP_META: Record<string, StepMeta> = {
  '/onboarding/workspace':          { stage: 0, label: 'Secure workspace setup',  progress: 12, confidence: 8,  backPath: '/' },
  '/onboarding/discovery':          { stage: 1, label: 'Product discovery',         progress: 28, confidence: 18, backPath: '/onboarding/workspace' },
  '/onboarding/discovery/progress': { stage: 1, label: 'Building Growth Brain',     progress: 38, confidence: 28, backPath: '/onboarding/discovery' },
  '/onboarding/discovery/recovery': { stage: 1, label: 'Recovery needed',           progress: 28, confidence: 18, backPath: '/onboarding/discovery' },
  '/onboarding/report':             { stage: 2, label: 'Preliminary report',         progress: 50, confidence: 58, backPath: '/onboarding/discovery' },
  '/onboarding/beliefs':            { stage: 2, label: 'Review beliefs',             progress: 56, confidence: 64, backPath: '/onboarding/report' },
  '/onboarding/audience':           { stage: 2, label: 'Align audience',             progress: 62, confidence: 68, backPath: '/onboarding/beliefs' },
  '/onboarding/context-delta':      { stage: 2, label: "What's changing?",           progress: 68, confidence: 72, backPath: '/onboarding/audience' },
  '/onboarding/goal':               { stage: 2, label: 'Define success',             progress: 73, confidence: 76, backPath: '/onboarding/context-delta' },
  '/onboarding/competitors':        { stage: 2, label: 'Confirm competitors',        progress: 78, confidence: 80, backPath: '/onboarding/goal' },
  '/onboarding/boundaries':         { stage: 3, label: 'Set working boundaries',     progress: 84, confidence: 84, backPath: '/onboarding/competitors' },
  '/onboarding/review':             { stage: 4, label: 'Final review',               progress: 88, confidence: 88, backPath: '/onboarding/boundaries' },
  '/onboarding/generating':         { stage: 4, label: 'Generating direction…',      progress: 94, confidence: 92, backPath: '/onboarding/review' },
  '/onboarding/direction':          { stage: 4, label: 'Your first direction',       progress: 97, confidence: 96, backPath: '/onboarding/review' },
  '/onboarding/complete':           { stage: 4, label: 'Product understanding ready', progress: 100, confidence: 96, backPath: '/onboarding/direction' },
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const meta     = STEP_META[pathname] ?? STEP_META['/onboarding/workspace'];

  // (no body-lock — page scrolls naturally; shell grows with content)
  const { stage, label, progress, confidence, backPath } = meta;

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
                    <small style={{ display: 'block', fontSize: 10, marginTop: 2, color: isActive ? 'rgba(255,255,255,.6)' : 'inherit' }}>{s.sub}</small>
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
              <span>Growth Brain confidence · {confidence}%</span>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
