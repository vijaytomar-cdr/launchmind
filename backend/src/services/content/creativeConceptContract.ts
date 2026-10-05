/**
 * @file creativeConceptContract.ts
 * @description Structural responsibility per concept — Phase 3.5B6.8 §3, §5, §7, §8.
 *
 *   WHAT B6.7 GOT WRONG. Concept identity lived entirely in prompt guidance, so
 *   "concept B is the product demonstration" was true only for as long as the
 *   model felt like complying. Measured over five sets: B wrote a noun fragment
 *   or a question instead of naming the product in 4 of 5 cases, and one whole
 *   set collapsed to a single headline shape. Nothing checked, so nothing held.
 *
 *   A CONCEPT CONTRACT IS ABOUT STRUCTURE, NEVER TRUTH. It says what SHAPE a
 *   concept's headline must take and where the product sits in the argument. It
 *   grants no capability, supplies no evidence, and certifies no performance —
 *   those live in the capability contract, the grounding layer, and nowhere
 *   respectively. A concept contract cannot make a false sentence acceptable;
 *   it can only reject a true one for being the wrong shape.
 *
 *   HEADLINE SHAPES ARE PER-CONCEPT SETS, NOT ONE TEMPLATE. B6.7 briefly
 *   required every headline to be a capability statement or a framing shape,
 *   and every concept promptly became a question — the cheapest compliant
 *   shape — producing three identical headlines in one set. Each concept here
 *   permits a DIFFERENT set, and the sets deliberately do not overlap on the
 *   shape that defines each role.
 *
 * @security Pure, deterministic, model-free. Validation reads generated text
 *   and the concept's declared role; it never reads evidence, never writes, and
 *   cannot alter what is permitted to be claimed.
 * @dependencies creativeConcepts (types only)
 */

import { CONCEPTS, type ConceptKey, type ConceptShape } from './creativeConcepts';

/** The structural shapes a headline can take. Deterministically detectable. */
export const HEADLINE_SHAPES = [
  'QUESTION', 'NORMATIVE', 'HYPOTHETICAL', 'HEDGE',
  'CAPABILITY', 'NOUN_FRAGMENT', 'OTHER',
] as const;
export type HeadlineShape = typeof HEADLINE_SHAPES[number];

/**
 * Classifies a headline by shape.
 *
 * Order matters: a question that also names the product is a QUESTION, because
 * the interrogative is what makes it framing rather than a statement.
 */
export function classifyHeadlineShape(raw: string): HeadlineShape {
  const t = String(raw ?? '').trim();
  if (!t) return 'OTHER';
  if (/\?\s*$/.test(t)) return 'QUESTION';
  if (/\b(?:shouldn'?t|should not|should|ought to|does\s?n'?t have to|do\s?n'?t have to|needn'?t)\b/i.test(t))
    return 'NORMATIVE';
  if (/\b(?:imagine|what if|picture|suppose)\b/i.test(t)) return 'HYPOTHETICAL';
  // A capability shape NAMES AN ACTION the product performs. Checked before the
  // hedge test so "AllignX connects you" is not read as a hedge.
  if (/\b(?:connect|connects|connecting|meet|meets)\b/i.test(t)) return 'CAPABILITY';
  if (/\b(?:can be|could|may|might|feels?|feel)\b/i.test(t)) return 'HEDGE';
  // No finite verb and short: "Trusted. Vetted. Neighborhood." — a label, not a
  // sentence. This is the shape every concept drifts into when unconstrained,
  // and it is the one shape no concept is allowed to use.
  const hasVerb = /\b(?:is|are|was|were|has|have|do|does|did|will|can|start|starts|works?|takes?|needs?)\b/i.test(t);
  if (!hasVerb && t.split(/\s+/).length <= 7) return 'NOUN_FRAGMENT';
  return 'OTHER';
}

export interface ConceptContract {
  key: ConceptKey;
  /** Headline shapes this concept may use. Never the full set. */
  permittedHeadlineShapes: readonly HeadlineShape[];
  /** The shape that DEFINES this role. Another concept may not take it. */
  signatureShape: HeadlineShape;
  /** Where the product sits. Structural, not a claim. */
  productProminence: ConceptShape['productProminence'];
  /** Owner-safe purpose. Never an enum on screen. */
  purpose: string;
}

/**
 * The three contracts.
 *
 * NOUN_FRAGMENT is absent from all three, deliberately. It was the single most
 * common shape in the failure trace and it is the one that reads as an
 * unsupported promise — "Home projects, minus the phone tag" asserts an outcome
 * while looking like a label.
 */
export const CONCEPT_CONTRACTS: Record<ConceptKey, ConceptContract> = {
  PROBLEM_RECOGNITION: {
    key: 'PROBLEM_RECOGNITION',
    permittedHeadlineShapes: ['QUESTION', 'NORMATIVE', 'HYPOTHETICAL'],
    signatureShape: 'QUESTION',
    productProminence: 'SECONDARY',
    purpose: 'Open on a situation the reader may recognise, before the product.',
  },
  PRODUCT_DEMONSTRATION: {
    key: 'PRODUCT_DEMONSTRATION',
    // ONLY the capability shape. This concept exists to answer "what is this?",
    // and a question or an aspiration answers a different question entirely.
    permittedHeadlineShapes: ['CAPABILITY'],
    signatureShape: 'CAPABILITY',
    productProminence: 'DOMINANT',
    purpose: 'Say what the product is, immediately.',
  },
  RELIEF: {
    key: 'RELIEF',
    permittedHeadlineShapes: ['NORMATIVE', 'HEDGE', 'HYPOTHETICAL'],
    signatureShape: 'HEDGE',
    productProminence: 'SUPPORTING',
    purpose: 'Describe the calmer way this could work.',
  },
};

