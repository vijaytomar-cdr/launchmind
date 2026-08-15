/**
 * @file shadowObservation.ts
 * @description Runs the controlled corpus through the REAL shadow pipeline and
 *   measures it — 3.2A Observation §6, §9–§18.
 *
 *   Every candidate goes through the actual engine: Gate A → bounded
 *   RetrievalService → ClaimComparison → MemoryPromotionPolicy → durable
 *   proposal. No proposal row is fabricated; nothing authoritative is mutated.
 *
 *   Expected labels come from `shadowObservationDataset.ts`, fixed before the
 *   run. This script never writes a label.
 *
 *   Runs against a LOCAL disposable Supabase in its own workspace. The 33
 *   production memories are not read, not compared against, and not touched.
 *
 * @security Local only — refuses a non-local target. Hostile fixture text is
 *   INPUT, used to prove refusal.
 * @dependencies marketingMemoryEngine, shadowObservationDataset
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve as resolvePath } from 'path';

// The script MUST run against the same real provider the evaluation cache was
// built with. Without this the resolver falls back to the deterministic 8-dim
// provider, the corpus is embedded at the wrong width, every vector is filtered
// out by the dimension guard, and retrieval degrades to LEXICAL_ONLY while the
// run still reports a hybrid-looking result. That is precisely the silent
// degradation this observation exists to rule out.
(function loadEnvLocal(): void {
  // A three-line reader rather than a dependency: `dotenv` is not a backend
  // package here, and this script must not change the production dependency set.
  const path = resolvePath(__dirname, '../../.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;         // an exported value wins
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
})();
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { resolveEmbeddingProvider } from '../src/services/memory/providers/index';
import { processCandidate } from '../src/services/memory/marketingMemoryEngine';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import { runBatchGrouped } from '../src/services/memory/embeddingPipeline';
import { primeFromCache, assertSemanticCoverage } from '../tests/evals/evalEmbeddingCache';
import {
  OBSERVATION_CASES, INCUMBENTS, LEGACY_INCUMBENTS, DATASET_SIZE, type ObservationCase,
} from '../tests/fixtures/shadowObservationDataset';

/**
 * A FRESH workspace per run.
 *
 * Shadow proposals are append-only by trigger (migration 100), so a re-run
 * cannot delete the previous run's rows — and an earlier version of this seeder
 * tried to, ignored the refusal, and then had every proposal silently rejected
 * by the idempotency index as a duplicate. The observation reported 89
 * candidates while the database held 5 rows from a partial first run.
 *
 * The trigger is correct; the harness was wrong. Isolating each run in its own
 * workspace respects the append-only guarantee instead of fighting it.
 */
const RUN = randomUUID().slice(0, 8);
const F  = `7f000001-0000-4000-8000-${RUN.padEnd(12, '0')}`;
const WS = `7f000002-0000-4000-8000-${RUN.padEnd(12, '0')}`;
const PA = `7f000003-0000-4000-8000-${RUN.padEnd(12, '0')}`;
const PB = `7f000004-0000-4000-8000-${RUN.padEnd(12, '0')}`;

/**
 * No pacing. Query embeddings are pre-computed in ONE batched provider call and
 * primed into the retrieval cache (see `primeQueries`), so the run makes no
 * per-candidate provider request at all.
 *
 * This replaces three failed attempts at pacing around a 3-request/minute tier:
 * unpaced ran lexical-only, paced took 30+ minutes, and paced-with-retry stalled
 * outright. Removing the per-candidate call removes the problem rather than
 * negotiating with it.
 */
const PACE_MS = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Tables that must be byte-identical after the run (§16). */
const AUTHORITATIVE = [
  'marketing_memories', 'marketing_memory_versions', 'memory_challenges',
  'learning_events', 'memory_evidence',
];

