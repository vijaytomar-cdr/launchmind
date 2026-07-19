/**
 * @file app/(dashboard)/dashboard/intelligence/layout.tsx
 * @description Shared layout for all Intelligence sub-pages.
 *   Provides a horizontal sub-nav (Growth Brain, Market, Reviews, Ideas, Timeline).
 * @dependencies next/link, next/navigation
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const INTELLIGENCE_TABS = [
  { href: '/dashboard/intelligence/growth-brain', label: 'Growth Brain' },
  { href: '/dashboard/intelligence/memory',       label: 'Memory' },
  { href: '/dashboard/intelligence/knowledge',    label: 'Knowledge Graph' },
  { href: '/dashboard/intelligence/market',       label: 'Market Intelligence' },
  { href: '/dashboard/intelligence/reviews',      label: 'Reviews' },
  { href: '/dashboard/intelligence/ideas',        label: 'Ideas Inbox' },
  { href: '/dashboard/intelligence/timeline',     label: 'Timeline' },
  { href: '/dashboard/intelligence/ai-audit',     label: 'AI Audit' },
];

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen" style={{ background: 'var(--page)' }}>
      {/* Sub-nav */}
      <div
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '0 clamp(16px, 4vw, 32px)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          height: 44,
          overflowX: 'auto',
        }}
      >
        {INTELLIGENCE_TABS.map(tab => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                fontSize: 12.5,
                fontWeight: active ? 600 : 400,
                padding: '5px 10px',
                borderRadius: 5,
                color: active ? 'var(--sage)' : 'var(--ink2)',
                background: active ? 'var(--sage-d)' : 'transparent',
                border: active ? '1px solid var(--sage-b)' : '1px solid transparent',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'all 120ms ease',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
