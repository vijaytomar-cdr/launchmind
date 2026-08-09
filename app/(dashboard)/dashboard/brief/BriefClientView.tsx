/**
 * @file app/(dashboard)/dashboard/brief/BriefClientView.tsx
 * @description Morning Brief UI. Implements stale-while-revalidate using sessionStorage:
 *   - First visit: fetches /owner/brief, shows spinner, caches result.
 *   - Subsequent visits (< 5 min): renders from cache instantly, refreshes silently in background.
 *   - After 5 min: shows spinner once, caches fresh result.
 * @dependencies api.owner.brief, api.owner.ask
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type BriefResponse, type AskResponse } from '@/lib/api';
import { trackIntelligence } from '@/lib/analytics';

const API_URL      = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CACHE_KEY    = 'lm_brief_data';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — show cached, revalidate silently after

function readCache(): BriefResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw) as { ts: number; payload: BriefResponse };
    if (Date.now() - ts < CACHE_TTL_MS) return payload;
    return null;
  } catch { return null; }
}

function writeCache(data: BriefResponse) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload: data })); } catch {}
}

// States where onboarding is incomplete
const INCOMPLETE_STATES = new Set([
  'BELIEF_REVIEW', 'ALIGNMENT_AUDIENCE', 'ALIGNMENT_CONTEXT', 'ALIGNMENT_GOAL',
  'ALIGNMENT_COMPETITORS', 'BOUNDARIES_SETUP', 'FINAL_REVIEW',
  'DIRECTION_GENERATING', 'DIRECTION_COMPLETE',
]);
const STATE_LABELS: Record<string, { step: string; confidence: number }> = {
  BELIEF_REVIEW:        { step: 'Confirm and align',     confidence: 64 },
  ALIGNMENT_AUDIENCE:   { step: 'Define your audience',  confidence: 68 },
  ALIGNMENT_CONTEXT:    { step: "What's changing",       confidence: 72 },
  ALIGNMENT_GOAL:       { step: 'Define success metric', confidence: 76 },
  ALIGNMENT_COMPETITORS:{ step: 'Confirm competitors',   confidence: 80 },
  BOUNDARIES_SETUP:     { step: 'Set boundaries',        confidence: 84 },
  FINAL_REVIEW:         { step: 'Final review',          confidence: 88 },
  DIRECTION_GENERATING: { step: 'Generating direction',  confidence: 92 },
  DIRECTION_COMPLETE:   { step: 'Review your direction', confidence: 96 },
};

import {
  IconAlertCircle,
  IconCheck,
  IconArrowRight,
  IconBolt,
  IconSearch,
} from '@tabler/icons-react';
import { AIBadge }         from '@/components/launchmind/AIBadge';
import { ConfidenceBadge } from '@/components/launchmind/ConfidenceBadge';
import { EvidenceChips }   from '@/components/launchmind/EvidenceChips';
import { WhyThisPanel }    from '@/components/launchmind/WhyThisPanel';
import { MetricCard }      from '@/components/launchmind/MetricCard';
import { toStringArray }   from '@/lib/coerce';

// ── Recommendation card ───────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: BriefResponse['recommendation'] }) {
  if (!rec) return null;
  return (
    <div style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--sage3)', borderRadius: 14, padding: '16px 16px 16px 20px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,var(--sage),var(--sage-l))' }} />
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--violet2)', color: 'var(--violet)', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>✦</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, lineHeight: 1.25, color: 'var(--ink)', margin: 0 }}>{rec.title}</h2>
              <AIBadge />
            </div>
            <p className="text-[13px] text-ink2 leading-relaxed">{rec.summary}</p>
          </div>
        </div>
        <ConfidenceBadge value={rec.confidence} />
      </div>
      <div className="mb-3">
        <WhyThisPanel signal={rec.whyNow} evidence={rec.evidence} confidence={rec.confidence} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link
          href={rec.missionType ? `/dashboard/missions?create=${rec.missionType}` : '/dashboard/missions'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
        >
          {rec.action} <IconArrowRight size={12} />
        </Link>
        <button onClick={() => {}} style={{ fontSize: 11, color: 'var(--ai)', background: 'var(--ai-d)', border: '1px solid var(--ai-b)', borderRadius: 'var(--r2)', padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>
          Show reasoning
        </button>
        <button onClick={() => {}} style={{ fontSize: 11, color: 'var(--ink3)', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--r2)', padding: '5px 10px', cursor: 'pointer' }}>
          Adjust recommendation
        </button>
      </div>
    </div>
  );
}

// ── Opportunity card ──────────────────────────────────────────────────────────

function tierLabel(idx: number) { return ['High impact', 'Quick win', 'Market signal', 'Retention'][idx % 4]; }
function tierColor(idx: number) {
  return [
    { bg: 'var(--danger-d)', border: 'var(--danger-b)', color: 'var(--danger)' },
    { bg: 'var(--sage-d)',   border: 'var(--sage-b)',   color: 'var(--sage)'   },
    { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)' },
    { bg: 'var(--amber-d)',  border: 'var(--amber-b)',  color: 'var(--amber)'  },
  ][idx % 4];
}

function OpportunityCard({ opp, idx }: { opp: BriefResponse['opportunities'][0]; idx: number }) {
  const conf = opp.confidence ? Math.round(opp.confidence * 100) : null;
  const tc = tierColor(idx);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 99, letterSpacing: '.06em', background: tc.bg, border: `1px solid ${tc.border}`, color: tc.color, display: 'inline-block', marginBottom: 4 }}>
            {tierLabel(idx).toUpperCase()}
          </span>
          <p className="text-[13px] font-medium text-ink leading-snug">{opp.title}</p>
          {opp.expected_impact && <p className="text-[12px] text-sage font-medium mt-0.5">{opp.expected_impact}</p>}
          {opp.why_now         && <p className="text-[12px] text-ink2 mt-1">{opp.why_now}</p>}
        </div>
        {conf !== null && <ConfidenceBadge value={conf} />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Link href={`/dashboard/opportunities?id=${opp.id}`} className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1">
          Create mission <IconArrowRight size={11} />
        </Link>
        <span className="text-ink3 text-[12px]">·</span>
        <span className="text-[12px] text-ink3 capitalize">{opp.effort} effort · {opp.risk} risk</span>
      </div>
    </div>
  );
}

// ── Timeline event ────────────────────────────────────────────────────────────

function TimelineItem({ event }: { event: BriefResponse['recentTimeline'][0] }) {
  const isError = event.level === 'warn' || event.level === 'error' || event.type.includes('failed');
  const content = (
    <div className="flex items-start gap-2.5 py-2">
      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${isError ? 'bg-[var(--danger-d)] border-[var(--danger-b)]' : 'bg-[var(--sage-d)] border-[var(--sage-b)]'}`}>
        {isError ? <IconAlertCircle size={11} color="var(--danger)" /> : <IconCheck size={11} color="var(--sage)" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-ink leading-snug">{event.title}</p>
        <p className="text-[11px] text-ink3 mt-0.5">{new Date(event.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
      </div>
    </div>
  );
  return event.link
    ? <Link href={event.link} className="block hover:bg-raised rounded-[var(--r2)] px-1 -mx-1 transition-colors">{content}</Link>
    : <div className="px-1">{content}</div>;
}

// ── Ask box ───────────────────────────────────────────────────────────────────

const STARTER_PROMPTS = ['What should I prioritize this week?', 'Why did CPI increase?', 'Build an India validation plan'];

function AskBox({ token }: { token: string }) {
  const [question, setQuestion] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [answer,   setAnswer]   = useState<AskResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true); setError(null); setAnswer(null);
    try { setAnswer((await api.owner.ask(q, token)).answer); }
    catch { setError('Unable to answer right now. Try again.'); }
    finally { setLoading(false); }
  }, [token, loading]);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <IconSearch size={15} color="var(--sage)" />
        <p className="text-[13px] font-medium text-ink">Ask LaunchMind</p>
      </div>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void ask(question); }}
          placeholder="What should I run for Diwali?"
          className="flex-1 bg-raised border border-[var(--border2)] rounded-[var(--r2)] px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus:border-[var(--sage-b)] focus:ring-2 focus:ring-[var(--sage-d)]"
        />
        <button onClick={() => void ask(question)} disabled={!question.trim() || loading}
          className="px-3 py-2 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors">
          {loading ? '…' : 'Ask'}
        </button>
      </div>
      {!answer && !loading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {STARTER_PROMPTS.map(p => (
            <button key={p} onClick={() => { setQuestion(p); void ask(p); }}
              className="text-[11px] px-2 py-1 rounded-[var(--r3)] bg-raised border border-[var(--border2)] text-ink2 hover:border-[var(--sage-b)] hover:text-sage transition-colors">{p}</button>
          ))}
        </div>
      )}
      {loading && <div className="mt-3 flex items-center gap-2 text-[13px] text-sage"><span className="w-2 h-2 rounded-full bg-sage animate-pulse" />Thinking…</div>}
      {error   && <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p>}
      {answer  && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[13px] text-ink leading-relaxed">{answer.summary}</p>
          <p className="mt-1.5 text-[13px] font-medium text-sage">{answer.recommendedAction}</p>
          {toStringArray(answer.evidence).length > 0 && <div className="mt-2"><EvidenceChips chips={answer.evidence} /></div>}
          <div className="mt-2 flex items-center gap-3">
            <Link href="/dashboard/ask" className="text-[12px] text-ink2 hover:text-sage flex items-center gap-1">Full answer <IconArrowRight size={11} /></Link>
            {answer.suggestedMissionType && (
              <Link href={`/dashboard/missions?create=${answer.suggestedMissionType}`} className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1">
                <IconBolt size={11} /> Create mission
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Intelligence gap banner (conditional on connection state) ─────────────────

function IntelligenceGapBanner({ token }: { token: string }) {
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  // No default source name: until coverage loads, LaunchMind has not decided which
  // source matters most, and naming one would present a guess as a decision.
  const [recName, setRecName] = useState<string | null>(null);
  const [recAvailable, setRecAvailable] = useState(false);
  const [sourceNames, setSourceNames] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    api.intelligence.coverage(token)
      .then(cov => {
        const count = cov.connections.connectedCount ?? 0;
        setConnectedCount(count);
        if (cov.recommendedSource) {
          setRecName(cov.recommendedSource.name);
          setRecAvailable(cov.recommendedSource.available);
        }
        // The Morning Brief is genuinely showing source-derived content at this
        // point, which is what the event is meant to measure — not that the page
        // loaded.
        if (count > 0) {
          trackIntelligence('morning_brief_updated_from_source', {
            signalCount: count,
            insightCount: cov.liveInsights?.length ?? 0,
          });
        }

        // Collect names of connected sources for the "briefNewIntel" card
        if (count > 0) {
          const names: string[] = [];
          const c = cov.connections;
          if (c.app_store_connect?.connected)  names.push('App Store Connect');
          if (c.revenue_cat?.connected)        names.push('RevenueCat');
          if (c.google_analytics?.connected)   names.push('Google Analytics');
          if (c.google_ads?.connected)         names.push('Google Ads');
          if (c.meta_ads?.connected)           names.push('Meta Ads');
          setSourceNames(names);
        }
      })
      .catch(() => {/* show nothing on error */});
  }, [token]);

  // While loading: render nothing
  if (connectedCount === null) return null;

  // Connected state: show green "briefNewIntel" card
  if (connectedCount > 0) {
    const displayNames = sourceNames.length > 0
      ? sourceNames.slice(0, 3).join(', ') + (sourceNames.length > 3 ? ` +${sourceNames.length - 3} more` : '')
      : `${connectedCount} source${connectedCount > 1 ? 's' : ''}`;
    return (
      <div style={{ background: '#f4fbf8', border: '1px solid var(--sage3)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--sage)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <IconCheck size={16} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
            Growth Brain is now learning from live data
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>
            Connected: <strong style={{ color: 'var(--ink)' }}>{displayNames}</strong>. Recommendations now reflect observed performance, not estimates.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <Link href="/dashboard/intelligence/growth-brain" style={{ height: 34, padding: '0 13px', borderRadius: 10, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 12, fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            View in Growth Brain <IconArrowRight size={11} />
          </Link>
          <Link href="/dashboard/channels" style={{ height: 34, padding: '0 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Manage sources
          </Link>
        </div>
      </div>
    );
  }

  // Coverage loaded but no source is recommended yet — say nothing rather than
  // inventing a recommendation.
  if (!recName) return null;

  // No connections: show gap banner
  return (
    <div style={{ background: 'linear-gradient(135deg,#f4fbf8,#fff)', border: '1px solid var(--sage3)', borderRadius: 14, padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 22, alignItems: 'center', marginBottom: 16 }}>
      <div>
        <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--sage)', margin: '0 0 7px' }}>Improve today&apos;s recommendation</p>
        <h3 style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px', lineHeight: 1.3 }}>
          Your recommendations are still estimating {recName === 'App Store Connect' ? 'App Store conversion' : 'performance data'}.
        </h3>
        <p style={{ margin: 0, color: 'var(--ink2)', lineHeight: 1.55, fontSize: 12.5 }}>
          LaunchMind understands your product, market, and launch direction, but it cannot yet see actual impressions, downloads, or conversion.{' '}
          <strong>
            {recAvailable
              ? `${recName} is the single most useful next source for your current growth goal.`
              : `${recName} would close that gap, but it is not available to connect yet — LaunchMind will keep saying "estimated" rather than filling it in.`}
          </strong>
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {['Replace estimates with observed data','Learn performance daily','Strengthen evidence behind priorities','Read-only access'].map(b => (
            <span key={b} style={{ fontSize: 10.5, background: 'white', border: '1px solid var(--border)', padding: '5px 8px', borderRadius: 999, color: 'var(--ink2)' }}>{b}</span>
          ))}
        </div>
      </div>
      <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 20, display: 'grid', gap: 8 }}>
        <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: 'var(--ink3)', margin: 0, textTransform: 'uppercase' }}>Why this matters now</p>
        <p style={{ fontSize: 12, lineHeight: 1.45, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Today&apos;s recommendation depends on acquisition quality.</p>
        <Link href="/dashboard/channels" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, height: 38, padding: '0 14px', borderRadius: 10, background: 'var(--sage)', color: '#fff', fontSize: 12, fontWeight: 650, textDecoration: 'none' }}>
          Preview what {recName} unlocks <IconArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

// ── Since your last visit ─────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000), hours = Math.floor(diff / 3_600_000), days = Math.floor(diff / 86_400_000);
  if (mins < 2) return 'just now';
  if (hours < 1) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
const LAST_VISIT_KEY = 'lm_last_brief_visit';

function SinceCard({ data }: { data: BriefResponse }) {
  const [sinceLabel, setSinceLabel] = useState('');
  useEffect(() => {
    const prev = localStorage.getItem(LAST_VISIT_KEY);
    setSinceLabel(prev ? timeAgo(Number(prev)) : 'first visit');
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  }, []);
  const parts = [
    data.metrics.weeklyInstalls != null ? `${data.metrics.weeklyInstalls} install${data.metrics.weeklyInstalls !== 1 ? 's' : ''}` : 'no installs',
    data.pendingApprovals.total > 0 ? `${data.pendingApprovals.total} approval${data.pendingApprovals.total > 1 ? 's' : ''}` : 'no approvals',
    data.growthBrain.hasStrategy ? '1 market signal' : 'no market signals',
    (() => { const n = data.recentTimeline.filter(e => e.level === 'error' || e.type.includes('failed')).length; return n > 0 ? `${n} failed mission${n > 1 ? 's' : ''}` : 'no failed missions'; })(),
  ];
  return (
    <div style={{ marginLeft: 'auto', minWidth: 330, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
      <b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Since your last visit{sinceLabel ? ` · ${sinceLabel}` : ''}</b>
      <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{parts.join(' · ')}</span>
    </div>
  );
}

// ── Onboarding resume banner ──────────────────────────────────────────────────

function OnboardingResumeBanner({ token }: { token: string }) {
  const [state, setState] = useState<{ step: string; confidence: number } | null>(null);
  const [dismissed, setDismiss] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('ob_resume_dismissed')) { setDismiss(true); return; }
    fetch(`${API_URL}/onboarding/session`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const s = json?.data?.session?.current_state as string | undefined;
        if (s && INCOMPLETE_STATES.has(s)) setState(STATE_LABELS[s] ?? { step: 'Continue setup', confidence: 60 });
      })
      .catch(() => {});
  }, [token]);
  if (!state || dismissed) return null;
  const minutesLeft = Math.round((96 - state.confidence) / 10) + 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 14, marginBottom: 16, background: 'linear-gradient(135deg,#f7fffb,#f8f7ff)', border: '1px solid var(--sage3)', position: 'relative' }}>
      <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
        <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--raised)" strokeWidth="4" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--sage)" strokeWidth="4" strokeDasharray="113" strokeDashoffset={113 * (1 - state.confidence / 100)} strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{state.confidence}%</div>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Your Growth Brain is {state.confidence}% confident</p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink2)' }}>You paused at <strong>{state.step}</strong>. About {minutesLeft} more minutes gets it to 96%.</p>
      </div>
      <Link href="/onboarding" style={{ height: 34, borderRadius: 10, background: 'var(--sage)', color: '#fff', padding: '0 14px', fontWeight: 650, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', flexShrink: 0 }}>
        Continue setup <IconArrowRight size={13} />
      </Link>
      <button onClick={() => { sessionStorage.setItem('ob_resume_dismissed','1'); setDismiss(true); }} style={{ position: 'absolute', top: 8, right: 10, border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 18, lineHeight: 1, padding: 2 }} aria-label="Dismiss">×</button>
    </div>
  );
}

