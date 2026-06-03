/**
 * @file app/(dashboard)/dashboard/settings/page.tsx
 * @description Settings page with Account, Content types, and Danger Zone tabs.
 * @security Supabase client for profile + MFA. Backend API for plan, API keys, content prefs, voice clone.
 * @dependencies @supabase/ssr (browser client), lib/api.ts (content prefs, voice clone), next/navigation
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ContentPreferences } from '@/lib/types/content';

// ─── Styles ──────────────────────────────────────────────────────────────────

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

// ─── Token cost constants ─────────────────────────────────────────────────────

const TOKEN_COSTS: Record<keyof ContentPreferences, Record<string, number>> = {
  text:        { whatsappBroadcast: 2, email: 3, adCopy: 2, linkedin: 2 },
  video:       { reels30s: 5, shorts60s: 5, appStorePreview: 5, whatsappVoiceNote: 3 },
  visual:      { metaImageBrief: 2, carouselBrief: 2 },
  community:   { whatsappGroupPost: 2, facebookGroupPost: 2, indieHackersPost: 2, twitterThread: 2 },
  socialProof: { caseStudy: 3, testimonialBrief: 2, reviewResponseTemplates: 2 },
};

const MAX_TOKENS_PER_WEEK = (Object.values(TOKEN_COSTS) as Record<string, number>[])
  .flatMap(s => Object.values(s))
  .reduce((a, b) => a + b, 0); // 46

const PLAN_MONTHLY_LIMIT: Record<string, number> = {
  free: 50, solo: 300, builder: 1000, studio: 3000,
};

const DEFAULT_PREFS: ContentPreferences = {
  text:        { whatsappBroadcast: true, email: true, adCopy: true, linkedin: true },
  video:       { reels30s: false, shorts60s: false, appStorePreview: false, whatsappVoiceNote: false },
  visual:      { metaImageBrief: true, carouselBrief: true },
  community:   { whatsappGroupPost: true, facebookGroupPost: false, indieHackersPost: true, twitterThread: true },
  socialProof: { caseStudy: true, testimonialBrief: true, reviewResponseTemplates: true },
};

function calcTokensPerWeek(prefs: ContentPreferences): number {
  let total = 0;
  for (const [section, items] of Object.entries(TOKEN_COSTS)) {
    const prefSection = prefs[section as keyof ContentPreferences] as Record<string, boolean>;
    for (const [key, cost] of Object.entries(items)) {
      if (prefSection[key]) total += cost;
    }
  }
  return total;
}

// ─── Content sections definition ─────────────────────────────────────────────

interface ContentSectionDef {
  key: keyof ContentPreferences;
  title: string;
  desc: string;
  items: Array<{ key: string; label: string; cost: number; desc: string }>;
}

const CONTENT_SECTIONS: ContentSectionDef[] = [
  {
    key: 'text',
    title: 'Text content',
    desc: 'Copy and messaging across your active channels.',
    items: [
      { key: 'whatsappBroadcast', label: 'WhatsApp broadcast',  cost: 2, desc: 'Direct broadcast message to your subscriber list.' },
      { key: 'email',             label: 'Email sequence',       cost: 3, desc: 'Day 1, Day 5, Day 14 onboarding emails.' },
      { key: 'adCopy',            label: 'Ad copy (Meta / Google)', cost: 2, desc: 'Headlines and body for paid ads.' },
      { key: 'linkedin',          label: 'LinkedIn posts',       cost: 2, desc: 'Founder story + data post.' },
    ],
  },
  {
    key: 'video',
    title: 'Video content',
    desc: 'AI-generated video scripts and voice-over. Requires ElevenLabs credit.',
    items: [
      { key: 'reels30s',          label: 'Reels / Shorts 30s',       cost: 5, desc: 'Short-form vertical video for Instagram & YouTube.' },
      { key: 'shorts60s',         label: 'YouTube Shorts 60s',        cost: 5, desc: 'Longer short-form for YouTube Shorts.' },
      { key: 'appStorePreview',   label: 'App Store preview',         cost: 5, desc: '30s preview video for App Store / Play Store listing.' },
      { key: 'whatsappVoiceNote', label: 'WhatsApp voice note',       cost: 3, desc: 'Personalised voice message for broadcast.' },
    ],
  },
  {
    key: 'visual',
    title: 'Visual content',
    desc: 'Creative briefs for your designer or AI image tools.',
    items: [
      { key: 'metaImageBrief', label: 'Meta image brief', cost: 2, desc: 'Art direction + copy overlay for Meta static ads.' },
      { key: 'carouselBrief',  label: 'Carousel brief',   cost: 2, desc: 'Slide-by-slide brief for Instagram carousels.' },
    ],
  },
  {
    key: 'community',
    title: 'Community posts',
    desc: 'Authentic posts for the communities where your users hang out.',
    items: [
      { key: 'whatsappGroupPost',  label: 'WhatsApp group post',  cost: 2, desc: 'Community group message, not broadcast.' },
      { key: 'facebookGroupPost',  label: 'Facebook group post',  cost: 2, desc: 'Tailored post for relevant Facebook groups.' },
      { key: 'indieHackersPost',   label: 'IndieHackers post',    cost: 2, desc: 'Founder-story or milestone post.' },
      { key: 'twitterThread',      label: 'Twitter / X thread',   cost: 2, desc: '5–7 tweet thread with hook and payoff.' },
    ],
  },
  {
    key: 'socialProof',
    title: 'Social proof',
    desc: 'Content that builds trust and surfaces user wins.',
    items: [
      { key: 'caseStudy',                label: 'Case study',                  cost: 3, desc: 'Full before/after story from a user interview.' },
      { key: 'testimonialBrief',         label: 'Testimonial card',            cost: 2, desc: 'Design brief for a testimonial visual.' },
      { key: 'reviewResponseTemplates',  label: 'Review response templates',   cost: 2, desc: 'Personalised replies to App Store / Play Store reviews.' },
    ],
  },
];

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

// ─── Product type with content fields ─────────────────────────────────────────

interface ProductWithContent {
  id: string;
  name: string;
  content_preferences: ContentPreferences | null;
  approval_mode: 'manual' | 'one_tap' | 'auto' | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'account' | 'content' | 'danger';

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>('account');

  // Profile
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Security
  const [mfaFactors, setMfaFactors] = useState<unknown[]>([]);
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  // Notifications
  const [briefOn, setBriefOn] = useState(true);
  const [approvalOn, setApprovalOn] = useState(true);
  const [tokenOn, setTokenOn] = useState(true);

  // Plan + API keys
  const [plan, setPlan] = useState('free');
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; created_at: string }>>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyVisible, setNewKeyVisible] = useState<string | null>(null);

  // Content tab
  const [products, setProducts] = useState<ProductWithContent[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [contentPrefs, setContentPrefs] = useState<ContentPreferences>(DEFAULT_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef('');

  // Voice clone
  const [voiceCloneId, setVoiceCloneId] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const voiceFileRef = useRef<HTMLInputElement>(null);

  // Danger zone
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  const inputBase: React.CSSProperties = {
    background: 'var(--raised)', borderRadius: 6, padding: '8px 12px',
    fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%',
  };

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    const qs = tab !== 'account' ? `?tab=${tab}` : '';
    window.history.pushState({}, '', `/dashboard/settings${qs}`);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab') as Tab | null;
    if (t === 'content' || t === 'danger') setActiveTab(t);

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      setEmail(user.email ?? '');
      setName(user.user_metadata?.full_name ?? '');

      const { data: mfaData } = await supabase.auth.mfa.listFactors();
      setMfaFactors(mfaData?.totp ?? []);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;

      const [subRes, keysRes, prodsRes] = await Promise.all([
        fetch(`${apiBase}/billing/subscription`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch(`${apiBase}/api-keys`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch(`${apiBase}/products`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);

      if (subRes.ok) {
        const sub = await subRes.json() as { plan: string };
        setPlan(sub.plan);
      }
      if (keysRes.ok) {
        const k = await keysRes.json() as { keys?: typeof apiKeys };
        setApiKeys(k.keys ?? []);
      }
      if (prodsRes.ok) {
        const prods = await prodsRes.json() as ProductWithContent[];
        setProducts(prods);
        if (prods.length > 0) {
          setSelectedProductId(prods[0].id);
          setContentPrefs(prods[0].content_preferences ?? DEFAULT_PREFS);
        }
      }

      // Voice clone status from founders table (RLS allows self-read)
      const { data: founderRow } = await supabase
        .from('founders')
        .select('voice_clone_id')
        .eq('id', user.id)
        .single();
      setVoiceCloneId(founderRow?.voice_clone_id ?? null);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProductChange(id: string) {
    setSelectedProductId(id);
    const prod = products.find(p => p.id === id);
    setContentPrefs(prod?.content_preferences ?? DEFAULT_PREFS);
    setPrefsSaved(false);
  }

  function togglePref(section: keyof ContentPreferences, key: string) {
    if (!selectedProductId) return;
    const sectionPrefs = contentPrefs[section] as Record<string, boolean>;
    const updated: ContentPreferences = {
      ...contentPrefs,
      [section]: { ...sectionPrefs, [key]: !sectionPrefs[key] },
    };
    setContentPrefs(updated);
    setPrefsSaved(false);

    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      if (!tokenRef.current) return;
      setPrefsSaving(true);
      try {
        await api.settings.updateContentPreferences(selectedProductId, updated, tokenRef.current);
        setPrefsSaved(true);
        setProducts(prev => prev.map(p => p.id === selectedProductId ? { ...p, content_preferences: updated } : p));
      } catch { /* silent */ }
      finally { setPrefsSaving(false); }
    }, 1000);
  }

  async function handleVoiceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !tokenRef.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setVoiceMsg({ ok: false, text: 'File too large. Max 10 MB.' });
      return;
    }
    setVoiceBusy(true);
    setVoiceMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      await api.settings.uploadVoiceClone(audioBase64, tokenRef.current);
      setVoiceCloneId('set');
      setVoiceMsg({ ok: true, text: 'Voice sample uploaded successfully.' });
    } catch (err) {
      setVoiceMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setVoiceBusy(false);
      if (voiceFileRef.current) voiceFileRef.current.value = '';
    }
  }

  async function handleDeleteVoice() {
    if (!tokenRef.current) return;
    setVoiceBusy(true);
    try {
      await api.settings.deleteVoiceClone(tokenRef.current);
      setVoiceCloneId(null);
      setVoiceMsg({ ok: true, text: 'Voice clone removed.' });
    } catch { /* silent */ }
    finally { setVoiceBusy(false); }
  }

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
      const k = await keysRes.json() as { keys?: typeof apiKeys };
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

  const tokensPerWeek = calcTokensPerWeek(contentPrefs);
  const barPct = Math.min((tokensPerWeek / MAX_TOKENS_PER_WEEK) * 100, 100);
  const planLimit = PLAN_MONTHLY_LIMIT[plan] ?? 300;

  return (
    <div className="p-8 max-w-2xl">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>Account, content, and notification preferences.</p>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'account' as const, label: 'Account' },
          { id: 'content' as const, label: 'Content types' },
          { id: 'danger'  as const, label: 'Danger zone' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            data-tab={tab.id}
            style={{
              padding: '8px 16px', fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--ink)' : 'var(--ink2)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid var(--sage)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Account tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'account' && (
        <div className="space-y-6">

          {/* Profile */}
          <div style={card}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Profile</h2>
              <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, background: 'var(--raised)', color: 'var(--ink3)', border: '1px solid var(--border2)' }}>
                Account
              </span>
            </div>
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Full name
                </label>
                <input type="text" value={name} placeholder="Your name"
                  onChange={e => setName(e.target.value)}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  style={{ ...inputBase, border: nameFocused ? '1px solid var(--sage-b)' : '1px solid var(--border2)', boxShadow: nameFocused ? '0 0 0 3px var(--sage-d)' : 'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
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

          {/* Security */}
          <div style={card}>
            <div className="flex items-center gap-2 mb-5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <h2 className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>Security</h2>
            </div>
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

          {/* Notifications */}
          <div style={card}>
            <h2 className="font-display font-bold mb-5" style={{ fontSize: 15, color: 'var(--ink)' }}>Notifications</h2>
            {([
              { label: 'Sunday brief delivery',       desc: 'Receive your weekly performance brief every Sunday morning.',        on: briefOn,    set: setBriefOn },
              { label: 'Campaign approval reminders', desc: 'Get notified when campaigns are waiting for your approval.',        on: approvalOn, set: setApprovalOn },
              { label: 'Low token warning',           desc: 'Alert when your token balance drops below 20% of your plan limit.', on: tokenOn,    set: setTokenOn },
            ] as const).map(({ label, desc, on, set }, i) => (
              <div key={label} className={row} style={i > 0 ? divider : undefined}>
                <div><p style={text13b}>{label}</p><p style={text12}>{desc}</p></div>
                <Toggle on={on} onChange={set} />
              </div>
            ))}
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 12 }}>Notification preferences saved automatically.</p>
          </div>

          {/* API Keys (Studio only) */}
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
                  <code style={{ fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' }}>{newKeyVisible}</code>
                  <button onClick={() => setNewKeyVisible(null)} style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
                </div>
              )}
              <div className="flex gap-2 mb-4">
                <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. Production)"
                  style={{ ...inputBase, flex: 1, border: '1px solid var(--border2)' }} />
                <button onClick={createApiKey} disabled={!newKeyName.trim()}
                  style={{ background: 'var(--sage)', color: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: !newKeyName.trim() ? 'not-allowed' : 'pointer', opacity: !newKeyName.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
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

          {/* Token usage link */}
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

        </div>
      )}

      {/* ── Content types tab ───────────────────────────────────────────────── */}
      {activeTab === 'content' && (
        <div className="space-y-6">

          {/* Header */}
          <div>
            <h2 className="font-display font-semibold" style={{ fontSize: 17, color: 'var(--ink)' }}>
              What LaunchMind generates each week
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
              Set once — changes apply from next Sunday&apos;s brief
            </p>

            {/* Product selector (only when >1 product) */}
            {products.length > 1 && (
              <div className="mt-4">
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Apply to product
                </label>
                <select
                  value={selectedProductId}
                  onChange={e => handleProductChange(e.target.value)}
                  style={{ ...inputBase, border: '1px solid var(--border2)', width: 'auto', minWidth: 220, cursor: 'pointer' }}
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {products.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>
                No products yet.{' '}
                <Link href="/products/new" style={{ color: 'var(--sage)' }}>Add your first app →</Link>
              </p>
            )}
          </div>

          {/* Token cost preview bar */}
          <div style={{ background: 'var(--raised)', borderRadius: 8, padding: '12px 14px' }} data-token-cost={tokensPerWeek}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 12, color: 'var(--ink2)', fontWeight: 500 }}>Weekly token cost</span>
              <span style={{ fontSize: 12, color: 'var(--ink)', fontFamily: 'monospace' }}>
                {tokensPerWeek} tokens/week · Plan: {planLimit.toLocaleString()}/mo
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${barPct}%`,
                background: barPct > 75 ? 'var(--amber)' : 'var(--sage)',
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Content type sections */}
          {CONTENT_SECTIONS.map((section) => (
            <div key={section.key} style={card}>
              <div className="mb-4">
                <h3 className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>{section.title}</h3>
                <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{section.desc}</p>
              </div>
              {section.items.map(({ key, label, cost, desc }, i) => {
                const sectionPrefs = contentPrefs[section.key] as Record<string, boolean>;
                return (
                  <div key={key} className={row} style={i > 0 ? divider : undefined}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p style={text13b}>{label}</p>
                        <span style={{ fontSize: 10, background: 'var(--raised)', color: 'var(--ink3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace' }}>
                          {cost}t
                        </span>
                      </div>
                      <p style={text12}>{desc}</p>
                    </div>
                    <Toggle
                      on={sectionPrefs[key] ?? false}
                      onChange={() => togglePref(section.key, key)}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          {/* Auto-save status */}
          <div style={{ minHeight: 20 }}>
            {prefsSaving && <p style={{ fontSize: 11, color: 'var(--ink3)' }}>Saving…</p>}
            {!prefsSaving && prefsSaved && <p style={{ fontSize: 11, color: 'var(--sage)' }}>Preferences saved ✓</p>}
          </div>

          {/* Voice clone */}
          <div style={card}>
            <div className="flex items-center gap-2 mb-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <h3 className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>Voice clone</h3>
              <span style={{ fontSize: 10, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 4, padding: '1px 6px' }}>Beta</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 16 }}>
              Upload a 60-second audio sample to generate WhatsApp voice notes in your voice.
            </p>

            {voiceCloneId ? (
              <div className="flex items-center justify-between" style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 6, padding: '10px 14px' }}>
                <span style={{ fontSize: 13, color: 'var(--sage)', fontWeight: 500 }}>Voice trained ✓</span>
                <button onClick={handleDeleteVoice} disabled={voiceBusy}
                  style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: voiceBusy ? 'not-allowed' : 'pointer', padding: 0, opacity: voiceBusy ? 0.6 : 1 }}>
                  Remove
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={voiceFileRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg"
                  onChange={handleVoiceUpload}
                  style={{ display: 'none' }}
                  id="voice-clone-input"
                  data-testid="voice-clone-input"
                />
                <label
                  htmlFor="voice-clone-input"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    cursor: voiceBusy ? 'not-allowed' : 'pointer',
                    background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)',
                    borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500,
                    opacity: voiceBusy ? 0.6 : 1,
                  }}
                >
                  {voiceBusy ? 'Uploading…' : 'Upload sample (MP3 / WAV · max 10 MB)'}
                </label>
              </>
            )}

            {voiceMsg && (
              <p style={{ fontSize: 12, color: voiceMsg.ok ? 'var(--sage)' : 'var(--red)', marginTop: 8 }}>
                {voiceMsg.text}
              </p>
            )}
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>
              Processed by ElevenLabs. Audio is used only to train the voice model and is not stored by LaunchMind.
            </p>
          </div>

        </div>
      )}

      {/* ── Danger zone tab ─────────────────────────────────────────────────── */}
      {activeTab === 'danger' && (
        <div style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', borderRadius: 10, padding: 24 }}>
          <h2 className="font-display font-bold mb-5" style={{ fontSize: 15, color: 'var(--red)' }}>Danger zone</h2>

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
      )}

    </div>
  );
}
