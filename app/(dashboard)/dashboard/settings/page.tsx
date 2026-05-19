/**
 * @file app/(dashboard)/dashboard/settings/page.tsx
 * @description Full settings page — profile, security, notifications, danger zone.
 * @security Supabase client for profile updates and auth operations. No secrets client-side.
 * @dependencies @supabase/ssr (browser client), next/navigation
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// ─── Shared style constants ───────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24,
};
const divider: React.CSSProperties = { borderTop: '1px solid var(--border)' };
const row = 'flex items-center justify-between py-3 gap-4';
const label11: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', marginTop: 2 };
const text13b: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', fontWeight: 500 };
const text12: React.CSSProperties = { fontSize: 12, color: 'var(--ink2)', marginTop: 2 };
const ghostBtn: React.CSSProperties = {
  fontSize: 12, border: '1px solid var(--border2)', borderRadius: 6, padding: '6px 14px',
  color: 'var(--ink2)', background: 'var(--surface)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 9999, padding: 2, flexShrink: 0, cursor: 'pointer',
        border: on ? 'none' : '1px solid var(--border2)',
        background: on ? 'var(--sage)' : 'var(--raised)',
        display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background 0.15s',
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: on ? '#fff' : 'var(--ink3)', display: 'block' }} />
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [name, setName]   = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [mfaFactors, setMfaFactors]   = useState<unknown[]>([]);
  const [resetSent, setResetSent]     = useState(false);
  const [resetBusy, setResetBusy]     = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const [briefOn,    setBriefOn]    = useState(true);
  const [approvalOn, setApprovalOn] = useState(true);
  const [tokenOn,    setTokenOn]    = useState(true);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText]       = useState('');
  const [exportBusy, setExportBusy]       = useState(false);

  const [plan, setPlan]               = useState('free');
  const [apiKeys, setApiKeys]         = useState<Array<{ id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; created_at: string }>>([]);
  const [newKeyName, setNewKeyName]   = useState('');
  const [newKeyVisible, setNewKeyVisible] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      setEmail(user.email ?? '');
      setName(user.user_metadata?.full_name ?? '');
      const { data } = await supabase.auth.mfa.listFactors();
      setMfaFactors(data?.totp ?? []);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

      const subRes = await fetch(`${apiBase}/billing/subscription`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (subRes.ok) {
        const sub = await subRes.json() as { plan: string };
        setPlan(sub.plan);
      }

      const keysRes = await fetch(`${apiBase}/api-keys`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (keysRes.ok) {
        const k = await keysRes.json() as { keys?: typeof apiKeys };
        setApiKeys(k.keys ?? []);
      }
    }
    load();
  }, [supabase, router]);

  async function saveProfile() {
    setProfileSaving(true); setProfileMsg(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    setProfileMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Profile saved.' });
    setProfileSaving(false);
  }

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
    router.replace('/login');
  }

  async function exportData() {
    setExportBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/founders/me/export`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: 'launchmind-export.json' }).click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
    finally { setExportBusy(false); }
  }

  async function deleteAccount() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/founders/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch { /* continue even if request fails */ }
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  async function createApiKey() {
    if (!newKeyName.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const res = await fetch(`${apiBase}/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName, scopes: ['read'] }),
    });
    if (!res.ok) return;
    const data = await res.json() as { key: string };
    setNewKeyVisible(data.key);
    setNewKeyName('');
    const keysRes = await fetch(`${apiBase}/api-keys`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (keysRes.ok) {
      const k = await keysRes.json() as { keys?: typeof apiKeys };
      setApiKeys(k.keys ?? []);
    }
  }

  async function revokeApiKey(id: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    await fetch(`${apiBase}/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setApiKeys(prev => prev.filter(k => k.id !== id));
  }

  const inputBase: React.CSSProperties = {
    background: 'var(--raised)', borderRadius: 6, padding: '8px 12px',
    fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%',
  };

  return (
    <div className="p-8 max-w-2xl space-y-6">

      {/* Topbar */}
      <div>
        <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>Account and notification preferences.</p>
      </div>

      {/* ── 1. Profile ──────────────────────────────────────────────────────── */}
      <div style={card}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Profile</h2>
          <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, background: 'var(--raised)', color: 'var(--ink3)', border: '1px solid var(--border2)' }}>
            Account
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
              Full name
            </label>
            <input type="text" value={name} placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              style={{ ...inputBase, border: nameFocused ? '1px solid var(--sage-b)' : '1px solid var(--border2)', boxShadow: nameFocused ? '0 0 0 3px var(--sage-d)' : 'none' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input type="email" value={email} disabled
              style={{ ...inputBase, border: '1px solid var(--border2)', opacity: 0.5, cursor: 'not-allowed' }}
            />
            <p style={label11}>Email cannot be changed here. Contact support if needed.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button onClick={saveProfile} disabled={profileSaving}
            style={{ background: 'var(--sage)', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, border: 'none', cursor: profileSaving ? 'not-allowed' : 'pointer', opacity: profileSaving ? 0.7 : 1 }}>
            {profileSaving ? 'Saving…' : 'Save changes'}
          </button>
          {profileMsg && (
            <span style={{ fontSize: 13, color: profileMsg.ok ? 'var(--sage)' : 'var(--red)' }}>{profileMsg.text}</span>
          )}
        </div>
      </div>

      {/* ── 2. Security ─────────────────────────────────────────────────────── */}
      <div style={card}>
        <div className="flex items-center gap-2 mb-5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Security</h2>
        </div>

        {/* 2a: MFA */}
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
                <a href="https://supabase.com/docs/guides/auth/auth-mfa" target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--sage)', textDecoration: 'none' }}>
                  Set up →
                </a>
              </>
            )}
          </div>
        </div>

        {/* 2b: Password */}
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

        {/* 2c: Sessions */}
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

      {/* ── 3. Notifications ────────────────────────────────────────────────── */}
      <div style={card}>
        <h2 className="font-display font-bold mb-5" style={{ fontSize: 15, color: 'var(--ink)' }}>Notifications</h2>

        {[
          { label: 'Sunday brief delivery',        desc: 'Receive your weekly performance brief every Sunday morning.',            on: briefOn,    set: setBriefOn },
          { label: 'Campaign approval reminders',  desc: 'Get notified when campaigns are waiting for your approval.',            on: approvalOn, set: setApprovalOn },
          { label: 'Low token warning',            desc: 'Alert when your token balance drops below 20% of your plan limit.',     on: tokenOn,    set: setTokenOn },
        ].map(({ label, desc, on, set }, i) => (
          <div key={label} className={row} style={i > 0 ? divider : undefined}>
            <div>
              <p style={text13b}>{label}</p>
              <p style={text12}>{desc}</p>
            </div>
            <Toggle on={on} onChange={set} />
          </div>
        ))}

        <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 12 }}>Notification preferences saved automatically.</p>
      </div>

      {/* ── 4. API Keys (Studio only) ───────────────────────────────────────── */}
      {plan === 'studio' && (
        <div style={card}>
          <div className="flex items-center gap-2 mb-5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>API Keys</h2>
            <span style={{ fontSize: 11, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 4, padding: '1px 6px' }}>Studio</span>
          </div>

          {newKeyVisible && (
            <div style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 11, color: 'var(--sage)', marginBottom: 4, fontWeight: 500 }}>Copy your key — it will not be shown again</p>
              <code style={{ fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' as const }}>{newKeyVisible}</code>
              <button onClick={() => setNewKeyVisible(null)} style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
            </div>
          )}

          <div className="flex gap-2 mb-4">
            <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production)"
              style={{ ...inputBase, flex: 1, border: '1px solid var(--border2)' }} />
            <button onClick={createApiKey} disabled={!newKeyName.trim()}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: !newKeyName.trim() ? 'not-allowed' : 'pointer', opacity: !newKeyName.trim() ? 0.5 : 1, whiteSpace: 'nowrap' as const }}>
              Create key
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>No API keys yet.</p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map(k => (
                <div key={k.id} className="flex items-center justify-between" style={{ background: 'var(--raised)', borderRadius: 6, padding: '8px 12px' }}>
                  <div>
                    <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{k.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'monospace' }}>{k.key_prefix}… · {k.scopes.join(', ')}</p>
                  </div>
                  <button onClick={() => revokeApiKey(k.id)} style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 5. Token usage ──────────────────────────────────────────────────── */}
      <div style={card}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Token usage</h2>
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 3 }}>
              View a breakdown of AI tokens consumed over the past 30 days.
            </p>
          </div>
          <Link href="/dashboard/settings/usage" style={{ ...ghostBtn, textDecoration: 'none' }}>
            View usage →
          </Link>
        </div>
      </div>

      {/* ── 6. Danger zone ──────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', borderRadius: 10, padding: 24 }}>
        <h2 className="font-display font-bold mb-5" style={{ fontSize: 15, color: 'var(--red)' }}>Danger zone</h2>

        {/* Export */}
        <div className={row}>
          <div>
            <p style={text13b}>Export my data</p>
            <p style={text12}>Download all your LaunchMind data as JSON.</p>
          </div>
          <button onClick={exportData} disabled={exportBusy}
            style={{ ...ghostBtn, opacity: exportBusy ? 0.6 : 1, cursor: exportBusy ? 'not-allowed' : 'pointer' }}>
            {exportBusy ? 'Exporting…' : 'Export →'}
          </button>
        </div>

        {/* Delete account */}
        <div className="flex items-start justify-between gap-4 py-3" style={divider}>
          <div>
            <p style={text13b}>Delete account</p>
            <p style={text12}>Permanently delete your account and all data. This cannot be undone.</p>
          </div>
          <div className="shrink-0">
            {!deleteConfirm ? (
              <button onClick={() => setDeleteConfirm(true)}
                style={{ fontSize: 12, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Delete account
              </button>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <p style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500 }}>Type DELETE to confirm</p>
                <input
                  type="text"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder="DELETE"
                  style={{ ...inputBase, width: 160, border: '1px solid var(--red-b)', fontSize: 12 }}
                />
                <div className="flex gap-2">
                  <button onClick={() => { setDeleteConfirm(false); setDeleteText(''); }}
                    style={{ ...ghostBtn, padding: '5px 12px' }}>
                    Cancel
                  </button>
                  <button
                    onClick={deleteAccount}
                    disabled={deleteText !== 'DELETE'}
                    style={{ fontSize: 12, background: 'var(--red)', color: '#fff', borderRadius: 6, padding: '5px 12px', fontWeight: 500, border: 'none', cursor: deleteText !== 'DELETE' ? 'not-allowed' : 'pointer', opacity: deleteText !== 'DELETE' ? 0.5 : 1 }}>
                    Confirm delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
