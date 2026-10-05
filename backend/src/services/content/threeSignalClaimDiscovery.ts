/**
 * @file threeSignalClaimDiscovery.ts
 * @description Union of THREE independent claim signals, then grounding.
 *
 *   Generator declaration ∪ deterministic detection ∪ semantic V3 audit.
 *
 *   WHY A NEW FILE RATHER THAN EDITING THE UNION IN PLACE: V3 is frozen at
 *   880e99cda2d9e158, and that hash covers hybridClaimDetection.ts. Extending
 *   the union there would have broken the freeze this pass is required to
 *   preserve. This module CALLS the frozen detector and adds the third signal
 *   around it.
 *
 *   NO MAJORITY VOTE. Two signals calling something creative cannot overturn one
 *   calling it a claim. That is the whole point of independence — a vote would
 *   let the two weakest agree away the one that was right, and every residual
 *   error measured across four corpora sits exactly where signals disagree.
 *
 *   A DECLARATION CAN ONLY ADD. `declaredClaims: []` makes nothing safe.
 *
 * @security The union is the safety boundary; grounding is the truth boundary.
 *   Neither can be satisfied by anything the generator says about itself.
 * @dependencies hybridClaimDetection (FROZEN V3), generatorClaimDeclaration,
 *   contentClaimPolicy, growthBrainOutputGrounding
 */

import { detectClaims, type ContentField, type DetectOptions } from './hybridClaimDetection';
import { validateDeclaration, type DeclarationOutcome } from './generatorClaimDeclaration';
import { dispositionFor, strictestDisposition, ownerConfirmationSatisfied,
         type ClaimDisposition } from './contentClaimPolicy';
import type { ClaimCategory } from './copyClaimClassifier';
import type { EvidenceHandle } from '../growthBrainOutputGrounding';
import { extractQuantities, distinctiveSubjectTokens } from '../memory/evidenceSupportPolicy';

export type ClaimSource = 'GENERATOR' | 'DETERMINISTIC' | 'SEMANTIC' | 'MULTIPLE';

export interface UnifiedClaim {
  field: string;
  textSpan: string;
  category: ClaimCategory;
  /** Internal audit only. NEVER shown to an owner, and never a strength signal. */
  sources: ClaimSource[];
  disposition: ClaimDisposition;
}

export interface DiscoveryOutcome {
  /**
   * The artifact could not be certified claim-free.
   *
   * Parity with DetectionOutcome, and NOT the same as `claims.length > 0`: a
   * degraded run found nothing precisely because a signal was broken. Corpus #5
   * run 1 measured `claims.length > 0` and scored three degraded items as
   * MISSES, which is how the union appeared weaker than one of its own arms.
   */
  containsClaim: boolean;
  claims: UnifiedClaim[];
  overallDisposition: ClaimDisposition;
  /** Any signal failed. The artifact cannot be certified claim-free. */
  degraded: boolean;
  degradedReasons: string[];
  /** Generator and auditors disagreed about a span. Recorded, never resolved. */
  disagreements: Array<{ field: string; textSpan: string; declaredBy: ClaimSource[]; missedBy: ClaimSource[] }>;
  declarationRejected: DeclarationOutcome['rejected'];
}

/**
 * Discovers claims from all three signals.
 *
 * @param fields          generated owner-visible fields
 * @param rawDeclaration  the generator's declaration, untrusted
 */
export async function discoverClaims(
  fields: readonly ContentField[],
  rawDeclaration: unknown,
  opts: DetectOptions = {},
): Promise<DiscoveryOutcome> {
  const declaration = validateDeclaration(rawDeclaration, fields);
  // FROZEN V3 — deterministic ∪ semantic, called, never modified.
  const detected = await detectClaims(fields, opts);

  const merged = new Map<string, UnifiedClaim>();
  const key = (field: string, span: string, cat: string) =>
    `${field}::${cat}::${span.toLowerCase().trim()}`;

  const add = (
    field: string, textSpan: string, category: ClaimCategory,
    source: ClaimSource, disposition: ClaimDisposition,
  ) => {
    const k = key(field, textSpan, category);
    const existing = merged.get(k);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      // Merge NEVER weakens policy.
      const stricter = strictestDisposition([existing.category, category]);
      if (severity(stricter) < severity(existing.disposition)) existing.disposition = stricter;
      return;
    }
    merged.set(k, { field, textSpan, category, sources: [source], disposition });
  };

  for (const c of declaration.claims) {
    add(c.fieldId, c.textSpan, c.category, 'GENERATOR', dispositionFor(c.category));
  }
  for (const c of declaration.artifactClaims) {
    add('ARTIFACT', c.textSpan, c.category, 'GENERATOR', dispositionFor(c.category));
  }
  for (const c of detected.claims) {
    add(c.field, c.textSpan, c.category, c.source === 'BOTH' ? 'MULTIPLE' : c.source, c.disposition);
  }

  const claims = [...merged.values()];
  for (const c of claims) if (c.sources.length > 1) c.sources = ['MULTIPLE', ...c.sources];

  // Disagreement is RECORDED, not resolved. Ambiguous figurative copy is where
  // every residual error lives; flattening it to a verdict would hide exactly
  // the cases that need a human eventually.
  const disagreements = claims
    .filter(c => !c.sources.includes('MULTIPLE'))
    .map(c => ({
      field: c.field, textSpan: c.textSpan,
      declaredBy: c.sources,
      missedBy: (['GENERATOR', 'DETERMINISTIC', 'SEMANTIC'] as ClaimSource[])
        .filter(s => !c.sources.includes(s)),
    }));

  const degradedReasons = [...detected.degradedReasons];
  if (declaration.degraded) degradedReasons.push('generator declaration unreadable');

  const degraded = degradedReasons.length > 0;
  return {
    containsClaim: claims.length > 0 || degraded,
    claims,
    overallDisposition: claims.length > 0
      ? strictestDisposition(claims.map(c => c.category))
      : degraded ? 'REQUIRES_EVIDENCE' : 'ALLOWED_CREATIVE',
    degraded,
    degradedReasons,
    disagreements,
    declarationRejected: declaration.rejected,
  };
}

