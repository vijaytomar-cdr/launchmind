/**
 * @file app/onboarding/context-delta/page.tsx
 * @description Phase 1 Alignment 2 of 4 — What is changing?
 *   Founder shares their next important change (new feature, pricing, market, campaign, positioning).
 *   Matches fv-step[9] in LaunchMind_Production_UX_July18_2026(15).html.
 * @security Auth enforced by middleware. Session ID from sessionStorage.
 * @dependencies api.onboarding.saveContextDelta, supabase auth
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

const QUICK_TAGS = ['New feature', 'Pricing change', 'New market', 'Launch campaign', 'Positioning change'];

export default function ContextDeltaPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState('');
  const [contextDelta, setContextDelta] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/context-delta'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
    }
    load();
  }, [router]);

  function appendTag(tag: string) {
    setContextDelta(prev => prev ? `${prev} ${tag.toLowerCase()}` : tag.toLowerCase());
  }

  async function handleContinue() {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    try {
      await api.onboarding.saveContextDelta(sessionId, {
        contextDelta: contextDelta.trim() || undefined,
      }, session.access_token);
      router.push('/onboarding/goal');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    try {
      await api.onboarding.saveContextDelta(sessionId, {}, session.access_token);
    } catch { /* best effort */ }
    router.push('/onboarding/goal');
  }

  const hasContent = contextDelta.trim().length > 0;

  /* ── Inline style constants ── */
  const kickerStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 850, letterSpacing: '.13em',
    textTransform: 'uppercase', color: 'var(--sage)',
  };

  const threadStyle: React.CSSProperties = {
    display: 'grid', gap: 18, marginTop: 22,
  };

  const aiMsgStyle: React.CSSProperties = {
    display: 'flex', gap: 12, alignItems: 'flex-start',
  };

  const avatarStyle: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 12,
    background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
    color: 'white', display: 'grid', placeItems: 'center',
    fontSize: 11, fontWeight: 900, flexShrink: 0,
    boxShadow: '0 8px 20px rgba(11,143,105,.18)',
  };

  const bubbleStyle: React.CSSProperties = {
    maxWidth: 650, background: '#f7faf8',
    border: '1px solid var(--border)',
    borderRadius: '4px 16px 16px 16px',
    padding: '16px 17px',
  };

  const founderResponseStyle: React.CSSProperties = {
    marginLeft: 48, border: '1px solid var(--sage3)',
    background: '#fbfffd', borderRadius: 14,
    padding: 14, display: 'grid', gap: 8,
  };

  const previewStyle: React.CSSProperties = {
    marginLeft: 48, padding: '11px 13px',
    background: 'var(--sage2)', border: '1px solid var(--sage3)',
    borderRadius: '4px 12px 12px 12px',
    color: 'var(--ink2)', fontSize: 11, lineHeight: 1.5,
    display: hasContent ? 'block' : 'none',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', gap: 12, marginTop: 20,
  };

  const skipStyle: React.CSSProperties = {
    border: 0, background: 'none', color: 'var(--ink3)',
    fontWeight: 700, cursor: 'pointer', fontSize: 14,
    fontFamily: 'inherit',
  };

  const primaryStyle: React.CSSProperties = {
    borderRadius: 10, border: '1px solid var(--sage)',
    background: 'var(--sage)', color: '#fff',
    height: 38, padding: '0 20px', fontWeight: 650,
    cursor: saving ? 'not-allowed' : 'pointer',
    fontSize: 14, fontFamily: 'inherit',
    opacity: saving ? 0.7 : 1,
  };

  return (
    <div>
      {/* fv-kicker */}
      <div style={kickerStyle}>Alignment 2 of 4 · What is changing?</div>

      {/* conversation-thread */}
      <div style={threadStyle}>

        {/* ai-message */}
        <div style={aiMsgStyle}>
          <div style={avatarStyle}>LM</div>
          <div style={bubbleStyle}>
            <b style={{ fontSize: 15, lineHeight: 1.45 }}>
              I understand what customers see today. What is the biggest thing you are launching or changing in the next 30–90 days?
            </b>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', lineHeight: 1.55 }}>
              This keeps me from optimizing yesterday&apos;s version of your business.
            </p>
          </div>
        </div>

        {/* founder-response */}
        <div style={founderResponseStyle}>
          <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)' }}>
            Your next important change
          </label>
          <textarea
            value={contextDelta}
            onChange={e => setContextDelta(e.target.value)}
            placeholder="Provider recruitment sprint in five Peoria ZIP codes..."
            rows={3}
            style={{
              width: '100%', minHeight: 82,
              border: '1px solid var(--border2)', borderRadius: 12,
              padding: 12, font: 'inherit', resize: 'vertical',
              background: 'white', outline: 'none', boxSizing: 'border-box',
              fontSize: 14, lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {QUICK_TAGS.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => appendTag(tag)}
                style={{
                  border: '1px solid var(--border)', background: 'white',
                  borderRadius: 999, padding: '6px 9px', fontSize: 10,
                  cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)',
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* ai-response-preview */}
        <div style={previewStyle}>
          <b>That changes the sequence.</b>{' '}
          I&apos;ll prioritize this initiative and serviceability proof before recommending a broad acquisition campaign.
        </div>

      </div>

      {/* report-actions */}
      <div style={actionsStyle}>
        <button type="button" style={skipStyle} onClick={handleSkip}>
          No major change
        </button>
        <button type="button" style={primaryStyle} onClick={handleContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
