/**
 * @file components/launchmind/MeetAICMOModal.tsx
 * @description Full-screen cinematic "Meet Your AI CMO" experience.
 *   7 scenes, ~14 seconds. Matches LaunchMind_Production_UX_July18_2026 spec.
 *   RAF-based timer with refs (no stale closures). Pause/play, Esc/Space keyboard.
 *   Reduced-motion: static scrollable list.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const DURATIONS    = [1800, 2200, 2500, 2000, 2000, 2300, 2200]; // ms per scene
const TOTAL_MS     = DURATIONS.reduce((s, d) => s + d, 0);        // 14000 ms
const SCENE_LABELS = [
  'Why LaunchMind exists',
  'Public intelligence',
  'Your first insight',
  'Growth Brain alignment',
  'What the brain learns',
  'What your Mondays look like',
  'Trust before autonomy',
];

function fmtMs(ms: number) {
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

interface Props {
  onClose:  () => void;
  onStart?: () => void;
}

export function MeetAICMOModal({ onClose, onStart }: Props) {
  const [sceneIdx,     setSceneIdx]     = useState(0);
  const [elapsed,      setElapsed]      = useState(0);   // ms into current scene (render-only)
  const [paused,       setPaused]       = useState(false);
  const [done,         setDone]         = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  // Refs hold authoritative timer state (avoid stale closures in RAF)
  const sceneIdxRef = useRef(0);
  const elapsedRef  = useRef(0);
  const lastRef     = useRef<number | null>(null);
  const rafRef      = useRef<number | null>(null);

  const prefersReduced = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const tick = useCallback((ts: number) => {
    if (lastRef.current === null) lastRef.current = ts;
    const delta = ts - lastRef.current;
    lastRef.current = ts;

    elapsedRef.current += delta;
    const dur = DURATIONS[sceneIdxRef.current] ?? 2000;

    if (elapsedRef.current >= dur) {
      const nextIdx = sceneIdxRef.current + 1;
      if (nextIdx >= DURATIONS.length) {
        setDone(true);
        return;
      }
      elapsedRef.current  = 0;
      sceneIdxRef.current = nextIdx;
      setSceneIdx(nextIdx);
      setElapsed(0);
    } else {
      setElapsed(elapsedRef.current);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (paused || done || prefersReduced.current) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    lastRef.current = null;
    rafRef.current  = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tick, paused, done]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard: Esc = close, Space = pause/play
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setPaused(p => !p); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function replay() {
    sceneIdxRef.current = 0;
    elapsedRef.current  = 0;
    lastRef.current     = null;
    setSceneIdx(0);
    setElapsed(0);
    setDone(false);
    setPaused(false);
    setShowEvidence(false);
  }

  const totalElapsed  = DURATIONS.slice(0, sceneIdx).reduce((s, d) => s + d, 0) + elapsed;
  const totalProgress = Math.min(totalElapsed / TOTAL_MS, 1);

  // ── Reduced-motion: static list ───────────────────────────────────────────
  if (prefersReduced.current) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: '#06110e', color: '#eff9f5',
        overflow: 'auto', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        padding: '40px clamp(20px,6vw,90px)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <TopBrand />
          <button onClick={onClose} style={sCloseBtn}>×</button>
        </div>
        {SCENE_LABELS.map((label, i) => (
          <div key={i} style={{ marginBottom: 32, paddingBottom: 32, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ fontSize: 9, letterSpacing: '.2em', color: '#4be0b2', fontWeight: 900, marginBottom: 10, textTransform: 'uppercase' as const }}>Scene {i + 1}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#eff9f5' }}>{label}</div>
          </div>
        ))}
        <button onClick={() => { onStart?.(); onClose(); }} style={sCtaBtn}>Analyze My Product →</button>
      </div>
    );
  }

  // ── Full-screen cinematic experience ─────────────────────────────────────
  function sceneStyle(i: number): React.CSSProperties {
    const active = i === sceneIdx && !done;
    return {
      position:   'absolute',
      inset:      0,
      display:    'grid',
      placeItems: 'center',
      padding:    '100px clamp(20px,6vw,90px) 90px',
      opacity:    active ? 1 : 0,
      visibility: active ? 'visible' : 'hidden',
      transform:  active ? 'translateY(0) scale(1)' : 'translateY(18px) scale(.985)',
      transition: 'opacity .55s ease, transform .7s ease, visibility .55s',
    };
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Meet Your AI CMO"
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: '#06110e', color: '#eff9f5', overflow: 'hidden',
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {/* ── Top bar ── */}
        <div style={{
          position: 'absolute', zIndex: 4, top: 0, left: 0, right: 0, height: 72,
          display: 'flex', alignItems: 'center', gap: 18,
          padding: '0 clamp(18px,4vw,56px)',
          background: 'linear-gradient(180deg,rgba(6,17,14,.92),rgba(6,17,14,0))',
        }}>
          <TopBrand />
          {/* progress bar */}
          <div style={{ height: 3, flex: 1, maxWidth: 520, margin: 'auto', background: 'rgba(255,255,255,.12)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: '#34daa8',
              width: `${totalProgress * 100}%`,
              transition: paused ? 'none' : 'width .25s linear',
            }} />
          </div>
          {/* timer */}
          <div style={{ fontSize: 10, color: '#9eb2ab', minWidth: 54, textAlign: 'right' }}>
            {fmtMs(totalElapsed)} / 0:15
          </div>
          {/* close */}
          <button onClick={onClose} aria-label="Close" style={sCloseBtn}>×</button>
        </div>

        {/* ── Stage ── */}
        <div style={{ position: 'absolute', inset: 0 }}>

          {/* Scene 1 — intro */}
          <div style={sceneStyle(0)}>
            <div style={{ maxWidth: 980, textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <SceneGlow />
              <span style={sKicker}>A NEW KIND OF FIRST MEETING</span>
              <h2 style={sBigH2}>
                Every founder builds a product.<br />
                <span style={{ color: '#3bd8a7' }}>Very few build the marketing engine.</span>
              </h2>
              <p style={sSubP}>LaunchMind becomes the AI CMO that studies your business before asking to lead it.</p>
            </div>
          </div>

          {/* Scene 2 — analysis demo */}
          <div style={sceneStyle(1)}>
            <div style={sDemoCard}>
              <div style={sDemoWindow}>LaunchMind · Public product analysis</div>
              <div style={{ margin: 22, display: 'flex', gap: 10, border: '1px solid #dce4e0', borderRadius: 9, padding: '9px 9px 9px 14px', alignItems: 'center' }}>
                <span style={{ flex: 1, fontSize: 11, color: '#67736e' }}>https://apps.apple.com/your-product</span>
                <span style={{ background: '#16b987', color: '#fff', padding: '10px 14px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>Analyze</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, padding: '0 22px 22px' }}>
                {[
                  ['✓ COMPLETE', 'Reading product'],
                  ['✓ COMPLETE', 'Reading 487 reviews'],
                  ['✓ COMPLETE', 'Comparing 12 competitors'],
                  ['● THINKING',  'Finding opportunity'],
                ].map(([status, label]) => (
                  <div key={label} style={{ border: '1px solid #e0e7e3', borderRadius: 9, padding: 14, background: '#fff' }}>
                    <span style={{ display: 'block', color: '#159570', fontSize: 8, marginBottom: 8 }}>{status}</span>
                    <strong style={{ fontSize: 11 }}>{label}</strong>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 22px 22px', padding: '10px 14px', background: '#f0faf6', borderRadius: 8, border: '1px solid #d0ece1' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: '#4a6b5e' }}>Recurring objection found · comparing customer language with competitor promises…</span>
              </div>
            </div>
          </div>

          {/* Scene 3 — Growth Report */}
          <div style={sceneStyle(2)}>
            <div style={sDemoCard}>
              <div style={sDemoWindow}>Your first Growth Report</div>
              <div style={{ display: 'grid', gridTemplateColumns: '.65fr 1.35fr', gap: 24, padding: 26 }}>
                <div style={{ background: '#eaf9f3', borderRadius: 12, padding: 22, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                  <span style={{ fontSize: 9, color: '#5d6c66' }}>LAUNCH READINESS</span>
                  <strong style={{ fontSize: 64, color: '#08a276', lineHeight: 1.1 }}>82</strong>
                  <span style={{ fontSize: 9, color: '#5d6c66' }}>Evidence-backed · Sample</span>
                </div>
                <div>
                  <span style={{ fontSize: 8, color: '#079e74', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase' as const }}>Biggest opportunity</span>
                  <h3 style={{ fontSize: 20, lineHeight: 1.2, margin: '12px 0', color: '#15231e' }}>
                    Your positioning sells breadth. Your strongest proof is local reliability.
                  </h3>
                  <p style={{ fontSize: 11, color: '#66736d', lineHeight: 1.6, margin: 0 }}>
                    Competitors sell outcomes. Your page sells breadth. Lead with reliable, local completion before increasing acquisition spend.
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 15 }}>
                    {['38 reviews', '12 competitors', 'Store metadata', '92% confidence'].map(c => (
                      <span key={c} style={{ fontSize: 8, background: '#fff', border: '1px solid #dbe5e0', padding: '5px 7px', borderRadius: 999 }}>{c}</span>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowEvidence(e => !e)}
                    style={{ marginTop: 14, fontSize: 10, color: '#079e74', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600, textDecoration: 'underline' }}
                  >
                    {showEvidence ? 'Hide reasoning' : 'Why this insight?'}
                  </button>
                  {showEvidence && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0faf6', borderRadius: 8, border: '1px solid #c5e8d8', fontSize: 10, color: '#3d5c4e', lineHeight: 1.55 }}>
                      Review language repeatedly mentions trust and availability, while competitor headlines emphasize completed outcomes. LaunchMind weighted repeated customer language more heavily than feature count.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Scene 4 — chat */}
          <div style={sceneStyle(3)}>
            <div style={{ width: 'min(760px,92vw)', display: 'grid', gap: 13 }}>
              {[
                { role: 'ai',      label: 'LAUNCHMIND',           text: 'I understand the public product. I do not know your future yet. What changes next?' },
                { role: 'founder', label: 'FOUNDER',              text: 'We are launching AI workflows and moving toward team accounts.' },
                { role: 'update',  label: 'GROWTH BRAIN UPDATED', text: 'Then strategy should test team coordination—not only individual productivity.' },
              ].map(({ role, label, text }) => (
                <div key={role} style={{
                  maxWidth: '72%', padding: '15px 17px', borderRadius: 14, fontSize: 13, lineHeight: 1.5,
                  justifySelf: role === 'founder' ? 'end' : 'start',
                  background: role === 'ai' ? '#152821' : role === 'founder' ? '#2ed39f' : '#17233b',
                  color:      role === 'founder' ? '#04110d' : '#eff9f5',
                  border:     role === 'ai' ? '1px solid #27463b' : role === 'update' ? '1px solid #344462' : 'none',
                }}>
                  <span style={{ display: 'block', fontSize: 8, letterSpacing: '.12em', marginBottom: 7, opacity: .7, textTransform: 'uppercase' as const }}>{label}</span>
                  {text}
                </div>
              ))}
            </div>
          </div>

          {/* Scene 5 — Growth Brain mini viz */}
          <div style={sceneStyle(4)}>
            <div style={{ width: 'min(800px,90vw)', height: 390, position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: '15%', right: '15%', height: 1, background: 'linear-gradient(90deg,transparent,#35d7a6,transparent)', transform: 'translateY(-50%)' }} />
              <div style={{ position: 'absolute', left: '50%', top: '15%', bottom: '15%', width: 1, background: 'linear-gradient(180deg,transparent,#35d7a6,transparent)', transform: 'translateX(-50%)' }} />
              <div style={{
                position: 'absolute', width: 150, height: 150,
                left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
                background: 'radial-gradient(circle,#2bd19e,#087a5a)',
                boxShadow: '0 0 70px rgba(43,209,158,.32)',
                borderRadius: '50%', display: 'grid', placeItems: 'center', textAlign: 'center',
              }}>
                <div>
                  <strong style={{ fontSize: 16, display: 'block' }}>Growth Brain</strong>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.75)' }}>94% confidence</span>
                </div>
              </div>
              {([
                ['Audience\nconfirmed', { left: '7%',  top: '7%'    }],
                ['Competitors\nmapped', { right: '7%', top: '7%'    }],
                ['Roadmap\nlearned',    { left: '4%',  bottom: '5%' }],
                ['Boundaries\nsaved',   { right: '4%', bottom: '5%' }],
              ] as [string, React.CSSProperties][]).map(([label, pos]) => (
                <div key={label} style={{
                  position: 'absolute', width: 105, height: 105,
                  background: '#13261f', border: '1px solid #2b4a3f',
                  borderRadius: '50%', display: 'grid', placeItems: 'center',
                  textAlign: 'center', fontSize: 10, lineHeight: 1.4, ...pos,
                }}>
                  {label.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                </div>
              ))}
            </div>
          </div>

          {/* Scene 6 — Morning brief card */}
          <div style={sceneStyle(5)}>
            <div style={{ width: 'min(900px,92vw)', background: '#f8fbfa', color: '#17241f', borderRadius: 16, padding: 28, textAlign: 'left', boxShadow: '0 40px 100px rgba(0,0,0,.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 22 }}>
                <div>
                  <small style={{ fontSize: 8, color: '#098360', letterSpacing: '.12em', fontWeight: 700, display: 'block', marginBottom: 6, textTransform: 'uppercase' as const }}>Monday · 8:00 AM</small>
                  <h3 style={{ fontSize: 28, margin: '5px 0', color: '#17241f' }}>Good morning, Adam.</h3>
                  <p style={{ fontSize: 12, color: '#4a6b60', margin: 0 }}>Here is what changed—and what deserves attention.</p>
                </div>
                <div style={{ fontSize: 9, background: '#e7f8f2', color: '#0a805f', borderRadius: 999, padding: '8px 10px', height: 'max-content', whiteSpace: 'nowrap' as const }}>
                  Growth Brain 94%
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 10 }}>
                {([
                  ['SINCE LAST VISIT',  'Competitors raised team pricing.',          'This creates room for a simpler adoption story.',                        false],
                  ['MY RECOMMENDATION', 'Approve a team-workflow positioning test.', 'One landing-page variant. No campaign spend. Review in seven days.',      true],
                  ['WHY NOW',           'Customer language is shifting.',             'Mentions of team, workflow, and handoff are increasing.',                 false],
                ] as [string, string, string, boolean][]).map(([kicker, headline, body, focus]) => (
                  <div key={kicker} style={{ border: `1px solid ${focus ? '#bde8d8' : '#dfe6e2'}`, borderRadius: 10, padding: 16, background: focus ? '#eaf9f3' : 'transparent' }}>
                    <span style={{ fontSize: 8, color: '#098360', fontWeight: 700, letterSpacing: '.1em', display: 'block', marginBottom: 8, textTransform: 'uppercase' as const }}>{kicker}</span>
                    <h4 style={{ fontSize: 13, margin: '9px 0', color: '#17241f', lineHeight: 1.35 }}>{headline}</h4>
                    <p style={{ fontSize: 9, color: '#69756f', lineHeight: 1.55, margin: 0 }}>{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scene 7 — Trust ladder */}
          <div style={sceneStyle(6)}>
            <div style={{ maxWidth: 980, textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <SceneGlow />
              <span style={sKicker}>TRUST BEFORE AUTONOMY</span>
              <h2 style={sBigH2}>
                LaunchMind earns access<br />
                <span style={{ color: '#3bd8a7' }}>one capability at a time.</span>
              </h2>
              <p style={{ ...sSubP, maxWidth: 720, margin: '0 auto 32px' }}>
                Research first. Read-only intelligence when useful. Publishing, launching, and spending only after explicit approval.
              </p>
              <div style={{ width: 'min(980px,94vw)', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9, margin: '0 auto' }}>
                {([
                  ['1', 'DAY 1',           'Public intelligence', true],
                  ['2', 'FOUNDER SESSION', 'Alignment',           true],
                  ['3', 'WHEN USEFUL',     'Read-only data',      false],
                  ['4', 'AFTER APPROVAL',  'Execution',           false],
                  ['5', 'ONLY IF EARNED',  'Autonomy',            false],
                ] as [string, string, string, boolean][]).map(([num, label, text, active]) => (
                  <div key={num} style={{ background: active ? '#122c23' : '#12231d', border: `1px solid ${active ? '#30d5a3' : '#2a453b'}`, borderRadius: 10, padding: 16, textAlign: 'left' }}>
                    <div style={{ width: 25, height: 25, borderRadius: '50%', background: active ? '#2ed39f' : '#263d35', display: 'grid', placeItems: 'center', fontSize: 9, color: active ? '#04110d' : '#eff9f5', fontWeight: 700, marginBottom: 12 }}>{num}</div>
                    <small style={{ display: 'block', color: '#47d9ac', fontSize: 7, marginBottom: 7, textTransform: 'uppercase' as const }}>{label}</small>
                    <span style={{ fontSize: 10, color: '#eff9f5' }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Done state */}
          {done && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '100px clamp(20px,6vw,90px) 90px', animation: 'aiCmoRise .55s cubic-bezier(.2,.8,.2,1) both' }}>
              <div style={{ maxWidth: 600, textAlign: 'center' }}>
                <span style={sKicker}>READY</span>
                <h2 style={{ fontSize: 'clamp(32px,5vw,64px)', lineHeight: 1.05, letterSpacing: '-.04em', margin: '18px 0', color: '#eff9f5', fontWeight: 800 }}>
                  Ready to meet your own AI CMO?
                </h2>
                <p style={{ fontSize: 16, color: '#a6bbb3', lineHeight: 1.65, marginBottom: 36 }}>
                  Your first insight starts with one public link.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' as const }}>
                  <button onClick={() => { onStart?.(); onClose(); }} style={sCtaBtn}>Analyze My Product →</button>
                  <button onClick={replay} style={{ padding: '14px 20px', borderRadius: 8, background: 'rgba(255,255,255,.07)', color: '#dceae5', border: '1px solid rgba(255,255,255,.15)', fontSize: 14, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Watch again</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          position: 'absolute', zIndex: 4, left: 0, right: 0, bottom: 0,
          minHeight: 72, padding: '12px clamp(18px,4vw,56px)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(0deg,rgba(6,17,14,.96),rgba(6,17,14,0))',
        }}>
          {!done && (
            <button
              onClick={() => setPaused(p => !p)}
              style={{ height: 38, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#dceae5', borderRadius: 8, padding: '0 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif' }}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}

          {!done
            ? <span style={{ fontSize: 9, color: '#899e96' }}>{SCENE_LABELS[sceneIdx]}</span>
            : <div>
                <strong style={{ fontSize: 12, color: '#eff9f5', display: 'block' }}>Ready to meet your own AI CMO?</strong>
                <span style={{ fontSize: 10, color: '#a6bbb3' }}>Your first insight starts with one public link.</span>
              </div>
          }

          <button
            onClick={() => { onStart?.(); onClose(); }}
            style={{ ...sCtaBtn, marginLeft: 'auto', height: 42, padding: '0 17px', fontSize: 13, whiteSpace: 'nowrap' as const }}
          >
            Analyze My Product →
          </button>
        </div>
      </div>

      <style>{`
        @keyframes aiCmoRise {
          from { opacity: 0; transform: translateY(24px) scale(.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function TopBrand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 850, flexShrink: 0 }}>
      <div style={{ width: 31, height: 31, borderRadius: 9, background: '#2ed39f', color: '#04110d', display: 'grid', placeItems: 'center', fontSize: 11 }}>LM</div>
      <span style={{ fontSize: 13, color: '#eff9f5' }}>Meet Your AI CMO</span>
    </div>
  );
}

function SceneGlow() {
  return (
    <div style={{
      position: 'absolute', width: 520, height: 520, borderRadius: '50%',
      background: 'radial-gradient(circle,rgba(48,210,159,.16),transparent 68%)',
      filter: 'blur(8px)', top: '10%', right: '3%', pointerEvents: 'none',
    }} />
  );
}

// ── Style constants ───────────────────────────────────────────────────────────

const sKicker: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.2em', color: '#4be0b2', fontWeight: 900,
  textTransform: 'uppercase', display: 'block',
};

const sBigH2: React.CSSProperties = {
  fontSize: 'clamp(38px,6vw,78px)', lineHeight: 1.02, letterSpacing: '-.055em',
  margin: '18px 0', color: '#eff9f5', fontWeight: 800,
};

const sSubP: React.CSSProperties = {
  fontSize: 'clamp(14px,1.7vw,19px)', lineHeight: 1.65, color: '#a6bbb3',
};

const sCloseBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: '50%',
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(255,255,255,.05)',
  color: '#fff', cursor: 'pointer', fontSize: 17,
  display: 'grid', placeItems: 'center', flexShrink: 0,
};

const sCtaBtn: React.CSSProperties = {
  padding: '14px 28px', borderRadius: 8,
  background: '#2ed39f', color: '#04110d',
  border: 'none', fontSize: 15, fontWeight: 900,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
};

const sDemoCard: React.CSSProperties = {
  width: 'min(860px,92vw)', background: '#f8fbfa', color: '#15231e',
  border: '1px solid rgba(255,255,255,.17)', borderRadius: 16,
  boxShadow: '0 40px 120px rgba(0,0,0,.38)', overflow: 'hidden', textAlign: 'left',
};

const sDemoWindow: React.CSSProperties = {
  height: 38, background: '#1d2944', color: '#8d9ab0',
  display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 9,
};