// ── Unavailable state ─────────────────────────────────────────────────────────

function RecommendationUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
      <p className="text-[14px] font-semibold text-ink">Today&apos;s recommendation isn&apos;t ready</p>
      <p className="text-[13px] text-ink2 mt-1">Your data below is up to date. LaunchMind couldn&apos;t generate a recommendation this time.</p>
      <button onClick={onRetry} className="mt-3 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors">Try again</button>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function BriefClientView() {
  const [data,    setData]    = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState('');
  const [recState, setRecState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const fetchedRef = useRef(false); // prevent double-fetch in StrictMode

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // 1. Show cached data immediately if fresh enough
    const cached = readCache();
    if (cached) {
      setData(cached);
      setLoading(false);
      setRecState(cached.recommendation ? 'ready' : 'failed');
    }

    // 2. Always fetch fresh data — silently if we already have cache, spinner if not
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      setToken(session.access_token);

      api.owner.brief(session.access_token)
        .then((fresh) => {
          writeCache(fresh);
          setData(fresh);
          setLoading(false);
          setRecState(fresh.recommendation ? 'ready' : 'failed');
        })
        .catch(() => {
          // If we already showed cached data, keep it — don't blank the screen
          if (!cached) { setLoading(false); setRecState('failed'); }
        });
    });
  }, []);

  const refetch = useCallback(() => {
    if (!token) return;
    setRecState('loading');
    api.owner.brief(token)
      .then(fresh => { writeCache(fresh); setData(fresh); setRecState(fresh.recommendation ? 'ready' : 'failed'); })
      .catch(() => setRecState('failed'));
  }, [token]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ height: 36, width: '38%', background: 'var(--border)', borderRadius: 8, marginBottom: 10 }} />
            <div style={{ height: 16, width: '55%', background: 'var(--border)', borderRadius: 6 }} />
          </div>
          <div style={{ width: 280, height: 54, background: 'var(--border)', borderRadius: 12, flexShrink: 0 }} />
        </div>

        {/* Capability banner */}
        <div style={{ height: 112, background: 'var(--border)', borderRadius: 14, marginBottom: 16 }} />

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ height: 72, background: 'var(--border)', borderRadius: 14 }} />
          ))}
        </div>

        {/* Main 2-col grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.75fr) minmax(300px,0.75fr)', gap: 16 }}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 20, width: '45%', background: 'var(--border)', borderRadius: 6 }} />
            <div style={{ height: 148, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ height: 110, background: 'var(--border)', borderRadius: 14 }} />
              <div style={{ height: 110, background: 'var(--border)', borderRadius: 14 }} />
            </div>
            <div style={{ height: 76, background: 'var(--border)', borderRadius: 14 }} />
          </div>
          {/* Right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 220, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ height: 108, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ height: 96, background: 'var(--border)', borderRadius: 14 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <RecommendationUnavailable onRetry={() => { setLoading(true); fetchedRef.current = false; }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Page head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'Syne,sans-serif', fontSize: 30, fontWeight: 700, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
            {greeting}{data.founder.name ? `, ${data.founder.name.split(' ')[0]}` : ''}.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink2)', marginTop: 8, lineHeight: 1.5 }}>
            {data.recommendation
              ? <>Your growth system reviewed <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{data.product?.name ?? 'your app'}</span> overnight. Here is what needs your attention today.</>
              : <>Here&apos;s where <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{data.product?.name ?? 'your app'}</span> stands today.</>}
          </p>
        </div>
        <SinceCard data={data} />
      </div>

      {token && <OnboardingResumeBanner token={token} />}

      {token && <IntelligenceGapBanner token={token} />}

      {data.product && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MetricCard label="Installs this week" value={data.metrics.weeklyInstalls != null ? data.metrics.weeklyInstalls.toLocaleString() : '—'}
            delta={data.metrics.weekOverWeekInstallDelta != null ? `${data.metrics.weekOverWeekInstallDelta >= 0 ? '+' : ''}${data.metrics.weekOverWeekInstallDelta.toFixed(1)}%` : undefined} />
          <MetricCard label="Cost per install" value={data.metrics.cpi != null ? `$${data.metrics.cpi.toFixed(2)}` : '—'} />
          <MetricCard label="Qualified requests" value={data.metrics.weeklyInstalls != null ? Math.round(data.metrics.weeklyInstalls * 0.31) : '—'} delta="~31% conversion" />
          <MetricCard label="Active campaigns" value={data.metrics.activeCampaigns} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.75fr)] gap-4">

        {/* ── Left column ── */}
        <div className="space-y-4">

          <section>
            {data.pendingApprovals.total > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 14, background: 'var(--amber2)', border: '1px solid #f2d29f', marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#7d4306', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconAlertCircle size={15} color="#7d4306" />
                  {data.pendingApprovals.total} decision{data.pendingApprovals.total > 1 ? 's' : ''} blocking execution. LaunchMind will not publish or spend without your approval.
                </span>
                <a href="/dashboard/approvals" style={{ fontSize: 11, fontWeight: 700, color: '#7d4306', textDecoration: 'none', whiteSpace: 'nowrap' }}>Review →</a>
              </div>
            )}
            <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Today&apos;s highest-impact move</p>
            {recState === 'loading' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }} className="animate-pulse">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-raised shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-raised rounded w-3/4" />
                    <div className="h-3 bg-raised rounded w-full" />
                    <div className="h-3 bg-raised rounded w-2/3" />
                  </div>
                </div>
              </div>
            )}
            {recState === 'failed'  && <RecommendationUnavailable onRetry={refetch} />}
            {recState === 'ready'   && data.recommendation && <RecommendationCard rec={data.recommendation} />}
          </section>

          {data.opportunities.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth opportunities</p>
                <Link href="/dashboard/opportunities" className="text-[12px] text-sage hover:underline flex items-center gap-1">View all <IconArrowRight size={11} /></Link>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
                {data.opportunities.map((opp, idx) => <OpportunityCard key={opp.id} opp={opp} idx={idx} />)}
              </div>
            </section>
          )}

          {token && <AskBox token={token} />}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth Brain</p>
              <span className={`text-[11px] px-2 py-0.5 rounded-[var(--r3)] border font-medium ${data.growthBrain.hasStrategy ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage' : 'bg-raised border-[var(--border2)] text-ink3'}`}>
                {data.growthBrain.hasStrategy ? 'Active' : 'Setup needed'}
              </span>
            </div>
            <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 12px' }}>
              <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="36" cy="36" r="30" fill="none" stroke="var(--raised)" strokeWidth="5" />
                <circle cx="36" cy="36" r="30" fill="none" stroke="var(--sage)" strokeWidth="5"
                  strokeDasharray="188.5" strokeDashoffset={188.5 * (1 - (data.growthBrain.confidence ?? 0) / 100)}
                  strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{data.growthBrain.confidence ?? '—'}%</div>
            </div>
            {[
              { label: 'Product context',     status: 'complete' },
              { label: 'Live campaign data',  status: data.growthBrain.hasStrategy ? 'connected' : 'pending' },
              { label: 'Provider operations', status: 'partial' },
              { label: 'Launch context',      status: 'update_due' },
            ].map(({ label, status }) => {
              const isOk = status === 'complete' || status === 'connected';
              const isWarn = status === 'partial' || status === 'update_due';
              return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: isOk ? 'var(--sage)' : isWarn ? 'var(--amber)' : 'var(--ink3)' }}>
                    {isOk ? '✓' : isWarn ? '⚠' : '·'}{' '}
                    {status === 'complete' ? 'Complete' : status === 'connected' ? 'Connected' : status === 'partial' ? 'Partial' : 'Update due'}
                  </span>
                </div>
              );
            })}
            <Link href="/dashboard/intelligence/growth-brain" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">View details <IconArrowRight size={11} /></Link>
          </div>

          {data.phase1?.direction && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--sage3)', borderRadius: 14, padding: 16 }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Your direction</p>
                <AIBadge />
              </div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.4, marginBottom: 8 }}>{data.phase1.direction.headline}</p>
              {data.phase1.primaryGoal && (
                <div style={{ fontSize: 11, color: 'var(--ink2)', marginBottom: 8 }}>
                  Goal: <span style={{ fontWeight: 700, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
                    {data.phase1.primaryGoal.target} {data.phase1.primaryGoal.unit}
                  </span>{' '}in {data.phase1.primaryGoal.horizonDays}d
                </div>
              )}
              {data.phase1.direction.primaryChannel && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 999, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', marginBottom: 8, fontWeight: 600 }}>
                  Week 1 focus: {data.phase1.direction.primaryChannel}
                </div>
              )}
              {data.phase1.audience && (
                <p style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  Audience: {data.phase1.audience.length > 80 ? data.phase1.audience.slice(0, 80) + '…' : data.phase1.audience}
                </p>
              )}
              <Link href="/dashboard/intelligence/growth-brain" className="mt-2 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">
                View full direction <IconArrowRight size={11} />
              </Link>
            </div>
          )}

          {data.memories && data.memories.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">What I learned</p>
                <AIBadge />
              </div>
              <div className="space-y-3">
                {data.memories.slice(0, 2).map(mem => (
                  <div key={mem.id} className="pl-3" style={{ borderLeft: '2px solid var(--ai-b)' }}>
                    <p className="text-[11px] font-medium text-ink3 uppercase tracking-wide capitalize">{mem.memoryType}</p>
                    <p className="text-[13px] text-ink leading-snug mt-0.5">{mem.body ?? mem.title}</p>
                    <div className="mt-1.5"><ConfidenceBadge value={Math.round(mem.confidence * 100)} /></div>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/intelligence/memory" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">View memory <IconArrowRight size={11} /></Link>
            </div>
          )}

          {data.pendingApprovals.total > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, margin: 0 }}>Awaiting your approval</p>
                <Link href="/dashboard/approvals" style={{ fontSize: 11, color: 'var(--sage)', textDecoration: 'none', fontWeight: 600 }}>All →</Link>
              </div>
              {data.pendingApprovals.items.slice(0, 3).map(item => (
                <div key={item.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2, lineHeight: 1.4 }}>{item.title}</p>
                  {item.preview && <p style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 6, lineHeight: 1.45 }}>{item.preview}</p>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Link href="/dashboard/approvals" style={{ fontSize: 11, fontWeight: 650, padding: '4px 10px', borderRadius: 'var(--r2)', background: 'var(--sage)', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>Approve</Link>
                    <Link href="/dashboard/approvals" style={{ fontSize: 11, color: 'var(--ink3)', padding: '4px 10px', borderRadius: 'var(--r2)', border: '1px solid var(--border2)', textDecoration: 'none' }}>Review</Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, margin: 0 }}>Production readiness</p>
              <Link href="/dashboard/launch-readiness" style={{ fontSize: 11, color: 'var(--sage)', textDecoration: 'none' }}>Details →</Link>
            </div>
            <div style={{ fontSize: 27, fontWeight: 780, letterSpacing: '-.8px', color: 'var(--ink)', fontFamily: 'DM Mono,monospace', marginBottom: 4 }}>72%</div>
            <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>7 controls still require action</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { dot: 'var(--danger)', label: 'Migrations 031–061 not verified in hosted DB', tag: 'Blocker' },
                { dot: 'var(--amber)',  label: 'pgBouncer and hot-path indexes pending',        tag: 'Scale'   },
                { dot: 'var(--amber)',  label: 'SSRF validation and webhook replay tests pending', tag: 'Security' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.dot, flexShrink: 0, marginTop: 3 }} />
                  <span style={{ color: 'var(--ink2)', flex: 1 }}>{item.label}</span>
                  <span style={{ color: 'var(--ink3)', fontWeight: 700, flexShrink: 0 }}>{item.tag}</span>
                </div>
              ))}
            </div>
          </div>

          {data.recentTimeline.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Recent activity</p>
                <Link href="/dashboard/intelligence/timeline" className="text-[12px] text-sage hover:underline flex items-center gap-1">All <IconArrowRight size={11} /></Link>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {data.recentTimeline.map(e => <TimelineItem key={e.id} event={e} />)}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
