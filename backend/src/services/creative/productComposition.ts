/**
 * @file productComposition.ts
 * @description Deterministic product creative — B6B §7, §8, §9.
 *
 *   THE P0 THIS EXISTS TO FIX. The previous product-led render handed an
 *   authorised AllignX screenshot to Flux as an `image_prompt`. The model
 *   reinterpreted it and drew its own words into the output —
 *   "Home Care at Your Fingertips" — which is NOT the tagline the owner
 *   confirmed. LaunchMind supplied zero overlay text on that render, so every
 *   visible word bypassed claim detection, grounding, owner confirmation and
 *   deterministic rendering at once.
 *
 *   The assumption "the model renders the picture, LaunchMind renders the words"
 *   is FALSE the moment a text-bearing image is given to a diffusion model. A
 *   negative prompt does not survive it. So the architecture changes rather than
 *   the prompt:
 *
 *     THE MODEL MAY GENERATE   background, atmosphere, decorative framing —
 *                              and only when asked for a wordless backdrop
 *     LAUNCHMIND COMPOSITES    the authorised screenshot pixel-for-pixel,
 *                              the confirmed logo pixel-for-pixel,
 *                              and every marketing word
 *
 *   The screenshot is never sent to the provider in this mode. It cannot be
 *   redrawn, restyled or "improved", because the provider never sees it.
 *
 *   TWO KINDS OF TEXT, and the distinction is load-bearing:
 *
 *     PRODUCT_UI_TEXT        words inside the owner's own authorised screenshot.
 *                            Theirs, already true of their product, preserved.
 *     MARKETING_OVERLAY_TEXT words LaunchMind places. Must have passed the
 *                            content governance pipeline, or they are not drawn.
 *
 * @security Composition is pure image work: scale, crop, round, mask, place.
 *   It never generates, restyles or infers pixels for the screenshot or logo,
 *   and it never invents a string. A line whose copy is not eligible is omitted,
 *   not softened.
 * @dependencies sharp
 */

import sharp, { type OverlayOptions } from 'sharp';
import type { CompositionIntent, VisualThesis } from './scenePlan';

/** What a composed creative is allowed to contain. */
export type OverlayRole = 'HEADLINE' | 'SUPPORTING_COPY' | 'CTA';

/**
 * The layout strategies — B6.5 §22.
 *
 * ONE COMPOSITOR PRODUCING ONE PICTURE was the honest state after B6B: safe,
 * and mediocre. Three "concepts" that share a layout are three captions on the
 * same advert, so the strategy has to change the GEOMETRY, not just the words.
 *
 *   PROBLEM_FRAME  words dominate and come first; the product is small and to
 *                  one side, because the frustration is the subject and the
 *                  product is the answer arriving late.
 *   PRODUCT_HERO   the interface is the subject: large, centred, minimal words.
 *   RELIEF_FRAME   calm and open; the product sits low and settled with a lot
 *                  of air above it, and the words are quiet.
 *
 * These are RATIOS AND REGIONS, not pixel positions for one product. Every
 * value below is a fraction of the canvas, so the same strategy composes a
 * square Meta creative and a vertical story without a second code path.
 */
export const COMPOSITION_LAYOUTS = ['PROBLEM_FRAME', 'PRODUCT_HERO', 'RELIEF_FRAME'] as const;
export type CompositionLayout = typeof COMPOSITION_LAYOUTS[number];

/** Every region as a fraction of width/height. Nothing here is product-specific. */
interface LayoutSpec {
  /** Screenshot box, as fractions of the canvas. */
  shot: { w: number; h: number; x: number; y: number } | null;
  /** Text column left edge and width. */
  textX: number; textW: number;
  /** Where the first text baseline starts. */
  textTop: number;
  /** Type scale, as a fraction of width. */
  headline: number; support: number; cta: number;
  /** Logo corner and size. */
  logo: { size: number; x: number; y: number };
  /** How dark to veil the background behind the text column, 0 = none. */
  scrim: number;
}

/**
 * The one contract for a product-led creative.  It is deliberately expressed
 * in relationships rather than a one-off set of pixels: the compositor uses
 * it to place the elements and the local QA uses it to decide what is hard
 * required.  In particular, support copy is useful when space permits but is
 * never a prerequisite for a Product Hero.
 */
export const PRODUCT_HERO_VISUAL_CONTRACT = {
  required: ['HERO_SOURCE', 'AUTHENTIC_PRODUCT_UI', 'HEADLINE', 'BRAND_LOGO', 'CTA'] as const,
  optional: ['SUPPORTING_COPY'] as const,
  constraints: {
    // Portrait product UI remains legible by height; requiring 40% of canvas
    // width would reject a substantial authentic portrait screen.
    minProductWidth: 0.28,
    minProductHeight: 0.48,
    minHeadlineWidth: 0.28,
    maxHeadlineToCtaGap: 0.16,
    minEdgeInset: 0.035,
  },
  advisory: ['Supporting copy may be omitted when it would weaken hierarchy or CTA space.'] as const,
} as const;

const LAYOUTS: Record<CompositionLayout, LayoutSpec> = {
  // Text-forward. The product is present but deliberately secondary.
  PROBLEM_FRAME: {
    shot: { w: 0.30, h: 0.58, x: 0.78, y: 0.52 },
    textX: 0.07, textW: 0.50, textTop: 0.26,
    headline: 0.062, support: 0.027, cta: 0.025,
    logo: { size: 0.13, x: 0.07, y: 0.07 }, scrim: 0.55,
  },
  // The interface IS the advert. Words shrink to a caption beneath it.
  PRODUCT_HERO: {
    // A product hero is a conversation between the real product and the
    // message, rather than a card parked above a detached caption. The UI is
    // large on the right; a protected left message field keeps the headline
    // and CTA together without touching the owner's pixels.
    shot: { w: 0.54, h: 0.68, x: 0.72, y: 0.51 },
    textX: 0.055, textW: 0.36, textTop: 0.33,
    headline: 0.045, support: 0.022, cta: 0.027,
    logo: { size: 0.10, x: 0.055, y: 0.06 }, scrim: 0.36,
  },
  // Open, unhurried. Air above, product settled low, quiet type.
  RELIEF_FRAME: {
    shot: { w: 0.30, h: 0.44, x: 0.64, y: 0.50 },
    textX: 0.08, textW: 0.46, textTop: 0.36,
    headline: 0.050, support: 0.025, cta: 0.024,
    logo: { size: 0.12, x: 0.08, y: 0.08 }, scrim: 0.40,
  },
};

