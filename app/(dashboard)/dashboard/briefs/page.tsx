'use client';
/**
 * @file app/(dashboard)/dashboard/briefs/page.tsx
 * @description Weekly performance briefs — the Learn loop (step 4 of core loop).
 *   LEFT (65%):  brief narrative — What Worked / What to Kill / Next 7 Days actions
 *   RIGHT (35%): brief history list for switching between weeks
 *   Content assets live on the Strategy page (Execute step, step 3).
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { WeeklyBrief } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';
import { IconSparkles } from '@tabler/icons-react';

const STATUS_STYLE: Record<WeeklyBrief['status'], React.CSSProperties> = {
  draft:        { background: 'var(--raised)',   color: 'var(--ink2)',   border: '1px solid var(--border2)' },
  sent:         { background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)' },
  acknowledged: { background: 'var(--sage-d)',   color: 'var(--sage)',   border: '1px solid var(--sage-b)' },
};

const STATUS_LABEL: Record<WeeklyBrief['status'], string> = {
  draft: 'Draft', sent: 'Sent', acknowledged: 'Acknowledged',
};

export default function BriefsPage() {
  const supabase = createClient();
  const [briefs, setBriefs] = useState<WeeklyBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;
      const { briefs: data } = await api.briefs.list(session.access_token);
      setBriefs(data);
      if (data.length > 0) setSelectedId(data[0].id);
      if (data.some((b) => b.status === 'sent' || b.status === 'acknowledged')) {
        trackOnboarding('brief_received', { count: data.length });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load briefs');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const selectedBrief = briefs.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="p-6" style={{ maxWidth: 1100 }}>
      <div className="mb-5">
        <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Weekly brief
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>
          Sunday performance briefs — what worked, what to kill, and your next 7-day actions.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[8px] px-4 py-3" style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', color: 'var(--red)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16" style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading briefs…</div>
      ) : briefs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>

          {/* LEFT — brief narrative */}
          <div>
            {selectedBrief
              ? <BriefNarrative brief={selectedBrief} />
              : <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'var(--ink3)' }}>Select a brief from the list →</p>
                </div>
            }
          </div>

          {/* RIGHT — brief history */}
          <div style={{ position: 'sticky', top: 24 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 500, marginBottom: 10, marginTop: 0 }}>
                Brief history
              </p>
              <div className="space-y-1">
                {briefs.map((brief) => (
                  <button
                    key={brief.id}
                    onClick={() => setSelectedId(brief.id)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 7,
                      background: selectedId === brief.id ? 'var(--raised)' : 'transparent',
                      border: selectedId === brief.id ? '1px solid var(--border2)' : '1px solid transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: selectedId === brief.id ? 500 : 400 }}>
                        {brief.productName ?? 'Product'} — {new Date(brief.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="rounded-full px-2 py-0.5" style={{ fontSize: 10, ...STATUS_STYLE[brief.status] }}>
                        {STATUS_LABEL[brief.status]}
                      </span>
                    </div>
                    {brief.what_worked && (
                      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, marginBottom: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {brief.what_worked}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brief narrative ──────────────────────────────────────────────────────────

function BriefNarrative({ brief }: { brief: WeeklyBrief }) {
  const nextActions = brief.next_actions as { actions?: string[] } | null;

  return (
    <div style={{ background: 'var(--surface)', border: '1.5px solid var(--sage-b)', borderRadius: 10, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
            {brief.productName ?? 'Product'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 3, marginBottom: 0 }}>
            Week of {new Date(brief.week_of).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1" style={{ fontSize: 11, ...STATUS_STYLE[brief.status] }}>
          {STATUS_LABEL[brief.status]}
        </span>
      </div>

      {brief.what_worked && (
        <div style={{ borderLeft: '3px solid var(--sage)', paddingLeft: 14, marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 5, marginTop: 0 }}>
            What worked
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{brief.what_worked}</p>
        </div>
      )}

      {brief.what_to_kill && (
        <div style={{ borderLeft: '3px solid var(--red)', paddingLeft: 14, marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 5, marginTop: 0 }}>
            What to kill
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{brief.what_to_kill}</p>
        </div>
      )}

      {nextActions?.actions && nextActions.actions.length > 0 && (
        <div style={{ borderLeft: '3px solid var(--indigo)', paddingLeft: 14 }}>
          <p style={{ fontSize: 10, color: 'var(--indigo)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 10, marginTop: 0 }}>
            Next 7 days — {nextActions.actions.length} actions
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {nextActions.actions.map((action: string, i: number) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--indigo-d)', color: 'var(--indigo)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, marginTop: 1,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{action}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!brief.what_worked && !brief.what_to_kill && !nextActions?.actions?.length && (
        <p style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', padding: '16px 0' }}>
          Brief is being prepared — check back Sunday evening.
        </p>
      )}

      {brief.sent_at && (
        <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 18, marginBottom: 0 }}>
          Sent {new Date(brief.sent_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--raised)' }}>
        <IconSparkles size={24} color="var(--ink3)" />
      </div>
      <h3 className="font-semibold mb-2" style={{ fontSize: 15, color: 'var(--ink)' }}>No weekly briefs yet</h3>
      <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 340 }}>
        Briefs are generated every Sunday once your campaigns have at least one week of performance data.
      </p>
    </div>
  );
}
