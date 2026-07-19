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
