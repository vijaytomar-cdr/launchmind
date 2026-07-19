/**
 * @file app/(auth)/login/page.tsx
 * @description Founder login — Slate & Sage light theme.
 *   Sign-in runs as a Server Action so the session cookie is written into the
 *   HTTP response server-side. The browser then navigates to /dashboard with a
 *   valid cookie already in place, so the middleware lets the request through.
 * @security No JWT in localStorage. Session stored in cookies via @supabase/ssr.
 * @dependencies lib/supabase/server (via actions), actions.ts
 */

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { signInAction } from './actions';
import { createClient } from '@/lib/supabase/client';

type Step = 'credentials' | 'mfa-challenge';

export default function LoginPage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('credentials');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

      // Server Action — writes session cookie into the HTTP response server-side.
      // When we then navigate to /dashboard the middleware reads a valid cookie.
      const result = await signInAction(fd);

      // result is undefined when redirect('/dashboard') was called server-side.
      // Reset loading so the user can retry if the navigation fails.
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

      window.location.href = '/dashboard';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code — try again');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--page)' }}>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Launch<span style={{ color: 'var(--sage)' }}>Mind</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Your AI marketing operating system</div>
        </div>

        <div className="rounded-[10px] p-8" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

          {step === 'credentials' && (
            <>
              <div className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block mb-1.5 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                    Email
                  </label>
                  <input
                    id="login-email"
                    ref={emailRef}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="autofill-light w-full rounded-[6px] px-3 py-2.5 outline-none"
                    style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                      Password
                    </label>
                    <Link href="/forgot-password" style={{ fontSize: 11, color: 'var(--sage)' }}>
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="login-password"
                    ref={passwordRef}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className="autofill-light w-full rounded-[6px] px-3 py-2.5 outline-none"
                    style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
                    onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
                  />
                </div>

                {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={loading}
                  className="w-full rounded-[6px] py-2.5 font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
                  style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
                >
                  {loading ? 'Signing in…' : 'Sign in →'}
                </button>
              </div>

              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span style={{ fontSize: 11, color: 'var(--ink3)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 rounded-[6px] py-2.5"
                style={{ border: '1px solid var(--border2)', color: 'var(--ink2)', fontSize: 13 }}
              >
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <p className="mt-5 text-center" style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Don&apos;t have an account?{' '}
                <Link href="/signup" style={{ color: 'var(--sage)', fontWeight: 500 }}>Sign up free</Link>
              </p>
            </>
          )}

          {step === 'mfa-challenge' && (
            <>
              <div className="font-display font-semibold mb-1" style={{ fontSize: 16, color: 'var(--ink)' }}>
                Two-factor authentication
              </div>
              <p className="mb-6" style={{ fontSize: 12, color: 'var(--ink3)' }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <div className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full rounded-[6px] px-4 py-3 text-center font-mono tracking-widest outline-none"
                  style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 24 }}
                />
                {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
                <button
                  type="button"
                  onClick={handleMfa}
                  disabled={loading || code.length !== 6}
                  className="w-full rounded-[6px] py-2.5 font-medium disabled:opacity-60"
                  style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
                >
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setCode(''); setError(''); }}
                  className="w-full text-center"
                  style={{ fontSize: 11, color: 'var(--ink3)' }}
                >
                  Back to login
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
