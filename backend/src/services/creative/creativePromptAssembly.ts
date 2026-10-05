/**
 * @file creativePromptAssembly.ts
 * @description Turns a governed visual brief into provider instructions — §19, §14, §15.
 *
 *   THREE SEPARATE PROBLEMS, kept separate on purpose:
 *
 *   1. INJECTION (§19). Product descriptions, campaign messages and owner
 *      refinements are DATA. They are sanitised and fenced, never concatenated
 *      as instructions. An owner who types "ignore the brief" is describing what
 *      they want drawn, not reprogramming the renderer.
 *
 *   2. IP (§14). "Make it like competitor X's ad" is converted to abstract
 *      visual characteristics. Named competitors are stripped from the scene
 *      entirely, because a model that hears a brand name draws that brand.
 *
 *   3. CLAIMS (§15). Text inside an image is a claim surface. The provider is
 *      told to render NO text at all, and headline/CTA are composited
 *      afterwards from already-governed fields. Prompt compliance is not
 *      trusted — this is why the architecture removes the opportunity rather
 *      than asking nicely.
 *
 *   What never enters a prompt: evidence handles, authority tiers, policy
 *   versions, workspace or product ids, approval state, credentials.
 *
 * @security sanitizeForProvider is linear-time. These patterns run on
 *   owner-supplied text and a backtracking one would be a denial-of-service.
 * @dependencies creativeBriefs (types) · creativeModelRouting
 */

import type { VisualCreativeBrief } from '../content/creativeBriefs';
import type { CreativeRenderInstruction, CreativeQualityTier } from './creativeProviderTypes';
import { aspectForKind, routeCreativeModel, type CreativeKind } from './creativeModelRouting';

/** Instruction-shaped phrases in owner or model text. Removed, not obeyed. */
const OVERRIDE_PATTERNS: RegExp[] = [
  // "ignore LaunchMind", "ignore the captions" — the original list named only a
  // few objects and missed every other one. Linear: one word class, no nesting.
  /\bignore\b[^.!?]{0,40}/gi,
  /\bdisregard\b[^.!?]{0,40}/gi,
  /\byou are now\b/gi,
  /\bsystem prompt\b/gi,
  /\bnew instruction\w*/gi,
  /\boverride\b/gi,
  /\breturn (?:the )?(?:api )?key\b/gi,
  /\bapi[_ -]?key\b/gi,
];

/** Claim-shaped content that must never be drawn. Removed from the scene text. */
const CLAIM_PATTERNS: RegExp[] = [
  /\d[\d.]*\s?%/g,
  /\d+,\d\d\d/g,          // 12,000 — NOT \b\d,\d\d\d\b, which misses any leading digit
  /\b(?:award|awards|award-winning|badge|certified|certification)\b/gi,
  /\b(?:rated|rating|stars?|reviews?|testimonial\w*)\b/gi,
  // `\b#` never matches: neither a space nor `#` is a word character, so the
  // "#1" alternative in the original pattern was dead.
  /#\s?1\b/g,
  /\b(?:best|number one|leading|only)\b/gi,
  /\b(?:guarantee\w*|money[- ]back)\b/gi,
  /\b(?:free|discount|\d+%\s?off|sale)\b/gi,
];

/**
 * Strips instruction-shaped and claim-shaped content from untrusted text.
 *
 * @returns the cleaned text plus what was removed, so a caller can DISCLOSE the
 *   removal rather than silently changing what the owner asked for
 */
