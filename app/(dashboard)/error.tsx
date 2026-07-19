/**
 * @file app/(dashboard)/error.tsx
 * @description Error boundary for the dashboard route group.
 *   Catches unhandled errors in dashboard segments and renders ErrorState.
 *   Prevents any dashboard page from blanking on a runtime error.
 */
'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/launchmind/ErrorState';

export default function DashboardError({
  error,
  reset,
}: {
  error:  Error & { digest?: string };
  reset:  () => void;
}) {
  useEffect(() => {
    // Log to Sentry when available (replace console.error in production)
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ErrorState
        title="Something went wrong"
        message="LaunchMind hit an unexpected error. Your data is safe."
        onRetry={reset}
      />
    </div>
  );
}
