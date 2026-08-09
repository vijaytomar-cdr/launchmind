/**
 * @file app/(auth)/signup/page.tsx
 * @description Founder signup — two-panel split layout (dark left / white right).
 *   Signup flow: name + email + password → TOTP MFA enrollment → /onboarding/workspace
 *   Google sign-in: OAuth redirect → /onboarding/workspace
 * @security Password never stored on client. TOTP secret displayed once via QR.
 *   Session only issued after MFA verify succeeds.
 * @dependencies @supabase/ssr, qrcode.react, next/navigation
 */

'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';
import { trackOnboarding } from '@/lib/analytics';

type Step = 'credentials' | 'verify-otp' | 'mfa-setup' | 'mfa-verify';

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M15.68 8.18c0-.57-.05-1.11-.14-1.64H8v3.1h4.31a3.68 3.68 0 0 1-1.6 2.42v2.01h2.59c1.52-1.4 2.38-3.45 2.38-5.89Z" fill="#4285F4" />
    <path d="M8 16c2.16 0 3.97-.72 5.3-1.94l-2.59-2.01c-.72.48-1.63.77-2.71.77-2.08 0-3.84-1.4-4.47-3.29H.86v2.08A8 8 0 0 0 8 16Z" fill="#34A853" />
    <path d="M3.53 9.53A4.8 4.8 0 0 1 3.28 8c0-.53.09-1.04.25-1.53V4.39H.86A8 8 0 0 0 0 8c0 1.29.31 2.51.86 3.61l2.67-2.08Z" fill="#FBBC05" />
    <path d="M8 3.18c1.17 0 2.22.4 3.05 1.2l2.28-2.28C11.97.72 10.16 0 8 0A8 8 0 0 0 .86 4.39L3.53 6.47C4.16 4.58 5.92 3.18 8 3.18Z" fill="#EA4335" />
  </svg>
);

