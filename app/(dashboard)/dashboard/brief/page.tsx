/**
 * @file app/(dashboard)/dashboard/brief/page.tsx
 * @description Morning Brief — AI CMO daily digest. Primary entry point per ADR-034.
 *   AI recommendation + pending approvals + top 3 opportunities + recent timeline + Ask box.
 * @security JWT from Supabase session. All data filtered server-side by founder_id.
 * @dependencies api.owner.brief, api.owner.ask
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type BriefResponse, type AskResponse } from '@/lib/api';
import {
  IconSparkles,
  IconAlertCircle,
  IconCheck,
  IconArrowRight,
  IconBolt,
  IconSearch,
} from '@tabler/icons-react';
import { AIBadge } from '@/components/launchmind/AIBadge';
import { ConfidenceBadge } from '@/components/launchmind/ConfidenceBadge';
import { EvidenceChips } from '@/components/launchmind/EvidenceChips';
import { WhyThisPanel } from '@/components/launchmind/WhyThisPanel';
import { MetricCard } from '@/components/launchmind/MetricCard';
import { toStringArray } from '@/lib/coerce';

// ── Approval banner ───────────────────────────────────────────────────────────

function ApprovalBanner({ total }: { total: number }) {
  if (total === 0) return null;
  return (
    <Link href="/dashboard/approvals"
      className="flex items-center justify-between p-3 rounded-[var(--r)] bg-[var(--amber-d)] border border-[var(--amber-b)] hover:bg-[rgba(217,119,6,0.16)] transition-colors"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[#92400e]">
        <IconAlertCircle size={16} />
        {total} approval{total > 1 ? 's' : ''} waiting — campaigns cannot launch until approved
      </span>
      <span className="text-[11px] text-[#92400e] font-medium flex items-center gap-1">Review <IconArrowRight size={13} /></span>
    </Link>
  );
}

// ── Recommendation card ───────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: BriefResponse['recommendation'] }) {
  if (!rec) return null;
  return (
    <div className="bg-surface border-[1.5px] border-[var(--sage-b)] rounded-[var(--r)] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-[var(--sage-d)] border border-[var(--sage-b)] flex items-center justify-center shrink-0 mt-0.5">
            <IconSparkles size={14} color="var(--sage)" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-ink leading-snug">{rec.title}</p>
              <AIBadge />
            </div>
            <p className="text-[13px] text-ink2 leading-relaxed">{rec.summary}</p>
          </div>
        </div>
        <ConfidenceBadge value={rec.confidence} />
      </div>

      <div className="mb-3">
        <WhyThisPanel
          signal={rec.whyNow}
          evidence={rec.evidence}
          confidence={rec.confidence}
        />
      </div>

      <Link
        href={rec.missionType ? `/dashboard/missions?create=${rec.missionType}` : '/dashboard/missions'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
      >
        {rec.action} <IconArrowRight size={12} />
      </Link>
    </div>
  );
}

// ── Opportunity card ──────────────────────────────────────────────────────────

function OpportunityCard({ opp }: { opp: BriefResponse['opportunities'][0] }) {
  const conf = opp.confidence ? Math.round(opp.confidence * 100) : null;
  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink leading-snug">{opp.title}</p>
          {opp.expected_impact && (
            <p className="text-[12px] text-sage font-medium mt-0.5">{opp.expected_impact}</p>
          )}
          {opp.why_now && (
            <p className="text-[12px] text-ink2 mt-1">{opp.why_now}</p>
          )}
        </div>
        {conf !== null && <ConfidenceBadge value={conf} />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Link
          href={`/dashboard/opportunities?id=${opp.id}`}
          className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1"
        >
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
      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
        isError
          ? 'bg-[var(--danger-d)] border-[var(--danger-b)]'
          : 'bg-[var(--sage-d)] border-[var(--sage-b)]'
      }`}>
        {isError
          ? <IconAlertCircle size={11} color="var(--danger)" />
          : <IconCheck size={11} color="var(--sage)" />
        }
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

const STARTER_PROMPTS = [
  'Get me 1,000 installs',
  'Launch in India',
  'Why did CPI increase?',
  'What should I do this week?',
];

function AskBox({ token }: { token: string }) {
  const [question, setQuestion] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [answer,   setAnswer]   = useState<AskResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await api.owner.ask(q, token);
      setAnswer(res.answer);
    } catch {
      setError('Unable to answer right now. Try again.');
    } finally {
      setLoading(false);
    }
  }, [token, loading]);

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
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
        <button
          onClick={() => void ask(question)}
          disabled={!question.trim() || loading}
          className="px-3 py-2 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {!answer && !loading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {STARTER_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => { setQuestion(p); void ask(p); }}
              className="text-[11px] px-2 py-1 rounded-[var(--r3)] bg-raised border border-[var(--border2)] text-ink2 hover:border-[var(--sage-b)] hover:text-sage transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-sage">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Thinking…
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p>}

      {answer && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[13px] text-ink leading-relaxed">{answer.summary}</p>
          <p className="mt-1.5 text-[13px] font-medium text-sage">{answer.recommendedAction}</p>
          {toStringArray(answer.evidence).length > 0 && (
            <div className="mt-2">
              <EvidenceChips chips={answer.evidence} />
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Link href="/dashboard/ask" className="text-[12px] text-ink2 hover:text-sage flex items-center gap-1">
              Full answer <IconArrowRight size={11} />
            </Link>
            {answer.suggestedMissionType && (
              <Link href={`/dashboard/missions?create=${answer.suggestedMissionType}`}
                className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1"
              >
                <IconBolt size={11} /> Create mission
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Since-then context strip ──────────────────────────────────────────────────

function SinceThenStrip({ data }: { data: BriefResponse }) {
  const bannerVisible = data.pendingApprovals.total > 0;
  const bullets: string[] = [];

  if (data.pendingApprovals.total > 0) {
    bullets.push(
      `${data.pendingApprovals.total} item${data.pendingApprovals.total > 1 ? 's' : ''} waiting for your approval`,
    );
  }

  if (data.growthBrain.hasStrategy && data.growthBrain.lastUpdated) {
    const daysSince =
      (Date.now() - new Date(data.growthBrain.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) bullets.push('Your Growth Brain updated');
  }

  for (const event of data.recentTimeline.slice(0, 2)) {
    bullets.push(event.title);
  }

  if (bullets.length === 0) return null;
  // Approval count is already shown in the amber banner — hide strip if that's the only thing it would say
  if (bullets.length === 1 && bannerVisible) return null;

  return (
    <div className="mb-4">
      <p className="text-[11px] text-ink3 font-medium uppercase tracking-wide mb-1.5">Since then…</p>
      <div className="space-y-1">
        {bullets.map((bullet, i) => (
          <div key={i} className="flex items-center gap-2">
            <IconCheck size={12} color="var(--sage)" />
            <span className="text-[12px] text-ink2">{bullet}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Skeleton / unavailable states ─────────────────────────────────────────────

function RecommendationSkeleton() {
  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4 animate-pulse">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-raised shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-raised rounded w-3/4" />
          <div className="h-3 bg-raised rounded w-full" />
          <div className="h-3 bg-raised rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

function RecommendationUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-5">
      <p className="text-[14px] font-semibold text-ink">
        Today&apos;s recommendation isn&apos;t ready
      </p>
      <p className="text-[13px] text-ink2 mt-1">
        Your data below is up to date. LaunchMind couldn&apos;t generate a
        recommendation this time.
      </p>
      <button
        onClick={onRetry}
        className="mt-3 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const [data,     setData]     = useState<BriefResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [recState, setRecState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [token,    setToken]    = useState<string | null>(null);

  const loadBrief = useCallback((accessToken: string) => {
    let cancelled = false;

    api.owner.brief(accessToken)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
        setRecState(res.recommendation ? 'ready' : 'failed');
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoading(false);
        setRecState('failed');
      });

    // Hard ceiling — never spin forever
    const timer = setTimeout(() => {
      if (!cancelled) setRecState((s) => (s === 'loading' ? 'failed' : s));
    }, 8000);

    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cleanup: (() => void) | undefined;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      setToken(session.access_token);
      cleanup = loadBrief(session.access_token);
    });
    return () => cleanup?.();
  }, [loadBrief]);

  const refetchRecommendation = useCallback(() => {
    if (!token) return;
    setRecState('loading');
    loadBrief(token);
  }, [token, loadBrief]);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-2 text-ink2">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Assembling your morning brief…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <RecommendationUnavailable onRetry={() => { if (token) { setLoading(true); loadBrief(token); } }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>
          {greeting}{data.founder.name ? `, ${data.founder.name.split(' ')[0]}` : ''}.
        </h1>
        <p className="text-[15px] text-ink leading-relaxed mt-2">
          {data.recommendation
            ? <>I reviewed <span className="font-medium">{data.product?.name ?? 'your app'}</span> overnight. {data.recommendation.title}</>
            : <>Here&apos;s where <span className="font-medium">{data.product?.name ?? 'your app'}</span> stands today.</>
          }
        </p>
        {data.product && (
          <>
            <p className="text-[12px] text-ink3 mt-1.5">{data.product.name}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <MetricCard
                label="Installs this week"
                value={data.metrics.weeklyInstalls != null ? data.metrics.weeklyInstalls.toLocaleString() : '—'}
                delta={data.metrics.weekOverWeekInstallDelta != null
                  ? `${data.metrics.weekOverWeekInstallDelta >= 0 ? '+' : ''}${data.metrics.weekOverWeekInstallDelta.toFixed(1)}%`
                  : undefined}
              />
              <MetricCard
                label="Avg CPI"
                value={data.metrics.cpi != null ? `$${data.metrics.cpi.toFixed(2)}` : '—'}
              />
              <MetricCard
                label="Active campaigns"
                value={data.metrics.activeCampaigns}
              />
            </div>
          </>
        )}
      </div>

      {/* Since-then context strip */}
      <SinceThenStrip data={data} />

      {/* Approval banner */}
      <div className="mb-4">
        <ApprovalBanner total={data.pendingApprovals.total} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Primary recommendation */}
          <section>
            <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Today&apos;s recommendation</p>
            {recState === 'loading' && <RecommendationSkeleton />}
            {recState === 'failed'  && <RecommendationUnavailable onRetry={refetchRecommendation} />}
            {recState === 'ready'   && data.recommendation && (
              <RecommendationCard rec={data.recommendation} />
            )}
          </section>

          {/* Opportunities */}
          {data.opportunities.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth opportunities</p>
                <Link href="/dashboard/opportunities" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  View all <IconArrowRight size={11} />
                </Link>
              </div>
              <div className="space-y-2">
                {data.opportunities.map(opp => <OpportunityCard key={opp.id} opp={opp} />)}
              </div>
            </section>
          )}

          {/* Ask box */}
          {token && <AskBox token={token} />}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Growth Brain status */}
          <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth Brain</p>
              <span className={`text-[11px] px-2 py-0.5 rounded-[var(--r3)] border font-medium ${
                data.growthBrain.hasStrategy
                  ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
                  : 'bg-raised border-[var(--border2)] text-ink3'
              }`}>
                {data.growthBrain.hasStrategy ? 'Active' : 'Setup needed'}
              </span>
            </div>
            {data.growthBrain.hasStrategy && data.growthBrain.confidence !== null && (
              <p className="text-[13px] text-ink2">Strategy confidence: {data.growthBrain.confidence}%</p>
            )}
            <Link href="/dashboard/intelligence/growth-brain" className="mt-2 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">
              View details <IconArrowRight size={11} />
            </Link>
          </div>

          {/* What I learned — marketing memories */}
          {data.memories && data.memories.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">What I learned</p>
                <AIBadge />
              </div>
              <div className="space-y-3">
                {data.memories.slice(0, 2).map(mem => (
                  <div key={mem.id} className="pl-3" style={{ borderLeft: '2px solid var(--ai-b)' }}>
                    <p className="text-[11px] font-medium text-ink3 uppercase tracking-wide capitalize">{mem.memoryType}</p>
                    <p className="text-[13px] text-ink leading-snug mt-0.5">{mem.body ?? mem.title}</p>
                    <div className="mt-1.5">
                      <ConfidenceBadge value={Math.round(mem.confidence * 100)} />
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/intelligence/memory" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">
                View memory <IconArrowRight size={11} />
              </Link>
            </div>
          )}

          {/* Pending approvals detail */}
          {data.pendingApprovals.total > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Awaiting approval</p>
              <div className="space-y-2">
                {data.pendingApprovals.items.slice(0, 3).map(item => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] mt-1.5 shrink-0" />
                    <p className="text-[13px] text-ink leading-snug">{item.title}</p>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/approvals" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
                Review all <IconArrowRight size={11} />
              </Link>
            </div>
          )}

          {/* Recent timeline */}
          {data.recentTimeline.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Recent activity</p>
                <Link href="/dashboard/intelligence/timeline" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  All <IconArrowRight size={11} />
                </Link>
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
