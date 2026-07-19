/**
 * @file ApprovalCard.tsx
 * @description Unified approval queue item. Covers all approval types:
 *   campaign, content_asset, experiment, video, voice, store_update.
 *   Used in the /dashboard/approvals unified queue page.
 * @security Approval actions must call backend approve endpoint —
 *   never update local state only. campaigns.approved_at is the source of truth.
 */

'use client';

type ApprovalType = 'campaign' | 'content_asset' | 'experiment' | 'video' | 'voice' | 'store_update';

interface ApprovalCardProps {
  id: string;
  type: ApprovalType;
  title: string;
  preview?: string;
  context?: string;
  channel?: string;
  market?: 'usa' | 'india';
  spend?: string;
  onApprove: (id: string, type: ApprovalType) => void;
  onReject: (id: string, type: ApprovalType) => void;
  loading?: boolean;
}

const typeLabel: Record<ApprovalType, string> = {
  campaign:     'Campaign',
  content_asset:'Content',
  experiment:   'Experiment',
  video:        'Video',
  voice:        'Voice note',
  store_update: 'Store update',
};

const typeStyle: Record<ApprovalType, { bg: string; border: string; color: string }> = {
  campaign:     { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)' },
  content_asset:{ bg: 'var(--sage-d)', border: 'var(--sage-b)', color: 'var(--sage)' },
  experiment:   { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink2)' },
  video:        { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)' },
  voice:        { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)' },
  store_update: { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)' },
};

export function ApprovalCard({
  id, type, title, preview, context, channel, market, spend, onApprove, onReject, loading,
}: ApprovalCardProps) {
  const ts = typeStyle[type];

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1.5px solid var(--amber-b)',
        borderRadius: 10,
        padding: '14px 16px',
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 150ms ease',
      }}
    >
      {/* Meta row */}
      <div className="flex items-center gap-2 mb-3">
        <span
          style={{
            fontSize: 10, fontWeight: 500, padding: '3px 7px',
            borderRadius: 4, border: `1px solid ${ts.border}`,
            background: ts.bg, color: ts.color,
          }}
        >
          {typeLabel[type]}
        </span>
        {channel && (
          <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'capitalize' }}>
            {channel}
          </span>
        )}
        {market && (
          <span
            style={{
              fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4,
              background: market === 'usa' ? 'var(--sage-d)' : 'var(--amber-d)',
              border: market === 'usa' ? '1px solid var(--sage-b)' : '1px solid var(--amber-b)',
              color: market === 'usa' ? '#046c4e' : '#92400e',
            }}
          >
            {market === 'usa' ? 'USA' : 'India'}
          </span>
        )}
        {spend && (
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink2)', marginLeft: 'auto' }}>
            {spend}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{title}</div>
      {preview && (
        <div
          style={{
            fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5,
            background: 'var(--raised)', borderRadius: 6, padding: '8px 10px',
            marginBottom: 8, whiteSpace: 'pre-wrap',
          }}
        >
          {preview}
        </div>
      )}
      {context && (
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10 }}>{context}</div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onApprove(id, type)}
          disabled={loading}
          style={{
            fontSize: 12, fontWeight: 500, padding: '6px 14px',
            background: 'var(--sage)', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Approve
        </button>
        <button
          onClick={() => onReject(id, type)}
          disabled={loading}
          style={{
            fontSize: 12, fontWeight: 500, padding: '6px 12px',
            background: 'none', color: 'var(--ink2)',
            border: '1px solid var(--border2)', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
