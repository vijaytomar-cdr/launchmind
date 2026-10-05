/**
 * @file assetQualityAdvisory.test.ts
 * @description §14/§15 — advisory, never a gate; source defect vs render defect.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { assessAssetQuality, attributeDefect } from '../src/services/brand/assetQualityAdvisory';
import { composeProductCreative } from '../src/services/creative/productComposition';

/** A clean asset: content well inside a white frame. */
async function clean(w = 600, h = 900) {
  return sharp({ create: { width: w, height: h, channels: 3,
    background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: Buffer.from(
      `<svg width="${w}" height="${h}"><rect x="80" y="120" width="${w - 160}" ` +
      `height="${h - 240}" fill="#101010"/></svg>`), top: 0, left: 0 }])
    .png().toBuffer();
}

/**
 * A cropped asset, modelled on the real defect.
 *
 * A LINE OF TEXT severed at the right edge — a short horizontal bar reaching
 * the boundary. The first version of this fixture drew a 700px-tall block to
 * the edge, which is a deliberate full bleed rather than a cut, and the
 * detector correctly declined to flag it. Modelling the wrong shape would have
 * meant tuning the detector until it agreed with a fixture that did not
 * resemble the owner's asset.
 */
async function clippedRight(w = 600, h = 900) {
  return sharp({ create: { width: w, height: h, channels: 3,
    background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: Buffer.from(
      `<svg width="${w}" height="${h}"><rect x="${w - 220}" y="400" width="220" ` +
      `height="26" fill="#101010"/></svg>`), top: 0, left: 0 }])
    .png().toBuffer();
}

/** A deliberate full bleed. Must NOT be reported as a crop. */
async function fullBleedRight(w = 600, h = 900) {
  return sharp({ create: { width: w, height: h, channels: 3,
    background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: Buffer.from(
      `<svg width="${w}" height="${h}"><rect x="300" y="0" width="300" ` +
      `height="${h}" fill="#101010"/></svg>`), top: 0, left: 0 }])
    .png().toBuffer();
}

describe('§14 the advisory advises and never blocks', () => {
  it('says nothing about a clean asset', async () => {
    const r = await assessAssetQuality(await clean());
    expect(r.advisories.filter(a => a.kind === 'EDGE_CLIPPING')).toHaveLength(0);
  });

  it('names the edge when content runs off it', async () => {
    const r = await assessAssetQuality(await clippedRight());
    const clip = r.advisories.find(a => a.kind === 'EDGE_CLIPPING');
    expect(clip, 'clipping not detected').toBeTruthy();
    expect(clip!.where).toBe('right');
    expect(clip!.message).toMatch(/appears cropped near the right edge/i);
  });

  it('does not call a deliberate full bleed a crop', async () => {
    const r = await assessAssetQuality(await fullBleedRight());
    expect(r.advisories.filter(a => a.kind === 'EDGE_CLIPPING')).toHaveLength(0);
  });

  it('NOTHING it returns can block creation', async () => {
    const r = await assessAssetQuality(await clippedRight());
    for (const a of r.advisories) expect(a.blocking).toBe(false);
  });

  it('flags a low-resolution asset without blocking it', async () => {
    const r = await assessAssetQuality(await clean(200, 300));
    expect(r.advisories.some(a => a.kind === 'LOW_RESOLUTION')).toBe(true);
    expect(r.advisories.every(a => a.blocking === false)).toBe(true);
  });

  it('the module cannot alter an asset', async () => {
    const { readFileSync } = await import('fs');
    // COMMENTS STRIPPED FIRST. The file's own header explains that it never
    // inpaints or repairs anything, so a raw scan matches the prose describing
    // the guarantee rather than a violation of it — the assertion fails on the
    // documentation and passes on nothing.
    const raw = readFileSync(
      new URL('../src/services/brand/assetQualityAdvisory.ts', import.meta.url), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    expect(src).not.toMatch(/\.toFile\(|storage\.from|upsert|\.insert\(/);
    expect(src).not.toMatch(/\bextend\(|\bextract\(|inpaint|repair/);
  });
});

describe('§15 a source defect is not a render defect', () => {
  it('attributes a cropped SOURCE to the source', async () => {
    const report = await assessAssetQuality(await clippedRight());
    const v = attributeDefect({ sourceReport: report, placedWithoutCropping: true });
    expect(v.origin).toBe('SOURCE_IMAGE');
    expect(v.ownerMessage).toMatch(/cropped near the right edge/i);
    expect(v.ownerMessage).not.toMatch(/LaunchMind trimmed/i);
  });

  it('attributes a compositor crop to LaunchMind', async () => {
    const report = await assessAssetQuality(await clean());
    const v = attributeDefect({ sourceReport: report, placedWithoutCropping: false });
    expect(v.origin).toBe('LAUNCHMIND_RENDER');
    expect(v.ownerMessage).toMatch(/fault in the layout/i);
  });

  it('says nothing when neither is true', async () => {
    const report = await assessAssetQuality(await clean());
    const v = attributeDefect({ sourceReport: report, placedWithoutCropping: true });
    expect(v.origin).toBe('NONE');
    expect(v.ownerMessage).toBeNull();
  });

  // The claim this pass makes about the owner's real screenshot, proven rather
  // than asserted: the compositor does not introduce a crop.
  it('the compositor does not crop a clean asset in any layout', async () => {
    const src = await clean(300, 650);
    for (const layout of ['PROBLEM_FRAME', 'PRODUCT_HERO', 'RELIEF_FRAME'] as const) {
      const out = await composeProductCreative({
        backgroundBytes: null, screenshotBytes: src, logoBytes: null, overlay: [],
        widthPx: 512, heightPx: 512, accentColor: null, layout,
      });
      const report = await assessAssetQuality(out.bytes);
      // Composed output must not gain a clipping advisory the source did not have.
      const gained = report.advisories.filter(a => a.kind === 'EDGE_CLIPPING');
      expect(gained, `${layout} introduced edge clipping`).toHaveLength(0);
    }
  });
});