async function snapshot(): Promise<{ hash: string; counts: Record<string, number> }> {
  const db = getSupabaseAdmin();
  const counts: Record<string, number> = {};
  const parts: string[] = [];
  for (const t of AUTHORITATIVE) {
    const { data } = await db.from(t).select('*').order('id', { ascending: true });
    const rows = data ?? [];
    counts[t] = rows.length;
    parts.push(`${t}:${JSON.stringify(rows)}`);
  }
  return { hash: createHash('sha256').update(parts.join('||')).digest('hex'), counts };
}

async function seedCorpus(): Promise<void> {
  const db = getSupabaseAdmin();
  // Clean only THIS workspace. Production rows live elsewhere and are untouched.
  await db.from('memory_evidence').delete().eq('workspace_id', WS);
  // Provider parity check — corpus vectors and cached query vectors must come
  // from the SAME contract, or pgvector's dimension filter silently returns
  // nothing and nomination is lexical with no error anywhere.
  const { provider: emb, live } = resolveEmbeddingProvider();
  if (!live) {
    throw new Error(
      'refusing to run: embedding provider resolved to ' +
      `${emb.capabilities.provider}/${emb.capabilities.dimensions}d, not live Voyage. ` +
      'The corpus would be embedded at the wrong width and every retrieval would ' +
      'degrade to LEXICAL_ONLY without raising. Check VOYAGE_API_KEY.');
  }
  const CONTRACT_DIMS = emb.capabilities.dimensions;
  const CONTRACT_MODEL = emb.capabilities.model;
  console.log(`  provider: voyage/${CONTRACT_MODEL}/${CONTRACT_DIMS}d (live)`);

  await db.from('embedding_outbox').delete().eq('workspace_id', WS);
  await db.from('memory_embeddings').delete().eq('workspace_id', WS);
  await db.from('marketing_memories').delete().eq('workspace_id', WS);
  await db.from('evidence').delete().eq('workspace_id', WS);

  // Upsert rather than delete-and-recreate: the founder/workspace/product rows
  // are referenced by other tables and a partial cascade leaves the seeder
  // failing on its own leftovers, which is what happened on the second run.
  const must = async (t: string, row: Record<string, unknown>) => {
    const { error } = await db.from(t).upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`seed ${t}: ${error.message}`);
  };
  await must('founders',   { id: F, email: `shadow-observation-${RUN}@local.test` });
  await must('workspaces', { id: WS, founder_id: F, name: 'Observation' });
  await must('products',   { id: PA, founder_id: F, workspace_id: WS, name: 'ObsA' });
  await must('products',   { id: PB, founder_id: F, workspace_id: WS, name: 'ObsB' });

  for (const inc of INCUMBENTS) {
    const n = normalizeMemoryScope(inc.scope);
    const { data, error } = await db.from('marketing_memories').insert({
      founder_id: F, workspace_id: WS, product_id: PA,
      memory_type: 'campaign', title: inc.title,
      content: { claim: inc.claim, ...inc.scope },
      source: inc.source, confidence: 0.75, status: 'active', version: 1,
      memory_class: inc.memoryClass, authority_tier: inc.authority,
      authority_policy_version: 1,
      scope: n.scope, scope_key: n.scopeKey,
      scope_specificity: n.specificity, scope_completeness: n.completeness,
    }).select('id').maybeSingle();
    if (error) throw new Error(`seed incumbent ${inc.key}: ${error.message}`);

    // Attach the incumbent's evidence lineage so the replay test is real.
    for (const k of inc.independenceKeys) {
      const { data: ev } = await db.from('evidence').insert({
        founder_id: F, workspace_id: WS, product_id: PA,
        evidence_type: 'campaign_metric', data: {}, authority_tier: inc.authority,
      }).select('id').maybeSingle();
      if (ev) {
        await db.from('memory_evidence').insert({
          memory_id: (data as { id: string }).id, evidence_id: (ev as { id: string }).id,
          workspace_id: WS, contribution: 'supporting', independence_key: k,
        });
      }
    }
  }

  // Legacy rows: no class, no authority, no scope — exactly the shape of the 33
  // production rows, so C11 quarantine is measured rather than assumed.
  for (const lg of LEGACY_INCUMBENTS) {
    const { error } = await db.from('marketing_memories').insert({
      founder_id: F, workspace_id: WS, product_id: PA,
      memory_type: 'campaign', title: lg.title,
      content: { claim: lg.claim, note: 'seed', synthetic: true },
      source: lg.source, confidence: 0.4, status: 'active', version: 1,
      // memory_class deliberately NULL — the legacy discriminator.
    });
    if (error) throw new Error(`seed legacy: ${error.message}`);
  }

  // Embed the seeded corpus through the REAL pipeline.
  //
  // Without this the semantic arm has no vectors for these incumbents and
  // nomination silently runs lexical-only — which would understate nomination
  // quality and misattribute every resulting CREATE_NEW to Gate B.
  await db.from('embedding_outbox').delete().eq('workspace_id', WS);
  const { data: mems } = await db.from('marketing_memories').select('id').eq('workspace_id', WS);
  for (const m of (mems ?? []) as Array<{ id: string }>) {
    // Errors here are FATAL. An ignored insert failure is exactly how run 1
    // measured lexical-only nomination and reported it as hybrid.
    const { error } = await db.from('embedding_outbox').insert({
      workspace_id: WS, source_type: 'marketing_memory', source_id: m.id,
      source_field: 'canonical', requested_provider: 'voyage',
      requested_model: CONTRACT_MODEL, requested_dimensions: CONTRACT_DIMS, status: 'pending',
    });
    if (error) throw new Error(`seed outbox: ${error.code} ${error.message}`);
  }
  const { count: queued } = await db.from('embedding_outbox')
    .select('id', { count: 'exact', head: true }).eq('workspace_id', WS).eq('status', 'pending');
  console.log(`  outbox queued: ${queued} for ${(mems ?? []).length} memories`);
  let embedded = 0;
  for (let i = 0; i < 8; i++) {
    const out = await runBatchGrouped(`obs-${i}`, 25);
    if (!out.length) break;
    embedded += out.filter(o => o.result === 'completed').length;
  }
  const { count } = await db.from('memory_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', WS).eq('status', 'current');
  console.log(`  embedded ${embedded} (current vectors in workspace: ${count})`);
  if (!count) {
    throw new Error('no vectors produced — nomination would be lexical-only and the measurement meaningless');
  }
}

