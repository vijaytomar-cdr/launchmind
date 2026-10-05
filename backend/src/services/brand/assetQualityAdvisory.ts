/**
 * @file assetQualityAdvisory.ts
 * @description Owner-asset quality advisory — §14, §15.
 *
 *   THE SITUATION THIS EXISTS FOR. The owner's authorised App Store screenshot
 *   is itself cropped: its headline reads "HOME CARE AT YOUR FINGE", cut mid-word
 *   at the right edge. LaunchMind places it faithfully, so the crop appears in
 *   every creative built from it — and looks like LaunchMind's mistake.
 *
 *   TWO RULES THAT PULL IN OPPOSITE DIRECTIONS, and both are kept:
 *
 *     PRESERVE THE OWNER'S PIXELS. Nothing here redraws, repairs, inpaints,
 *     re-crops or regenerates anything. This module RETURNS ADVICE. It has no
 *     write path and no image output — it physically cannot alter an asset.
 *
 *     DO NOT SHIP A DEFECT SILENTLY. An owner who has not looked closely at
 *     their own store screenshot in a year should be told before it becomes the
 *     hero of an advert.
 *
 *   ADVISORY, NOT A GATE. §14 is explicit that AI aesthetic judgement must not
 *   become a hard authorization gate, and this is a heuristic looking at edge
 *   pixels — it will occasionally be wrong about a design that deliberately
 *   bleeds to the edge. So it never blocks: the owner is offered "replace" and
 *   "use anyway", and "use anyway" genuinely uses it.
 *
 * @security Read-only image analysis. No mutation, no storage write, no
 *   provider call, no model. Deterministic for a given input.
 * @dependencies sharp
 */

import sharp from 'sharp';

export type AssetAdvisoryKind =
  | 'EDGE_CLIPPING' | 'LOW_RESOLUTION' | 'EXTREME_ASPECT' | 'MOSTLY_TRANSPARENT';

export interface AssetAdvisory {
  kind: AssetAdvisoryKind;
  /** Owner-safe sentence. Never an enum, never a pixel coordinate. */
  message: string;
  /** Which edge, when relevant. Owner-facing word. */
  where: 'left' | 'right' | 'top' | 'bottom' | null;
  /** ALWAYS false. An advisory never blocks creation — §14. */
  blocking: false;
}

export interface AssetQualityReport {
  advisories: AssetAdvisory[];
  /** Measured, for the source-vs-render test. Never shown to an owner. */
  measurements: {
    widthPx: number; heightPx: number;
    edgeInkFraction: Record<'left' | 'right' | 'top' | 'bottom', number>;
    /** Whether each edge carries a text-line-sized run of severed content. */
    edgeCutLike: Record<'left' | 'right' | 'top' | 'bottom', boolean>;
  };
}

/** Below this, a store screenshot will look soft as a 1024px hero. */
const MIN_LONG_EDGE = 480;
/**
 * A contiguous run of ink touching a boundary, as a fraction of that boundary.
 *
 * RUNS, NOT TOTALS, and the first version of this got it wrong. It measured the
 * TOTAL fraction of an edge carrying ink and required 16%. Measured against the
 * owner's real App Store screenshot — whose headline is genuinely cut mid-word
 * at the right edge — that figure was 0.02, because the severed text is a
 * single thin line of small grey glyphs. The detector missed the exact defect
 * it was written for, and only testing it against the real asset showed that.
 *
 * A cut line of text meets the edge as ONE SHORT CONTIGUOUS RUN roughly the
 * height of the glyphs. A design that deliberately bleeds to the edge meets it
 * as one very long run, or as the whole edge. So the signal is a run that is
 * long enough to be content and short enough not to be a background.
 */
const RUN_MIN = 0.012;   // ~8px on a 650px edge: a line of small text
const RUN_MAX = 0.55;    // beyond this it is a deliberate full bleed, not a cut

/**
 * How much "ink" sits on one boundary line.
 *
 * Ink means: markedly different from the image's own dominant border tone.
 * Measured against the asset's OWN background rather than an absolute, because
 * a dark-themed screenshot has a dark background and an absolute threshold
 * would call every one of them clipped.
 */
