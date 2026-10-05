/**
 * @file brandFieldPolicy.ts
 * @description Brand field provenance and precedence — ADR-071 §6, Phase 3.5B1.
 *
 *   PURE. No I/O, so every rule here is testable without a database — which
 *   matters because these are the rules that decide whether something LaunchMind
 *   merely observed gets presented to an owner as their own brand.
 *
 *   THE DISTINCTION THAT MUST NOT COLLAPSE:
 *
 *     BRAND REPRESENTATION precedence  — which value do we DISPLAY and USE
 *     EVIDENCE AUTHORITY               — what may SUBSTANTIATE a claim
 *
 *   They look similar and are not. An owner-confirmed tagline outranks a scraped
 *   one for representation; neither is evidence for anything. This module
 *   deliberately does NOT import authorityPolicy and does not extend the memory
 *   tier hierarchy — a scraped colour must never acquire FOUNDER_ASSERTED by
 *   travelling through a shared enum.
 *
 * @security A SCRAPED or INFERRED field may inform a draft. It may never be
 *   described to an owner as confirmed, and it may never substantiate a claim.
 * @dependencies none (pure)
 */

/** Per FIELD, never per kit. Confirming a logo does not confirm a tagline. */
export const BRAND_PROVENANCE = ['SCRAPED', 'INFERRED', 'OWNER_CONFIRMED'] as const;
export type BrandProvenance = typeof BRAND_PROVENANCE[number];

/** Higher wins. Representation only — see the file header. */
const PRECEDENCE: Record<BrandProvenance, number> = {
  OWNER_CONFIRMED: 3,
  INFERRED: 2,
  SCRAPED: 1,
};

export const BRAND_FIELD_KEYS = [
  'logo', 'app_icon', 'primary_color', 'secondary_color', 'font_family',
  'tagline', 'brand_voice', 'tone', 'visual_style',
  'approved_terminology', 'prohibited_terminology',
] as const;
export type BrandFieldKey = typeof BRAND_FIELD_KEYS[number];

export interface BrandFieldCandidate {
  fieldKey: string;
  value: unknown;
  provenance: BrandProvenance;
  /** Owner-safe descriptor: 'your website', 'your App Store listing'. */
  sourceLabel?: string | null;
  observedAt?: string | null;
}

export interface ResolvedBrandField {
  fieldKey: string;
  value: unknown;
  provenance: BrandProvenance;
  sourceLabel: string | null;
  /** True only for OWNER_CONFIRMED. The one question callers actually ask. */
  ownerConfirmed: boolean;
  /** Candidates that lost, kept so a UI can offer "we also saw…". */
  supersededCount: number;
}

/**
 * Picks the value to represent one brand field.
 *
 * @param candidates all known values for a single field
 * @returns the winner, or null when nothing is known
 * @security Ties are broken by RECENCY, then by stable order — never randomly.
 *   A brand that changes on refresh is a brand nobody trusts.
 */
export function resolveBrandField(
  candidates: readonly BrandFieldCandidate[],
): ResolvedBrandField | null {
  const usable = candidates.filter(c => c.value !== null && c.value !== undefined && c.value !== '');
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => {
    const p = PRECEDENCE[b.provenance] - PRECEDENCE[a.provenance];
    if (p !== 0) return p;
    // Same provenance: the more recent observation wins.
    return String(b.observedAt ?? '').localeCompare(String(a.observedAt ?? ''));
  });

  const winner = sorted[0];
  return {
    fieldKey: winner.fieldKey,
    value: winner.value,
    provenance: winner.provenance,
    sourceLabel: winner.sourceLabel ?? null,
    ownerConfirmed: winner.provenance === 'OWNER_CONFIRMED',
    supersededCount: sorted.length - 1,
  };
}

/**
 * Owner-safe sentence for one resolved field.
 *
 * @security Says what is true, including when it is only an observation. The
 *   failure this prevents is a UI that says "your brand colours" about a value
 *   scraped from a stylesheet the owner has never seen.
 */
export function brandProvenanceLabel(field: ResolvedBrandField): string {
  const where = field.sourceLabel ? ` from ${field.sourceLabel}` : '';
  switch (field.provenance) {
    case 'OWNER_CONFIRMED': return 'you confirmed this';
    case 'INFERRED':        return `inferred${where}`;
    case 'SCRAPED':         return `observed${where}, not yet confirmed`;
  }
}

/**
 * May this field be stated as fact in owner-visible copy?
 *
 * Only owner-confirmed brand facts may be asserted. An observed tagline is
 * "currently observed messaging", never "your approved message".
 */
export function mayAssertAsBrandFact(field: ResolvedBrandField | null): boolean {
  return field?.provenance === 'OWNER_CONFIRMED';
}
