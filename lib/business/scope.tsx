/**
 * @file scope.tsx
 * @description The active company identity, available to client components.
 *
 *   WHY THIS EXISTS:
 *     The dashboard layout remounts business-scoped content with
 *     `<main key={activeBusinessId}>`, which correctly destroys React state on a
 *     company switch. It does NOT — and cannot — clear anything a component
 *     stashed in sessionStorage, because that lives outside React entirely.
 *
 *     Morning Brief kept a stale-while-revalidate cache under one global key,
 *     `lm_brief_data`. On switching company the view remounted, immediately
 *     re-read that key, and painted the PREVIOUS company's brief underneath the
 *     new company's header. The remount guard could never have caught it: the
 *     component was rebuilt correctly and then reloaded the wrong data by hand.
 *
 *   THE RULE:
 *     Any client-side cache of business-scoped data must be keyed by the company
 *     it belongs to. `businessCacheKey()` is the only sanctioned way to build such
 *     a key, so a cache cannot be written without naming its owner.
 *
 * @security Carries an opaque workspace id already resolved and membership-verified
 *   server-side. It is a cache partition key, never an authorization input — no
 *   client may widen access by editing it.
 * @dependencies none
 */

'use client';

import { createContext, useContext } from 'react';

const BusinessScopeContext = createContext<string | null>(null);

export function BusinessScopeProvider({
  businessId, children,
}: { businessId: string | null; children: React.ReactNode }) {
  return (
    <BusinessScopeContext.Provider value={businessId}>{children}</BusinessScopeContext.Provider>
  );
}

/** The active company id, or null when none is selected. */
export function useBusinessScope(): string | null {
  return useContext(BusinessScopeContext);
}

/**
 * Builds a storage key partitioned by company.
 *
 * @param base       - Logical cache name, e.g. 'lm_brief_data'
 * @param businessId - Active company id; null means "no company selected"
 * @returns A key unique to that company, or null when there is no company to
 *   attribute the data to — in which case the caller MUST NOT cache. Returning
 *   null rather than a bare `base` is deliberate: an unattributed cache is exactly
 *   the bug this module exists to prevent.
 */
export function businessCacheKey(base: string, businessId: string | null): string | null {
  if (!businessId) return null;
  return `${base}:${businessId}`;
}
