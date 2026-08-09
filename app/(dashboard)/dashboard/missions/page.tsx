/**
 * @file app/(dashboard)/dashboard/missions/page.tsx
 * @description Mission Center — table view of all AI missions with approval banner,
 *   create modal, and auto-poll when running. Row click navigates to detail page.
 *   Columns: Mission | Status | Progress | Owner | Updated (matches spec).
 * @security Auth token from Supabase session. All data via Fastify backend (no direct DB).
 * @dependencies lib/api (missions namespace), lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Mission, MissionApproval } from '@/lib/api';
import {
  IconPlus, IconAlertTriangle, IconLoader2, IconRoute, IconPlayerPlay,
} from '@tabler/icons-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const MISSION_TYPE_LABELS: Record<string, string> = {
  research:     'Research',
  strategy:     'Strategy',
  planning:     'Planning',
  content:      'Content',
  creative:     'Creative',
  campaign:     'Campaign',
  publishing:   'Publishing',
  optimization: 'Optimization',
  learning:     'Learning',
  reporting:    'Reporting',
  memory:       'Memory',
  benchmark:    'Benchmark',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; border: string; color: string }> = {
  draft:            { label: 'Draft',          bg: 'var(--raised)',   border: 'var(--border2)', color: 'var(--ink3)'   },
  queued:           { label: 'Queued',         bg: 'var(--amber-d)',  border: 'var(--amber-b)', color: 'var(--amber)'  },
  running:          { label: 'Running',        bg: 'var(--sage-d)',   border: 'var(--sage-b)',  color: 'var(--sage)'   },
  waiting_approval: { label: 'Needs approval', bg: 'var(--amber-d)',  border: 'var(--amber-b)', color: 'var(--amber)'  },
  completed:        { label: 'Completed',      bg: 'var(--sage-d)',   border: 'var(--sage-b)',  color: 'var(--sage)'   },
  failed:           { label: 'Failed',         bg: 'var(--danger-d)', border: 'var(--danger-b)',color: 'var(--danger)' },
  cancelled:        { label: 'Cancelled',      bg: 'var(--raised)',   border: 'var(--border2)', color: 'var(--ink3)'   },
};

const MISSION_TYPES_LIST = [
  'research', 'strategy', 'planning', 'content', 'creative',
  'campaign', 'publishing', 'optimization', 'learning', 'reporting',
  'memory', 'benchmark',
] as const;

// Grid template: Mission(1fr) | Status(110px) | Progress(90px) | Owner(130px) | Updated(90px)
const COL_GRID = '1fr 110px 90px 130px 90px';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a UTC date string as a human-readable relative time (e.g. "42m ago").
 * @param dateStr - ISO date string
 * @returns Relative time label
 */
function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Returns a display-friendly owner label from a mission type.
 * @param type - MissionType string
 * @returns e.g. "Research agent"
 */
function ownerLabel(type: string): string {
  const label = MISSION_TYPE_LABELS[type] ?? type;
  return `${label} agent`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Pill-style status badge matching the design system badge palette. */
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

/**
 * Amber warning banner shown when any mission is pending founder approval.
 * @security Only shown for the authenticated founder's own missions.
 */
function ApprovalBanner({ approvals }: { approvals: MissionApproval[] }) {
  if (approvals.length === 0) return null;
  return (
    <div style={{
      background: 'var(--amber-d)', border: '1px solid var(--amber-b)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <IconAlertTriangle size={16} color="var(--amber)" />
      <span style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 500, flex: 1 }}>
        {approvals.length} mission{approvals.length > 1 ? 's' : ''} waiting for your approval
      </span>
      <Link href="/dashboard/approvals" style={{
        fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
        background: 'var(--amber)', color: '#fff', textDecoration: 'none',
      }}>
        Review
      </Link>
    </div>
  );
}

/** Sticky header row for the mission table. */
function TableHead() {
  const cols = ['Mission', 'Status', 'Progress', 'Owner', 'Updated'];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COL_GRID, gap: 12,
      padding: '10px 16px', alignItems: 'center',
      background: 'var(--raised)', borderBottom: '1px solid var(--border)',
    }}>
      {cols.map((col, i) => (
        <span key={i} style={{
          fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase',
          letterSpacing: '0.06em', fontWeight: 700,
        }}>
          {col}
        </span>
      ))}
    </div>
  );
}

type TableRowProps = {
  mission: Mission;
  onAction: () => void;
};

