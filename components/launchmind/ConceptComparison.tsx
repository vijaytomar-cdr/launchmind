/**
 * @file ConceptComparison.tsx
 * @description Side-by-side concept comparison — Phase 3.5B6.8 §19.
 *
 *   WHAT THIS DELIBERATELY DOES NOT DO. There is no winner, no score, no
 *   predicted click-through, no "AI pick" and no ranking. LaunchMind has never
 *   executed any of these creatives, so it knows exactly nothing about which
 *   will work — and a comparison view is precisely where that ignorance is
 *   most tempting to paper over with a badge. The owner chooses.
 *
 *   WHAT IT SHOWS is the thing an owner actually needs to choose between: what
 *   each version is ARGUING. Hook, message, where the product sits, the call to
 *   action, and why LaunchMind built it that way. Two versions with the same
 *   answer to those questions are not a choice, which is why the set-level
 *   distinctness check exists upstream.
 *
 *   RESPONSIVE BY STRUCTURE, not by hiding things. Wide viewports get columns;
 *   narrow ones get the same content stacked, because a comparison that
 *   requires horizontal scrolling on a phone is a comparison nobody makes.
 *
 * @security Renders only the owner-safe workbench read model. No status enum,
 *   version id, workspace id or model name reaches the page.
 * @dependencies lib/api types, design tokens
 */

'use client';

import { useState } from 'react';
import type { WorkbenchArtifact } from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import * as T from '@/lib/design-system/typography';

/** Owner-facing status. The lifecycle enum never reaches the browser. */
function statusWords(a: WorkbenchArtifact): { label: string; tone: 'ready' | 'attention' } {
  if (a.status === 'OWNER_CONFIRMATION_REQUIRED') {
    return { label: 'Needs you', tone: 'attention' };
  }
  if (a.status === 'ELIGIBLE_FOR_CONTENT_APPROVAL' || a.status === 'CONTENT_APPROVED') {
    return { label: 'Copy ready for your review', tone: 'ready' };
  }
  return { label: 'Wording needs refinement', tone: 'attention' };
}

function firstString(content: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = content[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function strategyFor(label: string | null) {
  if (/product demonstration/i.test(label ?? '')) return {
    role: 'Product demonstration', product: 'Dominant', difference: 'Leads with what the product does.',
    hypothesis: 'Immediate product clarity may reduce comprehension friction.',
  };
  if (/relief/i.test(label ?? '')) return {
    role: 'Relief', product: 'Supporting', difference: 'Leads with the calmer direction.',
    hypothesis: 'A hedged relief frame may create emotional relevance without promising an outcome.',
  };
  return {
    role: 'Problem recognition', product: 'Secondary reveal', difference: 'Leads with audience recognition before the product.',
    hypothesis: 'Recognising the problem may create a reason to stop and keep reading.',
  };
}

function channelName(channel: string): string {
  return /video/.test(channel) ? 'SHORT VIDEO' : /meta/.test(channel) ? 'META' : channel.replace(/_/g, ' ').toUpperCase();
}

const cell: React.CSSProperties = {
  fontSize: 13, color: 'var(--ink)', lineHeight: 1.5,
};
const rowLabel: React.CSSProperties = {
  ...T.eyebrow, color: 'var(--ink3)', marginBottom: 4,
};

/** One row of the comparison, for one concept. */
function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={rowLabel}>{title}</div>
      <div style={cell}>{children}</div>
    </div>
  );
}

