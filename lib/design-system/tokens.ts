/**
 * @file tokens.ts
 * @description LaunchMind design system — Slate & Sage token constants.
 *   TypeScript-accessible mirror of CSS custom properties in globals.css
 *   and Tailwind config. Use these for programmatic access (e.g. chart colours,
 *   inline styles where Tailwind classes cannot be used).
 *
 *   Source of truth for visual decisions: launchmind-ux-slate-sage.html
 *   CLAUDE.md §6 documents full token reference.
 */

// ─── Colours ──────────────────────────────────────────────────────────────────

export const colors = {
  // Backgrounds
  page:    '#f2f3f6',
  surface: '#ffffff',
  raised:  '#eceef3',

  // Sidebar
  sidebar:  '#28304a',
  sidebarHover: '#323c58',

  // Primary — Sage
  sage:       '#059669',
  sageLight:  '#34d399',
  sageBg:     'rgba(5,150,105,0.12)',
  sageBorder: 'rgba(5,150,105,0.28)',

  // Accent — Indigo
  indigo:       '#4f46e5',
  indigoBg:     'rgba(79,70,229,0.10)',
  indigoBorder: 'rgba(79,70,229,0.22)',

  // Warning — Amber
  amber:       '#d97706',
  amberBg:     'rgba(217,119,6,0.10)',
  amberBorder: 'rgba(217,119,6,0.22)',

  // Danger — Red
  danger:       '#dc2626',
  dangerBg:     'rgba(220,38,38,0.09)',
  dangerBorder: 'rgba(220,38,38,0.22)',

  // Text
  ink:  '#1b1f2e',
  ink2: '#626880',
  ink3: '#9ca4be',

  // Borders
  border:  'rgba(0,0,0,0.07)',
  border2: 'rgba(0,0,0,0.12)',

  // Sidebar internals
  sBorder: 'rgba(255,255,255,0.07)',
  sText:   'rgba(255,255,255,0.88)',
  sText2:  'rgba(255,255,255,0.42)',
  sText3:  'rgba(255,255,255,0.22)',
} as const;

// ─── Radii ────────────────────────────────────────────────────────────────────

export const radius = {
  default: '10px',
  md:      '6px',
  sm:      '4px',
  full:    '9999px',
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────

export const typography = {
  fontBody:    '"DM Sans", sans-serif',
  fontDisplay: '"Syne", sans-serif',
  fontMono:    '"DM Mono", monospace',
  sizeBase:    '13px',
  lineHeight:  '1.5',
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const spacing = {
  pagePadding:    'clamp(16px, 4vw, 32px)',
  cardPadding:    '14px 16px',
  sectionGap:     '16px',
  componentGap:   '8px',
} as const;

// ─── Elevation ────────────────────────────────────────────────────────────────

export const elevation = {
  card:   '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  modal:  '0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
  raised: '0 2px 8px rgba(0,0,0,0.08)',
} as const;

// ─── Motion ───────────────────────────────────────────────────────────────────

export const motion = {
  fast:     '120ms ease',
  default:  '200ms ease',
  slow:     '350ms ease',
  spring:   '300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

// ─── Status badge styles (for inline use) ─────────────────────────────────────

export const statusStyles = {
  draft: {
    bg: colors.raised,
    border: colors.border2,
    color: colors.ink2,
    label: 'Draft',
  },
  active: {
    bg: colors.sageBg,
    border: colors.sageBorder,
    color: colors.sage,
    label: 'Active',
  },
  pending: {
    bg: colors.amberBg,
    border: colors.amberBorder,
    color: colors.amber,
    label: 'Pending',
  },
  error: {
    bg: colors.dangerBg,
    border: colors.dangerBorder,
    color: colors.danger,
    label: 'Error',
  },
  indigo: {
    bg: colors.indigoBg,
    border: colors.indigoBorder,
    color: colors.indigo,
    label: 'Accent',
  },
} as const;

// ─── Market badge colours ──────────────────────────────────────────────────────

export const marketStyles = {
  usa: {
    bg: colors.sageBg,
    border: colors.sageBorder,
    color: '#046c4e',
    label: 'USA',
  },
  india: {
    bg: colors.amberBg,
    border: colors.amberBorder,
    color: '#92400e',
    label: 'India',
  },
} as const;

export type StatusKey = keyof typeof statusStyles;
export type MarketKey = keyof typeof marketStyles;
