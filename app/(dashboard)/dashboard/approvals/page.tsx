/**
 * @file app/(dashboard)/dashboard/approvals/page.tsx
 * @description Unified Approvals page — campaign + mission approvals matching spec #approvals panel
 *   (ADR-038). Individual approval required for paid campaigns (meta/google). Never bulk-approve.
 *   Visual: risk-grid card layout with tag pills, details rows, inline reject-note flow.
 * @security JWT from Supabase session. Approval actions hit Fastify backend; never optimistic.
 * @dependencies api.missions.approvals, api.missions.respond, /campaigns?status=pending_approval
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type MissionApproval } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DetailRow {
  label: string;
  value: string;
}

interface ApprovalItem {
  id:          string;
  kind:        'campaign' | 'mission' | 'content';
  title:       string;
  /** Human-readable description of what will happen if approved. */
  description: string;
  /** Optional raw preview block (ad copy / mission preview_data JSON). */
  preview:     string | null;
  isPaid:      boolean;
  missionId:   string | null;
  stepId:      string | null;
  risk:        'high' | 'medium' | 'low';
  details:     DetailRow[];
}

type CampaignRow = {
  id:        string;
  channel:   string;
  market:    string;
  hook_type: string | null;
  copy_text: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TAG_BASE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  padding: '3px 8px',
  borderRadius: 9999,
  display: 'inline-flex',
  marginBottom: 12,
};

