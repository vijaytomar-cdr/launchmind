/**
 * @file generatorClaimDeclaration.ts
 * @description The generator's DECLARATION of what it intended to assert.
 *
 *   Four evaluation passes established that one classifier cannot be the sole
 *   claim-discovery authority: V3 measured 98.3% dangerous recall and 5.6%
 *   creative false positives on corpus #4, with every residual error clustered
 *   in figurative, aphoristic copy. The generator, unlike an auditor, KNOWS what
 *   it meant — so asking it is a third independent signal, not a replacement.
 *
 *   THE INVARIANT THIS FILE EXISTS TO ENFORCE:
 *     the generator may say WHAT it claimed.
 *     it may never say whether the claim is TRUE.
 *
 *   Every field that could express truth, support, authority, approval or
 *   execution is REJECTED by the schema rather than ignored, so a generator
 *   that tries to smuggle one gets a validation error instead of silent
 *   discard — a discarded field is a field somebody may later decide to read.
 *
 *   A declaration is never trusted to be COMPLETE either. `declaredClaims: []`
 *   makes nothing safe; the independent detectors run regardless
 *   (see threeSignalClaimDiscovery).
 *
 * @security Declarations are untrusted model output. They can only ADD claims.
 * @dependencies copyClaimClassifier (frozen vocabulary), zod
 */

import { z } from 'zod';
import { CLAIM_CATEGORIES, type ClaimCategory } from './copyClaimClassifier';
import type { ClaimRequirement } from './semanticClaimClassifier';

/** Same frozen vocabulary as detection. No second taxonomy. */
const DECLARABLE = CLAIM_CATEGORIES.filter(c => c !== 'CREATIVE_NON_FACTUAL');

/**
 * Fields a declaration may NEVER contain.
 *
 * Listed and rejected explicitly rather than stripped: a stripped field is
 * invisible, and the next person to touch this code cannot see that the
 * generator tried to assert authority.
 */
export const FORBIDDEN_DECLARATION_FIELDS = [
  'evidenceIds', 'evidenceHandles', 'evidenceRefs', 'authorityTier',
  'founderAuthority', 'founderConfirmed', 'approvalStatus', 'approved',
  'executionStatus', 'readyForAction', 'confidence', 'truthScore', 'supported',
  'provenance', 'memory',
] as const;

/**
 * The OUTER shape only. Items are validated one at a time.
 *
 * MEASURED DEFECT (corpus #5, run 1) — the reason this exists. Validating the
 * whole declaration as one object meant a SINGLE malformed item discarded every
 * other item with it. On the three hardest items in the corpus the model
 * returned `"comparative"` and `"exclusivity"` — the CORRECT categories, in
 * lower case — and one returned `implied_business_result` for a concept the
 * vocabulary already covers. All three declarations were thrown away whole, so
 * an arm measuring 100% raw recall contributed exactly nothing on the items it
 * was added to catch. The union came out WEAKER than one of its own arms, which
 * is impossible for a real union and is what exposed this.
 */
const OuterSchema = z.object({
  declaredClaims: z.array(z.unknown()).max(60).default([]),
  artifactClaims: z.array(z.unknown()).max(20).default([]),
}).strict();

/** Case is a formatting difference, not a disagreement about the category. */
function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const up = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (DECLARABLE as readonly string[]).includes(up) ? up : null;
}

function normalizeRequirement(raw: unknown): ClaimRequirement {
  const up = String(raw ?? '').trim().toUpperCase();
  return up === 'OWNER_CONFIRMATION' || up === 'PROHIBITED' ? up : 'EVIDENCE';
}

export interface DeclaredClaim {
  fieldId: string;
  textSpan: string;
  category: ClaimCategory;
  requirement: ClaimRequirement;
}

export interface DeclarationOutcome {
  claims: DeclaredClaim[];
  artifactClaims: Array<Omit<DeclaredClaim, 'fieldId'>>;
  /** True when the declaration could not be read. NEVER means "no claims". */
  degraded: boolean;
  /** Every rejected item and why — the audit trail for a hostile generator. */
  rejected: Array<{ reason: string; detail: string }>;
}

/** Normalized containment: whitespace and case must not decide a match. */
function spanPresent(span: string, text: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[\s‘’“”]+/g, ' ').trim();
  return n(text).includes(n(span));
}

/**
 * Validates a generator declaration against the artifact it accompanies.
 *
 * @param raw    the `declaredClaims`/`artifactClaims` object from generation
 * @param fields the fields actually generated, for id and span verification
 * @returns only claims that survive validation; `degraded` when unreadable
 * @security A claim naming a field that was not generated, or a span absent
 *   from that field, is a claim about content that does not exist — rejected,
 *   because accepting it would let a generator attach a category to text the
 *   owner will never see.
 */
