/**
 * @file setStability.ts
 * @description §9 — 10 complete A/B/C sets through the real orchestrator.
 *   In-memory. Nothing persisted, nothing approved.
 */
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { generateCreativeSet } from '../src/services/content/creativeSetOrchestrator';
import { classifyHeadlineShape } from '../src/services/content/creativeConceptContract';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import type { ContentStrategy } from '../src/services/content/strategyComposition';

const db = getSupabaseAdmin();
const SETS = Number(process.env.SETS ?? 10);

async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'set stability', persist: false }));
  const { data: camp } = await db.from('content_campaigns').select('*')
    .eq('product_id', ax.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const c: any = camp;
  const { data: strow } = await db.from('content_strategies').select('*')
    .eq('content_campaign_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const r: any = strow;

  const strategy: ContentStrategy = {
    workspaceId: ax.workspace_id, productId: ax.id, objective: r.objective,
    audience: r.audience, campaignThesis: c.thesis, angle: r.angle,
    coreNarrative: c.message_angle, messageHierarchy: r.message_hierarchy ?? [],
    proofAvailable: c.proof_available ?? [],
    proofUnavailable: (r.proof_unavailable ?? []).filter((p: string) =>
      !/ctaDestination|authorised product imagery/i.test(p)),
    ctaIntent: 'See how AllignX works', constraints: [], objections: c.objections ?? [],
    productRole: c.product_role, primaryBenefit: c.primary_benefit,
    brandDirectives: [], prohibitedTerminology: [], intelligenceInformed: [],
    founderOverrides: [], memoryApplied: [], brandKitVersion: c.brand_kit_version ?? 1,
  };

  let clean = 0, caps = 0, unsupported = 0, gens = 0;
  const causes = new Map<string, number>();
  const bump = (k: string) => causes.set(k, (causes.get(k) ?? 0) + 1);

  for (let i = 1; i <= SETS; i++) {
    const out = await generateCreativeSet({ ctx, strategy, founderId: ax.founder_id });
    gens += out.totalGenerations;
    const isClean = out.readyCount === 3 && out.setDistinct;
    if (isClean) clean++;
    for (const o of out.concepts) {
      caps += o.capabilityViolations.length;
      unsupported += (o.result?.claims ?? []).filter(k => k.verdict === 'UNSUPPORTED').length;
      if (o.status !== 'READY') {
        bump(o.capabilityViolations.length ? 'UNSUPPORTED_CAPABILITY'
          : o.conceptViolations.length ? `CONCEPT_ROLE:${o.conceptViolations[0].code}`
          : o.result?.disposition !== 'ELIGIBLE' ? 'GOVERNANCE' : 'SET_COLLAPSE');
      }
    }
    if (!out.setDistinct) bump('SET_DISTINCTNESS');
    console.log(`set ${String(i).padStart(2)} ready=${out.readyCount}/3 distinct=${out.setDistinct} ` +
      `gens=${out.totalGenerations} clean=${isClean}`);
    for (const o of out.concepts) {
      const h = String((o.result?.payload as any)?.headline ?? '');
      console.log(`    ${o.name.padEnd(22)} ${o.status.padEnd(16)} att=${o.attempts} ` +
        `shape=${classifyHeadlineShape(h).padEnd(13)} ${JSON.stringify(h)}`);
      if (o.ownerReason) console.log(`      -> ${o.ownerReason}`);
    }
  }
  console.log(`\nCLEAN SETS ${clean}/${SETS}`);
  console.log(`capability violations ACCEPTED: ${caps} | unsupported claims ACCEPTED: ${unsupported}`);
  console.log(`generation calls: ${gens} (avg ${(gens / SETS).toFixed(1)} per set)`);
  console.log('failure causes:');
  for (const [k, v] of [...causes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
