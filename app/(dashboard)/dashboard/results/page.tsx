/**
 * @file app/(dashboard)/dashboard/results/page.tsx
 * @description Results — interpreted performance metrics across all channels and markets.
 *   Per ADR-033: owner-language framing ("Your installs went up 12%"), not raw metrics.
 * @security JWT from Supabase session.
 * @dependencies api.owner.results
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type ResultsSummary } from '@/lib/api';
import Link from 'next/link';
import {
  IconArrowRight,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandWhatsapp,
  IconMail,
  IconBolt,
  IconTrendingUp,
} from '@tabler/icons-react';

const CHANNEL_ICON: Record<string, React.ElementType> = {
  meta:      IconBrandFacebook,
  google:    IconBrandGoogle,
  whatsapp:  IconBrandWhatsapp,
  email:     IconMail,
};

function MetricBlock({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <div className="bg-raised rounded-[var(--r2)] p-[11px_13px]">
      <p className="text-[11px] text-ink3 font-medium mb-1">{label}</p>
      <p className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'DM Mono, monospace' }}>
        {value ?? '—'}
      </p>
      {sub && <p className="text-[11px] text-ink2 mt-0.5">{sub}</p>}
    </div>
  );
}

function WeekBar({ week, value, max }: { week: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <p className="text-[11px] text-ink2 w-16 shrink-0">{new Date(week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
      <div className="flex-1 bg-raised rounded-full h-2 overflow-hidden">
        <div className="bg-sage h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12px] font-medium text-ink w-12 text-right" style={{ fontFamily: 'DM Mono, monospace' }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default function ResultsPage() {
  const [data,    setData]    = useState<ResultsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      api.owner.results(session.access_token)
        .then(res => { setData(res); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-2 text-ink2">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading results…
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxInstalls = Math.max(...data.weeklyData.map(w => w.installs), 1);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Results</h1>
        <p className="text-[13px] text-ink2 mt-1">All-channel performance · last 8 weeks</p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricBlock
          label="Total installs"
          value={data.summary.totalInstalls.toLocaleString()}
          sub="All campaigns combined"
        />
        <MetricBlock
          label="Avg CPI"
          value={data.summary.avgCpi ? `$${data.summary.avgCpi}` : null}
          sub="Cost per install"
        />
        <MetricBlock
          label="Active campaigns"
          value={data.summary.activeCampaigns}
        />
        <MetricBlock
          label="Completed missions"
          value={data.summary.completedMissions}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          {/* Weekly installs trend */}
          {data.weeklyData.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconTrendingUp size={15} color="var(--sage)" />
                <p className="text-[13px] font-medium text-ink">Weekly installs</p>
              </div>
              <div className="space-y-2">
                {data.weeklyData.slice(0, 8).map(w => (
                  <WeekBar key={w.week} week={w.week} value={w.installs} max={maxInstalls} />
                ))}
              </div>
            </div>
          )}

          {/* Recent campaigns */}
          {data.recentCampaigns.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-ink">Recent campaigns</p>
                <Link href="/dashboard/campaigns" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  All <IconArrowRight size={11} />
                </Link>
              </div>
              <div className="space-y-2">
                {data.recentCampaigns.map(c => {
                  const Icon = CHANNEL_ICON[c.channel] ?? IconBolt;
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-1.5">
                      <div className="w-7 h-7 rounded-[var(--r2)] bg-raised border border-[var(--border2)] flex items-center justify-center shrink-0">
                        <Icon size={13} color="var(--ink2)" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-ink font-medium">{c.channel} · {c.market.toUpperCase()}</p>
                        {c.hook_type && <p className="text-[11px] text-ink2">{c.hook_type}</p>}
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-[4px] border font-medium capitalize ${
                        c.status === 'launched'   ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage' :
                        c.status === 'completed'  ? 'bg-[var(--indigo-d)] border-[var(--indigo-b)] text-indigo' :
                        'bg-raised border-[var(--border2)] text-ink2'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: channel breakdown + recent missions */}
        <div className="space-y-4">
          {data.channels.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <p className="text-[13px] font-medium text-ink mb-3">By channel</p>
              <div className="space-y-2">
                {data.channels.sort((a, b) => b.installs - a.installs).map(c => {
                  const Icon = CHANNEL_ICON[c.channel] ?? IconBolt;
                  return (
                    <div key={c.channel} className="flex items-center gap-2">
                      <Icon size={14} color="var(--ink2)" />
                      <span className="text-[13px] text-ink capitalize flex-1">{c.channel}</span>
                      <span className="text-[12px] font-medium text-ink" style={{ fontFamily: 'DM Mono, monospace' }}>
                        {c.installs.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.recentMissions.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-ink">Completed missions</p>
                <Link href="/dashboard/missions" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  All <IconArrowRight size={11} />
                </Link>
              </div>
              <div className="space-y-2">
                {data.recentMissions.map(m => (
                  <Link key={m.id} href={`/dashboard/missions/${m.id}`} className="flex items-start gap-2 hover:bg-raised rounded-[var(--r2)] px-1 -mx-1 py-1 transition-colors">
                    <IconBolt size={13} color="var(--sage)" className="mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-ink">{m.title}</p>
                      <p className="text-[11px] text-ink3">{m.type}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
