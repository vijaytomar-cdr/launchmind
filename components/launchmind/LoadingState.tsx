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