export function ConceptComparison({
  artifacts, onOpen, onClose,
}: {
  artifacts: WorkbenchArtifact[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  // Below the breakpoint the columns stack; a tab strip keeps the comparison
  // usable at 390 without horizontal overflow.
  const [focused, setFocused] = useState<string | null>(null);

  if (artifacts.length < 2) {
    return (
      <section style={T.card} aria-labelledby="cmp-none">
        <h2 id="cmp-none" style={{ ...T.sectionTitle, margin: 0 }}>Nothing to compare yet</h2>
        <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>
          There is only one version of this so far, so there is nothing to set beside it.
        </p>
        <div style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={onClose}>Back to review</Button>
        </div>
      </section>
    );
  }

  const shown = focused ? artifacts.filter(a => a.id === focused) : artifacts;

  return (
    <section style={T.card} aria-labelledby="cmp-heading">
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline',
        justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h2 id="cmp-heading" style={{ ...T.sectionTitle, margin: 0 }}>
          Compare concepts
        </h2>
        <Button variant="ghost" onClick={onClose}>Back to review</Button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>
        These test different hypotheses for the same objective. LaunchMind recommends
        testing Problem recognition first as the strongest current hypothesis—not a known winner.
        No concept has first-party performance yet.
      </p>

      {/* Tab strip. Visible only below the stacking breakpoint. */}
      <div className="lg:hidden" style={{ display: 'flex', gap: 6, flexWrap: 'wrap',
        marginTop: 14 }} role="tablist" aria-label="Choose a version to view">
        <button type="button" role="tab" aria-selected={focused === null}
          onClick={() => setFocused(null)}
          style={{ ...T.pill, cursor: 'pointer',
            background: focused === null ? 'var(--sage-d)' : 'var(--raised)',
            borderColor: focused === null ? 'var(--sage-b)' : 'var(--border)',
            color: focused === null ? 'var(--sage)' : 'var(--ink2)' }}>
          All
        </button>
        {artifacts.map(a => (
          <button key={a.id} type="button" role="tab" aria-selected={focused === a.id}
            onClick={() => setFocused(a.id)}
            style={{ ...T.pill, cursor: 'pointer',
              background: focused === a.id ? 'var(--sage-d)' : 'var(--raised)',
              borderColor: focused === a.id ? 'var(--sage-b)' : 'var(--border)',
              color: focused === a.id ? 'var(--sage)' : 'var(--ink2)' }}>
            {a.variantLabel ?? 'Concept'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 14, marginTop: 16,
        gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))` }}>
        {shown.map(a => {
          const s = statusWords(a);
          const strategy = strategyFor(a.variantLabel);
          const headline = firstString(a.content, ['headline', 'h1', 'hook', 'title']);
          const body = firstString(a.content, ['primaryText', 'body', 'subhead', 'description']);
          return (
            <article key={a.id} style={{ ...T.innerBlock, display: 'flex',
              flexDirection: 'column' }} aria-label={a.variantLabel ?? 'Version'}>
              <h3 style={{ ...T.cardTitle, margin: '0 0 2px' }}>
                <span style={{ display: 'block', ...T.eyebrow, marginBottom: 5 }}>{channelName(a.channel)}</span>
                {a.variantLabel ?? 'Concept'}
              </h3>
              <div style={{ marginBottom: 12 }}>
                <span style={{ ...T.pill, display: 'inline-block',
                  background: s.tone === 'ready' ? 'var(--sage-d)' : 'var(--amber-d)',
                  borderColor: s.tone === 'ready' ? 'var(--sage-b)' : 'var(--amber-b)',
                  color: s.tone === 'ready' ? 'var(--sage)' : 'var(--amber)' }}>
                  {/* Symbol AND word — never colour alone. */}
                  {s.tone === 'ready' ? '✓ ' : '! '}{s.label}
                </span>
              </div>

              {headline && <Field title="Hook">{headline}</Field>}
              <Field title="Visual thesis">{strategy.difference}</Field>
              {body && <Field title="Message">{body}</Field>}

              {a.whyCreated.length > 0 && (
                <Field title="Why LaunchMind made this one">
                  {a.whyCreated[0]}
                </Field>
              )}
              {a.status === 'OWNER_CONFIRMATION_REQUIRED' && a.needsAttention.length > 0 && (
                <Field title="What needs you">
                  <span style={{ color: 'var(--amber)' }}>{a.needsAttention[0]}</span>
                </Field>
              )}

              <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                <Button variant="ghost" onClick={() => onOpen(a.id)}>
                  Review this concept
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
