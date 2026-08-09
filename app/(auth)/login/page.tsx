/**
 * @file app/(auth)/login/page.tsx
 * @description Founder login — two-panel split layout (dark left / white right).
 *   Sign-in runs as a Server Action so the session cookie is written into the
 *   HTTP response server-side. The browser then navigates to /dashboard with a
 *   valid cookie already in place, so the middleware lets the request through.
 * @security No JWT in localStorage. Session stored in cookies via @supabase/ssr.
 * @dependencies lib/supabase/server (via actions), actions.ts
 */

'use client';

import { useRef, useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInAction } from './actions';
import { createClient } from '@/lib/supabase/client';

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M15.68 8.18c0-.57-.05-1.11-.14-1.64H8v3.1h4.31a3.68 3.68 0 0 1-1.6 2.42v2.01h2.59c1.52-1.4 2.38-3.45 2.38-5.89Z" fill="#4285F4" />
    <path d="M8 16c2.16 0 3.97-.72 5.3-1.94l-2.59-2.01c-.72.48-1.63.77-2.71.77-2.08 0-3.84-1.4-4.47-3.29H.86v2.08A8 8 0 0 0 8 16Z" fill="#34A853" />
    <path d="M3.53 9.53A4.8 4.8 0 0 1 3.28 8c0-.53.09-1.04.25-1.53V4.39H.86A8 8 0 0 0 0 8c0 1.29.31 2.51.86 3.61l2.67-2.08Z" fill="#FBBC05" />
    <path d="M8 3.18c1.17 0 2.22.4 3.05 1.2l2.28-2.28C11.97.72 10.16 0 8 0A8 8 0 0 0 .86 4.39L3.53 6.47C4.16 4.58 5.92 3.18 8 3.18Z" fill="#EA4335" />
  </svg>
);

type Step = 'credentials' | 'mfa-challenge';

