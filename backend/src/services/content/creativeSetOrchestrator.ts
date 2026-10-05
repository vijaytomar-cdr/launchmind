/**
 * @file creativeSetOrchestrator.ts
 * @description Produces a reviewable A/B/C set — Phase 3.5B6.8 §4, §5, §6, §7.
 *
 *   THE PROBLEM THIS SOLVES. B6.7 generated three concepts and hoped. If one
 *   came back wrong the whole set was wrong, and the only lever was rewording
 *   the shared prompt — which is why fixing B kept breaking A. Measured: 1 in 5
 *   sets was clean.
 *
 *   FOUR RULES, in order:
 *
 *     1. EACH CONCEPT IS GENERATED ALONE, against its own structural contract.
 *        No sibling's wording is in scope, so B cannot pull A toward it.
 *
 *     2. EACH CONCEPT IS VALIDATED against normal governance AND its role.
 *        A concept that is factually safe but structurally wrong is not done.
 *
 *     3. ONLY THE FAILED CONCEPT IS RETRIED. A valid sibling is finished work
 *        and regenerating it is both wasteful and destabilising — it was how
 *        B6.7 turned one bad concept into a different bad set.
 *
 *     4. THE SET IS VALIDATED LAST, after every concept is individually valid,
 *        because three individually correct concepts can still say one thing.
 *
 *   SIBLINGS ARE NOT EVIDENCE, and this is the security-relevant part. A retry
 *   is told the SHAPE its siblings took — "another version already opens with a
 *   question" — and never their claims, their wording or their copy. Generated
 *   text has no authority; letting one generation's output become another's
 *   context would create a claim that nothing grounded.
 *
 * @security Generates and validates only. No persistence, no approval, no
 *   provider action beyond the generation call each concept already makes.
 * @dependencies b3ContentGeneration, creativeConceptContract, creativeConcepts,
 *   productCapabilityContract
 */

import { generateChannelContent, type ChannelContentResult } from './b3ContentGeneration';
import { deriveContentBrief } from './briefComposition';
import {
  CONCEPT_CONTRACTS, conceptContractDirective, validateConceptRole,
  validateSetDistinctness, classifyHeadlineShape,
  type ConceptViolation,
} from './creativeConceptContract';
import { CONCEPTS, CONCEPT_KEYS, type ConceptKey } from './creativeConcepts';
import { buildProductCapabilityContract, validatePayloadCapabilities }
  from './productCapabilityContract';
import type { ProductContentContext } from './productContentContext';
import type { ContentStrategy } from './strategyComposition';
import type { DetectOptions } from './hybridClaimDetection';
import { evaluateCreativeConceptQuality, type CreativeQualityVerdict }
  from './creativeQualityGate';
import { buildCreativeBriefContract, type CreativeBriefContract }
  from './creativeBriefContract';

/**
 * How many times one concept may be re-attempted.
 *
 * Bounded concept repairs consume governance and quality feedback internally.
 * Production disables the nested rewrite loop so this bound controls copy calls.
 */
export const MAX_CONCEPT_ATTEMPTS = 3;

export interface ConceptOutcome {
  key: ConceptKey;
  /** Owner-safe name. */
  name: string;
  result: ChannelContentResult | null;
  attempts: number;
  /** Empty when the concept is complete. */
  conceptViolations: ConceptViolation[];
  capabilityViolations: string[];
  /** Strategy quality, separate from factual eligibility and performance. */
  quality: CreativeQualityVerdict | null;
  creativeBrief: CreativeBriefContract | null;
  /** Terminal state for this concept. */
  status: 'READY' | 'NEEDS_ATTENTION' | 'FAILED';
  /** Owner-safe sentence. Never an enum. */
  ownerReason: string | null;
}

export interface CreativeSetOutcome {
  concepts: ConceptOutcome[];
  setDistinct: boolean;
  /** Owner-safe. Null when the set is fine. */
  setReason: string | null;
  readyCount: number;
  /** Every generation call made, for cost visibility. */
  totalGenerations: number;
  /** Developer timing only; not part of owner-facing creative content. */
  timingsMs?: Partial<Record<ConceptKey, number>>;
}

