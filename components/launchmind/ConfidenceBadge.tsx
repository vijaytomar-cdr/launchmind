/**
 * @file ConfidenceBadge.tsx
 * @description Confidence indicator for AI recommendations and opportunities.
 *   Always expects 0–100 (normalise at the call site).
 *   Data hazard: Opportunity.confidence is 0.0–1.0 — multiply by 100 before passing.
 *   See LaunchMind Design System §10.2.
 *   Spec: padding 6px 9px, font-weight 800, background var(--violet2)=#efedff, border #d7d0ff.
 */
'use client';

interface ConfidenceBadgeProps {
  /** Always 0–100. Multiply Opportunity.confidence (0.0–1.0) by 100 before passing. */
  value: number;
}

export function ConfidenceBadge({ value }: ConfidenceBadgeProps) {
  const pct  = Math.round(Math.max(0, Math.min(100, value)));
  const band = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';

  return (
    <span
      className="inline-flex items-center gap-1 font-mono tabular-nums"
      style={{
        fontSize: 11,
        fontWeight: 800,
        padding: '6px 9px',
        borderRadius: 'var(--r3)',
        background: 'var(--violet2)',
        border: '1px solid #d7d0ff',
        color: 'var(--ai)',
      }}
    >
      {pct}%{' '}
      <span style={{ fontSize: 10, opacity: 0.7 }}>{band}</span>
    </span>
  );
}
