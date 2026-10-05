/**
 * @file creativeLayouts.test.ts
 * @description Layout strategies and readiness semantics — B6.5 §8, §21, §22, §29.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { recognitionIntent } from '../src/services/creative/scenePlan';
import {
  composeProductCreative, backgroundPrompt, COMPOSITION_LAYOUTS,
  type CompositionLayout,
} from '../src/services/creative/productComposition';
import {
  planContentPackage, refreshPackageReadiness, ownerActionFor,
} from '../src/services/content/contentPackagePolicy';

async function solid(w: number, h: number, rgb: [number, number, number]) {
  return sharp({ create: { width: w, height: h, channels: 4,
    background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer();
}
/**
 * The whole image as raw RGB, read ONCE.
 *
 * The first version of these tests called sharp().extract() per pixel. Correct,
 * and slow enough to blow the suite timeout on a 512x512 scan — which reads as
 * a failing invariant when it is really a failing harness.
 */
async function raster(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  return {
    w: info.width, h: info.height,
    at(x: number, y: number): [number, number, number] {
      const i = (y * info.width + x) * ch;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}
const isRed = (c: [number, number, number]) => c[0] > 200 && c[1] < 60 && c[2] < 60;
const isBlue = (c: [number, number, number]) => c[2] > 200 && c[0] < 60 && c[1] < 60;

const LINE = { role: 'HEADLINE' as const, text: 'Home service, without the calling around',
               sourceContentVersion: 3 };

describe('§22 three layouts are three geometries, not three captions', () => {
  it('every layout produces a different placement of the same inputs', async () => {
    const shot = await solid(300, 650, [255, 0, 0]);
    const sigs: string[] = [];
    for (const layout of COMPOSITION_LAYOUTS) {
      const r = await composeProductCreative({
        backgroundBytes: null, screenshotBytes: shot, logoBytes: null,
        overlay: [LINE], widthPx: 512, heightPx: 512, accentColor: null, layout,
      });
      expect(r.manifest.layout).toBe(layout);
      const img = await raster(r.bytes);
      // A coarse signature of WHERE the screenshot landed.
      const cols: string[] = [];
      for (let x = 4; x < img.w; x += 8) {
        let hit = false;
        for (let y = 4; y < img.h; y += 8) if (isRed(img.at(x, y))) { hit = true; break; }
        cols.push(hit ? '1' : '0');
      }
      sigs.push(cols.join(''));
    }
    // M14 — three "concepts" that are wording variants of one layout.
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('the background prompt differs per layout and never asks for words', () => {
    const prompts = COMPOSITION_LAYOUTS.filter(l => l !== 'PROBLEM_FRAME').map(l => backgroundPrompt('calm', [], l));
    expect(new Set(prompts).size).toBe(prompts.length);
    for (const p of prompts) {
      // M13 — the model rendering marketing text.
      expect(p).toMatch(/no text/i);
      expect(p).toMatch(/no letters/i);
      expect(p).toMatch(/background/i);
      expect(p).not.toMatch(/headline|caption|slogan|tagline|call to action/i);
    }
  });
});

describe('visual provider budget', () => {
  it('permits at most an initial source and one source-level repair per render job', async () => {
    const { CREATIVE_LIMITS } = await import('../src/services/creative/creativeRenderService');
    expect(CREATIVE_LIMITS.MAX_ATTEMPTS_PER_JOB).toBe(2);
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('../src/services/creative/creativeRenderService.ts', import.meta.url), 'utf8');
    expect(src).toContain('const rawSourceDefect');
    expect(src).toContain('if (!intent && !rawSourceDefect) break;');
  });
});

describe('§9/§21 the owner’s own pixels are never altered or overprinted', () => {
  it('keeps the screenshot’s colour exactly', async () => {
    const shot = await solid(300, 650, [11, 143, 105]);
    const r = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: shot, logoBytes: null,
      overlay: [], widthPx: 512, heightPx: 512, accentColor: null, layout: 'PRODUCT_HERO',
    });
    const img = await raster(r.bytes);
    let found = false;
    for (let x = 0; x < img.w && !found; x += 2) {
      for (let y = 0; y < img.h; y += 2) {
        const [a, b, c] = img.at(x, y);
        if (a === 11 && b === 143 && c === 105) { found = true; break; }
      }
    }
    expect(found, 'the screenshot’s own pixels did not survive composition').toBe(true);
  });

  it('never places the logo on top of the screenshot, in any layout', async () => {
    const shot = await solid(300, 650, [255, 0, 0]);
    const logo = await solid(200, 200, [0, 0, 255]);
    for (const layout of COMPOSITION_LAYOUTS) {
      // MEASURE THE SHOT WITHOUT THE LOGO FIRST.
      //
      // The obvious version — render once, find the red bounding box, assert no
      // blue inside it — CANNOT DETECT THE BUG IT EXISTS FOR. The logo is
      // composited on top, so wherever it overlaps, the pixels are blue and no
      // red is visible; the bounding box shrinks to exclude exactly the region
      // under test and the assertion passes over the collision. Confirmed by
      // mutation: restoring the colliding geometry left that version green.
      const bare = await composeProductCreative({
        backgroundBytes: null, screenshotBytes: shot, logoBytes: null,
        overlay: [LINE], widthPx: 512, heightPx: 512, accentColor: null, layout,
      });
      const b0 = await raster(bare.bytes);
      let l = b0.w, r = -1, t = b0.h, b = -1;
      for (let x = 0; x < b0.w; x++) for (let y = 0; y < b0.h; y++) {
        if (isRed(b0.at(x, y))) {
          if (x < l) l = x; if (x > r) r = x;
          if (y < t) t = y; if (y > b) b = y;
        }
      }
      expect(r, `no screenshot found in ${layout}`).toBeGreaterThan(0);

      const withLogo = await composeProductCreative({
        backgroundBytes: null, screenshotBytes: shot, logoBytes: logo,
        overlay: [LINE], widthPx: 512, heightPx: 512, accentColor: null, layout,
      });
      const b1 = await raster(withLogo.bytes);
      let overlaps = 0;
      for (let x = l; x <= r; x++) for (let y = t; y <= b; y++) {
        if (isBlue(b1.at(x, y))) overlaps++;
      }
      expect(overlaps, `logo overlaps the screenshot in ${layout}`).toBe(0);
    }
  });
});

describe('§9 governed words only', () => {
  // M9b — a line with no version behind it.
  it('records the content version behind every drawn line', async () => {
    const r = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: [LINE], widthPx: 512, heightPx: 512, accentColor: null,
    });
    expect(r.manifest.overlayLines).toHaveLength(1);
    expect(r.manifest.overlayLines[0].sourceContentVersion).toBe(3);
  });

  it('draws nothing when nothing is eligible', async () => {
    const r = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: [], widthPx: 512, heightPx: 512, accentColor: null,
    });
    expect(r.manifest.overlayLines).toHaveLength(0);
  });

  it('omits a line that does not fit rather than cropping it', async () => {
    const r = await composeProductCreative({
      backgroundBytes: null, screenshotBytes: null, logoBytes: null,
      overlay: [{ role: 'HEADLINE', text: 'x '.repeat(400).trim(), sourceContentVersion: 1 }],
      widthPx: 512, heightPx: 512, accentColor: null,
    });
    expect(r.manifest.overlayLines).toHaveLength(0);
    expect(r.manifest.omitted.join(' ')).toMatch(/too long/i);
  });

  it('the compositor cannot reach a model or a network', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL('../src/services/creative/productComposition.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/aiPlatform|aiClient|callSonnet|callHaiku|replicate/i);
  });
});

