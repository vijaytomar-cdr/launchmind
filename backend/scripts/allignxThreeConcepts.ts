/**
 * @file allignxThreeConcepts.ts
 * @description §8/§21/§24 — renders the three AllignX Meta concepts.
 *
 *   Uses the owner's REAL authorised screenshot and REAL confirmed logo, three
 *   different composition layouts, three correspondingly different wordless
 *   backgrounds, and the GOVERNED copy produced by allignxThreeHypotheses.
 *
 *   THIS SCRIPT AUTHORS NOTHING. Overlay text is read from the generation
 *   result on disk and is drawn only when that concept reached ELIGIBLE. If it
 *   did not, the image carries no marketing words — the same rule as the
 *   production path. The screenshot is never sent to the image provider.
 *
 *   Writes to /tmp only. Nothing is persisted, nothing is approved.
 */
import { writeFileSync, readFileSync } from 'fs';
import { composeProductCreative, backgroundPrompt, BACKGROUND_NEGATIVE,
         type CompositionLayout, type OverlayLine } from '../src/services/creative/productComposition';
import { getCreativeProvider } from '../src/services/creative/creativeProviderRegistry';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';

const OUT = process.env.OUT_DIR ?? '/tmp';
const db = getSupabaseAdmin();

async function bytes(url: string): Promise<Buffer | null> {
  try { const r = await fetch(url); if (!r.ok) return null;
        return Buffer.from(await r.arrayBuffer()); } catch { return null; }
}

const CONCEPTS: Array<{ key: string; layout: CompositionLayout; name: string; mood: string }> = [
  { key: 'PROBLEM_RECOGNITION', layout: 'PROBLEM_FRAME', name: 'A — problem recognition',
    mood: 'restless and a little cluttered on one side, settling into calm' },
  { key: 'PRODUCT_DEMONSTRATION', layout: 'PRODUCT_HERO', name: 'B — product demonstration',
    mood: 'quiet and almost plain, so the interface is the only subject' },
  { key: 'RELIEF', layout: 'RELIEF_FRAME', name: 'C — relief',
    mood: 'open, unhurried, soft daylight' },
];

/** Governed copy, READ from the generation result. Never authored here. */
function governedOverlay(key: string): OverlayLine[] {
  try {
    const all = JSON.parse(readFileSync('/tmp/allignx-concepts.json', 'utf8'));
    const c = all.find((x: { key: string }) => x.key === key);
    if (!c || c.result.disposition !== 'ELIGIBLE') return [];
    const p = c.result.payload as Record<string, string>;
    const out: OverlayLine[] = [];
    if (p.headline) out.push({ role: 'HEADLINE', text: p.headline, sourceContentVersion: 1 });
    if (p.description) out.push({ role: 'CTA', text: p.description, sourceContentVersion: 1 });
    return out;
  } catch { return []; }
}

async function main() {
  const { data: prods } = await db.from('products').select('id,name,workspace_id,founder_id');
  const ax = (prods ?? []).find((p: { name: string }) => /allign/i.test(p.name)) as
    { id: string; workspace_id: string; founder_id: string };

  const { buildContextPackageV2 } = await import('../src/lib/context/contextPackageV2');
  const { buildProductContentContext } = await import('../src/services/content/productContentContext');
  const ctx = await buildProductContentContext(await buildContextPackageV2({
    workspaceId: ax.workspace_id, founderId: ax.founder_id, productId: ax.id,
    intent: 'CONTENT_GENERATION', query: 'meta', persist: false }));

  const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
  const authorised = await resolveMarketingAssets(ax.workspace_id, ax.id, 'VISUAL_RENDERING');
  const shot = authorised.find(a => (a.assetType ?? '').toUpperCase() === 'SCREENSHOT') ?? authorised[0];
  const BUCKET = 'content-assets';
  const shotUrl = shot?.externalUrl
    ?? (shot?.storagePath ? db.storage.from(BUCKET).getPublicUrl(shot.storagePath).data.publicUrl : null);
  const logoField = ctx.brand.fields.logo;
  const logoUrl = logoField?.ownerConfirmed ? String(logoField.value ?? '') : '';
  const screenshotBytes = shotUrl ? await bytes(shotUrl) : null;
  const logoBytes = logoUrl.startsWith('http') ? await bytes(logoUrl) : null;
  console.log('authorised:', authorised.length, '| screenshot bytes:', screenshotBytes?.length ?? 'NONE',
    '| logo bytes:', logoBytes?.length ?? 'NONE');

  const provider = getCreativeProvider('IMAGE_GENERATION');
  for (const c of CONCEPTS) {
    const overlay = governedOverlay(c.key);
    let bg: Buffer | null = null;
    try {
      const out = await provider.generateImage!({
        prompt: backgroundPrompt(c.mood, [], c.layout),
        negativePrompt: BACKGROUND_NEGATIVE, aspectRatio: '1:1',
        referenceImageUrls: [],            // the screenshot NEVER reaches the model
        qualityTier: 'DRAFT', modelRef: 'black-forest-labs/flux-1.1-pro',
      });
      bg = await bytes(out.imageUrl);
      console.log(`${c.name}: background generated in ${out.latencyMs}ms`);
    } catch (e) {
      console.log(`${c.name}: background unavailable (${(e as Error).message.slice(0, 44)}) — plain ground`);
    }
    const composed = await composeProductCreative({
      backgroundBytes: bg, screenshotBytes, logoBytes, overlay,
      widthPx: 1024, heightPx: 1024, accentColor: null, layout: c.layout,
    });
    const file = `${OUT}/allignx-${c.layout}.png`;
    writeFileSync(file, composed.bytes);
    console.log(`  overlay lines drawn: ${composed.manifest.overlayLines.length}` +
      (overlay.length && !composed.manifest.overlayLines.length ? '  (all omitted)' : ''));
    console.log(`  → ${file}  ${JSON.stringify(composed.manifest)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
