/**
 * @file app/page.tsx
 * @description Public marketing landing page + waitlist signup.
 *   Matches launchmind-homepage.html reference exactly.
 *   Authenticated users redirected to /dashboard via middleware.
 * @security No auth required. Email submitted to POST /waitlist.
 */

'use client';

import { useState } from 'react';
import {
  IconSparkles, IconRoute, IconBrandWhatsapp, IconFileAnalytics,
  IconRefresh, IconBook, IconLock, IconKey, IconShield, IconEyeOff,
  IconChevronRight, IconCheck, IconX, IconPlayerPlay, IconShieldCheck,
  IconCreditCard, IconWorld, IconQuote, IconChartBar,
  IconBrandGooglePlay,
} from '@tabler/icons-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const s: Record<string, React.CSSProperties> = {
  navLogo:    { fontFamily: 'var(--font-display, Syne, sans-serif)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0 },
  sectionLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: 'var(--sage)', marginBottom: 14 },
  h2:         { fontFamily: 'Syne, sans-serif', fontSize: 'clamp(28px,4vw,42px)', fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.025em', lineHeight: 1.15, marginBottom: 14 },
  heroBadge:  { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 500, padding: '5px 14px', borderRadius: 99, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.28)', color: '#34d399', marginBottom: 28 },
};

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [ctaEmail, setCtaEmail] = useState('');
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'duplicate'|'error'>('idle');
  const [ctaStatus, setCtaStatus] = useState<'idle'|'loading'|'success'|'duplicate'|'error'>('idle');

  async function submit(em: string, setter: typeof setStatus) {
    if (!em) return;
    setter('loading');
    try {
      const res = await fetch(`${API_URL}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em.trim().toLowerCase(), source: 'landing' }),
      });
      setter(res.status === 201 ? 'success' : res.status === 409 ? 'duplicate' : 'error');
    } catch { setter('error'); }
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 15, color: 'var(--ink)', background: 'var(--page)', lineHeight: 1.6 }}>

      {/* ── NAV ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(40,48,74,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <a href="#" style={s.navLogo}>Launch<span style={{ color: '#34d399' }}>Mind</span></a>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {['How it works', 'Features', 'Markets', 'Pricing', 'Security'].map((l, i) => (
            <a key={l} href={['#how-it-works','#features','#markets','#pricing','#security'][i]} style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="/login" style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.75)', textDecoration: 'none' }}>Sign in</a>
          <a href="/signup" style={{ padding: '7px 18px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: '#059669', color: '#fff', textDecoration: 'none' }}>Start free →</a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{ background: 'var(--sidebar)', padding: '100px 40px 0', textAlign: 'center', overflow: 'hidden' }}>
        <div style={s.heroBadge}><IconSparkles size={13} />AI marketing OS for app founders</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,6vw,68px)', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.08, maxWidth: 800, margin: '0 auto 22px' }}>
          Stop guessing how to<br /><span style={{ color: '#34d399' }}>market your app</span>
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.65, fontWeight: 300 }}>
          Paste your App Store or Play Store URL. LaunchMind builds your strategy, writes your content, runs your campaigns, and tells you what's working — every week.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <a href="/signup" style={{ padding: '14px 32px', borderRadius: 8, fontSize: 15, fontWeight: 500, background: '#059669', color: '#fff', textDecoration: 'none' }}>Start free — no card required →</a>
          <button style={{ padding: '13px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <IconPlayerPlay size={14} />See it in 90 seconds
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginBottom: 32 }}>Free forever · No credit card · 3-minute setup</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 48 }}>
          <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, fontWeight: 500, background: 'rgba(5,150,105,0.12)', border: '1px solid rgba(5,150,105,0.28)', color: '#34d399' }}>🇺🇸 USA · Stripe · USD</span>
          <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, fontWeight: 500, background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.28)', color: '#fbbf24' }}>🇮🇳 India · Razorpay · INR</span>
        </div>

        {/* Mini dashboard mockup */}
        <div style={{ background: '#f2f3f6', borderRadius: '12px 12px 0 0', border: '1px solid rgba(255,255,255,0.10)', borderBottom: 'none', maxWidth: 900, margin: '0 auto', overflow: 'hidden', display: 'flex', height: 360 }}>
          <div style={{ width: 160, flexShrink: 0, background: '#28304a', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '14px 10px' }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 18, padding: '0 4px' }}>Launch<span style={{ color: '#34d399' }}>Mind</span></div>
            {['Dashboard','Strategy','Campaigns','Weekly brief','Channels','Settings'].map((item, i) => (
              <div key={item} style={{ padding: '5px 8px', borderRadius: 5, fontSize: 10, marginBottom: 2, ...(i === 0 ? { background: 'rgba(5,150,105,0.18)', border: '1px solid rgba(52,211,153,0.28)', color: '#34d399' } : { color: 'rgba(255,255,255,0.35)' }) }}>{item}</div>
            ))}
          </div>
          <div style={{ flex: 1, padding: '14px 16px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 600, color: '#1b1f2e' }}>Dashboard</div>
              <div style={{ display: 'flex', gap: 5 }}>
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 99, background: 'rgba(5,150,105,0.10)', border: '1px solid rgba(5,150,105,0.25)', color: '#059669' }}>Sunday brief delivered</span>
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 99, background: 'rgba(79,70,229,0.10)', border: '1px solid rgba(79,70,229,0.22)', color: '#4f46e5' }}>2 active</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 8 }}>
              {[['Total installs','847','#059669'],['Avg CPI','$1.82','#1b1f2e'],['Campaigns','6','#4f46e5'],['Top channel','WhatsApp','#1b1f2e']].map(([l,v,c]) => (
                <div key={l} style={{ background: '#eceef3', borderRadius: 5, padding: '7px 8px' }}>
                  <div style={{ fontSize: 7, color: '#9ca4be', marginBottom: 2, textTransform: 'uppercase' }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 7 }}>
              <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 7, padding: '8px 9px' }}>
                <div style={{ fontSize: 8, fontWeight: 500, color: '#1b1f2e', marginBottom: 5 }}>Products</div>
                {[['ClientPulse','+34%','#059669'],['Allignx','+18%','#4f46e5']].map(([n,d,c]) => (
                  <div key={n} style={{ background: '#eceef3', borderRadius: 3, padding: '4px 6px', marginBottom: 3, display: 'flex', justifyContent: 'space-between', fontSize: 7 }}>
                    <span>{n}</span><span style={{ color: c }}>{d}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', border: '1px solid rgba(5,150,105,0.28)', borderRadius: 7, padding: '8px 9px' }}>
                <div style={{ fontSize: 8, fontWeight: 500, color: '#1b1f2e', marginBottom: 5, display: 'flex', justifyContent: 'space-between' }}>
                  Sunday brief <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 99, background: 'rgba(5,150,105,0.10)', border: '1px solid rgba(5,150,105,0.25)', color: '#059669' }}>New</span>
                </div>
                {[['#059669','Worked','WhatsApp 68% of installs'],['#dc2626','Kill','LinkedIn — $48 CPI'],['#4f46e5','Next','3 actions ready to approve']].map(([c,l,t]) => (
                  <div key={l} style={{ borderLeft: `2px solid ${c}`, paddingLeft: 5, marginBottom: 4 }}>
                    <div style={{ fontSize: 7, color: '#9ca4be' }}>{l}</div>
                    <div style={{ fontSize: 7, color: '#1b1f2e', lineHeight: 1.4 }}>{t}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 7, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#eceef3', padding: '4px 7px', fontSize: 7, color: '#9ca4be' }}>
                {['Channel','Market','Installs','Status'].map(h => <div key={h}>{h}</div>)}
              </div>
              {[['WhatsApp','India','423','#d97706','Scaling','#059669'],['Google UAC','India','198','#d97706','Active','#059669'],['Meta Ads','USA','156','#059669','Active','#059669']].map(([ch,mk,ins,mc,st,sc]) => (
                <div key={ch} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '5px 7px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 7, color: '#626880', alignItems: 'center' }}>
                  <div>{ch}</div>
                  <div><span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 99, background: `${mc}1a`, color: mc }}>{mk}</span></div>
                  <div style={{ color: '#059669', fontWeight: 500 }}>{ins}</div>
                  <div><span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 99, background: 'rgba(5,150,105,0.10)', color: sc }}>{st}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── LOGOS ── */}
      <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '28px 40px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 18 }}>Trusted by founders launching on App Store and Play Store in 🇺🇸 USA and 🇮🇳 India</div>
        <div style={{ display: 'flex', gap: 40, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          {['ClientPulse','Allignx','TutorFlow','HealthTrackr','PayEase','StudyMate'].map(n => (
            <span key={n} style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink3)', padding: '6px 18px', borderRadius: 99, border: '1px solid var(--border)', background: 'var(--raised)' }}>{n}</span>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" style={{ background: 'var(--surface)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ ...s.sectionLabel }}><IconRoute size={13} />How it works</div>
          <h2 style={s.h2}>From URL to live campaigns<br />in under 10 minutes</h2>
          <p style={{ fontSize: 16, color: 'var(--ink2)', maxWidth: 560, lineHeight: 1.65, fontWeight: 300, marginBottom: 48 }}>LaunchMind does the work a fractional CMO would — but in minutes, not months.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {[
              { n: '01', icon: '🔍', title: 'Discover', body: 'Paste your App Store or Play Store URL. LaunchMind scrapes your app, reads 50+ reviews, and identifies your top 5 competitors — automatically.' },
              { n: '02', icon: '✅', title: 'Confirm ICP', body: 'Review the pre-built ICP brief — your target user, pain points, competitor gaps, and recommended markets. Edit anything. Confirm in one click.' },
              { n: '03', icon: '🚀', title: 'Execute', body: 'Get a 30/60/90 day channel strategy plus all content assets: WhatsApp broadcasts, App Store copy, email sequences, Meta and Google ad copy.' },
              { n: '04', icon: '📊', title: 'Learn', body: 'Every Sunday, LaunchMind tells you what worked, what to kill, and generates next week\'s assets. The system gets smarter every week.' },
            ].map((step, i) => (
              <div key={step.n} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, position: 'relative' }}>
                {i < 3 && (
                  <div style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                    <IconChevronRight size={12} color="var(--ink3)" />
                  </div>
                )}
                <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, background: 'var(--sidebar)', color: '#34d399', border: '1px solid rgba(52,211,153,0.28)', marginBottom: 14 }}>{step.n}</div>
                <div style={{ fontSize: 22, marginBottom: 10 }}>{step.icon}</div>
                <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{step.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={{ background: 'var(--sidebar)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ ...s.sectionLabel, color: '#34d399' }}><IconSparkles size={13} />Features</div>
          <h2 style={{ ...s.h2, color: 'rgba(255,255,255,0.9)' }}>Everything a CMO does.<br />At $49 a month.</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', maxWidth: 560, lineHeight: 1.65, fontWeight: 300, marginBottom: 48 }}>No agency fees. No guesswork. No more posting and hoping.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[
              { Icon: IconBrandGooglePlay, color: '#34d399', bg: 'rgba(5,150,105,0.18)', br: 'rgba(52,211,153,0.25)', title: 'App Store intelligence', body: 'Scrapes your listing, competitor reviews, and keyword rankings. Surfaces the exact copy signals your real users use.', tags: ['App Store','Play Store','ASO'] },
              { Icon: IconRoute, color: '#a5b4fc', bg: 'rgba(79,70,229,0.18)', br: 'rgba(79,70,229,0.25)', title: '30/60/90 day strategy', body: 'Not generic advice — a specific channel plan built on your ICP, your competitor gaps, and what\'s worked for similar apps.', tags: ['USA plan','India plan','Playbook AI'] },
              { Icon: IconBrandWhatsapp, color: '#fbbf24', bg: 'rgba(217,119,6,0.18)', br: 'rgba(217,119,6,0.25)', title: 'Multi-channel campaigns', body: 'WhatsApp broadcasts, Meta Ads, Google UAC, LinkedIn, email — all generated, approved, and posted through LaunchMind.', tags: ['WhatsApp','Meta','Google UAC'] },
              { Icon: IconFileAnalytics, color: '#34d399', bg: 'rgba(5,150,105,0.18)', br: 'rgba(52,211,153,0.25)', title: 'Sunday weekly brief', body: 'Every Sunday evening: what worked, what to kill, and next week\'s assets ready to approve. One tap to deploy.', tags: ['Every Sunday','Auto-generated'] },
              { Icon: IconRefresh, color: '#a5b4fc', bg: 'rgba(79,70,229,0.18)', br: 'rgba(79,70,229,0.25)', title: 'Weekly retargeting', body: 'Every Tuesday, underperforming campaigns are paused and winners are scaled — automatically. You approve before anything changes.', tags: ['Auto-retarget','Spend caps'] },
              { Icon: IconBook, color: '#fbbf24', bg: 'rgba(217,119,6,0.18)', br: 'rgba(217,119,6,0.25)', title: 'Playbook intelligence', body: 'Learns from every campaign across all founders (anonymised). Knows what works for apps like yours in your market.', tags: ['Anonymous','Compounding'] },
            ].map(f => (
              <div key={f.title} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 22 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: f.bg, border: `1px solid ${f.br}` }}>
                  <f.Icon size={18} color={f.color} />
                </div>
                <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6, marginBottom: 12 }}>{f.body}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {f.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}>{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLAYBOOK ── */}
      <section style={{ background: 'var(--surface)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
          <div>
            <div style={s.sectionLabel}><IconChartBar size={13} />Playbook intelligence</div>
            <h2 style={s.h2}>Gets smarter with<br />every launch</h2>
            <p style={{ fontSize: 16, color: 'var(--ink2)', lineHeight: 1.65, fontWeight: 300, marginBottom: 28 }}>Every campaign run through LaunchMind — anonymised — enriches a shared intelligence layer. After 100 app launches, the recommendations aren't generic. They're grounded in what actually works.</p>
            {[
              { num: '+31%', label: 'Average install increase from WhatsApp pain-first hooks in India', source: 'From 47 productivity apps, weeks 2–4' },
              { num: '2.3×', label: 'Google UAC outperforms Meta for Indian app installs under ₹500/mo', source: 'From 31 utility apps, India market' },
              { num: '+18%', label: 'App Store subtitle rewrite improves install conversion rate', source: 'Average across 89 apps, weeks 3–5' },
            ].map(stat => (
              <div key={stat.num} style={{ background: 'var(--raised)', borderRadius: 10, padding: 20, marginBottom: 12 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 32, fontWeight: 700, color: 'var(--sage)', marginBottom: 4 }}>{stat.num}</div>
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{stat.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{stat.source}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Live playbook signals</div>
            {[
              { label: 'WhatsApp · pain-first · India', delta: '+34% installs', meta: 'Productivity apps · $1–5/mo · week 3 · 47 similar apps', dc: 'var(--sage)' },
              { label: 'Google UAC · India', delta: 'CPI $0.82', meta: 'CRM apps · $3–12/mo · week 2 · 31 similar apps', dc: 'var(--sage)' },
              { label: 'ASO subtitle rewrite · USA', delta: '+18% conversion', meta: 'All categories · week 4 · 89 apps', dc: 'var(--sage)' },
              { label: 'LinkedIn · USA · B2B apps', delta: 'High CPI', meta: 'Most solo founders pause by week 2 · 44 apps', dc: 'var(--danger)' },
              { label: 'Meta lookalike · USA', delta: '2.1× vs broad', meta: 'Based on existing user list · productivity · 22 apps', dc: 'var(--sage)' },
            ].map(sig => (
              <div key={sig.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)' }}>{sig.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: sig.dc }}>{sig.delta}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{sig.meta}</div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>All signals are anonymised. No founder data is ever identifiable.</div>
          </div>
        </div>
      </section>

      {/* ── MARKETS ── */}
      <section id="markets" style={{ background: 'var(--page)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ ...s.sectionLabel, justifyContent: 'center' }}><IconWorld size={13} />Built for two markets</div>
          <h2 style={{ ...s.h2, textAlign: 'center', maxWidth: 600, margin: '0 auto 14px' }}>USA and India — from day one</h2>
          <p style={{ fontSize: 16, color: 'var(--ink2)', maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.65, fontWeight: 300 }}>Not adapted for India. Built for India alongside USA — with separate strategy, separate channels, and separate pricing that founders there actually pay.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { flag: '🇺🇸', title: 'USA market', border: 'var(--sage)', body: 'LinkedIn, Product Hunt, cold email to Sun Belt professionals, App Store Search Ads, Meta Ads with lookalike audiences. English copy optimised for US pain points.', chips: [['Stripe · USD','usa'],['Meta Ads','usa'],['Google UAC','usa'],['LinkedIn','usa'],['Product Hunt','usa'],['App Store Search Ads','usa']] },
              { flag: '🇮🇳', title: 'India market', border: 'var(--amber)', body: 'WhatsApp broadcasts, Google UAC, YouTube Shorts scripts, founder community groups. Hindi + English copy. Pricing in INR that Indian founders actually find affordable.', chips: [['Razorpay · UPI · INR','india'],['WhatsApp Business','india'],['Google UAC','india'],['YouTube Shorts','india'],['Hindi + English','india']] },
            ].map(m => (
              <div key={m.title} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: `3px solid ${m.border}`, borderRadius: 10, padding: 28, textAlign: 'left' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{m.flag}</div>
                <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{m.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, marginBottom: 14 }}>{m.body}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {m.chips.map(([l, t]) => (
                    <span key={l} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 500, ...(t === 'usa' ? { background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: '#046c4e' } : { background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: '#92400e' }) }}>{l}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{ background: 'var(--surface)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ ...s.sectionLabel, justifyContent: 'center' }}><IconQuote size={13} />From founders</div>
          <h2 style={{ ...s.h2, textAlign: 'center', margin: '0 auto 40px' }}>Built by a founder,<br />for founders</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {[
              { stars: '★★★★★', text: '"I was the product, engineer, and CMO at once. LaunchMind gave me back 10 hours a week and tripled my India installs in 6 weeks."', initials: 'VK', name: 'Vijay K.', role: 'ClientPulse · Phoenix, USA', bg: 'var(--sage-d)', br: 'var(--sage-b)', c: 'var(--sage)' },
              { stars: '★★★★★', text: '"The Sunday brief is the one thing I actually look forward to. It tells me exactly what to do on Monday — no guessing, no agency invoices."', initials: 'RA', name: 'Rahul A.', role: 'StudyMate · Bangalore, India', bg: 'var(--indigo-d)', br: 'var(--indigo-b)', c: 'var(--indigo)' },
              { stars: '★★★★★', text: '"The WhatsApp broadcast it generated converted better than anything I\'d written myself. ₹999 a month for a fractional CMO is insane value."', initials: 'PS', name: 'Priya S.', role: 'HealthTrackr · Mumbai, India', bg: 'var(--amber-d)', br: 'var(--amber-b)', c: 'var(--amber)' },
            ].map(t => (
              <div key={t.name} style={{ background: 'var(--page)', border: '1px solid var(--border)', borderRadius: 10, padding: 22, textAlign: 'left' }}>
                <div style={{ color: 'var(--amber)', fontSize: 13, marginBottom: 10, letterSpacing: 1 }}>{t.stars}</div>
                <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 14, fontStyle: 'italic' }}>{t.text}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: t.bg, border: `1px solid ${t.br}`, color: t.c }}>{t.initials}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{ background: 'var(--page)', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ ...s.sectionLabel, justifyContent: 'center' }}><IconCreditCard size={13} />Pricing</div>
          <h2 style={{ ...s.h2, textAlign: 'center', margin: '0 auto 14px' }}>Start free. Scale as you grow.</h2>
          <p style={{ fontSize: 16, color: 'var(--ink2)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.65, fontWeight: 300 }}>No agency fees. No long-term contracts. Cancel anytime.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
            {[
              { name: 'Free', price: '$0', period: 'forever', inr: '₹0 / month', featured: false, features: [['yes','1 product'],['yes','Store scrape + ICP brief'],['yes','Strategy preview'],['yes','3 content assets'],['no','No campaign posting'],['no','No weekly brief']], cta: 'Start free', primary: false },
              { name: 'Solo', price: '$19', period: '/ month', inr: '₹999 / month in India', featured: false, features: [['yes','1 product'],['yes','Full 30/60/90 strategy'],['yes','Unlimited content assets'],['yes','Sunday weekly brief'],['yes','1 channel (WA or email)'],['no','No Meta / Google Ads']], cta: 'Start Solo', primary: false },
              { name: 'Builder', price: '$49', period: '/ month', inr: '₹2,499 / month in India', featured: true, features: [['yes','3 products'],['yes','All channels connected'],['yes','Meta + Google Ads posting'],['yes','USA + India dual strategy'],['yes','Weekly retargeting loop'],['yes','Competitor re-scrape']], cta: 'Start Builder', primary: true },
              { name: 'Studio', price: '$99', period: '/ month', inr: '₹4,999 / month in India', featured: false, features: [['yes','10 products'],['yes','Everything in Builder'],['yes','Client workspaces'],['yes','White-label briefs'],['yes','Brand voice training'],['yes','API access']], cta: 'Start Studio', primary: false },
            ].map(tier => (
              <div key={tier.name} style={{ background: 'var(--surface)', border: tier.featured ? '1.5px solid var(--indigo-b)' : '1px solid var(--border)', borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {tier.featured && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 10, fontWeight: 500, padding: '3px 12px', borderRadius: 99, background: 'var(--indigo)', color: '#fff', whiteSpace: 'nowrap' }}>Most popular</div>}
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{tier.name}</div>
                <div style={{ fontSize: 30, fontWeight: 500, color: tier.featured ? 'var(--indigo)' : 'var(--ink)', lineHeight: 1, marginBottom: 2 }}>{tier.price}</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{tier.period}</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2, marginBottom: 16 }}>{tier.inr}</div>
                <div style={{ height: 1, background: 'var(--border)', margin: '0 0 14px' }} />
                {tier.features.map(([t, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: t === 'yes' ? 'var(--ink2)' : 'var(--ink3)', marginBottom: 7 }}>
                    {t === 'yes' ? <IconCheck size={13} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} /> : <IconX size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
                    {l}
                  </div>
                ))}
                <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                  <a href="/signup" style={{ display: 'block', width: '100%', padding: 10, borderRadius: 6, fontSize: 13, fontWeight: 500, textAlign: 'center', textDecoration: 'none', ...(tier.primary ? { background: 'var(--sage)', color: '#fff', border: 'none' } : { border: '1px solid var(--border2)', color: 'var(--ink2)', background: 'transparent' }) }}>{tier.cta}</a>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--ink3)' }}>
            All plans include a 14-day trial of the full Builder tier. No credit card required.<br />
            Token top-up packs: 500 tokens ($9 / ₹749) · 1,500 ($19 / ₹1,499) · 5,000 ($49 / ₹3,999)
          </div>
        </div>
      </section>

      {/* ── SECURITY ── */}
      <section id="security" style={{ background: 'var(--sidebar)', padding: '60px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ ...s.sectionLabel, color: '#34d399', justifyContent: 'center' }}><IconShieldCheck size={13} />Security</div>
          <h2 style={{ ...s.h2, color: '#fff', textAlign: 'center' }}>Your ad accounts are safe with us</h2>
          <p style={{ color: 'rgba(255,255,255,0.45)', maxWidth: 520, margin: '0 auto 36px', fontSize: 15, fontWeight: 300, lineHeight: 1.65 }}>Connecting your Meta and Google accounts is a big deal. We built the security infrastructure before the product features.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, textAlign: 'left' }}>
            {[
              { Icon: IconLock, title: 'OAuth only', desc: 'We never ask for your password. OAuth tokens are your credentials — and we never store them in plaintext.' },
              { Icon: IconKey, title: 'AES-256 + AWS KMS', desc: 'Every OAuth token is encrypted with AES-256. The encryption key lives in AWS KMS — never in the same database.' },
              { Icon: IconShield, title: 'Campaign scope only', desc: 'We request the minimum permissions needed: campaign management only. Never billing, never account admin, never personal data.' },
              { Icon: IconEyeOff, title: 'Spend caps enforced', desc: 'You set a weekly spend cap per platform. LaunchMind enforces it server-side — it can never be overridden by anyone.' },
            ].map(sec => (
              <div key={sec.title} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 18 }}>
                <sec.Icon size={20} color="#34d399" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.88)', marginBottom: 5 }}>{sec.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', lineHeight: 1.55 }}>{sec.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: 'var(--surface)', padding: '80px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 500, padding: '2px 9px', borderRadius: 99, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.28)', color: '#059669' }}>
              <IconSparkles size={11} />Free to start · No card required
            </span>
          </div>
          <h2 style={{ ...s.h2, textAlign: 'center', maxWidth: 600, margin: '0 auto 14px' }}>Ready to stop guessing?</h2>
          <p style={{ fontSize: 16, color: 'var(--ink2)', maxWidth: 460, margin: '0 auto 32px', fontWeight: 300 }}>Paste your App Store URL and see your ICP brief, competitor gaps, and first strategy in under 3 minutes.</p>
          {ctaStatus === 'success' ? (
            <div style={{ maxWidth: 460, margin: '0 auto 12px', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 8, padding: '14px 20px', color: 'var(--sage)', fontWeight: 500 }}>You're on the list! We'll email you when early access opens.</div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); submit(ctaEmail, setCtaStatus); }} style={{ display: 'flex', gap: 8, maxWidth: 460, margin: '0 auto 12px' }}>
              <input
                type="email"
                placeholder="founder@yourapp.com"
                value={ctaEmail}
                onChange={e => setCtaEmail(e.target.value)}
                required
                style={{ flex: 1, padding: '12px 16px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--raised)', color: 'var(--ink)', fontSize: 14, outline: 'none' }}
              />
              <button type="submit" style={{ padding: '12px 24px', borderRadius: 6, fontSize: 14, fontWeight: 500, border: 'none', background: 'var(--sage)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {ctaStatus === 'loading' ? 'Joining…' : 'Join waitlist →'}
              </button>
            </form>
          )}
          {ctaStatus === 'duplicate' && <p style={{ fontSize: 12, color: 'var(--amber)' }}>Already on the list — we'll be in touch!</p>}
          {ctaStatus === 'error' && <p style={{ fontSize: 12, color: 'var(--danger)' }}>Something went wrong. Please try again.</p>}
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 14 }}>Already have an account? <a href="/login" style={{ color: 'var(--sage)', textDecoration: 'none' }}>Sign in →</a></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: '#046c4e' }}>🇺🇸 USA · Stripe</span>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: '#92400e' }}>🇮🇳 India · Razorpay · UPI</span>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: 'var(--sidebar)', padding: '48px 40px 28px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40, marginBottom: 40 }}>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Launch<span style={{ color: '#34d399' }}>Mind</span></div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, marginBottom: 16 }}>The AI marketing operating system for app founders. Built for solo founders launching on App Store and Play Store in USA and India.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['USA + India','SOC 2 planned','GDPR compliant'].map(b => <span key={b} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)' }}>{b}</span>)}
              </div>
            </div>
            {[
              { title: 'Product', links: ['How it works','Features','Pricing','Security','Changelog'] },
              { title: 'Founders', links: ['Blog','Case studies','IndieHackers','Product Hunt','Community'] },
              { title: 'Company', links: ['About','Contact','Twitter / X','LinkedIn'] },
            ].map(col => (
              <div key={col.title}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>{col.title}</div>
                {col.links.map(l => <a key={l} href="#" style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.42)', textDecoration: 'none', marginBottom: 8 }}>{l}</a>)}
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© 2026 LaunchMind. Built by founders, for founders. 🇺🇸 Phoenix, USA · 🇮🇳 India</div>
            <div style={{ display: 'flex', gap: 20 }}>
              {['Privacy Policy','Terms of Service','Security','GDPR'].map(l => <a key={l} href="#" style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>{l}</a>)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
