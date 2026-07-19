/**
 * @file OpportunityCard.tsx
 * @description Opportunity display — title, evidence, confidence score,
 *   expected impact, and accept/dismiss actions.
 *   Used in Opportunities page and Home dashboard.
 */

'use client';

interface OpportunityCardProps {
  id: string;
  title: string;
  description?: string;
  opportunityType: 'quick_win' | 'strategic' | 'defensive' | 'experimental';
  confidence?: number; // 0–1
  expectedImpact?: { metric: string; delta: string; timeline: string };
  effort?: 'low' | 'medium' | 'high';
  onAccept?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

const typeLabel: Record<string, string> = {
  quick_win:    'Quick win',
  strategic:    'Strategic',
  defensive:    'Defensive',
  experimental: 'Experimental',
};

const typeStyle: Record<string, { bg: string; border: string; color: string }> = {
  quick_win:    { bg: 'var(--sage-d)', border: 'var(--sage-b)', color: 'var(--sage)' },
  strategic:    { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)' },
  defensive:    { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)' },
  experimental: { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink2)' },
};

const effortLabel: Record<string, string> = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };

export function OpportunityCard({
  id, title, description, opportunityType, confidence, expectedImpact, effort, onAccept, onDismiss,
}: OpportunityCardProps) {
  const ts = typeStyle[opportunityType] ?? typeStyle.experimental;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span
          style={{
            fontSize: 10, fontWeight: 500, padding: '3px 7px',
            borderRadius: 4, border: `1px solid ${ts.border}`,
            background: ts.bg, color: ts.color, flexShrink: 0,
          }}
        >
          {typeLabel[opportunityType]}
        </span>
        {effort && (
          <span style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>
            {effortLabel[effort]}
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 10, lineHeight: 1.5 }}>
          {description}
        </div>
      )}

      {/* Impact + confidence */}
      {(expectedImpact || confidence !== undefined) && (
        <div className="flex items-center gap-4 mb-10" style={{ marginBottom: 10 }}>
          {expectedImpact && (
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
              {expectedImpact.delta} {expectedImpact.metric}
              {' '}in {expectedImpact.timeline}
            </span>
          )}
          {confidence !== undefined && (
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink3)' }}>
              {Math.round(confidence * 100)}% confidence
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      {(onAccept || onDismiss) && (
        <div className="flex items-center gap-2">
          {onAccept && (
            <button
              onClick={() => onAccept(id)}
              style={{
                fontSize: 12, fontWeight: 500, padding: '5px 12px',
                background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
                color: 'var(--sage)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Accept
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(id)}
              style={{
                fontSize: 12, color: 'var(--ink3)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '5px 8px',
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