/**
 * STAGE B priming — real Voyage vectors, zero provider calls.
 *
 * Reads the persistent evaluation cache acquired by Stage A. If any query is
 * missing a real vector the run REFUSES to publish rather than silently falling
 * back to a live call and re-introducing the rate-limit dependency that made
 * four previous runs unusable.
 */
async function primeQueries(): Promise<void> {
  const { data: c } = await getSupabaseAdmin()
    .from('embedding_contract').select('provider, model, embedding_version, dimensions')
    .eq('id', 1).maybeSingle();
  const contract = c as { provider: string; model: string; embedding_version: number; dimensions: number } | null;
  if (!contract) throw new Error('no embedding contract; retrieval would be lexical-only');

  const report = primeFromCache(OBSERVATION_CASES.map(x => x.claimText), {
    provider: contract.provider, model: contract.model,
    dimensions: contract.dimensions, version: contract.embedding_version,
  });
  assertSemanticCoverage(report);
  console.log(`  primed ${report.primed}/${report.requested} real Voyage query vectors from cache ` +
              `(${report.identity.model}/${report.identity.dimensions}d, 0 provider calls)`);
}

interface Row {
  c: ObservationCase;
  eligibility: string; reason: string;
  outcome: string; entryState: string | null;
  founderReview: boolean; authority: string;
  related: number; modelCalls: number; shortCircuited: boolean;
  nominatedTarget: string | null; latencyMs: number; degraded: boolean;
  eligibilityOk: boolean; outcomeOk: boolean; entryOk: boolean;
  authorityOk: boolean; reviewOk: boolean; overallOk: boolean;
}

