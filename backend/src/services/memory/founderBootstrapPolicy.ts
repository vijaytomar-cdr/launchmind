/**
 * @file founderBootstrapPolicy.ts
 * @description GOVERNED admission for founder onboarding context.
 *
 *   WHY A SPECIAL PATH IS JUSTIFIED:
 *     Routing founder prose through the provider Gate A rejects it as
 *     RAW_PROVIDER_PROSE — measured. That rule is right for provider text and
 *     incoherent for a founder stating their own ICP. Without a bootstrap path a
 *     new founder has no memory at all.
 *
 *   WHY THE CURRENT BYPASS IS STILL WRONG:
 *     `completePhase1()` batch-INSERTs legacy-shaped rows — memory_class NULL,
 *     authority NULL, no policy version, no provenance, evidence_ids [] and a
 *     hardcoded confidence. They survive only because the legacy discriminator
 *     exempts `memory_class IS NULL`, which exists for PRE-EXISTING rows, not as
 *     a licence for a live writer to keep minting new ones.
 *
 *   SEPARATION THIS FILE INSISTS ON:
 *     AUTHORITY  answers WHO said it        → FOUNDER_ASSERTED (maximal)
 *     CLASS      answers HOW IT BEHAVES     → per semantics, below
 *     CONFIDENCE answers HOW WELL MEASURED  → nothing was measured
 *
 * @security Admits only fields the founder explicitly entered or confirmed.
 *   AI-prefilled but unconfirmed values are refused — a suggestion the founder
 *   never looked at is not a founder assertion.
 * @dependencies authorityPolicy, scopePolicy
 */

import { createHash } from 'crypto';
import { AUTHORITY_POLICY_VERSION } from './authorityPolicy';
import { normalizeMemoryScope } from './scopePolicy';

export const BOOTSTRAP_POLICY_VERSION = 1;

/** The `source` value written by this path (migration 107). */
export const BOOTSTRAP_SOURCE = 'founder_bootstrap';

/**
 * CONFIDENCE SEMANTICS.
 *
 * The schema requires NUMERIC(3,2), so the field cannot simply be omitted. The
 * old code wrote 0.80 / 0.85 / 0.90 / 0.95 — a hand-ranked gradient of how much
 * its author trusted each CATEGORY, invariant to evidence and re-derived by
 * nothing. That number asserts an empirical precision no one established.
 *
 * One declared constant replaces all four. It is deliberately NOT 1.0: founder
 * authority is maximal, but empirical certainty about a market belief is not
 * something a founder statement establishes. The value is meaningless on its own
 * and MUST be read together with `authority_tier = FOUNDER_ASSERTED`, which is
 * where the real signal lives.
 */
export const UNMEASURED_FOUNDER_ASSERTION = 0.50;

export type BootstrapCategory = 'audience' | 'context_delta' | 'goal' | 'competitors';
export type MemoryClass = 'DIRECTIVE' | 'FACT' | 'LEARNING' | 'DECISION';

/**
 * CLASS MAPPING — reviewed, not inherited from the earlier proposal.
 *
 * The earlier sketch made `audience` a DIRECTIVE because a founder said it. That
 * conflates authority with class. Class governs LIFECYCLE and SEMANTIC
 * behaviour; authority already records who spoke.
 *
 *   audience       FACT      A statement about who the customers ARE. It can be
 *                            contradicted by observation and should be
 *                            supersedable by evidence — DIRECTIVE would make it
 *                            an instruction to LaunchMind, which it is not.
 *   context_delta  FACT      A statement about what is changing in the business.
 *                            Time-bounded, observable, correctable.
 *   goal           DECISION  A chosen objective with a horizon. Not a fact about
 *                            the world and not an instruction about behaviour —
 *                            it is a choice, which is exactly DECISION.
 *   competitors    FACT      Who else exists in the market. Externally checkable.
 *
 * No category maps to DIRECTIVE. A DIRECTIVE governs what LaunchMind may DO
 * ("never post without approval"); onboarding collects none of those. Boundary
 * policies are stored separately and are not bootstrap memory.
 */
