/**
 * @file secondProductControl.ts
 * @description §25 — a real second product must not inherit AllignX anything.
 *   Uses only products that already exist. Seeds nothing.
 */
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { buildProductContentContext } from '../src/services/content/productContentContext';
import { buildProductCapabilityContract } from '../src/services/content/productCapabilityContract';
import { activePatterns } from '../src/services/creativeIntelligence/creativeIntelligenceService';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';

const db = getSupabaseAdmin();
const ALLIGNX_MARKERS = ['allignx', 'allignx.com', 'home service professionals',
  'vetted home service', 'neighborhood — quickly'];

async function main() {
  const { data: prods } = await db.from('products')
    .select('id,name,workspace_id,founder_id,archived_at').is('archived_at', null);
  const all = (prods ?? []) as any[];
  const ax = all.find(p => /allign/i.test(p.name));
  const others = all.filter(p => p.id !== ax?.id);
  console.log('products available:', all.map(p => p.name).join(' | '));
  if (others.length === 0) { console.log('NEGATIVE_CONTROL_BLOCKED: no second product'); return; }

  const axCtx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'x', persist: false }));
  const axContract = buildProductCapabilityContract(axCtx);
  const axAssets = new Set(axCtx.authorizedAssets.map((a: any) => String(a.id)));
  const axDest = String(axCtx.brand.fields.cta_destination?.value ?? '');

  for (const p of others) {
    const ctx = await buildProductContentContext(await buildContextPackageV2({
      workspaceId: p.workspace_id, founderId: p.founder_id, productId: p.id,
      intent: 'CONTENT_GENERATION', query: 'x', persist: false }));
    const contract = buildProductCapabilityContract(ctx);
    const blob = JSON.stringify({ ctx: ctx.application, brand: ctx.brand, contract }).toLowerCase();
    const leaked = ALLIGNX_MARKERS.filter(m => blob.includes(m));
    const assetOverlap = ctx.authorizedAssets
      .map((a: any) => String(a.id)).filter((id: string) => axAssets.has(id));
    const destLeak = axDest && blob.includes(axDest.toLowerCase());
    const pats = await activePatterns(p.workspace_id, null);

    console.log(`\n--- ${p.name} (ws ${String(p.workspace_id).slice(0, 8)}) ---`);
    console.log(' description        :', JSON.stringify(String(ctx.application.description ?? '').slice(0, 70)));
    console.log(' capability verbs   :', contract.capabilities.map(c => c.verb).join(',') || '(none — nothing may be claimed)');
    console.log(' AllignX text leak  :', leaked.length ? 'LEAK ' + leaked.join(',') : 'none');
    console.log(' AllignX asset leak :', assetOverlap.length ? 'LEAK' : 'none');
    console.log(' AllignX dest leak  :', destLeak ? 'LEAK' : 'none');
    console.log(' creative patterns  :', pats.length,
      p.workspace_id === ax.workspace_id ? '(SAME workspace — sharing is correct)' : '(other workspace)');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
