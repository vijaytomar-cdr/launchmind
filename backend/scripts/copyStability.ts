/**
 * @file copyStability.ts
 * @description §10/§11 — is eligibility STABLE under unchanged governance?
 *
 *   Runs the real production pipeline N times with no manual correction of any
 *   kind. Records every disposition, every unsupported claim and every
 *   capability violation so a failure can be categorised rather than retried.
 */
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { generateChannelContent } from '../src/services/content/b3ContentGeneration';
import { deriveContentBrief } from '../src/services/content/briefComposition';
import { buildProductCapabilityContract, validatePayloadCapabilities }
  from '../src/services/content/productCapabilityContract';
import { CONCEPTS, CONCEPT_KEYS, assertConceptsDistinct, copyIsDistinct }
  from '../src/services/content/creativeConcepts';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import type { ContentStrategy } from '../src/services/content/strategyComposition';

const db = getSupabaseAdmin();
const RUNS = Number(process.env.RUNS ?? 10);
const MODE = process.env.MODE ?? 'single';   // 'single' | 'concepts'

async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'stability', persist: false }));
  const contract = buildProductCapabilityContract(ctx);
  console.log('capability contract:', contract.capabilities.map(c => c.verb).join(',') || '(none)',
    '| qualifiers:', contract.qualifiers.join(','));

  const { data: camp } = await db.from('content_campaigns').select('*')
    .eq('product_id', ax.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const c: any = camp;
  const { data: st } = await db.from('content_strategies').select('*')
    .eq('content_campaign_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const r: any = st;

  const strategyFor = (constraints: string[]): ContentStrategy => ({
    workspaceId: ax.workspace_id, productId: ax.id,
    objective: r.objective, audience: r.audience, campaignThesis: c.thesis,
    angle: r.angle, coreNarrative: c.message_angle,
    messageHierarchy: r.message_hierarchy ?? [], proofAvailable: c.proof_available ?? [],
    proofUnavailable: (r.proof_unavailable ?? []).filter((p: string) =>
      !/ctaDestination|authorised product imagery/i.test(p)),
    ctaIntent: 'See how AllignX works', constraints,
    objections: c.objections ?? [], productRole: c.product_role,
    primaryBenefit: c.primary_benefit, brandDirectives: [], prohibitedTerminology: [],
    intelligenceInformed: [], founderOverrides: [], memoryApplied: [],
    brandKitVersion: c.brand_kit_version ?? 1,
  });

  async function one(label: string, constraints: string[], hook?: string) {
    const strategy = strategyFor(constraints);
    const brief = deriveContentBrief('META_AD', strategy, ctx);
    if (hook) (brief as any).hookDirection = hook;
    const res = await generateChannelContent({
      brief, strategy, ctx, founderId: ax.founder_id, variantLabel: label });
    const caps = validatePayloadCapabilities(res.payload as never, contract);
    const unsupported = res.claims.filter(k => k.verdict === 'UNSUPPORTED');
    const narrative = res.claims.filter(k => k.verdict === 'NARRATIVE_FRAMING');
    return { res, caps, unsupported, narrative };
  }

  if (MODE === 'single') {
    let eligible = 0;
    const failures: string[] = [];
    for (let i = 1; i <= RUNS; i++) {
      const { res, caps, unsupported, narrative } = await one('stability', []);
      const ok = res.disposition === 'ELIGIBLE';
      if (ok) eligible++;
      else failures.push(`run${i}: ${caps.length ? 'CAPABILITY:' + caps.map(x=>x.verb).join('/') : ''}` +
        `${unsupported.length ? ' UNSUPPORTED:' + unsupported.map(u=>u.category).join('/') : ''}` +
        `${res.structuralIssues.length ? ' STRUCTURAL:' + res.structuralIssues.map(s=>s.rule).join('/') : ''}`);
      console.log(`run ${String(i).padStart(2)} ${String(res.disposition).padEnd(18)} ` +
        `safety=${String(res.quality.factualSafety).padEnd(20)} struct=${res.quality.structuralValidity} ` +
        `rw=${res.rewriteAttempts} caps=${caps.length} unsup=${unsupported.length} narr=${narrative.length}`);
      console.log(`        H: ${JSON.stringify((res.payload as any).headline)}`);
      if (!ok) {
        for (const u of unsupported) console.log(`        UNSUP [${u.field}] ${u.category} :: ${JSON.stringify(u.text).slice(0,90)}`);
        for (const cv of caps) console.log(`        CAP   ${cv.verb} :: "${cv.span}"`);
      }
    }
    console.log(`\nELIGIBLE ${eligible}/${RUNS}`);
    for (const f of failures) console.log('  FAILURE', f);
    return;
  }

  // MODE=concepts — N complete sets of three.
  let cleanSets = 0;
  for (let set = 1; set <= RUNS; set++) {
    const heads: string[] = []; const disp: string[] = [];
    let capViol = 0, unsup = 0;
    for (const key of CONCEPT_KEYS) {
      const cn = CONCEPTS[key];
      const { res, caps, unsupported } = await one(cn.name, [cn.guidance], cn.hookDirection);
      heads.push(String((res.payload as any).headline ?? ''));
      disp.push(res.disposition);
      capViol += caps.length; unsup += unsupported.length;
    }
    const shape = assertConceptsDistinct(CONCEPT_KEYS.map(k => CONCEPTS[k]));
    const cd = copyIsDistinct(heads);
    const clean = disp.every(d => d === 'ELIGIBLE') && capViol === 0 && shape.distinct && cd.distinct;
    if (clean) cleanSets++;
    console.log(`set ${set}: ${disp.join(' / ')} | caps=${capViol} unsup=${unsup} ` +
      `| shapeDistinct=${shape.distinct} copyOverlap=${cd.overlap.toFixed(2)} | clean=${clean}`);
    for (const h of heads) console.log('     ', JSON.stringify(h));
  }
  console.log(`\nCLEAN SETS ${cleanSets}/${RUNS}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