/**
 * One governed line, with the version that made it eligible.
 *
 * `sourceContentVersion` is required: a line with no version behind it is a
 * line nobody governed, and the compositor refuses to draw it.
 */
export interface OverlayLine {
  role: OverlayRole;
  text: string;
  sourceContentVersion: number;
}

export interface CompositionInput {
  intent?: CompositionIntent;
  visualThesis?: VisualThesis;
  /** Wordless background from the model, or null for a solid brand ground. */
  backgroundBytes: Buffer | null;
  /** The owner-authorised screenshot, verbatim. Never provider-generated. */
  screenshotBytes: Buffer | null;
  /** The owner-confirmed logo, verbatim. Never provider-generated. */
  logoBytes: Buffer | null;
  /** Governed marketing lines. Anything ineligible must be absent, not empty. */
  overlay: OverlayLine[];
  widthPx: number;
  heightPx: number;
  /** Owner-confirmed accent, or null for the neutral default. */
  accentColor: string | null;
  /** Which geometry to use. Defaults to the original text-forward layout. */
  layout?: CompositionLayout;
  /** Internal repair: restore a message-led hierarchy without changing any words. */
  emphasizeMessage?: boolean;
}

export interface CompositionResult {
  bytes: Buffer;
  widthPx: number;
  heightPx: number;
  /** Exactly what was drawn, for provenance and for the fidelity test. */
  manifest: {
    focalProtection?: { subject: PixelRegion; padding: number; message: PixelRegion;
      elements: Record<string, PixelRegion>; source: 'RIGHT_HUMAN_INTENT';
      readability: 'LOCAL_HORIZONTAL_FADE' };
    compositionIntent?: CompositionIntent;
    geometry?: {
      hook: { x: number; y: number; width: number; height: number; fontSize: number; lines: string[] };
      support: { y: number; fontSize: number; height: number } | null;
      cta: { x: number; y: number; width: number; height: number } | null;
      product: { x: number; y: number; width: number; height: number;
        sourceRegion: { left: number; top: number; width: number; height: number } } | null;
      productHero?: { product: PixelRegion; headline: PixelRegion | null;
        cta: PixelRegion | null; logo: PixelRegion | null; supportPresent: boolean };
    };
    layout: CompositionLayout;
    backgroundSource: 'GENERATED' | 'BRAND_SOLID';
    screenshotComposited: boolean;
    logoComposited: boolean;
    overlayLines: Array<{ role: OverlayRole; text: string; sourceContentVersion: number }>;
    omitted: string[];
  };
}

/** Local hard QA for the same Product Hero contract consumed by composition. */
export function evaluateProductHeroContract(input: {
  widthPx: number; heightPx: number; screenshotComposited: boolean; logoComposited: boolean;
  overlayLines: Array<{ role: OverlayRole }>;
  geometry?: { productHero?: { product: PixelRegion; headline: PixelRegion | null;
    cta: PixelRegion | null; logo: PixelRegion | null; supportPresent: boolean } };
}): { hardPass: boolean; failures: string[]; advisory: string[] } {
  const failures: string[] = [];
  const advisory: string[] = [];
  const roles = new Set(input.overlayLines.map(line => line.role));
  if (!input.screenshotComposited) failures.push('Authentic product UI is required.');
  if (!input.logoComposited) failures.push('Brand logo is required.');
  if (!roles.has('HEADLINE')) failures.push('Headline is required.');
  if (!roles.has('CTA')) failures.push('CTA is required.');
  const g = input.geometry?.productHero;
  if (!g) failures.push('Product Hero geometry is required.');
  else {
    if (g.product.width < input.widthPx * PRODUCT_HERO_VISUAL_CONTRACT.constraints.minProductWidth
      || g.product.height < input.heightPx * PRODUCT_HERO_VISUAL_CONTRACT.constraints.minProductHeight) {
      failures.push('Product UI is too small to be legible at feed size.');
    }
    if (!g.headline || g.headline.width < input.widthPx * PRODUCT_HERO_VISUAL_CONTRACT.constraints.minHeadlineWidth) {
      failures.push('Headline is missing or too narrow for the Product Hero message field.');
    }
    if (!g.cta) failures.push('CTA is missing.');
    if (g.headline && g.cta && g.cta.y - (g.headline.y + g.headline.height)
      > input.heightPx * PRODUCT_HERO_VISUAL_CONTRACT.constraints.maxHeadlineToCtaGap) {
      failures.push('CTA is disconnected from the message.');
    }
    if (g.headline && regionsIntersect(g.headline, g.product)) failures.push('Headline overlaps product UI.');
    if (g.cta && regionsIntersect(g.cta, g.product)) failures.push('CTA overlaps product UI.');
    if (g.logo && regionsIntersect(g.logo, g.product)) failures.push('Logo overlaps product UI.');
    if (!g.supportPresent) advisory.push('Supporting copy is optional and was intentionally omitted.');
  }
  return { hardPass: failures.length === 0, failures, advisory };
}

const SAFE_HEX = /^#[0-9a-fA-F]{6}$/;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Deterministic wrap. Whole words only — a cut word is a different claim. */
function wrap(text: string, maxChars: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) return null;   // does not fit: omit entirely
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/**
 * Builds one product creative deterministically.
 *
 * @security The screenshot and logo are composited from the supplied bytes and
 *   are never regenerated. Overlay lines are drawn verbatim or omitted; the
 *   compositor has no path by which it could author or alter a word.
 */
