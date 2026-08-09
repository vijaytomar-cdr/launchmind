/**
 * @file app/onboarding/competitors/page.tsx
 * @description Phase 1 Alignment 4 of 4 — Confirm competitors.
 *   Founder reviews AI-discovered competitors, removes irrelevant ones, adds missing ones.
 *   Matches fv-step[11] in LaunchMind_Production_UX_July18_2026(15).html.
 * @security Auth enforced by middleware. Session ID from sessionStorage.
 * @dependencies api.onboarding.saveCompetitors, api.onboarding.getSessionById, supabase auth
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

interface LocalCompetitor {
  id:           string;
  name:         string;
  relationship: string;
}

export default function CompetitorsPage() {
  const router = useRouter();
  const [sessionId, setSessionId]         = useState('');
  const [competitors, setCompetitors]     = useState<LocalCompetitor[]>([]);
  const [addName, setAddName]             = useState('');
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/competitors'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);

      try {
        const r = await api.onboarding.getDiscovery(sid, session.access_token);
        const aiCompetitors = r?.job?.competitor_data?.competitors ?? [];
        if (aiCompetitors.length > 0) {
          setCompetitors(aiCompetitors.map((c, i) => ({
            id:           `ai-${i}`,
            name:         c.name,
            relationship: c.relationship ?? 'Direct competitor',
          })));
        }
      } catch { /* start empty — founder adds manually */ }
    }
    load();
  }, [router]);

  function removeCompetitor(id: string) {
    setCompetitors(prev => prev.filter(c => c.id !== id));
  }

  function addCompetitor() {
    const trimmed = addName.trim();
    if (!trimmed) return;
    setCompetitors(prev => [
      ...prev,
      { id: `manual-${Date.now()}`, name: trimmed, relationship: 'Added by founder' },
    ]);
    setAddName('');
  }

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addCompetitor(); }
  }

  async function handleContinue() {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    try {
      const payload = competitors.map(c => ({
        id:           c.id,
        name:         c.name,
        relationship: 'CONFIRMED' as const,
        discoveredBy: 'FOUNDER' as const,
      }));
      await api.onboarding.saveCompetitors(sessionId, { competitors: payload }, session.access_token);
      router.push('/onboarding/boundaries');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (saving) return;
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    try {
      const payload = competitors.map(c => ({
        id:           c.id,
        name:         c.name,
        relationship: 'CONFIRMED' as const,
        discoveredBy: 'FOUNDER' as const,
      }));
      await api.onboarding.saveCompetitors(sessionId, { competitors: payload }, session.access_token);
    } catch { /* best effort */ }
    router.push('/onboarding/boundaries');
  }

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

  const secondaryStyle: React.CSSProperties = {
    borderRadius: 10, border: '1px solid var(--sage3)',
    background: 'var(--sage2)', color: '#096b50',
    height: 38, padding: '0 16px', fontWeight: 650,
    cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
    flexShrink: 0,
  };

  return (
    <div>
      {/* fv-kicker */}
      <div style={kickerStyle}>Alignment 4 of 4 · Confirm competitors</div>

      {/* conversation-thread */}
      <div style={threadStyle}>

        {/* ai-message */}
        <div style={aiMsgStyle}>
          <div style={avatarStyle}>LM</div>
          <div style={bubbleStyle}>
            <b style={{ fontSize: 15, lineHeight: 1.45 }}>
              {competitors.length > 0
                ? 'I identified the businesses most likely competing for the same customer and intent.'
                : "I couldn't identify competitors automatically — your app has limited public reviews and description data to analyse."}
            </b>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', lineHeight: 1.55 }}>
              {competitors.length > 0
                ? 'Add, remove, or reclassify them. Confirmed competitors become part of your Growth Brain.'
                : 'Add competitors you know about below. They\'ll become part of your Growth Brain and sharpen your channel strategy.'}
            </p>
          </div>
        </div>

        {/* competitor-list */}
        {competitors.length > 0 && (
          <div style={{ display: 'grid', gap: 9, marginLeft: 48 }}>
            {competitors.map(comp => (
              <div key={comp.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: '1px solid var(--border)', background: 'white',
                borderRadius: 12, padding: '11px 12px',
              }}>
                {/* Logo circle — first letter */}
                <div style={{
                  width: 30, height: 30, borderRadius: 9,
                  background: 'var(--raised)', display: 'grid',
                  placeItems: 'center', fontWeight: 850,
                  fontSize: 13, color: 'var(--ink)', flexShrink: 0,
                }}>
                  {comp.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13, color: 'var(--ink)' }}>{comp.name}</b>
                  <small style={{ display: 'block', color: 'var(--ink3)', marginTop: 2, fontSize: 11 }}>
                    {comp.relationship}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => removeCompetitor(comp.id)}
                  style={{
                    marginLeft: 'auto', border: 0, background: 'transparent',
                    color: 'var(--ink3)', cursor: 'pointer',
                    fontSize: 18, lineHeight: 1, padding: '0 4px',
                    fontFamily: 'inherit', flexShrink: 0,
                  }}
                  aria-label={`Remove ${comp.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* add-competitor */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 48, marginTop: 9 }}>
          <input
            type="text"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Add another competitor"
            style={{
              flex: 1, height: 39, border: '1px solid var(--border2)',
              borderRadius: 10, padding: '0 11px', font: 'inherit',
              outline: 'none', background: 'white',
            }}
          />
          <button
            type="button"
            onClick={addCompetitor}
            disabled={!addName.trim()}
            style={{
              ...secondaryStyle,
              opacity: addName.trim() ? 1 : 0.5,
              cursor: addName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Add
          </button>
        </div>

        {/* ai-response-preview */}
        <div style={{
          marginLeft: 48, padding: '11px 13px',
          background: 'var(--sage2)', border: '1px solid var(--sage3)',
          borderRadius: '4px 12px 12px 12px',
          color: 'var(--ink2)', fontSize: 11, lineHeight: 1.5,
        }}>
          {competitors.length > 0 ? (
            <><b>Competitor set updated.</b>{' '}I&apos;ll compare local availability, trust messaging, price transparency, and booking friction—not just feature lists.</>
          ) : (
            <><b>No competitors confirmed yet.</b>{' '}You can continue without competitors — I&apos;ll use category benchmarks instead. Or add names below to sharpen recommendations.</>
          )}
        </div>

      </div>

      {/* report-actions */}
      <div style={actionsStyle}>
        <button type="button" style={skipStyle} onClick={handleSkip}>
          Use discovered set
        </button>
        <button type="button" style={primaryStyle} onClick={handleContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