export interface ConceptViolation {
  /** Internal. Never rendered. */
  code: 'HEADLINE_SHAPE' | 'ROLE_COLLAPSE' | 'EMPTY_HEADLINE';
  /** Fed to the retry, not to the owner. */
  retryHint: string;
}

/**
 * Does this concept actually behave like its role?
 *
 * @security Structural only. A concept that passes here has said nothing new —
 *   claim and capability governance ran first and independently.
 */
export function validateConceptRole(
  key: ConceptKey, payload: Record<string, unknown>,
): ConceptViolation[] {
  const contract = CONCEPT_CONTRACTS[key];
  const headline = String(payload.headline ?? '').trim();
  if (!headline) {
    return [{ code: 'EMPTY_HEADLINE', retryHint: 'the headline was missing' }];
  }
  const shape = classifyHeadlineShape(headline);
  if (!contract.permittedHeadlineShapes.includes(shape)) {
    return [{
      code: 'HEADLINE_SHAPE',
      retryHint: shape === 'NOUN_FRAGMENT'
        ? 'the headline was a label rather than a sentence — write a complete ' +
          'line, not a list of adjectives'
        : `the headline was the wrong kind of line for this concept — ` +
          `${describeShapes(contract.permittedHeadlineShapes)}`,
    }];
  }
  return [];
}

/** Owner-free, model-facing description of the permitted shapes. */
function describeShapes(shapes: readonly HeadlineShape[]): string {
  const words: Record<HeadlineShape, string> = {
    QUESTION: 'a question to the reader',
    NORMATIVE: 'a statement about how things should be',
    HYPOTHETICAL: 'a hypothetical',
    HEDGE: 'a hedged description of how this could feel',
    CAPABILITY: 'a plain statement of what the product does',
    NOUN_FRAGMENT: '', OTHER: '',
  };
  return 'use ' + shapes.map(s => words[s]).filter(Boolean).join(', or ');
}

// ── §7 SET-LEVEL DISTINCTNESS ───────────────────────────────────────────────

export interface SetDistinctnessVerdict {
  distinct: boolean;
  /** Which concepts should be retried. Minimum set, never all three. */
  offenders: ConceptKey[];
  reason: string | null;
}

/**
 * Is the SET distinct, given each concept is already individually valid?
 *
 * SEPARATE FROM PER-CONCEPT VALIDATION on purpose: three concepts can each obey
 * their own contract and still say the same thing, because a contract governs
 * shape and this governs difference.
 *
 * NO SCORE. It returns which concepts collapsed and why.
 */
export function validateSetDistinctness(
  produced: ReadonlyArray<{ key: ConceptKey; headline: string }>,
  overlapCeiling = 0.6,
): SetDistinctnessVerdict {
  if (produced.length < 2) {
    return { distinct: true, offenders: [], reason: null };
  }

  // 1. Two concepts must not land on the same headline SHAPE. The signature
  //    shape is what makes a role recognisable; sharing it collapses the roles
  //    however different the words are.
  const byShape = new Map<HeadlineShape, ConceptKey[]>();
  for (const p of produced) {
    const s = classifyHeadlineShape(p.headline);
    byShape.set(s, [...(byShape.get(s) ?? []), p.key]);
  }
  for (const [, keys] of byShape) {
    if (keys.length > 1) {
      // The offender is the concept for which this is NOT the signature shape —
      // retrying the one that owns the shape would be retrying the right answer.
      const offenders = keys.filter(k =>
        classifyHeadlineShape(produced.find(p => p.key === k)!.headline)
          !== CONCEPT_CONTRACTS[k].signatureShape);
      return {
        distinct: false,
        offenders: offenders.length > 0 ? offenders : keys.slice(1),
        reason: 'two versions opened the same way',
      };
    }
  }

  // 2. Wording overlap. Crude and transparent by design — the failure it
  //    catches is gross, and a model-scored similarity would be unauditable.
  const norm = (s: string) => new Set(String(s).toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));
  for (let i = 0; i < produced.length; i++) {
    for (let j = i + 1; j < produced.length; j++) {
      const a = norm(produced[i].headline), b = norm(produced[j].headline);
      if (a.size === 0 || b.size === 0) continue;
      const shared = [...a].filter(t => b.has(t)).length;
      if (shared / Math.min(a.size, b.size) > overlapCeiling) {
        return {
          distinct: false,
          // Retry the LATER one: the earlier concept has priority in the set
          // order, and retrying both would discard a valid concept.
          offenders: [produced[j].key],
          reason: 'two versions used nearly the same words',
        };
      }
    }
  }

  return { distinct: true, offenders: [], reason: null };
}

/** The model-facing directive for one concept. Structure only. */
export function conceptContractDirective(key: ConceptKey): string {
  const c = CONCEPT_CONTRACTS[key];
  const cn = CONCEPTS[key];
  return `\nTHIS VERSION'S JOB: ${c.purpose}\n` +
    `HEADLINE: ${describeShapes(c.permittedHeadlineShapes)}.\n` +
    `Do NOT write the headline as a label or a list of adjectives ` +
    `("Trusted. Vetted. Nearby.") — it reads as a promise and cannot be supported.\n` +
    `${cn.guidance}\n`;
}
