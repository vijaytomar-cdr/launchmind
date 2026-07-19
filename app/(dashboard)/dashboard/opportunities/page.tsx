/**
 * @file app/(dashboard)/dashboard/opportunities/page.tsx
 * @description Growth Opportunities backlog — saved_opportunities per ADR-036.
 *   Founders can save, dismiss, or convert to mission.
 * @security JWT from Supabase session.
 * @dependencies api.owner.opportunities, api.owner.updateOpportunity, api.missions.create
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type Opportunity } from '@/lib/api';
import {
  IconBolt,
  IconBookmark,
  IconX,
  IconArrowRight,
  IconBulb,
  IconCheck,
} from '@tabler/icons-react';
import { AIBadge } from '@/components/launchmind/AIBadge';
import { ConfidenceBadge } from '@/components/launchmind/ConfidenceBadge';
import { EvidenceChips } from '@/components/launchmind/EvidenceChips';
import { WhyThisPanel } from '@/components/launchmind/WhyThisPanel';

type FilterState = 'active' | 'saved' | 'all';

const EFFORT_COLOR: Record<string, string> = {
  low:    'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage',
  medium: 'bg-[var(--amber-d)] border-[var(--amber-b)] text-[#92400e]',
  high:   'bg-[var(--danger-d)] border-[var(--danger-b)] text-[var(--danger)]',
};

const RISK_COLOR: Record<string, string> = {
  low:    'text-sage',
  medium: 'text-[#92400e]',
  high:   'text-[var(--danger)]',
};


function OppCard({
  opp, token, onUpdate,
}: {
  opp: Opportunity;
  token: string;
  onUpdate: (id: string, state: Opportunity['state']) => void;
}) {
  const [acting, setActing] = useState(false);
  const [saved,  setSaved]  = useState(opp.state === 'saved');

  const transition = async (newState: Opportunity['state']) => {
    setActing(true);
    try {
      await api.owner.updateOpportunity(opp.id, { state: newState }, token);
      onUpdate(opp.id, newState);
      if (newState === 'saved') setSaved(true);
    } catch { /* ignore */ } finally {
      setActing(false);
    }
  };

  const createMission = async () => {
    setActing(true);
    try {
      await api.missions.create({
        type:     opp.type === 'aso' ? 'strategy' : opp.type === 'india_launch' ? 'research' : 'campaign',
        title:    opp.title,
        productId: opp.product_id ?? undefined,
      }, token);
      await api.owner.updateOpportunity(opp.id, { state: 'converted' }, token);
      onUpdate(opp.id, 'converted');
    } catch { /* ignore */ } finally {
      setActing(false);
    }
  };

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] px-2 py-0.5 rounded-[var(--r3)] border font-medium capitalize ${EFFORT_COLOR[opp.effort] ?? 'bg-raised border-[var(--border2)] text-ink2'}`}>
              {opp.effort} effort
            </span>
            <span className={`text-[11px] font-medium capitalize ${RISK_COLOR[opp.risk] ?? 'text-ink3'}`}>
              {opp.risk} risk
            </span>
            <AIBadge />
          </div>
          <p className="text-[14px] font-semibold text-ink leading-snug">{opp.title}</p>
          {opp.expected_impact && (
            <p className="text-[12px] text-sage font-medium mt-0.5">{opp.expected_impact}</p>
          )}
          {opp.description && (
            <p className="text-[13px] text-ink2 mt-1 leading-relaxed">{opp.description}</p>
          )}
        </div>
        {opp.confidence !== null && (
          <ConfidenceBadge value={Math.round(opp.confidence * 100)} />
        )}
      </div>

      <WhyThisPanel
        signal={opp.why_now ?? undefined}
        evidence={opp.evidence}
        confidence={opp.confidence !== null ? Math.round(opp.confidence * 100) : undefined}
        risk={opp.risk}
      />

      <EvidenceChips chips={opp.evidence} max={3} />

      <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
        <button
          onClick={createMission}
          disabled={acting || opp.state === 'converted'}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
        >
          {opp.state === 'converted' ? <><IconCheck size={12} /> Converted</> : <><IconBolt size={12} /> Create mission</>}
        </button>
        {opp.state !== 'saved' && (
          <button
            onClick={() => transition('saved')}
            disabled={acting || saved}
            className="flex items-center gap-1 text-[12px] text-ink2 hover:text-ink transition-colors disabled:opacity-40"
          >
            <IconBookmark size={13} /> {saved ? 'Saved' : 'Save'}
          </button>
        )}
        {opp.state !== 'dismissed' && (
          <button
            onClick={() => transition('dismissed')}
            disabled={acting}
            className="flex items-center gap-1 text-[12px] text-ink3 hover:text-[var(--danger)] transition-colors ml-auto"
          >
            <IconX size={13} /> Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const [opps,    setOpps]    = useState<Opportunity[]>([]);
  const [filter,  setFilter]  = useState<FilterState>('active');
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      api.owner.opportunities(t, { state: 'active' })
        .then(res => { setOpps(res.opportunities); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const fetchFilter = async (f: FilterState) => {
    if (!token) return;
    setFilter(f);
    setLoading(true);
    try {
      const res = await api.owner.opportunities(token, { state: f === 'all' ? 'all' : f });
      setOpps(res.opportunities);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleUpdate = (id: string, newState: Opportunity['state']) => {
    if (filter === 'active' && newState !== 'active') {
      setOpps(prev => prev.filter(o => o.id !== id));
    } else if (filter === 'saved' && newState !== 'saved') {
      setOpps(prev => prev.filter(o => o.id !== id));
    } else {
      setOpps(prev => prev.map(o => o.id === id ? { ...o, state: newState } : o));
    }
  };

  const filters: { key: FilterState; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'saved',  label: 'Saved' },
    { key: 'all',    label: 'All' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Growth Opportunities</h1>
        <p className="text-[13px] text-ink2 mt-1">AI-identified actions ranked by impact, effort, and timing</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => void fetchFilter(f.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-[var(--r2)] transition-colors ${
              filter === f.key
                ? 'bg-[var(--sage-d)] border border-[var(--sage-b)] text-sage'
                : 'bg-raised border border-[var(--border2)] text-ink2 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink2 text-[13px]">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading opportunities…
        </div>
      ) : opps.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <IconBulb size={28} color="var(--sage)" className="mx-auto mb-3" />
          <p className="text-[14px] font-medium text-ink">No opportunities yet</p>
          <p className="text-[13px] text-ink2 mt-1">Complete your product setup to unlock AI-generated growth opportunities.</p>
          <a href="/products/new" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
            Add your app <IconArrowRight size={11} />
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {token && opps.map(opp => (
            <OppCard key={opp.id} opp={opp} token={token} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
