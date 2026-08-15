#!/usr/bin/env tsx
/**
 * @file memoryRetrieve.cli.ts
 * @description Developer debug harness for hybrid retrieval (Step 3.1D §16).
 *
 *   Shows exactly how a result was reached — which arms found it, at what rank,
 *   how fusion scored it and how business reranking moved it. This is the tool
 *   for answering "why did that come back?" without attaching a debugger.
 *
 *   NOT owner-facing. Prints no vectors, no credentials, no provider payloads.
 *
 * Usage:
 *   npm run memory:retrieve -- --workspace <uuid> --query "outcome messaging"
 *   npm run memory:retrieve -- --workspace <uuid> --query "…" --no-semantic
 *   npm run memory:retrieve -- --workspace <uuid> --query "…" --types founder,campaign
 *
 * @security Query text is echoed back to the operator who typed it, and nowhere
 *   else. Nothing is written to the database.
 */

import { retrieveMemories } from '../src/services/memory/retrievalService';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const workspaceId = arg('workspace');
  const query = arg('query');
  if (!workspaceId || !query) {
    console.error('Usage: npm run memory:retrieve -- --workspace <uuid> --query "<text>"');
    process.exit(1);
  }

  const res = await retrieveMemories({
    workspaceId,
    query,
    productId: arg('product'),
    memoryTypes: arg('types')?.split(',').map(s => s.trim()).filter(Boolean),
    limit: arg('limit') ? Number(arg('limit')) : 10,
    disableSemantic: process.argv.includes('--no-semantic'),
    disableLexical: process.argv.includes('--no-lexical'),
  });

  console.log(`\nQuery      : ${query}`);
  console.log(`Workspace  : ${workspaceId}`);
  console.log(`Mode       : ${res.mode}${res.degraded ? `  DEGRADED (${res.degradedReasons.join(', ')})` : ''}`);
  console.log(`Latency    : total ${res.timings.totalMs}ms  ` +
              `[structured ${res.timings.structuredMs} · lexical ${res.timings.lexicalMs} · ` +
              `semantic ${res.timings.semanticMs} (embed ${res.timings.queryEmbeddingMs}) · ` +
              `fuse ${res.timings.fusionMs} · rerank ${res.timings.rerankMs}]`);
  console.log(`Budget     : ${res.tokensUsed}/${res.tokenBudget} tokens · ${res.excludedForBudget} excluded`);
  console.log(`Diagnostics: ${res.diagnostics.fusedCandidates} fused · ` +
              `${res.diagnostics.staleVectorsExcluded} stale · ${res.diagnostics.missingVectors} missing vectors` +
              (res.diagnostics.annReviewDue ? `\n             ANN REVIEW DUE: ${res.diagnostics.annReviewReason}` : ''));

  console.log('\nArms');
  for (const a of res.arms) {
    console.log(`  ${a.arm.padEnd(11)} ${a.ran ? 'ran' : 'not run'}  ` +
                `candidates=${String(a.candidates).padStart(3)}  ${a.latencyMs}ms` +
                (a.unavailableReason ? `  (${a.unavailableReason})` : ''));
  }

  if (res.results.length === 0) {
    console.log(`\nNo results. ${res.degraded ? 'A retrieval arm was unavailable — see above.' : 'Nothing relevant exists in this workspace.'}\n`);
    return;
  }

  console.log('\nResults');
  for (const r of res.results) {
    console.log(`\n  #${r.finalRank}  ${r.title}`);
    console.log(`      id=${r.id}  v${r.version}  type=${r.memoryType}  source=${r.source}`);
    console.log(`      confidence=${r.confidence}  status=${r.status}  vector=${r.embeddingStatus}`);
    console.log(`      arms=[${r.arms.join(', ')}]  lexRank=${r.lexicalRank ?? '—'}  ` +
                `semRank=${r.semanticRank ?? '—'}` +
                (r.semanticDistance !== null ? ` (d=${r.semanticDistance.toFixed(4)})` : '') +
                `  fused=#${r.fusedRank} (${r.fusedScore.toFixed(5)})`);
    console.log(`      evidence=[${r.evidenceIds.join(', ') || 'none'}]  hash=${r.contentHash?.slice(0, 12) ?? 'none'}…`);
    if (r.rerankReasons.length) console.log(`      rerank: ${r.rerankReasons.join(' | ')}`);
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
