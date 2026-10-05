/** Runs the advisory over the owner's REAL authorised assets. Read-only. */
import { assessAssetQuality, attributeDefect } from '../src/services/brand/assetQualityAdvisory';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
const db = getSupabaseAdmin();
async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
  const assets = await resolveMarketingAssets(ax.workspace_id, ax.id, 'VISUAL_RENDERING');
  for (const a of assets) {
    const url = a.externalUrl
      ?? (a.storagePath ? db.storage.from('content-assets').getPublicUrl(a.storagePath).data.publicUrl : null);
    if (!url) continue;
    const r = await fetch(url); if (!r.ok) { console.log(String(a.id).slice(0,8), 'unfetchable'); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const rep = await assessAssetQuality(buf);
    const attr = attributeDefect({ sourceReport: rep, placedWithoutCropping: true });
    console.log(`${String(a.id).slice(0,8)} ${String(a.assetType ?? '?').padEnd(12)} ` +
      `${rep.measurements.widthPx}x${rep.measurements.heightPx} ` +
      `edges L${rep.measurements.edgeInkFraction.left.toFixed(2)} ` +
      `R${rep.measurements.edgeInkFraction.right.toFixed(2)} ` +
      `T${rep.measurements.edgeInkFraction.top.toFixed(2)} ` +
      `B${rep.measurements.edgeInkFraction.bottom.toFixed(2)} -> ${attr.origin}`);
    for (const ad of rep.advisories) console.log('     •', ad.message);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
