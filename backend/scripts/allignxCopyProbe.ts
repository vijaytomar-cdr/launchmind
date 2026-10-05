/**
 * Regenerates the AllignX Meta copy through the REAL governed pipeline.
 *
 * IN MEMORY ONLY — persistGovernedArtifact is not called, so no content
 * version is written. This measures whether the evidence-handle fix and the
 * rewrite-feedback fix make the copy eligible, and nothing else.
 */
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { generateChannelContent } from '../src/services/content/b3ContentGeneration';
import { deriveContentBrief } from '../src/services/content/briefComposition';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import type { ContentStrategy } from '../src/services/content/strategyComposition';

const db = getSupabaseAdmin();
async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'meta ad', persist: false }));

  const { data: camp } = await db.from('content_campaigns')
    .select('*').eq('product_id', ax.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const c: any = camp;
  const { data: strow } = await db.from('content_strategies').select('*')
    .eq('content_campaign_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const r: any = strow;

  const strategy: ContentStrategy = {
    workspaceId: ax.workspace_id, productId: ax.id,
    objective: r.objective, audience: r.audience,
    campaignThesis: c.thesis, angle: r.angle,
    coreNarrative: c.message_angle,
    messageHierarchy: r.message_hierarchy ?? [],
    // RE-RESOLVED, not read from the snapshot. The snapshot recorded
    // "no authorised product imagery" and "ctaDestination requires your
    // confirmation" — both of which the owner has since resolved.
    proofAvailable: c.proof_available ?? [],
    proofUnavailable: (r.proof_unavailable ?? []).filter((p: string) =>
      !/ctaDestination|authorised product imagery/i.test(p)),
    ctaIntent: 'See how AllignX works',
    constraints: [], objections: c.objections ?? [],
    productRole: c.product_role, primaryBenefit: c.primary_benefit,
    brandDirectives: [], prohibitedTerminology: [],
    intelligenceInformed: [], founderOverrides: [], memoryApplied: [],
    brandKitVersion: c.brand_kit_version ?? 1,
  };

  const brief = deriveContentBrief('META_AD', strategy, ctx);
  const res = await generateChannelContent({
    brief, strategy, ctx, founderId: ax.founder_id, variantLabel: 'pain-led',
  });
  console.log('disposition:', res.disposition, '| rewrite attempts:', res.rewriteAttempts);
  console.log('reasons:', JSON.stringify(res.reasons));
  console.log('structuralIssues:', JSON.stringify(res.structuralIssues));
  console.log('payload:', JSON.stringify(res.payload, null, 1));
  console.log('claims:');
  for (const cl of res.claims) console.log('  ', cl.verdict.padEnd(12), cl.category.padEnd(22), JSON.stringify(cl.text).slice(0,74));
  console.log('quality:', JSON.stringify(res.quality));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
