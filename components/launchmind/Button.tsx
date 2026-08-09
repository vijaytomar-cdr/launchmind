/**
 * @file Button.tsx
 * @description Canonical button primitive. 4 variants: primary (sage), secondary,
 *   ghost, danger. No AI-violet variant — sage owns action, violet owns provenance.
 *   Spec: border-radius 10px (var(--r)), height 38px, font-weight 650.
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
  danger:    'bg-[var(--danger-d)] text-danger border border-[var(--danger-b)] hover:bg-[rgba(195,63,67,0.14)]',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'px-2.5 text-xs',
  md: 'px-3 text-sm',
  lg: 'px-4 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?:    Size;
}

export function Button({
  variant = 'primary',
  size    = 'md',
  className = '',
  style,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-[10px]',
        'transition-colors duration-fast',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ].join(' ')}
      style={{ height: 38, fontWeight: 650, ...style }}
      {...props}
    />
  );
}
