/**
 * @file BusinessSwitcher.tsx
 * @description The ONE primary company switcher, in the top bar.
 *
 *   THIS CONTROL CHANGES THE ENTIRE APPLICATION CONTEXT. Every dashboard read —
 *   brief, opportunities, memory, connections, campaigns — re-scopes to the
 *   company selected here.
 *
 *   OWNER LANGUAGE IS "COMPANY"; the model underneath is unchanged. Workspaces,
 *   workspace_id and active_workspace_id keep their names in the database and
 *   the services — this file translates at the edge. Conceptually a company owns
 *   products, which is why the two are shown on separate lines rather than
 *   concatenated: one company may later hold several products.
 *
 *   TWO LINES, NO MORE. Company name dominant, product descriptor secondary.
 *   Maturity and market are disambiguation detail and stay in the expanded
 *   panel; in a header control they are noise.
 *
 *   Three controls, three roles, deliberately not interchangeable:
 *     top bar   this — the only way to change company
 *     sidebar   passive current-company context
 *     settings  company management
 *
 *   SWITCHING STAYS ATOMIC. Unchanged from the accepted implementation: write
 *   the server-side pointer, wait, then `router.refresh()` so every server
 *   component re-runs against the new tenancy. The destination is never shown as
 *   active until its data has resolved.
 *
 * @security UNCHANGED. Sends only a business id; the server re-verifies
 *   membership and answers 404 for anything the founder may not use. No raw
 *   workspace id is ever rendered.
 * @dependencies lib/business/labels, POST /businesses/:id/activate
 */

'use client';

