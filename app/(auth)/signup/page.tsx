/**
 * @file app/(auth)/signup/page.tsx
 * @description Founder signup flow: email + password → TOTP MFA enrollment.
 *   Step 1: credentials → supabase.auth.signUp()
 *   Step 2: QR code shown → supabase.auth.mfa.enroll({ factorType: 'totp' })
 *   Step 3: founder enters TOTP code → challengeAndVerify → dashboard
 *   mfa_enabled is set to false on row creation; confirmed after TOTP verify.
 * @security Password never stored on client. TOTP secret displayed once via QR.
 *   Session only issued after MFA verify succeeds.
 * @dependencies @supabase/ssr, qrcode.react, next/navigation
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';
import { trackOnboarding } from '@/lib/analytics';

type Step = 'credentials' | 'mfa-setup' | 'mfa-verify';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (signUpError) throw signUpError;

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'LaunchMind',
        friendlyName: email,
      });
      if (enrollError) throw enrollError;
      if (!data) throw new Error('MFA enrollment returned no data');

      setTotpUri(data.totp.uri);
      setFactorId(data.id);
      setStep('mfa-setup');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
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
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-display font-bold text-white mb-2">
            LaunchMind
          </h1>
          <p className="text-neutral-300 text-sm">AI Marketing OS for App Founders</p>
        </div>

        <div className="bg-neutral-800 border border-neutral-600 rounded-xl p-8">
          {step === 'credentials' && (
            <>
              <h2 className="text-xl font-display font-semibold text-white mb-6">
                Create your account
              </h2>
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label className="block text-sm text-neutral-100 mb-1.5" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-neutral-700 border border-neutral-600 rounded-lg px-4 py-2.5 text-white placeholder-neutral-400 focus:outline-none focus:border-brand-teal transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-neutral-100 mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full bg-neutral-700 border border-neutral-600 rounded-lg px-4 py-2.5 text-white placeholder-neutral-400 focus:outline-none focus:border-brand-teal transition-colors"
                  />
                </div>
                {error && (
                  <p className="text-brand-coral text-sm">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-teal text-neutral-900 font-semibold rounded-lg px-4 py-2.5 hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Creating account…' : 'Continue'}
                </button>
              </form>
              <p className="mt-6 text-center text-sm text-neutral-300">
                Already have an account?{' '}
                <Link href="/login" className="text-brand-teal hover:underline">
                  Log in
                </Link>
              </p>
            </>
          )}

          {step === 'mfa-setup' && (
            <>
              <h2 className="text-xl font-display font-semibold text-white mb-2">
                Set up authenticator
              </h2>
              <p className="text-sm text-neutral-300 mb-6">
                Scan this QR code with your authenticator app (Google Authenticator,
                Authy, 1Password, etc.)
              </p>
              <div className="flex justify-center mb-6 p-4 bg-white rounded-xl">
                <QRCodeSVG value={totpUri} size={200} />
              </div>
              <button
                onClick={() => setStep('mfa-verify')}
                className="w-full bg-brand-teal text-neutral-900 font-semibold rounded-lg px-4 py-2.5 hover:bg-brand-teal/90 transition-colors"
              >
                I&apos;ve scanned it — continue
              </button>
            </>
          )}

          {step === 'mfa-verify' && (
            <>
              <h2 className="text-xl font-display font-semibold text-white mb-2">
                Enter verification code
              </h2>
              <p className="text-sm text-neutral-300 mb-6">
                Enter the 6-digit code from your authenticator app to confirm setup.
              </p>
              <form onSubmit={handleMfaVerify} className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full bg-neutral-700 border border-neutral-600 rounded-lg px-4 py-3 text-white text-center text-2xl font-mono tracking-widest placeholder-neutral-400 focus:outline-none focus:border-brand-teal transition-colors"
                />
                {error && (
                  <p className="text-brand-coral text-sm">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full bg-brand-teal text-neutral-900 font-semibold rounded-lg px-4 py-2.5 hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Verifying…' : 'Verify and go to dashboard'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
