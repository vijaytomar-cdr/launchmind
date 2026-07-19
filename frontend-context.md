# LaunchMind Frontend Context Bundle

Generated for design system spec work. All file contents are verbatim.

---

## 1. Design Tokens

### `tailwind.config.ts`

```typescript
/**
 * @file tailwind.config.ts
 * @description Tailwind CSS — Slate & Sage design system tokens.
 *   All tokens mirror the CSS custom properties in globals.css.
 *   See CLAUDE.md §6 for the authoritative reference.
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ── Backgrounds ───────────────────────── */
        page:    '#f2f3f6',
        surface: '#ffffff',
        raised:  '#eceef3',
        sidebar: { DEFAULT: '#28304a', 2: '#323c58' },

        /* ── Sage — primary action & success ───── */
        sage: {
          DEFAULT: '#059669',
          light:   '#34d399',
          bg:      'rgba(5,150,105,0.12)',
          border:  'rgba(5,150,105,0.28)',
        },

        /* ── Indigo — accent ────────────────────── */
        indigo: {
          DEFAULT: '#4f46e5',
          bg:      'rgba(79,70,229,0.10)',
          border:  'rgba(79,70,229,0.22)',
        },

        /* ── Amber — India market badge ─────────── */
        amber: {
          DEFAULT: '#d97706',
          bg:      'rgba(217,119,6,0.10)',
          border:  'rgba(217,119,6,0.22)',
        },

        /* ── Danger — errors & kill signals ─────── */
        danger: {
          DEFAULT: '#dc2626',
          bg:      'rgba(220,38,38,0.09)',
          border:  'rgba(220,38,38,0.22)',
        },

        /* ── Ink — body text hierarchy ───────────── */
        ink: {
          DEFAULT: '#1b1f2e',
          2:       '#626880',
          3:       '#9ca4be',
        },

        /* ── shadcn / Radix compatibility ──────── */
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },

      fontFamily: {
        sans:    ['DM Sans', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
        mono:    ['DM Mono', 'monospace'],
      },

      fontSize: {
        '2xs': ['10px', { lineHeight: '1.4' }],
        xs:    ['11px', { lineHeight: '1.5' }],
        sm:    ['12px', { lineHeight: '1.5' }],
        base:  ['13px', { lineHeight: '1.5' }],
        md:    ['14px', { lineHeight: '1.5' }],
      },

      borderRadius: {
        DEFAULT: '10px',
        sm:      '6px',
        xs:      '4px',
        full:    '9999px',
        lg:      'var(--radius)',
        md:      'calc(var(--radius) - 2px)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
```

### `app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Slate & Sage design tokens ───────────────────────────────────────── */
:root {
  /* Backgrounds */
  --page:     #f2f3f6;
  --surface:  #ffffff;
  --raised:   #eceef3;
  --sidebar:  #28304a;
  --sidebar2: #323c58;

  /* Borders */
  --border:    rgba(0,0,0,0.07);
  --border2:   rgba(0,0,0,0.12);
  --s-border:  rgba(255,255,255,0.07);
  --s-border2: rgba(255,255,255,0.12);

  /* Ink (text) */
  --ink:    #1b1f2e;
  --ink2:   #626880;
  --ink3:   #9ca4be;
  --s-text: rgba(255,255,255,0.88);
  --s-text2: rgba(255,255,255,0.42);
  --s-text3: rgba(255,255,255,0.22);

  /* Sage — primary */
  --sage:   #059669;
  --sage-l: #34d399;
  --sage-d: rgba(5,150,105,0.12);
  --sage-b: rgba(5,150,105,0.28);

  /* Indigo — accent */
  --indigo:   #4f46e5;
  --indigo-d: rgba(79,70,229,0.10);
  --indigo-b: rgba(79,70,229,0.22);

  /* Amber — India */
  --amber:   #d97706;
  --amber-d: rgba(217,119,6,0.10);
  --amber-b: rgba(217,119,6,0.22);

  /* Red — danger */
  --red:   #dc2626;
  --red-d: rgba(220,38,38,0.09);
  --red-b: rgba(220,38,38,0.22);

  /* Radius */
  --r:  10px;
  --r2:  6px;
  --r3:  4px;

  /* shadcn/Radix mappings */
  --background:          220 14% 96%;   /* ~#f2f3f6 */
  --foreground:          229 25% 14%;   /* ~#1b1f2e */
  --card:                0 0% 100%;
  --card-foreground:     229 25% 14%;
  --border:              220 13% 91%;
  --input:               220 13% 91%;
  --primary:             161 91% 30%;   /* #059669 */
  --primary-foreground:  0 0% 100%;
  --secondary:           220 14% 92%;   /* #eceef3 */
  --secondary-foreground: 229 25% 14%;
  --muted:               220 14% 92%;
  --muted-foreground:    228 16% 55%;   /* #626880 */
  --accent:              220 14% 92%;
  --accent-foreground:   229 25% 14%;
  --destructive:         0 72% 51%;     /* #dc2626 */
  --destructive-foreground: 0 0% 100%;
  --ring:                161 91% 30%;
  --radius:              0.625rem;      /* 10px */
}

/* ── Autofill override — keeps inputs gray on light backgrounds ──────── */
.autofill-light:-webkit-autofill,
.autofill-light:-webkit-autofill:hover,
.autofill-light:-webkit-autofill:focus,
.autofill-light:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0px 1000px #eceef3 inset !important;
  -webkit-text-fill-color: #1b1f2e !important;
  transition: background-color 9999s ease-in-out 0s;
}