export async function composeProductCreative(
  input: CompositionInput,
): Promise<CompositionResult> {
  if (input.intent?.grammar === 'PROBLEM_VISUAL_MESSAGE' && input.visualThesis?.type === 'WAITING_FOR_HELP') {
    return composeHumanRecognition(input);
  }
  if (input.intent) return composeRecognitionCreative(input);
  const W = input.widthPx, H = input.heightPx;
  const layoutKey: CompositionLayout = input.layout ?? 'PROBLEM_FRAME';
  const baseLayout = LAYOUTS[layoutKey];
  const L: LayoutSpec = !input.screenshotBytes && layoutKey === 'PROBLEM_FRAME'
    ? { ...baseLayout, textW: 0.50, textTop: 0.22, headline: 0.062,
        support: 0.032, cta: 0.028, shot: null }
    : input.emphasizeMessage && layoutKey === 'PROBLEM_FRAME'
    ? { ...baseLayout, textTop: 0.18, headline: 0.065,
        shot: { w: 0.28, h: 0.56, x: 0.79, y: 0.58 } }
    : baseLayout;
  const accent = input.accentColor && SAFE_HEX.test(input.accentColor)
    ? input.accentColor : '#20262d';
  const omitted: string[] = [];
  const layers: OverlayOptions[] = [];
  /** Where the screenshot landed, so nothing is later drawn on top of it. */
  let shotBox: { left: number; top: number; right: number; bottom: number } | null = null;
  let productRegion: PixelRegion | null = null;
  let logoRegion: PixelRegion | null = null;
  let headlineRegion: PixelRegion | null = null;
  let ctaRegion: PixelRegion | null = null;

  // ── ground ───────────────────────────────────────────────────────────────
  const base = input.backgroundBytes
    ? await sharp(input.backgroundBytes).resize(W, H, { fit: 'cover' }).png().toBuffer()
    : await sharp({ create: { width: W, height: H, channels: 4,
        background: { r: 244, g: 247, b: 245, alpha: 1 } } }).png().toBuffer();

  // ── legibility scrim ─────────────────────────────────────────────────────
  //
  // A generated background is uncontrolled by construction: the model may
  // return something pale, busy or dark, and dark type on a dark texture is
  // unreadable. A soft light veil under the text column makes the governed
  // words legible whatever came back. It is drawn BEFORE the screenshot so it
  // never veils the owner's own pixels — those must stay exactly as supplied.
  if (input.backgroundBytes && L.scrim > 0) {
    const sx = Math.round(W * (L.textX - 0.03));
    const sw = Math.round(W * (L.textW + 0.08));
    layers.push({ input: Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="#ffffff" stop-opacity="${L.scrim}"/>` +
      `<stop offset="70%" stop-color="#ffffff" stop-opacity="${L.scrim * 0.75}"/>` +
      `<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>` +
      `</linearGradient></defs>` +
      `<rect x="${Math.max(0, sx)}" y="0" width="${sw}" height="${H}" fill="url(#s)"/></svg>`),
      top: 0, left: 0 });
  }

  // ── the owner's screenshot, pixel-for-pixel ──────────────────────────────
  //
  // Scaled and rounded only. `fit: 'inside'` never crops or distorts, so the
  // interior pixels are the owner's asset unchanged — which is the whole point:
  // a provider cannot have touched what a provider never received.
  //
  // WHEN THERE ARE NO WORDS, THE PICTURE IS THE WHOLE ADVERT. Every layout
  // reserves a text region, and an ineligible copy version means that region
  // stays empty — which is correct, and which left a third of the canvas blank
  // beneath a product pushed up to make room for nothing. The geometry adapts
  // rather than the governance: the shot is re-centred and allowed to grow into
  // the space the absent text was holding.
  const hasText = input.overlay.length > 0;
  const shotSpec = L.shot && !hasText
    ? { ...L.shot, w: Math.min(0.62, L.shot.w * 1.25), h: Math.min(0.74, L.shot.h * 1.15),
        x: 0.5, y: 0.52 }
    : L.shot;

  let screenshotComposited = false;
  if (input.screenshotBytes && shotSpec) {
    const shotW = Math.round(W * shotSpec.w);
    const shotH = Math.round(H * shotSpec.h);
    const shot = await sharp(input.screenshotBytes)
      .resize(shotW, shotH, { fit: 'inside', withoutEnlargement: false })
      .png().toBuffer();
    const meta = await sharp(shot).metadata();
    const sw = meta.width ?? shotW, sh = meta.height ?? shotH;
    const radius = Math.round(Math.min(sw, sh) * 0.06);
    const mask = Buffer.from(
      `<svg width="${sw}" height="${sh}"><rect width="${sw}" height="${sh}" ` +
      `rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
    const rounded = await sharp(shot)
      .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    // The spec's x/y is the CENTRE of the box, so a shot that scales to a
    // different aspect stays centred in its region rather than drifting to a
    // corner. Clamped so no layout can ever place a pixel off-canvas.
    const left = Math.max(0, Math.min(W - sw, Math.round(W * shotSpec.x - sw / 2)));
    const top = Math.max(0, Math.min(H - sh, Math.round(H * shotSpec.y - sh / 2)));
    layers.push({ input: rounded, left, top });
    shotBox = { left, top, right: left + sw, bottom: top + sh };
    productRegion = { x: left, y: top, width: sw, height: sh };
    screenshotComposited = true;
  }

  // ── the confirmed logo, pixel-for-pixel ──────────────────────────────────
  let logoComposited = false;
  if (input.logoBytes) {
    const size = Math.round(W * L.logo.size);
    const logo = await sharp(input.logoBytes)
      .resize(size, size, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    let lx = Math.round(W * L.logo.x), ly = Math.round(H * L.logo.y);
    // NEVER ON TOP OF THE OWNER'S SCREENSHOT. A layout can place the shot
    // anywhere, so the mark checks rather than assumes: if the corner it wants
    // is occupied, it moves to the widest free margin instead of overprinting
    // the one asset that must stay exactly as supplied.
    if (shotBox && lx < shotBox.right && lx + size > shotBox.left
        && ly < shotBox.bottom && ly + size > shotBox.top) {
      const leftGap = shotBox.left, rightGap = W - shotBox.right, topGap = shotBox.top;
      if (topGap >= size + Math.round(H * 0.03)) ly = Math.round(H * 0.04);
      else if (rightGap >= leftGap && rightGap >= size) lx = W - size - Math.round(W * 0.045);
      else if (leftGap >= size) lx = Math.round(W * 0.045);
      else ly = Math.max(0, H - size - Math.round(H * 0.045));   // last resort: below it
    }
    layers.push({ input: logo, left: lx, top: ly });
    logoRegion = { x: lx, y: ly, width: size, height: size };
    logoComposited = true;
  }

  // ── governed marketing text ──────────────────────────────────────────────
  const padX = Math.round(W * L.textX);
  const colW = Math.round(W * L.textW);
  const drawn: OverlayLine[] = [];
  let svgBody = '';
  let y = Math.round(H * L.textTop);

  const headline = input.overlay.find(l => l.role === 'HEADLINE');
  if (headline) {
    const size = Math.round(W * L.headline);
    const lines = wrap(headline.text, Math.floor(colW / (size * 0.5)), 3);
    if (!lines) omitted.push('The headline was too long to place on this image.');
    else {
      drawn.push(headline);
      const headlineTop = y;
      for (const l of lines) {
        y += Math.round(size * 1.18);
        svgBody += `<text x="${padX}" y="${y}" font-family="Inter, Helvetica, Arial, sans-serif" ` +
          `font-size="${size}" font-weight="700" fill="#17211d">${esc(l)}</text>`;
      }
      headlineRegion = { x: padX, y: headlineTop, width: colW,
        height: y - headlineTop };
    }
  }

  // A product hero is deliberately concise. The supporting line is optional
  // marketing copy; retaining it here used to consume the CTA's only safe
  // space and leave a certified CTA off the delivered pixels.
  const support = layoutKey === 'PRODUCT_HERO'
    ? undefined : input.overlay.find(l => l.role === 'SUPPORTING_COPY');
  if (!support && layoutKey === 'PRODUCT_HERO'
      && input.overlay.some(l => l.role === 'SUPPORTING_COPY')) {
    omitted.push('Supporting copy was omitted to preserve product prominence and the required call to action.');
  }
  if (support) {
    const size = Math.round(W * L.support);
    const lines = wrap(support.text, Math.floor(colW / (size * 0.5)), 3);
    if (!lines) omitted.push('The supporting line was too long to place on this image.');
    else {
      drawn.push(support);
      y += Math.round(size * 0.9);
      for (const l of lines) {
        y += Math.round(size * 1.35);
        svgBody += `<text x="${padX}" y="${y}" font-family="Inter, Helvetica, Arial, sans-serif" ` +
          `font-size="${size}" font-weight="400" fill="#27302d">${esc(l)}</text>`;
      }
    }
  }

  const cta = input.overlay.find(l => l.role === 'CTA');
  if (cta) {
    const size = Math.round(W * L.cta);
    const chipH = Math.round(size * 2.6);
    const chipW = Math.min(Math.round(cta.text.length * size * 0.62) + size * 2.4, colW);
    const chipY = y + Math.round(size * 1.6);
    if (chipY + chipH < H - Math.round(H * 0.04)) {
      drawn.push(cta);
      ctaRegion = { x: padX, y: chipY, width: chipW, height: chipH };
      svgBody +=
        `<rect x="${padX}" y="${chipY}" rx="${Math.round(chipH / 2)}" width="${chipW}" ` +
        `height="${chipH}" fill="${accent}"/>` +
        `<text x="${padX + size * 1.2}" y="${chipY + Math.round(chipH * 0.66)}" ` +
        `font-family="Inter, Helvetica, Arial, sans-serif" font-size="${size}" ` +
        `font-weight="650" fill="#ffffff">${esc(cta.text)}</text>`;
    } else omitted.push('There was no room to place the call to action.');
  }

  // A CTA supplied by an eligible copy version is mandatory for a product
  // creative. Do not let an overflow silently downgrade it into a CTA-less ad.
  if (cta && !drawn.includes(cta)) {
    throw new Error('Required governed CTA cannot fit the chosen composition');
  }

  if (svgBody) {
    layers.push({ input: Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svgBody}</svg>`),
      top: 0, left: 0 });
  }

  const bytes = layers.length > 0
    ? await sharp(base).composite(layers).png().toBuffer()
    : await sharp(base).png().toBuffer();

  return {
    bytes, widthPx: W, heightPx: H,
    manifest: {
      layout: layoutKey,
      backgroundSource: input.backgroundBytes ? 'GENERATED' : 'BRAND_SOLID',
      screenshotComposited, logoComposited,
      overlayLines: drawn.map(l => ({ role: l.role, text: l.text,
        sourceContentVersion: l.sourceContentVersion })),
      geometry: layoutKey === 'PRODUCT_HERO' && productRegion
        ? { productHero: { product: productRegion, headline: headlineRegion,
          cta: ctaRegion, logo: logoRegion,
          supportPresent: drawn.some(line => line.role === 'SUPPORTING_COPY') } }
        : undefined,
      omitted,
    },
  };
}

/** A conservative suitability decision, separate from authorization. */
export function compositionAssetSuitability(input: {
  width: number; height: number; source?: string; assetType?: string;
  sourceRegion?: CompositionIntent['sourceRegion'];
}): { role: 'HERO' | 'EVIDENCE' | 'OMIT'; reason: string } {
  if (input.assetType !== 'SCREENSHOT' || input.width < 400 || input.height < 600) {
    return { role: 'OMIT', reason: 'Insufficient useful resolution for a feed-size product reveal' };
  }
  const ratio = input.width / input.height;
  if (input.sourceRegion || (['OWNER_UPLOAD', 'OWNER_URL'].includes(input.source ?? '')
      && input.width >= 500 && input.height >= 600 && ratio >= 0.42 && ratio <= 1.1)) {
    return { role: 'HERO', reason: 'Owner-supplied product UI has resolution for a substantial authentic hero region' };
  }
  return { role: 'EVIDENCE', reason: 'Authorized artwork has no established hero region; do not enlarge a promotional panel' };
}

/** Use a confirmed logo's chromatic pixels when no explicit brand color exists. */
export async function compositionAccent(confirmed: string | null, logo: Buffer | null): Promise<string> {
  if (confirmed && SAFE_HEX.test(confirmed)) return confirmed;
  if (logo) {
    const { data, info } = await sharp(logo).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let p = 0; p < data.length; p += info.channels) {
      const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]];
      if (a < 180 || Math.max(r, g, b) - Math.min(r, g, b) < 60) continue;
      const key = [r, g, b].map(c => Math.floor(c / 32)).join(',');
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b; buckets.set(key, bucket);
    }
    const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    if (best) return '#' + [best.r, best.g, best.b].map(c => Math.round(c / best.n).toString(16).padStart(2, '0')).join('');
  }
  return '#25362f';
}

async function textRaster(text: string, size: number, bold: boolean, color: string) {
  return sharp({ text: { text: `<span foreground="${color}">${esc(text)}</span>`,
    font: `Helvetica ${bold ? 'Bold ' : ''}${size}`, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
}

/** Actual glyph measurements; whole words and verbatim wording only. */
async function measuredLines(text: string, size: number, width: number, maxLines: number, color: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const cache = new Map<string, Awaited<ReturnType<typeof textRaster>>>();
  const measure = async (value: string) => {
    if (!cache.has(value)) cache.set(value, await textRaster(value, size, true, color));
    return cache.get(value)!;
  };
  // Dynamic programming chooses balanced breaks while avoiding stranded small
  // words. This is bounded by channel copy length, not a typography subsystem.
  const solutions = new Map<string, { cost: number; lines: string[] } | null>();
  async function solve(start: number, remaining: number): Promise<{ cost: number; lines: string[] } | null> {
    if (start === words.length) return { cost: 0, lines: [] };
    if (!remaining) return null;
    const key = `${start}:${remaining}`;
    if (solutions.has(key)) return solutions.get(key)!;
    let best: { cost: number; lines: string[] } | null = null;
    for (let end = start + 1; end <= words.length; end++) {
      const line = words.slice(start, end).join(' ');
      const raster = await measure(line);
      if (raster.info.width > width) break;
      const rest = await solve(end, remaining - 1);
      if (!rest) continue;
      const lastWord = words[end - 1];
      const dangling = /^(a|an|the|to|on|with|and|or|of|for|in|should|shouldn't|could|couldn't|would|wouldn't|can|can't|doesn't|don't)$/i.test(lastWord) && end < words.length;
      const orphan = end - start === 1 && end === words.length;
      const cost = Math.pow(1 - raster.info.width / width, 2) + (dangling ? 2 : 0)
        + (orphan ? 1.2 : 0) + 0.12 + rest.cost;
      if (!best || cost < best.cost) best = { cost, lines: [line, ...rest.lines] };
    }
    solutions.set(key, best); return best;
  }
  const result = await solve(0, maxLines);
  return result ? Promise.all(result.lines.map(async line => ({ line, ...await measure(line) }))) : null;
}

/** Authentic pixels may be cropped, but never reconstructed or extended. */
async function clippedLayer(bytes: Buffer, x: number, y: number, W: number, H: number): Promise<OverlayOptions | null> {
  const meta = await sharp(bytes).metadata();
  const w = meta.width!, h = meta.height!;
  const left = Math.max(0, -x), top = Math.max(0, -y);
  const width = Math.min(w - left, W - Math.max(0, x));
  const height = Math.min(h - top, H - Math.max(0, y));
  if (width <= 0 || height <= 0) return null;
  return { input: await sharp(bytes).extract({ left, top, width, height }).png().toBuffer(),
    left: Math.max(0, x), top: Math.max(0, y) };
}

export interface PixelRegion { x: number; y: number; width: number; height: number }
export function regionsIntersect(a: PixelRegion, b: PixelRegion): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Intent-derived conservative right-side protection, not a claim of face detection.
 * Preserve the source aspect ratio and its right-hand subject instead of cropping
 * it toward the center as the text grows. All message elements share one field.
 */
async function composeHumanRecognition(input: CompositionInput): Promise<CompositionResult> {
  if (!input.backgroundBytes) throw new Error('Human recognition requires a photograph');
  const W = input.widthPx, H = input.heightPx;
  const ground = '#f7f5ef', ink = '#17162d';
  const accent = await compositionAccent(input.accentColor, input.logoBytes);
  const meta = await sharp(input.backgroundBytes).metadata();
  const photoW = Math.max(Math.round(W * 1.30), Math.ceil(H * meta.width! / meta.height!));
  const photoH = Math.round(photoW * meta.height! / meta.width!);
  const photoX = Math.round(W * 0.485 - photoW * 0.45), photoY = H - photoH;
  // Reserve the complete intended right-side human envelope, including hands.
  const subject = { x: Math.round(photoX + photoW * 0.45), y: Math.max(0, photoY),
    width: W - Math.round(photoX + photoW * 0.45), height: H - Math.max(0, photoY) };
  const padding = Math.round(W * 0.025);
  const protectedBox = { x: subject.x - padding, y: Math.max(0, subject.y - padding),
    width: subject.width + padding, height: subject.height + padding };
  const x = Math.round(W * 0.055), width = protectedBox.x - x - 1;
  const elements: Record<string, PixelRegion> = {};
  const layers: OverlayOptions[] = [];
  const photo = await sharp(input.backgroundBytes).resize({ width: photoW }).png().toBuffer();
  const clipped = await clippedLayer(photo, photoX, photoY, W, H);
  if (clipped) layers.push(clipped);
  // A local feathered treatment stops before the protected subject. It is never
  // an opaque panel across the majority of the picture.
  const fadeW = subject.x;
  layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="quiet"><stop offset="0" stop-color="${ground}" stop-opacity="0.98"/><stop offset="0.78" stop-color="${ground}" stop-opacity="0.94"/><stop offset="1" stop-color="${ground}" stop-opacity="0"/></linearGradient></defs><rect width="${fadeW}" height="${H}" fill="url(#quiet)"/></svg>`), left: 0, top: 0 });
  const drawn: OverlayLine[] = [];
  const hook = input.overlay.find(l => l.role === 'HEADLINE');
  const support = input.overlay.find(l => l.role === 'SUPPORTING_COPY');
  const cta = input.overlay.find(l => l.role === 'CTA');
  const compact = input.intent?.typography.compact ?? false;
  const hookSize = Math.round(W * 0.080), supportSize = Math.round(W * (compact ? 0.036 : 0.034)), ctaSize = Math.round(W * 0.032);
  const hookY = Math.round(H * (compact ? 0.16 : 0.18));
  let y = hookY;
  async function groupLine(line: OverlayLine | undefined, size: number, maxLines: number, role: string) {
    if (!line?.sourceContentVersion || !line.text.trim()) return [];
    const lines = await measuredLines(line.text, size, width, maxLines, ink);
    if (!lines) throw new Error('Governed message cannot fit protected field at readable scale');
    const height = Math.round(lines.length * size * 1.12);
    elements[role] = { x, y, width: Math.max(...lines.map(l => l.info.width)), height };
    lines.forEach((l, n) => layers.push({ input: l.data, left: x, top: y + Math.round(n * size * 1.12) }));
    y += height; drawn.push(line); return lines;
  }
  const hookLines = await groupLine(hook, hookSize, 5, 'headline');
  y += Math.round(H * 0.025);
  const supportY = y;
  await groupLine(support, supportSize, 3, 'support');
  y += Math.round(H * 0.03);
  if (cta?.sourceContentVersion && cta.text.trim()) {
    const inset = Math.round(W * 0.019);
    const lines = await measuredLines(cta.text, ctaSize, width - 2 * inset, 2, '#ffffff');
    if (!lines) throw new Error('Governed CTA cannot fit protected message field');
    const height = Math.round(lines.length * ctaSize * 1.16 + 2 * inset);
    elements.cta = { x, y, width, height };
    layers.push({ input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="12" fill="${accent}"/></svg>`), left: x, top: y });
    lines.forEach((l,n) => layers.push({ input: l.data, left: x + inset, top: y + inset + Math.round(n * ctaSize * 1.16) }));
    y += height; drawn.push(cta);
  }
  if (input.logoBytes) {
    const logo = await sharp(input.logoBytes).resize(Math.round(W * 0.13), Math.round(H * 0.095), { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    elements.logo = { x, y: Math.round(H * 0.045), width: logo.info.width, height: logo.info.height };
    layers.push({ input: logo.data, left: x, top: elements.logo.y });
  }
  // Fail before final rasterization, not after a paid pixel critique.
  for (const region of Object.values(elements)) {
    if (regionsIntersect(region, protectedBox)) throw new Error('Message intersects protected human region');
    if (region.y + region.height > H * 0.95) throw new Error('Protected message exceeds readable canvas');
  }
  const bytes = await sharp({ create: { width: W, height: H, channels: 4, background: ground } }).composite(layers).png().toBuffer();
  return { bytes, widthPx: W, heightPx: H, manifest: {
    layout: 'PROBLEM_FRAME', backgroundSource: 'GENERATED', screenshotComposited: false,
    logoComposited: !!input.logoBytes, overlayLines: drawn, omitted: [], compositionIntent: input.intent,
    focalProtection: { subject, padding, message: { x, y: hookY, width, height: y - hookY }, elements,
      source: 'RIGHT_HUMAN_INTENT', readability: 'LOCAL_HORIZONTAL_FADE' },
    geometry: { hook: { ...elements.headline, fontSize: hookSize, lines: hookLines.map(l => l.line) },
      support: elements.support ? { y: supportY, fontSize: supportSize, height: elements.support.height } : null,
      cta: elements.cta ?? null, product: null },
  } };
}

async function composeRecognitionCreative(input: CompositionInput): Promise<CompositionResult> {
  const intent = input.intent!;
  const W = input.widthPx, H = input.heightPx, scale = W / 1024;
  const fragment = intent.grammar === 'HOOK_PRODUCT_FRAGMENT';
  if (fragment && !input.screenshotBytes) throw new Error('Product-fragment composition requires an authentic hero asset');
  const accent = await compositionAccent(input.accentColor, input.logoBytes);
  const ground = '#f7f5ef', ink = '#17162d';
  const layers: OverlayOptions[] = [];
  const omitted: string[] = [];
  const drawn: OverlayLine[] = [];
  const pad = Math.round(W * 0.065);
  const onLeft = intent.anchor.includes('LEFT');
  const textX = pad;
  const textW = Math.round(W * 0.87);
  const supportW = fragment ? Math.round(W * 0.36) : textW;
  const hook = input.overlay.find(l => l.role === 'HEADLINE');
  let hookSize = Math.round(W * intent.typography.hookScale);
  let lines: Awaited<ReturnType<typeof measuredLines>> = null;
  const hookMaxHeight = H * (intent.dominant === 'HEADLINE' ? 0.36 : 0.33);
  if (hook?.sourceContentVersion && hook.text.trim()) {
    while (hookSize >= Math.round(W * 0.070)) {
      lines = await measuredLines(hook.text, hookSize, textW, 3, ink);
      if (lines && lines.length * hookSize * 1.05 <= hookMaxHeight) break;
      lines = null; hookSize -= Math.max(1, Math.round(scale * 2));
    }
    if (!lines) throw new Error('Governed hook cannot fit the chosen arrangement at readable scale');
  }
  const hookY = Math.round(H * 0.145);
  const hookHeight = lines ? Math.round(lines.length * hookSize * 1.05) : 0;
  let y = hookY + hookHeight;
  const support = input.overlay.find(l => l.role === 'SUPPORTING_COPY');
  const supportSize = Math.round(W * intent.typography.supportScale);
  const supportLines = support?.sourceContentVersion && support.text.trim()
    ? await measuredLines(support.text, supportSize, supportW, 3, ink) : null;
  if (support && !supportLines) throw new Error('Governed supporting copy cannot fit at readable scale');
  const supportX = fragment && onLeft ? Math.round(W * 0.59) : textX;
  const supportY = y + Math.round(H * (intent.typography.compact ? 0.015 : 0.026));
  const supportHeight = supportLines ? Math.round(supportLines.length * supportSize * 1.18) : 0;
  if (supportLines) y = supportY + supportHeight;
  const cta = input.overlay.find(l => l.role === 'CTA');
  const ctaSize = Math.round(W * 0.037);
  const ctaText = cta?.sourceContentVersion && cta.text.trim() ? await textRaster(cta.text, ctaSize, true, '#ffffff') : null;
  const ctaY = y + Math.round(H * intent.typography.ctaGap);
  const ctaH = Math.round(W * 0.080);
  const ctaW = ctaText ? ctaText.info.width + Math.round(W * 0.060) : 0;
  if (ctaText && (ctaW > textW || ctaY + ctaH > H * 0.9)) throw new Error('Governed CTA cannot fit the chosen arrangement');

  // Background has a subject field, rather than being painted over with a
  // universal left-hand rectangle. Its visible area follows the message block.
  if (input.backgroundBytes) {
    const fieldY = fragment ? 0 : intent.overlap === 'COPY_FIELD'
      ? Math.min(Math.round(H * (1 - intent.visualWeight)), ctaY - Math.round(H * 0.035))
      : ctaY + ctaH + Math.round(H * 0.025);
    const fieldH = H - fieldY;
    const background = await sharp(input.backgroundBytes).flop(onLeft).resize(W, fieldH, { fit: 'cover', position: onLeft ? 'left' : 'right' }).png().toBuffer();
    layers.push({ input: background, left: 0, top: fieldY });
    const fade = fragment
      ? `<linearGradient id="f"><stop offset="0" stop-color="${ground}"/><stop offset="0.54" stop-color="${ground}" stop-opacity="0.94"/><stop offset="1" stop-color="${ground}" stop-opacity="0.08"/></linearGradient><rect width="${W}" height="${H}" fill="url(#f)" transform="${onLeft ? `translate(${W},0) scale(-1,1)` : ''}"/>`
      : `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground}"/><stop offset="1" stop-color="${ground}" stop-opacity="0"/></linearGradient><rect y="${fieldY}" width="${W}" height="${Math.round(H * 0.14)}" fill="url(#f)"/>`;
    layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs>${fade.slice(0, fade.indexOf('</linearGradient>') + 17)}</defs>${fade.slice(fade.indexOf('</linearGradient>') + 17)}</svg>`), left: 0, top: 0 });
  }
  let product: NonNullable<CompositionResult['manifest']['geometry']>['product'] = null;
  if (input.screenshotBytes && intent.assetRole !== 'OMIT') {
    const meta = await sharp(input.screenshotBytes).metadata();
    const region = intent.sourceRegion ?? { x: 0, y: 0, width: 1, height: 1 };
    if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
        || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('Invalid authentic source region');
    const sourceRegion = { left: Math.floor(region.x * meta.width!), top: Math.floor(region.y * meta.height!),
      width: Math.max(1, Math.floor(region.width * meta.width!)), height: Math.max(1, Math.floor(region.height * meta.height!)) };
    const source = sharp(input.screenshotBytes).extract(sourceRegion);
    const hero = intent.assetRole === 'UI_FRAGMENT' || intent.assetRole === 'HERO';
    const maxW = Math.round(W * (hero ? intent.visualWeight : 0.24));
    const maxH = Math.round(H * (hero ? 0.86 : 0.30));
    const crop = intent.crop !== 'CONTAIN';
    const raster = await (crop && intent.crop !== 'CROP_TO_FOCUS'
      ? source.resize({ width: maxW })
      : source.resize(maxW, maxH, { fit: 'inside' })).png().toBuffer({ resolveWithObject: true });
    const pw = raster.info.width, ph = raster.info.height;
    const off = intent.crop === 'PARTIAL_OFF_CANVAS' || intent.crop === 'BLEED';
    const px = onLeft ? (off ? -Math.round(W * 0.045) : pad)
      : W - pw - (off ? -Math.round(W * 0.045) : Math.round(W * 0.035));
    const py = fragment ? hookY + hookHeight + Math.round(H * 0.055)
      : H - ph - Math.round(H * 0.035);
    // The fragment may occupy the visual field beneath the text's horizontal
    // extent, but an opaque message block is never stamped on authentic UI.
    const item = await clippedLayer(raster.data, px, py, W, H);
    if (item) layers.push(item);
    product = { x: px, y: py, width: pw, height: ph, sourceRegion };
  }
  if (input.logoBytes) {
    const logo = await sharp(input.logoBytes).resize(Math.round(W * 0.12), Math.round(H * 0.082), { fit: 'inside' }).png().toBuffer();
    layers.push({ input: logo, left: textX, top: Math.round(H * 0.032) });
  }
  // Render the same measured glyphs used to solve the line breaks. If a hero
  // would obscure those bounds, place the message above it only when permitted.
  const addText = (data: Buffer, left: number, top: number, width: number, height: number) => {
    if (product && left < product.x + product.width && left + width > product.x
        && top < product.y + product.height && top + height > product.y) {
      throw new Error('Authentic product region intersects governed text; choose another anchor or grammar');
    }
    layers.push({ input: data, left, top });
  };
  if (lines && hook) {
    for (let n = 0; n < lines.length; n++) addText(lines[n].data, textX,
      hookY + Math.round(n * hookSize * 1.05), lines[n].info.width, lines[n].info.height);
    drawn.push(hook);
  }
  if (supportLines && support) {
    for (let n = 0; n < supportLines.length; n++) addText(supportLines[n].data, supportX,
      supportY + Math.round(n * supportSize * 1.18), supportLines[n].info.width, supportLines[n].info.height);
    drawn.push(support);
  }
  if (ctaText && cta) {
    const chip = Buffer.from(`<svg width="${ctaW}" height="${ctaH}" xmlns="http://www.w3.org/2000/svg"><rect width="${ctaW}" height="${ctaH}" rx="${Math.round(W * 0.014)}" fill="${accent}"/></svg>`);
    addText(chip, supportX, ctaY, ctaW, ctaH);
    layers.push({ input: ctaText.data, left: supportX + Math.round(W * 0.03), top: ctaY + Math.round((ctaH - ctaText.info.height) / 2) });
    drawn.push(cta);
  }
  const bytes = await sharp({ create: { width: W, height: H, channels: 4, background: ground } }).composite(layers).png().toBuffer();
  return { bytes, widthPx: W, heightPx: H, manifest: { layout: 'PROBLEM_FRAME',
    backgroundSource: input.backgroundBytes ? 'GENERATED' : 'BRAND_SOLID',
    screenshotComposited: !!product, logoComposited: !!input.logoBytes,
    overlayLines: drawn.map(line => ({ ...line })), omitted, compositionIntent: intent,
    geometry: { hook: { x: textX, y: hookY, width: textW, height: hookHeight, fontSize: hookSize, lines: lines?.map(l => l.line) ?? [] },
      support: supportLines ? { y: supportY, fontSize: supportSize, height: supportHeight } : null,
      cta: ctaText ? { x: supportX, y: ctaY, width: ctaW, height: ctaH } : null, product } } };
}

/**
 * The background prompt for deterministic-composition mode.
 *
 * Asks for a WORDLESS backdrop and nothing else. No product, no interface, no
 * digital device, no people — anything the model invents in those categories would sit
 * beside the owner's real screenshot and be read as part of it.
 */
export function backgroundPrompt(
  moodStyle: string | null,
  brandColors: readonly string[],
  layout: CompositionLayout = 'PROBLEM_FRAME',
  _recognitionContext = '',
  intent?: CompositionIntent,
  thesis?: VisualThesis,
): string {
  if (intent?.grammar === 'PROBLEM_VISUAL_MESSAGE' || (!intent && layout === 'PROBLEM_FRAME')) {
    if (!thesis) throw new Error('Problem imagery requires a context-grounded visual thesis before generation');
    return problemScenePrompt(thesis);
  }
  if (intent) {
    return 'Wordless architectural daylight on plain tactile plaster. Quiet natural photographic texture beneath authentic product artwork added later. '
      + WORDLESS_SCENE_CONTRACT + ' No people, devices, metaphor props or product representation.';
  }
  const palette = brandColors.length > 0
    ? ` Built around ${brandColors.join(' and ')}.` : ' Restrained neutral palette: warm ivory, graphite and natural metal; no pink, rose, teal or saturated decorative accents.';
  // The ground has a job, and the job differs by layout. Asking for the same
  // backdrop under all three would undo most of what the geometry achieved:
  // three different arrangements over one identical texture still read as one
  // advert with the furniture moved.
  const ground = layout === 'PRODUCT_HERO'
    ? ' A quiet near-plain gradient ground.'
    : ' Open softly lit space with a restrained natural texture.';
  return (layout === 'PROBLEM_FRAME'
    ? 'A distinctive premium editorial campaign background conveying the supplied audience tension.'
    : 'An abstract, softly lit background texture for a marketing layout.') +
    ground + (moodStyle ? ` Mood: ${moodStyle}.` : '') + palette +
    ' Absolutely no text, no letters, no numbers,' +
    ' no logos, no user interface, no mobile phone, no screen, no digital device, no people, no faces,' +
    ' no badges, no icons. Background texture only.';
}

/** Never drawn by the model in this mode. Carried explicitly. */
export const BACKGROUND_NEGATIVE = [
  'no text', 'no letters', 'no words', 'no numbers', 'no typography', 'no captions',
  'no logos', 'no watermarks', 'no badges', 'no icons', 'no ratings', 'no awards',
  'no user interface', 'no app screen', 'no mobile phone', 'no digital device', 'no mockup',
  'no people', 'no faces', 'no hands', 'no product',
].join(', ');

/** Positive prompt includes every prohibition; no reliance on negative-prompt support. */
export const WORDLESS_SCENE_CONTRACT = 'NO readable text or pseudo-text anywhere. No words, labels, signs, UI, app screens, logos, letters, numbers, watermarks, typography or branded marks. All surfaces and materials are unmarked. LaunchMind adds all governed copy, authentic branding and product UI deterministically after this photograph is generated.';

export function problemScenePrompt(thesis: VisualThesis): string {
  return [
    `Visual thesis: ${thesis.type}.`,
    ...(thesis.scenePattern ? [`Scene pattern: ${thesis.scenePattern}.`] : []),
    `Marketing problem (context only; never render as text): ${thesis.marketingProblem}`,
    `Immediate recognition: ${thesis.immediateRecognition}`,
    `SCENE: ${thesis.scene}`,
    `Allowed subjects: ${thesis.allowedSubjects.join('; ')}.`,
    `Exclude entirely: ${thesis.forbiddenSubjects.join('; ')}.`,
    thesis.type === 'WAITING_FOR_HELP'
      ? 'Natural residential daylight, realistic skin and hands, moderate depth of field and restrained styling. Keep the face and waiting posture prominent on the right with a quiet pale left field. The human emotion is the focal idea; household context is secondary. Deliver only the lifestyle photograph, not a designed layout: LaunchMind adds the copy and branding.'
      : 'Natural residential daylight, credible materials and restrained emotional tension. A coherent medium-wide environmental photograph, not an isolated object still life. Keep the unresolved repair and its immediate context together in one clear focal region, with enough surrounding room for a later crop. Do not design an advertisement, text area, split screen, CTA, footer or final layout.',
    `Meaning: ${thesis.messageRelationship}`,
    WORDLESS_SCENE_CONTRACT,
  ].join('\n');
}
