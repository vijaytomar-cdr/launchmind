/**
 * @file typography.ts
 * @description One typography scale for every owner surface — B6B UX §3.
 *
 *   THE DEFECT THIS FIXES. Content Intelligence and Content Studio looked like
 *   different products, and the cause was not that either was wrong. Every
 *   component declared its own type independently, so Syne and DM Mono were
 *   applied at different rates in each file:
 *
 *     BriefClientView      Syne 4 · mono 3
 *     Content Intelligence Syne 2 · mono 1
 *     Content Studio       Syne 2 · mono 7
 *     CampaignWorkbench    Syne 2 · mono 3
 *     StudioHome           Syne 1 · mono 0
 *     CreativePanel        Syne 0 · mono 1
 *     OwnerInputsPanel     Syne 0 · mono 0
 *
 *   Two adjacent pages built from those components cannot look like one system.
 *
 *   WHY THE DISPLAY FONT SURVIVES. The v3 reference is Inter-only — no Syne, no
 *   mono anywhere in it. But CLAUDE.md §6.2 locks Inter + Syne + DM Mono as the
 *   production design system, and Syne is used across surfaces this pass is not
 *   allowed to touch (Growth Brain, Improve Intelligence, onboarding). Ripping
 *   it out of six files would make those six the odd ones instead. So the fix is
 *   CONSISTENCY, not substitution: one scale, applied identically, with v3's
 *   tighter heading metrics adopted where they read better.
 *
 *   MONO IS FOR DATA. Version numbers, counts and identifiers only — never a
 *   sentence. That rule is why Content Studio looked most different: it had
 *   seven mono declarations, several on prose.
 *
 * @security None. Presentation only — no owner data, no governance.
 */

import type { CSSProperties } from 'react';

const DISPLAY = 'var(--font-syne), Syne, ui-sans-serif, system-ui, sans-serif';
const MONO = 'var(--font-dm-mono), ui-monospace, SFMono-Regular, monospace';

/** Page title. One per page. v3 metrics: 30px, tight tracking. */
export const pageTitle: CSSProperties = {
  fontFamily: DISPLAY, fontSize: 30, fontWeight: 700,
  lineHeight: 1.2, letterSpacing: '-0.6px', color: 'var(--ink)', margin: 0,
};

/** The sentence under a page title. */
export const pageLead: CSSProperties = {
  fontSize: 14, color: 'var(--ink2)', lineHeight: 1.5, margin: '6px 0 0',
};

/** A major section or card heading. */
export const sectionTitle: CSSProperties = {
  fontFamily: DISPLAY, fontSize: 20, fontWeight: 700,
  lineHeight: 1.25, letterSpacing: '-0.25px', color: 'var(--ink)', margin: 0,
};

/** A heading inside a card. */
export const cardTitle: CSSProperties = {
  fontFamily: DISPLAY, fontSize: 16, fontWeight: 700,
  lineHeight: 1.3, color: 'var(--ink)', margin: 0,
};

/**
 * The small uppercase label above a block.
 *
 * Body font, never display: a display face at 10px with wide tracking is
 * illegible, which is what made some of these read as a different system.
 */
export const eyebrow: CSSProperties = {
  fontSize: 10, fontWeight: 750, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6,
};

export const body: CSSProperties = { fontSize: 13, color: 'var(--ink2)', lineHeight: 1.55 };
export const bodyStrong: CSSProperties = { fontSize: 13, color: 'var(--ink)', lineHeight: 1.55, fontWeight: 650 };
export const meta: CSSProperties = { fontSize: 12, color: 'var(--ink3)', lineHeight: 1.45 };

/** DATA ONLY — versions, counts, identifiers. Never a sentence. */
export const dataValue: CSSProperties = { fontFamily: MONO, fontSize: 12, color: 'var(--ink)' };

/** The canonical card. Matches v3 `.card`. */
export const card: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, padding: 20,
};
/** A block nested inside a card. */
export const innerBlock: CSSProperties = {
  background: 'var(--raised)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '11px 13px',
};
/** Attention. Amber pair already established across the product. */
export const attentionBlock: CSSProperties = {
  background: 'var(--amber2)', border: '1px solid #f2d29f',
  borderRadius: 10, padding: '11px 13px', color: '#7d4306',
};
export const pill: CSSProperties = {
  borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 800,
  letterSpacing: '.04em', textTransform: 'uppercase',
};
