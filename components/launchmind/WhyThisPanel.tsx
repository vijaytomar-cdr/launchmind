/**
 * @file WhyThisPanel.tsx
 * @description Expandable explainer panel for AI recommendations, opportunities,
 *   and generated assets. Collapsed by default (progressive disclosure).
 *   Spec: neutral raised/border palette — violet is reserved for AIBadge and ConfidenceBadge only.
 *   See LaunchMind Design System §10.4.
 * @dependencies EvidenceChips, ConfidenceBadge
 */
'use client';

import { useState } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { EvidenceChips } from './EvidenceChips';
import { ConfidenceBadge } from './ConfidenceBadge';

interface WhyThisPanelProps {
  signal?:     string;
  evidence?:   unknown;
  /** 0–100 (already normalised) */
  confidence?: number;
  risk?:       string;
  source?:     string;
  defaultOpen?: boolean;
}

export function WhyThisPanel({
  signal,
  evidence,
  confidence,
  risk,
  source,
  defaultOpen = false,
}: WhyThisPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const hasContent = signal || evidence || confidence != null || risk || source;
  if (!hasContent) return null;

  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--raised)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left px-3 py-2
                   transition-colors hover:bg-black/[0.03]"
        style={{ fontSize: 12, color: 'var(--ink2)', fontWeight: 500 }}
      >
        <span>Why this</span>
        {open ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
      </button>

      {open && (
        <div
          className="px-3 pb-3 space-y-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {signal && (
            <Row label="Signal">
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{signal}</span>
            </Row>
          )}
          {Boolean(evidence) && (
            <Row label="Evidence">
              <EvidenceChips chips={evidence} />
            </Row>
          )}
          {confidence != null && (
            <Row label="Confidence">
              <ConfidenceBadge value={confidence} />
            </Row>
          )}
          {risk && (
            <Row label="Risk">
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{risk}</span>
            </Row>
          )}
          {source && (
            <Row label="Source">
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{source}</span>
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 pt-2">
      <span
        style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 500, minWidth: 72 }}
      >
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
