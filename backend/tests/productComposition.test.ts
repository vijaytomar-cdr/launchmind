/**
 * @file productComposition.test.ts
 * @description Proof that the P0 is closed — §8 fidelity, §9 pixel text.
 *
 *   The defect: an authorised screenshot was handed to Flux as an image_prompt,
 *   and the model drew "Home Care at Your Fingertips" — a tagline the owner
 *   never confirmed — into the output while LaunchMind supplied zero overlay
 *   text. These tests exist so that cannot come back.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import {
  composeProductCreative, backgroundPrompt, BACKGROUND_NEGATIVE, type OverlayLine,
  evaluateProductHeroContract, PRODUCT_HERO_VISUAL_CONTRACT,
} from '../src/services/creative/productComposition';

const SRC = resolve(__dirname, '..', 'src');
const code = (p: string) => readFileSync(resolve(SRC, p), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

/** A screenshot with a recognisable marker so fidelity is checkable. */
async function fakeScreenshot(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 650, channels: 3,
    background: { r: 12, g: 200, b: 90 } } }).png().toBuffer();
}
async function fakeLogo(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 200, channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
}

const LINES: OverlayLine[] = [
  { role: 'HEADLINE', text: 'Home service, without the runaround', sourceContentVersion: 3 },
  { role: 'CTA', text: 'See how it works', sourceContentVersion: 3 },
];

// ── §8 screenshot fidelity ────────────────────────────────────────────────
describe('§8 the screenshot is never reinterpreted', () => {
  it('the compositor receives BYTES, never a provider URL', () => {
    const src = code('services/creative/productComposition.ts');
    // No network, no provider, no prompt anywhere in the compositor.
    for (const t of ['fetch(', 'replicate', 'generateImage', 'image_prompt', 'apiKey']) {
      expect(src.toLowerCase(), `compositor reaches ${t}`).not.toContain(t.toLowerCase());
    }
  });

  it('composition mode sends NO reference image to the provider', () => {
    const src = code('services/creative/creativeRenderService.ts');
    const fn = src.slice(src.indexOf('async function renderComposedProduct'),
                         src.indexOf('export async function renderGovernedVisual'));
    // The one provider call in this path passes an empty reference list.
    expect(fn).toContain('referenceImageUrls: []');
    expect(fn).toContain('backgroundPrompt(');
    expect(fn).toContain('BACKGROUND_NEGATIVE');
  });

  it('the screenshot is placed, scaled and rounded — never regenerated', () => {
    const src = code('services/creative/productComposition.ts');
    // ANCHORED ON CODE, because `code()` strips comments before this runs —
    // so a comment anchor can never match, and the first repair attempt here
    // failed for that reason rather than for the reason it was written.
    //
    // The ORIGINAL anchor was the literal `if (input.screenshotBytes)`, which
    // stopped existing the moment that condition gained a second clause:
    // `indexOf` returned -1, the slice produced an empty string, and the
    // assertion failed loudly. It could equally have produced a slice that
    // passed vacuously, which is the dangerous version of the same mistake.
    // Both bounds are now declarations that have to exist for the feature to
    // work at all.
    const start = src.indexOf('let screenshotComposited = false;');
    const end = src.indexOf('screenshotComposited = true;');
    expect(start, 'screenshot section not found').toBeGreaterThan(-1);
    expect(end, 'screenshot section end not found').toBeGreaterThan(start);
    const block = src.slice(start, end);
    // fit:'inside' cannot crop or distort, so interior pixels are the owner's.
    expect(block).toContain("fit: 'inside'");
    expect(block).not.toMatch(/blur|modulate|tint|recomb|normalise|sharpen/);
  });

  it('the composed image actually contains the screenshot pixels', async () => {
    const shot = await fakeScreenshot();
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: shot, logoBytes: null,
      overlay: [], widthPx: 1024, heightPx: 1024, accentColor: null,
    });
    expect(out.manifest.screenshotComposited).toBe(true);
    // The screenshot's distinctive colour must be present in the output.
    const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    let found = false;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] < 60 && data[i + 1] > 150 && data[i + 2] > 50 && data[i + 2] < 140) { found = true; break; }
    }
    expect(found, 'the owner screenshot is absent from the composition').toBe(true);
  });

  it('the logo is composited, not recreated', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: await fakeLogo(),
      overlay: [], widthPx: 512, heightPx: 512, accentColor: null,
    });
    expect(out.manifest.logoComposited).toBe(true);
    const src = code('services/creative/productComposition.ts');
    const block = src.slice(src.indexOf('if (input.logoBytes)'), src.indexOf('logoComposited = true;'));
    expect(block).toContain("fit: 'inside'");
  });

  it('the background prompt forbids every product-shaped element', () => {
    const p = backgroundPrompt('bright and calm', ['#0b8f69'], 'PRODUCT_HERO');
    // It must ask for a BACKGROUND. A prompt that asks for a marketing layout,
    // a headline or a call to action invites the model to write words again.
    expect(p.toLowerCase()).toMatch(/background (texture|only)/);
    for (const t of ['headline', 'call to action', 'marketing layout with']) {
      expect(p.toLowerCase(), `background prompt asks for "${t}"`).not.toContain(t);
    }
    for (const t of ['no text', 'no letters', 'no logos', 'no user interface',
                     'no mobile phone', 'no screen', 'no digital device', 'no people']) {
      expect(p.toLowerCase(), `background prompt omits "${t}"`).toContain(t);
    }
    for (const t of ['no text', 'no app screen', 'no mockup', 'no product', 'no badges']) {
      expect(BACKGROUND_NEGATIVE).toContain(t);
    }
  });
});

