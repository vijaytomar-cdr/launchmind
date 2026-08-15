/**
 * @file app/onboarding/audience/page.tsx
 * @description Phase 1 Step 8: Audience alignment.
 *   Matches fv-step[8] from LaunchMind_Production_UX_July18_2026(15).html.
 *   Conversation-thread layout: LM message bubble → 3 choice buttons →
 *   inline-edit textarea (when "I'll correct it") → ai-response-preview.
 * @security Requires auth — middleware enforces it.
 * @dependencies api.onboarding.getClaims, saveAudience
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

type Choice = 'yes' | 'mostly' | 'edit' | null;

const AI_RESPONSES: Record<Exclude<Choice, null>, string> = {
  yes:    'Understood. I\'ll make this audience my primary focus when researching channels, creatives, and growth opportunities.',
  mostly: 'Understood. I\'ll use your description as the primary focus and adjust recommendations based on what you\'ve confirmed.',
  edit:   'Understood. I\'ll use your described audience as the primary focus for all channel, content, and growth recommendations.',
};

/** Spec button helpers */
const btnPrimary: React.CSSProperties = {
  height: 38, borderRadius: 10, border: '1px solid var(--sage)',
  background: 'var(--sage)', color: '#fff', padding: '0 13px',
  fontWeight: 650, cursor: 'pointer', fontSize: 14,
};
const btnSkip: React.CSSProperties = {
  border: 0, background: 'none', color: 'var(--ink3)',
  fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0,
};

