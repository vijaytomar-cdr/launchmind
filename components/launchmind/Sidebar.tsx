/**
 * @file Sidebar.tsx
 * @description Dashboard sidebar — Architecture Baseline §6 navigation.
 *   Navigation sections: Overview · Work · Execution · Intelligence · Manage
 *   Uses @tabler/icons-react v3 (Icon prefix, not Tb).
 * @security Logout calls supabase.auth.signOut() client-side; cookie cleared by Supabase.
 * @dependencies @supabase/ssr (browser client), @tabler/icons-react, next/link
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  IconLayoutDashboard,
  IconFileText,
  IconSparkles,
  IconMessageCircle,
  IconTarget,
  IconCircleCheck,
  IconChartBar,
  IconEdit,
  IconSpeakerphone,
  IconFlask,
  IconCalendar,
  IconBrain,
  IconWorld,
  IconStar,
  IconBulb,
  IconTimeline,
  IconSettings,
  IconCreditCard,
  IconLayoutGrid,
  IconShieldCheck,
  IconLogout,
} from '@tabler/icons-react';

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  children?: { href: string; label: string }[];
};

type NavSection = {
  section: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/dashboard', label: 'Home', icon: IconLayoutDashboard },
      { href: '/dashboard/brief', label: 'Morning Brief', icon: IconFileText },
      { href: '/dashboard/opportunities', label: 'Opportunities', icon: IconSparkles },
      { href: '/dashboard/ask', label: 'Ask LaunchMind', icon: IconMessageCircle },
    ],
  },
  {
    section: 'Work',
    items: [
      { href: '/dashboard/missions', label: 'Missions', icon: IconTarget },
      { href: '/dashboard/approvals', label: 'Approvals', icon: IconCircleCheck },
      { href: '/dashboard/results', label: 'Results', icon: IconChartBar },
    ],
  },
  {
    section: 'Execution',
    items: [
      { href: '/dashboard/content', label: 'Content Studio', icon: IconEdit },
      { href: '/dashboard/campaigns', label: 'Campaigns', icon: IconSpeakerphone },
      { href: '/dashboard/experiments', label: 'Experiments', icon: IconFlask },
      { href: '/dashboard/calendar', label: 'Calendar', icon: IconCalendar },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      { href: '/dashboard/intelligence/growth-brain', label: 'Growth Brain', icon: IconBrain },
      { href: '/dashboard/intelligence/market', label: 'Market Intelligence', icon: IconWorld },
      { href: '/dashboard/intelligence/reviews', label: 'Reviews', icon: IconStar },
      { href: '/dashboard/intelligence/ideas', label: 'Ideas Inbox', icon: IconBulb },
      { href: '/dashboard/intelligence/timeline', label: 'Timeline', icon: IconTimeline },
    ],
  },
  {
    section: 'Manage',
    items: [
      { href: '/dashboard/products', label: 'Products', icon: IconLayoutGrid },
      { href: '/dashboard/settings', label: 'Settings', icon: IconSettings },
      { href: '/dashboard/billing', label: 'Billing', icon: IconCreditCard },
    ],
  },
];

const TIER_MAX: Record<string, number> = {
  free: 50, solo: 300, builder: 1000, studio: 3000,
};

interface SidebarProps {
  userEmail: string;
  isAdmin?: boolean;
  tokenBalance?: number | null;
  plan?: string;
}

export function Sidebar({ userEmail, isAdmin = false, tokenBalance, plan = 'free' }: SidebarProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const adminActive = pathname.startsWith('/dashboard/admin');

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  function isActive(href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  return (
    <nav
      className="hidden lg:flex w-56 flex-shrink-0 flex-col min-h-screen"
      style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--s-border)' }}
    >
      {/* Logo */}
      <div className="px-5 py-[18px]" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="font-display font-bold" style={{ fontSize: 17, color: '#fff' }}>
          Launch<span style={{ color: 'var(--sage-l)' }}>Mind</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--s-text2)', marginTop: 2 }}>
          AI CMO for App Founders
        </div>
      </div>

      {/* Nav sections */}
      <div className="flex-1 py-2 overflow-y-auto">
        {NAV_SECTIONS.map(({ section, items }) => (
          <div key={section} className="mb-1">
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--s-text3)',
                padding: '8px 20px 3px',
              }}
            >
              {section}
            </div>
            {items.map(({ href, label, icon: Icon, badge, children }) => {
              const active = isActive(href);
              const expanded = !!children && pathname.startsWith(href);
              const navHref = children && children.length > 0 ? children[0].href : href;

              return (
                <div key={href}>
                  <Link
                    href={navHref}
                    className="flex items-center gap-2.5 transition-colors"
                    style={{
                      fontSize: 12.5,
                      paddingLeft: 16,
                      paddingRight: 16,
                      paddingTop: 6,
                      paddingBottom: 6,
                      marginLeft: 4,
                      marginRight: 4,
                      borderRadius: 6,
                      color: active ? '#fff' : 'var(--s-text)',
                      background: active ? 'rgba(5,150,105,0.18)' : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                    }}
                    onMouseLeave={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <Icon
                      size={14}
                      style={{ color: active ? 'var(--sage-l)' : 'var(--s-text2)', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1 }}>{label}</span>
                    {badge && (
                      <span
                        style={{
                          fontSize: 9, fontWeight: 600,
                          padding: '1px 5px', borderRadius: 3,
                          background: 'var(--amber-d)', color: 'var(--amber)',
                          border: '1px solid var(--amber-b)',
                        }}
                      >
                        {badge}
                      </span>
                    )}
                    {active && (
                      <span
                        style={{
                          width: 3, height: 3, borderRadius: '50%',
                          background: 'var(--sage-l)', flexShrink: 0,
                        }}
                      />
                    )}
                  </Link>

                  {/* Sub-items */}
                  {expanded && children && (
                    <div style={{ paddingBottom: 2 }}>
                      {children.map(child => {
                        const childActive = pathname.startsWith(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className="flex items-center transition-colors"
                            style={{
                              fontSize: 11,
                              paddingLeft: 34,
                              paddingRight: 16,
                              paddingTop: 4,
                              paddingBottom: 4,
                              marginLeft: 4,
                              marginRight: 4,
                              borderRadius: 4,
                              color: childActive ? 'var(--sage-l)' : 'var(--s-text2)',
                              background: childActive ? 'rgba(5,150,105,0.10)' : 'transparent',
                            }}
                            onMouseEnter={e => {
                              if (!childActive)
                                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                            }}
                            onMouseLeave={e => {
                              if (!childActive)
                                (e.currentTarget as HTMLElement).style.background = 'transparent';
                            }}
                          >
                            <span
                              style={{
                                width: 3, height: 3, borderRadius: '50%',
                                background: childActive ? 'var(--sage-l)' : 'var(--s-text3)',
                                marginRight: 7, flexShrink: 0, display: 'inline-block',
                              }}
                            />
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Admin */}
      {isAdmin && (
        <div style={{ borderTop: '1px solid var(--s-border)', paddingTop: 2 }}>
          <Link
            href="/dashboard/admin"
            className="flex items-center gap-2.5 transition-colors"
            style={{
              fontSize: 12.5,
              padding: '6px 16px',
              margin: '2px 4px',
              borderRadius: 6,
              color: adminActive ? '#fff' : 'var(--s-text)',
              background: adminActive ? 'rgba(5,150,105,0.18)' : 'transparent',
            }}
            onMouseEnter={e => {
              if (!adminActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={e => {
              if (!adminActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <IconShieldCheck size={14} style={{ color: adminActive ? 'var(--sage-l)' : 'var(--s-text2)' }} />
            Admin
          </Link>
        </div>
      )}

      {/* Token meter */}
      {plan !== 'free' && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--s-border)' }}>
          {(() => {
            const isUnlimited = tokenBalance === null || tokenBalance === undefined;
            const balance = tokenBalance ?? 0;
            const max = TIER_MAX[plan] ?? 300;
            const pct = Math.min(100, Math.round((balance / max) * 100));
            const isLow = !isUnlimited && pct <= 20;
            const barColor = isUnlimited ? 'var(--sage-l)' : isLow ? '#dc2626' : '#d97706';
            return (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 9, color: 'var(--s-text3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Tokens
                  </span>
                  <span className="font-mono" style={{ fontSize: 9, color: isLow ? '#dc2626' : 'var(--s-text2)' }}>
                    {isUnlimited ? '∞' : balance.toLocaleString()}
                  </span>
                </div>
                {!isUnlimited && (
                  <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)' }}>
                    <div
                      style={{
                        width: `${pct}%`, height: '100%',
                        borderRadius: 1, background: barColor,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                )}
                {isLow && (
                  <a
                    href="/dashboard/billing"
                    style={{ display: 'block', marginTop: 4, fontSize: 9, color: '#dc2626', textDecoration: 'none' }}
                  >
                    Low — top up →
                  </a>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--s-border)' }}>
        <p className="truncate mb-2" style={{ fontSize: 10, color: 'var(--s-text2)' }}>
          {userEmail}
        </p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ fontSize: 11, color: 'var(--s-text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <IconLogout size={12} />
          Log out
        </button>
      </div>
    </nav>
  );
}
