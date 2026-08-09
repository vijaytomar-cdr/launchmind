/**
 * @file app/onboarding/boundaries/page.tsx
 * @description Phase 1 Trust and control — Set working boundaries.
 *   Founder selects autonomy level and explicitly acknowledges what LaunchMind may/may not do.
 *   founderAcknowledged: true is server-enforced as z.literal(true).
 *   Matches fv-step[12] in LaunchMind_Production_UX_July18_2026(15).html.
 * @security Auth enforced by middleware. founderAcknowledged is server-validated.
 * @dependencies api.onboarding.saveBoundaries, supabase auth
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

type WorkingStyle = 'advise_only' | 'build_plans' | 'draft_prepare' | 'execute_with_approval';

const AUTONOMY_OPTIONS: Array<{
  value:   WorkingStyle;
  icon:    string;
  label:   string;
  sub:     string;
}> = [
  {
    value: 'advise_only',
    icon:  '◌',
    label: 'Advise me',
    sub:   'Recommend priorities and explain why',
  },
  {
    value: 'build_plans',
    icon:  '▤',
    label: 'Build plans',
    sub:   'Create strategies, missions, and experiments',
  },
  {
    value: 'draft_prepare',
    icon:  '✎',
    label: 'Draft and prepare',
    sub:   'Create content and campaign drafts for approval',
  },
  {
    value: 'execute_with_approval',
    icon:  '▶',
    label: 'Execute with approval later',
    sub:   'Available only after relevant connections and safety controls',
  },
];

/* Map UI options to DB-accepted working_style values (backend accepts hands_off | balanced | hands_on) */
const STYLE_API_MAP: Record<WorkingStyle, 'hands_off' | 'balanced' | 'hands_on'> = {
  advise_only:            'hands_off',
  build_plans:            'balanced',
  draft_prepare:          'balanced',
  execute_with_approval:  'hands_on',
};

/* Dynamic boundary copy — updates when the founder picks a different autonomy level */
const BOUNDARY_COPY: Record<WorkingStyle, { may: string; mayNot: string }> = {
  advise_only: {
    may:    'Research public information, analyse data, and recommend priorities with explanations.',
    mayNot: 'Build strategy documents, create content, post anything, connect accounts, or spend money.',
  },
  build_plans: {
    may:    'Research public information, recommend priorities, and build strategy plans and mission blueprints.',
    mayNot: 'Create content drafts, post anything, connect accounts, or spend money.',
  },
  draft_prepare: {
    may:    'Research public information, recommend priorities, build plans, and prepare content and campaign drafts for your review.',
    mayNot: 'Publish content, connect accounts, launch campaigns, or spend money without your approval.',
  },
  execute_with_approval: {
    may:    'Research, recommend, build plans, prepare drafts, and queue approved actions for execution.',
    mayNot: 'Take any action — including posting, spending, or connecting — without your explicit approval first.',
  },
};

