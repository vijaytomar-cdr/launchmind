/**
 * @file app/onboarding/discovery/page.tsx
 * @description Phase 1 Step 3: Product URL discovery. Matches fv-step[3] from spec.
 * @security SSRF protection enforced server-side before enqueueing.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

type Tab = 'url' | 'private';

const MAX_URLS = 3;

function urlPlatformLabel(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('apps.apple.com') || lower.includes('itunes.apple.com')) return 'App Store';
  if (lower.includes('play.google.com')) return 'Play Store';
  if (lower.includes('producthunt.com')) return 'Product Hunt';
  if (url.startsWith('http')) return 'Website';
  return '';
}

export default function DiscoveryPage() {
  const router = useRouter();
  const [tab, setTab]        = useState<Tab>('url');
  const [urls, setUrls]      = useState<string[]>(['']);
  const [desc, setDesc]      = useState('');
  const [sessionId, setId]   = useState('');
  const [submitting, setSub] = useState(false);
  const [error, setError]    = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      try {
        const res = await api.onboarding.getSession(session.access_token);
        const id = res?.session?.id ?? '';
        setId(id);
        if (id) sessionStorage.setItem('onboarding_session_id', id);
      } catch { /* ignore */ }
    })();
  }, [router]);

  function setUrl(idx: number, val: string) {
    setUrls(prev => prev.map((u, i) => i === idx ? val : u));
  }
  function addUrl() {
    if (urls.length < MAX_URLS) setUrls(prev => [...prev, '']);
  }
  function removeUrl(idx: number) {
    setUrls(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : ['']);
  }

  async function handleSubmit() {
    if (submitting) return;
    const validUrls = urls.map(u => u.trim()).filter(Boolean);
    const hasUrl  = tab === 'url' && validUrls.length > 0;
    const hasDesc = tab === 'private' && desc.trim().length >= 20;
    if (!hasUrl && !hasDesc) {
      setError(tab === 'url' ? 'Please enter at least one product URL.' : 'Please describe the product (20+ characters).');
      return;
    }
    setSub(true); setError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    try {
      await api.onboarding.startDiscovery(sessionId, validUrls, session.access_token, hasDesc ? desc.trim() : undefined);
      sessionStorage.setItem('onboarding_discovery_url', validUrls[0] ?? '');
      router.push('/onboarding/discovery/progress');
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong — please try again.');
      setSub(false);
    }
  }

  const textareaStyle: React.CSSProperties = {
    width: '100%', minHeight: 82,
    border: '1px solid var(--border2)', borderRadius: 12, padding: 12,
    fontSize: 14, color: 'var(--ink)', background: 'white',
    outline: 'none', fontFamily: 'inherit', resize: 'vertical',
    boxSizing: 'border-box',
  };

  const inputRowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '7px 8px 7px 12px',
    border: '1px solid var(--border2)', borderRadius: 12,
    background: 'white',
  };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 11 }}>
        Product discovery
      </div>
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, letterSpacing: '-1px', margin: '0 0 9px', color: 'var(--ink)' }}>
        Share the strongest public signal for your product.
      </h2>
      <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 22px' }}>
        LaunchMind can start from an App Store listing, Google Play listing, website, or Product Hunt page.
      </p>

      {/* Source tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {(['url', 'private'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              border: 0, background: 'none', padding: '10px 15px', cursor: 'pointer',
              fontWeight: 750, fontSize: 13, fontFamily: 'inherit',
              color: tab === t ? 'var(--sage)' : 'var(--ink3)',
              borderBottom: `2px solid ${tab === t ? 'var(--sage)' : 'transparent'}`,
            }}
          >
            {t === 'url' ? 'Product URL' : 'Private or pre-launch'}
          </button>
        ))}
      </div>

      {tab === 'url' && (
        <div style={{ display: 'grid', gap: 9 }}>

          {/* URL rows */}
          {urls.map((u, idx) => {
            const label = urlPlatformLabel(u);
            return (
              <div key={idx} style={inputRowStyle}>
                {/* Platform label pill — shows once URL is recognisable */}
                {label && (
                  <span style={{
                    fontSize: 10, fontWeight: 750, padding: '3px 8px', borderRadius: 999, flexShrink: 0,
                    background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)',
                  }}>
                    {label}
                  </span>
                )}
                <input
                  style={{ flex: 1, border: 0, background: 'transparent', fontSize: 14, outline: 0, minWidth: 0, fontFamily: 'inherit', padding: '6px 0' }}
                  value={u}
                  onChange={e => setUrl(idx, e.target.value)}
                  placeholder={idx === 0 ? 'https://apps.apple.com/… or play.google.com/…' : 'Add another URL (website, Play Store…)'}
                  onKeyDown={e => { if (e.key === 'Enter' && idx === urls.length - 1) void handleSubmit(); }}
                  autoFocus={idx === 0}
                />
                {/* Remove button — only show when more than 1 row */}
                {urls.length > 1 && (
                  <button
                    onClick={() => removeUrl(idx)}
                    style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 18, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                    aria-label="Remove URL"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {/* Add another URL */}
          {urls.length < MAX_URLS && (
            <button
              onClick={addUrl}
              style={{
                border: '1px dashed var(--border2)', borderRadius: 12, padding: '9px 14px',
                background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink3)',
                textAlign: 'left', fontFamily: 'inherit', fontWeight: 500,
              }}
            >
              + Add another URL <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 4 }}>(Play Store, website…)</span>
            </button>
          )}

          {/* Source chips */}
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', color: 'var(--ink3)', fontSize: 11 }}>
            {['App Store', 'Play Store', 'Website', 'Product Hunt'].map(s => (
              <span key={s} style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'white' }}>{s}</span>
            ))}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !urls.some(u => u.trim())}
            style={{
              height: 46, borderRadius: 11, border: 'none', padding: '0 18px',
              background: submitting || !urls.some(u => u.trim()) ? 'var(--raised)' : 'var(--sage)',
              color: submitting || !urls.some(u => u.trim()) ? 'var(--ink3)' : 'white',
              fontWeight: 600, fontSize: 14, cursor: submitting || !urls.some(u => u.trim()) ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Starting…' : 'Understand my product →'}
          </button>
        </div>
      )}

      {tab === 'private' && (
        <div style={{ display: 'grid', gap: 13 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Describe the product in one sentence</label>
            <textarea
              style={textareaStyle}
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="A marketplace that connects homeowners with verified local service professionals…"
              autoFocus
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || desc.trim().length < 20}
            style={{
              height: 44, borderRadius: 10, border: 'none',
              background: submitting || desc.trim().length < 20 ? 'var(--raised)' : 'var(--sage)',
              color: submitting || desc.trim().length < 20 ? 'var(--ink3)' : 'white',
              fontWeight: 600, fontSize: 14, cursor: submitting || desc.trim().length < 20 ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Starting…' : 'Build from my description →'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ink3)', fontSize: 11, paddingTop: 28 }}>
        ▣ LaunchMind will inspect public pages only. No social, analytics, advertising, publishing, or payment accounts are accessed during product discovery.
      </div>
    </>
  );
}
