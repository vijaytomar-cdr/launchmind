/**
 * @file tailwind.config.ts
 * @description Tailwind CSS — Slate & Sage Design System v1.0 tokens.
 *   All tokens mirror the CSS custom properties in globals.css.
 *   shadcn/ui is NOT installed — do not import from @/components/ui/*.
 *   See CLAUDE.md §6 and LaunchMind Design System §6 for the full reference.
 *   Token values updated 2026-07-23 to match spec LaunchMind_Production_UX_July18_2026(15).html.
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
        page:    '#f5f6f4',
        surface: '#ffffff',
        raised:  '#f8f9f7',

        /* ── Sage — primary action & success ───── */
        sage: {
          DEFAULT: '#0b8f69',
          light:   '#34d399',
          bg:      'rgba(11,143,105,0.12)',
          border:  'rgba(11,143,105,0.28)',
          2:       '#dff4ec',
          3:       '#b9e6d7',
        },

        /* ── Indigo — accent ────────────────────── */
        indigo: {
          DEFAULT: '#4f46e5',
          bg:      'rgba(79,70,229,0.10)',
          border:  'rgba(79,70,229,0.22)',
        },

        /* ── Amber — India market badge & warnings ── */
        amber: {
          DEFAULT: '#b86808',
          bg:      'rgba(184,104,8,0.10)',
          border:  'rgba(184,104,8,0.22)',
          2:       '#fff2dd',
        },

        /* ── Danger — errors & kill signals ─────── */
        danger: {
          DEFAULT: '#c33f43',
          bg:      'rgba(195,63,67,0.09)',
          border:  'rgba(195,63,67,0.22)',
          2:       '#feeceb',
        },

        /* ── Blue ───────────────────────────────── */
        blue: {
          DEFAULT: '#2468cc',
          2:       '#eaf2ff',
        },

        /* ── AI — LaunchMind judgment (violet) ─── */
        ai: {
          DEFAULT: '#6956d9',
          light:   '#9b8ee8',
          bg:      'rgba(105,86,217,0.10)',
          border:  'rgba(105,86,217,0.24)',
        },

        /* ── Violet (alias for ai) ──────────────── */
        violet: {
          DEFAULT: '#6956d9',
          2:       '#efedff',
        },

        /* ── Ink — body text hierarchy ───────────── */
        ink: {
          DEFAULT: '#17211d',
          2:       '#42504a',
          3:       '#7a8781',
        },

        /* ── Border ──────────────────────────────── */
        border:  '#e2e7e3',
        border2: '#cfd7d1',
      },

      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
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
        DEFAULT: '10px',   /* --r  / --r1 — nav items, badges */
        r2:      '14px',   /* --r2 — cards, buttons */
        r3:      '20px',   /* --r3 — pills, chips */
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
        e1:     '0 1px 2px rgba(27,31,46,0.04)',
        e2:     '0 2px 8px rgba(27,31,46,0.06)',
        e3:     '0 8px 24px rgba(27,31,46,0.10)',
        shadow: '0 8px 30px rgba(22,33,29,0.08)',
        shadow2:'0 18px 60px rgba(18,35,31,0.14)',
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