export default function BoundariesPage() {
  const router = useRouter();
  const [sessionId, setSessionId]         = useState('');
  const [workingStyle, setWorkingStyle]   = useState<WorkingStyle>('draft_prepare');
  const [acknowledged, setAcknowledged]   = useState(false);
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/boundaries'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
    }
    load();
  }, [router]);

  async function handleConfirm() {
    if (!acknowledged || saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    try {
      await api.onboarding.saveBoundaries(sessionId, {
        workingStyle:        STYLE_API_MAP[workingStyle],
        founderAcknowledged: true,
      }, session.access_token);
      router.push('/onboarding/review');
    } catch (err) {
      alert((err as Error).message ?? 'Could not save. Please try again.');
      setSaving(false);
    }
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

  const primaryStyle: React.CSSProperties = {
    borderRadius: 10, border: '1px solid var(--sage)',
    background: acknowledged ? 'var(--sage)' : 'var(--raised)',
    color: acknowledged ? '#fff' : 'var(--ink3)',
    borderColor: acknowledged ? 'var(--sage)' : 'var(--border)',
    height: 38, padding: '0 20px', fontWeight: 650,
    cursor: (!acknowledged || saving) ? 'not-allowed' : 'pointer',
    fontSize: 14, fontFamily: 'inherit',
    opacity: saving ? 0.7 : 1,
    transition: 'background .18s, color .18s, border-color .18s',
  };

  return (
    <div>
      {/* fv-kicker */}
      <div style={kickerStyle}>Trust and control · Set working boundaries</div>

      {/* conversation-thread */}
      <div style={threadStyle}>

        {/* ai-message */}
        <div style={aiMsgStyle}>
          <div style={avatarStyle}>LM</div>
          <div style={bubbleStyle}>
            <b style={{ fontSize: 15, lineHeight: 1.45 }}>
              How involved should LaunchMind be during this stage?
            </b>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', lineHeight: 1.55 }}>
              This preference controls what I may prepare. It does not grant access to external accounts.
            </p>
          </div>
        </div>

        {/* autonomy-grid */}
        <div style={{ display: 'grid', gap: 9, marginLeft: 48 }}>
          {AUTONOMY_OPTIONS.map(opt => {
            const isSelected = workingStyle === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setWorkingStyle(opt.value)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '34px 1fr auto',
                  alignItems: 'center',
                  gap: 10, textAlign: 'left',
                  border: isSelected ? '1px solid var(--sage)' : '1px solid var(--border)',
                  background: isSelected ? '#f6fffb' : 'white',
                  borderRadius: 13, padding: 12, cursor: 'pointer',
                  boxShadow: isSelected ? '0 0 0 2px var(--sage2)' : 'none',
                  fontFamily: 'inherit',
                  transition: 'background .15s, border-color .15s, box-shadow .15s',
                }}
              >
                {/* auto-icon */}
                <span style={{
                  width: 34, height: 34, borderRadius: 10,
                  background: 'var(--raised)', display: 'grid', placeItems: 'center',
                  fontSize: 16,
                }}>
                  {opt.icon}
                </span>
                <span>
                  <b style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }}>{opt.label}</b>
                  <small style={{ display: 'block', color: 'var(--ink3)', marginTop: 3, fontSize: 11 }}>
                    {opt.sub}
                  </small>
                </span>
                <span style={{ color: isSelected ? 'var(--sage)' : 'var(--ink3)', fontSize: 16 }}>
                  {isSelected ? '✓' : '›'}
                </span>
              </button>
            );
          })}
        </div>

      </div>

      {/* boundary-summary */}
      <div style={{
        margin: '15px 0 0 48px', border: '1px solid var(--border)',
        borderRadius: 13, padding: 14,
      }}>
        <h3 style={{ margin: '0 0 9px', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
          Your current working boundaries
        </h3>

        {/* LaunchMind may — updates with selection */}
        <div style={{
          display: 'flex', gap: 8, padding: '9px 0',
          borderTop: '1px solid var(--border)',
        }}>
          <span style={{ color: 'var(--sage)', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>✓</span>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--ink2)' }}>
            <b>LaunchMind may</b><br />
            {BOUNDARY_COPY[workingStyle].may}
          </p>
        </div>

        {/* LaunchMind may not — updates with selection */}
        <div style={{
          display: 'flex', gap: 8, padding: '9px 0',
          borderTop: '1px solid var(--border)',
        }}>
          <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>×</span>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--ink2)' }}>
            <b>LaunchMind may not</b><br />
            {BOUNDARY_COPY[workingStyle].mayNot}
          </p>
        </div>

        {/* checkline */}
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          color: 'var(--ink2)', fontSize: 11, marginTop: 13,
          lineHeight: 1.45, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            style={{
              marginTop: 1, flexShrink: 0,
              accentColor: 'var(--sage)', cursor: 'pointer',
            }}
          />
          I understand and confirm these boundaries.
        </label>
      </div>

      {/* report-actions */}
      <div style={actionsStyle}>
        <span />
        <button
          type="button"
          style={primaryStyle}
          onClick={handleConfirm}
          disabled={!acknowledged || saving}
        >
          {saving ? 'Saving…' : 'Confirm boundaries →'}
        </button>
      </div>
    </div>
  );
}
