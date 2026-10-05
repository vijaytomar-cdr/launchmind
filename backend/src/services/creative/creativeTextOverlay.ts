/**
 * @file creativeTextOverlay.ts
 * @description Deterministic text and logo compositing — B6A §15, §16.
 *
 *   THE ARCHITECTURAL DECISION THIS FILE FREEZES:
 *   the image model renders the PICTURE; LaunchMind renders the WORDS.
 *
 *   Asking a diffusion model to typeset marketing copy fails in a way that is
 *   uniquely bad here. It does not merely produce ugly letterforms — it produces
 *   DIFFERENT WORDS. A model asked for "Stop losing follow-ups" will happily
 *   render "Stop losing 40% of follow-ups", and that is an unsubstantiated
 *   quantified claim baked into pixels, downstream of the entire claim engine
 *   and invisible to it. Every governance layer built in 3.5 inspects text
 *   fields; none of them can read a picture.
 *
 *   So the provider is told to render no text at all, and the headline and CTA
 *   are composited here from fields that have ALREADY passed claim discovery,
 *   grounding and disposition. Exact wording, exact governance, and a text layer
 *   that can be re-rendered when the copy is edited.
 *
 *   OCR is deliberately NOT used as the safety mechanism. It would be a check on
 *   an opportunity we have instead removed, and a weak one — a missed word is a
 *   published claim.
 *
 * @security Overlay text comes only from governed content fields passed in by
 *   the caller. This module never invents, completes or rephrases a string.
 *   Logo compositing requires an owner-CONFIRMED logo; failure to fetch it
 *   returns the image without a logo rather than substituting anything.
 * @dependencies sharp
 */

import sharp, { type OverlayOptions } from 'sharp';

/** Escapes text for SVG. Without this a quote in a headline breaks the layer. */
function svgEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Naive width-based wrap. Deterministic, which matters more here than perfect. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length === 0) { line = w; continue; }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; if (lines.length === maxLines) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

export interface OverlayInput {
  /** Governed headline. Rendered VERBATIM or not at all. */
  headline?: string | null;
  /** Governed CTA. Rendered VERBATIM or not at all. */
  cta?: string | null;
  /** Owner-CONFIRMED logo only. An observed logo must not reach this. */
  confirmedLogoUrl?: string | null;
  /** Owner-confirmed colour, used for the CTA chip. */
  accentColor?: string | null;
}

export interface OverlayResult {
  bytes: Buffer;
  appliedHeadline: boolean;
  appliedCta: boolean;
  appliedLogo: boolean;
  /** Stated when something was requested but could not be applied. */
  notes: string[];
}

const SAFE_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Composites governed text and a confirmed logo onto a rendered image.
 *
 * @security Never alters the supplied strings. If a headline cannot be laid out
 *   it is omitted and reported, because a truncated claim is a different claim.
 */
export async function applyGovernedOverlay(
  imageBytes: Buffer, input: OverlayInput,
): Promise<OverlayResult> {
  const notes: string[] = [];
  let appliedHeadline = false, appliedCta = false, appliedLogo = false;

  const meta = await sharp(imageBytes).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;

  const layers: OverlayOptions[] = [];

  const headline = (input.headline ?? '').trim();
  const cta = (input.cta ?? '').trim();
  const accent = input.accentColor && SAFE_HEX.test(input.accentColor)
    ? input.accentColor : '#0b8f69';

  if (headline || cta) {
    const pad = Math.round(W * 0.06);
    const headSize = Math.round(W * 0.058);
    const ctaSize = Math.round(W * 0.032);
    const lines = headline ? wrap(headline, 26, 3) : [];

    if (headline && lines.join(' ').length < headline.length) {
      // The full headline did not fit. Omitted rather than cropped: half a
      // sentence is a claim nobody wrote.
      notes.push('The headline was too long to place on this image.');
    } else {
      appliedHeadline = lines.length > 0;
    }

    const blockTop = Math.round(H * 0.60);
    const headLines = appliedHeadline ? lines : [];
    const headSvg = headLines.map((l, i) =>
      `<text x="${pad}" y="${blockTop + (i + 1) * Math.round(headSize * 1.18)}" ` +
      `font-family="Inter, Helvetica, Arial, sans-serif" font-size="${headSize}" ` +
      `font-weight="700" fill="#ffffff">${svgEscape(l)}</text>`).join('');

    let ctaSvg = '';
    if (cta) {
      const chipW = Math.min(Math.round(cta.length * ctaSize * 0.62) + ctaSize * 2, W - pad * 2);
      const chipH = Math.round(ctaSize * 2.4);
      const chipY = blockTop + (headLines.length + 1) * Math.round(headSize * 1.18);
      if (chipY + chipH < H - pad) {
        appliedCta = true;
        ctaSvg =
          `<rect x="${pad}" y="${chipY}" rx="${Math.round(chipH / 2)}" ` +
          `width="${chipW}" height="${chipH}" fill="${accent}"/>` +
          `<text x="${pad + ctaSize}" y="${chipY + Math.round(chipH * 0.66)}" ` +
          `font-family="Inter, Helvetica, Arial, sans-serif" font-size="${ctaSize}" ` +
          `font-weight="650" fill="#ffffff">${svgEscape(cta)}</text>`;
      } else {
        notes.push('There was no room to place the call to action on this image.');
      }
    }

    if (headSvg || ctaSvg) {
      // Scrim so white text stays legible whatever the model produced.
      const svg = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="#000000" stop-opacity="0"/>` +
        `<stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>` +
        `</linearGradient></defs>` +
        `<rect x="0" y="${Math.round(H * 0.48)}" width="${W}" height="${Math.round(H * 0.52)}" fill="url(#s)"/>` +
        headSvg + ctaSvg + `</svg>`);
      layers.push({ input: svg, top: 0, left: 0 });
    }
  }

  if (input.confirmedLogoUrl) {
    try {
      const res = await fetch(input.confirmedLogoUrl, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const size = Math.round(W * 0.13);
        const padding = Math.round(W * 0.045);
        const logo = await sharp(Buffer.from(await res.arrayBuffer()))
          .resize(size, size, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png().toBuffer();
        const lm = await sharp(logo).metadata();
        layers.push({ input: logo, left: padding, top: padding });
        appliedLogo = true;
        void lm;
      } else {
        notes.push('Your logo could not be loaded, so it was left off.');
      }
    } catch {
      // A logo that will not load is left off. Substituting anything would put a
      // mark on the owner's advertisement that they never chose.
      notes.push('Your logo could not be loaded, so it was left off.');
    }
  }

  const bytes = layers.length > 0
    ? await sharp(imageBytes).composite(layers).png().toBuffer()
    : await sharp(imageBytes).png().toBuffer();

  return { bytes, appliedHeadline, appliedCta, appliedLogo, notes };
}
