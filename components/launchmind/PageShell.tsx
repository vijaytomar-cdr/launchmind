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