const SEV: Record<ClaimDisposition, number> = {
  PROHIBITED_IN_3_5: 0, REQUIRES_OWNER_CONFIRMATION: 1,
  REQUIRES_EVIDENCE: 2, ALLOWED_CREATIVE: 3,
};
const severity = (d: ClaimDisposition) => SEV[d];

// ── GROUNDING: the truth boundary ───────────────────────────────────────────

export type ClaimVerdict = 'SUPPORTED' | 'UNSUPPORTED' | 'NEEDS_OWNER_CONFIRMATION' | 'PROHIBITED';

export interface GroundedClaimResult {
  claim: UnifiedClaim;
  verdict: ClaimVerdict;
  /** Owner-safe labels of what supports it. Never handles or ids. */
  support: string[];
  reason: string;
  /** Why it failed, for audit. Never rendered to an owner verbatim. */
  failure?: 'NO_EVIDENCE_OF_THIS_KIND' | 'EVIDENCE_DOES_NOT_MENTION_THIS'
          | 'EVIDENCE_DOES_NOT_CARRY_THIS_FIGURE';
}

/**
 * Does this evidence actually SUBSTANTIATE this claim, or merely sit in the
 * right category?
 *
 * MEASURED WEAKNESS THIS CLOSES: kind-matching alone made "Integrates with
 * Shopify" supported by ANY product profile, because PRODUCT_CONTEXT is an
 * admissible kind for CAPABILITY. Every product has a profile, so the check
 * passed for every product — including ones with no Shopify integration. That
 * is the same defect ADR-070 §1 recorded for the qualitative branch, arriving
 * through a different door.
 *
 * Two rules, in order of how badly they can be faked:
 *   A FIGURE cannot be inferred. If the claim states one, the evidence must
 *     carry that same figure, or the number was invented.
 *   A SUBJECT can be paraphrased, so overlap of distinctive tokens is enough —
 *     but "Shopify" against a profile that never mentions Shopify shares none.
 */
/**
 * The SAME word in its adverb and adjective form — "quickly"/"quick",
 * "safely"/"safe", "conveniently"/"convenient" — for one English suffix rule
 * only (adverb = adjective + "ly").
 *
 * NOT a synonym table and not fuzzy matching: it names a single deterministic
 * spelling transformation and returns nothing for any other pair of words, so
 * it cannot bridge two different words the way a similarity or semantic
 * matcher could. Applied only here, at substantiation, not to the shared
 * `distinctiveSubjectTokens`/`stemToken` — this file's grounding is the one
 * place a supported quality is being reworded, not e.g. Marketing Memory
 * retrieval, so widening those shared functions would reach further than the
 * defect requires.
 *
 * MEASURED: on the real AllignX Plumbing brief, the evidence's own tagline —
 * "…quickly, safely, and conveniently" — was restated by the generator as
 * "quick and convenient", the identical supported qualities in adjective form,
 * and grounding rejected it as a claim evidence "does not mention" at all.
 *
 * @security A minimum stem length guards against a degenerate strip (e.g. a
 *   4-letter word ending in "ly" reducing to a 2-letter fragment) accidentally
 *   colliding with an unrelated short evidence token.
 */
function adverbAdjectiveEquivalents(token: string): string[] {
  if (/^[a-z]+$/.test(token) && token.endsWith('ly') && token.length - 2 >= 3) {
    return [token.slice(0, -2)];
  }
  return [`${token}ly`];
}

