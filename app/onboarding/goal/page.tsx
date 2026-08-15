/**
 * @file app/onboarding/goal/page.tsx
 * @description Phase 1 Define measurable success
 *   Founder picks one primary goal from 4 options and enters baseline/target/time horizon.
 *   Matches fv-step[10] in LaunchMind_Production_UX_July18_2026(15).html.
 * @security Auth enforced by middleware. Session ID from sessionStorage.
 * @dependencies api.onboarding.saveGoal, supabase auth
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

const GOAL_OPTIONS = [
  { value: 'bookings',    icon: '◎', label: 'Increase fulfilled bookings', sub: 'Provider coverage and conversion' },
  { value: 'installs',    icon: '↗', label: 'Increase installs',           sub: 'Acquisition and store conversion' },
  { value: 'revenue',     icon: '$', label: 'Increase revenue',            sub: 'Monetization and repeat usage' },
  { value: 'new_market',  icon: '◈', label: 'Validate a new market',       sub: 'Research and controlled experiments' },
] as const;

type GoalValue = typeof GOAL_OPTIONS[number]['value'];

// Maps UI goal values to DB-accepted goal_type enum values
const GOAL_TYPE_MAP: Record<GoalValue, string> = {
  bookings:   'custom',
  installs:   'installs',
  revenue:    'revenue',
  new_market: 'custom',
};

const GOAL_CUSTOM_METRIC: Record<GoalValue, string | undefined> = {
  bookings:   'fulfilled bookings',
  installs:   undefined,
  revenue:    undefined,
  new_market: 'new market validation',
};

const GOAL_UNIT: Record<GoalValue, string> = {
  bookings:   'bookings / month',
  installs:   'installs / week',
  revenue:    '$ / month',
  new_market: 'experiments',
};

const AI_RESPONSES: Record<GoalValue, string> = {
  bookings:   "Success definition saved. I'll optimize for a 25% increase in fulfilled bookings, not vanity metrics such as impressions or raw installs.",
  installs:   "Success definition saved. I'll weight acquisition channels by install rate and store conversion — not impressions.",
  revenue:    "Success definition saved. I'll focus on channels that convert browsers to payers, not just raw installs.",
  new_market: "Success definition saved. I'll design low-cost validation experiments before recommending broad spend.",
};

const TIME_OPTIONS = [
  { label: '90 days', days: 90 },
  { label: '30 days', days: 30 },
  { label: '6 months', days: 180 },
];

export default function GoalPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState('');
  const [goalType, setGoalType]   = useState<GoalValue>('bookings');
  const [baseline, setBaseline]   = useState('');
  const [target, setTarget]       = useState('');
  const [timeDays, setTimeDays]   = useState(90);
  // G6 — how the owner judges marketing overall, which outlives any one target.
  const [successDef, setSuccessDef] = useState('');
  // G8 — a few supporting goals, ordered. Deliberately not an OKR system.
  const [supporting, setSupporting] = useState<string[]>([]);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/goal'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
    }
    load();
  }, [router]);

  async function handleContinue() {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    try {
      await api.onboarding.saveGoal(sessionId, {
        goalType:        GOAL_TYPE_MAP[goalType],
        customMetric:    GOAL_CUSTOM_METRIC[goalType],
        baselineValue:   baseline ? parseFloat(baseline) : undefined,
        targetValue:     target ? parseFloat(target) : 0,
        unit:            GOAL_UNIT[goalType],
        timeHorizonDays: timeDays,
        // G8. "I don't know yet" is a valid answer — an absent target must not
        // be turned into a fabricated one.
        targetUnknown:   !target,
        successDefinition: successDef.trim() || undefined,
        supportingGoals: supporting.map(id => ({
          goalType:      GOAL_TYPE_MAP[id as GoalValue],
          customMetric:  GOAL_CUSTOM_METRIC[id as GoalValue],
          targetValue:   0,
          targetUnknown: true,
          unit:          GOAL_UNIT[id as GoalValue],
        })),
      }, session.access_token);
      router.push('/onboarding/competitors');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    try {
      await api.onboarding.saveGoal(sessionId, {
        goalType:        GOAL_TYPE_MAP[goalType],
        customMetric:    GOAL_CUSTOM_METRIC[goalType],
        targetValue:     0,
        unit:            GOAL_UNIT[goalType],
        timeHorizonDays: timeDays,
      }, session.access_token);
    } catch { /* best effort */ }
    router.push('/onboarding/competitors');
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

  const fieldInputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid var(--border2)',
    background: 'white', borderRadius: 9,
    padding: '10px 11px', font: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 800,
    color: 'var(--ink2)', marginBottom: 6,
  };

  return (
    <div>
      {/* fv-kicker */}
      <div style={kickerStyle}>Define measurable success</div>

      {/* conversation-thread */}
      <div style={threadStyle}>

        {/* ai-message */}
        <div style={aiMsgStyle}>
          <div style={avatarStyle}>LM</div>
          <div style={bubbleStyle}>
            <b style={{ fontSize: 15, lineHeight: 1.45 }}>
              If I could improve only one outcome over the next 90 days, which should it be?
            </b>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', lineHeight: 1.55 }}>
              You can provide a measurable target now or let LaunchMind recommend a starting benchmark.
            </p>
          </div>
        </div>

        {/* goal-options — 2×2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginLeft: 48 }}>
          {GOAL_OPTIONS.map(opt => {
            const isSelected = goalType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGoalType(opt.value)}
                style={{
                  textAlign: 'left',
                  border: isSelected ? '1px solid var(--sage)' : '1px solid var(--border)',
                  background: isSelected ? '#f6fffb' : 'white',
                  borderRadius: 13, padding: 13, cursor: 'pointer',
                  display: 'grid', gridTemplateColumns: '28px 1fr', columnGap: 8,
                  boxShadow: isSelected ? '0 0 0 2px var(--sage2)' : 'none',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{
                  gridRow: '1/3', width: 28, height: 28, borderRadius: 9,
                  background: 'var(--raised)', display: 'grid', placeItems: 'center',
                  fontSize: 16, fontStyle: 'normal',
                }}>
                  {opt.icon}
                </span>
                <b style={{ fontSize: 12, display: 'block', color: 'var(--ink)' }}>{opt.label}</b>
                <small style={{ color: 'var(--ink3)', marginTop: 3, display: 'block', fontSize: 11 }}>
                  {opt.sub}
                </small>
              </button>
            );
          })}
        </div>

        {/* metric-grid — 3 fields */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginLeft: 48 }}>
          <div>
            <label style={fieldLabelStyle}>Current baseline</label>
            <input
              type="text"
              value={baseline}
              onChange={e => setBaseline(e.target.value)}
              placeholder="e.g. 80 / month"
              style={fieldInputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Target</label>
            <input
              type="text"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="e.g. 100 / month"
              style={fieldInputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Time horizon</label>
            <select
              value={timeDays}
              onChange={e => setTimeDays(parseInt(e.target.value, 10))}
              style={{ ...fieldInputStyle, paddingRight: 8 }}
            >
              {TIME_OPTIONS.map(opt => (
                <option key={opt.days} value={opt.days}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ai-response-preview — always open once a goal is selected */}
        <div style={{
          marginLeft: 48, padding: '11px 13px',
          background: 'var(--sage2)', border: '1px solid var(--sage3)',
          borderRadius: '4px 12px 12px 12px',
          color: 'var(--ink2)', fontSize: 11, lineHeight: 1.5,
        }}>
          <b>Success definition saved.</b>{' '}{AI_RESPONSES[goalType]}
        </div>

      </div>

      {/* ── G8 · supporting goals ─────────────────────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>
          Anything else you are working towards? <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(optional)</span>
        </label>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {(Object.keys(GOAL_UNIT) as GoalValue[]).filter(g => g !== goalType).slice(0, 6).map(g => {
            const on = supporting.includes(g);
            return (
              <button
                key={g} type="button"
                onClick={() => setSupporting(on ? supporting.filter(x => x !== g)
                  : supporting.length < 4 ? [...supporting, g] : supporting)}
                style={{
                  borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'var(--sage-d)' : 'var(--raised)',
                  border: `1px solid ${on ? 'var(--sage-b)' : 'var(--border2)'}`,
                  color: on ? 'var(--sage)' : 'var(--ink2)',
                }}
              >{GOAL_UNIT[g]}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 5 }}>
          Up to four. Your main goal above still outranks these.
        </div>
      </div>

      {/* ── G6 · success definition ───────────────────────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>
          What would make marketing successful for you? <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(optional)</span>
        </label>
        <textarea
          value={successDef} rows={2}
          onChange={e => setSuccessDef(e.target.value)}
          placeholder="In your own words — how you will judge whether this worked."
          style={{
            width: '100%', borderRadius: 9, border: '1px solid var(--border2)',
            background: '#fff', color: 'var(--ink)', padding: '10px 12px',
            fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
          }}
        />
      </div>

      {/* report-actions */}
      <div style={actionsStyle}>
        <button type="button" style={skipStyle} onClick={handleSkip}>
          Use an AI benchmark
        </button>
        <button type="button" style={primaryStyle} onClick={handleContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
