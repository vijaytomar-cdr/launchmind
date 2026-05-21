/**
 * @file app/(dashboard)/dashboard/admin/page.tsx
 * @description Admin panel: waitlist stats, founder counts, onboarding funnel, and
 *   recent feedback. Data is fetched via server-side proxy routes that inject the
 *   X-Admin-Secret header. Non-admin users see a 403 card without a redirect.
 * @security Access gated by ADMIN_FOUNDER_ID check in /api/admin/* proxy routes.
 *   Supabase session verified on each proxy request — no admin secret ever sent to browser.
 * @dependencies /api/admin/stats, /api/admin/feedback, lib/supabase/client
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FunnelStep {
  step: string;
  label: string;
  count: number;
}

interface AdminStats {
  waitlistCount: number;
  founderCount: number;
  funnel: FunnelStep[];
}

interface FeedbackItem {
  id: string;
  rating: number;
  body: string | null;
  context: string | null;
  productId: string | null;
  createdAt: string;
}

interface AdminFeedback {
  feedback: FeedbackItem[];
  total: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <span style={{ color: 'var(--amber)', fontSize: 13 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ opacity: i < rating ? 1 : 0.25 }}>★</span>
      ))}
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      className="rounded-[10px] p-5 flex flex-col gap-1"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p
        className="font-mono font-semibold"
        style={{ fontSize: 28, color: 'var(--ink)', lineHeight: 1 }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

const FUNNEL_ORDER: string[] = [
  'signup_complete',
  'icp_confirmed',
  'strategy_generated',
  'channel_connected',
  'brief_received',
  'feedback_submitted',
];

const FUNNEL_LABELS: Record<string, string> = {
  signup_complete: 'Signed up',
  icp_confirmed: 'ICP confirmed',
  strategy_generated: 'Strategy generated',
  channel_connected: 'Channel connected',
  brief_received: 'Brief received',
  feedback_submitted: 'Feedback submitted',
};

function FunnelPipeline({ steps }: { steps: FunnelStep[] }) {
  // Sort by the canonical funnel order; unknown steps go to the end
  const sorted = [...steps].sort(
    (a, b) =>
      (FUNNEL_ORDER.indexOf(a.step) + 1 || 999) -
      (FUNNEL_ORDER.indexOf(b.step) + 1 || 999)
  );

  if (sorted.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--ink3)' }}>No funnel data available yet.</p>
    );
  }

  const topCount = sorted[0]?.count ?? 1;

  return (
    <div className="space-y-2">
      {sorted.map((step, i) => {
        const prev = sorted[i - 1];
        const pct = topCount > 0 ? Math.round((step.count / topCount) * 100) : 0;
        const conversion =
          prev && prev.count > 0
            ? Math.round((step.count / prev.count) * 100)
            : null;

        return (
          <div key={step.step}>
            {conversion !== null && (
              <div
                className="flex items-center gap-1 mb-1 ml-3"
                style={{ fontSize: 11, color: 'var(--ink3)' }}
              >
                <span style={{ color: 'var(--ink3)' }}>↓</span>
                <span>{conversion}% conversion</span>
              </div>
            )}
            <div
              className="rounded-[8px] p-3 flex items-center justify-between gap-4"
              style={{ background: 'var(--raised)' }}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 24,
                    height: 24,
                    background: 'var(--sage-d)',
                    border: '1px solid var(--sage-b)',
                    fontSize: 11,
                    color: 'var(--sage)',
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    {FUNNEL_LABELS[step.step] ?? step.step}
                  </p>
                  {/* progress bar */}
                  <div
                    className="mt-1 rounded-full overflow-hidden"
                    style={{ height: 4, background: 'var(--border2)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: 'var(--sage)' }}
                    />
                  </div>
                </div>
              </div>
              <p
                className="font-mono font-semibold flex-shrink-0"
                style={{ fontSize: 16, color: 'var(--ink)' }}
              >
                {step.count.toLocaleString()}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = createClient();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feedbackData, setFeedbackData] = useState<AdminFeedback | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');

      // Verify session exists on client before hitting the proxy
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      try {
        const [statsRes, feedRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/feedback'),
        ]);

        if (statsRes.status === 403 || feedRes.status === 403) {
          setForbidden(true);
          setLoading(false);
          return;
        }

        if (!statsRes.ok) throw new Error(`Stats error ${statsRes.status}`);
        if (!feedRes.ok) throw new Error(`Feedback error ${feedRes.status}`);

        const [statsJson, feedJson] = await Promise.all([
          statsRes.json() as Promise<AdminStats>,
          feedRes.json() as Promise<AdminFeedback>,
        ]);

        setStats(statsJson);
        setFeedbackData(feedJson);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 403 state ─────────────────────────────────────────────────────────────
  if (forbidden) {
    return (
      <div className="p-8">
        <div
          className="max-w-md rounded-[10px] p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--red-b)' }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--red)' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="font-display font-semibold mb-2" style={{ fontSize: 16, color: 'var(--ink)' }}>
            Access denied
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
            This page is restricted to LaunchMind administrators.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-3" style={{ color: 'var(--ink3)', fontSize: 13 }}>
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
          Loading admin data…
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-8">
        <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>
      </div>
    );
  }

  // ── Main admin panel ───────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Admin panel
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Waitlist, founder growth, onboarding funnel, and recent feedback.
          </p>
        </div>
        <Link
          href="/dashboard/admin/mrr"
          style={{
            fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 6,
            background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)',
            textDecoration: 'none', whiteSpace: 'nowrap' as const,
          }}
        >
          MRR tracker →
        </Link>
      </div>

      {/* Top metrics */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard label="Waitlist signups" value={stats.waitlistCount} />
          <MetricCard label="Active founders" value={stats.founderCount} />
        </div>
      )}

      {/* Onboarding funnel */}
      {stats && (
        <div
          className="rounded-[10px] p-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <h2 className="font-display font-semibold mb-5" style={{ fontSize: 15, color: 'var(--ink)' }}>
            Onboarding funnel
          </h2>
          <FunnelPipeline steps={stats.funnel} />
        </div>
      )}

      {/* Recent feedback */}
      {feedbackData && (
        <div
          className="rounded-[10px] overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)' }}>
              Recent feedback
              <span
                className="ml-2 rounded-full px-2 py-0.5 font-mono font-medium"
                style={{ fontSize: 11, background: 'var(--raised)', color: 'var(--ink2)' }}
              >
                {feedbackData.total}
              </span>
            </h2>
          </div>

          {feedbackData.feedback.length === 0 ? (
            <p className="px-6 py-8 text-center" style={{ fontSize: 13, color: 'var(--ink3)' }}>
              No feedback submitted yet.
            </p>
          ) : (
            <div>
              {feedbackData.feedback.map((item, i) => (
                <div
                  key={item.id}
                  className="px-6 py-4 flex items-start gap-4"
                  style={{
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <StarRating rating={item.rating} />
                      {item.context && (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{
                            fontSize: 11,
                            background: 'var(--indigo-d)',
                            color: 'var(--indigo)',
                            border: '1px solid var(--indigo-b)',
                          }}
                        >
                          {item.context}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                    {item.body ? (
                      <p style={{ fontSize: 13, color: 'var(--ink2)' }}>{item.body}</p>
                    ) : (
                      <p style={{ fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>
                        No comment
                      </p>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', flexShrink: 0, paddingTop: 2 }}>
                    #{item.id.slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