interface ResumeHint {
  productName: string;
  productId: string;
  intakeStep: number;
  stepLabel: string;
  updatedAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

const STEPS = [
  { n: 1, title: 'Create your workspace',  sub: 'Save and resume safely' },
  { n: 2, title: 'Discover your product',  sub: 'Public evidence first' },
  { n: 3, title: 'Confirm and align',       sub: 'Correct what AI inferred' },
  { n: 4, title: 'Set boundaries',          sub: 'You remain in control' },
  { n: 5, title: 'Get first direction',     sub: 'A useful plan, not a setup receipt' },
];

function LoginPageInner() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('credentials');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resumeHint, setResumeHint] = useState<ResumeHint | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('lm_resume_hint');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.productName) setResumeHint(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  async function handleGoogleSignIn() {
    const supabase = createClient();
    const incomingUrl = searchParams.get('url');
    const nextPath = searchParams.get('next');
    const redirectTo = incomingUrl
      ? `${window.location.origin}/dashboard/products/new?url=${encodeURIComponent(incomingUrl)}`
      : `${window.location.origin}${nextPath ?? '/dashboard'}`;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  }

  async function handleLogin() {
    if (loading) return;

    const emailVal = emailRef.current?.value?.trim() ?? '';
    const passwordVal = passwordRef.current?.value ?? '';

    if (!emailVal) { setError('Email is required'); return; }
    if (!passwordVal) { setError('Password is required'); return; }

    setError('');
    setLoading(true);

    try {
      const fd = new FormData();
      fd.set('email', emailVal);
      fd.set('password', passwordVal);

      const incomingUrl = searchParams.get('url');
      const nextPath = searchParams.get('next');
      const redirectTo = incomingUrl
        ? `/dashboard/products/new?url=${encodeURIComponent(incomingUrl)}`
        : nextPath ?? '/dashboard';
      fd.set('redirectTo', redirectTo);

      const result = await signInAction(fd);

      if (!result) { setLoading(false); return; }

      if ('error' in result) {
        setError(result.error);
        setLoading(false);
        return;
      }

      if ('needsMfa' in result) {
        setFactorId(result.factorId);
        setStep('mfa-challenge');
        setLoading(false);
        return;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  async function handleMfa() {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      const incomingUrl = searchParams.get('url');
      const nextPath = searchParams.get('next');
      window.location.href = incomingUrl
        ? `/dashboard/products/new?url=${encodeURIComponent(incomingUrl)}`
        : nextPath ?? '/dashboard';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code — try again');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 18% 12%, rgba(47,211,159,.16), transparent 32%), linear-gradient(135deg,#f7fbf9 0%,#edf4f1 48%,#f8f7ff 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      overflowY: 'auto',
    }}>
      {/* ── CARD SHELL ── */}
      <div style={{
        width: 'min(1180px, 96vw)',
        minHeight: 680,
        background: 'rgba(255,255,255,.94)',
        border: '1px solid rgba(207,220,214,.9)',
        borderRadius: 26,
        boxShadow: '0 28px 80px rgba(20,48,39,.16)',
        overflow: 'hidden',
        display: 'flex',
      }}>

      {/* ── LEFT PANEL (hidden on mobile) ── */}
      <div
        className="hidden lg:flex flex-col"
        style={{
          flex: '0 0 42%',
          background: 'linear-gradient(160deg,#12241f,#18382f)',
          padding: '38px',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 850 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg,#43ddb1,#0a8c68)',
            display: 'grid', placeItems: 'center',
            fontWeight: 900, fontSize: 13, color: '#fff',
          }}>LM</div>
          <span style={{ color: '#fff' }}>LaunchMind</span>
        </div>

        {/* Phase copy block */}
        <div style={{ marginTop: 44 }}>
          {/* Eyebrow */}
          <div style={{
            fontSize: 10, fontWeight: 850, letterSpacing: '.16em',
            textTransform: 'uppercase', color: '#57d8b1',
          }}>
            TEACH YOUR AI CMO
          </div>

          {/* Heading */}
          <h2 style={{
            fontSize: 33, fontWeight: 800, letterSpacing: '-1px', color: '#fff',
            margin: '10px 0 10px', fontFamily: 'Syne, sans-serif', lineHeight: 1.07,
          }}>
            Discovery + Alignment
          </h2>

          {/* Description */}
          <p style={{ fontSize: 15, color: '#b8cdc5', lineHeight: 1.65, margin: 0 }}>
            LaunchMind does the research. You provide the truth only you know.
          </p>
        </div>

        {/* 5-step list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 36 }}>
          {STEPS.map(s => {
            const active = s.n === 1;
            return (
              <div
                key={s.n}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11,
                  ...(active
                    ? { background: 'rgba(67,221,177,.12)', borderRadius: 11, padding: '11px', color: '#fff' }
                    : { padding: '11px', color: '#769289' }),
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  fontSize: 10, fontWeight: 850,
                  ...(active
                    ? { background: 'rgba(67,221,177,.22)', color: '#47d9ae', border: 'none' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.38)', border: '1px solid rgba(255,255,255,.14)' }),
                }}>
                  {s.n}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: active ? 700 : 400 }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 2 }}>
                    {s.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>
            Save &amp; finish later
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
            Progress saved automatically
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column' }}>

        {/* Header bar */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '16px 24px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--sage)' }} />
            <span style={{ fontSize: 10, color: 'var(--ink3)', fontWeight: 500 }}>Account</span>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <Link href="/" style={{ color: 'var(--ink3)', fontSize: 22, textDecoration: 'none', lineHeight: 1, fontWeight: 750 }}>
              ×
            </Link>
          </div>
        </div>

        {/* Main content — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '42px 46px' }}>
          <div style={{ maxWidth: 560, margin: '0 auto', width: '100%' }}>

            {/* ── CREDENTIALS STEP ── */}
            {step === 'credentials' && (
              <>
                {/* Eyebrow */}
                <div style={{
                  fontSize: 11, fontWeight: 850, letterSpacing: '.13em',
                  textTransform: 'uppercase', color: 'var(--sage)',
                }}>
                  Create your LaunchMind workspace
                </div>

                {/* Heading */}
                <h2 style={{
                  fontSize: 30, fontWeight: 800, letterSpacing: '-1px',
                  color: 'var(--ink)', margin: '11px 0 9px',
                  fontFamily: 'Syne, sans-serif', lineHeight: 1.2,
                }}>
                  Where should we save your Growth Brain?
                </h2>

                {/* Lead */}
                <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
                  A lightweight account lets you return to the analysis, correct assumptions later, and keep your product intelligence private.
                </p>

                {/* Auth tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
                  <Link
                    href="/signup"
                    style={{
                      padding: '10px 15px', textDecoration: 'none',
                      color: 'var(--ink3)', fontWeight: 750, fontSize: 14,
                      borderBottom: '2px solid transparent',
                    }}
                  >
                    Create account
                  </Link>
                  <Link
                    href="/login"
                    style={{
                      padding: '10px 15px', textDecoration: 'none',
                      color: 'var(--sage)', fontWeight: 750, fontSize: 14,
                      borderBottom: '2px solid var(--sage)',
                    }}
                  >
                    Log in
                  </Link>
                </div>

                {/* Email */}
                <div style={{ marginBottom: 13 }}>
                  <label
                    htmlFor="login-email"
                    style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink2)', marginBottom: 6 }}
                  >
                    Email
                  </label>
                  <input
                    id="login-email"
                    ref={emailRef}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="autofill-light w-full"
                    style={{
                      background: 'white', border: '1px solid var(--border2)',
                      borderRadius: 9, padding: '8px 12px', color: 'var(--ink)',
                      fontSize: 13, outline: 'none', width: '100%',
                    }}
                  />
                </div>

                {/* Password */}
                <div style={{ marginBottom: 8 }}>
                  <label
                    htmlFor="login-password"
                    style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink2)', marginBottom: 6 }}
                  >
                    Password
                  </label>
                  <input
                    id="login-password"
                    ref={passwordRef}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className="autofill-light w-full"
                    style={{
                      background: 'white', border: '1px solid var(--border2)',
                      borderRadius: 9, padding: '8px 12px', color: 'var(--ink)',
                      fontSize: 13, outline: 'none', width: '100%',
                    }}
                    onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
                  />
                </div>

                {error && (
                  <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{error}</p>
                )}

                {/* Submit */}
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={loading}
                  style={{
                    width: '100%', height: 44, marginTop: 15,
                    background: 'var(--sage)', color: '#fff', borderRadius: 10,
                    fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                    opacity: loading ? 0.6 : 1, transition: 'opacity .15s',
                  }}
                >
                  {loading ? 'Logging in…' : 'Log in →'}
                </button>

                {/* Forgot password */}
                <button
                  type="button"
                  onClick={() => { window.location.href = '/forgot-password'; }}
                  style={{
                    border: 'none', background: 'none', color: 'var(--sage)',
                    fontWeight: 750, cursor: 'pointer', padding: '8px 0',
                    fontSize: 13, display: 'block', width: '100%', textAlign: 'left',
                  }}
                >
                  Forgot password?
                </button>

                {/* Resume card */}
                {resumeHint && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    border: '1px solid var(--sage3)', background: 'var(--sage2)',
                    borderRadius: 13, padding: 12, marginTop: 18,
                  }}>
                    <span style={{ fontSize: 20 }}>↻</span>
                    <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>
                        Unfinished Growth Brain found
                      </b>
                      <small style={{ color: 'var(--ink2)', fontSize: 11 }}>
                        {resumeHint.productName} · {relativeTime(resumeHint.updatedAt)} · {resumeHint.stepLabel}
                      </small>
                    </div>
                    <Link
                      href="/dashboard/products"
                      style={{
                        marginLeft: 'auto', flexShrink: 0,
                        height: 32, padding: '0 12px', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--surface)',
                        color: 'var(--ink)', fontSize: 12, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
                      }}
                    >
                      Resume
                    </Link>
                  </div>
                )}

              </>
            )}

            {/* ── MFA CHALLENGE STEP ── */}
            {step === 'mfa-challenge' && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 850, letterSpacing: '.13em',
                  textTransform: 'uppercase', color: 'var(--sage)',
                }}>
                  Security check
                </div>

                <h2 style={{
                  fontSize: 30, fontWeight: 800, letterSpacing: '-1px',
                  color: 'var(--ink)', margin: '11px 0 9px',
                  fontFamily: 'Syne, sans-serif', lineHeight: 1.2,
                }}>
                  Two-factor authentication
                </h2>

                <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
                  Enter the 6-digit code from your authenticator app.
                </p>

                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  style={{
                    width: '100%', background: 'var(--raised)',
                    border: '1px solid var(--border2)', borderRadius: 9,
                    padding: '12px 16px', color: 'var(--ink)', fontSize: 24,
                    textAlign: 'center', fontFamily: 'var(--font-dm-mono)',
                    letterSpacing: '0.5em', outline: 'none',
                  }}
                />

                {error && (
                  <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{error}</p>
                )}

                <button
                  type="button"
                  onClick={handleMfa}
                  disabled={loading || code.length !== 6}
                  style={{
                    width: '100%', height: 44, marginTop: 15,
                    background: 'var(--sage)', color: '#fff', borderRadius: 10,
                    fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                    opacity: (loading || code.length !== 6) ? 0.6 : 1, transition: 'opacity .15s',
                  }}
                >
                  {loading ? 'Verifying…' : 'Verify'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setCode(''); setError(''); }}
                  style={{
                    width: '100%', textAlign: 'center', background: 'none',
                    border: 'none', cursor: 'pointer', fontSize: 11,
                    color: 'var(--ink3)', marginTop: 12, display: 'block',
                  }}
                >
                  Back to login
                </button>
              </>
            )}

          </div>
        </div>

        {/* Footer bar */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 24px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, color: 'var(--ink3)', marginBottom: 6,
          }}>
            <span>Account</span>
            <span>Growth Brain confidence · 8%</span>
          </div>
          <div style={{ height: 4, background: 'var(--raised)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: '8%', height: '100%', background: 'var(--sage)', borderRadius: 999 }} />
          </div>
        </div>

      </div>

      </div>{/* end card shell */}
    </div>
  );
}

/**
 * useSearchParams() opts a route into client-side rendering, and Next requires an
 * explicit Suspense boundary for that. Without one `next build` fails to prerender
 * this page — it has been failing the production export, while `next dev` worked.
 *
 * The fallback renders nothing: the page is a full-viewport auth panel, and a
 * flash of skeleton before an instant client render is worse than a blank frame.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
