/**
 * @file app/(dashboard)/dashboard/intelligence/ideas/page.tsx
 * @description Ideas Inbox — AI-surfaced content ideas from Marketing Memory.
 *   Shows memories of type 'learning' and 'content_insight' as actionable idea cards.
 * @security JWT from Supabase session.
 * @dependencies api.memory.list, api.missions.create
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type MarketingMemory } from '@/lib/api';
import {
  IconBulb,
  IconBolt,
  IconArrowRight,
  IconBookmark,
} from '@tabler/icons-react';

function ConfidenceDot({ value }: { value: number }) {
  const cls = value >= 0.8 ? 'bg-sage' : value >= 0.6 ? 'bg-[var(--amber)]' : 'bg-[var(--ink3)]';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} title={`${Math.round(value * 100)}% confidence`} />;
}

function IdeaCard({ memory, token, onSave }: { memory: MarketingMemory; token: string; onSave: (id: string) => void }) {
  const [acting, setActing] = useState(false);

  const createMission = async () => {
    setActing(true);
    try {
      await api.missions.create({ type: 'content', title: memory.title }, token);
      onSave(memory.id);
    } catch { /* ignore */ } finally {
      setActing(false);
    }
  };

  // Memory content may have a 'description' or 'summary' field
  const summary = (memory.content?.description ?? memory.content?.summary) as string | undefined;

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
      <div className="flex items-start gap-2 mb-2">
        <ConfidenceDot value={memory.confidence ?? 0} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-ink leading-snug">{memory.title}</p>
          {summary && <p className="text-[13px] text-ink2 mt-1 leading-relaxed">{summary}</p>}
        </div>
      </div>

      {memory.evidence_ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-raised border border-[var(--border2)] text-ink2">
            {memory.evidence_ids.length} evidence source{memory.evidence_ids.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        <button
          onClick={() => void createMission()}
          disabled={acting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--sage-d)] border border-[var(--sage-b)] text-sage text-[12px] font-medium rounded-[var(--r2)] hover:bg-sage hover:text-white disabled:opacity-40 transition-colors"
        >
          <IconBolt size={12} /> Create content mission
        </button>
        <span className="text-[11px] text-ink3 capitalize ml-auto">{memory.memory_type?.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
}

export default function IdeasPage() {
  const [memories, setMemories] = useState<MarketingMemory[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [token,    setToken]    = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      // Fetch learning + content insight memories
      api.memory.list(t, { memory_type: 'learning_log' })
        .then(res => { setMemories(res.memories ?? []); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const handleSave = (id: string) => setMemories(prev => prev.filter(m => m.id !== id));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Ideas Inbox</h1>
        <p className="text-[13px] text-ink2 mt-1">AI-surfaced content ideas from your Marketing Memory</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink2 text-[13px]">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading ideas…
        </div>
      ) : memories.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <IconBulb size={28} color="var(--sage)" className="mx-auto mb-3" />
          <p className="text-[14px] font-medium text-ink">No ideas yet</p>
          <p className="text-[13px] text-ink2 mt-1">
            Run content missions and campaigns — LaunchMind will surface ideas here as it learns what works.
          </p>
          <a href="/dashboard/missions" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
            Start a mission <IconArrowRight size={11} />
          </a>
        </div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] text-ink2">{memories.length} idea{memories.length !== 1 ? 's' : ''} from your Marketing Memory</p>
            <a href="/dashboard/intelligence/memory" className="text-[12px] text-sage hover:underline flex items-center gap-1">
              Full memory <IconArrowRight size={11} />
            </a>
          </div>
          {token && memories.map(m => (
            <IdeaCard key={m.id} memory={m} token={token} onSave={handleSave} />
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 p-3 bg-raised border border-[var(--border2)] rounded-[var(--r2)] max-w-2xl">
        <IconBookmark size={14} color="var(--ink3)" />
        <p className="text-[12px] text-ink2">
          Ideas are generated from your campaign learnings and competitor analysis.{' '}
          <a href="/dashboard/intelligence/memory" className="text-sage hover:underline">View full memory</a>
        </p>
      </div>
    </div>
  );
}
