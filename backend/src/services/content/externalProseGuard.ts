/**
 * @file externalProseGuard.ts
 * @description Market Intelligence is reasoning input, never copy source — ADR-070 §7.
 *
 *   A competitor's own store description sits in ContextPackageV2 because the
 *   model needs to reason about their positioning. Nothing stopped it being
 *   reproduced as the owner's ad copy, which is both an IP problem and a
 *   quality one: the owner would be publishing a rival's sentences.
 *
 *   Bounded and deterministic: normalized word-shingle overlap. This is NOT
 *   copyright detection and is not claimed to be — it catches material reuse of
 *   a specific source sentence, which is the failure mode that matters here.
 *
 * @security Fails toward rejection on material overlap; short generic phrases
 *   are deliberately tolerated so ordinary language is not blocked.
 * @dependencies none (pure)
 */

/** Shingle length. 5 words is long enough that ordinary phrasing rarely collides. */
const SHINGLE = 5;
/** Rejection threshold: a fifth of the candidate matching one source is reuse. */
export const OVERLAP_THRESHOLD = 0.20;
/** Below this, a candidate is too short for shingles to mean anything. */
const MIN_WORDS = 8;

function words(text: string): string[] {
  return String(text ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function shingles(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}

export interface OverlapVerdict {
  copied: boolean;
  /** Highest overlap ratio against any single source. */
  ratio: number;
  /** The longest matching run, for an auditable rejection message. */
  longestMatch: string | null;
}

/**
 * Does this candidate copy from external source text?
 *
 * @param candidate  generated copy
 * @param sources    external evidence text (store descriptions, publisher prose)
 */
export function detectExternalProseCopy(
  candidate: string, sources: readonly string[],
): OverlapVerdict {
  const cand = shingles(candidate);
  // Too short to judge: a five-word overlap in an eight-word headline is
  // ordinary language, not reuse.
  if (cand.size === 0 || words(candidate).length < MIN_WORDS) {
    return { copied: false, ratio: 0, longestMatch: null };
  }

  let best = 0; let longest: string | null = null;
  for (const source of sources) {
    const src = shingles(source);
    if (src.size === 0) continue;
    let hits = 0;
    for (const s of cand) {
      if (src.has(s)) { hits++; if (!longest) longest = s; }
    }
    const ratio = hits / cand.size;
    if (ratio > best) { best = ratio; }
  }
  return { copied: best >= OVERLAP_THRESHOLD, ratio: best, longestMatch: longest };
}
