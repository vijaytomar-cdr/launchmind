/**
 * @file app/(dashboard)/dashboard/settings/page.tsx
 * @description Settings hub — links to billing and account sub-pages.
 */

import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
        Settings
      </h1>
      <p className="mb-8" style={{ fontSize: 13, color: 'var(--ink2)' }}>
        Account settings and billing management.
      </p>

      <div className="space-y-3">
        <Link
          href="/dashboard/settings/billing"
          className="flex items-center justify-between rounded-[10px] px-5 py-4 transition-colors"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div>
            <p className="font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>
              Billing &amp; plan
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
              Manage your subscription, upgrade, or cancel.
            </p>
          </div>
          <span style={{ color: 'var(--ink3)', fontSize: 18 }}>→</span>
        </Link>
      </div>
    </div>
  );
}
