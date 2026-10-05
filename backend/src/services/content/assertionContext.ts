/**
 * @file assertionContext.ts
 * @description ONE shared deterministic answer to: does this occurrence of a
 *   flagged word/phrase ASSERT the claim, or explicitly DENY it? — the common
 *   architectural boundary behind a defect measured in two independent,
 *   previously unrelated validators.
 *
 *   THE DEFECT, MEASURED TWICE. The real AllignX Plumbing generation was
 *   rejected first because `productCapabilityContract.ts`'s qualifier check
 *   saw the bare word "verified" in "not a process or promise LaunchMind has
 *   verified" and flagged it — the sentence's entire purpose is to DENY that
 *   claim. A local fix was added there. The very next generation was then
 *   rejected by `copyClaimClassifier.ts`'s GUARANTEE lexicon, which saw the
 *   bare substring "promise" in "not outcome promises" and flagged THAT —
 *   same defect, same shape, a completely independent detector. Patching each
 *   category as it surfaces is whack-a-mole; both detectors do bare lexical
 *   matching with no negation context, so ANY category in EITHER file can
 *   reproduce this failure the next time a model correctly hedges.
 *
 *   THIS FILE IS THE FIX ONCE. It is deliberately the only place local-clause
 *   negation is computed. `productCapabilityContract.ts`'s qualifier and
 *   capability-verb checks and `copyClaimClassifier.ts`'s lexicon matcher
 *   (`firstHit`) all call `isExplicitlyDenied` instead of keeping their own
 *   negation logic — a category added to either file tomorrow inherits this
 *   for free instead of needing its own patch.
 *
 *   WHAT THIS IS NOT: not sentiment analysis, not a general negation-scope
 *   parser, not fuzzy or semantic. It answers one narrow question — is there a
 *   negator word governing THIS occurrence, close enough and in the same
 *   clause to plainly mean it — using a bounded word window and a closed list
 *   of English negators. A sentence that is emotionally negative but makes no
 *   local denial ("we don't want you disappointed — professionals are
 *   verified") is not exempted by this file at all: it exempts an OCCURRENCE
 *   whose own local words explicitly deny it, nothing broader.
 *
 * @security FAILS CLOSED. A false negative here — a genuinely denied sentence
 *   still flagged — costs an unnecessary regeneration. A false positive — a
 *   genuinely asserted claim wrongly exempted — puts an unsupported claim in
 *   front of a customer. Every design choice below (the word-window cap, the
 *   clause boundary set, the "not only" guard, requiring EVERY occurrence of
 *   the SAME term to be denied) narrows the exemption rather than widens it.
 * @dependencies none — pure string/regex, no imports, so every governance
 *   module that depends on it stays as inspectable and provider-free as before.
 */

/**
 * Local negators that, when they clearly govern the word they precede, deny
 * it rather than assert it. Closed list — not stemmed, not fuzzy.
 */
const LOCAL_NEGATORS = new Set([
  'not', 'never', 'no', 'none', 'nor', 'cannot',
  "can't", "isn't", "aren't", "wasn't", "weren't",
  "doesn't", "don't", "didn't", "hasn't", "haven't", "won't",
]);

/**
 * How far back a negator may sit and still clearly govern the occurrence.
 *
 * MEASURED: the real refused-then-corrected sentence — "not a process or
 * promise LaunchMind has verified" — puts 7 words between "not" and
 * "verified". 12 gives that a small margin without reaching sentence-wide,
 * matching this file's fail-closed bias.
 */
const NEGATION_WINDOW = 12;

/**
 * Clause boundaries a negator's scope cannot cross: sentence-ending
 * punctuation, an em dash (conventionally opens a fresh clause), and a comma
 * (splits "not X, but Y" so a denied first half cannot exempt an asserted
 * second half — see the "not guaranteed, but ... is guaranteed" test).
 */
const CLAUSE_BOUNDARY = /[.!?,;]|—/g;

/** Escapes a literal for safe inclusion in a pattern. */
function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The text of the clause immediately preceding `index`, i.e. since the last
 * clause boundary (or the start of the text). */
function precedingClauseText(text: string, index: number): string {
  let start = 0;
  const re = new RegExp(CLAUSE_BOUNDARY.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < index) start = m.index + 1;
  return text.slice(start, index);
}

/**
 * Does a negator within `NEGATION_WINDOW` words of the end of `precedingText`
 * clearly deny whatever follows it?
 *
 * "not only X" is excluded on purpose: it is an intensifier ("not only
 * guaranteed, but proven") that still asserts X, not a denial of it.
 */
function endsWithGoverningNegator(precedingText: string): boolean {
  const words = precedingText.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z']/g, '')).filter(Boolean);
  const window = words.slice(-NEGATION_WINDOW);
  for (let i = 0; i < window.length; i++) {
    if (!LOCAL_NEGATORS.has(window[i])) continue;
    if (window[i + 1] === 'only') continue;   // intensifier, not a denial
    return true;
  }
  return false;
}

/**
 * Is EVERY occurrence of `occurrence` in `text` explicitly DENIED by a local,
 * clause-bounded negator — rather than asserted?
 *
 * Occurrence-aware and clause-local by construction:
 *   - each occurrence of `occurrence` is checked independently against only
 *     the clause it sits in, so "This is not guaranteed, but availability is
 *     guaranteed." finds the first "guaranteed" denied and the second one
 *     asserted, and reports the claim as STILL MADE (not every occurrence is
 *     denied);
 *   - a negator in an earlier, different sentence/clause never reaches an
 *     occurrence in a later one, because `precedingClauseText` stops at the
 *     nearest boundary;
 *   - `occurrence` may be a multi-word phrase (e.g. "money-back"); matching is
 *     case-insensitive and whitespace-flexible, not word-boundary-strict,
 *     matching how the lexicon matchers that call this already find terms.
 *
 * @returns false when `occurrence` does not appear at all — there is nothing
 *   to deny, and callers must not treat "not found" as "denied".
 */
export function isExplicitlyDenied(text: string, occurrence: string): boolean {
  const term = String(occurrence ?? '').trim();
  if (!term) return false;
  const pattern = esc(term).replace(/\s+/g, '\\s+');
  const re = new RegExp(pattern, 'gi');
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    indices.push(m.index);
    if (m.index === re.lastIndex) re.lastIndex++;   // guard zero-width matches
  }
  if (indices.length === 0) return false;
  return indices.every(idx => endsWithGoverningNegator(precedingClauseText(text, idx)));
}
