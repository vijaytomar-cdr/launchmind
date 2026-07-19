/**
 * @file Button.tsx
 * @description Canonical button primitive. 4 variants: primary (sage), secondary,
 *   ghost, danger. No AI-violet variant — sage owns action, violet owns provenance.
 *   See LaunchMind Design System §11.3.
 */
'use client';

import { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<Variant, string> = {
  primary:   'bg-sage text-white hover:bg-[#047857] border border-transparent',
  secondary: 'bg-surface text-ink border border-[var(--border)] hover:bg-raised',
  ghost:     'bg-transparent text-ink2 border border-transparent hover:text-ink hover:bg-raised',
  danger:    'bg-[var(--danger-d)] text-danger border border-[var(--danger-b)] hover:bg-[rgba(220,38,38,0.14)]',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?:    Size;
}

export function Button({
  variant = 'primary',
  size    = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-1.5 font-medium rounded-[var(--r2)]',
        'transition-colors duration-fast',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