export function validateDeclaration(
  raw: unknown, fields: ReadonlyArray<{ name: string; text: string }>,
): DeclarationOutcome {
  const rejected: DeclarationOutcome['rejected'] = [];

  const outer = OuterSchema.safeParse(raw ?? {});
  if (!outer.success) {
    // Degraded, NOT empty. The caller must still run independent detection.
    return {
      claims: [], artifactClaims: [], degraded: true,
      rejected: [{ reason: 'SCHEMA_REJECTED', detail: outer.error.issues[0]?.message ?? 'invalid' }],
    };
  }

  const byId = new Map(fields.map(f => [f.name, f.text]));
  const claims: DeclaredClaim[] = [];
  const artifactClaims: Array<Omit<DeclaredClaim, 'fieldId'>> = [];
  const seen = new Set<string>();
  // A generator that tries to assert truth, authority, approval or execution is
  // not making a formatting mistake. Its whole declaration is discarded and the
  // run is degraded — one item dropped would understate what just happened.
  let hostile = false;

  const readItem = (item: unknown, needFieldId: boolean): DeclaredClaim | null => {
    if (typeof item !== 'object' || item === null) {
      rejected.push({ reason: 'NOT_AN_OBJECT', detail: String(item).slice(0, 40) });
      return null;
    }
    const rec = item as Record<string, unknown>;
    const forbidden = FORBIDDEN_DECLARATION_FIELDS.filter(f => f in rec);
    if (forbidden.length > 0) {
      hostile = true;
      rejected.push({ reason: 'FORBIDDEN_FIELD', detail: forbidden.join(',') });
      return null;
    }
    const allowed = new Set(['fieldId', 'textSpan', 'category', 'requirement']);
    const unknownKeys = Object.keys(rec).filter(k => !allowed.has(k));
    if (unknownKeys.length > 0) {
      rejected.push({ reason: 'UNKNOWN_FIELD', detail: unknownKeys.join(',') });
      return null;
    }

    const textSpan = typeof rec.textSpan === 'string' ? rec.textSpan.slice(0, 500) : '';
    if (!textSpan.trim()) { rejected.push({ reason: 'EMPTY_SPAN', detail: '' }); return null; }

    const fieldId = needFieldId ? String(rec.fieldId ?? '') : 'ARTIFACT';
    if (needFieldId) {
      const text = byId.get(fieldId);
      if (text === undefined) { rejected.push({ reason: 'UNKNOWN_FIELD_ID', detail: fieldId }); return null; }
      if (!spanPresent(textSpan, text)) {
        rejected.push({ reason: 'SPAN_NOT_IN_FIELD', detail: `${fieldId}: ${textSpan.slice(0, 60)}` });
        return null;
      }
    }

    // An unrecognised label is still the generator saying "this is a claim".
    // Discarding it would throw away the assertion along with the word for it,
    // so it is kept at the class that requires evidence and explains nothing.
    let category = normalizeCategory(rec.category);
    if (!category) {
      rejected.push({ reason: 'UNKNOWN_CATEGORY_KEPT_AS_OTHER', detail: String(rec.category).slice(0, 40) });
      category = 'OTHER_FACTUAL_CLAIM';
    }

    return {
      fieldId, textSpan,
      category: category as ClaimCategory,
      requirement: normalizeRequirement(rec.requirement),
    };
  };

  for (const item of outer.data.declaredClaims) {
    const parsedItem = readItem(item, true);
    if (!parsedItem) continue;
    const key = `${parsedItem.fieldId}::${parsedItem.category}::${parsedItem.textSpan}`;
    if (seen.has(key)) { rejected.push({ reason: 'DUPLICATE', detail: key.slice(0, 80) }); continue; }
    seen.add(key);
    claims.push(parsedItem);
  }
  for (const item of outer.data.artifactClaims) {
    const parsedItem = readItem(item, false);
    if (parsedItem) {
      artifactClaims.push({
        textSpan: parsedItem.textSpan, category: parsedItem.category,
        requirement: parsedItem.requirement,
      });
    }
  }

  if (hostile) return { claims: [], artifactClaims: [], degraded: true, rejected };
  return { claims, artifactClaims, degraded: false, rejected };
}

/** Instruction appended to generation. NOT a safety boundary — see file header. */
export const DECLARATION_PROMPT = `
Alongside the content, return a declaration of the claims you INTENDED to make:

{"declaredClaims":[{"fieldId":string,"textSpan":string,"category":string,"requirement":string}],
 "artifactClaims":[{"textSpan":string,"category":string,"requirement":string}]}

DECLARE every factual or substantiation-sensitive claim, including:
- implied claims and figurative business-result promises
  ("Your funnel, unclogged", "Give tired creative a second wind")
- first-party performance implications, including rankings
  ("Your best channel is not the one you think")
- comparative, superlative and exclusivity claims
- capability, pricing, geography, customer counts, social proof
- security, compliance, guarantees, endorsements

DO NOT declare purely creative language:
- "Marketing, less scattered." · "Build momentum." · "A calmer way to work."

DO NOT declare a claim as true. DO NOT cite evidence. DO NOT include
evidence ids, authority, confidence, approval or execution fields — the schema
rejects them. Whether a claim is SUPPORTED is decided by the server, not by you.

A claim you omit will still be found by independent detection. Declaring
honestly does not make content safe; it makes the reason for a rejection clear.
`;
