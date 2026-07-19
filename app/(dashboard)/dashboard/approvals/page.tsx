/**
 * @file app/(dashboard)/dashboard/approvals/page.tsx
 * @description Unified Approvals — campaign + mission approvals in one place (ADR-038).
 *   Individual approval required for paid campaigns. Never bulk for meta/google.
 * @security JWT from Supabase session. Approval actions hit Fastify backend, never optimistic.
 * @dependencies api.missions.approvals, api.missions.respond, api.campaigns
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type MissionApproval } from '@/lib/api';
import {
  IconCheck,
  IconX,
  IconAlertCircle,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBolt,
  IconFileText,
} from '@tabler/icons-react';

// A unified approval item (either mission step or campaign)
interface ApprovalItem {
  id:        string;
  kind:      'mission' | 'campaign';
  title:     string;
  subtitle:  string;
  preview:   string | null;
  isPaid:    boolean;  // meta/google channels
  missionId: string | null;
  stepId:    string | null;
  risk:      'high' | 'medium' | 'low';
}

type CampaignRow = {
  id:        string;
  channel:   string;
  market:    string;
  hook_type: string | null;
  copy_text: string | null;
};

function RiskBadge({ risk }: { risk: ApprovalItem['risk'] }) {
  const cls = risk === 'high'
    ? 'bg-[var(--danger-d)] border-[var(--danger-b)] text-[var(--danger)]'
    : risk === 'medium'
    ? 'bg-[var(--amber-d)] border-[var(--amber-b)] text-[#92400e]'
    : 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage';
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-[4px] border font-medium capitalize ${cls}`}>
      {risk} risk
    </span>
  );
}

function ApprovalCard({
  item, token, onDone,
}: {
  item: ApprovalItem;
  token: string;
  onDone: (id: string, result: 'approved' | 'rejected') => void;
}) {
  const [loading, setLoading] = useState(false);
  const [note,    setNote]    = useState('');
  const [showNote, setShowNote] = useState(false);

  const respond = async (response: 'approved' | 'rejected') => {
    if (loading) return;
    if (item.isPaid && response === 'approved') {
      // Always require individual confirmation for paid campaigns
      if (!window.confirm(`Approve this ${item.subtitle}? This will allow it to run and may incur ad spend.`)) return;
    }
    setLoading(true);
    try {
      if (item.kind === 'mission' && item.missionId && item.stepId) {
        await api.missions.respond(item.missionId, item.stepId, response, note || undefined, token);
      } else if (item.kind === 'campaign') {
        // Campaign approval via dedicated campaign endpoint
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/campaigns/${item.id}/approve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ response }),
        });
        if (!res.ok) throw new Error('Approval failed');
      }
      onDone(item.id, response);
    } catch {
      setLoading(false);
    }
  };

  const ChannelIcon = item.subtitle.toLowerCase().includes('meta') || item.subtitle.toLowerCase().includes('facebook')
    ? IconBrandFacebook
    : item.subtitle.toLowerCase().includes('google')
    ? IconBrandGoogle
    : item.kind === 'mission'
    ? IconBolt
    : IconFileText;

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-[var(--r2)] bg-raised border border-[var(--border2)] flex items-center justify-center shrink-0">
          <ChannelIcon size={15} color="var(--ink2)" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] font-semibold text-ink leading-snug">{item.title}</p>
            <RiskBadge risk={item.risk} />
          </div>
          <p className="text-[12px] text-ink2 mt-0.5">{item.subtitle}</p>
        </div>
      </div>

      {item.preview && (
        <div className="mt-3 p-3 bg-raised rounded-[var(--r2)] border border-[var(--border2)]">
          <p className="text-[12px] text-ink leading-relaxed">&ldquo;{item.preview}&rdquo;</p>
        </div>
      )}

      {item.isPaid && (
        <div className="mt-2 flex items-center gap-1.5 p-2 bg-[var(--amber-d)] border border-[var(--amber-b)] rounded-[var(--r2)]">
          <IconAlertCircle size={13} color="var(--amber)" />
          <p className="text-[11px] text-[#92400e]">Paid campaign — individual approval required. Cannot be bulk-approved.</p>
        </div>
      )}

      {showNote && (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note (optional)…"
          className="mt-2 w-full bg-raised border border-[var(--border2)] rounded-[var(--r2)] px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus:border-[var(--sage-b)] resize-none h-16"
        />
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void respond('approved')}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
        >
          <IconCheck size={13} /> Approve
        </button>
        <button
          onClick={() => void respond('rejected')}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-[var(--danger-b)] text-[var(--danger)] text-[12px] font-medium rounded-[var(--r2)] hover:bg-[var(--danger-d)] disabled:opacity-40 transition-colors"
        >
          <IconX size={13} /> Reject
        </button>
        <button
          onClick={() => setShowNote(v => !v)}
          className="text-[12px] text-ink2 hover:text-ink ml-auto"
        >
          {showNote ? 'Hide note' : '+ Note'}
        </button>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const [items,   setItems]   = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);

      try {
        const [missionRes, campaignRes] = await Promise.all([
          api.missions.approvals(t),
          fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/campaigns?status=pending_approval`, {
            headers: { Authorization: `Bearer ${t}` },
          }).then(r => r.json() as Promise<{ campaigns: CampaignRow[] }>),
        ]);

        const missionItems: ApprovalItem[] = (missionRes.approvals ?? []).map((a: MissionApproval) => ({
          id:        a.id,
          kind:      'mission',
          title:     a.title,
          subtitle:  `Mission step · ${a.description?.slice(0, 60) ?? 'Review required'}`,
          preview:   a.preview_data ? JSON.stringify(a.preview_data).slice(0, 100) : null,
          isPaid:    false,
          missionId: a.mission_id,
          stepId:    a.step_id,
          risk:      'medium',
        }));

        const campaignItems: ApprovalItem[] = ((campaignRes.campaigns ?? []) as CampaignRow[]).map(c => ({
          id:        c.id,
          kind:      'campaign',
          title:     c.hook_type ? `${c.channel} — ${c.hook_type}` : `${c.channel} campaign`,
          subtitle:  `${c.channel.charAt(0).toUpperCase() + c.channel.slice(1)} · ${c.market.toUpperCase()}`,
          preview:   (c.copy_text as string | null)?.slice(0, 120) ?? null,
          isPaid:    c.channel === 'meta' || c.channel === 'google',
          missionId: null,
          stepId:    null,
          risk:      (c.channel === 'meta' || c.channel === 'google') ? 'high' : 'medium',
        }));

        // Sort: high risk first
        const all = [...campaignItems, ...missionItems].sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.risk] - order[b.risk];
        });

        setItems(all);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    });
  }, []);

  const handleDone = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  const paid     = items.filter(i => i.isPaid);
  const nonPaid  = items.filter(i => !i.isPaid);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Approvals</h1>
        <p className="text-[13px] text-ink2 mt-1">
          {items.length === 0 ? 'All caught up — nothing awaiting approval.' : `${items.length} item${items.length > 1 ? 's' : ''} need your review`}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink2 text-[13px]">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading approvals…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-[var(--sage-d)] border border-[var(--sage-b)] flex items-center justify-center mx-auto mb-3">
            <IconCheck size={20} color="var(--sage)" />
          </div>
          <p className="text-[14px] font-medium text-ink">All clear</p>
          <p className="text-[13px] text-ink2 mt-1">Nothing waiting for approval right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {paid.length > 0 && (
            <section>
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">
                Paid campaigns — individual approval required
              </p>
              <div className="space-y-3">
                {paid.map(item => token && (
                  <ApprovalCard key={item.id} item={item} token={token} onDone={handleDone} />
                ))}
              </div>
            </section>
          )}
          {nonPaid.length > 0 && (
            <section>
              {paid.length > 0 && <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Other approvals</p>}
              <div className="space-y-3">
                {nonPaid.map(item => token && (
                  <ApprovalCard key={item.id} item={item} token={token} onDone={handleDone} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
