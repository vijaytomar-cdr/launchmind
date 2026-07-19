/**
 * @file app/(dashboard)/dashboard/intelligence/ai-audit/page.tsx
 * @description AI Audit dashboard — view AI request history with latency, token usage, and cost.
 *   Studio/Builder founders can inspect every AI call: model, prompt, tokens, cost, latency, retries.
 *   Stat cards show totals; table shows paginated request history with filter by status/promptId.
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { AIRequest, AIAuditStats } from '@/lib/api';
import {
  IconSparkles,
  IconClock,
  IconCoin,
  IconAlertCircle,
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  success: { label: 'Success', color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  retried: { label: 'Retried', color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  failed:  { label: 'Failed',  color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
  timeout: { label: 'Timeout', color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.failed;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 500,
      padding: '2px 8px',
      borderRadius: 4,
      color: m.color,
      background: m.bg,
      border: `1px solid ${m.border}`,
    }}>
      {m.label}
    </span>
  );
}

// ── Model badge ───────────────────────────────────────────────────────────────

function ModelBadge({ model }: { model: string }) {
  const isSonnet = model.includes('sonnet');
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 500,
      padding: '2px 8px',
      borderRadius: 4,
      color: isSonnet ? 'var(--indigo)' : 'var(--ink2)',
      background: isSonnet ? 'var(--indigo-d)' : 'var(--raised)',
      border: `1px solid ${isSonnet ? 'var(--indigo-b)' : 'var(--border2)'}`,
    }}>
      {isSonnet ? 'Sonnet' : 'Haiku'}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--raised)',
      borderRadius: 6,
      padding: '11px 13px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    }}>
      <div style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{sub}</div>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function AIAuditPage() {
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<AIAuditStats | null>(null);
  const [requests, setRequests] = useState<AIRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPrompt, setFilterPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
    });
  }, []);

  const loadStats = useCallback(async (t: string) => {
    try {
      const res = await api.ai.auditStats(t);
      setStats(res.data);
    } catch {
      // Non-fatal — stats may not be available yet
    }
  }, []);

  const loadRequests = useCallback(async (t: string, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.ai.audit(t, {
        limit:    PAGE_SIZE,
        offset:   pg * PAGE_SIZE,
        status:   filterStatus || undefined,
        promptId: filterPrompt || undefined,
      });
      setRequests(res.data.requests);
      setTotal(res.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPrompt]);

  useEffect(() => {
    if (!token) return;
    loadStats(token);
    loadRequests(token, page);
  }, [token, page, loadStats, loadRequests]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatCost = (cost: number | null) => {
    if (cost === null || cost === undefined) return '—';
    if (cost < 0.001) return `$${(cost * 1000).toFixed(4)}m`;
    return `$${cost.toFixed(5)}`;
  };

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Syne, sans-serif', margin: 0 }}>
          AI Audit Log
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '4px 0 0' }}>
          Every AI request, cost, and latency — tracked automatically.
        </p>
      </div>

      {/* Stats grid */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
          <StatCard
            label="Total requests"
            value={stats.totals.requests.toLocaleString()}
            sub={`${stats.totals.failures} failures`}
          />
          <StatCard
            label="Total tokens"
            value={stats.totals.totalTokens.toLocaleString()}
            sub="input + output"
          />
          <StatCard
            label="Total cost"
            value={`$${stats.totals.totalCostUsd.toFixed(4)}`}
            sub="estimated USD"
          />
          <StatCard
            label="Success rate"
            value={stats.totals.requests > 0
              ? `${(((stats.totals.requests - stats.totals.failures) / stats.totals.requests) * 100).toFixed(1)}%`
              : '—'}
          />
        </div>
      )}

      {/* Model breakdown */}
      {stats && Object.keys(stats.byModel).length > 0 && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 10 }}>BY MODEL</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {Object.entries(stats.byModel).map(([model, data]) => (
              <div key={model} style={{
                background: 'var(--raised)',
                borderRadius: 6,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
                <ModelBadge model={model} />
                <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 4 }}>
                  <span style={{ fontFamily: 'DM Mono, monospace' }}>{data.requests}</span> requests ·{' '}
                  <span style={{ fontFamily: 'DM Mono, monospace' }}>{data.totalTokens.toLocaleString()}</span> tokens
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                  Avg latency {formatLatency(data.avgLatencyMs)} · Total cost ${data.totalCostUsd.toFixed(4)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter by prompt ID..."
            value={filterPrompt}
            onChange={e => { setFilterPrompt(e.target.value); setPage(0); }}
            style={{
              background: 'var(--raised)',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--ink)',
              width: 200,
              outline: 'none',
            }}
          />
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
            style={{
              background: 'var(--raised)',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--ink)',
              outline: 'none',
            }}
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="retried">Retried</option>
            <option value="failed">Failed</option>
            <option value="timeout">Timeout</option>
          </select>
          <button
            onClick={() => token && loadRequests(token, page)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--ink2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconRefresh size={13} />
            Refresh
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink3)' }}>
            {total.toLocaleString()} requests total
          </div>
        </div>

        {/* Table */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--danger-d)', border: '1px solid var(--danger-b)',
            borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--danger)',
          }}>
            <IconAlertCircle size={14} />
            {error}
          </div>
        )}

        {loading && !error && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink3)', fontSize: 13 }}>
            Loading...
          </div>
        )}

        {!loading && !error && requests.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <IconSparkles size={28} style={{ color: 'var(--ink3)', margin: '0 auto 10px' }} />
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>No AI requests yet</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
              AI requests are tracked automatically when the platform generates content.
            </div>
          </div>
        )}

        {!loading && !error && requests.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Prompt', 'Model', 'Status', 'Tokens', 'Cost', 'Latency', 'Retries'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--ink3)',
                      padding: '0 10px 8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((req, i) => (
                  <tr
                    key={req.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                    }}
                  >
                    <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>
                      {formatDate(req.created_at)}
                    </td>
                    <td style={{ padding: '9px 10px' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
                        {req.prompt_id}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>v{req.prompt_version}</div>
                    </td>
                    <td style={{ padding: '9px 10px' }}>
                      <ModelBadge model={req.model} />
                    </td>
                    <td style={{ padding: '9px 10px' }}>
                      <StatusBadge status={req.status} />
                      {req.error && (
                        <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {req.error}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                      {req.total_tokens !== null ? req.total_tokens.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                      {formatCost(req.cost_usd)}
                    </td>
                    <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                      {formatLatency(req.latency_ms)}
                    </td>
                    <td style={{ padding: '9px 10px', fontSize: 12, color: req.retries > 0 ? 'var(--amber)' : 'var(--ink3)', fontFamily: 'DM Mono, monospace' }}>
                      {req.retries}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                background: 'var(--raised)',
                border: '1px solid var(--border2)',
                borderRadius: 5,
                padding: '4px 8px',
                cursor: page === 0 ? 'not-allowed' : 'pointer',
                opacity: page === 0 ? 0.4 : 1,
                display: 'flex', alignItems: 'center',
              }}
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                background: 'var(--raised)',
                border: '1px solid var(--border2)',
                borderRadius: 5,
                padding: '4px 8px',
                cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages - 1 ? 0.4 : 1,
                display: 'flex', alignItems: 'center',
              }}
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