/** One mission row — click anywhere to navigate to the detail page. */
function MissionTableRow({ mission }: TableRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="row"
      onClick={() => router.push(`/dashboard/missions/${mission.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid', gridTemplateColumns: COL_GRID, gap: 12,
        padding: '12px 16px', alignItems: 'center',
        borderTop: '1px solid var(--border)',
        background: hovered ? 'var(--raised)' : 'transparent',
        cursor: 'pointer', transition: 'background 0.15s',
      }}
    >
      {/* Mission: title + type label */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {mission.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {MISSION_TYPE_LABELS[mission.type] ?? mission.type}
        </div>
      </div>

      {/* Status badge */}
      <div><StatusBadge status={mission.status} /></div>

      {/* Progress — steps not available in list response; show em-dash */}
      <div style={{
        fontSize: 12, color: 'var(--ink2)',
        fontFamily: 'var(--font-dm-mono, "DM Mono"), monospace',
      }}>
        —
      </div>

      {/* Owner: mission-type agent label */}
      <div style={{
        fontSize: 12, color: 'var(--ink3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {ownerLabel(mission.type)}
      </div>

      {/* Updated: relative timestamp */}
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {relativeTime(mission.updated_at)}
      </div>
    </div>
  );
}

// ── Create mission modal ──────────────────────────────────────────────────────

function CreateMissionModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [type,    setType]    = useState<typeof MISSION_TYPES_LIST[number]>('research');
  const [title,   setTitle]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true); setError(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('Session expired'); setLoading(false); return; }
    try {
      await api.missions.create({ type, title: title.trim() }, session.access_token);
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleCreate}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 14, padding: 24,
          width: '100%', maxWidth: 420,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{
          fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 16,
          fontFamily: 'var(--font-syne, Syne), sans-serif',
        }}>
          New mission
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>
          Mission type
        </label>
        <select
          value={type}
          onChange={e => setType(e.target.value as typeof MISSION_TYPES_LIST[number])}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 9, marginBottom: 14,
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit',
          }}
        >
          {MISSION_TYPES_LIST.map(t => (
            <option key={t} value={t}>{MISSION_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>
          Title
        </label>
        <input
          autoFocus
          placeholder="e.g. Q3 research sweep for India market"
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 9, marginBottom: 16,
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: 'var(--raised)', border: '1px solid var(--border2)',
              color: 'var(--ink2)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim()}
            style={{
              height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: 'var(--sage)', border: 'none', color: '#fff',
              cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Creating…' : 'Create & run'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Missions page — shows all AI missions in a data table.
 * Polls every 5 s when any mission is running or queued.
 */
export default function MissionsPage() {
  const [missions,   setMissions]   = useState<Mission[]>([]);
  const [approvals,  setApprovals]  = useState<MissionApproval[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    try {
      const [missRes, apprRes] = await Promise.all([
        api.missions.list(session.access_token),
        api.missions.approvals(session.access_token),
      ]);
      setMissions(missRes.missions ?? []);
      setTotal(missRes.total ?? 0);
      setApprovals(apprRes.approvals ?? []);
    } catch {
      // silent — stale data is preferred over an error flash on auto-poll
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  // Auto-poll every 5 s while any mission is active
  useEffect(() => {
    const hasActive = missions.some(m => m.status === 'running' || m.status === 'queued');
    if (!hasActive) return;
    pollRef.current = setInterval(() => load(false), 5_000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [missions, load]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Page head ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 22, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px', letterSpacing: -0.5, lineHeight: 1.2 }}>
            Missions
          </h1>
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13, lineHeight: 1.5 }}>
            Multi-step work executed by LaunchMind agents with deterministic guardrails and approval checkpoints.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: 'var(--sage)', border: '1px solid var(--sage)', color: '#fff', cursor: 'pointer',
          }}
        >
          <IconPlus size={14} />
          New mission
        </button>
      </div>

      {/* Approval banner ─────────────────────────────────────────────────────── */}
      <ApprovalBanner approvals={approvals} />

      {/* Table card ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <TableHead />

        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--ink3)', fontSize: 13, padding: '32px 16px',
          }}>
            <IconLoader2 size={16} color="var(--ink3)" />
            Loading missions…
          </div>
        ) : missions.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <IconRoute size={28} color="var(--ink3)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
              No missions yet
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: 300, margin: '0 auto 16px' }}>
              Create a mission and LaunchMind will plan and execute the steps automatically.
            </div>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                background: 'var(--sage)', border: 'none', color: '#fff', cursor: 'pointer',
              }}
            >
              <IconPlayerPlay size={12} />
              Create first mission
            </button>
          </div>
        ) : (
          <>
            {missions.map(m => (
              <MissionTableRow key={m.id} mission={m} onAction={() => load(false)} />
            ))}
            {total > missions.length && (
              <div style={{
                padding: '10px 16px', fontSize: 12, color: 'var(--ink3)',
                borderTop: '1px solid var(--border)', background: 'var(--raised)',
              }}>
                Showing {missions.length} of {total} missions
              </div>
            )}
          </>
        )}
      </div>

      {/* Create mission modal ────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateMissionModal
          onCreated={() => load(true)}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
