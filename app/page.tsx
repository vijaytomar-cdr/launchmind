/**
 * @file app/page.tsx
 * @description Cinematic marketing homepage.
 *   Matches LaunchMind_Production_UX_July18_2026(15).html — lm-cinematic-scroll spec.
 *   Sections: hero · promise · discovery · report · teach · brain · morning · trust · evolution · final.
 * @security No auth required. Public page — visible to all. Authenticated users who click "Log in" are redirected to /dashboard by middleware.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MeetAICMOModal } from '@/components/launchmind/MeetAICMOModal';

// ── Reveal hook ───────────────────────────────────────────────────────────────

function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('cr-visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    );
    document.querySelectorAll('.cr').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ── Shared constants ──────────────────────────────────────────────────────────

const SAGE   = '#2ed39f';
const DARK   = '#07120f';
const DARKER = '#050d0b';

const eyebrow: React.CSSProperties = {
  display: 'inline-block', fontSize: 10, letterSpacing: '0.2em', color: '#54e0b5',
  fontWeight: 900, marginBottom: 22, textTransform: 'uppercase',
};

const scene: React.CSSProperties = {
  minHeight: '100vh', position: 'relative', display: 'grid', alignContent: 'center',
  padding: 'clamp(100px,10vh,140px) max(28px,calc((100vw - 1120px)/2)) clamp(80px,8vh,120px)',
  overflow: 'hidden',
};

const cineH2: React.CSSProperties = {
  fontSize: 'clamp(38px,5vw,68px)', lineHeight: 1.04, letterSpacing: '-0.045em',
  margin: 0, fontWeight: 800,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [heroUrl,   setHeroUrl]   = useState('');
  const [bottomUrl, setBottomUrl] = useState('https://apps.apple.com/us/app/allignx/id6621240477');

  useReveal();

  function goAnalyze(u: string) {
    const q = u.trim();
    router.push(q ? `/signup?url=${encodeURIComponent(q)}` : '/signup');
  }

  return (
    <div style={{
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: DARK, color: '#eef8f4', lineHeight: 1.6, fontSize: 15,
    }}>
      {/* Reveal styles */}
      <style>{`
        .cr { opacity: 0; transform: translateY(42px); transition: opacity .9s ease, transform .9s cubic-bezier(.22,.75,.23,1); }
        .cr-visible { opacity: 1 !important; transform: none !important; }
        @keyframes scrollCue { 0%{transform:scaleY(.2);transform-origin:top} 50%{transform:scaleY(1);transform-origin:top} 100%{transform:scaleY(.2);transform-origin:bottom} }
        @keyframes loadBar { from{width:0} }
        @keyframes brainDash { to{stroke-dashoffset:-100} }
        @keyframes brainPulse { 0%,100%{opacity:.4} 50%{opacity:1} }
      `}</style>

      {/* Meet Your AI CMO modal */}
      {showModal && (
        <MeetAICMOModal
          onClose={() => setShowModal(false)}
          onStart={() => {
            const q = heroUrl.trim();
            router.push(q ? `/signup?url=${encodeURIComponent(q)}` : '/signup');
          }}
        />
      )}

      {/* ── NAV ── */}
      <header style={{
        height: 72, position: 'fixed', top: 0, left: 0, right: 0, zIndex: 80,
        display: 'flex', alignItems: 'center',
        padding: '0 max(24px,calc((100vw - 1240px)/2))',
        background: 'rgba(7,18,15,0.72)', backdropFilter: 'blur(18px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 11,
            background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
            display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, color: '#fff',
            boxShadow: '0 8px 25px rgba(47,211,159,.25)',
          }}>LM</div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em' }}>
            Launch<span style={{ color: '#4adbb0' }}>Mind</span>
          </span>
        </div>

        <nav style={{ display: 'flex', gap: 28, margin: '0 auto' }}>
          {[
            ['How it works','#cinePromise'],['Growth Brain','#cineBrain'],
            ['Trust','#cineTrust'],['Journey','#cineEvolution'],
          ].map(([label, href]) => (
            <a key={label} href={href} style={{
              color: '#9db2aa', textDecoration: 'none', fontSize: 12, fontWeight: 700,
            }}>{label}</a>
          ))}
        </nav>

        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/login" style={{
            height: 38, display: 'flex', alignItems: 'center', padding: '0 16px',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent', color: '#c7d8d2', fontSize: 13, fontWeight: 600,
            textDecoration: 'none', cursor: 'pointer',
          }}>Log in</a>
          <button onClick={() => router.push('/signup')} style={{
            height: 38, padding: '0 16px', borderRadius: 8, border: 0,
            background: SAGE, color: '#04110d', fontSize: 13, fontWeight: 900, cursor: 'pointer',
          }}>Analyze my product</button>
        </div>
      </header>

      {/* ── HERO ── */}
      <section id="homeStory" style={{
        ...scene,
        textAlign: 'center', placeItems: 'center',
        background: 'radial-gradient(circle at 50% 36%,rgba(40,212,157,.16),transparent 32%),linear-gradient(180deg,#07120f,#0a1713)',
      }}>
        {/* Orbs */}
        <div style={{ position:'absolute', width:380, height:380, borderRadius:'50%', filter:'blur(3px)', opacity:.55, background:'radial-gradient(circle,rgba(54,214,165,.28),transparent 65%)', top:'4%', right:'6%' }} />
        <div style={{ position:'absolute', width:320, height:320, borderRadius:'50%', filter:'blur(3px)', opacity:.55, background:'radial-gradient(circle,rgba(87,102,236,.18),transparent 65%)', bottom:'4%', left:'5%' }} />

        <div className="cr" style={{ maxWidth: 980, position: 'relative', zIndex: 2 }}>
          <span style={eyebrow}>YOUR PRODUCT ALREADY HAS A BUILDER</span>
          <h1 style={{
            fontSize: 'clamp(48px,7.4vw,96px)', lineHeight: 0.98,
            letterSpacing: '-0.06em', margin: 0, fontWeight: 800,
          }}>
            You built the product.<br />
            <em style={{ fontStyle: 'normal', color: '#44d8aa' }}>We&apos;ll build the marketing engine.</em>
          </h1>
          <p style={{ maxWidth: 700, margin: '26px auto 0', color: '#a8bbb4', fontSize: 17, lineHeight: 1.65 }}>
            No prompt engineering. No agency dependency. No marketing degree.
            Just an AI CMO that studies your business before asking for access.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, margin: '34px 0 15px' }}>
            <button onClick={() => router.push('/signup')} style={{
              border: 0, background: SAGE, color: '#04110d', borderRadius: 9,
              padding: '15px 22px', fontWeight: 900, cursor: 'pointer',
              boxShadow: '0 14px 40px rgba(46,211,159,.2)', fontSize: 15,
              fontFamily: 'inherit',
            }}>Analyze my product</button>
            <button onClick={() => setShowModal(true)} style={{
              border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.04)',
              color: '#eaf4f0', borderRadius: 9, padding: '14px 20px',
              fontWeight: 750, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
            }}>Meet Your AI CMO →</button>
          </div>
          <small style={{ color: '#789087', fontSize: 12 }}>
            Public data first · No credit card · No account connections
          </small>
        </div>

        {/* Scroll cue */}
        <div style={{
          position: 'absolute', bottom: 26, display: 'grid', gap: 9,
          placeItems: 'center', color: '#698178', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          <span>Scroll through the founder journey</span>
          <i style={{ width: 1, height: 36, background: 'linear-gradient(#38d4a3,transparent)', animation: 'scrollCue 1.8s infinite', display:'block' }} />
        </div>
      </section>

      {/* ── PROMISE ── */}
      <section id="cinePromise" style={{ ...scene, background: '#eef4f1', color: '#12231d' }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={{ ...eyebrow, color: '#0b8f69' }}>IN ABOUT 40 SECONDS</span>
          <h2 style={cineH2}>LaunchMind does the homework<br />founders never have time to finish.</h2>
          <p style={{ maxWidth: 700, margin: '26px auto 0', color: '#66766f', fontSize: 17, lineHeight: 1.65 }}>
            Paste one public product link. Watch LaunchMind turn scattered market signals into a useful first point of view—before signup.
          </p>
        </div>
        <div className="cr" style={{
          width: 'min(780px,100%)', margin: 'auto', background: '#fff',
          border: '1px solid #dce6e1', borderRadius: 22, padding: 24,
          boxShadow: '0 35px 80px rgba(17,51,40,.12)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#f3f6f4', border: '1px solid #dce4df', borderRadius: 11,
            padding: 14, color: '#718078',
          }}>
            <span style={{ fontSize: 13 }}>apps.apple.com/your-product</span>
            <span style={{
              background: '#1ac08c', color: '#fff', padding: '8px 12px',
              borderRadius: 7, fontWeight: 800, fontSize: 13,
            }}>Analyze</span>
          </div>
          <div style={{ height: 5, background: '#e8efeb', borderRadius: 999, margin: '20px 0', overflow: 'hidden' }}>
            <div style={{
              width: '92%', height: '100%',
              background: 'linear-gradient(90deg,#21b987,#56dfb6)',
              animation: 'loadBar 2.5s ease both', borderRadius: 999,
            }} />
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            {[
              { label: 'Reading product page',         sub: 'Positioning, screenshots, pricing', done: true },
              { label: 'Reading customer language',    sub: 'Reviews, objections, outcomes',     done: true },
              { label: 'Finding competitors',          sub: 'Direct, indirect, attention rivals', done: true },
              { label: 'Building Growth Brain',        sub: 'Facts, assumptions, confidence',    done: true },
              { label: 'Prioritizing first opportunity', sub: 'Evidence-weighted recommendation', done: false },
            ].map(({ label, sub, done }) => (
              <div key={label} style={{
                display: 'grid', gridTemplateColumns: '28px 1fr', alignItems: 'center',
                gap: 10, padding: 11, borderRadius: 9,
                background: done ? 'transparent' : '#f3faf7',
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'grid',
                  placeItems: 'center', background: '#dcf7ed', color: '#0d8e68',
                  fontSize: 11, fontWeight: 900,
                }}>
                  {done ? '✓' : '●'}
                </span>
                <div>
                  <b style={{ fontSize: 13, fontWeight: 700, color: '#13231d' }}>{label}</b>
                  <small style={{ display: 'block', color: '#87938d', fontSize: 11, marginTop: 1 }}>{sub}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DISCOVERY ── */}
      <section style={{ ...scene, background: '#f8fbf9', color: '#13231d' }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={{ ...eyebrow, color: '#0b8f69' }}>DISCOVERY</span>
          <h2 style={cineH2}>It does not tell you it understands.<br />It shows you what it found.</h2>
        </div>
        <div className="cr" style={{
          width: 'min(980px,100%)', margin: 'auto', background: '#fff',
          border: '1px solid #dee7e2', borderRadius: 22, padding: 25,
          boxShadow: '0 32px 80px rgba(17,51,40,.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, borderBottom: '1px solid #e6ece8', paddingBottom: 20 }}>
            <div style={{
              width: 50, height: 50, borderRadius: 14, background: '#132820',
              color: '#51dfb2', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22,
            }}>A</div>
            <div style={{ flex: 1 }}>
              <small style={{ color: '#0b8f69', fontSize: 9, fontWeight: 850, letterSpacing: '0.12em' }}>PRODUCT FOUND</small>
              <h3 style={{ fontSize: 22, margin: '3px 0', fontWeight: 800 }}>AllignX</h3>
              <p style={{ color: '#77847e', margin: 0, fontSize: 13 }}>Home-services marketplace · Arizona</p>
            </div>
            <strong style={{ fontSize: 28, color: '#0b8f69', textAlign: 'right' }}>
              92%<small style={{ display: 'block', color: '#7e8b85', fontSize: 11, fontWeight: 500 }}>match</small>
            </strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
            {[
              { label: 'CATEGORY',          value: 'Local services marketplace', note: 'Fact' },
              { label: 'PRIMARY AUDIENCE',   value: 'Busy homeowners',           note: 'Inference · 84%' },
              { label: 'COMPETITORS',        value: 'Thumbtack · Angi · Taskrabbit', note: '12 mapped' },
              { label: 'LIKELY CONSTRAINT',  value: 'Provider density before demand', note: 'Inference · 78%' },
            ].map(({ label, value, note }) => (
              <div key={label} style={{ background: '#f5f8f6', borderRadius: 12, padding: 17 }}>
                <small style={{ color: '#89958f', fontSize: 9, fontWeight: 850, letterSpacing: '0.12em' }}>{label}</small>
                <b style={{ display: 'block', fontSize: 15, margin: '7px 0', fontWeight: 700 }}>{value}</b>
                <span style={{ fontSize: 10, color: '#0b8f69' }}>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── REPORT ── */}
      <section style={{
        ...scene,
        background: 'radial-gradient(circle at 50% 50%,rgba(55,213,165,.12),transparent 38%),#081411',
      }}>
        <div className="cr" style={{
          width: 'min(950px,100%)', margin: 'auto',
          border: '1px solid rgba(255,255,255,.13)',
          background: 'rgba(18,36,30,.78)', backdropFilter: 'blur(18px)',
          borderRadius: 26, padding: 38, boxShadow: '0 40px 100px rgba(0,0,0,.3)',
        }}>
          <div style={{ color: '#53deb3', fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            YOUR FIRST GROWTH REPORT
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid rgba(255,255,255,.1)', padding: '22px 0' }}>
            <span style={{ color: '#9bb0a8', fontSize: 14 }}>Launch readiness</span>
            <strong style={{ fontSize: 54, fontWeight: 800 }}>
              82<small style={{ fontSize: 17, color: '#789087', fontWeight: 400 }}>/100</small>
            </strong>
          </div>
          <div style={{ padding: '34px 0' }}>
            <small style={{ color: '#53deb3', fontWeight: 850, fontSize: 10, letterSpacing: '0.12em' }}>BIGGEST OPPORTUNITY</small>
            <h2 style={{ fontSize: 'clamp(34px,4.5vw,58px)', lineHeight: 1.07, letterSpacing: '-0.04em', margin: '12px 0', fontWeight: 800 }}>
              Your positioning sells breadth.<br />Your strongest proof is local reliability.
            </h2>
            <p style={{ color: '#a9bab4', maxWidth: 760, lineHeight: 1.65, fontSize: 15 }}>
              Start with one high-intent market and make serviceability the promise before increasing acquisition spend.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['38 reviews', '12 competitors', 'Store metadata', 'Website copy'].map((chip) => (
              <span key={chip} style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(255,255,255,.07)', fontSize: 10 }}>{chip}</span>
            ))}
            <b style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(47,211,159,.15)', color: '#53deb3', fontSize: 10 }}>92% confidence</b>
          </div>
          <div style={{ marginTop: 22, color: '#758b83', fontSize: 10 }}>
            Value delivered before signup, integrations, or a sales call.
          </div>
        </div>
      </section>

      {/* ── TEACH ── */}
      <section style={{ ...scene, background: '#f2f6f4', color: '#13231d' }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={{ ...eyebrow, color: '#0b8f69' }}>TEACH YOUR AI CMO</span>
          <h2 style={cineH2}>LaunchMind already knows the public story.<br />Now teach it what only the founder knows.</h2>
        </div>
        <div className="cr" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: 'min(850px,100%)', margin: '0 auto 26px' }}>
          {[
            {
              label: 'ALREADY DISCOVERED',
              items: ['✓ Product', '✓ Competitors', '✓ Reviews', '✓ Pricing', '✓ Positioning'],
              green: true,
            },
            {
              label: 'ONLY YOU CAN TEACH',
              items: ['Next launch', 'Private strategy', 'Success target', 'Non-negotiables', 'Approval boundaries'],
              green: false,
            },
          ].map(({ label, items, green }) => (
            <div key={label} style={{
              background: '#fff', border: '1px solid #dfe7e2', borderRadius: 16, padding: 22,
              display: 'grid', gap: 10,
            }}>
              <small style={{ color: '#89958f', fontWeight: 850, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</small>
              {items.map((item) => (
                <span key={item} style={{ fontWeight: 700, color: green ? '#14795e' : '#13231d', fontSize: 14 }}>{item}</span>
              ))}
            </div>
          ))}
        </div>
        <div className="cr" style={{ width: 'min(740px,100%)', margin: 'auto', display: 'grid', gap: 12 }}>
          {[
            { role: 'LAUNCHMIND', text: 'What changes in the next 30–90 days?', type: 'ai' },
            { role: 'FOUNDER', text: 'We are launching AI workflows and moving toward team accounts.', type: 'founder' },
            { role: 'GROWTH BRAIN UPDATED', text: 'Then the strategy should test team coordination—not only individual productivity.', type: 'update' },
          ].map(({ role, text, type }) => (
            <div key={role} style={{
              maxWidth: '74%', padding: '16px 18px', borderRadius: 18, lineHeight: 1.5, fontSize: 14,
              marginLeft: type === 'founder' ? 'auto' : undefined,
              background: type === 'ai' ? '#122820' : type === 'update' ? '#dff5ed' : '#fff',
              color: type === 'ai' ? '#eaf5f1' : type === 'update' ? '#12352a' : '#13231d',
              border: type === 'founder' ? '1px solid #dce5e0' : undefined,
              borderBottomLeftRadius: type !== 'founder' ? 4 : undefined,
              borderBottomRightRadius: type === 'founder' ? 4 : undefined,
            }}>
              <small style={{ display: 'block', fontSize: 8, fontWeight: 900, marginBottom: 6, letterSpacing: '0.12em', color: type === 'ai' ? '#54dab3' : type === 'update' ? '#0b8f69' : '#89958f' }}>{role}</small>
              {text}
            </div>
          ))}
        </div>
      </section>

      {/* ── BRAIN ── */}
      <section id="cineBrain" style={{ ...scene, background: DARK }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={eyebrow}>THE GROWTH BRAIN</span>
          <h2 style={{ ...cineH2, color: '#eef8f4' }}>A living model of your business—<br />not a folder of prompts.</h2>
          <p style={{ maxWidth: 700, margin: '26px auto 0', color: '#94aaa2', fontSize: 17, lineHeight: 1.65 }}>
            Every node has evidence, confidence, history, and a reason it changed.
          </p>
        </div>
        <div className="cr" style={{ width: 'min(920px,100%)', height: 400, margin: 'auto', position: 'relative' }}>
          {/* SVG connection lines */}
          <svg viewBox="0 0 920 400" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {/* Cross-connections between outer nodes */}
            <path d="M184 85 L460 58" stroke="rgba(52,211,153,0.2)" strokeWidth="1" fill="none" />
            <path d="M736 85 L756 277" stroke="rgba(52,211,153,0.2)" strokeWidth="1" fill="none" />
            <path d="M164 277 L460 342" stroke="rgba(52,211,153,0.2)" strokeWidth="1" fill="none" />
            <g stroke="rgba(74,221,177,.38)" strokeWidth="2" fill="none" strokeDasharray="8 8" style={{ animation: 'brainDash 10s linear infinite' }}>
              <path d="M460 200 L184 90" /><path d="M460 200 L460 55" /><path d="M460 200 L736 90" />
              <path d="M460 200 L164 310" /><path d="M460 200 L460 345" /><path d="M460 200 L756 310" />
            </g>
          </svg>
          {/* Nodes */}
          {[
            { key:'center', label:'Growth Brain', sub:'91% confidence', pos:{ left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:190,height:100,borderColor:'#44d8aa',boxShadow:'0 0 80px rgba(53,214,165,.2)' } },
            { key:'n1', label:'Audience', sub:'Founder-confirmed',    pos:{ left:'8%',   top:'7%'  } },
            { key:'n2', label:'Positioning', sub:'Public evidence',    pos:{ left:'50%',  top:'0',   transform:'translateX(-50%)' } },
            { key:'n3', label:'Competitors', sub:'12 mapped',          pos:{ right:'7%',  top:'7%'  } },
            { key:'n4', label:'Roadmap', sub:'Private context',        pos:{ left:'5%',   bottom:'8%' } },
            { key:'n5', label:'Goals', sub:'Target + timeframe',       pos:{ left:'50%',  bottom:'0', transform:'translateX(-50%)' } },
            { key:'n6', label:'Boundaries', sub:'Explicit control',    pos:{ right:'5%',  bottom:'8%' } },
          ].map(({ key, label, sub, pos }) => (
            <div key={key} style={{
              position: 'absolute', width: 150, minHeight: 74,
              border: '1px solid rgba(74,221,177,.25)', background: 'rgba(16,38,31,.88)',
              borderRadius: 16, display: 'grid', placeContent: 'center',
              textAlign: 'center', boxShadow: '0 0 50px rgba(45,210,159,.08)',
              ...pos,
            }}>
              <b style={{ fontSize: key === 'center' ? 18 : 14, color: key === 'center' ? '#51deb3' : '#eef8f4', fontWeight: 800 }}>{label}</b>
              <span style={{ color: '#7e9a91', fontSize: 9, marginTop: 5 }}>{sub}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── MORNING ── */}
      <section style={{ ...scene, background: '#f1f5f3', color: '#14231e' }}>
        <div className="cr" style={{
          width: 'min(1040px,100%)', margin: 'auto', background: '#fff',
          border: '1px solid #dde6e1', borderRadius: 24, padding: 30,
          boxShadow: '0 35px 80px rgba(17,51,40,.1)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e3e9e5', paddingBottom: 24 }}>
            <div>
              <small style={{ color: '#0b8f69', fontWeight: 850, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>MONDAY · 8:00 AM</small>
              <h2 style={{ fontSize: 38, margin: '7px 0', fontWeight: 800, letterSpacing: '-0.03em' }}>Good morning, Adam.</h2>
              <p style={{ color: '#73817a', margin: 0, fontSize: 14 }}>Here is what changed—and what deserves your attention.</p>
            </div>
            <span style={{
              height: 'max-content', background: '#e3f7f0', color: '#0b8f69',
              padding: '8px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
            }}>Growth Brain 94%</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 12, marginTop: 22 }}>
            {[
              { label: 'SINCE YOUR LAST VISIT', title: 'Competitors increased team-plan pricing.', body: 'This strengthens your opportunity to lead with simpler team adoption.', recommended: false },
              { label: 'MY RECOMMENDATION',      title: 'Approve a team-workflow positioning test.', body: 'One landing-page variant. No campaign spend. Review results in seven days.', recommended: true  },
              { label: 'WHY NOW',               title: 'Customer language is shifting.',            body: 'Mentions of "team," "workflow," and "handoff" rose across recent reviews.', recommended: false },
            ].map(({ label, title, body, recommended }) => (
              <article key={label} style={{
                background: recommended ? '#10271f' : '#f5f8f6',
                borderRadius: 14, padding: 20,
                color: recommended ? '#fff' : '#13231d',
              }}>
                <small style={{ color: recommended ? '#53deb3' : '#0b8f69', fontWeight: 850, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</small>
                <h3 style={{ fontSize: 15, margin: '10px 0', fontWeight: 700, lineHeight: 1.3 }}>{title}</h3>
                <p style={{ color: recommended ? '#9eb2aa' : '#7d8983', lineHeight: 1.5, fontSize: 12, margin: 0 }}>{body}</p>
                {recommended && (
                  <button style={{
                    marginTop: 14, border: 0, background: SAGE, color: DARK,
                    padding: '10px', borderRadius: 8, fontWeight: 800, cursor: 'pointer',
                    fontSize: 12, fontFamily: 'inherit', width: '100%',
                  }}>Review recommendation →</button>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST ── */}
      <section id="cineTrust" style={{ ...scene, background: '#fff', color: '#13231d' }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={{ ...eyebrow, color: '#0b8f69' }}>ACCESS IS EARNED</span>
          <h2 style={cineH2}>A real CMO earns responsibility.<br />LaunchMind should too.</h2>
          <p style={{ maxWidth: 700, margin: '26px auto 0', color: '#6e7b75', fontSize: 17, lineHeight: 1.65 }}>
            Observation, editing, publishing, launching, and spending are separate permissions—never one &quot;connect everything&quot; request.
          </p>
        </div>
        <div className="cr" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, width: 'min(1040px,100%)', margin: 'auto' }}>
          {[
            { n: '1', label: 'DAY 1',          title: 'Public intelligence',  body: 'No account access.', on: true  },
            { n: '2', label: 'FOUNDER SESSION', title: 'Alignment',            body: 'Goals and boundaries.', on: true  },
            { n: '3', label: 'WHEN USEFUL',     title: 'Read-only intelligence', body: 'Revenue and performance.', on: false },
            { n: '4', label: 'AFTER APPROVAL',  title: 'Execution',            body: 'Action-specific access.', on: false },
            { n: '5', label: 'ONLY IF EARNED',  title: 'Autonomy',             body: 'Budgets and policies.', on: false },
          ].map(({ n, label, title, body, on }) => (
            <article key={n} style={{
              border: '1px solid', borderColor: on ? '#10271f' : '#dfe6e2',
              borderRadius: 15, padding: 20, minHeight: 190,
              background: on ? '#10271f' : '#fff',
              color: on ? '#fff' : '#13231d',
            }}>
              <b style={{
                width: 31, height: 31, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: on ? SAGE : '#edf2ef', color: on ? DARK : '#13231d',
                fontSize: 14, fontWeight: 900,
              }}>{n}</b>
              <small style={{ display: 'block', color: on ? '#9eb2aa' : '#8b9791', fontSize: 8, margin: '19px 0 7px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</small>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{title}</h3>
              <p style={{ color: on ? '#9eb2aa' : '#85918b', fontSize: 11, lineHeight: 1.5, margin: 0 }}>{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── EVOLUTION ── */}
      <section id="cineEvolution" style={{ ...scene, background: '#0a1713' }}>
        <div className="cr" style={{ maxWidth: 850, textAlign: 'center', margin: '0 auto 55px' }}>
          <span style={eyebrow}>YOUR AI CMO EVOLVES WITH YOU</span>
          <h2 style={{ ...cineH2, color: '#eef8f4' }}>It begins with understanding.<br />It compounds through learning.</h2>
        </div>
        <div className="cr" style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto 1fr auto 1fr auto 1fr auto 1fr auto',
          alignItems: 'center', gap: 10, width: 'min(1040px,100%)', margin: 'auto',
        }}>
          {[
            { b: 'Day 1', span: 'Discovery' },
            null,
            { b: 'Session 1', span: 'Founder alignment' },
            null,
            { b: 'Week 1', span: 'Morning Brief' },
            null,
            { b: 'When ready', span: 'Campaign learning' },
            null,
            { b: 'As you grow', span: 'Customer + revenue learning' },
            null,
            { b: 'Earned', span: 'AI CMO' },
          ].map((item, i) =>
            item === null ? (
              <i key={i} style={{ height: 1, background: 'linear-gradient(90deg,#2dd19d,#315046)' }} />
            ) : (
              <div key={i} style={{ textAlign: 'center' }}>
                <b style={{ display: 'block', color: '#52deb3', fontSize: 11, fontWeight: 700 }}>{item.b}</b>
                <span style={{ display: 'block', fontSize: 12, marginTop: 7, color: '#eef8f4' }}>{item.span}</span>
              </div>
            )
          )}
        </div>

        {/* Share proof */}
        <div className="cr" style={{
          marginTop: 80, border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: 26,
          display: 'grid', gridTemplateColumns: '1fr 320px', gap: 30, alignItems: 'center',
          background: 'rgba(255,255,255,.03)', width: 'min(1040px,100%)', margin: '80px auto 0',
        }}>
          <div>
            <small style={{ color: '#52deb3', fontWeight: 850, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>BUILT-IN GROWTH LOOP</small>
            <h3 style={{ fontSize: 28, margin: '10px 0', fontWeight: 800, lineHeight: 1.2 }}>Founders share insights about themselves—not software.</h3>
            <p style={{ color: '#8fa59d', lineHeight: 1.6, fontSize: 14 }}>
              Turn your readiness score, Growth Brain confidence, and biggest opportunity into a founder-controlled share card with a referral link.
            </p>
          </div>
          <div style={{ background: '#fff', color: '#13231d', borderRadius: 16, padding: 20, display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#718078' }}>LaunchMind Growth Report</span>
            <strong style={{ fontSize: 42, color: '#0b8f69', fontWeight: 800 }}>82<small style={{ fontSize: 14, color: '#6d7888', fontWeight: 400 }}>/100</small></strong>
            <b style={{ fontSize: 14, fontWeight: 700 }}>7 opportunities discovered</b>
            <em style={{ fontSize: 10, color: '#87938d', fontStyle: 'normal' }}>Example · You choose what is public</em>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{
        ...scene,
        textAlign: 'center', placeItems: 'center',
        background: 'radial-gradient(circle at 50% 40%,rgba(47,211,159,.18),transparent 35%),#07120f',
      }}>
        <div className="cr" style={{ maxWidth: 760 }}>
          <span style={eyebrow}>MEET YOUR AI CMO</span>
          <h2 style={{ ...cineH2, color: '#eef8f4' }}>You are one product link away from<br />meeting your AI CMO.</h2>
          <p style={{ maxWidth: 700, margin: '26px auto 0', color: '#a8bbb4', fontSize: 17, lineHeight: 1.65 }}>
            Paste a public product URL. Get a useful first finding before you decide whether to create an account.
          </p>
          <div style={{
            display: 'flex', maxWidth: 760, margin: '32px auto 14px',
            background: '#fff', padding: 6, borderRadius: 12,
          }}>
            <input
              type="url"
              value={bottomUrl}
              onChange={(e) => setBottomUrl(e.target.value)}
              placeholder="https://apps.apple.com/us/app/your-app"
              style={{
                flex: 1, border: 0, padding: '0 14px', fontSize: 13, outline: 'none',
                borderRadius: 8, color: '#13231d', background: 'transparent', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => goAnalyze(bottomUrl)}
              style={{
                border: 0, background: SAGE, color: DARK, borderRadius: 8,
                padding: '12px 18px', fontWeight: 900, cursor: 'pointer',
                fontSize: 14, fontFamily: 'inherit',
                boxShadow: '0 14px 40px rgba(46,211,159,.2)',
              }}
            >Analyze my product →</button>
          </div>
          <small style={{ color: '#789087', fontSize: 12 }}>
            No credit card · Public data only · You control what happens next
          </small>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        padding: '42px max(28px,calc((100vw - 1120px)/2))',
        background: DARKER, borderTop: '1px solid rgba(255,255,255,.08)',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', gap: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
            display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 11, color: '#fff',
          }}>LM</div>
          <span style={{ fontSize: 15, fontWeight: 800 }}>
            Launch<span style={{ color: '#4adbb0' }}>Mind</span>
          </span>
        </div>
        <p style={{ color: '#83978f', fontSize: 13, textAlign: 'center', margin: 0 }}>
          Your product already has a CTO. It deserves a CMO too.
        </p>
        <small style={{ color: '#60746d', fontSize: 12 }}>
          © 2026 LaunchMind · Discover first. Confirm second. Learn continuously.
        </small>
      </footer>
    </div>
  );
}
