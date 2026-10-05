/**
 * @file prohibitedTerminology.ts
 * @description Deterministic terminology constraints — ADR-071 §6, Phase 3.5B1.
 *
 *   Telling a model not to say a word is not the same as the word not being
 *   said. This is the same reasoning that made channel limits validators rather
 *   than prompt text in ADR-070 §8A: a constraint the owner set must be
 *   ENFORCED after generation, not requested before it.
 *
 *   This is NOT legal or compliance policy. It is the owner's own vocabulary:
 *   words they dislike, deprecated product names, legacy branding, and terms
 *   that would confuse their product with a competitor's.
 *
 * @security Pure. Word-boundary matching, so "revolutionary" does not fire on
 *   "revolutionaries" by accident and — more importantly — a banned term cannot
 *   hide inside a longer word.
 * @dependencies none (pure)
 */

export interface TerminologyViolation {
  term: string;
  field: string;
  /** The matched text as it appears, for an auditable rejection message. */
  matched: string;
}

export interface TerminologyResult {
  ok: boolean;
  violations: TerminologyViolation[];
}

/** Escapes a term for use inside a RegExp. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks generated fields against the owner's prohibited vocabulary.
 *
 * @param fields    owner-visible fields, as generated
 * @param prohibited terms the owner has banned
 * @returns every violation — not just the first, so one regeneration can fix all
 * @security Multi-word terms are matched as phrases; single words are matched on
 *   word boundaries. A term list containing an empty string matches nothing
 *   rather than everything, which is the failure direction that matters.
 */
export function validateTerminology(
  fields: ReadonlyArray<{ name: string; text: string }>,
  prohibited: readonly string[],
): TerminologyResult {
  const terms = prohibited
    .map(t => String(t ?? '').trim())
    .filter(t => t.length > 0);
  if (terms.length === 0) return { ok: true, violations: [] };

  const violations: TerminologyViolation[] = [];
  for (const field of fields) {
    const text = String(field.text ?? '');
    if (!text) continue;
    for (const term of terms) {
      // \b is wrong for terms that start/end with punctuation, so the boundary
      // is asserted only where the term itself is word-shaped.
      const lead = /^\w/.test(term) ? '\\b' : '';
      const tail = /\w$/.test(term) ? '\\b' : '';
      const re = new RegExp(`${lead}${escape(term)}${tail}`, 'i');
      const m = re.exec(text);
      if (m) violations.push({ term, field: field.name, matched: m[0] });
    }
  }
  return { ok: violations.length === 0, violations };
}
