/**
 * @file scopePolicy.ts
 * @description The ONE canonical scope normalizer — ADR-067 C10, C12, C13.
 *
 *   Pre-Design found scope was asymmetric: ClaimComparison read six dimensions
 *   out of untyped `content` JSONB, RetrievalService could filter on two
 *   columns, and production memories populated none of them. Every component
 *   effectively invented its own scope semantics. This module exists so that
 *   cannot happen again — ClaimCandidateBuilder, CandidateEligibility,
 *   RetrievalService, ClaimComparison and MemoryPromotionPolicy all call here.
 *
 *   THE THREE STATES. The single most important rule in this file:
 *
 *     key ABSENT        → ANY      the claim applies regardless of this dimension
 *     explicit value    → BOUND    the claim applies only for this value
 *     "__UNKNOWN__"     → UNKNOWN  we do not know (legacy rows only)
 *
 *   Absent and unknown must never be conflated. Reading an unstated dimension
 *   as "applies to everything" is exactly how a segment-specific finding gets
 *   applied to every customer, and reading it as "unknown" would make every
 *   broad claim uncomparable. Both failures are silent, which is why the
 *   distinction is encoded rather than inferred.
 *
 * @security Pure. No I/O, no model, no database. Scope values are lowercased and
 *   length-capped so a hostile provider string cannot become an unbounded key.
 * @dependencies node:crypto only
 */

import { createHash } from 'crypto';

/** Governed dimensions for 3.2A (ADR-067 C10). Closed set. */
export const SCOPE_DIMENSIONS = [
  'product',
  'channel',
  'audience_segment',
  'geography',
  'funnel_stage',
  'timeframe',
] as const;
export type ScopeDimension = typeof SCOPE_DIMENSIONS[number];

/**
 * Bumped whenever normalization or matching changes meaning.
 *
 * Persisted on every proposal and transition: a scope decided under v1 rules
 * must stay explicable after v2 changes what "same scope" means.
 */
export const SCOPE_POLICY_VERSION = 1;

/** The explicit "we do not know" marker. Legacy rows only. */
export const SCOPE_UNKNOWN = '__UNKNOWN__';

export type ScopeCompleteness = 'explicit' | 'partial' | 'unknown';

/** A normalized scope. Absent key = ANY. */
export type MemoryScope = Partial<Record<ScopeDimension, string>>;

export interface NormalizedScope {
  scope: MemoryScope;
  scopeKey: string;
  specificity: number;
  completeness: ScopeCompleteness;
  /** Dimensions dropped because they were empty, unknown-shaped or invalid. */
  droppedDimensions: string[];
}

/** How two scopes relate. Drives contradiction vs scoped-exception (C13). */
export type ScopeRelation = 'same' | 'narrower' | 'broader' | 'different' | 'unknown';

/** Longest value we will accept for any dimension. */
const MAX_VALUE_LENGTH = 64;

/**
 * Normalizes one dimension value.
 *
 * @returns The canonical value, or null when the input carries no information.
 *   Null means the dimension becomes ANY — deliberately, because an empty
 *   string is not a scope, and storing it as one would create a value that
 *   matches nothing.
 */
function normalizeValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === SCOPE_UNKNOWN) return SCOPE_UNKNOWN;
  // Lowercase, collapse internal whitespace, strip characters that would make
  // the canonical key ambiguous.
  const cleaned = trimmed.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.:-]/g, '');
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_VALUE_LENGTH);
}

/**
 * Normalizes an arbitrary input into a governed scope.
 *
 * Unknown dimension names are DROPPED, not carried through. Letting a caller
 * invent `scope.vertical` would silently create a seventh dimension that
 * retrieval cannot filter and comparison cannot read — the exact asymmetry
 * C10 exists to remove.
 *
 * @param input Any object; non-objects normalize to an empty (fully ANY) scope.
 * @param opts.allowUnknown Legacy classification only. Normal callers must not
 *   set this: `unknown` scope cannot be created for new memory (C11).
 */
export function normalizeMemoryScope(
  input: unknown,
  opts: { allowUnknown?: boolean } = {},
): NormalizedScope {
  const scope: MemoryScope = {};
  const dropped: string[] = [];
  let unknownCount = 0;

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const src = input as Record<string, unknown>;
    for (const key of Object.keys(src)) {
      if (!(SCOPE_DIMENSIONS as readonly string[]).includes(key)) {
        dropped.push(key);
        continue;
      }
      const value = normalizeValue(src[key]);
      if (value === null) { dropped.push(key); continue; }
      if (value === SCOPE_UNKNOWN) {
        if (!opts.allowUnknown) { dropped.push(key); continue; }
        unknownCount++;
      }
      scope[key as ScopeDimension] = value;
    }
  }

  const bound = (Object.keys(scope) as ScopeDimension[])
    .filter(d => scope[d] !== SCOPE_UNKNOWN).length;

  // Completeness describes what we KNOW, not how narrow the claim is:
  //   unknown  — at least one dimension is explicitly unknown
  //   explicit — every governed dimension is stated
  //   partial  — some stated, the rest deliberately ANY
  const completeness: ScopeCompleteness =
    unknownCount > 0 ? 'unknown'
    : bound === SCOPE_DIMENSIONS.length ? 'explicit'
    : 'partial';

  return {
    scope,
    scopeKey: scopeKey(scope),
    specificity: bound,
    completeness,
    droppedDimensions: dropped,
  };
}