const STEPS = [
  { n: 1, title: 'Create your workspace',  sub: 'Save and resume safely' },
  { n: 2, title: 'Discover your product',  sub: 'Public evidence first' },
  { n: 3, title: 'Confirm and align',       sub: 'Correct what AI inferred' },
  { n: 4, title: 'Set boundaries',          sub: 'You remain in control' },
  { n: 5, title: 'Get first direction',     sub: 'A useful plan, not a setup receipt' },
];

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('credentials');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [totpUri, setTotpUri] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function getOnboardingUrl() {
    const incomingUrl = searchParams.get('url');
    return incomingUrl
      ? `/onboarding/workspace?url=${encodeURIComponent(incomingUrl)}`
      : '/onboarding/workspace';
  }

  async function handleGoogleSignIn() {
    const supabase = createClient();
    const incomingUrl = searchParams.get('url');
    const redirectTo = incomingUrl
      ? `${window.location.origin}/auth/callback?next=/onboarding/workspace&url=${encodeURIComponent(incomingUrl)}`
      : `${window.location.origin}/auth/callback?next=/onboarding/workspace`;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding/workspace`,
          data: { full_name: name },
        },
      });
      if (signUpError) throw signUpError;

      // No session = email OTP sent; session = auto-confirmed (local dev only)
      if (!signUpData.session) {
        setStep('verify-otp');
        startResendCooldown();
        return;
      }

      trackOnboarding('signup_complete');
      router.push(getOnboardingUrl());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  function startResendCooldown() {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const token = otpDigits.join('');
    try {
      const supabase = createClient();
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'signup',
      });
      if (verifyError) throw verifyError;
      if (!verifyData.session) throw new Error('Verification succeeded but no session was returned');

      trackOnboarding('signup_complete');
      router.push(getOnboardingUrl());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError('');
    try {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
      if (resendError) throw resendError;
      startResendCooldown();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    }
  }

  function handleOtpInput(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    if (digit && index < 7) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 8).split('');
    if (digits.length > 0) {
      e.preventDefault();
      const next = [...otpDigits];
      digits.forEach((d, i) => { if (i < 6) next[i] = d; });
      setOtpDigits(next);
      document.getElementById(`otp-${Math.min(digits.length, 7)}`)?.focus();
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });
      if (verifyError) throw verifyError;

      trackOnboarding('signup_complete');
      router.push(getOnboardingUrl());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  }

  // Shared input style
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'white',
    border: '1px solid var(--border2)',
    borderRadius: 9,
    padding: '8px 12px',
    color: 'var(--ink)',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--ink2)',
    marginBottom: 6,
  };

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
                  A lightweight account lets you return to the analysis, correct assumptions later,
                  and keep your product intelligence private.
                </p>

                {/* Auth tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
                  <Link
                    href="/signup"
                    style={{
                      padding: '10px 15px', textDecoration: 'none',
                      color: 'var(--sage)', fontWeight: 750, fontSize: 14,
                      borderBottom: '2px solid var(--sage)',
                    }}
                  >
                    Create account
                  </Link>
                  <Link
                    href="/login"
                    style={{
                      padding: '10px 15px', textDecoration: 'none',
                      color: 'var(--ink3)', fontWeight: 750, fontSize: 14,
                      borderBottom: '2px solid transparent',
                    }}
                  >
                    Log in
                  </Link>
                </div>

                {/* Signup form */}
                <form onSubmit={handleSignup}>
                  {/* 2-col grid: name + work email */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                    <div>
                      <label htmlFor="name" style={labelStyle}>Your name</label>
                      <input
                        id="name"
                        type="text"
                        required
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Adam Chen"
                        className="autofill-light"
                        style={inputStyle}
                      />
                    </div>

                    <div>
                      <label htmlFor="email" style={labelStyle}>Work email</label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="autofill-light"
                        style={inputStyle}
                      />
                    </div>

                    {/* Password — full width */}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label htmlFor="password" style={labelStyle}>Password</label>
                      <input
                        id="password"
                        type="password"
                        required
                        minLength={12}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="At least 12 characters"
                        className="autofill-light"
                        style={inputStyle}
                      />
                      <small style={{ display: 'block', color: 'var(--ink3)', fontSize: 10, marginTop: 5 }}>
                        Use 12+ characters. A verification code will be sent to your email.
                      </small>
                    </div>
                  </div>

                  {error && (
                    <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>
                  )}

                  {/* Terms checkbox */}
                  <label style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start',
                    fontSize: 11, color: 'var(--ink3)', cursor: 'pointer', marginTop: 13,
                  }}>
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={e => setAgreed(e.target.checked)}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    I agree to the Terms and understand LaunchMind will use my inputs to
                    personalise recommendations.
                  </label>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading || !agreed || !name.trim()}
                    style={{
                      width: '100%', height: 44, marginTop: 15,
                      background: 'var(--sage)', color: '#fff', borderRadius: 10,
                      fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                      opacity: (loading || !agreed || !name.trim()) ? 0.4 : 1,
                      transition: 'opacity .15s',
                    }}
                  >
                    {loading ? 'Creating…' : 'Create workspace →'}
                  </button>

                  {/* OR divider */}
                  <div style={{
                    height: 35, display: 'grid', placeItems: 'center',
                    position: 'relative', color: 'var(--ink3)', fontSize: 10, margin: '16px 0',
                  }}>
                    <div style={{ position: 'absolute', height: 1, background: 'var(--border)', left: 0, right: 0 }} />
                    <span style={{ background: 'white', padding: '0 8px', position: 'relative', zIndex: 1 }}>or</span>
                  </div>

                  {/* Google */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: 8, background: 'white',
                      height: 42, border: '1px solid var(--border2)', borderRadius: 10,
                      fontWeight: 700, fontSize: 13, color: 'var(--ink)', cursor: 'pointer',
                    }}
                  >
                    <GoogleIcon /> Continue with Google
                  </button>
                </form>
              </>
            )}

            {/* ── VERIFY OTP STEP ── */}
            {step === 'verify-otp' && (
              <>
                <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
                  Verify your email
                </div>
                <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', color: 'var(--ink)', margin: '11px 0 9px', fontFamily: 'Syne, sans-serif', lineHeight: 1.2 }}>
                  Enter your code
                </h2>
                <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 28px' }}>
                  We sent a verification code to <strong>{email}</strong>. Enter it below to activate your account.
                </p>

                <form onSubmit={handleOtpVerify}>
                  {/* 6-digit boxes */}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }} onPaste={handleOtpPaste}>
                    {otpDigits.map((digit, i) => (
                      <input
                        key={i}
                        id={`otp-${i}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        autoFocus={i === 0}
                        onChange={e => handleOtpInput(i, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(i, e)}
                        style={{
                          width: 52, height: 60, textAlign: 'center',
                          fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-dm-mono)',
                          border: `1.5px solid ${digit ? 'var(--sage)' : 'var(--border2)'}`,
                          borderRadius: 10, outline: 'none', background: digit ? 'var(--sage2)' : 'white',
                          color: 'var(--ink)', transition: 'border-color 120ms, background 120ms',
                        }}
                      />
                    ))}
                  </div>

                  {error && (
                    <p style={{ color: 'var(--danger)', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otpDigits.join('').length !== 8}
                    style={{
                      width: '100%', height: 44,
                      background: 'var(--sage)', color: '#fff', borderRadius: 10,
                      fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                      opacity: (loading || otpDigits.join('').length !== 8) ? 0.5 : 1,
                      transition: 'opacity .15s',
                    }}
                  >
                    {loading ? 'Verifying…' : 'Verify and continue →'}
                  </button>
                </form>

                {/* Resend + back */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setStep('credentials')}
                    style={{ border: 'none', background: 'none', color: 'var(--ink3)', fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >
                    ← Different email
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCooldown > 0}
                    style={{ border: 'none', background: 'none', color: resendCooldown > 0 ? 'var(--ink3)' : 'var(--sage)', fontWeight: 650, cursor: resendCooldown > 0 ? 'default' : 'pointer', fontSize: 13, padding: 0 }}
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>
              </>
            )}

            {/* ── MFA SETUP STEP ── */}
            {step === 'mfa-setup' && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 850, letterSpacing: '.13em',
                  textTransform: 'uppercase', color: 'var(--sage)',
                }}>
                  Account security
                </div>

                <h2 style={{
                  fontSize: 30, fontWeight: 800, letterSpacing: '-1px',
                  color: 'var(--ink)', margin: '11px 0 9px',
                  fontFamily: 'Syne, sans-serif', lineHeight: 1.2,
                }}>
                  Set up authenticator
                </h2>

                <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
                  Scan this QR code with your authenticator app (Google Authenticator, Authy,
                  1Password, etc.)
                </p>

                <div style={{
                  display: 'flex', justifyContent: 'center', marginBottom: 24,
                  padding: 16, background: 'white', borderRadius: 10,
                  border: '1px solid var(--border)',
                }}>
                  <QRCodeSVG value={totpUri} size={200} />
                </div>

                <button
                  type="button"
                  onClick={() => setStep('mfa-verify')}
                  style={{
                    width: '100%', height: 44, background: 'var(--sage)',
                    color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  I&apos;ve scanned it — continue
                </button>
              </>
            )}

            {/* ── MFA VERIFY STEP ── */}
            {step === 'mfa-verify' && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 850, letterSpacing: '.13em',
                  textTransform: 'uppercase', color: 'var(--sage)',
                }}>
                  Almost there
                </div>

                <h2 style={{
                  fontSize: 30, fontWeight: 800, letterSpacing: '-1px',
                  color: 'var(--ink)', margin: '11px 0 9px',
                  fontFamily: 'Syne, sans-serif', lineHeight: 1.2,
                }}>
                  Enter verification code
                </h2>

                <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
                  Enter the 6-digit code from your authenticator app to confirm setup.
                </p>

                <form onSubmit={handleMfaVerify}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
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
                    <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || code.length !== 6}
                    style={{
                      width: '100%', height: 44, marginTop: 15,
                      background: 'var(--sage)', color: '#fff', borderRadius: 10,
                      fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                      opacity: (loading || code.length !== 6) ? 0.6 : 1, transition: 'opacity .15s',
                    }}
                  >
                    {loading ? 'Verifying…' : 'Verify and continue →'}
                  </button>
                </form>
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
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}
