'use client';
/**
 * @file tabs/SecurityTab.tsx
 * @description Settings → Security tab. MFA, password reset, active sessions.
 * @security Uses Supabase client for auth. All operations via Supabase SDK.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ghostBtn: React.CSSProperties = {
  fontSize: 12, border: '1px solid var(--border2)', borderRadius: 6, padding: '6px 14px',
  color: 'var(--ink2)', background: 'var(--surface)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};
const row = 'flex items-center justify-between py-3 gap-4';
const divider: React.CSSProperties = { borderTop: '1px solid var(--border)' };
const text13b: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', fontWeight: 500 };
const text12: React.CSSProperties = { fontSize: 12, color: 'var(--ink2)', marginTop: 2 };

export function SecurityTab() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [mfaFactors, setMfaFactors] = useState<unknown[]>([]);
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      setEmail(user.email ?? '');
      const { data: mfaData } = await supabase.auth.mfa.listFactors();
      setMfaFactors(mfaData?.totp ?? []);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendReset() {
    setResetBusy(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetSent(true); setResetBusy(false);
  }

  async function signOutAll() {
    setSignOutBusy(true);
    await supabase.auth.signOut({ scope: 'global' });
    window.location.href = '/';
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Security</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Two-factor authentication, password, and active sessions.</div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 20px' }}>
        {/* MFA */}
        <div className={row}>
          <div>
            <p style={text13b}>Two-factor authentication</p>
            <p style={text12}>Protect your account with a TOTP authenticator app.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mfaFactors.length > 0 ? (
              <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}>
                Enabled
              </span>
            ) : (
              <>
                <span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 11, background: 'var(--amber-d)', color: 'var(--amber)', border: '1px solid var(--amber-b)' }}>
                  Not set up
                </span>
                <a
                  href="https://supabase.com/docs/guides/auth/auth-mfa"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--sage)', textDecoration: 'none' }}
                >
                  Set up →
                </a>
              </>
            )}
          </div>
        </div>

        {/* Password */}
        <div className={row} style={divider}>
          <div>
            <p style={text13b}>Password</p>
            <p style={text12}>Send a password reset link to your email address.</p>
          </div>
          <div className="shrink-0">
            {resetSent
              ? <span style={{ fontSize: 12, color: 'var(--sage)' }}>Reset email sent ✓</span>
              : <button onClick={sendReset} disabled={resetBusy}
                  style={{ fontSize: 12, color: 'var(--sage)', background: 'none', border: 'none', cursor: resetBusy ? 'not-allowed' : 'pointer', padding: 0, opacity: resetBusy ? 0.6 : 1 }}>
                  {resetBusy ? 'Sending…' : 'Change password →'}
                </button>
            }
          </div>
        </div>

        {/* Active sessions */}
        <div className={row} style={divider}>
          <div>
            <p style={text13b}>Active sessions</p>
            <p style={text12}>Sign out of all devices and browsers immediately.</p>
          </div>
          <button onClick={signOutAll} disabled={signOutBusy}
            style={{ ...ghostBtn, opacity: signOutBusy ? 0.6 : 1, cursor: signOutBusy ? 'not-allowed' : 'pointer' }}>
            {signOutBusy ? 'Signing out…' : 'Sign out all devices'}
          </button>
        </div>
      </div>
    </div>
  );
}
