/**
 * @file LoadingState.tsx
 * @description Skeleton loader and spinner for async content.
 *   Use <Skeleton> for individual elements, <PageLoading> for full-page.
 */

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  className,
}: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        background: 'var(--raised)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <Skeleton width="60%" height={14} borderRadius={4} />
      <div style={{ marginTop: 8 }}>
        <Skeleton width="100%" height={12} borderRadius={4} />
        <div style={{ marginTop: 4 }}>
          <Skeleton width="80%" height={12} borderRadius={4} />
        </div>
      </div>
    </div>
  );
}

export function PageLoading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ padding: '64px 24px', gap: 12 }}
    >
      <div
        style={{
          width: 24, height: 24, borderRadius: '50%',
          border: '2.5px solid var(--raised)',
          borderTopColor: 'var(--sage)',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{message}</span>
    </div>
  );
}

/** Shared in-content loading state for Content Studio index and review routes. */
export function ContentStudioLoading({ message }: { message: string }) {
  return (
    <section role="status" aria-live="polite" style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(20px,3vw,32px)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 24, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink2)' }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, border: '2px solid var(--border)',
          borderTopColor: 'var(--sage)', borderRadius: '50%', display: 'inline-block', animation: 'lm-spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 14 }}>{message}</span>
      </div>
    </section>
  );
}
