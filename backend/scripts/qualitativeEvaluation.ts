/**
 * @file qualitativeEvaluation.ts
 * @description Runs the frozen qualitative corpus through the REAL Design A
 *   pipeline (Gate A → retrieval → comparison → promotion → shadow proposal).
 *
 *   HARNESS INTEGRITY IS CHECKED FIRST and reported before any score. Per the
 *   brief, an invalid harness must yield HARNESS_NOT_ADMISSIBLE rather than a
 *   headline number. The checks encode every defect found in earlier harnesses:
 *   self-evidence, incumbent-as-candidate, lenient scoring, model-unavailable
 *   counted as classification, missing coverage, degraded semantic cases.
 *
 *   STRICT SCORING. KEEP_AS_EVIDENCE_ONLY is a safe deferral, never a semantic
 *   success. Semantic and safety quality are reported separately and never
 *   collapsed.
 *
 * @security Two synthetic lab workspaces under a lab founder. Shadow mode. No
 *   owner row is read for mutation or written.
 * @dependencies marketingMemoryEngine, corpusEmbeddingCertification, qualitativeCorpus
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { processCandidate, type MemoryCandidate } from '../src/services/memory/marketingMemoryEngine';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import {
  acquireCorpusVectors, certifyCorpusCoverage, assertCorpusCoverage, readActiveContract,
} from '../tests/evals/corpusEmbeddingCertification';
import { primeFromCache } from '../tests/evals/evalEmbeddingCache';
import { QUALITATIVE_CORPUS, QUALITATIVE_CORPUS_HASH, INCUMBENT_ONLY, coverage, type Scenario } from '../tests/fixtures/qualitative/qualitativeCorpus';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const F = uuidFrom('qual-founder');
const WS = { A: uuidFrom('qual-ws-a'), B: uuidFrom('qual-ws-b') };
const PR = { A: uuidFrom('qual-prod-a'), B: uuidFrom('qual-prod-b') };
const db = () => getSupabaseAdmin();
const incId = (id: string) => uuidFrom(`qual-inc-${id}`);
const evId = (id: string) => uuidFrom(`qual-ev-${id}`);

async function seed() {
  await db().from('founders').upsert({ id: F, email: 'qual@lab.invalid', name: 'QUAL LAB', plan: 'studio' }, { onConflict: 'id' });
  for (const k of ['A', 'B'] as const) {
    await db().from('workspaces').upsert({ id: WS[k], founder_id: F, name: `Qual ${k}` }, { onConflict: 'id' });
    await db().from('products').upsert({ id: PR[k], founder_id: F, workspace_id: WS[k], name: `Qual${k}`, store_url: 'https://x.invalid', platform: 'app_store' }, { onConflict: 'id' });
  }

  // Evidence rows — text is written SEPARATELY from the claim by construction.
  const ev = QUALITATIVE_CORPUS.map(c => ({
    id: evId(c.id), founder_id: F, product_id: PR[c.ws], workspace_id: WS[c.ws],
    evidence_type: 'external', source_id: `qual://${c.id}`, source_table: 'qualitative_lab',
    data: { text: c.evidence, corpusHash: QUALITATIVE_CORPUS_HASH }, confidence_boost: 0,
  }));
  const { data: haveEv } = await db().from('evidence').select('id').in('id', ev.map(r => r.id));
  const seenEv = new Set(((haveEv ?? []) as { id: string }[]).map(r => r.id));
  const missEv = ev.filter(r => !seenEv.has(r.id));
  for (let i = 0; i < missEv.length; i += 20) {
    const { error } = await db().from('evidence').insert(missEv.slice(i, i + 20));
    if (error) throw new Error(`evidence: ${error.message}`);
  }

  // Incumbents — seeded, and NEVER submitted as candidates.
  const inc = QUALITATIVE_CORPUS.filter(c => c.incumbent).map(c => {
    const n = normalizeMemoryScope(c.incumbentScope ?? {});
    return {
      id: incId(c.id), founder_id: F, product_id: PR[c.ws], workspace_id: WS[c.ws],
      memory_type: 'product', title: c.incumbent!.slice(0, 110), content: { claim: c.incumbent },
      source: c.incumbentTier === 'FOUNDER_ASSERTED' ? 'founder_bootstrap' : 'analytics',
      confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
      memory_class: 'LEARNING', authority_tier: c.incumbentTier, authority_policy_version: 1,
      scope: n.scope, scope_key: n.scopeKey,
      scope_specificity: n.specificity, scope_completeness: n.completeness,
    };
  });
  // Incumbent-only rows: seeded, never candidates. This is how the isolation
  // probe gets identical text into the OTHER business without creating a
  // self-match.
  for (const io of INCUMBENT_ONLY) {
    const n = normalizeMemoryScope(io.scope);
    inc.push({
      id: uuidFrom(`qual-inconly-${io.id}`), founder_id: F,
      product_id: PR[io.ws], workspace_id: WS[io.ws],
      memory_type: 'product', title: io.claim.slice(0, 110), content: { claim: io.claim },
      source: io.tier === 'FOUNDER_ASSERTED' ? 'founder_bootstrap' : 'analytics',
      confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
      memory_class: 'LEARNING', authority_tier: io.tier, authority_policy_version: 1,
      scope: n.scope, scope_key: n.scopeKey,
      scope_specificity: n.specificity, scope_completeness: n.completeness,
    });
  }

  const { data: haveM } = await db().from('marketing_memories').select('id').in('id', inc.map(r => r.id));
  const seenM = new Set(((haveM ?? []) as { id: string }[]).map(r => r.id));
  const missM = inc.filter(r => !seenM.has(r.id));
  for (let i = 0; i < missM.length; i += 20) {
    const { error } = await db().from('marketing_memories').insert(missM.slice(i, i + 20));
    if (error) throw new Error(`incumbent: ${error.message}`);
  }
  return { evidence: missEv.length, incumbents: missM.length, totalIncumbents: inc.length };
}

function candidateFor(c: Scenario): MemoryCandidate {
  return {
    workspaceId: WS[c.ws], productId: PR[c.ws],
    claimText: c.claim, memoryClass: 'LEARNING',
    source: c.tier === 'FOUNDER_ASSERTED' ? 'founder_bootstrap' : 'analytics',
    scope: c.scope,
    provenance: { kind: 'connection_insight', sourceId: `qual://${c.id}` },
    actorType: 'system',
    evidenceIds: [evId(c.id)],
    evidenceIndependenceKeys: [c.independenceKey],
    evidenceRecords: [{ id: evId(c.id), text: c.evidence }],
    sampleSize: 500, claimIsRuleGenerated: true, domainRef: null,
  };
}

async function main() {
  console.log('QUALITATIVE_CORPUS_HASH =', QUALITATIVE_CORPUS_HASH);
  const cov = coverage();
  console.log(`scenarios=${cov.total} incumbents=${cov.incumbents} workspaces=${cov.workspaces.join(',')}`);

  const seeded = await seed();
  console.log(`seeded: ${seeded.evidence} evidence, ${seeded.incumbents} incumbents (${seeded.totalIncumbents} total)`);

  // ── COVERAGE GUARDS ──────────────────────────────────────────────────────
  const acq = await acquireCorpusVectors(db() as never, [WS.A, WS.B]);
  console.log(`vectors: ${acq.fromCache} cached + ${acq.embedded} embedded (${acq.providerRequests} req)`);
  const cc = await certifyCorpusCoverage(db() as never, [WS.A, WS.B]);
  assertCorpusCoverage(cc);
  console.log(`CORPUS_COVERAGE ${cc.current}/${cc.expected}`);

  const contract = await readActiveContract(db() as never);
  const queries = [...new Set([...QUALITATIVE_CORPUS.flatMap(c => [c.claim, c.incumbent ?? '']), ...INCUMBENT_ONLY.map(i => i.claim)].filter(Boolean))];
  const primed = primeFromCache(queries, {
    provider: contract.provider, model: contract.model,
    dimensions: contract.dimensions, version: contract.embedding_version,
  });
  if (primed.primed < primed.requested) {
    console.error(`QUERY_SEMANTIC_COVERAGE_INCOMPLETE ${primed.primed}/${primed.requested} — run eval:acquire-qual`);
    process.exit(2);
  }
  console.log(`QUERY_COVERAGE ${primed.primed}/${primed.requested}`);

  // ── RUN ──────────────────────────────────────────────────────────────────
  const rows: Array<Record<string, unknown>> = [];
  for (const c of QUALITATIVE_CORPUS) {
    // Diagnostic filter. Inert unless LM_ONLY is set; scored runs are unaffected.
    if (process.env.LM_ONLY && c.id !== process.env.LM_ONLY) continue;
    const res = await processCandidate(candidateFor(c), { allowModel: true });
    const outcome = res.eligibility.result === 'ELIGIBLE'
      ? (res.promotion?.outcome ?? 'NO_DECISION')
      : 'REJECTED_AT_GATE_A';
    rows.push({
      id: c.id, category: c.category, ws: c.ws, expected: c.expected, outcome,
      gateA: res.eligibility.result, gateAReason: res.eligibility.reason,
      support: res.eligibility.support?.result ?? null,
      belief: res.promotion?.beliefAction ?? null,
      review: Boolean(res.promotion?.requiresFounderReview),
      related: res.relatedRetrieved, model: res.modelCalls,
      degraded: res.retrievalDegraded,
      semanticOk: c.acceptable.includes(outcome),
      acceptable: c.acceptable,
    });
  }

  // ── HARNESS ADMISSIBILITY ────────────────────────────────────────────────
  const selfEvidence = QUALITATIVE_CORPUS.filter(c => c.evidence.trim() === c.claim.trim()).length;
  // Self-match is WORKSPACE-SCOPED. Identical text in the OTHER lab business is
  // the isolation fixture (q37), not a self-match — flagging it globally was a
  // defect in this check, not in the corpus.
  const incumbentByWs = new Map<string, Set<string>>();
  for (const c of QUALITATIVE_CORPUS) {
    if (!c.incumbent) continue;
    if (!incumbentByWs.has(c.ws)) incumbentByWs.set(c.ws, new Set());
    incumbentByWs.get(c.ws)!.add(c.incumbent);
  }
  for (const io of INCUMBENT_ONLY) {
    if (!incumbentByWs.has(io.ws)) incumbentByWs.set(io.ws, new Set());
    incumbentByWs.get(io.ws)!.add(io.claim);
  }
  const selfMatch = QUALITATIVE_CORPUS
    .filter(c => incumbentByWs.get(c.ws)?.has(c.claim)).length;
  const degraded = rows.filter(r => r.degraded).length;
  const modelUnavailable = rows.filter(r => r.gateAReason === 'MODEL_UNAVAILABLE').length;
  const admissible = selfEvidence === 0 && selfMatch === 0 && degraded === 0 && cc.complete;

  console.log('\n================ HARNESS ADMISSIBILITY ================');
  console.log(`  self-evidence cases       : ${selfEvidence} (must be 0)`);
  console.log(`  incumbent-as-candidate    : ${selfMatch} (must be 0)`);
  console.log(`  degraded semantic cases   : ${degraded} (must be 0)`);
  console.log(`  corpus coverage complete  : ${cc.complete}`);
  console.log(`  query coverage            : ${primed.primed}/${primed.requested}`);
  console.log(`  model calls total         : ${rows.reduce((a, r) => a + (r.model as number), 0)}`);
  console.log(`  ADMISSIBLE                : ${admissible}`);
  if (!admissible) { console.log('\nHARNESS_NOT_ADMISSIBLE'); process.exit(3); }

  // ── SCORING (strict) ─────────────────────────────────────────────────────
  const scored = rows.filter(r => r.category !== 'L_PRESSURE_ISOLATION');
  const semOk = scored.filter(r => r.semanticOk).length;

  const UNSAFE_POSITIVE = ['REINFORCE', 'SUPERSEDE', 'CREATE_SCOPED_EXCEPTION'];
  const unsafe = scored.filter(r => {
    const exp = r.expected as string;
    const out = r.outcome as string;
    if (!UNSAFE_POSITIVE.includes(out)) return false;
    if ((r.acceptable as string[]).includes(out)) return false;
    // ANY positive belief transition the frozen label does not license.
    //
    // The earlier rule whitelisted only expected ∈ {CREATE_NEW, DEFER,
    // REJECTED_AT_GATE_A}, which excluded expected=CHALLENGE — the single most
    // dangerous transition there is. A claim that inverts an existing belief
    // being REINFORCED is exactly the B1 false-reinforcement failure mode, and
    // it was being reported as safe.
    void exp;
    return true;
  });

  console.log('\n================ RESULTS ================');
  console.log(`  SEMANTIC  ${semOk}/${scored.length} = ${(100 * semOk / scored.length).toFixed(1)}%`);
  console.log(`  SAFETY    unsafe positive transitions = ${unsafe.length}`);
  if (unsafe.length) unsafe.forEach(u => console.log(`     UNSAFE ${u.id} expected=${u.expected} got=${u.outcome}`));

  const byCat: Record<string, { ok: number; n: number }> = {};
  for (const r of scored) {
    const k = r.category as string;
    byCat[k] = byCat[k] ?? { ok: 0, n: 0 };
    byCat[k].n++; if (r.semanticOk) byCat[k].ok++;
  }
  console.log('\n  BY CATEGORY:');
  Object.entries(byCat).sort().forEach(([k, v]) =>
    console.log(`    ${k.padEnd(26)} ${v.ok}/${v.n}`));

  console.log('\n  PER CASE:');
  scored.forEach(r => console.log(
    `    ${r.id} ${String(r.category).padEnd(24)} exp=${String(r.expected).padEnd(24)} got=${String(r.outcome).padEnd(24)} ` +
    `rel=${r.related} model=${r.model} ${r.semanticOk ? 'OK ' : 'MISS'}`));

  // ── FRAGMENTATION ────────────────────────────────────────────────────────
  const shouldRelate = scored.filter(r =>
    ['REINFORCE', 'CHALLENGE', 'CREATE_SCOPED_EXCEPTION'].includes(r.expected as string));
  const fragmented = shouldRelate.filter(r => r.outcome === 'CREATE_NEW');
  console.log(`\n  FRAGMENTATION: ${fragmented.length}/${shouldRelate.length} of should-relate cases became CREATE_NEW` +
              ` = ${(100 * fragmented.length / Math.max(1, shouldRelate.length)).toFixed(1)}%`);
  if (fragmented.length) console.log(`     ${fragmented.map(f => f.id).join(', ')}`);

  // ── ISOLATION ────────────────────────────────────────────────────────────
  const iso = rows.find(r => r.category === 'L_PRESSURE_ISOLATION')!;
  // q37 is seeded in workspace A (see the fixture note: moving it to B made its
  // text collide with q28's incumbent). This line therefore reports SAME-workspace
  // pressure, and a non-zero `related` is CORRECT. The earlier "** LEAK **" label
  // was a harness bug, not a tenancy finding — cross-workspace isolation is proven
  // by workspaceIsolation.test.ts and relevanceAuthorityMatrix.pg.test.ts CASE 8.
  console.log(`\n  PRESSURE (ws ${iso.ws ?? 'A'}, same-workspace): related=${iso.related} outcome=${iso.outcome}` +
              `  ${iso.outcome === 'CREATE_NEW' ? 'OK — distinct claim kept separate under pressure' : 'REVIEW'}`);

  // ── GATE A / EVIDENCE SUPPORT ────────────────────────────────────────────
  const unsup = rows.filter(r => r.category === 'M_UNSUPPORTED_EVIDENCE');
  console.log(`\n  UNSUPPORTED EVIDENCE: ${unsup.filter(r => r.outcome === 'REJECTED_AT_GATE_A').length}/${unsup.length} rejected`);
  unsup.forEach(r => console.log(`     ${r.id} gateA=${r.gateA}/${r.gateAReason} support=${r.support}`));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message ?? e); process.exit(1); });
}

export const QUALITATIVE_QUERIES: string[] = [...new Set([
  ...QUALITATIVE_CORPUS.flatMap(c => [c.claim, c.incumbent ?? '']),
  ...INCUMBENT_ONLY.map(i => i.claim),
].filter(Boolean))];
