/**
 * @file MetricCard.tsx
 * @description Single KPI display block — value, label, optional delta trend.
 *   Used in Home dashboard, Results page, Growth Brain.
 *   Uses DM Mono for values (CLAUDE.md §6.2).
 */

interface MetricCardProps {
  label: string;
  value: string | number;
  /** e.g. "+12%" or "-3%" — auto-colours green/red */
  delta?: string;
  /** Secondary context line */
  sub?: string;
  /** Tailwind / inline accent color key */
  accent?: 'sage' | 'indigo' | 'amber' | 'danger';
  /** LaunchMind's interpretation of this metric. Renders in violet (AI provenance). */
  insight?:    string;
  /** 0–100 confidence in the insight. Only shown if insight is provided. */
  confidence?: number;
}

const accentColor: Record<string, string> = {
  sage:   'var(--sage)',
  indigo: 'var(--indigo)',
  amber:  'var(--amber)',
  danger: 'var(--danger)',
};

export function MetricCard({ label, value, delta, sub, accent, insight, confidence }: MetricCardProps) {
  const isPositive = delta?.startsWith('+');
  const isNegative = delta?.startsWith('-');

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink3)',
          marginBottom: 6,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div className="flex items-end gap-2">
        <div
          className="font-mono font-medium"
          style={{
            fontSize: 22,
            color: accent ? accentColor[accent] : 'var(--ink)',
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        {delta && (
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: isPositive ? 'var(--sage)' : isNegative ? 'var(--danger)' : 'var(--ink3)',
              marginBottom: 1,
            }}
          >
            {delta}
          </div>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
          {sub}
        </div>
      )}
      {insight && (
        <div
          className="mt-2 pt-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p
            style={{
              fontSize: 12,
              color: 'var(--ai)',
              lineHeight: 1.5,
            }}
          >
            {insight}
          </p>
          {confidence != null && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 'var(--r3)',
                  background: 'var(--ai-d)',
                  border: '1px solid var(--ai-b)',
                  color: 'var(--ai)',
                  fontFamily: 'DM Mono, monospace',
                }}
              >
                {Math.round(confidence)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
