/**
 * @file ReadinessCard.tsx
 * @description "Before I create this" — the compact readiness summary, §8.
 *
 *   THE UX FAILURE THIS FIXES. The previous version put ten large screenshot
 *   authorization cards and a brand editor directly on the Content Intelligence
 *   page. The owner's reaction was "I don't know what to do", and that is the
 *   correct reaction: a decision surface had become an administration console,
 *   and the actual recommendation was pushed below a wall of controls.
 *
 *   The capability is unchanged — it moved. This card states what is settled,
 *   what is outstanding, and how many items each thing needs, with one route
 *   into each review. Content Intelligence goes back to answering "what should
 *   we market, and why".
 *
 *   WHAT IS SATISFIED IS SHOWN TOO. A list of only problems reads as failure and
 *   hides the fact that LaunchMind already understands the product. Ticks are
 *   not decoration; they are the reason the owner can trust the warnings.
 *
 * @security Presentation only. Every count comes from the owner-safe read
 *   models; nothing here confirms, allows or grants anything.
 * @dependencies lib/design-system/typography
 */

'use client';

import * as T from '@/lib/design-system/typography';
import { Button } from '@/components/launchmind/Button';

export interface ReadinessItem {
  key: string;
  label: string;
  /** Settled, or the short reason it is not. */
  detail: string;
  satisfied: boolean;
  /** Absent when there is nothing for the owner to open. */
  onReview?: () => void;
  reviewLabel?: string;
  /** Offer the review even when the item is satisfied, so a decision is revisable. */
  alwaysOfferReview?: boolean;
}

export function ReadinessCard({ items, onFinishSetup }: {
  items: ReadinessItem[]; onFinishSetup?: () => void;
}) {
  if (items.length === 0) return null;
  const outstanding = items.filter(i => !i.satisfied);

  return (
    <section style={T.card} aria-labelledby="rc-title">
      <div id="rc-title" style={{ ...T.eyebrow,
        color: outstanding.length === 0 ? 'var(--sage)' : 'var(--amber)' }}>
        {outstanding.length === 0 ? 'Ready to create'
          : `${outstanding.length} thing${outstanding.length === 1 ? '' : 's'} needed`}
      </div>
      <p style={{ ...T.bodyStrong, margin: '6px 0 0' }}>
        {outstanding.length === 0
          ? items.map(i => `${i.label} ✓`).join(' · ')
          : outstanding.map(i => i.detail).join(' · ')}
      </p>

      <details style={{ marginTop: 10 }}>
        <summary style={{ ...T.meta, cursor: 'pointer', color: 'var(--sage)', fontWeight: 650 }}>
          Review inputs →
        </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {items.map(i => (
          <div key={i.key} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 10px', borderRadius: 10,
            background: i.satisfied ? 'transparent' : 'var(--raised)',
            border: `1px solid ${i.satisfied ? 'transparent' : 'var(--border)'}`,
          }}>
            {/* A symbol, never colour alone. */}
            <span aria-hidden style={{
              width: 16, textAlign: 'center', fontSize: 13,
              color: i.satisfied ? 'var(--sage)' : 'var(--amber)',
            }}>{i.satisfied ? '✓' : '!'}</span>
            <span style={{ ...T.bodyStrong, minWidth: 116 }}>{i.label}</span>
            <span style={{ ...T.body, flex: 1, minWidth: 150 }}>{i.detail}</span>
            {(!i.satisfied || i.alwaysOfferReview) && i.onReview && (
              <button type="button" onClick={i.onReview}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 650, color: 'var(--sage)',
                }}>
                {i.reviewLabel ?? 'Review'} →
              </button>
            )}
          </div>
        ))}
      </div>
      </details>

      {outstanding.length > 0 && onFinishSetup && (
        <div style={{ marginTop: 14 }}>
          <Button onClick={onFinishSetup}>Finish setup →</Button>
          <p style={{ ...T.meta, margin: '8px 0 0' }}>
            {outstanding.length} thing{outstanding.length === 1 ? '' : 's'} to sort out.
            None of this publishes anything.
          </p>
        </div>
      )}
    </section>
  );
}
