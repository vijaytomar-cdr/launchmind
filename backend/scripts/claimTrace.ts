/**
 * @file claimTrace.ts
 * @description §1 — how the pipeline classifies eight named examples TODAY.
 *
 *   Runs the REAL union (generator ∪ deterministic ∪ semantic) and the REAL
 *   grounding against the REAL AllignX evidence. Nothing is stubbed except the
 *   generator declaration, which is empty — a declaration can only ADD, so an
 *   empty one measures the independent arms, which is what matters here.
 */
import { discoverClaims, groundDiscoveredClaims } from '../src/services/content/threeSignalClaimDiscovery';
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';

const EXAMPLES: Array<[string, string]> = [
  ['A', 'Still calling around trying to find someone for your home project?'],
  ['B', 'Calling multiple contractors can be frustrating.'],
  ['C', 'Homeowners often wait three days for contractors to call back.'],
  ['D', 'AllignX connects you with trusted, vetted home-service professionals.'],
  ['E', 'AllignX cuts contractor search time by 70%.'],
  ['F', 'Thousands of homeowners trust AllignX.'],
  ['G', 'Imagine getting your home-service search started without making another round of calls.'],
  ['H', 'One request instead of five phone calls.'],
];

async function main() {
  const db = getSupabaseAdmin();
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'trace', persist: false }));

  for (const [label, text] of EXAMPLES) {
    const fields = [{ id: 'primary_text', label: 'primary text', text }];
    const disc = await discoverClaims(fields as never, { declaredClaims: [] },
      { channel: 'meta_ads', competitorNames: ctx.founderDirection.competitors,
        founderId: ax.founder_id, productId: ax.id } as never);
    const gr = groundDiscoveredClaims(disc, ctx.evidence, []);
    const cats = disc.claims.map(c => `${c.category}(${c.sources.join('+')})`).join(', ') || '(none)';
    const verdicts = gr.results.map(r => r.verdict).join(',') || '(none)';
    console.log(`${label}  ${verdicts.padEnd(28)} ${cats}`);
    console.log(`    "${text}"`);
    for (const r of gr.results) {
      if (r.verdict !== 'SUPPORTED') console.log(`      -> ${r.failure ?? ''} :: ${r.reason}`);
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