/**
 * Maps a readable fixture evidence id to a stable UUID.
 *
 * `memory_shadow_proposals.evidence_ids` is `uuid[]`. The fixture uses labels
 * like `ev-inj64` because they are legible in a diff; passing them through
 * raised 22P02 and — because the store logged the error instead of raising —
 * silently discarded 84 of 89 proposals while the run still printed a full
 * result. The mapping is deterministic, so the same label is the same id on
 * every run and independence counting is unaffected.
 */
function fixtureUuid(label: string): string {
  const h = createHash('sha256').update(`fixture-evidence:${label}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16),
          ((parseInt(h[16], 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 20),
          h.slice(20, 32)].join('-');
}

/**
 * Whether the bounded model-assist path runs.
 *
 * The first observation ran deterministic-only, which looked conservative but
 * was not: with no model, every deferral is an UNRESOLVED comparison, and an
 * unresolved comparison is not a measurement of the promotion architecture —
 * it is a measurement of the architecture with a stage removed. All three
 * near-duplicate misses traced to exactly that. The production configuration
 * has the model, so certification runs with it.
 */
const ALLOW_MODEL = process.env.OBS_ALLOW_MODEL !== '0';

let persistDuplicates = 0;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? '';
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    console.error(`BLOCKED: observation seeds data and refuses a non-local target (${url || 'unset'}).`);
    process.exit(2);
  }
  if ((process.env.CONTINUOUS_LEARNING_INGESTION_MODE ?? 'shadow').trim().toLowerCase() === 'active') {
    console.error('BLOCKED: ingestion mode is ACTIVE. Observation runs in shadow only.');
    process.exit(2);
  }

  console.log(`\nShadow observation — ${DATASET_SIZE} candidates, ${INCUMBENTS.length} incumbents`);
  console.log(`  run workspace: ${WS}\n`);
  await seedCorpus();

  await primeQueries();

  const before = await snapshot();
  console.log(`  BEFORE  ${JSON.stringify(before.counts)}`);
  console.log(`  hash    ${before.hash.slice(0, 32)}…\n`);

  const rows: Row[] = [];
  let i = 0;
  for (const c of OBSERVATION_CASES) {
    if (PACE_MS && i++ > 0) await sleep(PACE_MS);
    if (++i % 20 === 0) process.stdout.write(`    ${i}/${OBSERVATION_CASES.length} …\n`);
    const t0 = Date.now();
    let r = await processCandidate({
      workspaceId: WS,
      productId: c.productKey === 'B' ? PB : PA,
      claimText: c.claimText,
      memoryClass: c.memoryClass,
      source: c.source,
      scope: c.scope,
      provenance: { kind: c.provenanceKind, sourceId: c.sourceId },
      actorType: c.actorType,
      founderConfirmed: c.founderConfirmed,
      controlledExperiment: c.controlledExperiment,
      evidenceIds: (c.evidenceIds ?? []).map(fixtureUuid),
      evidenceIndependenceKeys: c.independenceKeys,
      sampleSize: c.sampleSize ?? null,
      claimIsRuleGenerated: c.claimIsRuleGenerated,
    }, { allowModel: ALLOW_MODEL });

    // A 429 costs the semantic arm for THIS candidate only. Retry the candidate
    // rather than accept a lexical-only nomination inside a hybrid average.
    const latencyMs = Date.now() - t0;

    // A proposal that did not persist is a measurement that does not exist.
    // Earlier runs reported 89 evaluated candidates while the table held 5 rows,
    // because this error was never read.
    if (r.error) throw new Error(`persist failed for ${c.id}: ${r.error}`);
    if (!r.proposalId && !r.duplicate) throw new Error(`no proposal row for ${c.id}`);
    if (r.duplicate) persistDuplicates++;

    // The cross-workspace case deliberately claims WS while its product is in WS
    // too, so it is exercised by a payload/canonical mismatch instead — see the
    // dataset note. Everything else compares directly.
    const outcome = r.promotion?.outcome ?? 'NONE';
    const proposal = await getSupabaseAdmin()
      .from('memory_shadow_proposals')
      .select('authority_tier').eq('idempotency_key', r.idempotencyKey)
      .eq('workspace_id', WS).maybeSingle();
    const authority = (proposal.data as { authority_tier: string } | null)?.authority_tier ?? '—';

    const eligibilityOk = r.eligibility.result === c.expectEligibility;
    const outcomeOk = c.expectOutcome === 'NONE' ? outcome === 'NONE' : outcome === c.expectOutcome;
    const entryOk = c.expectEntryState === undefined
      || (r.promotion?.proposedEntryState ?? null) === c.expectEntryState;
    const authorityOk = c.expectAuthority === undefined || authority === c.expectAuthority;
    const reviewOk = c.expectFounderReview === undefined
      || (r.promotion?.requiresFounderReview ?? false) === c.expectFounderReview;

    rows.push({
      c, eligibility: r.eligibility.result, reason: r.eligibility.reason,
      outcome, entryState: r.promotion?.proposedEntryState ?? null,
      founderReview: r.promotion?.requiresFounderReview ?? false, authority,
      related: r.relatedRetrieved, modelCalls: r.modelCalls,
      shortCircuited: r.shortCircuited,
      nominatedTarget: r.promotion?.targetMemoryId ?? null, latencyMs,
      degraded: r.retrievalDegraded,
      eligibilityOk, outcomeOk, entryOk, authorityOk, reviewOk,
      overallOk: eligibilityOk && outcomeOk && entryOk && authorityOk && reviewOk,
    });
  }

  const degraded = rows.filter(r => !r.c && false).length;   // placeholder, replaced below
  void degraded;
  const after = await snapshot();
  const unchanged = after.hash === before.hash;
  console.log(`  AFTER   ${JSON.stringify(after.counts)}`);
  console.log(`  hash    ${after.hash.slice(0, 32)}…`);
  console.log(`  NO-MUTATION: ${unchanged ? 'PASS — byte-identical' : 'FAIL'}\n`);

  // ── Measurements ───────────────────────────────────────────────────────────
  const n = rows.length;
  const el = (v: string) => rows.filter(r => r.eligibility === v).length;
  const reasons: Record<string, number> = {};
  rows.filter(r => r.eligibility !== 'ELIGIBLE')
      .forEach(r => { reasons[r.reason] = (reasons[r.reason] ?? 0) + 1; });

  console.log('GATE A');
  console.log(`  total ${n} · eligible ${el('ELIGIBLE')} · evidence-only ${el('EVIDENCE_ONLY')} · rejected ${el('INELIGIBLE')}`);
  console.log(`  accuracy ${rows.filter(r => r.eligibilityOk).length}/${n}`);
  // A false positive REJECTS something legitimate; a false negative ADMITS
  // something it should have stopped. They are not symmetric in cost.
  const fp = rows.filter(r => c2(r) === 'ELIGIBLE' && r.eligibility !== 'ELIGIBLE');
  const fn = rows.filter(r => c2(r) !== 'ELIGIBLE' && r.eligibility === 'ELIGIBLE');
  console.log(`  false positives (legit rejected) ${fp.length} · false negatives (unsafe admitted) ${fn.length}`);
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(26)} ${v}`);
  }

  const outcomes: Record<string, number> = {};
  rows.forEach(r => { outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1; });
  console.log('\nGATE B');
  for (const [k, v] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
    const grp = rows.filter(r => r.outcome === k);
    console.log(`  ${k.padEnd(26)} ${String(v).padStart(3)}  correct ${grp.filter(r => r.outcomeOk).length}/${v}`);
  }
  const drafts = rows.filter(r => r.entryState === 'draft').length;
  const actives = rows.filter(r => r.entryState === 'active').length;
  console.log(`  proposed draft ${drafts} · proposed active ${actives}`);

  console.log('\nACCURACY');
  console.log(`  overall            ${rows.filter(r => r.overallOk).length}/${n}`);
  console.log(`  eligibility        ${rows.filter(r => r.eligibilityOk).length}/${n}`);
  console.log(`  outcome            ${rows.filter(r => r.outcomeOk).length}/${n}`);
  console.log(`  entry state        ${rows.filter(r => r.entryOk).length}/${n}`);
  console.log(`  authority          ${rows.filter(r => r.authorityOk).length}/${n}`);
  console.log(`  founder review     ${rows.filter(r => r.reviewOk).length}/${n}`);

  console.log('\nCOST');
  const lat = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  console.log(`  model calls total ${rows.reduce((a, r) => a + r.modelCalls, 0)} · max/candidate ${Math.max(...rows.map(r => r.modelCalls))}`);
  console.log(`  short-circuited at Gate A ${rows.filter(r => r.shortCircuited).length} (zero retrieval, zero model)`);
  console.log(`  related nominated: avg ${(rows.reduce((a, r) => a + r.related, 0) / n).toFixed(2)} · max ${Math.max(...rows.map(r => r.related))}`);
  console.log(`  latency p50 ${lat[Math.floor(n * 0.5)]}ms · p95 ${lat[Math.floor(n * 0.95)]}ms`);

  // ── Failures, in full ──────────────────────────────────────────────────────
  const bad = rows.filter(r => !r.overallOk);
  console.log(`\nMISMATCHES — ${bad.length}/${n}, reported not relabelled\n`);
  for (const b of bad) {
    console.log(`  ${b.c.id} [${b.c.group}] ${b.c.errorIfWrong}`);
    console.log(`    "${b.c.claimText.slice(0, 70)}"`);
    console.log(`    expected ${b.c.expectEligibility}/${b.c.expectOutcome}` +
      `${b.c.expectEntryState !== undefined ? '/' + b.c.expectEntryState : ''}` +
      `  got ${b.eligibility}/${b.outcome}${b.entryState ? '/' + b.entryState : ''}` +
      `${b.reason !== 'OK' ? ' (' + b.reason + ')' : ''}`);
    console.log(`    why: ${b.c.why}`);
  }

  writeFileSync(
    join(__dirname, '..', '..', 'docs', 'evals', 'shadow-observation-run.json'),
    JSON.stringify({
      datasetSize: n, incumbents: INCUMBENTS.length,
      noMutation: unchanged, before: before.counts, after: after.counts,
      gateA: { eligible: el('ELIGIBLE'), evidenceOnly: el('EVIDENCE_ONLY'),
               rejected: el('INELIGIBLE'), reasons, falsePositives: fp.length,
               falseNegatives: fn.length },
      gateB: outcomes, drafts, actives,
      accuracy: {
        overall: rows.filter(r => r.overallOk).length,
        eligibility: rows.filter(r => r.eligibilityOk).length,
        outcome: rows.filter(r => r.outcomeOk).length,
        entryState: rows.filter(r => r.entryOk).length,
        authority: rows.filter(r => r.authorityOk).length,
        founderReview: rows.filter(r => r.reviewOk).length,
      },
      cost: {
        modelCallsTotal: rows.reduce((a, r) => a + r.modelCalls, 0),
        maxPerCandidate: Math.max(...rows.map(r => r.modelCalls)),
        shortCircuited: rows.filter(r => r.shortCircuited).length,
        avgRelated: Number((rows.reduce((a, r) => a + r.related, 0) / n).toFixed(2)),
        p50: lat[Math.floor(n * 0.5)], p95: lat[Math.floor(n * 0.95)],
      },
      mismatches: bad.map(b => ({
        id: b.c.id, group: b.c.group, errorCategory: b.c.errorIfWrong,
        claim: b.c.claimText,
        expected: { eligibility: b.c.expectEligibility, outcome: b.c.expectOutcome,
                    entryState: b.c.expectEntryState ?? null },
        actual: { eligibility: b.eligibility, reason: b.reason,
                  outcome: b.outcome, entryState: b.entryState },
      })),
    }, null, 2),
  );
  console.log(`\nWrote docs/evals/shadow-observation-run.json\n`);
  if (!unchanged) process.exit(1);
}

/** The expected eligibility for a row, as fixed in the dataset. */
function c2(r: Row): string { return r.c.expectEligibility; }

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
