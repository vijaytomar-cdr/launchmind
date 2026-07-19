/**
 * @file MissionCard.tsx
 * @description Mission list item — objective, status badge, confidence,
 *   progress bar, and primary action. Used in Missions + Home.
 */

import Link from 'next/link';

type MissionStatus = 'planning' | 'active' | 'awaiting_approval' | 'executing' | 'paused' | 'completed' | 'cancelled';

interface MissionCardProps {
  id: string;
  title: string;
  objective: string;
  status: MissionStatus;
  confidence?: number; // 0–1
  progress?: number;   // 0–100
  targetMetric?: string;
  href?: string;
}

const statusLabel: Record<MissionStatus, string> = {
  planning:          'Planning',
  active:            'Active',
  awaiting_approval: 'Needs approval',
  executing:         'Executing',
  paused:            'Paused',
  completed:         'Completed',
  cancelled:         'Cancelled',
};

const statusStyle: Record<MissionStatus, { bg: string; border: string; color: string }> = {
  planning:          { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink2)' },
  active:            { bg: 'var(--sage-d)', border: 'var(--sage-b)', color: 'var(--sage)' },
  awaiting_approval: { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)' },
  executing:         { bg: 'var(--sage-d)', border: 'var(--sage-b)', color: 'var(--sage)' },
  paused:            { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)' },
  completed:         { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)' },
  cancelled:         { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink3)' },
};

export function MissionCard({
  id,
  title,
  objective,
  status,
  confidence,
  progress,
  targetMetric,
  href,
}: MissionCardProps) {
  const st = statusStyle[status];

  const inner = (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        cursor: href ? 'pointer' : 'default',
        transition: 'border-color 150ms ease',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{objective}</div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: '3px 8px',
            borderRadius: 4,
            border: `1px solid ${st.border}`,
            background: st.bg,
            color: st.color,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {statusLabel[status]}
        </span>
      </div>

      {/* Progress bar */}
      {progress !== undefined && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 3, background: 'var(--raised)', borderRadius: 2 }}>
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: progress === 100 ? 'var(--indigo)' : 'var(--sage)',
                borderRadius: 2,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-4">
        {targetMetric && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
            Target: <span style={{ color: 'var(--ink2)' }}>{targetMetric}</span>
          </span>
        )}
        {confidence !== undefined && (
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink3)' }}>
            {Math.round(confidence * 100)}% confidence
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{inner}</Link>;
  }
  return inner;
}
