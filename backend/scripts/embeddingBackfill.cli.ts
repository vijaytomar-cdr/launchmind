#!/usr/bin/env tsx
/**
 * @file embeddingBackfill.cli.ts
 * @description Operator entry point for the embedding backfill.
 *
 *   DRY RUN BY DEFAULT. `--execute` is required to enqueue anything, and even
 *   then nothing is embedded here: the command only writes outbox rows, which the
 *   worker drains under the normal rate limiting, retry policy and tenancy
 *   re-verification (Step 3.1C §8).
 *
 * Usage:
 *   npm run embeddings:backfill                          # counts only
 *   npm run embeddings:backfill -- --execute             # enqueue
 *   npm run embeddings:backfill -- --source marketing_memory --workspace <uuid>
 *   npm run embeddings:backfill -- --execute --batch 100
 *
 * @security Never calls an embedding provider. Workspace filtering is applied
 *   server-side.
 */

import { runBackfill, BACKFILLABLE_SOURCE_TYPES } from '../src/services/memory/embeddingBackfill';
import type { EmbeddingSourceType } from '../src/types/embedding';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const source = arg('source') as EmbeddingSourceType | undefined;

  if (source && !BACKFILLABLE_SOURCE_TYPES.includes(source)) {
    console.error(`Unknown --source "${source}". One of: ${BACKFILLABLE_SOURCE_TYPES.join(', ')}`);
    process.exit(1);
  }

  const report = await runBackfill({
    execute,
    sourceTypes: source ? [source] : undefined,
    workspaceId: arg('workspace'),
    batchSize: arg('batch') ? Number(arg('batch')) : undefined,
  });

  console.log(`\nEmbedding backfill — ${report.dryRun ? 'DRY RUN (nothing written)' : 'EXECUTED'}`);
  console.log(`Contract: ${report.contract.provider}/${report.contract.model} ` +
              `${report.contract.dimensions}d  generation=${report.contract.generationEnabled ? 'ON' : 'OFF'}\n`);
  console.log(`  ${'source type'.padEnd(22)}${'eligible'.padStart(9)}${'current'.padStart(9)}` +
              `${'queued'.padStart(8)}${'to enqueue'.padStart(12)}${'enqueued'.padStart(10)}`);
  console.log('  ' + '-'.repeat(70));
  for (const c of report.counts) {
    console.log(`  ${c.sourceType.padEnd(22)}${String(c.eligible).padStart(9)}` +
                `${String(c.alreadyCurrent).padStart(9)}${String(c.alreadyQueued).padStart(8)}` +
                `${String(c.toEnqueue).padStart(12)}${String(c.enqueued).padStart(10)}`);
  }
  console.log('  ' + '-'.repeat(70));
  console.log(`  ${'TOTAL'.padEnd(22)}${String(report.totals.eligible).padStart(9)}` +
              `${''.padStart(17)}${String(report.totals.toEnqueue).padStart(12)}` +
              `${String(report.totals.enqueued).padStart(10)}\n`);

  if (report.dryRun && report.totals.toEnqueue > 0) {
    console.log('  Re-run with --execute to enqueue. The worker will drain the outbox.');
  }
  if (!report.contract.generationEnabled) {
    console.log('  NOTE: generation is OFF. Work will queue durably and wait.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
