/**
 * @file app/(dashboard)/dashboard/intelligence/reviews/page.tsx
 * @description Review Intelligence — App Store / Play Store review analysis, sentiment
 *   breakdowns, recurring themes, and rating trends per product.
 *   Data source: products.scraped_meta (collected during intake + re-scrape in weeklyBriefWorker).
 * @security All data is founder-scoped. Supabase RLS enforced.
 * @dependencies Supabase client, Tabler icons v3
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  IconStar, IconStarFilled, IconThumbUp, IconThumbDown, IconMinus,
  IconDeviceMobile, IconRefresh, IconMessageCircle, IconChartBar,
  IconChevronDown, IconChevronUp,
} from '@tabler/icons-react';
import { ErrorState } from '@/components/launchmind/ErrorState';
import { toRecord } from '@/lib/coerce';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Review {
  author?: string;
  rating: number;
  title?: string;
  body: string;
  date?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

interface ScrapedMeta {
  rating?: number;
  ratingCount?: number;
  reviews?: Review[];
  reviewSummary?: string;
  themes?: string[];
  category?: string;
}

interface Product {
  id: string;
  name: string;
  platform: string;
  scraped_meta: ScrapedMeta | null;
  last_scraped_at: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRow({ value }: { value: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n =>
        n <= Math.round(value)
          ? <IconStarFilled key={n} size={12} style={{ color: 'var(--amber)' }} />
          : <IconStar key={n} size={12} style={{ color: 'var(--ink3)' }} />
      )}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  const map = {
    positive: { icon: IconThumbUp,   color: 'var(--sage)',  bg: 'var(--sage-d)',  border: 'var(--sage-b)',  label: 'Positive' },
    negative: { icon: IconThumbDown, color: 'var(--danger)',   bg: 'var(--danger-d)',   border: 'var(--danger-b)',   label: 'Negative' },
    neutral:  { icon: IconMinus,     color: 'var(--ink2)',  bg: 'var(--raised)',  border: 'var(--border2)', label: 'Neutral' },
  };
  const c = map[sentiment as keyof typeof map] ?? map.neutral;
  const Icon = c.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 500,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <Icon size={10} /> {c.label}
    </span>
  );
}

function RatingBar({ rating, count, total }: { rating: number; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--ink2)', width: 8, textAlign: 'right' }}>{rating}</span>
      <IconStarFilled size={10} style={{ color: 'var(--amber)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 6, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--amber)', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink3)', width: 28, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LEN = 140;
  const needsExpand = review.body.length > PREVIEW_LEN;

  return (
    <div style={{
      background: 'var(--raised)', borderRadius: 8, padding: '12px 14px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StarRow value={review.rating} />
            {review.sentiment && <SentimentBadge sentiment={review.sentiment} />}
          </div>
          {review.title && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{review.title}</div>
          )}
        </div>
        {review.date && (
          <span style={{ fontSize: 10, color: 'var(--ink3)', flexShrink: 0 }}>
            {new Date(review.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
          </span>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink2)', margin: 0, lineHeight: 1.5 }}>
        {!expanded && needsExpand ? `${review.body.slice(0, PREVIEW_LEN)}…` : review.body}
      </p>

      {needsExpand && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 0',
            display: 'flex', alignItems: 'center', gap: 3, color: 'var(--ink3)', fontSize: 11,
          }}
        >
          {expanded ? <><IconChevronUp size={11} /> Less</> : <><IconChevronDown size={11} /> More</>}
        </button>
      )}

      {review.author && (
        <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 6 }}>— {review.author}</div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  const [products, setProducts]   = useState<Product[]>([]);
  const [selected, setSelected]   = useState<Product | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'positive' | 'negative' | 'neutral'>('all');

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError('Not authenticated'); setLoading(false); return; }

        const { data, error: pe } = await supabase
          .from('products')
          .select('id, name, platform, scraped_meta, last_scraped_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (pe) throw pe;

        const list = (data ?? []) as Product[];
        setProducts(list);
        if (list.length > 0) setSelected(list[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 72, background: 'var(--raised)', borderRadius: 10, marginBottom: 12, animation: 'pulse 1.5s infinite' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
        <ErrorState onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <IconStar size={36} style={{ color: 'var(--ink3)', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>No products yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            Add a product to start collecting and analysing App Store and Play Store reviews.
          </div>
        </div>
      </div>
    );
  }

  const rawMeta = toRecord(selected?.scraped_meta);
  const meta: ScrapedMeta = rawMeta as ScrapedMeta;
  const allReviews: Review[] = Array.isArray(rawMeta.reviews) ? rawMeta.reviews as Review[] : [];
  const themes: string[] = Array.isArray(rawMeta.themes)
    ? (rawMeta.themes as unknown[]).filter(t => typeof t === 'string') as string[]
    : [];

  const sentimentCounts = allReviews.reduce<Record<string, number>>((acc, r) => {
    const s = r.sentiment ?? (r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral');
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const starCounts = [5, 4, 3, 2, 1].map(n => ({
    rating: n,
    count: allReviews.filter(r => Math.round(r.rating) === n).length,
  }));

  const filteredReviews = filter === 'all'
    ? allReviews
    : allReviews.filter(r => {
        const s = r.sentiment ?? (r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral');
        return s === filter;
      });

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            Review Intelligence
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '4px 0 0' }}>
            Sentiment trends, themes, and ratings from App Store and Play Store
          </p>
        </div>
        {selected?.last_scraped_at && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink3)' }}>
            <IconRefresh size={12} />
            Updated {new Date(selected.last_scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>

      {/* Product selector tabs */}
      {products.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {products.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelected(p); setFilter('all'); }}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: '1px solid',
                background: selected?.id === p.id ? 'var(--sage-d)' : 'var(--surface)',
                borderColor: selected?.id === p.id ? 'var(--sage-b)' : 'var(--border)',
                color: selected?.id === p.id ? 'var(--sage)' : 'var(--ink2)',
                fontWeight: selected?.id === p.id ? 600 : 400,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {allReviews.length === 0 && meta.rating == null ? (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <IconDeviceMobile size={32} style={{ color: 'var(--ink3)', display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No review data collected yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            Reviews are collected during intake and refreshed weekly.
            Re-run intake or wait for the next weekly brief cycle.
          </div>
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>

            {/* Overall rating */}
            {meta.rating != null && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Overall rating
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', lineHeight: 1 }}>
                    {meta.rating.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink3)', paddingBottom: 3 }}>/ 5</span>
                </div>
                <StarRow value={meta.rating} />
                {meta.ratingCount != null && (
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                    {meta.ratingCount.toLocaleString()} ratings
                  </div>
                )}
              </div>
            )}

            {/* Sentiment breakdown */}
            {allReviews.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Sentiment
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(['positive', 'negative', 'neutral'] as const).map(s => {
                    const n = sentimentCounts[s] ?? 0;
                    const pct = allReviews.length > 0 ? Math.round((n / allReviews.length) * 100) : 0;
                    const barColor = s === 'positive' ? 'var(--sage)' : s === 'negative' ? 'var(--danger)' : 'var(--ink3)';
                    return (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: barColor, width: 54, textTransform: 'capitalize' }}>{s}</span>
                        <div style={{ flex: 1, height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink3)', width: 30, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Star distribution */}
            {allReviews.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Distribution
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {starCounts.map(({ rating, count }) => (
                    <RatingBar key={rating} rating={rating} count={count} total={allReviews.length} />
                  ))}
                </div>
              </div>
            )}

            {/* Themes */}
            {themes.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Recurring themes
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {themes.map((t, i) => (
                    <span key={i} style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 4,
                      background: 'var(--raised)', border: '1px solid var(--border)',
                      color: 'var(--ink2)',
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI summary callout */}
          {meta.reviewSummary && (
            <div style={{
              background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 10,
              padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <IconMessageCircle size={15} style={{ color: 'var(--sage)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }}>
                {meta.reviewSummary}
              </p>
            </div>
          )}

          {/* Reviews list */}
          {allReviews.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconChartBar size={15} style={{ color: 'var(--sage)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    Reviews ({allReviews.length})
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['all', 'positive', 'neutral', 'negative'] as const).map(s => {
                    const isActive = filter === s;
                    const activeBg =
                      s === 'positive' ? 'var(--sage-d)' :
                      s === 'negative' ? 'var(--danger-d)'  :
                      s === 'neutral'  ? 'var(--raised)' : 'var(--indigo-d)';
                    const activeBorder =
                      s === 'positive' ? 'var(--sage-b)' :
                      s === 'negative' ? 'var(--danger-b)'  :
                      s === 'neutral'  ? 'var(--border2)': 'var(--indigo-b)';
                    const activeColor =
                      s === 'positive' ? 'var(--sage)'   :
                      s === 'negative' ? 'var(--danger)'    :
                      s === 'neutral'  ? 'var(--ink2)'   : 'var(--indigo)';
                    return (
                      <button
                        key={s}
                        onClick={() => setFilter(s)}
                        style={{
                          padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                          border: `1px solid ${isActive ? activeBorder : 'var(--border)'}`,
                          background: isActive ? activeBg : 'var(--surface)',
                          color: isActive ? activeColor : 'var(--ink3)',
                          fontWeight: isActive ? 600 : 400,
                          textTransform: 'capitalize',
                        }}
                      >
                        {s === 'all' ? `All (${allReviews.length})` : `${s} (${sentimentCounts[s] ?? 0})`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredReviews.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {filteredReviews.slice(0, 24).map((r, i) => (
                    <ReviewCard key={i} review={r} />
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink3)', fontSize: 13 }}>
                  No {filter} reviews found.
                </div>
              )}

              {filteredReviews.length > 24 && (
                <div style={{ textAlign: 'center', paddingTop: 16, fontSize: 12, color: 'var(--ink3)' }}>
                  Showing 24 of {filteredReviews.length} reviews
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
