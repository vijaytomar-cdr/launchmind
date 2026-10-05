/**
 * @file threeSignalEvaluation.ts
 * @description CORPUS #5 evaluation of the three-signal claim architecture.
 *
 *   Measures four signals against the same 69 items and reports them SEPARATELY,
 *   because the headline number this pass exists to produce — how many dangerous
 *   items ALL THREE signals miss — is only meaningful next to how weak each arm
 *   is on its own. A union can look strong while one arm contributes nothing.
 *
 *   ONE REAL SEMANTIC CALL PER ITEM, CACHED, then replayed into the production
 *   union through the existing test seam. That keeps the union under
 *   measurement PRODUCTION code rather than something this harness
 *   re-implements — the mistake that made an earlier settled-history test prove
 *   only that a copy agreed with itself.
 *
 *   DEGRADATION IS RECORDED PER ITEM. A failed semantic call returns
 *   fail-closed (containsClaim: true), which would silently inflate recall AND
 *   false positives. Phase 3.1G published a "hybrid" figure that was lexical-
 *   only because per-query modes were not recorded; this script records them and
 *   reports the degraded count beside every number.
 *
 * @security Read-only. No owner data. founderId is 'system'.
 */

import { CORPUS_5 } from '../tests/fixtures/content/corpus5';
import { detectClaims } from '../src/services/content/hybridClaimDetection';
import { discoverClaims } from '../src/services/content/threeSignalClaimDiscovery';
import { classifySemanticBatch, type BatchResult } from '../src/services/content/semanticClaimClassifier';
import { DECLARATION_PROMPT } from '../src/services/content/generatorClaimDeclaration';
import { THREE_SIGNAL_CONTRACT_HASH, ALL_SIGNAL_ESCAPE_GATE,
         UNION_DANGEROUS_RECALL_GATE } from '../tests/fixtures/content/claimGates';

const FIELD = 'headline';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const silent = async (): Promise<BatchResult> => ({
  byField: new Map(), artifactClaims: [], unresolvedFields: [],
  unverifiable: false, failureReason: null,
});

/** Replays one captured real result, so the union runs on production code. */
const replay = (r: BatchResult) => async () => r;

/**
 * The GENERATOR signal, using the production declaration contract verbatim.
 *
 * SUBSTITUTION, DISCLOSED: production obtains the declaration in the SAME call
 * that writes the copy, so the generator is describing its own intent. Here the
 * copy is fixed by the corpus, so the model declares over text it did not
 * write. That removes the generator's one genuine advantage — knowing what it
 * meant — and should therefore UNDERSTATE this arm rather than flatter it.
 */
