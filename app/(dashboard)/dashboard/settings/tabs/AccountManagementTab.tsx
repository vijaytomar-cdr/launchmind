'use client';
/**
 * @file tabs/AccountManagementTab.tsx
 * @description Settings → Account management tab.
 *   Token usage, export data, delete account, API keys (Studio only).
 *   Formerly the "Danger Zone" tab — renamed to "Account management".
 * @security Session fetched fresh before any destructive action.
 * @dependencies /founders/me/export, /founders/me DELETE, /billing/subscription, /api-keys
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ghostBtn: React.CSSProperties = {
  fontSize: 12, border: '1px solid var(--border2)', borderRadius: 6, padding: '6px 14px',
  color: 'var(--ink2)', background: 'var(--surface)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};
const divider: React.CSSProperties = { borderTop: '1px solid var(--border)' };
const row = 'flex items-center justify-between py-3 gap-4';
const text13b: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', fontWeight: 500 };
const text12: React.CSSProperties = { fontSize: 12, color: 'var(--ink2)', marginTop: 2 };
const inputBase: React.CSSProperties = {
  background: 'var(--raised)', borderRadius: 6, padding: '8px 12px',
  fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%',
};

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
};

export function AccountManagementTab() {
  const supabase = createClient();
  const router = useRouter();
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  const [plan, setPlan] = useState('free');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyVisible, setNewKeyVisible] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      const [subRes, keysRes] = await Promise.all([
        fetch(`${apiBase}/billing/subscription`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch(`${apiBase}/api-keys`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);

      if (subRes.ok) {
        const sub = await subRes.json() as { plan: string };
        setPlan(sub.plan);
      }
      if (keysRes.ok) {
        const k = await keysRes.json() as { keys?: ApiKey[] };
        setApiKeys(k.keys ?? []);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportData() {
    setExportBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${apiBase}/founders/me/export`, {
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
      await fetch(`${apiBase}/founders/me`, {
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
    const res = await fetch(`${apiBase}/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName, scopes: ['read'] }),
    });
    if (!res.ok) return;
    const data = await res.json() as { key: string };
    setNewKeyVisible(data.key);
    setNewKeyName('');
    const keysRes = await fetch(`${apiBase}/api-keys`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (keysRes.ok) {
      const k = await keysRes.json() as { keys?: ApiKey[] };
      setApiKeys(k.keys ?? []);
    }
  }

  async function revokeApiKey(id: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${apiBase}/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setApiKeys(prev => prev.filter(k => k.id !== id));
  }

  return (
    <div className="space-y-5">
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Account management</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Export your data or permanently delete your account.</div>
      </div>

      {/* Token usage */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>Token usage</div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 3 }}>
              View a breakdown of AI tokens consumed over the past 30 days.
            </p>
          </div>
          <Link href="/dashboard/settings/usage" style={{ ...ghostBtn, textDecoration: 'none' }}>
            View usage →
          </Link>
        </div>
      </div>

      {/* API Keys (Studio only) */}
      {plan === 'studio' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <div className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>API Keys</div>
            <span style={{ fontSize: 11, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 4, padding: '1px 6px' }}>Studio</span>
          </div>
          {newKeyVisible && (
            <div style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 6, padding: '10px 14px', marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: 'var(--sage)', marginBottom: 4, fontWeight: 500 }}>Copy your key — it will not be shown again</p>
              <code style={{ fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' }}>{newKeyVisible}</code>
              <button onClick={() => setNewKeyVisible(null)} style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Key name (e.g. Production)"
              style={{ ...inputBase, flex: 1, border: '1px solid var(--border2)' }} />
            <button onClick={createApiKey} disabled={!newKeyName.trim()}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: !newKeyName.trim() ? 'not-allowed' : 'pointer', opacity: !newKeyName.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
              Create key
            </button>
          </div>
          {apiKeys.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>No API keys yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {apiKeys.map(k => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--raised)', borderRadius: 6, padding: '8px 12px' }}>
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

      {/* Data export + account delete */}
      <div style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', borderRadius: 10, padding: 20 }}>
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

        <div style={{ ...divider }} className="flex items-start justify-between gap-4 py-3">
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
                  onChange={e => setDeleteText(e.target.value)}
                  placeholder="DELETE"
                  style={{ ...inputBase, width: 160, border: '1px solid var(--red-b)', fontSize: 12 }}
                />
                <div className="flex gap-2">
                  <button onClick={() => { setDeleteConfirm(false); setDeleteText(''); }} style={{ ...ghostBtn, padding: '5px 12px' }}>
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