// ── §9 pixel text governance ──────────────────────────────────────────────
describe('§9 every marketing word is governed', () => {
  it('draws exactly the governed lines, verbatim', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: LINES, widthPx: 1024, heightPx: 1024, accentColor: '#0b8f69',
    });
    expect(out.manifest.overlayLines.map(l => l.text))
      .toEqual(['Home service, without the runaround', 'See how it works']);
    for (const l of out.manifest.overlayLines) {
      expect(l.sourceContentVersion, 'a line was drawn with no content version').toBe(3);
    }
  });

  it('a line with no content version behind it cannot be recorded as governed', async () => {
    // A manifest entry defaulting to 0 would claim a line was governed by a
    // version that does not exist. The type requires it and the manifest must
    // carry the real value through, never a fallback.
    const src = code('services/creative/productComposition.ts');
    expect(src).not.toMatch(/sourceContentVersion:\s*l\.sourceContentVersion\s*\?\?/);
    expect(src).toContain('sourceContentVersion: number;');
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: [{ role: 'HEADLINE', text: 'Short line', sourceContentVersion: 7 }],
      widthPx: 1024, heightPx: 1024, accentColor: null,
    });
    expect(out.manifest.overlayLines[0].sourceContentVersion).toBe(7);
  });

  it('an empty overlay draws no words at all', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: await fakeScreenshot(), logoBytes: null,
      overlay: [], widthPx: 512, heightPx: 512, accentColor: null,
    });
    expect(out.manifest.overlayLines).toEqual([]);
  });

  it('a headline that does not fit is OMITTED, never cropped into a new claim', async () => {
    const long = 'We help homeowners everywhere coordinate every single service visit '
      + 'across every trade without exception in any city at any time of year whatsoever';
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: [{ role: 'HEADLINE', text: long, sourceContentVersion: 1 }],
      widthPx: 400, heightPx: 400, accentColor: null,
    });
    expect(out.manifest.overlayLines).toEqual([]);
    expect(out.manifest.omitted.join(' ')).toMatch(/too long/i);
  });

  it('the compositor cannot author or alter a word', () => {
    const src = code('services/creative/productComposition.ts');
    for (const t of ['callHaiku', 'callSonnet', 'generateAI', 'aiPlatform']) {
      expect(src).not.toContain(t);
    }
    // Wrapping is whole-word; there is no truncation of a line into a fragment.
    expect(src).not.toMatch(/\.slice\(0,\s*\w+\)\s*\+\s*['"`]…/);
  });

  it('ineligible copy reaches the compositor as absent, not as empty text', () => {
    const src = code('services/creative/creativeRenderService.ts');
    const fn = src.slice(src.indexOf('async function renderComposedProduct'));
    // Lines are pushed only when present; nothing is defaulted to a placeholder.
    expect(fn).toContain('if (input.governedHeadline)');
    expect(fn).toContain('if (input.governedCta)');
    expect(fn).toMatch(/left the wording off the image/);
  });

  it('PRODUCT_UI_TEXT and MARKETING_OVERLAY_TEXT are distinguished in the contract', () => {
    const src = readFileSync(resolve(SRC, 'services/creative/productComposition.ts'), 'utf-8');
    expect(src).toContain('PRODUCT_UI_TEXT');
    expect(src).toContain('MARKETING_OVERLAY_TEXT');
  });
});

