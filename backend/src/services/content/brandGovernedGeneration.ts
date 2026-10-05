/**
 * @file brandGovernedGeneration.ts
 * @description Brand-aware wrapper over the FROZEN governed generator — 3.5B1.
 *
 *   WHY A WRAPPER RATHER THAN AN EDIT: governedContentGeneration.ts is inside
 *   THREE_SIGNAL_CONTRACT_HASH_V2 (1856b72c0ba0ca7a). Adding brand inputs there
 *   would change the hash and void the freeze corpus #6 is meant to be held out
 *   against. This module composes around it — the same reason
 *   threeSignalClaimDiscovery wraps V3 instead of editing it.
 *
 *   Brand reaches the generator through the brief's EXISTING `constraints`
 *   field, so no frozen signature changes. Brand facts are passed as
 *   constraints, never as evidence: a confirmed brand voice tells the model how
 *   to write, and substantiates nothing.
 *
 *   Prohibited terminology is enforced AFTER generation by a deterministic
 *   validator. Asking a model not to use a word is a request; checking the
 *   output is a control.
 *
 * @security Adds no claim-discovery or grounding behaviour. A terminology
 *   violation blocks the artifact; it never rewrites it silently.
 * @dependencies governedContentGeneration (FROZEN), productContentContext,
 *   prohibitedTerminology
 */

import {
  generateGovernedContent,
  type GovernedGenerationInput, type GovernedGenerationResult,
} from './governedContentGeneration';
import { validateTerminology, type TerminologyResult } from '../brand/prohibitedTerminology';
import { mayAssertAsBrandFact } from '../brand/brandFieldPolicy';
import type { ProductContentContext } from './productContentContext';

export interface BrandGovernedResult extends GovernedGenerationResult {
  terminology: TerminologyResult;
  /** Owner-safe brand lines used, for the provenance panel. */
  brandProvenance: string[];
  brandKitVersion: number;
}

/**
 * Turns resolved brand fields into generation constraints.
 *
 * ONLY owner-confirmed fields become directives. An observed tagline is offered
 * as "currently observed messaging" — the model may react to it, and it is never
 * presented as the owner's approved message.
 */
export function brandConstraints(ctx: ProductContentContext): string[] {
  const out: string[] = [];
  const voice = ctx.brand.fields.brand_voice;
  const tone = ctx.brand.fields.tone;
  const tagline = ctx.brand.fields.tagline;

  if (mayAssertAsBrandFact(voice)) out.push(`Write in this brand voice: ${String(voice!.value)}`);
  else if (voice) out.push(`Observed brand voice (not confirmed): ${String(voice.value)}`);

  if (mayAssertAsBrandFact(tone)) out.push(`Tone: ${String(tone!.value)}`);
  if (tagline) {
    out.push(mayAssertAsBrandFact(tagline)
      ? `Approved tagline: ${String(tagline.value)}`
      : `Currently observed messaging (not approved, do not quote as official): ${String(tagline.value)}`);
  }
  for (const term of ctx.prohibitedTerms) out.push(`Never use the word or phrase: ${term}`);

  // Named so the model does not invent imagery the owner cannot lawfully use.
  if (ctx.authorizedAssets.length === 0) {
    out.push('No authorised product imagery is available; do not describe specific product screenshots.');
  }
  return out;
}

/**
 * Generates under both claim governance and brand constraints.
 *
 * @security The terminology check runs on what was ACTUALLY generated, including
 *   fields the model added, and blocks rather than rewrites — a silent rewrite
 *   would hide that the constraint was violated.
 */
export async function generateBrandGovernedContent(
  ctx: ProductContentContext,
  input: Omit<GovernedGenerationInput, 'handles' | 'founderId' | 'productId'>
    & { founderId: string },
): Promise<BrandGovernedResult> {
  const result = await generateGovernedContent({
    ...input,
    brief: {
      ...input.brief,
      constraints: [...(input.brief.constraints ?? []), ...brandConstraints(ctx)],
    },
    handles: ctx.evidence,
    competitorNames: input.competitorNames ?? ctx.founderDirection.competitors,
    founderId: input.founderId,
    productId: ctx.productId,
  });

  const terminology = validateTerminology(result.fields, ctx.prohibitedTerms);
  const blockedReasons = [...result.blockedReasons];
  for (const v of terminology.violations) {
    blockedReasons.push(`${v.field}: uses prohibited term "${v.term}"`);
  }

  return {
    ...result,
    blockedReasons,
    eligible: result.eligible && terminology.ok,
    terminology,
    brandProvenance: ctx.brandProvenance,
    brandKitVersion: ctx.brand.version,
  };
}