// ── §8 — SHORT VIDEO DOES NOT MEAN A TALKING HEAD ───────────────────────────
describe('§8 video readiness follows the video mode', () => {
  const base = {
    campaignId: null, authorizedAssetCount: 2, hasEvidence: true,
    ownerConfirmationRequired: [] as string[], avatarVoiceChosen: false,
    opportunityType: 'PRODUCT_BENEFIT',
  };

  // M9 — short video always requiring an avatar.
  it('PRODUCT_MOTION needs no presenter', () => {
    const p = planContentPackage({ ...base, channels: ['SHORT_FORM_VIDEO_SCRIPT'],
      videoMode: 'PRODUCT_MOTION' });
    expect(p.items[0].state).toBe('READY_TO_GENERATE');
    expect(ownerActionFor(p.items[0])).toBeNull();
  });

  it('defaults to PRODUCT_MOTION when no mode is given', () => {
    const p = planContentPackage({ ...base, channels: ['SHORT_FORM_VIDEO_SCRIPT'] });
    expect(p.items[0].state).toBe('READY_TO_GENERATE');
  });

  it('AVATAR_SPOKESPERSON does need a presenter', () => {
    const p = planContentPackage({ ...base, channels: ['SHORT_FORM_VIDEO_SCRIPT'],
      videoMode: 'AVATAR_SPOKESPERSON' });
    expect(p.items[0].state).toBe('BLOCKED_ON_OWNER_CONFIRMATION');
    expect(ownerActionFor(p.items[0])?.target).toBe('VIDEO_APPROACH');
  });

  it('VOICEOVER_CREATIVE needs a voice and no face', () => {
    const p = planContentPackage({ ...base, channels: ['SHORT_FORM_VIDEO_SCRIPT'],
      videoMode: 'VOICEOVER_CREATIVE' });
    expect(p.items[0].blockedReason).toMatch(/voice/i);
    expect(p.items[0].blockedReason).not.toMatch(/presenter/i);
  });
});