/* ── Base ───────────────────────────────────────────────────────────── */
@layer base {
  * {
    @apply border-border;
  }
  html, body {
    background: var(--page);
    color: var(--ink);
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 {
    font-family: 'Syne', sans-serif;
  }
}
```

---

## 2. Component Inventory

### `find components -type f -name "*.tsx" | sort`

```
components/launchmind/ApprovalCard.tsx
components/launchmind/AssetBlock.tsx
components/launchmind/BudgetRealityCard.tsx
components/launchmind/EmptyState.tsx
components/launchmind/FeedbackWidget.tsx
components/launchmind/IntakeSteps.tsx
components/launchmind/LoadingState.tsx
components/launchmind/MetricCard.tsx
components/launchmind/MissionCard.tsx
components/launchmind/OpportunityCard.tsx
components/launchmind/PageShell.tsx
components/launchmind/PostHogIdentify.tsx
components/launchmind/PostHogProvider.tsx
components/launchmind/PricingCards.tsx
components/launchmind/ProductMenu.tsx
components/launchmind/SettingsLayout.tsx
components/launchmind/Sidebar.tsx
components/launchmind/VideoConceptPicker.tsx
```

> **Note:** `components/ui/` contains only `.gitkeep` — shadcn/ui components were never installed. All Button, Card, Badge equivalents are implemented inline with Tailwind + CSS custom properties.

### `find app -name "page.tsx" | sort`

```
app/(auth)/forgot-password/page.tsx
app/(auth)/login/page.tsx
app/(auth)/mfa/page.tsx
app/(auth)/reset-password/page.tsx
app/(auth)/signup/page.tsx
app/(dashboard)/dashboard/admin/mrr/page.tsx
app/(dashboard)/dashboard/admin/page.tsx
app/(dashboard)/dashboard/analytics/page.tsx
app/(dashboard)/dashboard/approvals/page.tsx
app/(dashboard)/dashboard/ask/page.tsx
app/(dashboard)/dashboard/billing/page.tsx
app/(dashboard)/dashboard/brief/page.tsx
app/(dashboard)/dashboard/briefs/page.tsx
app/(dashboard)/dashboard/calendar/page.tsx
app/(dashboard)/dashboard/campaigns/page.tsx
app/(dashboard)/dashboard/channels/page.tsx
app/(dashboard)/dashboard/content/page.tsx
app/(dashboard)/dashboard/experiments/page.tsx
app/(dashboard)/dashboard/insights/page.tsx
app/(dashboard)/dashboard/intelligence/ai-audit/page.tsx
app/(dashboard)/dashboard/intelligence/growth-brain/page.tsx
app/(dashboard)/dashboard/intelligence/ideas/page.tsx
app/(dashboard)/dashboard/intelligence/knowledge/page.tsx
app/(dashboard)/dashboard/intelligence/market/page.tsx
app/(dashboard)/dashboard/intelligence/memory/page.tsx
app/(dashboard)/dashboard/intelligence/reviews/page.tsx
app/(dashboard)/dashboard/intelligence/timeline/page.tsx
app/(dashboard)/dashboard/metrics/page.tsx
app/(dashboard)/dashboard/missions/[id]/page.tsx
app/(dashboard)/dashboard/missions/page.tsx
app/(dashboard)/dashboard/opportunities/page.tsx
app/(dashboard)/dashboard/page.tsx
app/(dashboard)/dashboard/products/[id]/page.tsx
app/(dashboard)/dashboard/products/[id]/strategy/page.tsx
app/(dashboard)/dashboard/products/new/analysis/page.tsx
app/(dashboard)/dashboard/products/new/competitors/page.tsx
app/(dashboard)/dashboard/products/new/confirm/page.tsx
app/(dashboard)/dashboard/products/new/context/page.tsx
app/(dashboard)/dashboard/products/new/icp/page.tsx
app/(dashboard)/dashboard/products/new/markets/page.tsx
app/(dashboard)/dashboard/products/new/page.tsx
app/(dashboard)/dashboard/products/page.tsx
app/(dashboard)/dashboard/products/setup/audience/page.tsx
app/(dashboard)/dashboard/products/setup/basics/page.tsx
app/(dashboard)/dashboard/products/setup/brand/page.tsx
app/(dashboard)/dashboard/products/setup/business/page.tsx
app/(dashboard)/dashboard/products/setup/connect/page.tsx
app/(dashboard)/dashboard/products/setup/page.tsx
app/(dashboard)/dashboard/reports/page.tsx
app/(dashboard)/dashboard/results/page.tsx
app/(dashboard)/dashboard/settings/[tab]/page.tsx
app/(dashboard)/dashboard/settings/billing/page.tsx
app/(dashboard)/dashboard/settings/page.tsx
app/(dashboard)/dashboard/settings/usage/page.tsx
app/(dashboard)/dashboard/workspaces/[id]/page.tsx
app/(dashboard)/dashboard/workspaces/page.tsx
app/checkout/success/page.tsx
app/page.tsx
app/pricing/page.tsx
```

### `find app -name "layout.tsx" | sort`

```
app/(dashboard)/dashboard/intelligence/layout.tsx
app/(dashboard)/dashboard/products/new/layout.tsx
app/(dashboard)/layout.tsx
app/layout.tsx
```

---

## 3. Shared UI Components

### `components/launchmind/EmptyState.tsx`

```tsx
/**
 * @file EmptyState.tsx
 * @description Consistent empty state for all list/data pages.
 *   Renders: icon, heading, description, optional CTA button.
 *   Replaces ad-hoc empty state implementations across pages.
 */

import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  heading: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'ghost';
  };
}