function tagProps(kind: ApprovalItem['kind']): { style: React.CSSProperties; label: string } {
  if (kind === 'campaign') {
    return {
      label: 'Campaign approval',
      style: {
        background: 'var(--amber-d)',
        border: '1px solid var(--amber-b)',
        color: 'var(--amber)',
      },
    };
  }
  if (kind === 'mission') {
    return {
      label: 'Mission approval',
      style: {
        background: 'var(--indigo-d)',
        border: '1px solid var(--indigo-b)',
        color: 'var(--indigo)',
      },
    };
  }
  // content
  return {
    label: 'Content approval',
    style: {
      background: 'var(--blue2)',
      border: '1px solid rgba(36,104,204,0.22)',
      color: 'var(--blue)',
    },
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// ApprovalCard — spec .card.risk layout
// ---------------------------------------------------------------------------

/**
 * Renders a single approval card matching spec `.card.risk` structure.
 * @param item    - The unified approval item (campaign or mission step).
 * @param token   - Supabase access token for API calls.
 * @param onDone  - Called after approve or reject succeeds; removes card from list.
 * @security      Paid campaigns (meta/google) require window.confirm before approval.
 *                Mission responses routed through api.missions.respond.
 */
function ApprovalCard({
  item,
  token,
  onDone,
}: {
  item: ApprovalItem;
  token: string;
  onDone: (id: string, result: 'approved' | 'rejected') => void;
}) {
  const [loading,        setLoading]        = useState(false);
  const [note,           setNote]           = useState('');
  const [rejectFlowOpen, setRejectFlowOpen] = useState(false);

  const respond = async (response: 'approved' | 'rejected') => {
    if (loading) return;
    if (item.isPaid && response === 'approved') {
      if (
        !window.confirm(
          `Approve this campaign? This will allow it to run and may incur ad spend.`,
        )
      )
        return;
    }
    setLoading(true);
    try {
      if (item.kind === 'mission' && item.missionId && item.stepId) {
        await api.missions.respond(
          item.missionId,
          item.stepId,
          response,
          note || undefined,
          token,
        );
      } else if (item.kind === 'campaign') {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/campaigns/${item.id}/approve`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ response }),
          },
        );
        if (!res.ok) throw new Error('Approval failed');
      }
      onDone(item.id, response);
    } catch {
      setLoading(false);
    }
  };

  const { style: pillStyle, label: pillLabel } = tagProps(item.kind);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 20,
      }}
    >
      {/* Tag pill */}
      <span style={{ ...TAG_BASE, ...pillStyle }}>{pillLabel}</span>

      {/* Title */}
      <h3
        style={{
          fontSize: 16,
          fontFamily: 'Syne, sans-serif',
          fontWeight: 600,
          color: 'var(--ink)',
          margin: '0 0 8px',
          letterSpacing: '-0.2px',
        }}
      >
        {item.title}
      </h3>

      {/* Description */}
      <p
        style={{
          fontSize: 13,
          color: 'var(--ink2)',
          lineHeight: 1.6,
          margin: '0 0 12px',
        }}
      >
        {item.description}
      </p>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

      {/* Detail rows */}
      {item.details.map(({ label, value }) => (
        <div key={label} style={{ display: 'flex', fontSize: 11, marginBottom: 6 }}>
          <span style={{ color: 'var(--ink3)', minWidth: 100 }}>{label}</span>
          <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
        </div>
      ))}

      {/* Optional preview block (mission preview_data) */}
      {item.preview && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            background: 'var(--raised)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--ink2)',
            lineHeight: 1.55,
            fontStyle: 'italic',
          }}
        >
          &ldquo;{item.preview}&rdquo;
        </div>
      )}

      {/* Inline reject-note input — shown when user clicks Reject */}
      {rejectFlowOpen && (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for rejection (optional)…"
          rows={2}
          style={{
            background: 'var(--raised)',
            border: '1px solid var(--border2)',
            borderRadius: 9,
            padding: '8px 10px',
            fontSize: 13,
            width: '100%',
            marginTop: 8,
            resize: 'vertical',
            color: 'var(--ink)',
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}

      {/* Action row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 16,
          flexWrap: 'wrap',
        }}
      >
        {rejectFlowOpen ? (
          <>
            <button
              onClick={() => {
                setRejectFlowOpen(false);
                setNote('');
              }}
              disabled={loading}
              style={{
                background: 'var(--raised)',
                color: 'var(--ink2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                height: 36,
                padding: '0 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void respond('rejected')}
              disabled={loading}
              style={{
                background: 'var(--danger-d)',
                color: 'var(--danger)',
                border: '1px solid var(--danger-b)',
                borderRadius: 10,
                height: 36,
                padding: '0 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setRejectFlowOpen(true)}
              disabled={loading}
              style={{
                background: 'var(--danger-d)',
                color: 'var(--danger)',
                border: '1px solid var(--danger-b)',
                borderRadius: 10,
                height: 36,
                padding: '0 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Reject
            </button>
            <button
              onClick={() => void respond('approved')}
              disabled={loading}
              style={{
                background: 'var(--sage)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                height: 36,
                padding: '0 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Approving…' : 'Approve'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * ApprovalsPage — unified approval queue for campaigns and mission steps.
 * @security Redirects to /login if no session. All approval mutations hit Fastify backend.
 */
export default function ApprovalsPage() {
  const [items,   setItems]   = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login';
        return;
      }
      const t = session.access_token;
      setToken(t);

      try {
        const [missionRes, campaignRes] = await Promise.all([
          api.missions.approvals(t),
          fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/campaigns?status=pending_approval`,
            { headers: { Authorization: `Bearer ${t}` } },
          ).then(r => r.json() as Promise<{ campaigns: CampaignRow[] }>),
        ]);

        const missionItems: ApprovalItem[] = (
          (missionRes.approvals ?? []) as MissionApproval[]
        ).map(a => ({
          id:          a.id,
          kind:        'mission' as const,
          title:       a.title,
          description:
            a.description ??
            'Review this mission step before LaunchMind continues.',
          preview:
            a.preview_data
              ? JSON.stringify(a.preview_data).slice(0, 100)
              : null,
          isPaid:      false,
          missionId:   a.mission_id,
          stepId:      a.step_id,
          risk:        'medium' as const,
          details: [
            { label: 'Type',   value: 'Mission step' },
            { label: 'Status', value: 'Awaiting approval' },
          ],
        }));

        const campaignItems: ApprovalItem[] = (
          (campaignRes.campaigns ?? []) as CampaignRow[]
        ).map(c => {
          const paid = c.channel === 'meta' || c.channel === 'google';
          return {
            id:    c.id,
            kind:  'campaign' as const,
            title: c.hook_type
              ? `${cap(c.channel)} — ${c.hook_type}`
              : `${cap(c.channel)} campaign`,
            description:
              c.copy_text
                ? c.copy_text.slice(0, 140)
                : `This ${cap(c.channel)} campaign targets the ${c.market.toUpperCase()} market. Approving will schedule it for launch.`,
            preview:   null,
            isPaid:    paid,
            missionId: null,
            stepId:    null,
            risk:      (paid ? 'high' : 'medium') as 'high' | 'medium',
            details: [
              { label: 'Channel',  value: cap(c.channel) },
              { label: 'Market',   value: c.market.toUpperCase() },
              { label: 'Approval', value: paid ? 'Individual required (paid)' : 'Standard' },
            ],
          };
        });

        // Sort: high risk first
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const all = [...campaignItems, ...missionItems].sort(
          (a, b) => order[a.risk] - order[b.risk],
        );

        setItems(all);
      } catch {
        // Non-blocking — show empty state on error
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const handleDone = (id: string) =>
    setItems(prev => prev.filter(i => i.id !== id));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page head */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 30,
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            color: 'var(--ink)',
            margin: '0 0 6px',
            letterSpacing: '-1px',
            lineHeight: 1.2,
          }}
        >
          Approvals
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0 }}>
          Everything that needs your decision before LaunchMind acts.
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--ink2)',
            fontSize: 13,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--sage)',
              display: 'inline-block',
            }}
          />
          Loading approvals…
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '48px 24px',
            textAlign: 'center',
            maxWidth: 480,
          }}
        >
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              margin: '0 0 6px',
            }}
          >
            No pending approvals.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0 }}>
            LaunchMind is waiting for your next mission.
          </p>
        </div>
      )}

      {/* Risk grid */}
      {!loading && items.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))',
            gap: 16,
          }}
        >
          {items.map(
            item =>
              token && (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  token={token}
                  onDone={handleDone}
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}
