/**
 * @file app/onboarding/direction/page.tsx
 * @description Phase 1 Step 15: 30-day direction result.
 *   Presents the AI-generated objective, grid of key facts, 4-week timeline,
 *   and data-needed disclosure. Founder completes Phase 1 from here.
 * @security Requires active Supabase session. Route guard enforces DIRECTION_COMPLETE state.
 * @dependencies api.onboarding.getSessionById, api.onboarding.getDirection, api.onboarding.completePhase1
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type OnboardingStrategyDirection, type WeekPlan } from '@/lib/api';
import type { OnboardingState } from '@/lib/api';

export default function DirectionPage() {
  const router = useRouter();
  const [sessionId, setSessionId]   = useState('');
  const [direction, setDirection]   = useState<OnboardingStrategyDirection | null>(null);
  const [loading, setLoading]       = useState(true);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/direction'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
      try {
        // Route guard: fetch session state first, redirect if not ready
        const sr = await api.onboarding.getSessionById(sid, session.access_token);
        const sess = sr?.session;
        if (sess) {
          const state: OnboardingState = sess.current_state;
          if (state === 'PHASE_1_COMPLETE') { router.replace('/onboarding/complete'); return; }
          if (state === 'DIRECTION_GENERATING') { router.replace('/onboarding/generating'); return; }
          if (state !== 'DIRECTION_COMPLETE') {
            const STATE_ROUTE: Partial<Record<OnboardingState, string>> = {
              WORKSPACE_SETUP:        '/onboarding/workspace',
              DISCOVERY_PENDING:      '/onboarding/discovery',
              DISCOVERY_IN_PROGRESS:  '/onboarding/analysis',
              DISCOVERY_MATCH_NEEDED: '/onboarding/discovery',
              DISCOVERY_FAILED:       '/onboarding/discovery',
              PRELIMINARY_REPORT:     '/onboarding/report',
              BELIEF_REVIEW:          '/onboarding/beliefs',
              ALIGNMENT_AUDIENCE:     '/onboarding/audience',
              ALIGNMENT_CONTEXT:      '/onboarding/context-delta',
              ALIGNMENT_GOAL:         '/onboarding/goal',
              ALIGNMENT_COMPETITORS:  '/onboarding/competitors',
              BOUNDARIES_SETUP:       '/onboarding/boundaries',
              FINAL_REVIEW:           '/onboarding/review',
            };
            router.replace(STATE_ROUTE[state] ?? '/onboarding');
            return;
          }
        }
        const r = await api.onboarding.getDirection(sid, session.access_token);
        const d = r?.direction;
        if (!d || d.status !== 'ready') {
          router.replace('/onboarding/generating');
          return;
        }
        setDirection(d);
      } catch { router.replace('/onboarding'); }
      finally { setLoading(false); }
    }
    load();
  }, [router]);

  async function handleComplete() {
    if (completing) return;
    setCompleting(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      await api.onboarding.completePhase1(sessionId, { directionId: direction!.id, acknowledgedDirection: true }, session.access_token);
      router.push('/onboarding/complete');
    } catch (err) {
      alert((err as Error).message ?? 'Could not finish setting up your Growth Brain. Please try again.');
      setCompleting(false);
    }
  }

  function handleExport() {
    if (!direction) return;
    const lines = [
      'Your 30-Day Growth Direction',
      '============================',
      '',
      displayPrimaryObjective  ? `PRIMARY OBJECTIVE\n${displayPrimaryObjective}` : '',
      '',
      displayBiggestConstraint ? `BIGGEST CONSTRAINT\n${displayBiggestConstraint}` : '',
      '',
      displayFirstMission      ? `FIRST MISSION\n${displayFirstMission}` : '',
      '',
      displayImmediateAction   ? `ACTION FOR TODAY\n${displayImmediateAction}` : '',
      '',
      displaySuccessSignal     ? `SUCCESS SIGNAL\n${displaySuccessSignal}` : '',
      '',
      '4-WEEK PLAN',
      direction.week_1?.focus ? `Week 1: ${direction.week_1.focus}` : '',
      direction.week_2?.focus ? `Week 2: ${direction.week_2.focus}` : '',
      direction.week_3?.focus ? `Week 3: ${direction.week_3.focus}` : '',
      direction.week_4?.focus ? `Week 4: ${direction.week_4.focus}` : '',
    ].filter(Boolean).join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'launchmind-direction.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--ink3)' }}>Loading your direction…</div>
    </div>
  );

  if (!direction) return null;

  const weeks: Array<{ label: string; data: WeekPlan | null }> = [
    { label: 'Week 1', data: direction.week_1 },
    { label: 'Week 2', data: direction.week_2 },
    { label: 'Week 3', data: direction.week_3 },
    { label: 'Week 4', data: direction.week_4 },
  ];

  const missingParts = direction.missing_data?.filter(Boolean) ?? [];

  // Derive display values — prefer direction_meta fields, fall back to existing week/risk data
  // for direction rows generated before migration 071 (direction_meta was null).
  const w1tasks     = direction.week_1?.tasks ?? [];
  const displayPrimaryObjective  = direction.primary_objective  ?? direction.headline ?? null;
  const displayBiggestConstraint = direction.biggest_constraint ?? direction.risk_flags?.[0]     ?? null;
  const displayFirstMission      = direction.first_mission      ?? w1tasks[0]                    ?? null;
  const displayImmediateAction   = direction.immediate_action   ?? w1tasks[1] ?? w1tasks[0]      ?? null;
  const displaySuccessSignal     = direction.success_signal     ?? direction.week_1?.expectedOutcome ?? null;
  const displayConfidenceLevel   = direction.confidence_level   ?? undefined;

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 850, letterSpacing: '.1em',
    textTransform: 'uppercase', color: 'var(--ink3)',
    display: 'block', marginBottom: 5,
  };

  return (
    <div style={{ flex: 1, maxWidth: 640, margin: '0 auto', width: '100%' }}>

      {/* Kicker */}
      <div style={{
        fontSize: 10, fontWeight: 850, letterSpacing: '.13em',
        textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 14,
      }}>
        Your personalized first deliverable
      </div>

      <h2 style={{
        fontFamily: 'Syne, sans-serif', fontSize: 26, fontWeight: 700,
        color: 'var(--ink)', lineHeight: 1.25, margin: '0 0 10px',
      }}>
        Your 30-day growth direction
      </h2>

      <p style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 24px' }}>
        This is not a generic checklist. It is the first strategic sequence generated from what LaunchMind learned.
      </p>

      {/* Direction card */}
      <div style={{
        background: '#fff', border: '1px solid var(--border)',
        borderRadius: 14, padding: 20, display: 'grid', gap: 18, marginBottom: 24,
      }}>

        {/* Direction head: primary objective + confidence pill */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <small style={labelStyle}>PRIMARY OBJECTIVE</small>
            <h3 style={{
              margin: 0, fontSize: 15, fontWeight: 700,
              color: 'var(--ink)', lineHeight: 1.45,
            }}>
              {displayPrimaryObjective ?? 'Objective being refined.'}
            </h3>
          </div>
          {displayConfidenceLevel !== undefined && (
            <span style={{
              background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
              color: 'var(--sage)', borderRadius: 999,
              padding: '5px 11px', fontSize: 12, fontWeight: 750, flexShrink: 0,
            }}>
              {displayConfidenceLevel}% confidence
            </span>
          )}
        </div>

        {/* Direction grid: 4 cells */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: 'var(--raised)', borderRadius: 10, padding: '12px 13px' }}>
            <small style={labelStyle}>BIGGEST CONSTRAINT</small>
            <b style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45, display: 'block' }}>
              {displayBiggestConstraint ?? '—'}
            </b>
          </div>
          <div style={{ background: 'var(--raised)', borderRadius: 10, padding: '12px 13px' }}>
            <small style={labelStyle}>FIRST MISSION</small>
            <b style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45, display: 'block' }}>
              {displayFirstMission ?? '—'}
            </b>
          </div>
          <div style={{ background: 'var(--raised)', borderRadius: 10, padding: '12px 13px' }}>
            <small style={labelStyle}>ACTION FOR TODAY</small>
            <b style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45, display: 'block' }}>
              {displayImmediateAction ?? '—'}
            </b>
          </div>
          <div style={{ background: 'var(--raised)', borderRadius: 10, padding: '12px 13px' }}>
            <small style={labelStyle}>SUCCESS SIGNAL</small>
            <b style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45, display: 'block' }}>
              {displaySuccessSignal ?? '—'}
            </b>
          </div>
        </div>

        {/* Direction timeline: 4 weeks */}
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 14,
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9,
        }}>
          {weeks.map(({ label, data }) => (
            <div key={label} style={{ fontSize: 12 }}>
              <i style={{ display: 'block', fontStyle: 'italic', color: 'var(--ink3)', marginBottom: 4 }}>
                {label}
              </i>
              <span style={{ color: 'var(--ink2)', lineHeight: 1.5, display: 'block' }}>
                {data?.focus ?? 'To be refined as you execute.'}
              </span>
            </div>
          ))}
        </div>

        {/* Data needed */}
        <div style={{
          display: 'flex', gap: 9, background: 'var(--raised)',
          borderRadius: 10, padding: '11px 13px', fontSize: 12,
        }}>
          <span style={{ flexShrink: 0, fontWeight: 800, color: 'var(--ink3)', fontSize: 14 }}>i</span>
          <p style={{ margin: 0, color: 'var(--ink2)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--ink)', fontWeight: 700 }}>What LaunchMind still cannot see:</b>{' '}
            {missingParts.length > 0
              ? `${missingParts.join(', ')}. Connecting these later makes specific recommendations sharper — your setup is complete without them.`
              : 'actual request volume, fulfillment rate, campaign performance, and revenue. Connecting these later makes specific recommendations sharper — your setup is complete without them.'
            }
          </p>
        </div>
      </div>

      {/* Report actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleExport}
          style={{
            height: 44, padding: '0 18px', borderRadius: 10,
            border: '1px solid var(--border)', background: '#fff',
            color: 'var(--ink)', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Export direction
        </button>
        <button
          onClick={handleComplete}
          disabled={completing}
          style={{
            flex: 1, height: 44, borderRadius: 10, border: 'none',
            background: completing ? 'var(--raised)' : 'var(--sage)',
            color: completing ? 'var(--ink3)' : '#fff',
            fontSize: 14, fontWeight: 600,
            cursor: completing ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {completing ? 'Completing…' : 'Open completion summary →'}
        </button>
      </div>
    </div>
  );
}
