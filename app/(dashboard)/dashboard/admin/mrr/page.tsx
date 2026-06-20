/**
 * @file app/(dashboard)/dashboard/admin/mrr/page.tsx
 * @description MRR tracking dashboard — admin only.
 *   Shows total MRR (USD), paying founder count, MRR by tier, and MRR by market (USD vs INR).
 *   Target: $2,500 MRR = ~50 paying founders at mixed tier distribution.
 * @security Admin only — 403 if not ADMIN_FOUNDER_ID. No payment keys client-side.
 * @dependencies /api/admin/mrr proxy route, lib/supabase/client
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TierMrr {
  usdMrr: number;
  inrMrr: number;
  founders: number;
}

interface MrrData {
  totalMrrUSD: number;
  totalPayingFounders: number;
  mrrByTier: Record<string, TierMrr>;
  mrrByMarket: { usd: number; inr: number };
}

const TIER_LABELS: Record<string, string> = {
  solo: 'Solo', builder: 'Builder', studio: 'Studio',
};

const TARGET_MRR = 2500;
const TARGET_FOUNDERS = 50;

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function MrrCard({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${highlight ? 'var(--sage-b)' : 'var(--border)'}`,
      borderRadius: 10, padding: '18px 22px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div className="font-mono font-semibold" style={{ fontSize: 28, color: highlight ? 'var(--sage)' : 'var(--ink)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function AdminMrrPage() {
  const [data, setData] = useState<MrrData | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/mrr')
      .then(async (res) => {
        if (res.status === 403) { setForbidden(true); return; }
        if (!res.ok) throw new Error(`Error ${res.status}`);
        setData(await res.json() as MrrData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (forbidden) {
    return (
      <div className="p-8">
        <div style={{ maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--red-b)', borderRadius: 10, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Access denied</div>
          <p style={{ fontSize: 13, color: 'var(--ink2)' }}>Admin-only page.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3" style={{ color: 'var(--ink3)', fontSize: 13 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--sage)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
        Loading MRR data…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (error) {
    return <div className="p-8" style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>;
  }

  if (!data) return null;

  const mrrPct = Math.min(100, Math.round((data.totalMrrUSD / TARGET_MRR) * 100));
  const foundersPct = Math.min(100, Math.round((data.totalPayingFounders / TARGET_FOUNDERS) * 100));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>
            <Link href="/dashboard/admin" style={{ color: 'var(--ink3)', textDecoration: 'none' }}>Admin</Link>
            {' › '}MRR
          </div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>MRR tracker</h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>Phase 5 target: $2,500 MRR · 50 paying founders</p>
        </div>
      </div>

      {/* Top metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MrrCard
          label="Total MRR (USD)"
          value={`$${fmt(data.totalMrrUSD)}`}
          sub={`${mrrPct}% of $${fmt(TARGET_MRR)} target`}
          highlight={data.totalMrrUSD >= TARGET_MRR}
        />
        <MrrCard
          label="Paying founders"
          value={fmt(data.totalPayingFounders)}
          sub={`${foundersPct}% of ${TARGET_FOUNDERS} target`}
        />
        <MrrCard
          label="Avg revenue / founder"
          value={data.totalPayingFounders > 0 ? `$${fmt(data.totalMrrUSD / data.totalPayingFounders, 1)}` : '—'}
          sub="blended USD"
        />
      </div>

      {/* Progress to target */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '20px 24px' }}>
        <div className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 16 }}>Progress to Phase 5 target</div>

        {[
          { label: 'MRR', current: data.totalMrrUSD, target: TARGET_MRR, fmt: (v: number) => `$${fmt(v)}` },
          { label: 'Paying founders', current: data.totalPayingFounders, target: TARGET_FOUNDERS, fmt: (v: number) => `${fmt(v)}` },
        ].map(({ label, current, target, fmt: fmtFn }) => {
          const pct = Math.min(100, Math.round((current / target) * 100));
          const done = current >= target;
          return (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{label}</span>
                <span className="font-mono" style={{ fontSize: 12, color: done ? 'var(--sage)' : 'var(--ink2)' }}>
                  {fmtFn(current)} / {fmtFn(target)}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--raised)' }}>
                <div style={{
                  width: `${pct}%`, height: '100%', borderRadius: 3,
                  background: done ? 'var(--sage)' : 'var(--indigo)', transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* MRR by tier */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <div className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>MRR by tier</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Tier', 'Founders', 'USD MRR', 'INR MRR'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--ink3)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '10px 24px', borderBottom: '1px solid var(--border)',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['solo', 'builder', 'studio'] as const).map((tier, i) => {
              const row = data.mrrByTier[tier];
              return (
                <tr key={tier} style={{ borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 24px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)',
                    }}>
                      {TIER_LABELS[tier]}
                    </span>
                  </td>
                  <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, color: 'var(--ink2)' }}>
                    {row ? fmt(row.founders) : '0'}
                  </td>
                  <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, color: row?.usdMrr ? 'var(--ink)' : 'var(--ink3)' }}>
                    {row ? `$${fmt(row.usdMrr, 0)}` : '$0'}
                  </td>
                  <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, color: row?.inrMrr ? 'var(--ink)' : 'var(--ink3)' }}>
                    {row ? `₹${fmt(row.inrMrr, 0)}` : '₹0'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 24px', fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Total</td>
              <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {fmt(data.totalPayingFounders)}
              </td>
              <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, fontWeight: 600, color: 'var(--sage)' }}>
                ${fmt(data.mrrByMarket.usd, 0)}
              </td>
              <td className="font-mono" style={{ padding: '12px 24px', fontSize: 13, fontWeight: 600, color: 'var(--amber)' }}>
                ₹{fmt(Object.values(data.mrrByTier).reduce((a, b) => a + b.inrMrr, 0), 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Market split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--sage-b)', borderRadius: 10, padding: '16px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>🇺🇸</span>
            <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>USD (Stripe)</span>
          </div>
          <div className="font-mono font-semibold" style={{ fontSize: 24, color: 'var(--sage)' }}>
            ${fmt(data.mrrByMarket.usd, 0)}
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)', marginLeft: 4 }}>/ mo</span>
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--amber-b)', borderRadius: 10, padding: '16px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>🇮🇳</span>
            <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>INR (Razorpay)</span>
          </div>
          <div className="font-mono font-semibold" style={{ fontSize: 24, color: 'var(--amber)' }}>
            ${fmt(data.mrrByMarket.inr, 0)}
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)', marginLeft: 4 }}>USD eq / mo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