async function declare(text: string): Promise<{ categories: string[]; failed: boolean }> {
  const { callSonnet } = await import('../src/lib/aiPlatform');
  const system =
    `You wrote the marketing copy below for a governed system.\n` +
    `Field ids are: ${FIELD}.\n` + DECLARATION_PROMPT +
    `\nReturn ONLY raw JSON.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callSonnet(system, `<<<COPY\n[${FIELD}] ${text}\nCOPY>>>`, 700, {
        founderId: 'system', promptId: 'governed_content_generation',
        action: 'governed_content_generation',
      });
      const m = String(raw); const s = m.indexOf('{');
      if (s === -1) throw new Error('no json');
      let d = 0, inStr = false, esc = false, end = -1;
      for (let i = s; i < m.length; i++) {
        const ch = m[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) { end = i; break; } }
      }
      const parsed = JSON.parse(m.slice(s, end + 1)) as {
        declaredClaims?: Array<{ category?: string }>; artifactClaims?: Array<{ category?: string }>;
      };
      return {
        categories: [...(parsed.declaredClaims ?? []), ...(parsed.artifactClaims ?? [])]
          .map(c => String(c.category ?? '')).filter(Boolean),
        failed: false,
      };
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return { categories: [], failed: true };
}

interface Row {
  text: string; expect: string; dangerous: boolean;
  det: boolean; sem: boolean; gen: boolean; v3: boolean; union: boolean;
  semDegraded: boolean; genFailed: boolean;
}

async function main() {
  console.log(`contract ${THREE_SIGNAL_CONTRACT_HASH} · corpus #5 · ${CORPUS_5.length} items`);
  const rows: Row[] = [];

  for (const [i, c] of CORPUS_5.entries()) {
    const fields = [{ name: FIELD, text: c.text }];

    // ONE real semantic call, captured.
    const captured = await classifySemanticBatch(
      [{ fieldId: FIELD, text: c.text }], { founderId: 'system', channel: 'meta_ads' });
    const semDegraded = captured.unverifiable || captured.unresolvedFields.length > 0;
    const semFound = (captured.byField.get(FIELD) ?? []).length > 0
      || captured.artifactClaims.length > 0;

    // ONE real declaration call.
    const declared = await declare(c.text);

    const detOnly = await detectClaims(fields, { semantic: silent as never });
    const v3      = await detectClaims(fields, { semantic: replay(captured) as never });
    const union   = await discoverClaims(fields,
      { declaredClaims: declared.categories.map(cat => ({
          fieldId: FIELD, textSpan: c.text, category: cat, requirement: 'EVIDENCE' })) },
      { semantic: replay(captured) as never });

    rows.push({
      text: c.text, expect: c.expect, dangerous: c.dangerous,
      det: detOnly.claims.length > 0,
      sem: semFound,
      gen: declared.categories.length > 0,
      // Degraded fail-closed results are NOT counted as detections.
      v3: v3.containsClaim,
      union: union.containsClaim,
      semDegraded, genFailed: declared.failed,
    });

    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${CORPUS_5.length}`);
    await sleep(400);
  }

  const danger = rows.filter(r => r.dangerous);
  const creative = rows.filter(r => !r.dangerous);
  const pct = (n: number, d: number) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
  const recall = (k: keyof Row) => pct(danger.filter(r => r[k]).length, danger.length);
  const fp = (k: keyof Row) => pct(creative.filter(r => r[k]).length, creative.length);

  const escapes = danger.filter(r => !r.det && !r.sem && !r.gen);
  const unionMisses = danger.filter(r => !r.union);

  console.log('\n── RECALL on dangerous items (n=' + danger.length + ') ──');
  for (const k of ['gen', 'det', 'sem', 'v3', 'union'] as const) {
    console.log(`  ${k.padEnd(6)} ${recall(k)}  (${danger.filter(r => r[k]).length}/${danger.length})`);
  }
  console.log('\n── FALSE POSITIVES on creative controls (n=' + creative.length + ') ──');
  for (const k of ['gen', 'det', 'sem', 'v3', 'union'] as const) {
    console.log(`  ${k.padEnd(6)} ${fp(k)}  (${creative.filter(r => r[k]).length}/${creative.length})`);
  }

  console.log(`\nALL_SIGNAL_ESCAPE_COUNT = ${escapes.length}   (gate ${ALL_SIGNAL_ESCAPE_GATE})`);
  for (const e of escapes) console.log(`  ESCAPE  [${e.expect}] ${e.text}`);
  console.log(`UNION_MISSES = ${unionMisses.length}`);
  for (const e of unionMisses) console.log(`  MISS    [${e.expect}] ${e.text}`);

  const byCat = new Map<string, { n: number; hit: number }>();
  for (const r of danger) {
    const e = byCat.get(r.expect) ?? { n: 0, hit: 0 };
    e.n++; if (r.union) e.hit++; byCat.set(r.expect, e);
  }
  console.log('\n── union recall by category ──');
  for (const [cat, v] of [...byCat].sort()) {
    console.log(`  ${v.hit === v.n ? ' ' : '!'} ${cat.padEnd(26)} ${v.hit}/${v.n}`);
  }

  console.log(`\nsemantic degraded items: ${rows.filter(r => r.semDegraded).length}/${rows.length}`);
  console.log(`generator call failures : ${rows.filter(r => r.genFailed).length}/${rows.length}`);
  console.log(`creative FP on union    : ${fp('union')}  (reported, never gated)`);

  const unionRecall = danger.filter(r => r.union).length / danger.length;
  const pass = escapes.length <= ALL_SIGNAL_ESCAPE_GATE && unionRecall >= UNION_DANGEROUS_RECALL_GATE;
  console.log(`\nVERDICT: ${pass ? 'GATES PASS' : 'GATES FAIL'}`);
  process.exit(pass ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(1); });
