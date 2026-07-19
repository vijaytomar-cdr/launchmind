'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/page.tsx
 * @description Entry point for Intake V3 5-step wizard.
 *   Checks sessionStorage for a partially completed intake and redirects to the
 *   correct step. Otherwise renders the setup entry card.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus, IconArrowRight, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';

const SETUP_STORAGE_KEY = 'lm_setup_v3';

export default function SetupEntryPage() {
  const router = useRouter();

  useEffect(() => {
    const saved = sessionStorage.getItem(SETUP_STORAGE_KEY);
    if (saved) {
      try {
        const { productId, step } = JSON.parse(saved) as { productId: string; step: number };
        if (productId && step >= 1 && step <= 5) {
          const stepRoutes: Record<number, string> = {
            1: 'basics', 2: 'business', 3: 'audience', 4: 'brand', 5: 'connect',
          };
          router.replace(`/dashboard/products/setup/${stepRoutes[step] ?? 'basics'}?resume=${productId}`);
          return;
        }
      } catch {
        sessionStorage.removeItem(SETUP_STORAGE_KEY);
      }
    }
  }, [router]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl">
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
          Add a product
        </h1>
        <p style={{ color: 'var(--ink2)', fontSize: 14, marginBottom: 32 }}>
          Choose how you want to set up your product.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Manual setup — Intake V3 */}
          <Link href="/dashboard/products/setup/basics">
            <div
              style={{
                background: 'var(--surface)',
                border: '1.5px solid var(--sage-b)',
                borderRadius: 'var(--r)',
                padding: '20px 20px',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
              className="hover:shadow-md"
            >
              <div
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <IconPlus size={20} color="var(--sage)" />
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                Set up manually
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
                Enter your product details directly — no store URL required.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 16, color: 'var(--sage)', fontSize: 13, fontWeight: 500 }}>
                Start <IconArrowRight size={14} />
              </div>
            </div>
          </Link>

          {/* URL scraping — existing 7-step wizard */}
          <Link href="/dashboard/products/new">
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r)',
                padding: '20px 20px',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
              className="hover:shadow-md"
            >
              <div
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: 'var(--raised)', border: '1px solid var(--border2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <IconSearch size={20} color="var(--ink2)" />
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                Import from store
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
                Paste your App Store or Play Store URL to auto-fill product details.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 16, color: 'var(--ink2)', fontSize: 13, fontWeight: 500 }}>
                Start <IconArrowRight size={14} />
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
