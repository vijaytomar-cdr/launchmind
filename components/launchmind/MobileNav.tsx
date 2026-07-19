/**
 * @file components/launchmind/MobileNav.tsx
 * @description Bottom tab bar for mobile (< lg). Shows 5 primary actions.
 *   Hidden on lg+ screens where the full sidebar is shown.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconSun,
  IconCircleCheck,
  IconMessageCircle,
  IconSpeakerphone,
  IconDots,
} from '@tabler/icons-react';

const ITEMS = [
  { href: '/dashboard/brief',     icon: IconSun,          label: 'Brief' },
  { href: '/dashboard/approvals', icon: IconCircleCheck,  label: 'Approvals' },
  { href: '/dashboard/ask',       icon: IconMessageCircle,label: 'Ask' },
  { href: '/dashboard/campaigns', icon: IconSpeakerphone, label: 'Campaigns' },
  { href: '/dashboard/products',  icon: IconDots,         label: 'More' },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="grid lg:hidden fixed bottom-0 inset-x-0 z-40 border-t"
      style={{
        background: 'var(--sidebar)',
        borderColor: 'rgba(255,255,255,0.1)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        gridTemplateColumns: 'repeat(5, 1fr)',
      }}
    >
      {ITEMS.map(({ href, icon: Icon, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-0.5 py-2 transition-colors"
            style={{
              fontSize: 10,
              color: active ? 'var(--sage-l)' : 'rgba(255,255,255,0.55)',
            }}
          >
            <Icon size={19} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
