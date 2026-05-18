/**
 * @file app/(auth)/reset-password/page.tsx
 * @description New password form — shown after the founder clicks the reset link in their email.
 *   By this point, /auth/callback has already exchanged the PKCE code for a session.
 *   Calls supabase.auth.updateUser({ password }) with the new password.
 * @security Requires an active session (provided by the callback exchange).
 *   If no session, redirects to /forgot-password.
 * @dependencies @supabase/ssr (browser client), next/navigation
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/forgot-password');
      } else {
        setSessionReady(true);
      }
    });
  }, [supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setStatus('loading');
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setStatus('error');
    } else {
      setStatus('success');
      setTimeout(() => router.push('/dashboard'), 2000);
    }
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--page)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }} />
      </div>
    );
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
          {status === 'success' ? (
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--sage-d)' }}
              >
                <svg style={{ width: 22, height: 22, color: 'var(--sage)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-display font-semibold mb-2" style={{ fontSize: 16, color: 'var(--ink)' }}>
                Password updated
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
                Redirecting you to the dashboard…
              </p>
            </div>
          ) : (
            <>
              <h2 className="font-display font-semibold mb-1" style={{ fontSize: 16, color: 'var(--ink)' }}>
                Set a new password
              </h2>
              <p className="mb-6" style={{ fontSize: 13, color: 'var(--ink2)' }}>
                Choose a strong password for your account.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block mb-1.5 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                    New password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full rounded-[6px] px-3 py-2.5 outline-none"
                    style={{
                      background: 'var(--raised)',
                      border: '1px solid var(--border2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  />
                </div>
                <div>
                  <label className="block mb-1.5 font-medium" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                    Confirm password
                  </label>
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    className="w-full rounded-[6px] px-3 py-2.5 outline-none"
                    style={{
                      background: 'var(--raised)',
                      border: '1px solid var(--border2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  />
                </div>

                {error && <p style={{ fontSize: 12, color: 'var(--red)' }}>{error}</p>}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full rounded-[6px] py-2.5 font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
                  style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
                >
                  {status === 'loading' ? 'Updating…' : 'Update password'}
                </button>
              </form>

              <p className="mt-5 text-center" style={{ fontSize: 11, color: 'var(--ink3)' }}>
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
