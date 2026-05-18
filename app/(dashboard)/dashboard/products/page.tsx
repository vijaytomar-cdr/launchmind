/**
 * @file app/(dashboard)/dashboard/products/page.tsx
 * @description Products list page — empty state with CTA to add first product.
 *   Populated in Week 2 when the scraper and confirm flow are complete.
 * @dependencies lib/supabase/server, lib/api
 */

import Link from 'next/link';

export default function ProductsPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Products
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Manage your app products and their ICP briefs
          </p>
        </div>
        <Link
          href="/dashboard/products/new"
          className="rounded-[6px] px-4 py-2 font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          + Add product
        </Link>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: 'var(--raised)' }}
        >
          <svg
            style={{ width: 24, height: 24, color: 'var(--ink3)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
            />
          </svg>
        </div>
        <h3 className="font-semibold mb-2" style={{ fontSize: 15, color: 'var(--ink)' }}>
          No products yet
        </h3>
        <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 340, marginBottom: 24 }}>
          Paste your App Store or Play Store URL to scrape your app&apos;s data and generate an ICP
          brief automatically.
        </p>
        <Link
          href="/dashboard/products/new"
          className="rounded-[6px] px-6 py-2.5 font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
        >
          Add your first product
        </Link>
      </div>
    </div>
  );
}