/**
 * Canonical serialization → sha256.
 *
 * Key order is sorted so `{channel, product}` and `{product, channel}` produce
 * the same key. Equality of `scopeKey` is the definition of "same scope", used
 * for idempotency, dedup and the same-scope contradiction test.
 */
export function scopeKey(scope: MemoryScope): string {
  const sorted = (Object.keys(scope) as ScopeDimension[])
    .filter(d => scope[d] !== undefined)
    .sort()
    .map(d => `${d}=${scope[d]}`)
    .join('|');
  return createHash('sha256').update(`v${SCOPE_POLICY_VERSION}:${sorted}`).digest('hex');
}

/** Count of BOUND dimensions. Unknown does not count as specificity. */
export function scopeSpecificity(scope: MemoryScope): number {
  return (Object.keys(scope) as ScopeDimension[])
    .filter(d => scope[d] !== undefined && scope[d] !== SCOPE_UNKNOWN).length;
}

/**
 * How scope B relates to scope A.
 *
 * The result drives the most consequential branch in promotion: an opposing
 * claim on a NARROWER scope is a scoped exception (C13), while the same claim
 * on the SAME scope is a contradiction. Getting this backwards either destroys
 * a valuable exception or lets a narrow finding overwrite a general one.
 *
 * - `same`      identical bound dimensions and values
 * - `narrower`  B binds everything A binds, plus at least one more
 * - `broader`   the reverse
 * - `different` they conflict on a dimension both bind
 * - `unknown`   either side has an explicitly unknown dimension
 */
export function compareMemoryScope(a: MemoryScope, b: MemoryScope): ScopeRelation {
  const hasUnknown = (s: MemoryScope) =>
    (Object.keys(s) as ScopeDimension[]).some(d => s[d] === SCOPE_UNKNOWN);
  if (hasUnknown(a) || hasUnknown(b)) return 'unknown';

  const aKeys = (Object.keys(a) as ScopeDimension[]).filter(d => a[d] !== undefined);
  const bKeys = (Object.keys(b) as ScopeDimension[]).filter(d => b[d] !== undefined);

  // A conflict on any shared dimension makes them different regardless of counts.
  for (const d of aKeys) {
    if (b[d] !== undefined && a[d] !== b[d]) return 'different';
  }

  const aSet = new Set(aKeys);
  const bSet = new Set(bKeys);
  const aSubsetOfB = aKeys.every(d => bSet.has(d));
  const bSubsetOfA = bKeys.every(d => aSet.has(d));

  if (aSubsetOfB && bSubsetOfA) return 'same';
  if (aSubsetOfB) return 'narrower';   // B binds everything A does, and more
  if (bSubsetOfA) return 'broader';
  return 'different';
}

/**
 * Does a memory apply to a query scope?
 *
 * Conservative by construction (C12): for every dimension the MEMORY binds, the
 * query must agree or be silent. A memory that binds nothing applies broadly; a
 * memory that binds `segment=enterprise` never answers an SMB question.
 *
 * A memory with an unknown dimension matches nothing automatically — it is
 * quarantined (C11), and guessing on its behalf is precisely the failure mode.
 */
export function scopeMatches(memory: MemoryScope, query: MemoryScope): boolean {
  for (const d of Object.keys(memory) as ScopeDimension[]) {
    const m = memory[d];
    if (m === undefined) continue;
    if (m === SCOPE_UNKNOWN) return false;
    const q = query[d];
    if (q === undefined) continue;         // query silent → no constraint
    if (q === SCOPE_UNKNOWN) return false;
    if (q !== m) return false;
  }
  return true;
}

/**
 * Is `candidate` a strict scoped exception to `general`? (C13)
 *
 * Requires the candidate to bind at least one dimension the general memory
 * leaves ANY, and to bind strictly more overall. Without the first condition a
 * merely-different scope would masquerade as an exception; without the second,
 * two equally-specific opposing claims would too, and those are contradictions.
 */
export function isScopedExceptionOf(candidate: MemoryScope, general: MemoryScope): boolean {
  if (compareMemoryScope(general, candidate) !== 'narrower') return false;
  const bindsSomethingGeneralLeavesOpen = (Object.keys(candidate) as ScopeDimension[])
    .some(d => candidate[d] !== undefined && candidate[d] !== SCOPE_UNKNOWN && general[d] === undefined);
  return bindsSomethingGeneralLeavesOpen
    && scopeSpecificity(candidate) > scopeSpecificity(general);
}

/** True when this scope may participate in automated belief change (C11). */
export function isGovernedScope(completeness: ScopeCompleteness): boolean {
  return completeness === 'explicit' || completeness === 'partial';
}

/** Owner-readable rendering. Used by the Context Engine and future UX (C23). */
export function describeScope(scope: MemoryScope): string {
  const parts = (Object.keys(scope) as ScopeDimension[])
    .filter(d => scope[d] !== undefined)
    .sort()
    .map(d => `${d.replace(/_/g, ' ')}: ${scope[d] === SCOPE_UNKNOWN ? 'unknown' : scope[d]}`);
  return parts.length ? parts.join(', ') : 'applies generally';
}
