/**
 * @file app/(dashboard)/dashboard/opportunities/page.tsx
 * @description Growth Opportunities — table view matching spec #opportunities panel.
 *   Header: title + subtitle + "Generate new analysis" CTA.
 *   Table: Opportunity | Impact (pill + bar) | Confidence % | Effort | Action.
 *   Action column shows only "Create mission" — no Save button per spec.
 * @security JWT from Supabase session. All data filtered server-side by founder_id.
 * @dependencies api.owner.opportunities, api.owner.updateOpportunity, api.recommendations.convert
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type Opportunity } from '@/lib/api';
import { IconBulb, IconArrowRight, IconCheck, IconRefresh } from '@tabler/icons-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FilterState = 'all' | 'saved' | 'dismissed';

function getImpact(confidence: number | null): 'high' | 'medium' | 'low' {
  if (confidence === null) return 'medium';
  if (confidence >= 0.80) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
}

const IMPACT_META = {
  high:   { label: 'High',   pillBg: '#fde8e8', pillColor: '#a52f34', barColor: '#e87878' },
  medium: { label: 'Medium', pillBg: '#fff0d9', pillColor: '#8d4f08', barColor: '#f5b942' },
  low:    { label: 'Low',    pillBg: 'var(--sage2)', pillColor: '#087253', barColor: 'var(--sage)' },
} as const;

const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** Spec grid columns */
const GRID = '1.5fr 0.85fr 0.7fr 0.7fr 0.85fr';

// ── Table row ─────────────────────────────────────────────────────────────────

