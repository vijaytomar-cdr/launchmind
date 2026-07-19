/**
 * @file app/(dashboard)/dashboard/ask/page.tsx
 * @description Ask LaunchMind — structured Q&A powered by Context Engine + Sonnet (ADR-035).
 *   Each question returns a structured answer. Not multi-turn (Milestone 09).
 * @security JWT from Supabase session. Rate-limited 10/hour server-side.
 * @dependencies api.owner.ask
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type AskResponse } from '@/lib/api';
import {
  IconSearch,
  IconBolt,
  IconArrowRight,
  IconAlertCircle,
} from '@tabler/icons-react';
import { AIBadge } from '@/components/launchmind/AIBadge';
import { ConfidenceBadge } from '@/components/launchmind/ConfidenceBadge';
import { EvidenceChips } from '@/components/launchmind/EvidenceChips';
import { WhyThisPanel } from '@/components/launchmind/WhyThisPanel';

const STARTER_PROMPTS = [
  'Get me 1,000 installs',
  'Launch in India',
  'Why did CPI increase?',
  'Create a Black Friday campaign',
  'Compare me to competitors',
  'How can I improve reviews?',
  'Reduce my ad spend',
  'What should I do this week?',
];


function AnswerCard({ question, answer }: { question: string; answer: AskResponse }) {
  return (
    <div className="bg-surface border-[1.5px] border-[var(--sage-b)] rounded-[var(--r)] p-5">
      <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-1">Your question</p>
      <p className="text-[14px] font-medium text-ink mb-4">{question}</p>

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <AIBadge />
            <ConfidenceBadge value={answer.confidence} />
          </div>
          <p className="text-[14px] text-ink leading-relaxed">{answer.summary}</p>
        </div>
      </div>

      <div className="bg-[var(--sage-d)] border border-[var(--sage-b)] rounded-[var(--r2)] px-4 py-3 mb-3">
        <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-1">Recommended action</p>
        <p className="text-[13px] font-medium text-ink">{answer.recommendedAction}</p>
      </div>

      {answer.expectedImpact && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Expected impact</span>
          <span className="text-[13px] text-sage font-medium">{answer.expectedImpact}</span>
        </div>
      )}

      {answer.nextStep && (
        <div className="bg-raised rounded-[var(--r2)] px-4 py-3 mb-3">
          <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-1">Next step</p>
          <p className="text-[13px] text-ink">{answer.nextStep}</p>
        </div>
      )}

      {answer.risks?.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-1.5">Risks</p>
          <div className="space-y-1">
            {answer.risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <IconAlertCircle size={13} color="var(--amber)" className="mt-0.5 shrink-0" />
                <p className="text-[13px] text-ink2">{r}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <WhyThisPanel
          evidence={answer.evidence}
          confidence={answer.confidence}
          risk={answer.risks?.[0]}
        />
      </div>

      {answer.suggestedMissionType && (
        <Link
          href={`/dashboard/missions?create=${answer.suggestedMissionType}&title=${encodeURIComponent(answer.suggestedMissionTitle ?? '')}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
        >
          <IconBolt size={13} />
          {answer.suggestedMissionTitle ? `Create: ${answer.suggestedMissionTitle}` : 'Create mission'}
          <IconArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

export default function AskPage() {
  const [question,     setQuestion]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [answer,       setAnswer]       = useState<AskResponse | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [error,        setError]        = useState<string | null>(null);
  const [token,        setToken]        = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      setToken(session.access_token);
    });
  }, []);

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || loading || !token) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setLastQuestion(q);
    try {
      const res = await api.owner.ask(q, token);
      setAnswer(res.answer);
      setQuestion('');
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        setError('You\'ve reached the 10 questions/hour limit. Try again shortly.');
      } else {
        setError('Unable to answer right now. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [token, loading]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Ask LaunchMind</h1>
        <p className="text-[13px] text-ink2 mt-1">Ask any growth question. Your AI CMO answers with evidence from your Growth Brain.</p>
      </div>

      {/* Input */}
      <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4 mb-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <IconSearch size={15} color="var(--ink3)" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void ask(question); }}
              placeholder="Get me 1,000 installs this month…"
              className="w-full pl-9 bg-raised border border-[var(--border2)] rounded-[var(--r2)] py-2.5 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus:border-[var(--sage-b)] focus:ring-2 focus:ring-[var(--sage-d)]"
            />
          </div>
          <button
            onClick={() => void ask(question)}
            disabled={!question.trim() || loading || !token}
            className="px-4 py-2 bg-sage text-white text-[13px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
          >
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>

        {/* Starter prompts */}
        {!answer && !loading && (
          <div className="mt-3">
            <p className="text-[11px] text-ink3 mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => { setQuestion(p); void ask(p); }}
                  className="text-[11px] px-2.5 py-1.5 rounded-[var(--r3)] bg-raised border border-[var(--border2)] text-ink2 hover:border-[var(--sage-b)] hover:text-sage transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-6 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-sage animate-pulse" />
          <div>
            <p className="text-[13px] font-medium text-ink">Thinking…</p>
            <p className="text-[12px] text-ink2 mt-0.5">Checking your Growth Brain, campaigns, and market signals</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-[var(--danger-d)] border border-[var(--danger-b)] rounded-[var(--r)] p-4 flex items-center gap-2">
          <IconAlertCircle size={16} color="var(--danger)" />
          <p className="text-[13px] text-[var(--danger)]">{error}</p>
        </div>
      )}

      {/* Answer */}
      {answer && <AnswerCard question={lastQuestion} answer={answer} />}

      {/* Attribution footer */}
      {answer && (
        <p className="mt-3 text-[11px] text-ink3 text-center">
          Based on your Growth Brain, marketing memory, and campaign history.{' '}
          <Link href="/dashboard/intelligence/ai-audit" className="text-sage hover:underline">View AI audit trail</Link>
        </p>
      )}
    </div>
  );
}
