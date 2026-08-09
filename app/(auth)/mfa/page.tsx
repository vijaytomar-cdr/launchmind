/**
 * @file app/(auth)/mfa/page.tsx
 * @description TOTP MFA verification screen — shown after password login when MFA is enrolled.
 * @security Verifies TOTP code via Supabase MFA API. No tokens stored client-side.
 * @dependencies @supabase/ssr (browser client), next/navigation
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function MfaPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.[0];
      if (!totp) {
        router.replace('/dashboard');
        return;
      }
      setFactorId(totp.id);
    });
  }, [router]);

  function handleChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = digit;
    setDigits(next);
    if (digit && idx < 5) inputRefs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        const next = [...digits];
        next[idx] = '';
        setDigits(next);
      } else if (idx > 0) {
        inputRefs.current[idx - 1]?.focus();
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  }

  async function handleVerify() {
    if (loading) return;
    const code = digits.join('');
    if (code.length !== 6) return;
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
      router.push('/dashboard');
    } catch {
      setError('Invalid code. Please try again.');
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  const code = digits.join('');

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--page)' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            marginBottom: 6,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 11,
              background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
              display: 'grid', placeItems: 'center',
              fontWeight: 900, fontSize: 13, color: '#fff',
              boxShadow: '0 8px 25px rgba(47,211,159,.25)',
            }}>LM</div>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
              Launch<span style={{ color: 'var(--sage)' }}>Mind</span>
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Your AI marketing operating system</div>
        </div>

        <div
          className="rounded-[10px] p-8"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex justify-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 48, height: 48,
                background: 'var(--sage-d)',
                border: '1px solid var(--sage-b)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
          </div>

          <h1 className="font-display font-bold text-center mt-4" style={{ fontSize: 18, color: 'var(--ink)' }}>
            Two-factor authentication
          </h1>
          <p className="text-center mt-2 mb-6" style={{ fontSize: 13, color: 'var(--ink2)' }}>
            Enter the 6-digit code from your authenticator app.
          </p>

          <div className="flex justify-center gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                autoFocus={i === 0}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                onPaste={handlePaste}
                className="text-center font-mono outline-none rounded-[9px] transition-colors"
                style={{
                  width: 44,
                  height: 48,
                  fontSize: 18,
                  background: 'var(--raised)',
                  border: d
                    ? '1.5px solid var(--sage-b)'
                    : '1px solid var(--border2)',
                  color: 'var(--ink)',
                  boxShadow: 'none',
                }}
                onFocus={e => (e.currentTarget.style.border = '1.5px solid var(--sage-b)')}
                onBlur={e => (e.currentTarget.style.border = d ? '1.5px solid var(--sage-b)' : '1px solid var(--border2)')}
              />
            ))}
          </div>

          {error && (
            <p className="text-center mt-3" style={{ fontSize: 13, color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className="w-full rounded-[10px] py-2.5 font-medium mt-4 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            {loading ? 'Verifying…' : 'Verify →'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Link href="/login" style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>
              ← Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
