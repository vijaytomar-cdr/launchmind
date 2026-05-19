/**
 * @file Sidebar.tsx
 * @description Dashboard sidebar navigation — Slate & Sage dark sidebar panel.
 *   Nav items: Products, Campaigns, Briefs, Insights, Workspaces, Channels, Billing, Settings.
 *   Bottom: token balance meter + founder email + logout.
 * @security Logout calls supabase.auth.signOut() client-side; cookie cleared by Supabase.
 * @dependencies @supabase/ssr (browser client), lucide-react, next/link
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutGrid,
  Megaphone,
  FileText,
  Radio,
  Settings,
  LogOut,
  ShieldCheck,
  CreditCard,
  TrendingUp,
  Layers,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/products', label: 'Products', icon: LayoutGrid },
  { href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/dashboard/briefs', label: 'Briefs', icon: FileText },
  { href: '/dashboard/insights', label: 'Insights', icon: TrendingUp },
  { href: '/dashboard/workspaces', label: 'Workspaces', icon: Layers },
  { href: '/dashboard/channels', label: 'Channels', icon: Radio },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

const TIER_MAX: Record<string, number> = {
  free: 50, solo: 300, builder: 1000, studio: 3000,
};

interface SidebarProps {
  userEmail: string;
  isAdmin?: boolean;
  tokenBalance?: number | null;
  plan?: string;
}

/**
 * Dashboard sidebar with nav items and logout.
 * @param userEmail - Founder's email shown at the bottom of the sidebar.
 */
export function Sidebar({ userEmail, isAdmin = false, tokenBalance, plan = 'free' }: SidebarProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const adminActive = pathname.startsWith('/dashboard/admin');

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <nav
      className="w-60 flex-shrink-0 flex flex-col min-h-screen"
      style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--s-border)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="font-display font-bold" style={{ fontSize: 18, color: '#fff' }}>
          Launch<span style={{ color: 'var(--sage-l)' }}>Mind</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--s-text2)', marginTop: 2 }}>
          AI marketing OS
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 py-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-5 py-2.5 transition-colors"
              style={{
                fontSize: 13,
                color: isActive ? '#fff' : 'var(--s-text)',
                background: isActive ? 'rgba(5,150,105,0.18)' : 'transparent',
                borderRight: isActive ? '2px solid var(--sage-l)' : '2px solid transparent',
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar2)';
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <Icon
                className="flex-shrink-0"
                style={{ width: 15, height: 15, color: isActive ? 'var(--sage-l)' : 'var(--s-text2)' }}
              />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Admin link — only visible to admin user */}
      {isAdmin && (
        <div style={{ borderTop: '1px solid var(--s-border)', paddingTop: 4, marginTop: 4 }}>
          <Link
            href="/dashboard/admin"
            className="flex items-center gap-3 px-5 py-2.5 transition-colors"
            style={{
              fontSize: 13,
              color: adminActive ? '#fff' : 'var(--s-text)',
              background: adminActive ? 'rgba(5,150,105,0.18)' : 'transparent',
              borderRight: adminActive ? '2px solid var(--sage-l)' : '2px solid transparent',
            }}
            onMouseEnter={e => {
              if (!adminActive) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar2)';
            }}
            onMouseLeave={e => {
              if (!adminActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <ShieldCheck
              className="flex-shrink-0"
              style={{ width: 15, height: 15, color: adminActive ? 'var(--sage-l)' : 'var(--s-text2)' }}
            />
            Admin
          </Link>
        </div>
      )}

      {/* Token balance meter */}
      {plan !== 'free' && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--s-border)' }}>
          {(() => {
            const isUnlimited = tokenBalance === null || tokenBalance === undefined;
            const balance = tokenBalance ?? 0;
            const max = TIER_MAX[plan] ?? 300;
            const pct = Math.min(100, Math.round((balance / max) * 100));
            const isLow = !isUnlimited && pct <= 20;
            const barColor = isUnlimited ? 'var(--sage-l)' : isLow ? '#dc2626' : '#d97706';
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--s-text2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Tokens</span>
                  <span className="font-mono" style={{ fontSize: 10, color: isLow ? '#dc2626' : isUnlimited ? 'var(--sage-l)' : 'var(--s-text2)' }}>
                    {isUnlimited ? 'Unlimited' : balance.toLocaleString()}
                  </span>
                </div>
                {!isUnlimited && (
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: barColor, transition: 'width 0.4s ease' }} />
                  </div>
                )}
                {isLow && (
                  <a href="/dashboard/billing" style={{ display: 'block', marginTop: 5, fontSize: 10, color: '#dc2626', textDecoration: 'none' }}>
                    Low — buy tokens →
                  </a>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: '1px solid var(--s-border)' }}>
        <p className="truncate mb-3" style={{ fontSize: 11, color: 'var(--s-text2)' }}>
          {userEmail}
        </p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 transition-opacity hover:opacity-70"
          style={{ fontSize: 12, color: 'var(--s-text2)' }}
        >
          <LogOut style={{ width: 13, height: 13 }} />
          Log out
        </button>
      </div>
    </nav>
  );
}
