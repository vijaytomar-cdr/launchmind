/**
 * @file components/launchmind/ErrorState.tsx
 * @description Third member of the state trio (Loading / Empty / Error).
 *   Every data-fetching screen must render exactly one of the three.
 *   Never surface raw error strings — log to Sentry, show human message.
 */
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

interface ErrorStateProps {
  title?:   string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title   = "Couldn't load this",
  message = 'Something went wrong on our side. Your data is safe.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6
                    bg-surface border border-[var(--border)] rounded-[var(--r)]">
      <div className="w-10 h-10 rounded-full bg-[var(--danger-d)] border border-[var(--danger-b)]
                      flex items-center justify-center mb-3">
        <IconAlertTriangle size={18} color="var(--danger)" />
      </div>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="text-[13px] text-ink2 mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white
                     text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
        >
          <IconRefresh size={13} /> Try again
        </button>
      )}
    </div>
  );
}
