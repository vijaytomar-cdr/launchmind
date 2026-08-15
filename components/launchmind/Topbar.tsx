/**
 * @file Topbar.tsx
 * @description Dashboard persistent topbar — matches spec fv-topbar design.
 *   THREE elements only: page identity, the company switcher, and one primary
 *   owner action. Search, notifications, "Review product understanding" and
 *   "Update launch context" were permanent buttons here; each moved to where it
 *   belongs rather than being deleted. A toolbar of six controls made this read
 *   as an admin application.
 * @security No secret data. Uses Supabase client-side session only.
 * @dependencies next/navigation, @tabler/icons-react v3, react useState
 */

'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BusinessSwitcher, type BusinessOption } from './BusinessSwitcher';
import {
  IconPlus,
} from '@tabler/icons-react';

// Route → breadcrumb label mapping
const PAGE_LABELS: Record<string, string> = {
  '/dashboard':                              'Owner Command Center',
  '/dashboard/brief':                        'Owner Command Center',
  '/dashboard/opportunities':               'Owner Command Center',
  '/dashboard/approvals':                   'Owner Command Center',
  '/dashboard/missions':                    'Owner Command Center',
  '/dashboard/content':                     'Execution Center',
  '/dashboard/campaigns':                   'Execution Center',
  '/dashboard/calendar':                    'Execution Center',
  '/dashboard/experiments':                 'Execution Center',
  '/dashboard/intelligence/growth-brain':   'Intelligence Center',
  '/dashboard/intelligence/memory':         'Intelligence Center',
  '/dashboard/intelligence/knowledge':      'Intelligence Center',
  '/dashboard/intelligence/market':         'Intelligence Center',
  '/dashboard/channels':                    'Intelligence Center',
  '/dashboard/launch-readiness':            'Intelligence Center',
  '/dashboard/analytics':                   'Analytics',
  '/dashboard/reports':                     'Reports',
  '/dashboard/settings':                    'Settings',
  '/dashboard/products':                    'Products',
  '/dashboard/billing':                     'Billing',
};

function getPageLabel(pathname: string): string {
  // Try exact match first
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  // Try prefix match (longest wins)
  const sorted = Object.keys(PAGE_LABELS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname.startsWith(key)) return PAGE_LABELS[key];
  }
  return 'Owner Command Center';
}

interface TopbarProps {
  plan?: string;
  productName?: string;
  productCount?: number;
  /** Every business the founder may operate. Backs the switcher. */
  businesses?: BusinessOption[];
  activeBusinessId?: string;
  activeBusinessName?: string;
  activeMaturity?: string;
}

/** "AllignX · Home Services App - App Store" → "AllignX" */
function shortName(full: string | undefined): string {
  if (!full) return 'My Product';
  const before = full.split('·')[0].trim();
  return before || full;
}

/** "AllignX · Home Services App - App Store" → "AllignX · Home Services" (drop " - App Store") */
function switcherName(full: string | undefined): string {
  if (!full) return 'My Product';
  const dashIdx = full.indexOf(' - ');
  return dashIdx > -1 ? full.slice(0, dashIdx) : full;
}

export function Topbar({
  plan = 'free', productName, productCount = 1,
  businesses = [], activeBusinessId, activeBusinessName, activeMaturity,
}: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const pageLabel = getPageLabel(pathname);
  const appShortName   = shortName(productName);
  const appSwitchLabel = switcherName(productName);

  const btnBase: CSSProperties = {
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'white',
    color: 'var(--ink)',
    height: 38,
    padding: '0 13px',
    fontWeight: 650,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    flexShrink: 0,
  };

  return (
    <>
      <header style={{
        height: 68,
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        background: 'rgba(255,255,255,.86)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 15,
        flexShrink: 0,
        gap: 9,
      }}>
        {/* Page title — Syne display font, prominent but not oversized for the 68px bar */}
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.3px', whiteSpace: 'nowrap', marginRight: 4 }}>
          {pageLabel}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* THE business switcher. Always interactive — even with one business it
            offers "Add business", which is the only governed way to create one.
            The old control rendered a ⌄ when productCount > 1 and had no
            onClick, so it looked like a switcher and did nothing. */}
        <BusinessSwitcher
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          activeBusinessName={activeBusinessName ?? appSwitchLabel}
          activeProductName={productName}
          activeMaturity={activeMaturity}
        />

        {/* THREE ELEMENTS ONLY: page identity, active company, one owner action.
            Search, Notifications, "Review product understanding" and "Update
            launch context" were permanent header buttons. None of them is
            something an owner needs on every screen, and six controls made the
            command center read as an admin toolbar rather than an operating
            system. Every capability survives — only the persistent placement is
            gone:

              Search                       → /dashboard/ask (Ask LaunchMind)
              Notifications                → Morning Brief · Opportunities · Approvals
              Review product understanding → /onboarding/review, and the product
                                             context area
              Update launch context        → the wizard below, opened from
                                             product context / Growth Brain

            Morning Brief is the right place to raise these when LaunchMind has
            a reason to — "your launch context may be outdated" — rather than
            asking the owner to remember a toolbar exists. */}

        {/* + Start something — the single primary owner action.
            PRESENTATION ONLY. The route, the Mission model, its tables, types
            and APIs are untouched; this is owner language sitting over the
            internal domain language deliberately. */}
        <Link
          href="/dashboard/missions?create=true"
          style={{
            ...btnBase,
            textDecoration: 'none',
            background: 'var(--sage)',
            color: '#fff',
            border: 'none',
            height: 42,
            padding: '0 16px',
            fontWeight: 700,
          }}
        >
          <IconPlus size={14} />
          Start something
        </Link>
      </header>

    </>
  );
}
