/**
 * @file app/(dashboard)/dashboard/page.tsx
 * @description Main dashboard overview — metrics, products, latest brief, channel performance.
 * @security Auth token from Supabase session. Read-only data fetch.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product, Campaign, WeeklyBrief } from '@/lib/api';

const STATUS_STYLE: Record<Campaign['status'], React.CSSProperties> = {
  draft:            { background: 'var(--raised)',   color: 'var(--ink2)',  border: '1px solid var(--border2)' },
  pending_approval: { background: 'var(--amber-d)',  color: 'var(--amber)', border: '1px solid var(--amber-b)' },
  approved:         { background: 'var(--sage-d)',   color: 'var(--sage)',  border: '1px solid var(--sage-b)' },
  launched:         { background: 'var(--sage-d)',   color: 'var(--sage)',  border: '1px solid var(--sage-b)' },
  paused:           { background: 'var(--amber-d)',  color: 'var(--amber)', border: '1px solid var(--amber-b)' },
  completed:        { background: 'var(--raised)',   color: 'var(--ink2)',  border: '1px solid var(--border2)' },
};

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Draft', pending_approval: 'Pending', approved: 'Approved',
  launched: 'Live', paused: 'Paused', completed: 'Done',
};

function weekLabel(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DashboardPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [briefs, setBriefs] = useState<WeeklyBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const token = session.access_token;
      const [prods, { campaigns: camps }, { briefs: bfs }] = await Promise.all([
        api.products.list(token),
        api.campaigns.list(token),
        api.briefs.list(token),
      ]);
      setProducts(prods);
      setCampaigns(camps);
      setBriefs(bfs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const activeCampaigns = campaigns.filter((c) => c.status === 'launched');
  const totalInstalls = 0;
  const avgCpi = null as number | null;
  const topChannel = activeCampaigns.length > 0
    ? activeCampaigns.reduce<Record<string, number>>((acc, c) => {
        acc[c.channel] = (acc[c.channel] ?? 0) + 1;
        return acc;
      }, {})
    : {};
  const topChannelName = Object.keys(topChannel).sort((a, b) => topChannel[b] - topChannel[a])[0] ?? '—';

  const latestBrief = briefs.length > 0
    ? briefs.sort((a, b) => new Date(b.week_of).getTime() - new Date(a.week_of).getTime())[0]
    : null;

  const briefSent = briefs.some((b) => b.status === 'sent' || b.status === 'acknowledged');

  const metrics = [
    { label: 'Total Installs', value: totalInstalls.toLocaleString(), accent: false },
    { label: 'Avg CPI', value: avgCpi != null ? `$${avgCpi.toFixed(2)}` : '—', accent: false },
    { label: 'Active Campaigns', value: String(activeCampaigns.length), accent: activeCampaigns.length > 0 },
    { label: 'Top Channel', value: topChannelName, accent: false },
  ];

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 11, fontWeight: 500,
    color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
    background: 'var(--raised)',
  };

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56, padding: '0 32px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        marginBottom: 32,
      }}>
        <div>
          <span className="font-display font-bold" style={{ fontSize: 18, color: 'var(--ink)' }}>Dashboard</span>
          <span style={{ fontSize: 12, color: 'var(--ink3)', marginLeft: 10 }}>Week of {weekLabel()}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {briefSent && (
            <span style={{
              fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
              background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)',
            }}>
              ✓ Brief sent
            </span>
          )}
          {activeCampaigns.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
              background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)',
            }}>
              {activeCampaigns.length} active
            </span>
          )}
          <Link
            href="/dashboard/products/new"
            style={{
              fontSize: 13, fontWeight: 500, padding: '6px 14px', borderRadius: 6,
              background: 'var(--sage)', color: '#fff', textDecoration: 'none',
            }}
          >
            + Add product
          </Link>
        </div>
      </div>

      <div style={{ padding: '0 32px' }}>
        {error && (
          <div style={{
            marginBottom: 20, padding: '10px 14px', borderRadius: 8,
            background: 'var(--red-d)', border: '1px solid var(--red-b)', color: 'var(--red)', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', color: 'var(--ink3)', fontSize: 13 }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid var(--border2)', borderTopColor: 'var(--sage)',
              animation: 'spin 0.7s linear infinite',
            }} />
            Loading…
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (
          <>
            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
              {metrics.map((m) => (
                <div key={m.label} style={{
                  background: 'var(--raised)', borderRadius: 6, padding: '11px 13px',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    {m.label}
                  </div>
                  <div className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: m.accent ? 'var(--sage)' : 'var(--ink)' }}>
                    {m.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Two-column: products + brief */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* Products card */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>Products</span>
                  <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{products.length} total</span>
                </div>
                {products.length === 0 ? (
                  <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
                    No products yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {products.slice(0, 4).map((p) => (
                      <Link key={p.id} href={`/dashboard/products/${p.id}`} style={{ textDecoration: 'none' }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 10px', borderRadius: 6, background: 'var(--raised)',
                          transition: 'opacity 0.15s', cursor: 'pointer',
                        }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{p.category ?? 'Uncategorised'}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20,
                              background: p.platform === 'app_store' ? 'var(--indigo-d)' : 'var(--sage-d)',
                              color: p.platform === 'app_store' ? 'var(--indigo)' : 'var(--sage)',
                              border: `1px solid ${p.platform === 'app_store' ? 'var(--indigo-b)' : 'var(--sage-b)'}`,
                            }}>
                              {p.platform === 'app_store' ? 'iOS' : 'Android'}
                            </span>
                            {p.confirmed_icp && (
                              <span style={{
                                fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20,
                                background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)',
                              }}>ICP ✓</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                <Link href="/dashboard/products/new" style={{ fontSize: 12, color: 'var(--sage)', textDecoration: 'none', fontWeight: 500 }}>
                  Add product →
                </Link>
              </div>

              {/* Latest brief card */}
              <div style={{
                background: 'var(--surface)',
                border: latestBrief ? '1.5px solid var(--sage-b)' : '1px solid var(--border)',
                borderRadius: 10, padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>Latest Brief</span>
                  {latestBrief && (
                    <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                      {new Date(latestBrief.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                {!latestBrief ? (
                  <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
                    No briefs generated yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                    {typeof latestBrief.what_worked === 'string' && latestBrief.what_worked && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>What worked</div>
                        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>{latestBrief.what_worked}</div>
                      </div>
                    )}
                    {typeof latestBrief.what_to_kill === 'string' && latestBrief.what_to_kill && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>What to kill</div>
                        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>{latestBrief.what_to_kill}</div>
                      </div>
                    )}
                    {Array.isArray(latestBrief.next_actions) && latestBrief.next_actions.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--indigo)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Next actions</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {(latestBrief.next_actions as Record<string, unknown>[]).slice(0, 3).map((a, i) => (
                            <li key={i} style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
                              {String(a.rationale ?? a.channel ?? JSON.stringify(a))}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                        background: latestBrief.status === 'sent' || latestBrief.status === 'acknowledged' ? 'var(--sage-d)' : 'var(--raised)',
                        color: latestBrief.status === 'sent' || latestBrief.status === 'acknowledged' ? 'var(--sage)' : 'var(--ink3)',
                        border: latestBrief.status === 'sent' || latestBrief.status === 'acknowledged' ? '1px solid var(--sage-b)' : '1px solid var(--border2)',
                        textTransform: 'capitalize',
                      }}>
                        {latestBrief.status}
                      </span>
                    </div>
                  </div>
                )}
                <Link href="/dashboard/briefs" style={{ fontSize: 12, color: 'var(--sage)', textDecoration: 'none', fontWeight: 500 }}>
                  View all briefs →
                </Link>
              </div>
            </div>

            {/* Channel performance table */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <span className="font-display font-bold" style={{ fontSize: 14, color: 'var(--ink)' }}>Channel Performance</span>
              </div>
              {campaigns.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
                  No campaigns yet. Generate a strategy to create campaign drafts.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr>
                        {['Channel', 'Market', 'Installs', 'Status'].map((h) => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr
                          key={c.id}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--raised)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          style={{ transition: 'background 0.1s' }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            {c.channel}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                              background: c.market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
                              color: c.market === 'india' ? 'var(--amber)' : 'var(--sage)',
                              border: `1px solid ${c.market === 'india' ? 'var(--amber-b)' : 'var(--sage-b)'}`,
                            }}>
                              {c.market.toUpperCase()}
                            </span>
                          </td>
                          <td className="font-mono" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ink2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            —
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20, ...STATUS_STYLE[c.status] }}>
                              {STATUS_LABEL[c.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