export default function AudiencePage() {
  const router = useRouter();
  const [sessionId, setSessionId]   = useState('');
  const [aiAudience, setAiAudience] = useState('');       // AI's inferred audience
  const [confidence, setConfidence] = useState(82);
  const [choice, setChoice]         = useState<Choice>(null);
  const [editText, setEditText]     = useState('');       // textarea when "I'll correct it"
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/audience'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);

      // Pre-fill from ICP claim
      try {
        const r = await api.onboarding.getClaims(sid, session.access_token);
        const icpClaim = (r?.claims ?? []).find(c => c.category === 'icp');
        if (icpClaim?.body) {
          setAiAudience(icpClaim.body);
          setEditText(icpClaim.body);
          if (icpClaim.confidence) setConfidence(Math.round(icpClaim.confidence * 100));
        } else {
          // Fallback placeholder so the bubble is always populated
          setAiAudience('your primary customer based on product listing, screenshots, and review language.');
          setEditText('');
        }
      } catch { /* start with placeholder */ }
    }
    load();
  }, [router]);

  function selectChoice(c: Exclude<Choice, null>) {
    setChoice(c);
    // When switching away from "edit", reset textarea to AI audience
    if (c !== 'edit') setEditText(aiAudience);
    // When switching to "edit", leave existing editText (or AI audience as default)
    if (c === 'edit' && !editText) setEditText(aiAudience);
  }

  async function handleContinue() {
    if (!choice || saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }

    const audienceConfirmed = choice === 'edit'
      ? (editText.trim() || aiAudience)
      : aiAudience;

    try {
      await api.onboarding.saveAudience(
        sessionId,
        { audienceConfirmed, confidenceResponse: choice },
        session.access_token,
      );
      router.push('/onboarding/positioning');
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error('[audience] saveAudience failed:', msg);
      setSaveError(msg);
      setSaving(false);
    }
  }

  async function handleSkip() {
    // Must call saveAudience so the state machine advances to ALIGNMENT_CONTEXT.
    // Use the AI-inferred audience as the default (min 10 chars required by schema).
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    const fallback = aiAudience.trim().length >= 10
      ? aiAudience.trim()
      : 'Primary audience to be refined later';
    try {
      await api.onboarding.saveAudience(
        sessionId,
        { audienceConfirmed: fallback },
        session.access_token,
      );
    } catch { /* best effort — navigate regardless */ }
    router.push('/onboarding/positioning');
  }

  const showEdit     = choice === 'edit';
  const showResponse = choice !== null;

  return (
    <div>
      {/* .fv-kicker */}
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
        Confirm your audience
      </div>

      {/* .conversation-thread */}
      <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>

        {/* .ai-message */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {/* .message-avatar */}
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
            color: 'white', display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 900, flexShrink: 0,
            boxShadow: '0 8px 20px rgba(11,143,105,.18)',
          }}>
            LM
          </div>

          {/* .message-bubble */}
          <div style={{
            maxWidth: 650, background: '#f7faf8',
            border: '1px solid var(--border)',
            borderRadius: '4px 16px 16px 16px',
            padding: '16px 17px',
          }}>
            <b style={{ fontSize: 15, lineHeight: 1.45, display: 'block', color: 'var(--ink)' }}>
              {aiAudience
                ? `I believe your primary customer is ${aiAudience}`
                : 'I have inferred your primary audience from your listing, screenshots, service categories, and review language.'}
            </b>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', lineHeight: 1.55, fontSize: 14 }}>
              I inferred this from your listing, screenshots, service categories, and review language. How close am I?
            </p>
            {/* .source-row */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 10, padding: '4px 7px', borderRadius: 999, background: 'white', border: '1px solid var(--border)', color: 'var(--ink3)' }}>
                AI inference
              </span>
              <span style={{ fontSize: 10, padding: '4px 7px', borderRadius: 999, background: 'white', border: '1px solid var(--border)', color: 'var(--ink3)' }}>
                {confidence}% confidence
              </span>
            </div>
          </div>
        </div>

        {/* .conversation-choices */}
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', paddingLeft: 48 }}>
          {([
            { key: 'yes',    label: 'Perfect' },
            { key: 'mostly', label: 'Mostly right' },
            { key: 'edit',   label: "I'll correct it" },
          ] as const).map(opt => {
            const isSelected = choice === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => selectChoice(opt.key)}
                style={{
                  height: 38, borderRadius: 10, padding: '0 13px', fontWeight: 700,
                  cursor: 'pointer', fontSize: 13,
                  border: `1px solid ${isSelected ? 'var(--sage3)' : 'var(--border2)'}`,
                  background: isSelected ? 'var(--sage2)' : 'white',
                  color: isSelected ? '#087253' : 'var(--ink)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* .inline-edit — only when "I'll correct it" */}
        {showEdit && (
          <div style={{ display: 'grid', gap: 7, paddingLeft: 48 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)' }}>
              Describe your primary customer
            </label>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
              style={{
                width: '100%', minHeight: 82,
                border: '1px solid var(--border2)', borderRadius: 12,
                padding: 12, fontFamily: 'inherit', resize: 'vertical',
                background: 'white', fontSize: 14, lineHeight: 1.5,
                outline: 'none', color: 'var(--ink)', boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* .ai-response-preview — shown after any choice */}
        {showResponse && (
          <div style={{
            marginLeft: 48, padding: '11px 13px',
            background: 'var(--sage2)', border: '1px solid var(--sage3)',
            borderRadius: '4px 12px 12px 12px',
            color: 'var(--ink2)', fontSize: 11, lineHeight: 1.5,
          }}>
            <b style={{ color: 'var(--ink)' }}>Understood.</b>{' '}
            {AI_RESPONSES[choice as Exclude<Choice, null>]}
          </div>
        )}
      </div>

      {/* debug error display */}
      {saveError && (
        <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 9, background: 'var(--danger2)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 12 }}>
          Error: {saveError}
        </div>
      )}

      {/* .report-actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={handleSkip} style={btnSkip}>
          Refine later
        </button>
        <button
          onClick={handleContinue}
          disabled={!choice || saving}
          style={{
            ...btnPrimary,
            cursor: !choice || saving ? 'not-allowed' : 'pointer',
            background: !choice ? 'var(--raised)' : 'var(--sage)',
            border: !choice ? '1px solid var(--border)' : '1px solid var(--sage)',
            color: !choice ? 'var(--ink3)' : '#fff',
          }}
        >
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