import { useState, useRef, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { menuMetaLabel, productLabel } from '@/lib/business/labels';

export interface BusinessOption {
  workspaceId: string;
  name: string;
  productName: string | null;
  platform: string | null;
  markets: string[];
  maturity: string | null;
  isActive: boolean;
}

export function BusinessSwitcher({
  businesses, activeBusinessId, activeBusinessName, activeProductName, activeMaturity,
}: {
  businesses: BusinessOption[];
  activeBusinessId?: string;
  activeBusinessName?: string;
  activeProductName?: string;
  activeMaturity?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** Roving focus index across [businesses…, add, manage]. */
  const [cursor, setCursor] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const itemCount = businesses.length + 2;   // + Add company, Manage companies

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setError('');
    if (focusTrigger) btnRef.current?.focus();
  }, []);

  // Outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Move real DOM focus with the cursor so screen readers follow along.
  useEffect(() => {
    if (open) itemRefs.current[cursor]?.focus();
  }, [open, cursor]);

  function openMenu() {
    // Start on the active business — the row the owner is most likely to
    // orient from, and never a destructive one.
    const activeIdx = businesses.findIndex(b => b.workspaceId === activeBusinessId);
    setCursor(activeIdx >= 0 ? activeIdx : 0);
    setOpen(true);
  }

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setCursor(c => (c + 1) % itemCount); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => (c - 1 + itemCount) % itemCount); }
    else if (e.key === 'Home')      { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End')       { e.preventDefault(); setCursor(itemCount - 1); }
    else if (e.key === 'Tab')       { close(false); }
  }

  async function switchTo(b: BusinessOption) {
    if (b.workspaceId === activeBusinessId || switching) { close(); return; }
    setSwitching(b.workspaceId);
    setError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session expired — sign in again.'); setSwitching(null); return; }

      const res = await fetch(`/api/businesses/${b.workspaceId}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        // A refusal is a real answer. The UI must not pretend the switch happened.
        setError(res.status === 404
          ? 'That company is no longer available to you.'
          : 'Could not switch company. Try again.');
        setSwitching(null);
        return;
      }
      setOpen(false);
      // THE OVERLAY MUST END ON READINESS, NOT ON A CLOCK. This was
      // `setTimeout(() => setSwitching(null), 4000)` — a fixed delay that was
      // simultaneously too long (the server layout commits in ~1.6s, so fast
      // switches waited for nothing) and far too short (the destination page
      // segment had not committed, so the overlay lifted straight into a mixed
      // company view). Measured: overlay gone at ~4.5s, content correct at ~10s.
      //
      // startTransition keeps isPending true until the refreshed server payload
      // has actually committed, so the lock lifts exactly when the destination
      // chrome is real. No artificial delay is added.
      startTransition(() => router.refresh());
    } catch {
      setError('Could not switch company. Try again.');
      setSwitching(null);
    }
  }

  // Release the lock when the transition has committed and the server now
  // reports the destination as active. Two conditions, because the transition
  // alone does not prove WHICH company came back.
  useEffect(() => {
    if (switching && !isPending && activeBusinessId === switching) setSwitching(null);
  }, [switching, isPending, activeBusinessId]);

  // Failsafe only. If a refresh never commits, the owner must not be trapped
  // behind a permanent overlay — but this is a last resort, not the normal path.
  useEffect(() => {
    if (!switching) return;
    const t = setTimeout(() => setSwitching(null), 20_000);
    return () => clearTimeout(t);
  }, [switching]);

  const switchingTo = businesses.find(b => b.workspaceId === switching)?.name ?? null;
  const label = activeBusinessName ?? 'Select a company';
  // Product descriptor ONLY. Maturity and market are disambiguation detail and
  // live in the expanded panel; in the header they are noise the owner already
  // knows about the company they are looking at.
  const secondary = activeBusinessName
    ? productLabel(activeBusinessName, activeProductName)
    : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} data-testid="business-switcher">
      {/* One button: avatar, company name, product descriptor, chevron. */}
      <button
        ref={btnRef}
        type="button"
        className="lm-biz-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current company: ${label}${secondary ? `, ${secondary}` : ''}. Change company.`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(); }
        }}
      >
        <span className="lm-biz-avatar" aria-hidden>
          {(activeBusinessName ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className="lm-biz-text">
          {/* TWO LINES, no more. A "CURRENT BUSINESS" caption above the name was
              a third level of hierarchy in a header control — the chevron and
              the hover state already say it is interactive, so the caption was
              explaining what the affordance should show. */}
          <span className="lm-biz-name">{label}</span>
          {secondary && <span className="lm-biz-sub">{secondary}</span>}
        </span>
        <span className="lm-biz-chevron" aria-hidden>⌄</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Your companies"
          className="lm-biz-menu"
          onKeyDown={onMenuKey}
        >
          <div className="lm-biz-menu-head">Your companies</div>

          {businesses.length === 0 && (
            <div style={{ padding: '10px 12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              No companies yet — add your first one below.
            </div>
          )}

          {businesses.map((b, i) => {
            const isActive = b.workspaceId === activeBusinessId;
            const product = productLabel(b.name, b.productName);
            const meta = menuMetaLabel(b);
            return (
              <button
                key={b.workspaceId}
                ref={el => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                tabIndex={cursor === i ? 0 : -1}
                disabled={Boolean(switching)}
                className={`lm-biz-item${isActive ? ' is-active' : ''}`}
                onClick={() => switchTo(b)}
                onMouseEnter={() => setCursor(i)}
              >
                {/* A symbol, never colour alone. */}
                <span className="lm-biz-check" aria-hidden>{isActive ? '✓' : ''}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="lm-biz-item-name">{b.name}</span>
                  {product && <span className="lm-biz-item-product">{product}</span>}
                  {meta && <span className="lm-biz-item-meta">{meta}</span>}
                  {switching === b.workspaceId && (
                    <span className="lm-biz-item-switching" role="status">Switching…</span>
                  )}
                </span>
              </button>
            );
          })}

          {error && <div role="alert" className="lm-biz-error">{error}</div>}

          <div className="lm-biz-sep" />

          {/* The panel's discoverability payload: this row is what tells an owner
              LaunchMind holds more than one company. Sized and coloured to be
              read, not hunted for. */}
          <button
            ref={el => { itemRefs.current[businesses.length] = el; }}
            type="button" role="menuitem"
            tabIndex={cursor === businesses.length ? 0 : -1}
            className="lm-biz-item lm-biz-add"
            onMouseEnter={() => setCursor(businesses.length)}
            onClick={() => { setOpen(false); router.push('/onboarding/workspace?add=business'); }}
          >
            <span className="lm-biz-check" aria-hidden>+</span>
            <span>
              <span className="lm-biz-item-name">Add company</span>
              <span className="lm-biz-item-meta">Add another company to LaunchMind</span>
            </span>
          </button>

          <button
            ref={el => { itemRefs.current[businesses.length + 1] = el; }}
            type="button" role="menuitem"
            tabIndex={cursor === businesses.length + 1 ? 0 : -1}
            className="lm-biz-item lm-biz-manage"
            onMouseEnter={() => setCursor(businesses.length + 1)}
            onClick={() => { setOpen(false); router.push('/dashboard/settings/businesses'); }}
          >
            <span className="lm-biz-check" aria-hidden />
            <span className="lm-biz-item-name" style={{ fontWeight: 700, color: 'var(--ink2)' }}>
              Manage companies
            </span>
          </button>
        </div>
      )}

      {/* Blocking overlay: the destination is not usable until its context has
          resolved, so the owner cannot act on half-switched state. */}
      {switching && (
        <div className="lm-biz-overlay" role="status" aria-live="assertive">
          <span>{switchingTo ? `Switching to ${switchingTo}…` : 'Switching company…'}</span>
        </div>
      )}
    </div>
  );
}