// ── the manifest is the audit trail ───────────────────────────────────────
describe('composition manifest', () => {
  it('records exactly what was drawn', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: await fakeScreenshot(),
      logoBytes: await fakeLogo(), overlay: LINES,
      widthPx: 1024, heightPx: 1024, accentColor: '#0b8f69',
    });
    expect(out.manifest.backgroundSource).toBe('BRAND_SOLID');
    expect(out.manifest.screenshotComposited).toBe(true);
    expect(out.manifest.logoComposited).toBe(true);
    expect(out.manifest.overlayLines).toHaveLength(2);
    expect(out.widthPx).toBe(1024);
  });

  it('a generated background is recorded as generated', async () => {
    const bg = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const out = await composeProductCreative({
      backgroundBytes: bg, screenshotBytes: null, logoBytes: null,
      overlay: [], widthPx: 256, heightPx: 256, accentColor: null,
    });
    expect(out.manifest.backgroundSource).toBe('GENERATED');
  });
});

describe('product-hero requirements', () => {
  it('prioritizes the required CTA over optional supporting copy', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: await fakeScreenshot(), logoBytes: await fakeLogo(),
      overlay: [
        { role: 'HEADLINE', text: 'Start Your Plumbing Request in AllignX', sourceContentVersion: 1 },
        { role: 'SUPPORTING_COPY', text: 'Connect with vetted local pros', sourceContentVersion: 1 },
        { role: 'CTA', text: 'Learn More', sourceContentVersion: 1 },
      ], widthPx: 1024, heightPx: 1024, accentColor: '#2127b3', layout: 'PRODUCT_HERO',
    });
    expect(out.manifest.overlayLines.map(line => line.role)).toEqual(['HEADLINE', 'CTA']);
    expect(out.manifest.omitted.join(' ')).toMatch(/Supporting copy was omitted/i);
  });

  it('uses one required/optional Product Hero contract for composition and local QA', async () => {
    expect(PRODUCT_HERO_VISUAL_CONTRACT.required).toContain('CTA');
    expect(PRODUCT_HERO_VISUAL_CONTRACT.optional).toContain('SUPPORTING_COPY');
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: await fakeScreenshot(), logoBytes: await fakeLogo(),
      overlay: [
        { role: 'HEADLINE', text: 'Start Your Plumbing Request in AllignX', sourceContentVersion: 1 },
        { role: 'CTA', text: 'Learn More', sourceContentVersion: 1 },
      ], widthPx: 1024, heightPx: 1024, accentColor: '#2127b3', layout: 'PRODUCT_HERO',
    });
    const qa = evaluateProductHeroContract({ widthPx: 1024, heightPx: 1024,
      screenshotComposited: out.manifest.screenshotComposited,
      logoComposited: out.manifest.logoComposited, overlayLines: out.manifest.overlayLines,
      geometry: out.manifest.geometry });
    expect(qa.hardPass).toBe(true);
    expect(qa.advisory.join(' ')).toMatch(/optional/i);
  });

  it('fails hard when a required Product Hero CTA or headline is missing', async () => {
    const out = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: await fakeScreenshot(), logoBytes: await fakeLogo(),
      overlay: [{ role: 'HEADLINE', text: 'Start Your Plumbing Request in AllignX', sourceContentVersion: 1 }],
      widthPx: 1024, heightPx: 1024, accentColor: '#2127b3', layout: 'PRODUCT_HERO',
    });
    const qa = evaluateProductHeroContract({ widthPx: 1024, heightPx: 1024,
      screenshotComposited: out.manifest.screenshotComposited,
      logoComposited: out.manifest.logoComposited, overlayLines: out.manifest.overlayLines,
      geometry: out.manifest.geometry });
    expect(qa.hardPass).toBe(false);
    expect(qa.failures.join(' ')).toMatch(/CTA/);
  });
});

it('separates authorized promotional artwork from hero-suitable source pixels', async () => {
  const {compositionAssetSuitability}=await import('../src/services/creative/productComposition');
  expect(compositionAssetSuitability({width:300,height:649,source:'APP_STORE',assetType:'SCREENSHOT'}).role).toBe('OMIT');
  expect(compositionAssetSuitability({width:1200,height:1800,source:'APP_STORE',assetType:'SCREENSHOT'}).role).toBe('EVIDENCE');
  expect(compositionAssetSuitability({width:800,height:1400,source:'OWNER_UPLOAD',assetType:'SCREENSHOT'}).role).toBe('HERO');
  expect(compositionAssetSuitability({width:592,height:665,source:'OWNER_URL',assetType:'SCREENSHOT'}).role).toBe('HERO');
});

it('does not allow promotional App Store panels to stand in for a product-demo hero', () => {
  const src = code('services/creative/creativeRenderService.ts');
  expect(src).toContain("product demonstration must not promote an evidence-only screenshot as a hero");
  expect(src).toContain("productDemonstration && !hero");
});
