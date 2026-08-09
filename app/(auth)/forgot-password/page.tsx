/**
 * @file app/(auth)/forgot-password/page.tsx
 * @description Password reset request — founder enters email to receive a reset link.
 *   Calls supabase.auth.resetPasswordForEmail() client-side.
 *   Redirects to /auth/callback which then sends the founder to /reset-password.
 * @security No session required. Rate-limited by Supabase Auth.
 * @dependencies @supabase/ssr (browser client), next/link
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setError('');

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setStatus('error');
    } else {
      setStatus('sent');
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
          {status === 'sent' ? (
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--sage-d)' }}
              >
                <svg style={{ width: 22, height: 22, color: 'var(--sage)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="font-display font-semibold mb-2" style={{ fontSize: 16, color: 'var(--ink)' }}>
                Check your email
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 24 }}>
                We sent a password reset link to <strong>{email}</strong>. The link expires in 1 hour.
              </p>
              <Link href="/login" style={{ fontSize: 13, color: 'var(--sage)' }}>
                Back to login →
              </Link>
            </div>
          ) : (
            <>
              <h2 className="font-display font-semibold mb-1" style={{ fontSize: 16, color: 'var(--ink)' }}>
                Forgot your password?
              </h2>
              <p className="mb-6" style={{ fontSize: 13, color: 'var(--ink2)' }}>
                Enter your email and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block mb-1.5 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="autofill-light w-full rounded-[9px] px-3 py-2.5 outline-none"
                    style={{
                      background: 'var(--raised)',
                      border: '1px solid var(--border2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  />
                </div>

                {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full rounded-[10px] py-2.5 font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
                  style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
                >
                  {status === 'loading' ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="mt-5 text-center" style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Remember your password?{' '}
                <Link href="/login" style={{ color: 'var(--sage)', fontWeight: 500 }}>
                  Back to login
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