export interface SetInput {
  ctx: ProductContentContext;
  strategy: ContentStrategy;
  founderId: string;
  channel?: 'META_AD';
  /** Test seam ONLY. */
  generate?: (system: string, user: string) => Promise<string>;
  semantic?: DetectOptions['semantic'];
  /** Which concepts to produce. Defaults to all three. */
  only?: readonly ConceptKey[];
  /** Bounded art-direction signals. They influence structure, never truth. */
  creativePatterns?: readonly string[];
  /** Product-specific observed learning, empty until real performance exists. */
  firstPartyLearning?: readonly string[];
  /** Owner package cost/latency bound. Tests and offline evaluation keep the established default. */
  maxConceptAttempts?: number;
  /** Production package seam: independent first attempts may fan out together. */
  parallelInitial?: boolean;
}

/** Structural description of a sibling. Shape only — never its words. */
function siblingShapeNote(produced: ReadonlyArray<{ key: ConceptKey; headline: string }>): string {
  if (produced.length === 0) return '';
  const shapes = produced.map(p => {
    const s = classifyHeadlineShape(p.headline);
    return s === 'QUESTION' ? 'a question'
      : s === 'NORMATIVE' ? 'a should/ought statement'
      : s === 'CAPABILITY' ? 'a plain statement of what the product does'
      : s === 'HYPOTHETICAL' ? 'a hypothetical'
      : s === 'HEDGE' ? 'a hedged description' : 'another shape';
  });
  // SHAPES, NOT CLAIMS. The retry learns what to avoid structurally and learns
  // nothing it could mistake for a fact about the product.
  return `\nAnother version in this set already opens with ${[...new Set(shapes)].join(' and ')}. ` +
    `Do not open the same way.\n`;
}

/**
 * Produces the set.
 *
 * @security Every concept passes the full claim, capability and structural
 *   pipeline independently. Nothing here can mark a concept ready that
 *   `generateChannelContent` did not, and nothing here relaxes a gate — the
 *   only powers it has are to retry and to reject.
 */