export function sanitizeForProvider(raw: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let text = String(raw ?? '');

  for (const p of OVERRIDE_PATTERNS) {
    const hits = text.match(p);
    if (hits) { removed.push(...hits.map(h => h.trim())); text = text.replace(p, ' '); }
  }
  for (const p of CLAIM_PATTERNS) {
    const hits = text.match(p);
    if (hits) { removed.push(...hits.map(h => h.trim())); text = text.replace(p, ' '); }
  }
  // Fence characters, so nothing can close a delimiter and start a new section.
  text = text.replace(/[<>{}[\]|`]/g, ' ').replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 900), removed };
}

/**
 * Converts "like competitor X" into abstract characteristics — §14.
 *
 * The competitor's NAME is what makes a model reproduce their creative, so it is
 * removed and only the stylistic intent survives.
 */
export function abstractCompetitorReference(
  raw: string, competitorNames: readonly string[],
): { text: string; abstracted: boolean } {
  let text = raw;
  let abstracted = false;
  for (const name of competitorNames) {
    const n = name.trim();
    if (n.length < 3) continue;
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(text)) {
      abstracted = true;
      text = text.replace(re, 'a modern competitor');
    }
  }
  if (abstracted) {
    text = text.replace(/\b(?:like|similar to|same as|copy|imitate|exactly like)\s+a modern competitor\b/gi,
      'in a clean, high-contrast, product-focused style');
    text = text.replace(/a modern competitor/gi, 'the category');
  }
  return { text, abstracted };
}

/** Never drawn, whatever the brief says. Carried to the provider explicitly. */
const ALWAYS_NEGATIVE = [
  'no text', 'no letters', 'no words', 'no typography', 'no captions',
  'no logos', 'no watermarks', 'no brand marks', 'no badges', 'no award seals',
  'no star ratings', 'no percentages', 'no numbers', 'no price tags',
  'no user interface chrome', 'no fake screenshots', 'no competitor branding',
  'no split screen', 'no collage', 'no panels',
].join(', ');

export interface AssembledInstruction extends CreativeRenderInstruction {
  /** Owner-safe disclosure of what was stripped from their words. */
  removedFromRequest: string[];
  competitorReferenceAbstracted: boolean;
}

/**
 * Builds the provider instruction from a GOVERNED brief.
 *
 * @param referenceImageUrls URLs already proven owner-authorised for
 *   VISUAL_RENDERING by the caller. This function does not and cannot verify
 *   that, which is why it is decided before the call.
 * @security The assembled prompt contains no id, handle, enum, authority or
 *   credential — asserted by test, not only by reading.
 */
export function assembleCreativeInstruction(opts: {
  brief: VisualCreativeBrief;
  kind: CreativeKind;
  qualityTier: CreativeQualityTier;
  competitorNames: readonly string[];
  referenceImageUrls: readonly string[];
  ownerRefinement?: string | null;
}): AssembledInstruction {
  const route = routeCreativeModel(opts.qualityTier);

  const rawScene = [
    opts.brief.visualConcept,
    opts.brief.moodStyle ? `mood: ${opts.brief.moodStyle}` : '',
    opts.brief.productRole ? `it should convey: ${opts.brief.productRole}` : '',
    opts.ownerRefinement ?? '',
  ].filter(Boolean).join('. ');

  const abstracted = abstractCompetitorReference(rawScene, opts.competitorNames);
  const clean = sanitizeForProvider(abstracted.text);

  // Colours are DIRECTIVE only when the owner confirmed them; the brief already
  // filtered to confirmed fields, so an empty list means "no colour direction".
  const palette = opts.brief.brandColors.length > 0
    ? ` Use a colour palette built around ${opts.brief.brandColors.join(' and ')}.`
    : '';

  const prohibitions = opts.brief.prohibitedContent.length > 0
    ? ` Do not depict: ${opts.brief.prohibitedContent.join(', ')}.`
    : '';

  const prompt =
    `A single unified marketing photograph or illustration for a ${opts.kind
      .toLowerCase().replace(/_/g, ' ')}. ` +
    `Scene: ${clean.text}.` +
    palette +
    prohibitions +
    ' Bright, clear, professional. Leave uncluttered negative space in the composition' +
    ' where a headline will be placed later. Render absolutely no text of any kind.';

  return {
    prompt: prompt.slice(0, 1800),
    negativePrompt: [ALWAYS_NEGATIVE, ...opts.brief.prohibitedContent].join(', ').slice(0, 900),
    aspectRatio: aspectForKind(opts.kind),
    referenceImageUrls: route.supportsReferenceImage ? [...opts.referenceImageUrls] : [],
    qualityTier: opts.qualityTier,
    modelRef: route.modelRef,
    removedFromRequest: clean.removed,
    competitorReferenceAbstracted: abstracted.abstracted,
  };
}
