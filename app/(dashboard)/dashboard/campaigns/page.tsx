/**
 * @file app/(dashboard)/dashboard/campaigns/page.tsx
 * @description Campaigns list — all campaigns for the founder across all products.
 *   Shows channel, market, status badges. Filters by status and channel.
 *   Links through to the product strategy page for each campaign.
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Campaign } from '@/lib/api';

const CHANNEL_ICON: Record<string, string> = {
  whatsapp: '💬', meta: '📘', google: '🔍', linkedin: '💼', email: '✉️',
};

const STATUS_STYLE: Record<Campaign['status'], React.CSSProperties> = {
  draft:            { background: 'var(--raised)', color: 'var(--ink2)', border: '1px solid var(--border2)' },
  pending_approval: { background: 'var(--amber-d)', color: 'var(--amber)', border: '1px solid var(--amber-b)' },
  approved:         { background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' },
  launched:         { background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' },
  paused:           { background: 'var(--amber-d)', color: 'var(--amber)', border: '1px solid var(--amber-b)' },
  completed:        { background: 'var(--raised)', color: 'var(--ink2)', border: '1px solid var(--border2)' },
};

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Pending',
  approved: 'Approved',
  launched: 'Live',
  paused: 'Paused',
  completed: 'Completed',
};

const ALL_STATUSES = ['all', 'draft', 'pending_approval', 'approved', 'launched', 'paused', 'completed'] as const;
type StatusFilter = (typeof ALL_STATUSES)[number];

export default function CampaignsPage() {
  const supabase = createClient();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [channelFilter, setChannelFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { campaigns: data } = await api.campaigns.list(session.access_token);
      setCampaigns(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const channels = ['all', ...Array.from(new Set(campaigns.map((c) => c.channel)))];
  const filtered = campaigns.filter((c) => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchChannel = channelFilter === 'all' || c.channel === channelFilter;
    return matchStatus && matchChannel;
  });

  const selectStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    color: 'var(--ink)',
    fontSize: 12,
    borderRadius: 6,
    padding: '5px 10px',
    outline: 'none',
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Campaigns
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            All campaign drafts and live campaigns across your products.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={selectStyle}>
            <option value="all">All statuses</option>
            {ALL_STATUSES.filter((s) => s !== 'all').map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s as Campaign['status']]}</option>
            ))}
          </select>
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} style={selectStyle}>
            {channels.map((ch) => (
              <option key={ch} value={ch}>{ch === 'all' ? 'All channels' : ch}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-[8px] px-4 py-3" style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', color: 'var(--red)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16" style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading campaigns…</div>
      ) : filtered.length === 0 ? (
        <EmptyState hasCampaigns={campaigns.length > 0} />
      ) : (
        <div className="rounded-[10px] overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {['Product', 'Channel', 'Market', 'Hook', 'Status', 'Created'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--ink3)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <CampaignRow key={c.id} campaign={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && campaigns.length > 0 && (
        <p className="mt-4" style={{ fontSize: 12, color: 'var(--ink3)' }}>
          {filtered.length} of {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

function CampaignRow({ campaign: c }: { campaign: Campaign }) {
  const tdStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 13,
    color: 'var(--ink)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  return (
    <tr style={{ transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--raised)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      <td style={tdStyle}>
        <Link
          href={`/dashboard/products/${c.product_id}/strategy`}
          className="font-medium hover:underline"
          style={{ color: 'var(--ink)' }}
        >
          {c.productName ?? c.product_id.slice(0, 8) + '…'}
        </Link>
      </td>
      <td style={tdStyle}>
        <span className="flex items-center gap-1.5">
          <span>{CHANNEL_ICON[c.channel] ?? '📡'}</span>
          <span style={{ color: 'var(--ink2)' }}>{c.channel}</span>
        </span>
      </td>
      <td style={tdStyle}>
        <span
          className="rounded-full px-2 py-0.5 font-medium"
          style={{
            fontSize: 11,
            background: c.market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
            color: c.market === 'india' ? 'var(--amber)' : 'var(--sage)',
          }}
        >
          {c.market.toUpperCase()}
        </span>
      </td>
      <td style={{ ...tdStyle, color: 'var(--ink3)', fontFamily: 'monospace', fontSize: 12 }}>
        {c.hook_type ?? '—'}
      </td>
      <td style={tdStyle}>
        <span className="rounded-full px-2 py-0.5 font-medium" style={{ fontSize: 11, ...STATUS_STYLE[c.status] }}>
          {STATUS_LABEL[c.status]}
        </span>
      </td>
      <td style={{ ...tdStyle, color: 'var(--ink3)', fontSize: 12 }}>
        {new Date(c.created_at).toLocaleDateString()}
      </td>
    </tr>
  );
}

function EmptyState({ hasCampaigns }: { hasCampaigns: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
        style={{ background: 'var(--raised)' }}
      >
        <svg style={{ width: 24, height: 24, color: 'var(--ink3)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      </div>
      <h3 className="font-semibold mb-2" style={{ fontSize: 15, color: 'var(--ink)' }}>
        {hasCampaigns ? 'No campaigns match your filters' : 'No campaigns yet'}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 340, marginBottom: 24 }}>
        {hasCampaigns
          ? 'Try clearing your filters to see all campaigns.'
          : 'Generate a strategy from a product to create campaign drafts automatically.'}
      </p>
      {!hasCampaigns && (
        <Link
          href="/dashboard/products"
          className="rounded-[6px] px-5 py-2.5 font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          Go to Products
        </Link>
      )}
    </div>
  );
}
