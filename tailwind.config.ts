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