export const BOOTSTRAP_CLASS: Record<BootstrapCategory, MemoryClass> = {
  audience:      'FACT',
  context_delta: 'FACT',
  goal:          'DECISION',
  competitors:   'FACT',
};

export interface BootstrapSourceRef {
  table: 'founder_context' | 'business_goals' | 'competitor_relationships';
  rowId: string;
  field: string;
}

export interface FounderBootstrapCandidate {
  workspaceId: string;
  productId: string | null;
  founderId: string;
  category: BootstrapCategory;
  title: string;
  content: Record<string, unknown>;
  /** The canonical row this was derived from — reconstructible provenance. */
  sourceRef: BootstrapSourceRef;
  /** True only when the founder entered or explicitly confirmed the value. */
  founderConfirmed: boolean;
}

export interface BootstrapAdmission {
  admit: boolean;
  reason: string;
  row?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Deterministic identity so replay — resume, refresh, a re-run of
 * completePhase1 — cannot duplicate bootstrap memory.
 *
 * Keyed on workspace + product + category + the SOURCE ROW, not on wording, so a
 * re-render of the same founder statement is the same memory.
 */
export function bootstrapIdempotencyKey(c: FounderBootstrapCandidate): string {
  return createHash('sha256').update([
    c.workspaceId, c.productId ?? '-', c.category, c.sourceRef.table, c.sourceRef.rowId, c.sourceRef.field,
  ].join('|')).digest('hex');
}

/**
 * Governed admission. Returns the FULLY GOVERNED row to write, or a refusal.
 *
 * @param c - candidate derived from canonical onboarding state
 * @returns admission decision; the caller performs the write
 * @security Refuses anything the founder did not explicitly confirm.
 */
export function admitFounderBootstrap(c: FounderBootstrapCandidate): BootstrapAdmission {
  if (!c.workspaceId) return { admit: false, reason: 'no workspace: bootstrap memory is workspace-owned' };
  if (!c.founderId)   return { admit: false, reason: 'no founder attribution' };

  // AI-prefilled but unconfirmed values are NOT founder assertions.
  if (!c.founderConfirmed) {
    return { admit: false, reason: 'value was not explicitly entered or confirmed by the founder' };
  }
  const text = JSON.stringify(c.content ?? {});
  if (!text || text.length < 12) {
    return { admit: false, reason: 'candidate carries no substantive founder content' };
  }

  const memoryClass = BOOTSTRAP_CLASS[c.category];
  // Founder statements about the business as a whole are legitimately
  // workspace-wide; product scope is bound where a product is known.
  const scope = normalizeMemoryScope(c.productId ? { product: c.productId } : {});
  const idempotencyKey = bootstrapIdempotencyKey(c);

  return {
    admit: true,
    reason: `founder-confirmed ${c.category} admitted as ${memoryClass} under FOUNDER_ASSERTED`,
    idempotencyKey,
    row: {
      workspace_id: c.workspaceId,
      product_id: c.productId,
      founder_id: c.founderId,
      memory_type: c.category === 'competitors' ? 'competitor'
        : c.category === 'goal' ? 'founder'
        : c.category === 'audience' ? 'customer' : 'product',
      title: c.title,
      content: { ...c.content, sourceRef: c.sourceRef },
      source: BOOTSTRAP_SOURCE,
      memory_class: memoryClass,
      authority_tier: 'FOUNDER_ASSERTED',
      authority_policy_version: AUTHORITY_POLICY_VERSION,
      confidence_policy_version: BOOTSTRAP_POLICY_VERSION,
      // See UNMEASURED_FOUNDER_ASSERTION. Not a measurement, and not 1.0.
      confidence: UNMEASURED_FOUNDER_ASSERTION,
      scope: scope.scope,
      scope_key: scope.scopeKey,
      scope_specificity: scope.specificity,
      scope_completeness: scope.completeness,
      // Founder assertions cite no provider evidence; provenance is the
      // canonical row, carried in content.sourceRef.
      evidence_ids: [],
      status: 'active',
      version: 1,
    },
  };
}