function TableRow({
  opp,
  token,
  onUpdate,
}: {
  opp: Opportunity;
  token: string;
  onUpdate: (id: string, state: Opportunity['state']) => void;
}) {
  const [acting, setActing] = useState(false);

  const impact   = getImpact(opp.confidence);
  const meta     = IMPACT_META[impact];
  const confPct  = opp.confidence != null ? Math.round(opp.confidence * 100) : null;
  const effort   = EFFORT_LABEL[(opp.effort ?? 'medium').toLowerCase()] ?? 'Medium';

  const convert = async () => {
    setActing(true);
    try {
      await api.recommendations.convert(opp.id, { title: opp.title }, token);
      onUpdate(opp.id, 'converted');
    } catch { /* ignore */ } finally { setActing(false); }
  };

  return (
    <div
      // Test hook: lets the badge-consistency certification count rendered rows
      // instead of guessing at a selector over an inline-styled grid.
      data-opp-row={opp.state}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 12,
        padding: '14px 20px',
        borderTop: '1px solid var(--border)',
        alignItems: 'center',
      }}
    >
      {/* Opportunity title */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
          {opp.title}
        </div>
        {opp.description && (
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opp.description}
          </div>
        )}
      </div>

      {/* Impact — pill + confidence bar */}
      <div>
        <span style={{
          display: 'inline-block',
          padding: '3px 8px',
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '.04em',
          background: meta.pillBg,
          color: meta.pillColor,
          marginBottom: 5,
        }}>
          {meta.label}
        </span>
        {/* Confidence bar — width = confidence % */}
        <div style={{ height: 4, background: 'var(--raised)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${confPct ?? 50}%`,
            background: meta.barColor,
            borderRadius: 99,
          }} />
        </div>
      </div>

      {/* Confidence % — plain text per spec */}
      <div style={{ fontSize: 13, color: 'var(--ink2)', fontFamily: 'DM Mono, monospace' }}>
        {confPct != null ? `${confPct}%` : '—'}
      </div>

      {/* Effort — plain text per spec */}
      <div style={{ fontSize: 13, color: 'var(--ink3)' }}>
        {effort}
      </div>

      {/* Action — Create mission only (spec has no Save here) */}
      <div>
        {opp.state === 'converted' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--sage)', fontWeight: 600 }}>
            <IconCheck size={13} /> Converted
          </span>
        ) : (
          <button
            onClick={() => void convert()}
            disabled={acting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 34,
              border: '1px solid var(--sage3)',
              background: 'var(--sage2)',
              color: '#096b50',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 650,
              cursor: acting ? 'not-allowed' : 'pointer',
              opacity: acting ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            Create mission
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const FILTER_TABS: { key: FilterState; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'saved',     label: 'Saved' },
  { key: 'dismissed', label: 'Dismissed' },
];

export default function OpportunitiesPage() {
  const router = useRouter();
  const [opps,      setOpps]      = useState<Opportunity[]>([]);
  const [filter,    setFilter]    = useState<FilterState>('all');
  const [loading,   setLoading]   = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [token,     setToken]     = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      api.owner.opportunities(t, { state: 'all' })
        .then(res => {
          setOpps(res.opportunities);
          setLoading(false);
          const pid = res.opportunities.find(o => o.product_id)?.product_id ?? null;
          setProductId(pid);
        })
        .catch(() => setLoading(false));
    });
  }, []);

  const fetchFilter = async (f: FilterState) => {
    if (!token) return;
    setFilter(f);
    setLoading(true);
    try {
      const res = await api.owner.opportunities(token, { state: f });
      setOpps(res.opportunities);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const handleUpdate = (id: string, newState: Opportunity['state']) => {
    if (filter !== 'all') {
      setOpps(prev => prev.filter(o => o.id !== id));
    } else {
      setOpps(prev => prev.map(o => o.id === id ? { ...o, state: newState } : o));
    }
    // The sidebar badge is rendered by the (dashboard) SERVER layout, which does
    // not re-run for a client-side state change. Without this, dismissing an
    // opportunity updated the list while the badge kept the count it was born
    // with — the exact stale-badge symptom this page is being fixed for.
    // router.refresh() re-renders the layout, whose /owner/counts fetch is
    // no-store, so the badge recomputes from the same rows the list just changed.
    router.refresh();
  };

  const generateAnalysis = async () => {
    if (!token || analyzing) return;
    setAnalyzing(true);
    try {
      if (productId) await api.recommendations.generate(productId, token);
      const res = await api.owner.opportunities(token, { state: filter });
      setOpps(res.opportunities);
      const pid = res.opportunities.find(o => o.product_id)?.product_id ?? productId;
      setProductId(pid);
      router.refresh();   // newly generated rows must reach the badge too
    } catch { /* ignore */ } finally { setAnalyzing(false); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px', letterSpacing: -0.5, lineHeight: 1.2 }}>
            Growth opportunities
          </h1>
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13, lineHeight: 1.5 }}>
            Prioritized by expected impact, confidence, effort, risk, and strategic fit.
          </p>
        </div>

        <button
          onClick={() => void generateAnalysis()}
          disabled={analyzing || !token}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 40,
            padding: '0 18px',
            background: 'var(--sage)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 650,
            cursor: analyzing ? 'not-allowed' : 'pointer',
            opacity: analyzing ? 0.7 : 1,
            flexShrink: 0,
          }}
        >
          <IconRefresh size={14} style={{ animation: analyzing ? 'spin 1s linear infinite' : 'none' }} />
          {analyzing ? 'Analyzing…' : 'Generate new analysis'}
        </button>
      </div>

      {/* ── Filter tabs ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {FILTER_TABS.map(f => (
          <button
            key={f.key}
            onClick={() => void fetchFilter(f.key)}
            style={{
              padding: '5px 13px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              border: filter === f.key ? '1px solid var(--sage-b)' : '1px solid var(--border2)',
              background: filter === f.key ? 'var(--sage-d)' : 'var(--raised)',
              color: filter === f.key ? 'var(--sage)' : 'var(--ink2)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }} className="animate-pulse">
          {/* Fake header row */}
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '13px 20px', background: 'var(--raised)', borderBottom: '1px solid var(--border)' }}>
            {['Opportunity','Impact','Confidence','Effort','Action'].map(h => (
              <div key={h} style={{ height: 10, background: 'var(--border)', borderRadius: 4, width: '60%' }} />
            ))}
          </div>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '16px 20px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
              <div style={{ height: 14, background: 'var(--border)', borderRadius: 6, width: '80%' }} />
              <div>
                <div style={{ height: 18, background: 'var(--border)', borderRadius: 99, width: 50, marginBottom: 6 }} />
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 99 }} />
              </div>
              <div style={{ height: 13, background: 'var(--border)', borderRadius: 4, width: 32 }} />
              <div style={{ height: 13, background: 'var(--border)', borderRadius: 4, width: 44 }} />
              <div style={{ height: 34, background: 'var(--border)', borderRadius: 10 }} />
            </div>
          ))}
        </div>

      ) : opps.length === 0 ? (
        /* ── Empty state ── */
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 56, textAlign: 'center' }}>
          <IconBulb size={28} color="var(--sage)" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>No opportunities yet</p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 16px' }}>
            {filter === 'all'
              ? 'Complete your product setup or generate a new analysis to unlock growth opportunities.'
              : `No ${filter} opportunities.`}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => void generateAnalysis()}
              disabled={analyzing || !token}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sage)', fontWeight: 600, background: 'none', border: '1px solid var(--sage-b)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}
            >
              Generate first analysis <IconArrowRight size={11} />
            </button>
          )}
        </div>

      ) : (
        /* ── Table card ── */
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>

          {/* Table head */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            gap: 12,
            padding: '13px 20px',
            background: 'var(--raised)',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            fontWeight: 800,
            color: 'var(--ink3)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            <span>Opportunity</span>
            <span>Impact</span>
            <span>Confidence</span>
            <span>Effort</span>
            <span>Action</span>
          </div>

          {/* Rows */}
          {token && opps.map(opp => (
            <TableRow key={opp.id} opp={opp} token={token} onUpdate={handleUpdate} />
          ))}
        </div>
      )}

      {/* Spin animation for refresh icon */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