export async function generateCreativeSet(input: SetInput): Promise<CreativeSetOutcome> {
  const keys = input.only ?? CONCEPT_KEYS;
  const maxConceptAttempts = Math.max(1,
    Math.min(MAX_CONCEPT_ATTEMPTS, input.maxConceptAttempts ?? MAX_CONCEPT_ATTEMPTS));
  const capability = buildProductCapabilityContract(input.ctx);
  const outcomes: ConceptOutcome[] = [];
  let totalGenerations = 0;
  let generationUnavailable = false;
  const timingsMs: Partial<Record<ConceptKey, number>> = {};

  /** One concept, up to MAX_CONCEPT_ATTEMPTS, given the siblings already done. */
  async function produce(
    key: ConceptKey, siblings: Array<{ key: ConceptKey; headline: string }>,
  ): Promise<ConceptOutcome> {
    const concept = CONCEPTS[key];
    if (generationUnavailable) return {
      key, name: concept.name, result: null, attempts: 0,
      conceptViolations: [], capabilityViolations: [], quality: null, creativeBrief: null,
      status: 'FAILED',
      ownerReason: 'Creative generation is temporarily unavailable. Nothing was changed.',
    };
    let last: ChannelContentResult | null = null;
    let violations: ConceptViolation[] = [];
    let caps: string[] = [];
    let quality: CreativeQualityVerdict | null = null;
    let creativeBrief: CreativeBriefContract | null = null;

    for (let attempt = 1; attempt <= maxConceptAttempts; attempt++) {
      // The concept's OWN contract, plus a structural note about siblings.
      const directive = conceptContractDirective(key)
        + siblingShapeNote(siblings)
        + (last ? `\nPrevious candidate (data): ${JSON.stringify(last.payload)}\n`
          + `Governance repair: ${JSON.stringify({ reasons: last.reasons,
            unsupported: last.claims.filter(c => c.verdict === 'UNSUPPORTED'),
            capabilitiesToRemove: caps, structuralIssues: last.structuralIssues })}. `
          + 'Keep the recognition idea and safe wording. Remove unsupported actions instead of rephrasing them.\n' : '')
        + (violations.length > 0
            ? `\nThe previous attempt was rejected because ${violations[0].retryHint}.\n`
            : quality?.blocking[0]?.retryHint
              ? `\nThe previous attempt did not pass creative review: ${quality.blocking[0].retryHint}.\n`
              : '');
      const brief = deriveContentBrief(input.channel ?? 'META_AD', input.strategy, input.ctx);
      creativeBrief = buildCreativeBriefContract({ brief, strategy: input.strategy,
        ctx: input.ctx, concept,
        creativePatterns: input.creativePatterns?.slice(0, 5),
        firstPartyLearning: input.firstPartyLearning?.slice(0, 5) });
      (brief as { hookDirection: string }).hookDirection = concept.hookDirection;
      // ON THE BRIEF, NOT THE STRATEGY — and the difference is the whole
      // mechanism working or not. `buildChannelPrompt` renders
      // `brief.channelConstraints` and `brief.brandConstraints`; it does NOT
      // render `strategy.constraints`. The first version of this file put the
      // concept directive on the strategy, where the model would never have
      // seen it: three concepts would have been generated from an identical
      // prompt and the contract would have been decoration. Caught by the
      // sibling-leak test, which asserted the structural note reaches the
      // prompt and found that nothing did.
      (brief as { channelConstraints: string[] }).channelConstraints =
        [...brief.channelConstraints, directive];

      totalGenerations++;
      const generatedAt = Date.now();
      const result = await generateChannelContent({
        brief, strategy: input.strategy, ctx: input.ctx, founderId: input.founderId,
        variantLabel: concept.name, maxRewrites: 0,
        generate: input.generate, semantic: input.semantic,
      });
      timingsMs[key] = (timingsMs[key] ?? 0) + (Date.now() - generatedAt);
      last = result;

      // ── PROVIDER FAILURE IS NOT A COPY FAILURE ───────────────────────────
      //
      // FOUND BY MEASUREMENT, not by review. A ten-set stability run produced
      // three perfect sets and then seven consecutive 0/3 sets in which every
      // concept, on every attempt, came back with an empty headline. That is
      // not creative variance — it was the Anthropic credit balance running
      // out mid-run, and `generateChannelContent` correctly reported DEGRADED.
      //
      // Two things were wrong with what happened next. The owner would have
      // been told "Some wording still needs work before this one is ready",
      // which is false and sends them to edit copy that was never written. And
      // the orchestrator retried an outage three times per concept — 63 futile
      // calls across those seven sets.
      //
      // A degraded generation ends this concept immediately and says what
      // actually happened.
      if (result.disposition === 'DEGRADED') {
        generationUnavailable = true;
        return {
          key, name: concept.name, result, attempts: attempt,
          conceptViolations: [], capabilityViolations: [], quality: null, creativeBrief,
          status: 'FAILED',
          ownerReason: 'Creative generation is temporarily unavailable. Nothing was changed.',
        };
      }

      caps = validatePayloadCapabilities(result.payload, capability).map(v => v.verb);
      violations = validateConceptRole(key, result.payload);
      quality = evaluateCreativeConceptQuality({
        concept: key,
        payload: result.payload,
        productName: input.ctx.application.name,
        audience: input.strategy.audience,
        channel: input.channel ?? 'META_AD',
        // deriveContentBrief always supplies a governed visual direction. Asset
        // authorization is evaluated again by the render contract; absence of
        // a screenshot cannot silently become permission to synthesize UI.
        hasAssetPlan: true,
        governanceEligible: result.disposition === 'ELIGIBLE' && caps.length === 0,
      });

      // COMPLETE means governance, role AND pre-render quality passed.
      if (result.disposition === 'ELIGIBLE' && violations.length === 0 && caps.length === 0
          && quality.state === 'PUBLISHABLE_CANDIDATE') {
        return {
          key, name: concept.name, result, attempts: attempt,
          conceptViolations: [], capabilityViolations: [], quality, creativeBrief,
          status: 'READY', ownerReason: null,
        };
      }
    }

    // Bounded and exhausted. Governance failures and role failures are
    // DIFFERENT things to an owner: one means the wording needs work, the
    // other means LaunchMind could not produce this angle.
    const governanceFailed = last?.disposition !== 'ELIGIBLE' || caps.length > 0;
    return {
      key, name: concept.name, result: last, attempts: maxConceptAttempts,
      conceptViolations: violations, capabilityViolations: caps, quality, creativeBrief,
      status: 'NEEDS_ATTENTION',
      ownerReason: governanceFailed
        ? 'Some wording still needs work before this one is ready.'
        : quality?.state === 'NEEDS_IMPROVEMENT'
          ? quality.blocking[0]?.ownerReason ?? 'This concept needs a stronger, more specific idea.'
        : 'LaunchMind could not shape this angle differently enough from the others.',
    };
  }

  if (input.parallelInitial && maxConceptAttempts === 1) {
    // A/B/C have independent role contracts and share only governed input.
    // Sibling *output* is deliberately absent during fan-out: generated text
    // never becomes evidence or context for another generation. Set-level
    // distinctness remains deterministic after every result returns.
    outcomes.push(...await Promise.all(keys.map(key => produce(key, []))));
  } else {
    for (const key of keys) {
      const siblings = outcomes
        .filter(o => o.status === 'READY' && o.result)
        .map(o => ({ key: o.key, headline: String((o.result!.payload as Record<string, unknown>).headline ?? '') }));
      outcomes.push(await produce(key, siblings));
    }
  }

  // ── §7 set-level distinctness, AFTER individual validity ─────────────────
  const ready = () => outcomes.filter(o => o.status === 'READY' && o.result);
  let verdict = validateSetDistinctness(ready().map(o => ({
    key: o.key,
    headline: String((o.result!.payload as Record<string, unknown>).headline ?? ''),
  })));

  if (!verdict.distinct && verdict.offenders.length > 0 && maxConceptAttempts > 1) {
    // RETRY ONLY THE OFFENDERS. Regenerating the whole set to fix one collapse
    // discards concepts that were already right, which is the behaviour this
    // orchestrator exists to remove.
    for (const key of verdict.offenders) {
      const idx = outcomes.findIndex(o => o.key === key);
      if (idx === -1) continue;
      const siblings = outcomes
        .filter(o => o.key !== key && o.status === 'READY' && o.result)
        .map(o => ({ key: o.key, headline: String((o.result!.payload as Record<string, unknown>).headline ?? '') }));
      outcomes[idx] = await produce(key, siblings);
    }
    verdict = validateSetDistinctness(ready().map(o => ({
      key: o.key,
      headline: String((o.result!.payload as Record<string, unknown>).headline ?? ''),
    })));
    // A second collapse is reported, not retried again — see MAX_CONCEPT_ATTEMPTS.
    if (!verdict.distinct) {
      for (const key of verdict.offenders) {
        const o = outcomes.find(x => x.key === key);
        if (o && o.status === 'READY') {
          o.status = 'NEEDS_ATTENTION';
          o.ownerReason = 'This version came out too close to another one.';
        }
      }
    }
  }

  return {
    concepts: outcomes,
    setDistinct: verdict.distinct,
    setReason: verdict.distinct ? null
      : 'Two versions came out too similar to be worth comparing.',
    readyCount: outcomes.filter(o => o.status === 'READY').length,
    totalGenerations,
    timingsMs,
  };
}

export { CONCEPT_CONTRACTS };
