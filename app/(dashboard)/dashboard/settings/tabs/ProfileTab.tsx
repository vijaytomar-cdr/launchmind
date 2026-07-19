'use client';
/**
 * @file tabs/ProfileTab.tsx
 * @description Settings → Profile tab. Name + email fields.
 * @security Uses Supabase client for auth (self-managed session).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const inputBase: React.CSSProperties = {
  background: 'var(--raised)', borderRadius: 6, padding: '8px 12px',
  fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%',
};
const label11: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', marginTop: 2 };

export function ProfileTab() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      setEmail(user.email ?? '');
      setName(user.user_metadata?.full_name ?? '');
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    setProfileSaving(true); setProfileMsg(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    setProfileMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Profile saved.' });
    setProfileSaving(false);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Profile</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Your name and login email.</div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Full name
          </label>
          <input
            type="text"
            value={name}
            placeholder="Your name"
            onChange={e => setName(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            style={{ ...inputBase, border: nameFocused ? '1px solid var(--sage-b)' : '1px solid var(--border2)', boxShadow: nameFocused ? '0 0 0 3px var(--sage-d)' : 'none' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            disabled
            style={{ ...inputBase, border: '1px solid var(--border2)', opacity: 0.5, cursor: 'not-allowed' }}
          />
          <p style={label11}>Email cannot be changed here. Contact support if needed.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={saveProfile}
            disabled={profileSaving}
            style={{ background: 'var(--sage)', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, border: 'none', cursor: profileSaving ? 'not-allowed' : 'pointer', opacity: profileSaving ? 0.7 : 1 }}
          >
            {profileSaving ? 'Saving…' : 'Save changes'}
          </button>
          {profileMsg && (
            <span style={{ fontSize: 13, color: profileMsg.ok ? 'var(--sage)' : 'var(--danger)' }}>{profileMsg.text}</span>
          )}
        </div>
      </div>
    </div>
  );
}
