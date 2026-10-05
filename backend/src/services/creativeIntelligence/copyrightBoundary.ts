/**
 * @file copyrightBoundary.ts
 * @description The competitor/copyright boundary — Phase 3.5B6.5 §16.
 *
 *   THE SHAPE OF THE RISK. Creative Intelligence looks at other companies'
 *   marketing. There are three distinct ways that could go wrong, and they need
 *   three distinct controls because a single one would miss two of them:
 *
 *     1. THE ASSET ITSELF is copied — a competitor's image or video reaches a
 *        renderer, or is stored as marketing material.
 *     2. THE INSTRUCTION copies — no asset moves, but a prompt says "make it
 *        look exactly like Angi's ad", which produces an imitation anyway.
 *     3. THE PATTERN IS TOO SPECIFIC to be an abstraction — "open on a woman in
 *        a yellow jacket holding a clipboard beside a blue van" is a
 *        description of one advert wearing the word "pattern".
 *
 *   Control 1 is STRUCTURAL and lives mostly elsewhere: a CreativeObservation
 *   has no field for bytes and no field for a storage path, so there is nothing
 *   to route. `assertNoCompetitorAssetInRendering` is the belt to that braces —
 *   it fails a render whose reference set contains anything not owned by this
 *   workspace.
 *
 *   Controls 2 and 3 are textual and live here.
 *
 * @security Deterministic and model-free. These functions are called on the
 *   path from a pattern to a provider, so a bypass is a code change, not a
 *   prompt.
 * @dependencies contract (types only)
 */

import { CreativeBoundaryError } from './contract';

/**
 * Instruction shapes that produce imitation rather than expression.
 *
 * Linear patterns. Ordered from most explicit to most oblique so the message
 * an owner or an auditor sees names the closest thing to what was attempted.
 */
const IMITATION_SHAPES: Array<{ test: RegExp; label: string }> = [
  { test: /\b(copy|replicate|reproduce|clone|duplicate)\b[^.]{0,40}\b(this|that|their|the)\b[^.]{0,25}\b(ad|advert|creative|video|image|post|design|layout)\b/i,
    label: 'a direct instruction to copy another advert' },
  { test: /\b(exactly|identical|same)\s+(like|as|to)\b[^.]{0,40}\b(ad|advert|creative|campaign|video|image)\b/i,
    label: 'an instruction to match another advert exactly' },
  { test: /\bmake it look (exactly )?like\b/i,
    label: 'an instruction to imitate a specific look' },
  { test: /\bin the style of\s+[A-Z]/,
    label: "an instruction to adopt a named company's style" },
  { test: /\brecreate\b[^.]{0,30}\b(ad|advert|creative|video|image|frame|scene)\b/i,
    label: 'an instruction to recreate another advert' },
  { test: /\bmimic|imitate\b/i, label: 'an instruction to imitate' },
  { test: /\bsame (?:opening|hook|frame|shot|actor|layout|composition) as\b/i,
    label: "an instruction to reuse another advert's specific element" },
  { test: /\buse (?:their|his|her|its) (?:actor|footage|image|video|music|voice|logo|creative)\b/i,
    label: "an instruction to use another company's material" },
];

/**
 * Refuses a creative instruction that copies rather than expresses.
 *
 * @param text          the assembled instruction
 * @param competitorNames names LaunchMind knows to be competitors. A named
 *   company plus a styling verb is imitation even when no shape above matches,
 *   because "channel Thumbtack's energy" is the same request politely phrased.
 * @throws {CreativeBoundaryError}
 */
export function assertNoImitationInstruction(
  text: string, competitorNames: readonly string[] = [],
): void {
  for (const shape of IMITATION_SHAPES) {
    if (shape.test.test(text)) {
      throw new CreativeBoundaryError(
        `imitation instruction: ${shape.label}`,
        'LaunchMind will not copy another company’s advert. It can use the same ' +
        'kind of structure, expressed for your product.');
    }
  }
  for (const raw of competitorNames) {
    const name = String(raw ?? '').trim();
    // Two characters or fewer is not a distinguishing name; matching on it
    // would refuse ordinary sentences.
    if (name.length < 3) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A competitor NAMED NEXT TO a styling verb. Naming a competitor while
    // describing the market is legitimate and is not matched here.
    const styled = new RegExp(
      `\\b(like|as|style|styled|look|looks|feel|feels|vibe|energy|aesthetic|version of|similar to)\\b[^.]{0,30}\\b${esc}\\b` +
      `|\\b${esc}\\b[^.]{0,30}\\b(style|aesthetic|look and feel|vibe|energy)\\b`, 'i');
    if (styled.test(text)) {
      throw new CreativeBoundaryError(
        `competitor used as a style reference: ${name}`,
        'LaunchMind will not build your creative to look like a competitor’s. ' +
        'It can use a structure that is common in your category instead.');
    }
  }
}

/**
 * Refuses a render whose reference images are not the workspace's own.
 *
 * The belt to the structural braces: observations hold no bytes, so in normal
 * operation there is nothing to leak. This makes the guarantee hold even if a
 * future code path acquires an asset from somewhere else and hands it along.
 *
 * @param referenceAssetIds  ids about to be sent to a provider
 * @param ownedAssetIds      assets this workspace has authorised
 * @throws {CreativeBoundaryError}
 */
export function assertNoCompetitorAssetInRendering(
  referenceAssetIds: readonly string[], ownedAssetIds: readonly string[],
): void {
  const owned = new Set(ownedAssetIds);
  for (const id of referenceAssetIds) {
    if (!owned.has(id)) {
      throw new CreativeBoundaryError(
        `reference asset ${id} is not an authorised asset of this workspace`,
        'LaunchMind only builds creative from images you have authorised.');
    }
  }
}

/**
 * Is this pattern description an ABSTRACTION, or one advert in disguise?
 *
 * A pattern has to be expressible independently — two designers reading it
 * should produce two different creatives that share a structure. A description
 * carrying a specific wardrobe, a specific prop, a named brand, quoted copy or
 * a colour-plus-object combination is not that; it is a description of one
 * particular advert, and following it would reproduce that advert.
 */
export interface AbstractionVerdict {
  abstract: boolean;
  reasons: string[];
}

const TOO_SPECIFIC: Array<{ test: RegExp; reason: string }> = [
  { test: /"[^"]{8,}"|“[^”]{8,}”/, reason: 'it quotes specific copy' },
  { test: /\b(yellow|red|blue|green|orange|purple|pink)\s+(jacket|shirt|van|truck|hat|uniform|hoodie|dress)\b/i,
    reason: 'it describes a specific wardrobe or vehicle' },
  { test: /\bholding a\b/i, reason: 'it describes a specific prop' },
  { test: /\bthe (?:woman|man|guy|girl|actor) (?:in|with|who)\b/i,
    reason: 'it describes a specific person in one advert' },
  { test: /\bframe \d+\b|\bat \d+:\d\d\b/i, reason: 'it references one advert’s exact timeline' },
];

export function assessAbstraction(
  description: string, competitorNames: readonly string[] = [],
): AbstractionVerdict {
  const reasons: string[] = [];
  for (const s of TOO_SPECIFIC) if (s.test.test(description)) reasons.push(s.reason);
  for (const raw of competitorNames) {
    const name = String(raw ?? '').trim();
    if (name.length < 3) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(description)) {
      reasons.push('it names a specific company');
      break;
    }
  }
  return { abstract: reasons.length === 0, reasons };
}
