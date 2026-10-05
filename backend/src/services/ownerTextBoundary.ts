/**
 * @file ownerTextBoundary.ts
 * @description The LAST server-side boundary before generated prose reaches an
 *   owner — P1-20.
 *
 *   MEASURED DEFECT (found in a real browser, Phase 3.4C): grounding validated
 *   the STRUCTURED citations in `evidenceRefs` and never looked at the prose.
 *   When the model wrote its citation markers inline, they rendered verbatim on
 *   the Growth Brain card:
 *
 *     "Things 3 positions on day planning and goal progress (mi7), holds a
 *      4.82-star rating from 27,809 ratings (mi8, mi9), and is a paid app (mi10)."
 *
 *   The handles are per-request and meaningless outside the generation that
 *   issued them, so this is a disclosure defect rather than a leak of anything
 *   sensitive — but it is internal machinery shown to a person as if it were
 *   part of the advice.
 *
 *   TWO LAYERS, deliberately:
 *
 *     1. NORMALIZE recognised CITATION SYNTAX. The prose is worth keeping, so a
 *        citation marker is removed and the sentence survives.
 *     2. REJECT anything that still carries a citation-shaped handle afterwards.
 *        This is what makes "owner text never contains a raw handle" an
 *        INVARIANT rather than a best-effort regex — a phrasing layer 1 does not
 *        recognise costs one dropped claim, not a leak.
 *
 *   WHAT IT DELIBERATELY DOES NOT DO. It does not strip bare tokens. `goal`,
 *   `product`, `direction`, `competitors`, `perf` and `strategy` are ALSO handle
 *   names, and they are ordinary English; removing them from prose would corrupt
 *   the advice to fix a formatting problem. `m1` is a handle name and also an
 *   Apple chip. So a token counts as a citation only in citation POSITION.
 *
 *   No model is used. No prompt is relied upon.
 *
 * @security This is the boundary between generated text and owner-visible
 *   content. Structured `evidenceRefs` are never touched, so sanitising prose
 *   can never detach a claim from the evidence that supports it.
 * @dependencies none (pure)
 */

/**
 * Opaque, per-request handle namespaces.
 *
 * ONLY these are opaque. Every other handle the server issues (`goal`,
 * `direction`, `product`, `competitors`, `perf`, `strategy`) is an ordinary
 * English word and is owner-safe on sight.
 */
const OPAQUE_HANDLE = String.raw`(?:mi|m)\d{1,3}`;

/** A run of handles with separators: `mi1`, `mi1, mi2`, `mi1 and mi2`. */
const HANDLE_RUN = `${OPAQUE_HANDLE}(?:\\s*(?:,|;|and|&)\\s*${OPAQUE_HANDLE})*`;

/**
 * Recognised citation forms. Each is anchored so it can only match a handle in
 * CITATION POSITION — never a bare token in prose.
 *
 * All are linear: no nested quantifier over an alternation, so none can
 * backtrack catastrophically on hostile input. They run on model output, which
 * is derived from untrusted listing text.
 */
const CITATION_FORMS: readonly RegExp[] = [
  // (mi1) · (mi1, mi2) · [mi1] · [mi1; mi2]
  new RegExp(String.raw`\s*[([]\s*${HANDLE_RUN}\s*[)\]]`, 'gi'),
  // "according to mi1" · "per mi1" · "source mi1" · "based on mi1" · "see mi1"
  new RegExp(String.raw`\s*(?:,\s*)?\b(?:according to|based on|per|source|sources|see|cf\.?|ref\.?)\s+${HANDLE_RUN}`, 'gi'),
  // "mi1 says" · "mi1 shows" — attribution with the handle as the subject.
  new RegExp(String.raw`\b${HANDLE_RUN}\s+(?:says|shows|indicates|confirms|states|reports|notes)\b\s*`, 'gi'),
];

/**
 * Anything still citation-shaped after normalization.
 *
 * Deliberately NARROWER than "contains a handle": a bare `m1` or `mi10` in prose
 * is not a citation and is left alone, because "M1 chip" and "Mi 10" are real
 * things an app listing can say. What must never survive is a handle sitting in
 * brackets or an attribution phrase.
 */
const RESIDUAL_CITATION = new RegExp(
  // ANY bracketing or quoting delimiter, not just the two the normaliser
  // rewrites. A `{mi8}` or `<<mi8>>` is plainly a citation even though layer 1
  // deliberately does not know how to rewrite it — so it is refused rather than
  // shipped. Found by the backstop test: the first version only knew `(` and
  // `[`, which made the "unrecognised form" case silently pass through.
  String.raw`[[({<«"'\u201c\u2018]\s*${OPAQUE_HANDLE}|\b(?:according to|based on|per|source|sources|see|cf|ref)\.?\s+${OPAQUE_HANDLE}\b`, 'i');

/** Tidies the punctuation a removed citation leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\s+([.,;:!?])/g, '$1')     // " ." -> "."
    .replace(/\(\s*\)|\[\s*\]/g, '')     // empty brackets
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/g, '')
    .replace(/^\s+/, '')
    .replace(/,\s*\./g, '.')             // ", ." -> "."
    // A removed leading attribution ("Per m3, email cadence matters.") leaves
    // the sentence starting on its own comma.
    .replace(/^[\s,;:]+/, '')
    .trim();
}

export interface OwnerTextVerdict {
  /** The text as it may be shown. Equal to the input when nothing was found. */
  text: string;
  /** True when a citation marker was removed. */
  normalized: boolean;
  /** True when a citation survived normalization — the item must be dropped. */
  rejected: boolean;
}

/**
 * Applies the owner-text boundary to one string.
 *
 * @param input - generated prose, treated as untrusted
 * @returns the cleaned text plus whether it was changed or must be refused
 */
export function sanitizeOwnerText(input: string | null | undefined): OwnerTextVerdict {
  if (input == null) return { text: '', normalized: false, rejected: false };
  const original = String(input);

  let out = original;
  for (const form of CITATION_FORMS) out = out.replace(form, ' ');
  out = tidy(out);

  // Layer 2. If a citation shape survived, the item does not ship.
  if (RESIDUAL_CITATION.test(out)) {
    return { text: out, normalized: out !== original, rejected: true };
  }
  // Normalization must not destroy the claim. An empty or near-empty result
  // means the "prose" was only a citation, which is not advice.
  if (out.length < 3) return { text: out, normalized: true, rejected: true };

  return { text: out, normalized: out !== original, rejected: false };
}

/** True when a string carries a citation-shaped internal handle. */
export function containsInternalCitation(input: string | null | undefined): boolean {
  if (input == null) return false;
  const s = String(input);
  return CITATION_FORMS.some(f => { f.lastIndex = 0; return f.test(s); })
      || RESIDUAL_CITATION.test(s);
}

/**
 * Sanitises an object's owner-visible string fields in one pass.
 *
 * Used so a caller cannot protect one field and forget another — the field list
 * is the contract, stated once.
 *
 * @returns the cleaned values, and `rejected` naming every field that failed
 */
export function sanitizeOwnerFields<K extends string>(
  fields: Record<K, string | null | undefined>,
): { values: Record<K, string>; rejected: K[]; normalized: K[] } {
  const values = {} as Record<K, string>;
  const rejected: K[] = [];
  const normalized: K[] = [];
  for (const key of Object.keys(fields) as K[]) {
    const v = sanitizeOwnerText(fields[key]);
    values[key] = v.text;
    if (v.rejected) rejected.push(key);
    else if (v.normalized) normalized.push(key);
  }
  return { values, rejected, normalized };
}
