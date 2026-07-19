/**
 * @file AIBadge.tsx
 * @description AI provenance marker — carried by every AI-generated artifact.
 *   Uses the violet --ai accent exclusively. Forbidden on non-AI content.
 *   See LaunchMind Design System §10.1.
 */
'use client';

import { IconSparkles } from '@tabler/icons-react';

interface AIBadgeProps {
  label?: string;
}

export function AIBadge({ label = 'AI generated' }: AIBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 font-medium"
      style={{
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 'var(--r3)',
        background: 'var(--ai-d)',
        border: '1px solid var(--ai-b)',
        color: 'var(--ai)',
      }}
    >
      <IconSparkles size={10} />
      {label}
    </span>
  );
}
