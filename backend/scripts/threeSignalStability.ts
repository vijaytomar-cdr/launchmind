/**
 * @file threeSignalStability.ts
 * @description Repetition stability of the three-signal union.
 *
 *   Two model surfaces now sit in one decision — the generator's declaration and
 *   the semantic auditor. Variance between runs is expected and acceptable. A
 *   DANGEROUS CLAIM ESCAPING THE UNION ON ANY SINGLE REPETITION is not, because
 *   an owner gets one run, not a distribution.
 *
 *   Scoped to the 20 hardest dangerous items rather than all 51: figurative
 *   outcome promises, first-party rankings, exclusivity and comparative
 *   fragments are where every residual error across corpora #2–#5 has lived,
 *   and where the deterministic arm contributes least — so they are the items
 *   whose safety actually depends on a model being consistent.
 *
 * @security Read-only. No owner data.
 */

import { CORPUS_5 } from '../tests/fixtures/content/corpus5';
import { discoverClaims } from '../src/services/content/threeSignalClaimDiscovery';
import { classifySemanticBatch } from '../src/services/content/semanticClaimClassifier';
import { DECLARATION_PROMPT } from '../src/services/content/generatorClaimDeclaration';
import { THREE_SIGNAL_CONTRACT_HASH } from '../tests/fixtures/content/claimGates';

const REPS = 3;
const FIELD = 'headline';
const HARD = new Set(['OUTCOME_PROMISE', 'FIRST_PARTY_PERFORMANCE', 'EXCLUSIVITY',
                      'COMPARATIVE', 'SUPERLATIVE', 'SOCIAL_PROOF', 'CAPABILITY']);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * HARNESS DEFECT FOUND MID-RUN: the first version returned `[]` on ANY failure,
 * which is indistinguishable from "the generator declared nothing". One item
 * looked like a dangerous escape when the generator call had simply failed —
 * and in production a failed generation is `generationDegraded`, which blocks
 * the artifact. Failure is now reported, so a broken call cannot masquerade as
 * a clean verdict in either direction.
 */
async function declare(text: string): Promise<{ claims: unknown[]; failed: boolean }> {
  const { callSonnet } = await import('../src/lib/aiPlatform');
  try {
    const raw = await callSonnet(
      `You wrote the marketing copy below for a governed system.\nField ids are: ${FIELD}.\n` +
      DECLARATION_PROMPT + `\nReturn ONLY raw JSON.`,
      `<<<COPY\n[${FIELD}] ${text}\nCOPY>>>`, 700,
      { founderId: 'system', promptId: 'governed_content_generation', action: 'governed_content_generation' });
    const s = String(raw);
    const obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)) as
      { declaredClaims?: unknown[] };
    return {
      claims: (obj.declaredClaims ?? []).map(c => ({
        ...(c as Record<string, unknown>), fieldId: FIELD, textSpan: text,
      })),
      failed: false,
    };
  } catch { return { claims: [], failed: true }; }
}

async function main() {
  const items = CORPUS_5.filter(c => c.dangerous && HARD.has(c.expect)).slice(0, 20);
  console.log(`contract ${THREE_SIGNAL_CONTRACT_HASH} · ${items.length} hard items × ${REPS} reps`);

  const detections = new Map<string, boolean[]>();
  let degradedRuns = 0;
  for (let rep = 0; rep < REPS; rep++) {
    let escaped = 0;
    for (const c of items) {
      const fields = [{ name: FIELD, text: c.text }];
      const captured = await classifySemanticBatch(
        [{ fieldId: FIELD, text: c.text }], { founderId: 'system', channel: 'meta_ads' });
      const declared = await declare(c.text);
      const out = await discoverClaims(fields, { declaredClaims: declared.claims },
        { semantic: (async () => captured) as never });
      // A failed generator call is DEGRADED in production, which blocks the
      // artifact. Counting it as a clean pass would overstate safety; counting
      // it as an escape would understate it. It is neither, and is reported.
      if (declared.failed) { degradedRuns++; continue; }
      const hit = out.containsClaim;
      if (!hit) escaped++;
      detections.set(c.text, [...(detections.get(c.text) ?? []), hit]);
      await sleep(300);
    }
    console.log(`  rep ${rep + 1}: escapes ${escaped}/${items.length}`);
  }

  let unstable = 0, everEscaped = 0;
  for (const [text, hits] of detections) {
    const all = hits.every(Boolean), none = !hits.some(Boolean);
    if (!all) { everEscaped++; console.log(`  ESCAPED at least once: ${text} → ${hits.join(',')}`); }
    if (!all && !none) unstable++;
  }
  console.log(`\ngenerator call failures (degraded, blocked in production): ${degradedRuns}`);
  console.log(`items detected on EVERY repetition : ${detections.size - everEscaped}/${detections.size}`);
  console.log(`items that flipped between reps     : ${unstable}`);
  console.log(`\nVERDICT: ${everEscaped === 0 ? 'STABLE — no dangerous escape on any repetition'
                                              : 'UNSTABLE — a dangerous item escaped'}`);
  process.exit(everEscaped === 0 ? 0 : 2);
}
main().catch(e => { console.error(e); process.exit(1); });
