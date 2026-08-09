/**
 * @file EvidenceChips.tsx
 * @description Evidence chips for AI recommendations and opportunities.
 *   Accepts unknown (jsonb) and coerces safely via toStringArray.
 *   Shows max 3 chips + "+N more" overflow.
 *   See LaunchMind Design System §10.3.
 *   Spec: neutral raised/border/ink2 palette — NOT violet. Padding 6px 9px.
 * @dependencies lib/coerce.ts
 */
'use client';

import { toStringArray } from '@/lib/coerce';

interface EvidenceChipsProps {
  /** jsonb value — may be string[], JSON string, object, or null. Always coerced. */
  chips: unknown;
  max?: number;
}

export function EvidenceChips({ chips, max = 3 }: EvidenceChipsProps) {
  const items = toStringArray(chips);
  if (items.length === 0) return null;

  const visible  = items.slice(0, max);
  const overflow = items.length - max;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center"
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '6px 9px',
            borderRadius: 'var(--r3)',
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            color: 'var(--ink2)',
          }}
        >
          {c}
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            fontSize: 11,
            padding: '6px 9px',
            borderRadius: 'var(--r3)',
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            color: 'var(--ink3)',
          }}
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
}
