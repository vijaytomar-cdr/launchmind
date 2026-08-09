/**
 * @file Sidebar.tsx
 * @description Dashboard sidebar — matches LaunchMind_Production_UX_July18_2026(15) spec exactly.
 *   Navigation sections: COMMAND · EXECUTION · INTELLIGENCE · SYSTEM
 *   Background: dark forest-green gradient linear-gradient(180deg,var(--nav),#10201c)
 *   Uses @tabler/icons-react v3 (Icon prefix, not Tb).
 * @security Logout calls supabase.auth.signOut() client-side; cookie cleared by Supabase.
 * @dependencies @supabase/ssr (browser client), @tabler/icons-react, next/link
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  IconSunrise,
  IconBulb,
  IconChecklist,
  IconRoute,
  IconPalette,
  IconSpeakerphone,
  IconFlask,
  IconCalendar,
  IconBrain,
  IconChartBar,
  IconSettings,
  IconShieldCheck,
  IconDatabase,
  IconNetwork,
  IconBolt,
  IconRocket,
} from '@tabler/icons-react';

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
};

type NavSection = {
  section: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    section: 'COMMAND',
    items: [
      { href: '/dashboard/brief',         label: 'Morning Brief',      icon: IconSunrise },
      { href: '/dashboard/opportunities', label: 'Opportunities',      icon: IconBulb },
      { href: '/dashboard/approvals',     label: 'Approvals',          icon: IconChecklist },
      { href: '/dashboard/missions',      label: 'Missions',           icon: IconRoute },
    ],
  },
  {
    section: 'EXECUTION',
    items: [
      { href: '/dashboard/content',     label: 'Content Studio', icon: IconPalette },
      { href: '/dashboard/campaigns',   label: 'Campaigns',      icon: IconSpeakerphone },
      { href: '/dashboard/calendar',    label: 'Calendar',       icon: IconCalendar },
      { href: '/dashboard/experiments', label: 'Experiments',    icon: IconFlask },
    ],
  },
  {
    section: 'INTELLIGENCE',
    items: [
      { href: '/dashboard/intelligence/growth-brain', label: 'Growth Brain',       icon: IconBrain },
      // No badge: a static count would imply LaunchMind has N sources ready to
      // connect. Availability is decided by the server (GET /connections/providers).
      { href: '/dashboard/channels',                  label: 'Improve Intelligence', icon: IconBolt },
      { href: '/dashboard/intelligence/market',       label: 'Market Intelligence',icon: IconChartBar },
      { href: '/dashboard/intelligence/memory',       label: 'Marketing Memory',   icon: IconDatabase },
      { href: '/dashboard/intelligence/knowledge',    label: 'Knowledge Graph',    icon: IconNetwork },
    ],
  },
  {
    section: 'SYSTEM',
    items: [
      { href: '/dashboard/launch-readiness', label: 'Launch Readiness', icon: IconRocket, badge: '7' },
      { href: '/dashboard/settings',         label: 'Settings',         icon: IconSettings },
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
  productName?: string;
  productPlatform?: string;
  productMarkets?: string[];
  opportunityCount?: number;
  approvalCount?: number;
}

export function Sidebar({ userEmail, isAdmin = false, tokenBalance, plan = 'free', productName, productPlatform, productMarkets, opportunityCount = 0, approvalCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const adminActive = pathname.startsWith('/dashboard/admin');

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  function isActive(href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  const balance = tokenBalance ?? 0;
  const isUnlimited = tokenBalance === null || tokenBalance === undefined;
  const max = TIER_MAX[plan] ?? 300;
  const pct = Math.min(100, Math.round((balance / max) * 100));
  const isLow = !isUnlimited && pct <= 20;

  return (
    <nav
      className="hidden lg:flex flex-shrink-0 flex-col min-h-screen"
      style={{
        width: 248,
        background: 'linear-gradient(180deg,var(--nav),#10201c)',
        color: '#e8f0ec',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 8px 18px', paddingTop: 20, paddingLeft: 20 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 11, flexShrink: 0,
          background: 'linear-gradient(135deg,#2fd39f,#0b8f69)',
          display: 'grid', placeItems: 'center',
          color: 'white', fontWeight: 900, fontSize: 13,
          boxShadow: '0 8px 25px rgba(47,211,159,.25)',
        }}>
          LM
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.4px', color: '#fff' }}>
            Launch<span style={{ color: '#4adbb0' }}>Mind</span>
          </div>
          <div style={{ fontSize: 11, color: '#91a79e', marginTop: 2 }}>
            Your AI Growth Operating System
          </div>
        </div>
      </div>

      {/* Workspace card */}
      {(() => {
        const displayName = productName ?? 'My Product';
        const initial = displayName.charAt(0).toUpperCase();
        const platformLabel = productPlatform === 'app_store' ? 'iOS' : productPlatform === 'play_store' ? 'Android' : 'iOS & Android';
        const marketsLabel = productMarkets && productMarkets.length > 0
          ? productMarkets.map(m => m.toUpperCase()).join(' & ')
          : 'USA';
        return (
          <div style={{
            margin: '0 4px 16px',
            padding: '11px 12px',
            border: '1px solid rgba(255,255,255,.09)',
            background: 'rgba(255,255,255,.045)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9, flexShrink: 0,
              background: '#edf7f3', color: 'var(--sage)',
              fontWeight: 800, fontSize: 12,
              display: 'grid', placeItems: 'center',
            }}>
              {initial}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f0ec', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
              <div style={{ fontSize: 11, color: '#8fa79d' }}>{marketsLabel} · {platformLabel}</div>
            </div>
          </div>
        );
      })()}

      {/* Nav sections */}
      <div className="flex-1 overflow-y-auto">
        {NAV_SECTIONS.map(({ section, items }) => (
          <div key={section}>
            <div style={{
              fontSize: 10, color: '#617b70',
              letterSpacing: '.14em', fontWeight: 800,
              margin: '12px 11px 5px',
              textTransform: 'uppercase',
            }}>
              {section}
            </div>
            <div style={{ display: 'grid', gap: 3 }}>
              {items.map(({ href, label, icon: Icon, badge: staticBadge }) => {
                const active = isActive(href);
                // Dynamic badge overrides for real DB counts (0 hides the badge)
                let badge: string | undefined = staticBadge;
                if (href === '/dashboard/opportunities') badge = opportunityCount > 0 ? String(opportunityCount) : undefined;
                if (href === '/dashboard/approvals')     badge = approvalCount     > 0 ? String(approvalCount)     : undefined;
                return (
                  <Link
                    key={href}
                    href={href}
                    style={{
                      all: 'unset' as 'unset',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '10px 11px',
                      borderRadius: 10,
                      color: active ? '#fff' : '#b9c9c3',
                      fontSize: 13,
                      background: active ? 'rgba(47,211,159,.13)' : 'transparent',
                      transition: 'background .15s, color .15s',
                    }}
                    onMouseEnter={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)';
                      if (!active) (e.currentTarget as HTMLElement).style.color = 'white';
                    }}
                    onMouseLeave={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
                      if (!active) (e.currentTarget as HTMLElement).style.color = '#b9c9c3';
                    }}
                  >
                    <Icon
                      size={16}
                      style={{ color: active ? '#47d9ae' : '#7f998f', width: 18, textAlign: 'center', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1 }}>{label}</span>
                    {badge && (
                      <span style={{
                        marginLeft: 'auto',
                        minWidth: 20, height: 20,
                        borderRadius: 999,
                        padding: '0 6px',
                        display: 'grid', placeItems: 'center',
                        background: '#2c5146',
                        color: '#bff7e4',
                        fontSize: 10, fontWeight: 800,
                      }}>
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Admin */}
      {isAdmin && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 2 }}>
          <Link
            href="/dashboard/admin"
            style={{
              all: 'unset' as 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '10px 11px',
              borderRadius: 10,
              color: adminActive ? '#fff' : '#b9c9c3',
              fontSize: 13,
              background: adminActive ? 'rgba(47,211,159,.13)' : 'transparent',
            }}
          >
            <IconShieldCheck size={16} style={{ color: adminActive ? '#47d9ae' : '#7f998f' }} />
            Admin
          </Link>
        </div>
      )}

      {/* Token meter */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '14px 9px 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9cb0a8', fontSize: 11 }}>
          <span>AI tokens</span>
          <b style={{ color: '#34d399', fontFamily: 'DM Mono, monospace' }}>
            {isUnlimited ? '∞' : `${balance} / ${max}`}
          </b>
        </div>
        {!isUnlimited && (
          <div style={{ height: 5, background: '#29423a', borderRadius: 999, margin: '8px 0', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: isLow ? 'var(--danger)' : 'linear-gradient(90deg,#45d8ad,#f0b44c)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        )}
        {isLow && (
          <a href="/dashboard/billing" style={{ display: 'block', fontSize: 9, color: 'var(--danger)', textDecoration: 'none' }}>
            Low — top up →
          </a>
        )}
      </div>

      {/* Profile footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 8px' }}>
        <div style={{
          width: 30, height: 30, borderRadius: 999, flexShrink: 0,
          background: '#d8eee6', color: '#176c54',
          fontWeight: 800, fontSize: 11,
          display: 'grid', placeItems: 'center',
        }}>
          {(userEmail.charAt(0) || 'U').toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f0ec', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userEmail.split('@')[0]}
          </div>
          <div style={{ fontSize: 11, color: '#8fa79d', marginTop: 1, textTransform: 'capitalize' }}>
            {plan} plan
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#617b70', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
          title="Log out"
        >
          ⎋
        </button>
      </div>
    </nav>
  );
}
