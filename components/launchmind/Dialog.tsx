/**
 * @file components/launchmind/Dialog.tsx
 * @description The one modal shell every LaunchMind dialog uses (spec §21).
 *
 *   Accessibility is implemented here rather than per-dialog so it cannot be
 *   half-applied: role="dialog", aria-modal, an accessible name, a real focus trap,
 *   focus restoration on close, and Escape-to-close where closing is safe.
 *
 *   "Where safe" matters. A dialog that is mid-way through irreversible work (an
 *   authorization handshake, an in-flight sync the owner has not seen the result of)
 *   passes `dismissible={false}`: Escape and the backdrop stop closing it, and the
 *   focus trap stays in place. The dialog still has to offer its own way out — this
 *   component refuses to be the thing that traps someone permanently, so it always
 *   renders whatever the caller puts in the header.
 *
 * @security No credential or provider payload is ever rendered by this component; it
 *   only lays out children.
 * @dependencies none (deliberately — this must work everywhere)
 */

'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

/** Elements that can hold focus. Used to find the trap boundaries. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),' +
  'select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  /** Accessible name. Required — an unnamed dialog is unusable with a screen reader. */
  label: string;
  onClose: () => void;
  /**
   * False while the dialog is doing work the owner must see the outcome of.
   * Disables Escape and backdrop-click; does NOT hide the caller's own controls.
   */
  dismissible?: boolean;
  /** Max width in px. Panels are full-width below 640px regardless (spec §22). */
  maxWidth?: number;
  /** Extra class on the panel, for page-specific layout. */
  panelClassName?: string;
  children: React.ReactNode;
}

export function Dialog({
  label, onClose, dismissible = true, maxWidth = 620, panelClassName = '', children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Captured on mount so focus returns exactly where it was, even if the trigger
  // has since re-rendered.
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const close = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    // Focus the first interactive control, falling back to the panel itself so the
    // reading position is inside the dialog either way.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    // The page behind a modal must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      // Guard against restoring focus to an element that has left the DOM.
      const target = restoreTo.current;
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  // Focus trap + Escape. Tab from the last control wraps to the first, and
  // Shift+Tab from the first wraps to the last, so focus cannot escape to the page
  // behind the overlay.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }

      const first = items[0];
      const last  = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [close]);

  return (
    <div
      className="lm-dialog-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`lm-dialog-panel ${panelClassName}`.trim()}
        style={{ maxWidth }}
      >
        {/* Duplicates the accessible name for assistive tech that prefers a
            labelledby target, without showing it twice visually. */}
        <span id={titleId} className="lm-sr-only">{label}</span>
        {children}
      </div>
    </div>
  );
}

/**
 * Announces asynchronous progress to assistive technology (spec §21).
 *
 * Rendered visually hidden and updated as work proceeds. Separate from the visible
 * progress bar because a screen reader needs words, not a width.
 */
export function AsyncStatus({ message, assertive = false }: { message: string; assertive?: boolean }) {
  return (
    <span
      className="lm-sr-only"
      role="status"
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {message}
    </span>
  );
}
