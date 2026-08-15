#!/usr/bin/env tsx
/**
 * @file contextShadowCompare.ts
 * @description Old Context Engine vs ContextPackage V2 on a controlled fixture
 *   set (Step 3.1E §27).
 *
 *   Compares on FACTS, not prose quality: which authoritative values survive,
 *   how much irrelevant history is carried, and package size. Subjective "which
 *   reads better" would not answer the only question that blocks a cutover —
 *   did anything the model needs disappear?
 *
 * Usage: tsx scripts/contextShadowCompare.ts --workspace <uuid> --founder <uuid> --product <uuid>
 */

import { buildContextPackage, formatContextForPrompt } from '../src/lib/contextEngine';
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { formatContextPackageForModel } from '../src/lib/context/contextFormatter';
import { compareRenderings } from '../src/lib/context/contextEngineAdapter';
import type { ContextIntent } from '../src/lib/context/contextIntents';

function arg(n: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; }

const CASES: Array<{ intent: ContextIntent; query: string }> = [
  { intent: 'MORNING_BRIEF',           query: 'What should we focus on next?' },
  { intent: 'STRATEGY_RECOMMENDATION', query: 'What positioning has worked best?' },
  { intent: 'CAMPAIGN_PLANNING',       query: 'Plan a meta campaign in usa. What worked on this channel?' },
  { intent: 'OWNER_QUESTION',          query: 'Which channel produced higher-quality customers?' },
];

async function main() {
  const workspaceId = arg('workspace')!, founderId = arg('founder')!, productId = arg('product') ?? null;
  if (!workspaceId || !founderId) { console.error('need --workspace and --founder'); process.exit(1); }

  const legacy = await buildContextPackage(founderId, productId);
  const legacyText = formatContextForPrompt(legacy);

  console.log('\nOLD vs NEW — controlled fixture comparison\n');
  console.log(`  legacy: ${legacy.sources.length} sources, ${legacy.memories.length} memories (top-N by confidence, query-agnostic)`);
  console.log(`          ${legacyText.length} chars ≈ ${Math.ceil(legacyText.length / 4)} tokens\n`);
  console.log(`  ${'intent'.padEnd(26)}${'v2 mem'.padStart(7)}${'v2 tok'.padStart(8)}${'legacy tok'.padStart(12)}${'mode'.padStart(16)}  lost authoritative`);
  console.log('  ' + '-'.repeat(92));

  let anyLoss = false;
  for (const c of CASES) {
    const pkg = await buildContextPackageV2({
      workspaceId, founderId, productId, intent: c.intent, query: c.query, persist: false,
    });
    const cmp = compareRenderings(legacyText, pkg);
    if (cmp.missingAuthoritative.length) anyLoss = true;
    console.log(`  ${c.intent.padEnd(26)}${String(cmp.v2Memories).padStart(7)}` +
                `${String(cmp.v2TokensEstimate).padStart(8)}${String(cmp.legacyTokensEstimate).padStart(12)}` +
                `${cmp.retrievalMode.padStart(16)}  ${cmp.missingAuthoritative.join(', ') || 'none'}`);
  }

  console.log('\n  Relevance note: legacy returns the SAME memories for every intent above');
  console.log('  (top-N by confidence, no query). V2 retrieves per intent and per question.');
  console.log(anyLoss
    ? '\n  RESULT: authoritative context was LOST — cutover blocked (§27).\n'
    : '\n  RESULT: no authoritative context lost across any intent.\n');

  const sample = await buildContextPackageV2({
    workspaceId, founderId, productId, intent: 'MORNING_BRIEF',
    query: 'What should we focus on next?', persist: false,
  });
  console.log('  V2 section headings:');
  for (const line of formatContextPackageForModel(sample).split('\n').filter(l => l.startsWith('## '))) {
    console.log(`    ${line}`);
  }
  console.log('');
}
main().catch(e => { console.error(e); process.exit(1); });
