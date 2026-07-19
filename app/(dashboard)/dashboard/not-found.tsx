/**
 * @file app/(dashboard)/dashboard/not-found.tsx
 * @description 404 handler for unknown dashboard routes.
 */
import Link from 'next/link';
import { IconArrowLeft } from '@tabler/icons-react';

export default function DashboardNotFound() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <p className="text-[32px] font-display font-semibold text-ink mb-2">404</p>
      <p className="text-[14px] font-medium text-ink mb-1">Page not found</p>
      <p className="text-[13px] text-ink2 mb-6">This section doesn&apos;t exist yet.</p>
      <Link
        href="/dashboard/brief"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white
                   text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
      >
        <IconArrowLeft size={13} /> Back to home
      </Link>
    </div>
  );
}
