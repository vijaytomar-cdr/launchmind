/**
 * @file app/onboarding/review/page.tsx
 * @description Phase 1 Step 13: Final alignment review.
 *   Summarises the 5 key fields the founder confirmed before direction generation begins.
 * @security Requires active Supabase session. Route guard enforces FINAL_REVIEW state.
 * @dependencies api.onboarding.getSessionById, api.onboarding.generateDirection
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type OnboardingSession } from '@/lib/api';
import type { OnboardingState } from '@/lib/api';

const REVIEW_ALLOWED: OnboardingState[] = [
  'FINAL_REVIEW', 'DIRECTION_GENERATING', 'DIRECTION_COMPLETE', 'PHASE_1_COMPLETE',
];

const STATE_ROUTE: Partial<Record<OnboardingState, string>> = {
  WORKSPACE_SETUP:          '/onboarding/workspace',
  DISCOVERY_PENDING:        '/onboarding/discovery',
  DISCOVERY_IN_PROGRESS:    '/onboarding/analysis',
  DISCOVERY_MATCH_NEEDED:   '/onboarding/discovery',
  DISCOVERY_FAILED:         '/onboarding/discovery',
  PRELIMINARY_REPORT:       '/onboarding/report',
  BELIEF_REVIEW:            '/onboarding/beliefs',
  ALIGNMENT_AUDIENCE:       '/onboarding/audience',
  ALIGNMENT_CONTEXT:        '/onboarding/context-delta',
  ALIGNMENT_GOAL:           '/onboarding/goal',
  ALIGNMENT_COMPETITORS:    '/onboarding/competitors',
  BOUNDARIES_SETUP:         '/onboarding/boundaries',
  DIRECTION_GENERATING:     '/onboarding/generating',
  DIRECTION_COMPLETE:       '/onboarding/direction',
  PHASE_1_COMPLETE:         '/onboarding/complete',
};

export default function ReviewPage() {
  const router = useRouter();
  const [sessionId, setSessionId]   = useState('');
  const [session, setSession]       = useState<OnboardingSession | null>(null);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) { router.replace('/login?next=/onboarding/review'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
      try {
        const r = await api.onboarding.getSessionById(sid, authSession.access_token);
        const sess = r?.session ?? null;
        if (sess && !REVIEW_ALLOWED.includes(sess.current_state)) {
          router.replace(STATE_ROUTE[sess.current_state] ?? '/onboarding');
          return;
        }
        setSession(sess);
      } catch { router.replace('/onboarding'); }
      finally { setLoading(false); }
    }
    load();
  }, [router]);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    const supabase = createClient();
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession) return;
    try {
      await api.onboarding.generateDirection(sessionId, authSession.access_token);
      router.push('/onboarding/generating');
    } catch (err) {
      alert((err as Error).message ?? 'Could not start direction generation. Please try again.');
      setGenerating(false);
    }
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--ink3)' }}>Loading summary…</div>
    </div>
  );

  const s = session;
  const founderCtx  = s?.founder_context as Record<string, string> | undefined;
  const goal        = s?.business_goal as Record<string, string | number> | undefined;
  const boundaries  = s?.approval_boundary as Record<string, string | boolean | number> | undefined;
  const competitors = (s?.competitor_set ?? []) as Array<{ id: string; name: string; relationship: string; key_differentiator?: string }>;

  // Derive human-readable values for the 5 summary rows
  const audienceValue = founderCtx?.audience_confirmed || 'Not specified';

  const contextValue = founderCtx?.context_delta || founderCtx?.hidden_strengths || founderCtx?.recent_wins || 'Not specified';

  let goalValue = 'Not set';
  if (goal) {
    // Use custom_metric label when available (e.g. "fulfilled bookings"), else clean goal_type
    const metricLabel = (goal as Record<string, unknown>).custom_metric
      ? String((goal as Record<string, unknown>).custom_metric)
      : String(goal.goal_type ?? '').replace(/_/g, ' ');
    const verb = 'Increase';
    const fromTo = goal.baseline_value != null && goal.target_value != null
      ? `from ${goal.baseline_value} to ${goal.target_value}`
      : goal.target_value != null ? `to ${goal.target_value}` : '';
    const unit = goal.unit ? ` ${goal.unit}` : '';
    goalValue = [verb, metricLabel, fromTo + unit].filter(Boolean).join(' ');
  }

  const confirmedCompetitors = competitors.filter(c => c.relationship !== 'REJECTED');
  const competitorsValue = confirmedCompetitors.length > 0
    ? confirmedCompetitors.map(c => c.name).join(', ')
    : 'None confirmed';

  const STYLE_LABELS: Record<string, string> = {
    hands_off: 'Advise me',
    balanced:  'Draft and prepare',
    hands_on:  'Execute with approval',
  };
  const workingStyleRaw = boundaries?.working_style ? String(boundaries.working_style) : '';
  const boundaryValue = workingStyleRaw
    ? `${STYLE_LABELS[workingStyleRaw] ?? workingStyleRaw}; owner approves all execution`
    : 'Not set';

  // ── G1 · G2 · G5 · G7 — the owner must be able to correct these before
  // finishing, so every newly-captured field gets its own correctable row.
  const ctx = founderCtx as Record<string, unknown> | null;
  const str = (k: string) => (typeof ctx?.[k] === 'string' && ctx[k] ? String(ctx[k]) : '');

  const problemValue     = str('primary_customer_problem') || 'Not specified';
  const positioningValue = [str('positioning'), str('value_proposition')]
    .filter(Boolean).join(' · ') || 'Not specified';

  const marketList = Array.isArray(ctx?.markets) ? ctx.markets as Array<{ label?: string }> : [];
  // "Not specified" rather than a defaulted country: an unstated market is now
  // genuinely unknown, and saying so is the point of closing G7.
  const marketValue = marketList.length
    ? marketList.map(m => m.label ?? '').filter(Boolean).join(', ')
    : 'Not specified';

  const channelList = Array.isArray(ctx?.current_channels)
    ? ctx.current_channels as Array<{ channel?: string; status?: string }> : [];

  // §8 · presented as TWO separate facts, because they mean different things.
  // "LaunchMind found your App Store listing" and "you actively market on the
  // App Store" must never read as the same statement on a review screen the
  // owner is using to decide whether we understood their business.
  const pretty = (c: { channel?: string; status?: string }) =>
    `${String(c.channel ?? '').replace(/_/g, ' ')}${c.status === 'planning' ? ' (planning)' : ''}`;

  const observedValue = channelList.filter(c => c.status === 'observed').length
    ? channelList.filter(c => c.status === 'observed')
        .map(c => String(c.channel ?? '').replace(/_/g, ' ')).join(', ')
    : 'None detected';

  const ownerChannels = channelList.filter(c => c.status === 'using' || c.status === 'planning');
  const channelValue = ownerChannels.length
    ? (ownerChannels[0]?.channel === 'none_yet'
        ? 'Nothing running yet'
        : ownerChannels.map(pretty).join(', '))
    : 'Not specified';

  const rows = [
    { label: 'AUDIENCE',        value: audienceValue,     href: '/onboarding/audience' },
    { label: 'THEIR PROBLEM',   value: problemValue,      href: '/onboarding/positioning' },
    { label: 'POSITIONING',     value: positioningValue,  href: '/onboarding/positioning' },
    { label: 'MARKETS',         value: marketValue,       href: '/onboarding/positioning' },
    { label: 'FOUND BY LAUNCHMIND', value: observedValue, href: '/onboarding/positioning' },
    { label: 'YOU ACTIVELY USE', value: channelValue,     href: '/onboarding/positioning' },
    { label: "WHAT'S CHANGING", value: contextValue,      href: '/onboarding/context-delta' },
    { label: '90-DAY SUCCESS',  value: goalValue,         href: '/onboarding/goal' },
    { label: 'COMPETITORS',     value: competitorsValue,  href: '/onboarding/competitors' },
    { label: 'WORKING BOUNDARY', value: boundaryValue,    href: '/onboarding/boundaries' },
  ];

  return (
    <div style={{ flex: 1, maxWidth: 640, margin: '0 auto', width: '100%' }}>

      {/* Kicker */}
      <div style={{
        fontSize: 10, fontWeight: 850, letterSpacing: '.13em',
        textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 14,
      }}>
        Final review
      </div>

      <h2 style={{
        fontFamily: 'Syne, sans-serif', fontSize: 26, fontWeight: 700,
        color: 'var(--ink)', marginBottom: 10, lineHeight: 1.25, margin: '0 0 10px',
      }}>
        Here is the Growth Brain you are creating.
      </h2>

      <p style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 28px' }}>
        Review the private context LaunchMind will use. You can edit any item before generating the first direction.
      </p>

      {/* Summary review rows */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 12,
        overflow: 'hidden', marginBottom: 22, background: '#fff',
      }}>
        {rows.map((row, i) => (
          <div key={row.label} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 18px',
            borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <small style={{
                display: 'block', fontSize: 9, fontWeight: 850,
                letterSpacing: '.1em', textTransform: 'uppercase',
                color: 'var(--ink3)', marginBottom: 4,
              }}>
                {row.label}
              </small>
              <b style={{
                fontSize: 13, fontWeight: 650, color: 'var(--ink)',
                lineHeight: 1.45, display: 'block',
              }}>
                {row.value}
              </b>
            </div>
            <button
              onClick={() => router.push(row.href)}
              style={{
                fontSize: 12, color: 'var(--ink3)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '4px 0',
                fontFamily: 'inherit', flexShrink: 0, fontWeight: 500,
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>

      {/* Success notice */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        background: 'var(--sage2)', border: '1px solid var(--sage3)',
        borderRadius: 12, padding: '14px 16px', marginBottom: 24,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', background: 'var(--sage)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, marginTop: 1, color: '#fff', fontSize: 12, fontWeight: 900,
        }}>
          ✓
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)', lineHeight: 1.55 }}>
          <b style={{ color: 'var(--ink)', fontWeight: 700 }}>Everything is saved.</b>{' '}
          LaunchMind can now generate a personalized first growth direction using public evidence and the context you confirmed.
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => router.push('/dashboard/brief')}
          style={{
            height: 44, padding: '0 18px', borderRadius: 10,
            border: '1px solid var(--border)', background: '#fff',
            color: 'var(--ink)', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Save and exit
        </button>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            flex: 1, height: 44, borderRadius: 10, border: 'none',
            background: generating ? 'var(--raised)' : 'var(--sage)',
            color: generating ? 'var(--ink3)' : '#fff',
            fontSize: 14, fontWeight: 600,
            cursor: generating ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {generating ? 'Starting generation…' : 'Generate my first direction →'}
        </button>
      </div>
    </div>
  );
}