// ── §7 / stale snapshot ─────────────────────────────────────────────────────
describe('readiness is recomputed, the plan is not', () => {
  const stale = planContentPackage({
    campaignId: null, channels: ['META_AD'], authorizedAssetCount: 0, hasEvidence: false,
    ownerConfirmationRequired: ['ctaDestination'], avatarVoiceChosen: false,
    opportunityType: 'PRODUCT_BENEFIT',
  }).items;

  it('a resolved blocker clears without rewriting history', () => {
    expect(stale[0].state).not.toBe('READY_TO_GENERATE');
    const fresh = refreshPackageReadiness(stale, {
      authorizedAssetCount: 4, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: false, opportunityType: 'PRODUCT_BENEFIT',
    });
    expect(fresh[0].state).toBe('READY_TO_GENERATE');
    // The PLAN is historical and must be inherited unchanged.
    expect(fresh[0].channel).toBe(stale[0].channel);
    expect(fresh[0].quantity).toBe(stale[0].quantity);
    expect(fresh[0].variants).toEqual(stale[0].variants);
    expect(fresh[0].reason).toBe(stale[0].reason);
  });

  it('cannot mark ready what a fresh plan would block', () => {
    const fresh = refreshPackageReadiness(stale, {
      authorizedAssetCount: 0, hasEvidence: false,
      ownerConfirmationRequired: ['ctaDestination'],
      avatarVoiceChosen: false, opportunityType: 'PRODUCT_BENEFIT',
    });
    expect(fresh[0].state).not.toBe('READY_TO_GENERATE');
  });

  // M8 — destination becoming multi-select is a UI concern; here we assert the
  // readiness language stays singular and actionable.
  it('every blocked item names an action, never a bare "needs you"', () => {
    for (const item of stale) {
      const a = ownerActionFor(item);
      expect(a).not.toBeNull();
      expect(a!.detail.toLowerCase()).not.toBe('needs you');
      expect(a!.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('UX2.9 problem recognition composition', () => {
  it('keeps the governed recognition headline off the authentic screenshot', async () => {
    const shot=await solid(300,650,[255,0,0]);
    const common={backgroundBytes:null,screenshotBytes:shot,logoBytes:null,
      widthPx:1024,heightPx:1024,accentColor:null,layout:'PROBLEM_FRAME' as const};
    const bare=await composeProductCreative({...common,overlay:[{...LINE,text:''}]});
    const text=await composeProductCreative({...common,overlay:[{...LINE,text:"Home projects shouldn't start on hold."}]});
    const a=await raster(bare.bytes),b=await raster(text.bytes);
    let changed=0;
    for(let x=0;x<a.w;x++)for(let y=0;y<a.h;y++){
      if(isRed(a.at(x,y))&&!isRed(b.at(x,y)))changed++;
    }
    expect(changed,'governed text must not overprint the owner screenshot').toBe(0);
  });
});


it('protects recognition copy from a busy generated background without masking the image region', async () => {
  const result = await composeProductCreative({
    backgroundBytes: await solid(512, 512, [0, 0, 0]), screenshotBytes: null, logoBytes: null,
    overlay: [{role: 'HEADLINE', text: "Home projects shouldn't start on hold.", sourceContentVersion: 5},
      {role: 'SUPPORTING_COPY', text: 'Connect with vetted pros.', sourceContentVersion: 5},
      {role: 'CTA', text: 'See AllignX', sourceContentVersion: 5}],
    widthPx: 512, heightPx: 512, accentColor: null, layout: 'PROBLEM_FRAME',
    intent: recognitionIntent('PROBLEM_VISUAL_MESSAGE'),
  });
  const pixels = await raster(result.bytes);
  expect(pixels.at(480, 90).every(channel => channel > 230)).toBe(true);
  expect(pixels.at(480, 380).every(channel => channel < 10)).toBe(true);
  expect(result.manifest.overlayLines).toHaveLength(3);
  expect(result.manifest.omitted).toEqual([]);
});

it('refuses unplanned recognition imagery instead of supplying a universal metaphor', () => {
  expect(() => backgroundPrompt(null, [], 'PROBLEM_FRAME', 'Connect with home service professionals')).toThrow('visual thesis');
  expect(() => backgroundPrompt(null, [], 'PROBLEM_FRAME', 'Analytics for agencies')).toThrow('visual thesis');
});

it('renders a large authentic crop with bleed while keeping evidence containment available', async () => {
  const source=await solid(800,1400,[255,0,0]);
  const common={backgroundBytes:null,screenshotBytes:source,logoBytes:null,widthPx:1024,heightPx:1024,
    accentColor:null,overlay:[{...LINE,text:'Still calling around?'}]};
  const hero=await composeProductCreative({...common,intent:{...recognitionIntent('HOOK_PRODUCT_FRAGMENT'),
    sourceRegion:{x:0.1,y:0.1,width:0.8,height:0.8}}});
  const p=hero.manifest.geometry!.product!;
  expect(p.width).toBeGreaterThan(500);
  expect(p.x+p.width).toBeGreaterThan(1024);
  expect(p.y+p.height).toBeGreaterThan(1024);
  expect(p.sourceRegion).toEqual({left:80,top:140,width:640,height:1120});
  const pixels=await raster(hero.bytes);
  expect(pixels.at(900,800)).toEqual([255,0,0]);
  const contained=await composeProductCreative({...common,intent:{...recognitionIntent('HOOK_PRODUCT_FRAGMENT'),
    assetRole:'EVIDENCE',crop:'CONTAIN',anchor:'RIGHT'}});
  const box=contained.manifest.geometry!.product!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(1024);
  expect(box.y+box.height).toBeLessThanOrEqual(1024);
});

it('measures a dominant hook, keeps support readable and connects CTA to the message', async () => {
  const result=await composeProductCreative({backgroundBytes:null,screenshotBytes:null,logoBytes:null,
    widthPx:1024,heightPx:1024,accentColor:'#4531cc',intent:recognitionIntent('PROBLEM_VISUAL_MESSAGE'),
    overlay:[{role:'HEADLINE',text:"Home projects shouldn't start on hold.",sourceContentVersion:5},
      {role:'SUPPORTING_COPY',text:'Connect with vetted pros.',sourceContentVersion:5},
      {role:'CTA',text:'See AllignX',sourceContentVersion:5}]});
  const g=result.manifest.geometry!;
  expect(g.hook.fontSize).toBeGreaterThan(90);
  expect(g.hook.lines.join(' ')).toBe("Home projects shouldn't start on hold.");
  expect(g.hook.lines.some(line=>/\b(on|the|a|with|shouldn't)$/.test(line))).toBe(false);
  expect(g.support!.fontSize * 360/1024).toBeGreaterThanOrEqual(15);
  expect(g.cta!.y-(g.support!.y+g.support!.height)).toBeLessThan(35);
  expect(g.cta!.y).toBeLessThan(750);
  expect(result.manifest.overlayLines).toHaveLength(3);
});
