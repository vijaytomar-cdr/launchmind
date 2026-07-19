/**
 * @file app/(dashboard)/dashboard/missions/page.tsx
 * @description Mission Center — list, filter, create, and monitor AI missions.
 *   Shows pending approval banners. Lets founders create new missions.
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Mission, MissionApproval } from '@/lib/api';
import {
  IconTarget, IconPlus, IconRefresh, IconCircleCheck, IconCircleX,
  IconClock, IconLoader2, IconAlertTriangle, IconBan, IconPlayerPlay,
  IconChevronRight, IconRobot,
} from '@tabler/icons-react';

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

const STATUS_CONFIG: Record<string, { label: string; bg: string; border: string; color: string; Icon: React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }> }> = {
  draft:            { label: 'Draft',           bg: 'var(--raised)',   border: 'var(--border2)', color: 'var(--ink2)',  Icon: IconClock },
  queued:           { label: 'Queued',          bg: 'var(--indigo-d)', border: 'var(--indigo-b)',color: 'var(--indigo)',Icon: IconClock },
  running:          { label: 'Running',         bg: 'var(--sage-d)',   border: 'var(--sage-b)',  color: 'var(--sage)', Icon: IconLoader2 },
  waiting_approval: { label: 'Needs approval',  bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)', Icon: IconAlertTriangle },
  completed:        { label: 'Completed',       bg: 'var(--sage-d)',  border: 'var(--sage-b)',  color: 'var(--sage)', Icon: IconCircleCheck },
  failed:           { label: 'Failed',          bg: 'var(--danger-d)',   border: 'var(--danger-b)',   color: 'var(--danger)',  Icon: IconCircleX },
  cancelled:        { label: 'Cancelled',       bg: 'var(--raised)',  border: 'var(--border2)', color: 'var(--ink3)', Icon: IconBan },
};

const MISSION_TYPES_LIST = [
  'research', 'strategy', 'planning', 'content', 'creative',
  'campaign', 'publishing', 'optimization', 'learning', 'reporting',
  'memory', 'benchmark',
] as const;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const { Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
    }}>
      <Icon size={11} color={cfg.color} />
      {cfg.label}
    </span>
  );
}

function MissionRow({ mission, onRefresh }: { mission: Mission; onRefresh: () => void }) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      await api.missions.retry(mission.id, session.access_token);
      onRefresh();
    } finally {
      setRetrying(false);
    }
  }

  const elapsed = mission.started_at
    ? Math.round((Date.now() - new Date(mission.started_at).getTime()) / 1000)
    : null;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* Icon box */}
      <div style={{
        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
        background: 'var(--raised)', border: '1px solid var(--border2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <IconRobot size={18} color="var(--ink2)" />
      </div>

      {/* Title + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
          {mission.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', gap: 10 }}>
          <span style={{ textTransform: 'capitalize' }}>{MISSION_TYPE_LABELS[mission.type] ?? mission.type}</span>
          <span>·</span>
          <span>{new Date(mission.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          {elapsed !== null && mission.status === 'running' && (
            <>
              <span>·</span>
              <span>{elapsed}s elapsed</span>
            </>
          )}
          {mission.retry_count > 0 && (
            <>
              <span>·</span>
              <span>{mission.retry_count} retries</span>
            </>
          )}
        </div>
      </div>

      {/* Status */}
      <StatusBadge status={mission.status} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {mission.status === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            style={{
              fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 5,
              background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
              color: 'var(--sage)', cursor: retrying ? 'not-allowed' : 'pointer', opacity: retrying ? 0.5 : 1,
            }}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <Link href={`/dashboard/missions/${mission.id}`} style={{
          display: 'flex', alignItems: 'center', padding: '4px 6px',
          borderRadius: 5, color: 'var(--ink3)',
        }}>
          <IconChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function ApprovalBanner({ approvals, onRefresh }: { approvals: MissionApproval[]; onRefresh: () => void }) {
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
      <Link href="#approvals" style={{
        fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 5,
        background: 'var(--amber)', color: '#fff', textDecoration: 'none',
      }}>
        Review
      </Link>
    </div>
  );
}

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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <form
        onSubmit={handleCreate}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 12, padding: 24,
          width: '100%', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
          New mission
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink2)', marginBottom: 6 }}>
          Mission type
        </label>
        <select
          value={type}
          onChange={e => setType(e.target.value as typeof MISSION_TYPES_LIST[number])}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6, marginBottom: 14,
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink)', fontSize: 13,
          }}
        >
          {MISSION_TYPES_LIST.map(t => (
            <option key={t} value={t}>{MISSION_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink2)', marginBottom: 6 }}>
          Title
        </label>
        <input
          autoFocus
          placeholder="e.g. Q3 research sweep for India market"
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6, marginBottom: 16,
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)', cursor: 'pointer',
          }}>Cancel</button>
          <button type="submit" disabled={loading || !title.trim()} style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            background: 'var(--sage)', border: 'none', color: '#fff',
            cursor: loading || !title.trim() ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Creating…' : 'Create & run'}
          </button>
        </div>
      </form>
    </div>
  );
}

const STATUS_FILTERS = ['all', 'running', 'waiting_approval', 'completed', 'failed', 'queued'];

export default function MissionsPage() {
  const [missions,   setMissions]   = useState<Mission[]>([]);
  const [approvals,  setApprovals]  = useState<MissionApproval[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    try {
      const [missRes, apprRes] = await Promise.all([
        api.missions.list(session.access_token, filter !== 'all' ? { status: filter } : undefined),
        api.missions.approvals(session.access_token),
      ]);
      setMissions(missRes.missions ?? []);
      setTotal(missRes.total ?? 0);
      setApprovals(apprRes.approvals ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 32px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>
            Missions
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
            {total} mission{total !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={load}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)', cursor: 'pointer',
            }}
          >
            <IconRefresh size={13} /> Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'var(--sage)', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            <IconPlus size={13} /> New mission
          </button>
        </div>
      </div>

      {/* Approval banner */}
      <ApprovalBanner approvals={approvals} onRefresh={load} />

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: filter === s ? 'var(--sage-d)'   : 'var(--raised)',
              border:     filter === s ? '1px solid var(--sage-b)' : '1px solid var(--border2)',
              color:      filter === s ? 'var(--sage)'     : 'var(--ink2)',
            }}
          >
            {s === 'all' ? 'All' : (STATUS_CONFIG[s]?.label ?? s)}
          </button>
        ))}
      </div>

      {/* Mission list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink3)', fontSize: 13, padding: '32px 0' }}>
          <IconLoader2 size={16} color="var(--ink3)" />
          Loading missions…
        </div>
      ) : missions.length === 0 ? (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '48px 24px', textAlign: 'center',
        }}>
          <IconTarget size={28} color="var(--ink3)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
            {filter !== 'all' ? `No ${STATUS_CONFIG[filter]?.label ?? filter} missions` : 'No missions yet'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: 300, margin: '0 auto 16px' }}>
            Create a mission and LaunchMind will plan and execute the steps automatically.
          </div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'var(--sage)', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            <IconPlayerPlay size={12} style={{ marginRight: 4 }} />
            Create first mission
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {missions.map(m => (
            <MissionRow key={m.id} mission={m} onRefresh={load} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateMissionModal
          onCreated={load}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
