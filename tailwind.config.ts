/**
 * @file tailwind.config.ts
 * @description Tailwind CSS — Slate & Sage Design System v1.0 tokens.
 *   All tokens mirror the CSS custom properties in globals.css.
 *   shadcn/ui is NOT installed — do not import from @/components/ui/*.
 *   See CLAUDE.md §6 and LaunchMind Design System §6 for the full reference.
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

        /* ── AI — LaunchMind judgment (violet) ─── */
        ai: {
          DEFAULT: '#7c5cff',
          light:   '#a78bfa',
          bg:      'rgba(124,92,255,0.10)',
          border:  'rgba(124,92,255,0.24)',
        },

        /* ── Ink — body text hierarchy ───────────── */
        ink: {
          DEFAULT: '#1b1f2e',
          2:       '#626880',
          3:       '#9ca4be',
        },

        /* ── Fallback border (for @apply border-*) ── */
        border: 'rgba(27,31,46,0.10)',
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
        lg:    ['18px', { lineHeight: '1.3' }],
        xl:    ['24px', { lineHeight: '1.2' }],
        '2xl': ['32px', { lineHeight: '1.1' }],
      },

      borderRadius: {
        DEFAULT: '10px',
        sm:      '6px',
        xs:      '4px',
        full:    '9999px',
      },

      transitionDuration: {
        fast:    '120ms',
        DEFAULT: '180ms',
        slow:    '280ms',
      },

      boxShadow: {
        e1: '0 1px 2px rgba(27,31,46,0.04)',
        e2: '0 2px 8px rgba(27,31,46,0.06)',
        e3: '0 8px 24px rgba(27,31,46,0.10)',
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
