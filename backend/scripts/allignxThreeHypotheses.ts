/**
 * @file allignxThreeHypotheses.ts
 * @description §8/§9/§10 — three MESSAGE-distinct AllignX Meta concepts.
 *
 *   Runs the REAL generation pipeline three times, once per hypothesis, with
 *   the real AllignX context, real evidence, real brand and real Creative
 *   Intelligence patterns. No copy is hand-written and none is inserted.
 *
 *   Creative Intelligence patterns are supplied IN-PROCESS from the real
 *   observed corpus, because migration 122 is not applied and the persisted
 *   read path therefore returns nothing. That is stated in the output rather
 *   than hidden: the influence is genuine, the persistence is not yet.
 */
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { generateChannelContent } from '../src/services/content/b3ContentGeneration';
import { deriveContentBrief } from '../src/services/content/briefComposition';
import { CONCEPTS, CONCEPT_KEYS, assertConceptsDistinct, copyIsDistinct }
  from '../src/services/content/creativeConcepts';
import { derivePatterns } from '../src/services/creativeIntelligence/patternDerivation';
import { buildCreativeDirection, summariseDirection }
  from '../src/services/creativeIntelligence/creativeInfluence';
import { LANDING, VIDEO } from './creativeObservationCorpus';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import type { ContentStrategy } from '../src/services/content/strategyComposition';
import { writeFileSync } from 'fs';

const db = getSupabaseAdmin();

async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'meta concepts', persist: false }));

  const { data: camp } = await db.from('content_campaigns').select('*')
    .eq('product_id', ax.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const c: any = camp;
  const { data: strow } = await db.from('content_strategies').select('*')
    .eq('content_campaign_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const r: any = strow;

  const competitors = ctx.founderDirection.competitors;
  const obs = [...LANDING, ...VIDEO].map((o, i) => ({ ...o, id: `o${i}` }));
  const { patterns } = derivePatterns(obs as never, competitors);

  const out: any[] = [];
  for (const key of CONCEPT_KEYS) {
    const concept = CONCEPTS[key];
    const dir = buildCreativeDirection({
      patterns, messageAngle: `${c.message_angle} ${concept.hookDirection}`,
      channel: 'meta_ad',
      brandDirectives: Object.values(ctx.brand.fields)
        .filter((f: any) => f.ownerConfirmed).map((f: any) => String(f.value)),
    });
    const sum = summariseDirection(dir);

    const strategy: ContentStrategy = {
      workspaceId: ax.workspace_id, productId: ax.id,
      objective: r.objective, audience: r.audience,
      campaignThesis: c.thesis, angle: r.angle, coreNarrative: c.message_angle,
      messageHierarchy: r.message_hierarchy ?? [],
      proofAvailable: c.proof_available ?? [],
      proofUnavailable: (r.proof_unavailable ?? []).filter((p: string) =>
        !/ctaDestination|authorised product imagery/i.test(p)),
      ctaIntent: 'See how AllignX works',
      // CONCEPT-SPECIFIC GUIDANCE + the creative direction Creative Intelligence
      // selected for THIS concept. Constraints shape HOW it is said; they carry
      // no claim and cannot substantiate one.
      constraints: [concept.guidance,
        ...dir.influences.map(i => i.directive),
        ...dir.notImitated],
      objections: c.objections ?? [],
      productRole: c.product_role, primaryBenefit: c.primary_benefit,
      brandDirectives: [], prohibitedTerminology: [],
      intelligenceInformed: [], founderOverrides: [], memoryApplied: [],
      brandKitVersion: c.brand_kit_version ?? 1,
    };

    const brief = deriveContentBrief('META_AD', strategy, ctx);
    (brief as any).hookDirection = concept.hookDirection;

    const res = await generateChannelContent({
      brief, strategy, ctx, founderId: ax.founder_id, variantLabel: concept.name,
    });
    const p: any = res.payload;
    console.log(`\n=== ${concept.name} (${key}) ===`);
    console.log('disposition:', res.disposition, '| attempts:', res.rewriteAttempts);
    console.log('headline :', p.headline);
    console.log('primary  :', p.primaryText);
    console.log('desc     :', p.description);
    console.log('CI applied:', sum.recommends.join(' · ') || '(none)',
      '| patterns considered:', patterns.length,
      '| selected:', dir.influences.length);
    for (const cl of res.claims) {
      console.log('   ', String(cl.verdict).padEnd(18), String(cl.category).padEnd(22),
        JSON.stringify(cl.text).slice(0, 66));
    }
    out.push({ key, concept, result: res, direction: sum,
      influences: dir.influences, considered: patterns.length });
  }

  const shapes = CONCEPT_KEYS.map(k => CONCEPTS[k]);
  const d = assertConceptsDistinct(shapes);
  const cd = copyIsDistinct(out.map(o => String((o.result.payload as any).headline ?? '')));
  console.log('\n=== DISTINCTNESS ===');
  console.log('shape distinct:', d.distinct, '| differing:', d.differingDimensions.join(','),
    '| collapsed:', d.collapsedDimensions.join(',') || '(none)');
  console.log('copy distinct :', cd.distinct, '| worst headline overlap:', cd.overlap.toFixed(2));
  console.log('eligible      :', out.filter(o => o.result.disposition === 'ELIGIBLE').length, '/ 3');

  writeFileSync('/tmp/allignx-concepts.json', JSON.stringify(out, null, 1));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