function edgeInk(
  raw: Buffer, w: number, h: number, ch: number,
  edge: 'left' | 'right' | 'top' | 'bottom',
): { fraction: number; longestRun: number; cutLike: boolean } {
  const at = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    return [raw[i], raw[i + 1], raw[i + 2]] as [number, number, number];
  };
  // The dominant tone of the frame, sampled from all four corners.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const base: [number, number, number] = [
    corners.reduce((s, c) => s + c[0], 0) / 4,
    corners.reduce((s, c) => s + c[1], 0) / 4,
    corners.reduce((s, c) => s + c[2], 0) / 4,
  ];
  const far = (c: [number, number, number]) =>
    Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]) > 150;

  // Walk the boundary once, recording contiguous runs of ink.
  const line: boolean[] = [];
  if (edge === 'left' || edge === 'right') {
    const x = edge === 'left' ? 0 : w - 1;
    for (let y = 0; y < h; y++) line.push(far(at(x, y)));
  } else {
    const y = edge === 'top' ? 0 : h - 1;
    for (let x = 0; x < w; x++) line.push(far(at(x, y)));
  }
  const total = line.length;
  if (total === 0) return { fraction: 0, longestRun: 0, cutLike: false };

  let hits = 0, longest = 0, run = 0, cutLike = false;
  for (const on of line) {
    if (on) { hits++; run++; if (run > longest) longest = run; }
    else {
      if (run / total >= RUN_MIN && run / total <= RUN_MAX) cutLike = true;
      run = 0;
    }
  }
  if (run / total >= RUN_MIN && run / total <= RUN_MAX) cutLike = true;
  return { fraction: hits / total, longestRun: longest / total, cutLike };
}

/**
 * Inspects an authorised asset and returns advice.
 *
 * @security Returns advice only. There is no code path from here to a stored
 *   asset, a renderer or a provider — the function has no side effect at all.
 */
export async function assessAssetQuality(bytes: Buffer): Promise<AssetQualityReport> {
  const meta = await sharp(bytes).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const { data, info } = await sharp(bytes).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  const measured = {
    left: edgeInk(data, info.width, info.height, ch, 'left'),
    right: edgeInk(data, info.width, info.height, ch, 'right'),
    top: edgeInk(data, info.width, info.height, ch, 'top'),
    bottom: edgeInk(data, info.width, info.height, ch, 'bottom'),
  };
  const edgeInkFraction = {
    left: measured.left.fraction, right: measured.right.fraction,
    top: measured.top.fraction, bottom: measured.bottom.fraction,
  };
  const edgeCutLike = {
    left: measured.left.cutLike, right: measured.right.cutLike,
    top: measured.top.cutLike, bottom: measured.bottom.cutLike,
  };

  const advisories: AssetAdvisory[] = [];
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    if (edgeCutLike[edge]) {
      advisories.push({
        kind: 'EDGE_CLIPPING', where: edge, blocking: false,
        // NAMES THE SOURCE. §15 — an owner reading this must not conclude that
        // LaunchMind cropped their image.
        message: `This product image appears cropped near the ${edge} edge. ` +
          `LaunchMind can use it exactly as provided, but replacing it may ` +
          `improve the creative.`,
      });
    }
  }

  if (Math.max(w, h) > 0 && Math.max(w, h) < MIN_LONG_EDGE) {
    advisories.push({
      kind: 'LOW_RESOLUTION', where: null, blocking: false,
      message: 'This product image is small, so it may look soft when it fills an advert.',
    });
  }
  if (w > 0 && h > 0) {
    const ratio = Math.max(w / h, h / w);
    if (ratio > 4) {
      advisories.push({
        kind: 'EXTREME_ASPECT', where: null, blocking: false,
        message: 'This image is much longer than it is wide, so a square advert will ' +
          'leave a lot of empty space around it.',
      });
    }
  }

  return { advisories, measurements: { widthPx: w, heightPx: h, edgeInkFraction, edgeCutLike } };
}

/**
 * Where a visible defect came from — §15.
 *
 * THE DISTINCTION IS THE POINT. "Your image looks cut off" and "LaunchMind cut
 * your image off" are different statements, and only one of them is an apology.
 * A rendering defect is LaunchMind's bug and must be fixed; a source defect is
 * the owner's asset and must be reported without touching it.
 *
 * Decided by comparing the SOURCE's own edges against the composed output's
 * placement: if the source already carried content to its boundary, the defect
 * travelled with it.
 */
export type DefectOrigin = 'SOURCE_IMAGE' | 'LAUNCHMIND_RENDER' | 'NONE';

export function attributeDefect(opts: {
  sourceReport: AssetQualityReport;
  /** True when the compositor scaled the asset without cropping it. */
  placedWithoutCropping: boolean;
}): { origin: DefectOrigin; ownerMessage: string | null } {
  const sourceClipped = opts.sourceReport.advisories.some(a => a.kind === 'EDGE_CLIPPING');
  if (sourceClipped) {
    return {
      origin: 'SOURCE_IMAGE',
      ownerMessage: opts.sourceReport.advisories.find(a => a.kind === 'EDGE_CLIPPING')!.message,
    };
  }
  if (!opts.placedWithoutCropping) {
    return {
      origin: 'LAUNCHMIND_RENDER',
      ownerMessage: 'LaunchMind trimmed your product image to fit. That is a fault in ' +
        'the layout, not in your image.',
    };
  }
  return { origin: 'NONE', ownerMessage: null };
}