export function EmptyState({ icon, heading, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '48px 24px' }}
    >
      {icon && (
        <div
          style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'var(--raised)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16, color: 'var(--ink3)',
          }}
        >
          {icon}
        </div>
      )}
      <div
        className="font-display font-semibold"
        style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}
      >
        {heading}
      </div>
      {description && (
        <div
          style={{
            fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6,
            maxWidth: 320, marginBottom: action ? 20 : 0,
          }}
        >
          {description}
        </div>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={
            action.variant === 'ghost'
              ? {
                  fontSize: 13, fontWeight: 500, padding: '7px 16px',
                  background: 'none', color: 'var(--ink2)',
                  border: '1px solid var(--border2)', borderRadius: 6, cursor: 'pointer',
                }
              : {
                  fontSize: 13, fontWeight: 500, padding: '7px 16px',
                  background: 'var(--sage)', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                }
          }
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

### `components/launchmind/LoadingState.tsx`

```tsx
/**
 * @file LoadingState.tsx
 * @description Skeleton loader and spinner for async content.
 *   Use <Skeleton> for individual elements, <PageLoading> for full-page.
 */

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  className,
}: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        background: 'var(--raised)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <Skeleton width="60%" height={14} borderRadius={4} />
      <div style={{ marginTop: 8 }}>
        <Skeleton width="100%" height={12} borderRadius={4} />
        <div style={{ marginTop: 4 }}>
          <Skeleton width="80%" height={12} borderRadius={4} />
        </div>
      </div>
    </div>
  );
}

export function PageLoading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ padding: '64px 24px', gap: 12 }}
    >
      <div
        style={{
          width: 24, height: 24, borderRadius: '50%',
          border: '2.5px solid var(--raised)',
          borderTopColor: 'var(--sage)',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{message}</span>
    </div>
  );
}
```

### `components/launchmind/PageShell.tsx`

```tsx
/**
 * @file PageShell.tsx
 * @description Consistent page wrapper for all dashboard pages.
 *   Provides: responsive padding, page title (Syne), optional breadcrumb,
 *   optional description, optional right-side action slot.
 *   Replaces ad-hoc `p-6 lg:p-8` + heading patterns scattered across pages.
 */

import React from 'react';

interface PageShellProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  children: React.ReactNode;
  /** Remove default top/bottom padding (for pages that manage their own) */
  noPadding?: boolean;
}

export function PageShell({
  title,
  description,
  action,
  breadcrumb,
  children,
  noPadding = false,
}: PageShellProps) {
  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--page)' }}
    >
      {/* Topbar */}
      <div
        className="flex items-center justify-between"
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '0 clamp(16px, 4vw, 32px)',
          height: 52,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div>
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 mb-0.5">
              {breadcrumb.map((crumb, i) => (
                <React.Fragment key={crumb.label}>
                  {i > 0 && (
                    <span style={{ color: 'var(--ink3)', fontSize: 11 }}>/</span>
                  )}
                  {crumb.href ? (
                    <a
                      href={crumb.href}
                      style={{ color: 'var(--ink3)', fontSize: 11, textDecoration: 'none' }}
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--ink3)', fontSize: 11 }}>
                      {crumb.label}
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
          <h1
            className="font-display font-semibold"
            style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}
          >
            {title}
          </h1>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>

      {/* Content */}
      <div
        style={
          noPadding
            ? undefined
            : { padding: 'clamp(16px, 3vw, 24px) clamp(16px, 4vw, 32px)' }
        }
      >
        {description && (
          <p
            className="mb-4"
            style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 600 }}
          >
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
```

### `components/launchmind/Sidebar.tsx`

```tsx
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
      className="w-56 flex-shrink-0 flex flex-col min-h-screen"
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
```

### `app/(dashboard)/layout.tsx` (Dashboard Shell)

```tsx
/**
 * @file app/(dashboard)/layout.tsx
 * @description Dashboard shell layout: sidebar navigation + main content area.
 *   Authenticated-only — middleware redirects unauthenticated users to /login.
 *   Calls POST /founders/session on every load to guarantee:
 *     - Founder row exists in DB
 *     - Personal workspace exists and active_workspace_id is set
 *   This is idempotent — no duplicate workspaces created on repeat logins.
 * @security Server Component reads session; no secret data rendered client-side.
 *   Founder identified in PostHog by UUID only — never email.
 * @dependencies lib/supabase/server, next/navigation, PostHogIdentify
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/launchmind/Sidebar';
import { PostHogIdentify } from '@/components/launchmind/PostHogIdentify';
import { FeedbackWidget } from '@/components/launchmind/FeedbackWidget';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect('/login');

  const { data: { session } } = await supabase.auth.getSession();

  const isAdmin = user.id === process.env.ADMIN_FOUNDER_ID;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  let tokenBalance: number | null | undefined = undefined;
  let plan = 'free';

  if (session?.access_token) {
    // Fire session init and billing fetch in parallel — both non-fatal if they fail
    await Promise.allSettled([
      // Idempotent session init: ensures workspace exists, sets active_workspace_id
      fetch(`${apiBase}/founders/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        // No cache — must run on every dashboard load to handle new signups
        cache: 'no-store',
      }),
      // Billing subscription (cached 60s)
      fetch(`${apiBase}/billing/subscription`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        next: { revalidate: 60 },
      }).then(async res => {
        if (res.ok) {
          const sub = await res.json() as { plan: string; tokenBalance: number | null };
          plan = sub.plan ?? 'free';
          tokenBalance = sub.tokenBalance;
        }
      }),
    ]);
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      <PostHogIdentify founderId={user.id} />
      <Sidebar userEmail={user.email ?? ''} isAdmin={isAdmin} tokenBalance={tokenBalance} plan={plan} />
      <main className="flex-1 overflow-auto">{children}</main>
      <FeedbackWidget />
    </div>
  );
}
```

### `app/(dashboard)/dashboard/intelligence/layout.tsx`

```tsx
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
```

---

## 4. Broken Screens (Priority)

### `app/(dashboard)/dashboard/opportunities/page.tsx`

```tsx
/**
 * @file app/(dashboard)/dashboard/opportunities/page.tsx
 * @description Growth Opportunities backlog — saved_opportunities per ADR-036.
 *   Founders can save, dismiss, or convert to mission.
 * @security JWT from Supabase session.
 * @dependencies api.owner.opportunities, api.owner.updateOpportunity, api.missions.create
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type Opportunity } from '@/lib/api';
import {
  IconBolt,
  IconBookmark,
  IconX,
  IconArrowRight,
  IconBulb,
  IconCheck,
} from '@tabler/icons-react';

type FilterState = 'active' | 'saved' | 'all';

const EFFORT_COLOR: Record<string, string> = {
  low:    'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage',
  medium: 'bg-[var(--amber-d)] border-[var(--amber-b)] text-[#92400e]',
  high:   'bg-[var(--red-d)] border-[var(--red-b)] text-[var(--red)]',
};

const RISK_COLOR: Record<string, string> = {
  low:    'text-sage',
  medium: 'text-[#92400e]',
  high:   'text-[var(--red)]',
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct   = Math.round(value * 100);
  const label = pct >= 80 ? 'High' : pct >= 60 ? 'Medium' : 'Low';
  const cls   = pct >= 80
    ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
    : pct >= 60
    ? 'bg-[var(--amber-d)] border-[var(--amber-b)] text-[#92400e]'
    : 'bg-raised border-[var(--border2)] text-ink3';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-[4px] border text-[11px] font-medium ${cls}`}>
      {pct}% · {label}
    </span>
  );
}

function OppCard({
  opp, token, onUpdate,
}: {
  opp: Opportunity;
  token: string;
  onUpdate: (id: string, state: Opportunity['state']) => void;
}) {
  const [acting, setActing] = useState(false);
  const [saved,  setSaved]  = useState(opp.state === 'saved');

  const transition = async (newState: Opportunity['state']) => {
    setActing(true);
    try {
      await api.owner.updateOpportunity(opp.id, { state: newState }, token);
      onUpdate(opp.id, newState);
      if (newState === 'saved') setSaved(true);
    } catch { /* ignore */ } finally {
      setActing(false);
    }
  };

  const createMission = async () => {
    setActing(true);
    try {
      await api.missions.create({
        type:     opp.type === 'aso' ? 'strategy' : opp.type === 'india_launch' ? 'research' : 'campaign',
        title:    opp.title,
        productId: opp.product_id ?? undefined,
      }, token);
      await api.owner.updateOpportunity(opp.id, { state: 'converted' }, token);
      onUpdate(opp.id, 'converted');
    } catch { /* ignore */ } finally {
      setActing(false);
    }
  };

  const evidence: string[] = opp.evidence ?? [];

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] px-2 py-0.5 rounded-[var(--r3)] border font-medium capitalize ${EFFORT_COLOR[opp.effort] ?? 'bg-raised border-[var(--border2)] text-ink2'}`}>
              {opp.effort} effort
            </span>
            <span className={`text-[11px] font-medium capitalize ${RISK_COLOR[opp.risk] ?? 'text-ink3'}`}>
              {opp.risk} risk
            </span>
          </div>
          <p className="text-[14px] font-semibold text-ink leading-snug">{opp.title}</p>
          {opp.expected_impact && (
            <p className="text-[12px] text-sage font-medium mt-0.5">{opp.expected_impact}</p>
          )}
          {opp.description && (
            <p className="text-[13px] text-ink2 mt-1 leading-relaxed">{opp.description}</p>
          )}
        </div>
        {opp.confidence !== null && <ConfidenceBadge value={opp.confidence} />}
      </div>

      {opp.why_now && (
        <div className="bg-[var(--amber-d)] border border-[var(--amber-b)] rounded-[var(--r2)] px-3 py-2">
          <p className="text-[12px] text-[#92400e] font-medium">Why now</p>
          <p className="text-[12px] text-[#92400e] mt-0.5">{opp.why_now}</p>
        </div>
      )}

      {evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {evidence.slice(0, 3).map((e, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-[4px] bg-raised border border-[var(--border2)] text-ink2">{e}</span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
        <button
          onClick={createMission}
          disabled={acting || opp.state === 'converted'}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
        >
          {opp.state === 'converted' ? <><IconCheck size={12} /> Converted</> : <><IconBolt size={12} /> Create mission</>}
        </button>
        {opp.state !== 'saved' && (
          <button
            onClick={() => transition('saved')}
            disabled={acting || saved}
            className="flex items-center gap-1 text-[12px] text-ink2 hover:text-ink transition-colors disabled:opacity-40"
          >
            <IconBookmark size={13} /> {saved ? 'Saved' : 'Save'}
          </button>
        )}
        {opp.state !== 'dismissed' && (
          <button
            onClick={() => transition('dismissed')}
            disabled={acting}
            className="flex items-center gap-1 text-[12px] text-ink3 hover:text-[var(--red)] transition-colors ml-auto"
          >
            <IconX size={13} /> Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const [opps,    setOpps]    = useState<Opportunity[]>([]);
  const [filter,  setFilter]  = useState<FilterState>('active');
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      api.owner.opportunities(t, { state: 'active' })
        .then(res => { setOpps(res.opportunities); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const fetchFilter = async (f: FilterState) => {
    if (!token) return;
    setFilter(f);
    setLoading(true);
    try {
      const res = await api.owner.opportunities(token, { state: f === 'all' ? 'all' : f });
      setOpps(res.opportunities);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleUpdate = (id: string, newState: Opportunity['state']) => {
    if (filter === 'active' && newState !== 'active') {
      setOpps(prev => prev.filter(o => o.id !== id));
    } else if (filter === 'saved' && newState !== 'saved') {
      setOpps(prev => prev.filter(o => o.id !== id));
    } else {
      setOpps(prev => prev.map(o => o.id === id ? { ...o, state: newState } : o));
    }
  };

  const filters: { key: FilterState; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'saved',  label: 'Saved' },
    { key: 'all',    label: 'All' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Growth Opportunities</h1>
        <p className="text-[13px] text-ink2 mt-1">AI-identified actions ranked by impact, effort, and timing</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => void fetchFilter(f.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-[var(--r2)] transition-colors ${
              filter === f.key
                ? 'bg-[var(--sage-d)] border border-[var(--sage-b)] text-sage'
                : 'bg-raised border border-[var(--border2)] text-ink2 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink2 text-[13px]">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading opportunities…
        </div>
      ) : opps.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <IconBulb size={28} color="var(--sage)" className="mx-auto mb-3" />
          <p className="text-[14px] font-medium text-ink">No opportunities yet</p>
          <p className="text-[13px] text-ink2 mt-1">Complete your product setup to unlock AI-generated growth opportunities.</p>
          <a href="/products/new" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
            Add your app <IconArrowRight size={11} />
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {token && opps.map(opp => (
            <OppCard key={opp.id} opp={opp} token={token} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### `app/(dashboard)/dashboard/brief/page.tsx`

```tsx
/**
 * @file app/(dashboard)/dashboard/brief/page.tsx
 * @description Morning Brief — AI CMO daily digest. Primary entry point per ADR-034.
 *   AI recommendation + pending approvals + top 3 opportunities + recent timeline + Ask box.
 * @security JWT from Supabase session. All data filtered server-side by founder_id.
 * @dependencies api.owner.brief, api.owner.ask
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type BriefResponse, type AskResponse } from '@/lib/api';
import {
  IconSparkles,
  IconAlertCircle,
  IconCheck,
  IconArrowRight,
  IconBolt,
  IconChevronDown,
  IconChevronUp,
  IconBulb,
  IconSearch,
} from '@tabler/icons-react';

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  const pct   = Math.round(value);
  const label = pct >= 80 ? 'High confidence' : pct >= 60 ? 'Medium confidence' : 'Exploratory';
  const cls   = pct >= 80
    ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
    : pct >= 60
    ? 'bg-[var(--amber-d)] border-[var(--amber-b)] text-[#92400e]'
    : 'bg-raised border-[var(--border2)] text-ink3';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border text-[11px] font-medium ${cls}`}>
      {pct}% · {label}
    </span>
  );
}

// ── Evidence chips ────────────────────────────────────────────────────────────

function EvidenceChips({ chips }: { chips: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.slice(0, 3).map((c, i) => (
        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-[4px] bg-raised border border-[var(--border2)] text-[11px] text-ink2">
          {c}
        </span>
      ))}
    </div>
  );
}

// ── Approval banner ───────────────────────────────────────────────────────────

function ApprovalBanner({ total }: { total: number }) {
  if (total === 0) return null;
  return (
    <Link href="/dashboard/approvals"
      className="flex items-center justify-between p-3 rounded-[var(--r)] bg-[var(--amber-d)] border border-[var(--amber-b)] hover:bg-[rgba(217,119,6,0.16)] transition-colors"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[#92400e]">
        <IconAlertCircle size={16} />
        {total} approval{total > 1 ? 's' : ''} waiting — campaigns cannot launch until approved
      </span>
      <span className="text-[11px] text-[#92400e] font-medium flex items-center gap-1">Review <IconArrowRight size={13} /></span>
    </Link>
  );
}

// ── Recommendation card ───────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: BriefResponse['recommendation'] }) {
  const [expanded, setExpanded] = useState(false);
  if (!rec) return null;
  return (
    <div className="bg-surface border border-[var(--sage-b)] border-[1.5px] rounded-[var(--r)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-[var(--sage-d)] border border-[var(--sage-b)] flex items-center justify-center shrink-0 mt-0.5">
            <IconSparkles size={14} color="var(--sage)" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink leading-snug">{rec.title}</p>
            <p className="text-[13px] text-ink2 mt-1 leading-relaxed">{rec.summary}</p>
          </div>
        </div>
        <ConfidenceBadge value={rec.confidence} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={rec.missionType ? `/dashboard/missions?create=${rec.missionType}` : '/dashboard/missions'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
        >
          {rec.action} <IconArrowRight size={12} />
        </Link>
        <button
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-1 text-[12px] text-ink2 hover:text-ink transition-colors"
        >
          {expanded ? <><IconChevronUp size={13} />Less</> : <><IconChevronDown size={13} />Evidence</>}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[11px] text-ink3 mb-1.5 uppercase tracking-wide font-medium">Why now</p>
          <p className="text-[13px] text-ink2">{rec.whyNow}</p>
          <EvidenceChips chips={rec.evidence} />
        </div>
      )}
    </div>
  );
}

// ── Opportunity card ──────────────────────────────────────────────────────────

function OpportunityCard({ opp }: { opp: BriefResponse['opportunities'][0] }) {
  const conf = opp.confidence ? Math.round(opp.confidence * 100) : null;
  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink leading-snug">{opp.title}</p>
          {opp.expected_impact && (
            <p className="text-[12px] text-sage font-medium mt-0.5">{opp.expected_impact}</p>
          )}
          {opp.why_now && (
            <p className="text-[12px] text-ink2 mt-1">{opp.why_now}</p>
          )}
        </div>
        {conf !== null && <ConfidenceBadge value={conf} />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Link
          href={`/dashboard/opportunities?id=${opp.id}`}
          className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1"
        >
          Create mission <IconArrowRight size={11} />
        </Link>
        <span className="text-ink3 text-[12px]">·</span>
        <span className="text-[12px] text-ink3 capitalize">{opp.effort} effort · {opp.risk} risk</span>
      </div>
    </div>
  );
}

// ── Timeline event ────────────────────────────────────────────────────────────

function TimelineItem({ event }: { event: BriefResponse['recentTimeline'][0] }) {
  const isError = event.level === 'warn' || event.level === 'error' || event.type.includes('failed');
  const content = (
    <div className="flex items-start gap-2.5 py-2">
      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
        isError
          ? 'bg-[var(--red-d)] border-[var(--red-b)]'
          : 'bg-[var(--sage-d)] border-[var(--sage-b)]'
      }`}>
        {isError
          ? <IconAlertCircle size={11} color="var(--red)" />
          : <IconCheck size={11} color="var(--sage)" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-ink leading-snug">{event.title}</p>
        <p className="text-[11px] text-ink3 mt-0.5">{new Date(event.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
      </div>
    </div>
  );
  return event.link
    ? <Link href={event.link} className="block hover:bg-raised rounded-[var(--r2)] px-1 -mx-1 transition-colors">{content}</Link>
    : <div className="px-1">{content}</div>;
}

// ── Ask box ───────────────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  'Get me 1,000 installs',
  'Launch in India',
  'Why did CPI increase?',
  'What should I do this week?',
];

function AskBox({ token }: { token: string }) {
  const [question, setQuestion] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [answer,   setAnswer]   = useState<AskResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await api.owner.ask(q, token);
      setAnswer(res.answer);
    } catch {
      setError('Unable to answer right now. Try again.');
    } finally {
      setLoading(false);
    }
  }, [token, loading]);

  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <IconSearch size={15} color="var(--sage)" />
        <p className="text-[13px] font-medium text-ink">Ask LaunchMind</p>
      </div>

      <div className="flex gap-2">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void ask(question); }}
          placeholder="What should I run for Diwali?"
          className="flex-1 bg-raised border border-[var(--border2)] rounded-[var(--r2)] px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus:border-[var(--sage-b)] focus:ring-2 focus:ring-[var(--sage-d)]"
        />
        <button
          onClick={() => void ask(question)}
          disabled={!question.trim() || loading}
          className="px-3 py-2 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] disabled:opacity-40 transition-colors"
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {!answer && !loading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {STARTER_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => { setQuestion(p); void ask(p); }}
              className="text-[11px] px-2 py-1 rounded-[var(--r3)] bg-raised border border-[var(--border2)] text-ink2 hover:border-[var(--sage-b)] hover:text-sage transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-sage">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Thinking…
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>}

      {answer && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[13px] text-ink leading-relaxed">{answer.summary}</p>
          <p className="mt-1.5 text-[13px] font-medium text-sage">{answer.recommendedAction}</p>
          {answer.evidence?.length > 0 && <EvidenceChips chips={answer.evidence} />}
          <div className="mt-2 flex items-center gap-3">
            <Link href="/dashboard/ask" className="text-[12px] text-ink2 hover:text-sage flex items-center gap-1">
              Full answer <IconArrowRight size={11} />
            </Link>
            {answer.suggestedMissionType && (
              <Link href={`/dashboard/missions?create=${answer.suggestedMissionType}`}
                className="text-[12px] text-sage font-medium hover:underline flex items-center gap-1"
              >
                <IconBolt size={11} /> Create mission
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const [data,    setData]    = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      setToken(session.access_token);
      api.owner.brief(session.access_token)
        .then(res => { setData(res); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-2 text-ink2">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Assembling your morning brief…
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>
          {greeting}{data.founder.name ? `, ${data.founder.name.split(' ')[0]}` : ''}
        </h1>
        {data.product && (
          <p className="text-[13px] text-ink2 mt-1">
            {data.product.name} · {data.metrics.activeCampaigns} active campaign{data.metrics.activeCampaigns !== 1 ? 's' : ''}
            {data.metrics.weeklyInstalls ? ` · ${data.metrics.weeklyInstalls.toLocaleString()} installs` : ''}
          </p>
        )}
      </div>

      {/* Approval banner */}
      <div className="mb-4">
        <ApprovalBanner total={data.pendingApprovals.total} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Primary recommendation */}
          <section>
            <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Today&apos;s recommendation</p>
            {data.recommendation
              ? <RecommendationCard rec={data.recommendation} />
              : (
                <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4 text-[13px] text-ink2">
                  <div className="flex items-center gap-2 mb-2">
                    <IconBulb size={15} color="var(--sage)" />
                    <span className="font-medium text-ink">Complete your product setup</span>
                  </div>
                  <p>Add your app URL to get personalized AI recommendations every morning.</p>
                  <Link href="/products/new" className="mt-2 inline-flex items-center gap-1 text-sage text-[12px] font-medium hover:underline">
                    Add app <IconArrowRight size={11} />
                  </Link>
                </div>
              )
            }
          </section>

          {/* Opportunities */}
          {data.opportunities.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth opportunities</p>
                <Link href="/dashboard/opportunities" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  View all <IconArrowRight size={11} />
                </Link>
              </div>
              <div className="space-y-2">
                {data.opportunities.map(opp => <OpportunityCard key={opp.id} opp={opp} />)}
              </div>
            </section>
          )}

          {/* Ask box */}
          {token && <AskBox token={token} />}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Growth Brain status */}
          <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Growth Brain</p>
              <span className={`text-[11px] px-2 py-0.5 rounded-[var(--r3)] border font-medium ${
                data.growthBrain.hasStrategy
                  ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
                  : 'bg-raised border-[var(--border2)] text-ink3'
              }`}>
                {data.growthBrain.hasStrategy ? 'Active' : 'Setup needed'}
              </span>
            </div>
            {data.growthBrain.hasStrategy && data.growthBrain.confidence !== null && (
              <p className="text-[13px] text-ink2">Strategy confidence: {data.growthBrain.confidence}%</p>
            )}
            <Link href="/dashboard/intelligence/growth-brain" className="mt-2 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">
              View details <IconArrowRight size={11} />
            </Link>
          </div>

          {/* Pending approvals detail */}
          {data.pendingApprovals.total > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Awaiting approval</p>
              <div className="space-y-2">
                {data.pendingApprovals.items.slice(0, 3).map(item => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] mt-1.5 shrink-0" />
                    <p className="text-[13px] text-ink leading-snug">{item.title}</p>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/approvals" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
                Review all <IconArrowRight size={11} />
              </Link>
            </div>
          )}

          {/* Recent timeline */}
          {data.recentTimeline.length > 0 && (
            <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">Recent activity</p>
                <Link href="/dashboard/intelligence/timeline" className="text-[12px] text-sage hover:underline flex items-center gap-1">
                  All <IconArrowRight size={11} />
                </Link>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {data.recentTimeline.map(e => <TimelineItem key={e.id} event={e} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### `app/(dashboard)/dashboard/intelligence/market/page.tsx`

```tsx
/**
 * @file app/(dashboard)/dashboard/intelligence/market/page.tsx
 * @description Market Intelligence — competitor tracking, category benchmarks, and trend signals.
 *   Data sources: products.competitor_set, playbook_signals (benchmarks), intelligence_trends.
 * @security All data is founder-scoped. Benchmark data is anonymous (no cross-tenant leakage).
 * @dependencies api.benchmarks, api.owner, Tabler icons v3
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type BenchmarkResult, type TrendSummary } from '@/lib/api';
import {
  IconWorld, IconTrendingUp, IconTrendingDown, IconMinus,
  IconChartBar, IconRefresh, IconAlertTriangle, IconSparkles,
  IconStar, IconDeviceMobile, IconBrandGoogle, IconBrandApple,
} from '@tabler/icons-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string | null;
  markets: string[] | null;
  platform: string;
  competitor_set: Competitor[] | null;
  scraped_meta: { rating?: number; ratingCount?: number; category?: string } | null;
}

interface Competitor {
  name: string;
  developer?: string;
  rating?: number;
  category?: string;
  priceTier?: string;
  platform?: string;
  storeUrl?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TrendBadge({ direction }: { direction: TrendSummary['direction'] }) {
  const config = {
    up:       { icon: IconTrendingUp,   color: 'var(--sage)',    bg: 'var(--sage-d)',   border: 'var(--sage-b)',   label: 'Trending up' },
    down:     { icon: IconTrendingDown, color: 'var(--red)',     bg: 'var(--red-d)',    border: 'var(--red-b)',    label: 'Trending down' },
    flat:     { icon: IconMinus,        color: 'var(--ink2)',    bg: 'var(--raised)',   border: 'var(--border2)',  label: 'Stable' },
    volatile: { icon: IconAlertTriangle,color: 'var(--amber)',   bg: 'var(--amber-d)', border: 'var(--amber-b)', label: 'Volatile' },
  };
  const c = config[direction] ?? config.flat;
  const Icon = c.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <Icon size={11} />
      {c.label}
    </span>
  );
}

function BenchmarkBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: 6, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 400ms ease' }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketIntelligencePage() {
  const [products, setProducts]         = useState<Product[]>([]);
  const [selectedProduct, setSelected]  = useState<Product | null>(null);
  const [benchmark, setBenchmark]       = useState<BenchmarkResult | null>(null);
  const [trends, setTrends]             = useState<TrendSummary[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const loadBenchmark = useCallback(async (product: Product, token: string) => {
    if (!product.category) return;
    const market = (product.markets ?? ['usa'])[0] ?? 'usa';

    const [bRes, tRes] = await Promise.all([
      api.benchmarks.get({ category: product.category, market }, token),
      api.benchmarks.trends({ category: product.category, market }, token),
    ]);

    setBenchmark(bRes.benchmark ?? null);
    setTrends(tRes.trends ?? []);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError('Not authenticated'); setLoading(false); return; }
        const token = session.access_token;

        const { data: prods, error: pe } = await supabase
          .from('products')
          .select('id, name, category, markets, platform, competitor_set, scraped_meta')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (pe) throw pe;

        const list = (prods ?? []) as Product[];
        setProducts(list);

        if (list.length > 0) {
          setSelected(list[0]);
          await loadBenchmark(list[0], token);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [loadBenchmark]);

  // ... (full component continues — see file for complete render)
}
```

> **Note:** The `market/page.tsx` source above is abbreviated in the render section to save space. The full source (lines 176–405) renders: benchmark metrics card, trend badges, competitor grid. Refer to the verbatim source read earlier in the session, or read the file directly.

### `app/(dashboard)/dashboard/intelligence/reviews/page.tsx`

> Full source: [app/(dashboard)/dashboard/intelligence/reviews/page.tsx](app/(dashboard)/dashboard/intelligence/reviews/page.tsx) — 459 lines
>
> Key patterns:
> - Reads `products.scraped_meta` directly via Supabase client (no backend route)
> - `ScrapedMeta`: `{ rating?, ratingCount?, reviews?: Review[], reviewSummary?, themes? }`
> - `Review`: `{ author?, rating, title?, body, date?, sentiment?: 'positive'|'negative'|'neutral' }`
> - Sentiment computed from `review.sentiment` field, fallback: rating ≥4 → positive, ≤2 → negative
> - Filter pills: all / positive / neutral / negative
> - `StarRow`, `SentimentBadge`, `RatingBar`, `ReviewCard` sub-components

### `app/(dashboard)/dashboard/analytics/page.tsx`

> Full source: [app/(dashboard)/dashboard/analytics/page.tsx](app/(dashboard)/dashboard/analytics/page.tsx) — 438 lines
>
> Key patterns:
> - Uses `api.analytics.summary`, `kpi`, `funnel`, `roi`, `insights`
> - `AnalyticsSummary.totals`: `{ totalInstalls, totalImpressions, avgCpi, avgRoas }`
> - `FunnelResult.byChannel[]`: `{ channel, market, impressions, clicks, installs, ctr, conversionRate }`
> - `ROIResult.byChannel[]`: `{ channel, market, estimatedSpend, estimatedRevenue, roas, roi }`
> - `OptimizationInsight`: `{ id?, insightType, title, description, impactEstimate?, confidence }`
> - KPI sparkline renders last 8 weeks as horizontal bar chart
> - `InsightRow` has apply/dismiss buttons calling `api.analytics.updateInsight(id, status, token)`

---

## 5. Working Reference Screen

### `app/(dashboard)/dashboard/campaigns/page.tsx`

```tsx
/**
 * @file app/(dashboard)/dashboard/campaigns/page.tsx
 * @description Campaigns list — all campaigns for the founder across all products.
 *   Shows amber banner when pending_approval campaigns exist.
 *   Shows channel, market, copy preview, budget, status, approve/pause actions.
 *   Approval dialog requires explicit confirmation (approve-before-post gate).
 * @security Auth token from Supabase session. All data via Fastify backend.
 *   Approval endpoint verified server-side — campaigns.approved_at set by backend only.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Campaign } from '@/lib/api';
import {
  IconBrandWhatsapp,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandLinkedin,
  IconMail,
  IconDeviceMobile,
} from '@tabler/icons-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ChannelIconComp = React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }>;

const CHANNEL_CONFIG: Record<string, { Icon: ChannelIconComp; color: string; bg: string; border: string }> = {
  whatsapp:    { Icon: IconBrandWhatsapp, color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  meta:        { Icon: IconBrandFacebook, color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  google:      { Icon: IconBrandGoogle,   color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  linkedin:    { Icon: IconBrandLinkedin, color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  email:       { Icon: IconMail,          color: 'var(--ink2)',   bg: 'var(--raised)',   border: 'var(--border2)' },
  aso_rewrite: { Icon: IconDeviceMobile,  color: 'var(--ink2)',   bg: 'var(--raised)',   border: 'var(--border2)' },
};

const STATUS_STYLE: Record<Campaign['status'], React.CSSProperties> = {
  draft:            { background: 'var(--raised)',   color: 'var(--ink2)',   border: '1px solid var(--border2)' },
  pending_approval: { background: 'var(--amber-d)',  color: 'var(--amber)',  border: '1px solid var(--amber-b)' },
  approved:         { background: 'var(--sage-d)',   color: 'var(--sage)',   border: '1px solid var(--sage-b)' },
  launched:         { background: 'var(--sage-d)',   color: 'var(--sage)',   border: '1px solid var(--sage-b)' },
  paused:           { background: 'var(--red-d)',    color: 'var(--red)',    border: '1px solid var(--red-b)' },
  completed:        { background: 'var(--raised)',   color: 'var(--ink2)',   border: '1px solid var(--border2)' },
};

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Pending',
  approved: 'Approved',
  launched: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

// ── Channel icon with colored background (used in approval dialog) ────────────

function ChannelIconBox({ platform, size = 16 }: { platform: string; size?: number }) {
  const cfg = CHANNEL_CONFIG[platform];
  if (!cfg) return <span style={{ fontSize: size, color: 'var(--ink3)' }}>◉</span>;
  const { Icon, color, bg, border } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size + 10, height: size + 10, borderRadius: 4,
      background: bg, border: `1px solid ${border}`, flexShrink: 0,
    }}>
      <Icon size={size} color={color} />
    </span>
  );
}

// ── Channel icon bare (no background box, used in table rows) ─────────────────

function ChannelIconInline({ platform, size = 14 }: { platform: string; size?: number }) {
  const cfg = CHANNEL_CONFIG[platform];
  if (!cfg) return <span style={{ fontSize: size, color: 'var(--ink3)' }}>◉</span>;
  const { Icon, color } = cfg;
  return <Icon size={size} color={color} />;
}

// ── Campaign table row ────────────────────────────────────────────────────────

function CampaignRow({
  campaign: c,
  onApprove,
  onPause,
  pausing,
}: {
  campaign: Campaign;
  onApprove: (c: Campaign) => void;
  onPause: (id: string) => void;
  pausing: boolean;
}) {
  const tdStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 13,
    color: 'var(--ink)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  };

  const spend = c.spend_cap as { weeklyUSD?: number; weeklyINR?: number } | null;
  const budget = spend?.weeklyUSD ? `$${spend.weeklyUSD}` : spend?.weeklyINR ? `₹${spend.weeklyINR}` : 'Free';

  const channelLabel = c.channel === 'aso_rewrite' ? 'ASO' : c.channel.charAt(0).toUpperCase() + c.channel.slice(1, 2).toUpperCase();
  const campaignName = `${c.productName ?? c.product_id.slice(0, 8)} — ${channelLabel}`;
  const subtitle = c.hook_type ?? null;

  return (
    <tr
      style={{ transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--raised)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      {/* Campaign */}
      <td style={{ ...tdStyle, overflow: 'hidden' }}>
        <Link href={`/dashboard/products/${c.product_id}/strategy`} className="font-medium hover:underline"
          style={{ color: 'var(--ink)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {campaignName}
        </Link>
        {subtitle && <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'block', marginTop: 1, textTransform: 'capitalize' }}>{subtitle}</span>}
      </td>

      {/* Channel — bare icon, no background box */}
      <td style={tdStyle}>
        <span className="flex items-center gap-1.5">
          <ChannelIconInline platform={c.channel} size={12} />
          <span style={{ fontSize: 12, color: 'var(--ink2)', textTransform: 'capitalize' }}>
            {c.channel === 'aso_rewrite' ? 'ASO' : c.channel}
          </span>
        </span>
      </td>

      {/* Market */}
      <td style={tdStyle}>
        <span className="rounded-full px-2 py-0.5 font-medium" style={{
          fontSize: 11,
          background: c.market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
          color: c.market === 'india' ? 'var(--amber)' : 'var(--sage)',
        }}>{c.market.toUpperCase()}</span>
      </td>

      {/* Copy preview */}
      <td style={{ ...tdStyle, overflow: 'hidden' }}>
        {c.copy_text ? (
          <span style={{ fontSize: 12, color: 'var(--ink2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {c.copy_text}
          </span>
        ) : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>—</span>}
      </td>

      {/* Budget */}
      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
        {budget}
      </td>

      {/* Status */}
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        <span className="rounded-full px-2 py-0.5 font-medium" style={{ fontSize: 11, ...STATUS_STYLE[c.status] }}>
          {STATUS_LABEL[c.status]}
        </span>
      </td>

      {/* Action */}
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        {(c.status === 'draft' || c.status === 'pending_approval') && (
          <button onClick={() => onApprove(c)} className="rounded-[6px] px-3 py-1 font-medium transition-opacity hover:opacity-80"
            style={{ fontSize: 11, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', cursor: 'pointer' }}>
            Approve
          </button>
        )}
        {(c.status === 'launched' || c.status === 'approved') && (
          <button onClick={() => onPause(c.id)} disabled={pausing} className="rounded-[6px] px-3 py-1 transition-opacity hover:opacity-80"
            style={{ fontSize: 11, border: '1px solid var(--border2)', color: 'var(--ink2)', background: 'var(--surface)', cursor: pausing ? 'not-allowed' : 'pointer', opacity: pausing ? 0.5 : 1 }}>
            {pausing ? '…' : 'Pause'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function CampaignsPage() {
  // ... standard data fetching + filter + table render (see file for complete source)
  // Pattern: outer wrapper = p-4 sm:p-6 lg:p-8
  // Table: overflow-x-auto wrapper, table minWidth: 640, tableLayout: 'fixed'
  // Approval: PATCH /campaigns/:id/approve via direct fetch (not api client)
}
```

---

## 6. API Contracts

### `GET /owner/brief` — Morning Brief

**Response shape** (from `owner.route.ts` + `lib/api.ts`):

```typescript
// BriefResponse (lib/api.ts:1574)
interface BriefResponse {
  founder:     { name: string; plan: string };
  product:     { id: string; name: string; platform: string } | null;
  recommendation: {
    title:       string;          // ≤10 words, action-oriented
    summary:     string;          // 2 sentences
    whyNow:      string;          // 1 sentence specific signal
    confidence:  number;          // 0–100
    evidence:    string[];        // max 3 strings  ← THIS IS THE evidence FIELD
    action:      string;          // CTA label e.g. "Launch India campaign"
    missionType: string | null;   // 'research'|'strategy'|'content'|'campaign'|'optimization'
  } | null;
  pendingApprovals: {
    total: number;
    items: Array<{ id: string; type: 'campaign'|'mission'; title: string; preview: string|null; missionId: string|null }>;
  };
  opportunities: Opportunity[];   // max 3, from saved_opportunities
  recentTimeline: TimelineEvent[];
  growthBrain: { hasStrategy: boolean; confidence: number|null; lastUpdated: string|null };
  metrics: { weeklyInstalls: number|null; cpi: number|null; activeCampaigns: number };
}
```

**Key notes:**
- `recommendation.evidence` is `string[]` (plain text strings, max 3) — not IDs, not objects
- `opportunities[]` on the brief response is `Opportunity[]` — same shape as the opportunities page
- `recommendation` is `null` if no product or AI call fails (non-fatal)
- Calls Haiku (fast) for recommendation, not Sonnet

---

### `GET /owner/opportunities` — Opportunities / Growth Backlog

**Response:** `{ opportunities: Opportunity[] }`

```typescript
// Opportunity (lib/api.ts:1528)
interface Opportunity {
  id:              string;
  founder_id:      string;
  product_id:      string | null;
  type:            string;              // 'aso' | 'india_launch' | 'review_risk' | custom
  title:           string;
  description:     string | null;
  expected_impact: string | null;       // e.g. "~+8% organic installs"
  confidence:      number | null;       // 0.0–1.0 (NOT 0–100)
  effort:          'low' | 'medium' | 'high';
  risk:            'low' | 'medium' | 'high';
  why_now:         string | null;
  source:          string | null;       // 'competitor_scrape' | 'growth_brain' | 'review_analysis' | 'manual'
  evidence:        string[] | null;     // ← plain text strings stored as JSONB in DB, parsed on read
  state:           'active' | 'saved' | 'dismissed' | 'converted';
  mission_id:      string | null;
  created_at:      string;
  updated_at:      string;
}
```

**Critical: `evidence` field encoding:**
- Backend stores `evidence` as a JSONB column in `saved_opportunities`
- Seeded data uses `JSON.stringify(['string1', 'string2'])` — the route SELECT returns the parsed array
- In `opportunities/page.tsx`: `const evidence: string[] = opp.evidence ?? []`
- Rendered as: `evidence.slice(0, 3).map((e, i) => <span key={i}>{e}</span>)`

---

### `POST /owner/ask` — Ask LaunchMind

**Request:** `{ question: string (3–500 chars), productId?: string (UUID) }`

**Response:** `{ answer: AskResponse; contextSources: string[]; question: string }`

```typescript
// AskResponse (lib/api.ts:1562)
interface AskResponse {
  summary:               string;        // 2 sentences max
  recommendedAction:     string;        // one clear action
  suggestedMissionType:  string | null; // research|strategy|content|campaign|optimization|reporting
  suggestedMissionTitle: string | null;
  expectedImpact:        string;
  confidence:            number;        // 0–100
  risks:                 string[];      // max 3
  nextStep:              string;
  evidence:              string[];      // max 3 data points  ← THIS IS THE evidence FIELD
}
```

---

### `GET /benchmarks` — Market Benchmarks

**Query params:** `category: string`, `market: string`

**Response:** `{ benchmark: BenchmarkResult | null; message?: string }`

```typescript
// BenchmarkResult (lib/api.ts:1851)
interface BenchmarkResult {
  category:              string;
  market:                string;
  channel:               string | null;
  avgInstallDeltaPct:    number;        // e.g. 12.5 means +12.5%
  medianInstallDeltaPct: number;
  avgConversionRate:     number;        // 0.0–1.0
  avgRetentionD7:        number;        // 0.0–1.0
  topChannel:            string | null;
  signalCount:           number;        // number of anonymous signals in cohort
  period:                string;
}
```

**Note:** Returns `null` if `signalCount < 3` (min cohort privacy guard)

---

### `GET /benchmarks/trends` — Market Trends

**Query params:** `category: string`, `market: string`

**Response:** `{ trends: TrendSummary[]; category: string; market: string; periodDays: number }`

```typescript
// TrendSummary (lib/api.ts:1864)
interface TrendSummary {
  category:   string;
  market:     string;
  channel:    string | null;
  trendType:  string;                          // e.g. 'install_growth' | 'conversion_rate'
  direction:  'up' | 'down' | 'flat' | 'volatile';
  magnitude:  number;
  periodDays: number;
  summary:    string;                          // human-readable sentence
  computedAt: string;
}
```

---

### `GET /analytics/summary` — Cross-Product KPIs

**Response:**

```typescript
interface AnalyticsSummary {
  founderId:   string;
  products:    Array<{ productId: string; productName: string; kpi: KPISummary }>;
  totals:      KPISummary;
  generatedAt: string;
}

interface KPISummary {
  totalImpressions:         number;
  totalClicks:              number;
  totalInstalls:            number;
  avgCpi:                   number | null;
  avgRoas:                  number | null;
  avgCtr:                   number | null;
  weekOverWeekInstallDelta: number | null;
  topChannel:               string | null;
  topMarket:                string | null;
}
```

---

### `GET /analytics/funnel?productId=` — Funnel

```typescript
interface FunnelResult {
  impressions:           number;
  clicks:                number;
  installs:              number;
  impressionToClickRate: number | null;
  clickToInstallRate:    number | null;
  overallFunnelRate:     number | null;
  byChannel: Array<{
    channel:        string;
    market:         string;
    impressions:    number;
    clicks:         number;
    installs:       number;
    ctr:            number | null;
    conversionRate: number | null;
  }>;
}
```

---

### `GET /analytics/roi?productId=` — ROI by Channel

```typescript
interface ROIResult {
  estimatedSpend:   number;   // proxy: CPI × installs
  estimatedRevenue: number;   // proxy: ROAS × spend
  overallROI:       number | null;
  byChannel: Array<{
    channel:          string;
    market:           string;
    estimatedSpend:   number;
    estimatedRevenue: number;
    roas:             number | null;
    roi:              number | null;
  }>;
}
```

---

### Data sources for "broken" pages

| Page | Data source | Key pain point |
|---|---|---|
| `brief/page.tsx` | `GET /owner/brief` | `recommendation` can be `null`; `evidence` is `string[]` (max 3) |
| `opportunities/page.tsx` | `GET /owner/opportunities` | `evidence` stored as JSONB, returned as `string[] \| null` |
| `market/page.tsx` | Supabase direct (`products`) + `GET /benchmarks` + `GET /benchmarks/trends` | `benchmark` is `null` when cohort < 3; `competitor_set` is `JSONB` typed as `Competitor[]` |
| `reviews/page.tsx` | Supabase direct (`products.scraped_meta`) | No backend route — reads raw JSONB; `reviews` may be empty or missing |
| `analytics/page.tsx` | `GET /analytics/summary` + `kpi` + `funnel` + `roi` + `insights` | 5 separate API calls; `totals` may be all zeros if no campaign_metrics rows |

---

## 7. Known Issues

### TypeScript (`npx tsc --noEmit`)

**Result: 0 errors** — TypeScript check passed with no output.

> Note: There are 5 pre-existing type errors in the scraper layer (`scraperQueue.ts`, `icpService.ts`, `scraperWorker.ts`) caused by library type drift (@playwright/test version mismatch). These do not affect the frontend and have no runtime impact. They are deferred to a dedicated chore commit.

### Runtime issues (from live observation)

| Route | Status | Notes |
|---|---|---|
| `/dashboard/brief` | Loads but slow | Uses `domcontentloaded` in screenshotter to avoid timeout; AI recommendation call to Haiku can take 3–5s |
| `/dashboard/opportunities` | Loads | `evidence` renders correctly as string chips |
| `/dashboard/intelligence/market` | Loads | Benchmark shows "Not enough signals" when `playbook_signals` cohort < 3 |
| `/dashboard/intelligence/reviews` | Loads | "No review data collected yet" shown if `scraped_meta.reviews` is empty |
| `/dashboard/analytics` | Loads but slow | 5 parallel API calls; loading spinner shown while `selected` product loads per-product data |
| `/dashboard/briefs` | Redirects | ADR-008: `/dashboard/briefs` → `/dashboard/content` (permanent redirect) |

### Shadcn/UI Components

`components/ui/` contains only `.gitkeep`. **No shadcn components are installed.** All button, card, badge, input patterns are implemented inline using Tailwind classes + CSS custom properties (`var(--sage)`, `var(--raised)`, etc.). Do not attempt to import from `@/components/ui/button` etc.
