/**
 * @file app/(dashboard)/dashboard/missions/[id]/page.tsx
 * @description Mission Detail — timeline of steps and logs, approval UI, retry/cancel actions.
 *   Polls every 5 seconds when mission is running or queued.
 * @security Auth token from Supabase session. Approval responses go through the Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Mission, MissionStep, MissionLog, MissionApproval } from '@/lib/api';
import {
  IconArrowLeft, IconCircleCheck, IconCircleX, IconClock,
  IconLoader2, IconAlertTriangle, IconBan, IconRobot,
  IconChevronDown, IconChevronRight, IconRefresh,
} from '@tabler/icons-react';

type TimelineEntry = ((MissionStep | MissionLog) & { _kind: 'step' | 'log' });

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }> }> = {
  draft:            { label: 'Draft',          color: 'var(--ink2)',  Icon: IconClock },
  queued:           { label: 'Queued',         color: 'var(--indigo)',Icon: IconClock },
  running:          { label: 'Running',        color: 'var(--sage)',  Icon: IconLoader2 },
  waiting_approval: { label: 'Needs approval', color: 'var(--amber)', Icon: IconAlertTriangle },
  completed:        { label: 'Completed',      color: 'var(--sage)',  Icon: IconCircleCheck },
  failed:           { label: 'Failed',         color: 'var(--danger)',   Icon: IconCircleX },
  cancelled:        { label: 'Cancelled',      color: 'var(--ink3)',  Icon: IconBan },
  pending:          { label: 'Pending',        color: 'var(--ink3)',  Icon: IconClock },
};

const LOG_COLORS: Record<string, string> = {
  debug: 'var(--ink3)', info: 'var(--ink2)', warn: 'var(--amber)', error: 'var(--danger)',
};

function StepCard({ step }: { step: MissionStep }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.pending;
  const { Icon } = cfg;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Icon size={14} color={cfg.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
            {step.step_order + 1}. {step.step_name.replace(/_/g, ' ')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 8 }}>
            {step.agent_type}
          </span>
        </div>
        <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
        {expanded ? <IconChevronDown size={12} color="var(--ink3)" /> : <IconChevronRight size={12} color="var(--ink3)" />}
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
          {step.error && (
            <div style={{
              background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 6,
              padding: '8px 10px', marginTop: 10, fontSize: 11, color: 'var(--danger)',
              fontFamily: 'DM Mono, monospace',
            }}>
              {step.error}
            </div>
          )}
          {step.output && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Output</div>
              <pre style={{
                background: 'var(--raised)', borderRadius: 6, padding: '8px 10px',
                fontSize: 10, color: 'var(--ink2)', overflow: 'auto', maxHeight: 200,
                fontFamily: 'DM Mono, monospace', margin: 0,
              }}>
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ink3)', display: 'flex', gap: 12 }}>
            {step.started_at   && <span>Started: {new Date(step.started_at).toLocaleTimeString()}</span>}
            {step.completed_at && <span>Completed: {new Date(step.completed_at).toLocaleTimeString()}</span>}
            <span>Retries: {step.retry_count}/{step.max_retries}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LogLine({ log }: { log: MissionLog }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 9, color: 'var(--ink3)', fontFamily: 'DM Mono, monospace', paddingTop: 1, flexShrink: 0 }}>
        {new Date(log.created_at).toLocaleTimeString()}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: LOG_COLORS[log.level] ?? 'var(--ink3)',
        flexShrink: 0, paddingTop: 1,
      }}>
        {log.level}
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{log.message}</span>
    </div>
  );
}

function ApprovalCard({
  approval, missionId, onResponded,
}: {
  approval: MissionApproval; missionId: string; onResponded: () => void;
}) {
  const [note,     setNote]     = useState('');
  const [loading,  setLoading]  = useState<'approved' | 'rejected' | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function respond(response: 'approved' | 'rejected') {
    setLoading(response);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(null); return; }
    try {
      await api.missions.respond(missionId, approval.step_id, response, note || undefined, session.access_token);
      onResponded();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{
      background: 'var(--amber-d)', border: '1.5px solid var(--amber-b)',
      borderRadius: 10, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <IconAlertTriangle size={16} color="var(--amber)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
            {approval.title}
          </div>
          {approval.description && (
            <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{approval.description}</div>
          )}
        </div>
      </div>

      {approval.preview_data && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              fontSize: 11, color: 'var(--sage)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
            Preview data
          </button>
          {expanded && (
            <pre style={{
              background: 'var(--surface)', borderRadius: 6, padding: '8px 10px', marginTop: 6,
              fontSize: 10, color: 'var(--ink2)', overflow: 'auto', maxHeight: 180,
              fontFamily: 'DM Mono, monospace', margin: '6px 0 0', border: '1px solid var(--amber-b)',
            }}>
              {JSON.stringify(approval.preview_data, null, 2)}
            </pre>
          )}
        </div>
      )}

      <input
        placeholder="Optional note…"
        value={note}
        onChange={e => setNote(e.target.value)}
        style={{
          width: '100%', padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          background: 'var(--surface)', border: '1px solid var(--amber-b)',
          color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => respond('rejected')}
          disabled={!!loading}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: 'var(--surface)', border: '1px solid var(--danger-b)', color: 'var(--danger)',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading === 'rejected' ? 'Rejecting…' : 'Reject & cancel'}
        </button>
        <button
          onClick={() => respond('approved')}
          disabled={!!loading}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: 'var(--sage)', border: 'none', color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading === 'approved' ? 'Approving…' : 'Approve & continue'}
        </button>
      </div>
    </div>
  );
}

export default function MissionDetailPage() {
  const params    = useParams<{ id: string }>();
  const missionId = params.id;

  const [mission,   setMission]   = useState<Mission | null>(null);
  const [steps,     setSteps]     = useState<MissionStep[]>([]);
  const [logs,      setLogs]      = useState<MissionLog[]>([]);
  const [approvals, setApprovals] = useState<MissionApproval[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const [detailRes, logRes, apprRes] = await Promise.all([
        api.missions.get(missionId, session.access_token),
        api.missions.logs(missionId, session.access_token),
        api.missions.approvals(session.access_token),
      ]);
      setMission(detailRes.mission);
      setSteps(detailRes.steps ?? []);
      setLogs(logRes.logs ?? []);
      setApprovals((apprRes.approvals ?? []).filter(a => a.mission_id === missionId && a.status === 'pending'));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  // Auto-refresh when running or queued
  useEffect(() => {
    load();
    const liveStatuses = ['running', 'queued'];
    const interval = setInterval(() => {
      if (mission && liveStatuses.includes(mission.status)) load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load, mission?.status]);

  async function handleCancel() {
    setCancelling(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setCancelling(false); return; }
    try {
      await api.missions.cancel(missionId, session.access_token);
      load();
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink3)', fontSize: 13 }}>
        <IconLoader2 size={16} color="var(--ink3)" />
        Loading mission…
      </div>
    );
  }

  if (!mission) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 13, color: 'var(--danger)' }}>Mission not found.</div>
        <Link href="/dashboard/missions" style={{ fontSize: 12, color: 'var(--sage)', marginTop: 8, display: 'inline-block' }}>
          ← Back to missions
        </Link>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[mission.status] ?? STATUS_CONFIG.draft;
  const { Icon: MissionIcon } = cfg;
  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progressPct    = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 32px)' }}>

      {/* Back + header */}
      <Link href="/dashboard/missions" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, color: 'var(--ink3)', textDecoration: 'none', marginBottom: 16,
      }}>
        <IconArrowLeft size={13} /> Back to missions
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'var(--raised)', border: '1px solid var(--border2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconRobot size={20} color="var(--ink2)" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>
              {mission.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <MissionIcon size={12} color={cfg.color} />
              <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'capitalize' }}>{mission.type}</span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{new Date(mission.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
            background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)', cursor: 'pointer',
          }}>
            <IconRefresh size={12} /> Refresh
          </button>
          {['running', 'queued', 'waiting_approval'].includes(mission.status) && (
            <button onClick={handleCancel} disabled={cancelling} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)',
              cursor: cancelling ? 'not-allowed' : 'pointer', opacity: cancelling ? 0.6 : 1,
            }}>
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: 'var(--ink3)' }}>
            <span>{completedSteps} of {steps.length} steps complete</span>
            <span>{progressPct}%</span>
          </div>
          <div style={{ height: 4, background: 'var(--raised)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progressPct}%`, borderRadius: 4,
              background: mission.status === 'failed' ? 'var(--danger)' : 'var(--sage)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,320px)', gap: 16, alignItems: 'start' }}>

        {/* Left: steps + approvals */}
        <div>
          {/* Pending approvals */}
          {approvals.map(a => (
            <ApprovalCard key={a.id} approval={a} missionId={missionId} onResponded={load} />
          ))}

          {/* Error banner */}
          {mission.error && (
            <div style={{
              background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 8,
              padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--danger)',
            }}>
              <strong>Error:</strong> {mission.error}
            </div>
          )}

          {/* Steps */}
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>
            Steps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink3)' }}>No steps yet.</div>
            ) : (
              steps.map(s => <StepCard key={s.id} step={s} />)
            )}
          </div>
        </div>

        {/* Right: logs */}
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'Syne, sans-serif' }}>
            Execution log
          </div>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 12px', maxHeight: 480, overflowY: 'auto',
          }}>
            {logs.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>No logs yet.</div>
            ) : (
              logs.map(l => <LogLine key={l.id} log={l} />)
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