/** Comparable form: lower case, punctuation to spaces, whitespace collapsed. */
function comparable(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Is this span the product's OWN description, restated?
 *
 * TRUE only when the span appears as a CONTIGUOUS run of words inside a
 * PRODUCT_CONTEXT evidence body. Contiguity is the whole safeguard: a model
 * cannot assemble a new assertion out of scattered words and have it accepted,
 * because the words must appear together, in order, exactly as the product's
 * own description states them.
 *
 * @security Restricted to PRODUCT_CONTEXT — the description the owner
 *   confirmed. Campaign performance and market intelligence are deliberately
 *   excluded: this rescues a RESTATEMENT of product truth, never a claim about
 *   results, competitors or customers. A minimum length stops a two-word
 *   fragment ("your neighborhood") from carrying an invented sentence.
 */
function restatesProductTruth(
  claimText: string, handles: readonly EvidenceHandle[],
): EvidenceHandle | null {
  const span = comparable(claimText);
  // Four words is long enough to be a restatement rather than an incidental
  // word overlap, and short enough to cover "trusted, vetted professionals".
  if (span.split(' ').filter(Boolean).length < 4) return null;
  for (const h of handles) {
    if (h.kind !== 'PRODUCT_CONTEXT') continue;
    if (comparable(h.text ?? '').includes(span)) return h;
  }
  return null;
}

function substantiates(claimText: string, handle: EvidenceHandle): {
  ok: boolean; failure?: GroundedClaimResult['failure'];
} {
  const claimQuantities = extractQuantities(claimText)
    .filter(q => q.startsWith('pct:') || q.startsWith('cur:')
              || q.startsWith('mult:') || q.startsWith('scale:'));
  if (claimQuantities.length > 0) {
    const evidenceQuantities = new Set(extractQuantities(handle.text ?? ''));
    // Bare `num:` on the evidence side counts: "31%" in copy against "31" in a
    // metrics string is the same measurement, differently formatted.
    const evidenceBare = new Set(extractQuantities(handle.text ?? '')
      .filter(q => q.startsWith('num:')).map(q => q.slice(4)));
    const matched = claimQuantities.some(q =>
      evidenceQuantities.has(q) || evidenceBare.has(q.split(':')[1]));
    if (!matched) return { ok: false, failure: 'EVIDENCE_DOES_NOT_CARRY_THIS_FIGURE' };
    return { ok: true };
  }

  const claimTokens = distinctiveSubjectTokens(claimText);
  if (claimTokens.size === 0) return { ok: true };   // nothing distinctive to match
  const evidenceTokens = distinctiveSubjectTokens(handle.text ?? '');
  for (const t of claimTokens) {
    if (evidenceTokens.has(t)) return { ok: true };
    if (adverbAdjectiveEquivalents(t).some(eq => evidenceTokens.has(eq))) return { ok: true };
  }
  return { ok: false, failure: 'EVIDENCE_DOES_NOT_MENTION_THIS' };
}

export interface GroundingOutcome {
  results: GroundedClaimResult[];
  /** True only when EVERY claim is supported and nothing degraded. */
  publishable: boolean;
  blockedReasons: string[];
}

/**
 * Evidence kinds that can substantiate each claim class.
 *
 * FIRST_PARTY_PERFORMANCE accepts only CAMPAIGN_PERFORMANCE — this is the rule
 * that stops a competitor's Market Intelligence figure, or a founder's stated
 * goal, from standing behind "your campaigns convert 31% better".
 */
const SUPPORTING_KINDS: Partial<Record<ClaimCategory, string[]>> = {
  FIRST_PARTY_PERFORMANCE: ['CAMPAIGN_PERFORMANCE'],
  QUANTIFIED_PERFORMANCE:  ['CAMPAIGN_PERFORMANCE', 'MARKET_INTELLIGENCE', 'MARKETING_MEMORY'],
  CAPABILITY:              ['PRODUCT_CONTEXT', 'MARKETING_MEMORY'],
  COMPETITOR_CLAIM:        ['MARKET_INTELLIGENCE'],
  COMPARATIVE:             ['MARKET_INTELLIGENCE', 'CAMPAIGN_PERFORMANCE'],
  SUPERLATIVE:             ['MARKET_INTELLIGENCE'],
  EXCLUSIVITY:             ['MARKET_INTELLIGENCE'],
  CUSTOMER_COUNT:          ['CAMPAIGN_PERFORMANCE', 'MARKETING_MEMORY'],
  SOCIAL_PROOF:            ['MARKET_INTELLIGENCE', 'MARKETING_MEMORY'],
  PRICING:                 ['PRODUCT_CONTEXT'],
  GEOGRAPHIC_AVAILABILITY: ['PRODUCT_CONTEXT'],
  OUTCOME_PROMISE:         ['CAMPAIGN_PERFORMANCE', 'MARKETING_MEMORY'],
  OTHER_FACTUAL_CLAIM:     ['CAMPAIGN_PERFORMANCE', 'MARKETING_MEMORY', 'PRODUCT_CONTEXT'],
};

/**
 * Decides support for every discovered claim, using governed evidence only.
 *
 * @param handles   server-issued evidence for THIS request
 * @param confirmed categories the owner explicitly confirmed
 * @security Nothing the generator declared participates in this decision.
 */
export function groundDiscoveredClaims(
  discovery: DiscoveryOutcome,
  handles: readonly EvidenceHandle[],
  confirmed: readonly string[] = [],
): GroundingOutcome {
  const results: GroundedClaimResult[] = [];
  const blocked: string[] = [];

  for (const claim of discovery.claims) {
    if (claim.disposition === 'PROHIBITED_IN_3_5') {
      results.push({ claim, verdict: 'PROHIBITED', support: [],
        reason: 'This claim class cannot be used in Phase 3.5.' });
      blocked.push(`${claim.field}: prohibited claim`);
      continue;
    }
    if (claim.disposition === 'REQUIRES_OWNER_CONFIRMATION') {
      const ok = ownerConfirmationSatisfied(claim.category, confirmed);
      results.push({
        claim, verdict: ok ? 'SUPPORTED' : 'NEEDS_OWNER_CONFIRMATION',
        support: ok ? ['Your confirmed statement'] : [],
        reason: ok ? 'Confirmed by the owner.'
                   : 'LaunchMind cannot verify this — it needs your explicit confirmation.',
      });
      if (!ok) blocked.push(`${claim.field}: needs owner confirmation`);
      continue;
    }

    // ── RESTATEMENT OF CONFIRMED PRODUCT TRUTH ───────────────────────────
    //
    // THE CONVERGENCE TRAP THIS CLOSES, measured on the real AllignX Plumbing
    // run. The product's own description ends "— quickly, safely, and
    // conveniently". The generator quoted it verbatim. The GENERATOR arm read
    // the whole sentence as CAPABILITY and grounded it SUPPORTED; the SEMANTIC
    // arm separately extracted the bare fragment "quickly, safely, and
    // conveniently" and labelled it OUTCOME_PROMISE — a category whose
    // SUPPORTING_KINDS deliberately exclude PRODUCT_CONTEXT. Union rules mean
    // the fragment's UNSUPPORTED verdict wins, so the product's OWN WORDS
    // could never survive, however the model phrased them. The model's safest
    // possible move was structurally impossible, which is why six owner
    // retries could not converge.
    //
    // NOT A LOOSENING. This rescues exactly one thing: text that is verbatim
    // present in the owner-confirmed product description. An invented outcome
    // ("booked within two hours") is not a substring of that description and
    // still fails. Quantities are unaffected — `substantiates` decides those
    // separately and a figure absent from evidence still fails. Restating what
    // the product says about itself must be the one move that always works.
    const restated = restatesProductTruth(claim.textSpan, handles);
    if (restated) {
      results.push({ claim, verdict: 'SUPPORTED', support: [restated.label],
        reason: 'This is the product’s own description, restated.' });
      continue;
    }

    const allowed = SUPPORTING_KINDS[claim.category] ?? [];
    const capable = handles.filter(h => allowed.includes(h.kind));
    if (capable.length === 0) {
      results.push({ claim, verdict: 'UNSUPPORTED', support: [],
        reason: 'No evidence LaunchMind holds can substantiate this claim.',
        failure: 'NO_EVIDENCE_OF_THIS_KIND' });
      blocked.push(`${claim.field}: unsupported ${claim.category}`);
      continue;
    }

    // Right KIND is necessary, not sufficient.
    const supporting: EvidenceHandle[] = [];
    let lastFailure: GroundedClaimResult['failure'] = 'EVIDENCE_DOES_NOT_MENTION_THIS';
    for (const h of capable) {
      const verdict = substantiates(claim.textSpan, h);
      if (verdict.ok) supporting.push(h);
      else if (verdict.failure) lastFailure = verdict.failure;
    }
    if (supporting.length === 0) {
      results.push({ claim, verdict: 'UNSUPPORTED', support: [],
        reason: lastFailure === 'EVIDENCE_DOES_NOT_CARRY_THIS_FIGURE'
          ? 'LaunchMind holds performance data, but not this figure.'
          : 'LaunchMind holds evidence of this kind, but none of it mentions this.',
        failure: lastFailure });
      blocked.push(`${claim.field}: unsupported ${claim.category}`);
      continue;
    }
    results.push({ claim, verdict: 'SUPPORTED', support: supporting.map(h => h.label),
      reason: 'Supported by evidence LaunchMind holds.' });
  }

  if (discovery.degraded) blocked.push('claim discovery degraded');
  return { results, publishable: blocked.length === 0, blockedReasons: blocked };
}
