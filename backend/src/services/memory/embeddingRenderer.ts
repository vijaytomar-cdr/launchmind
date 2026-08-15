/**
 * @file embeddingRenderer.ts
 * @description Canonical rendering + content hashing for embeddable records.
 *
 *   Phase 3.1B: contract and deterministic renderers ONLY. Nothing here calls an
 *   embedding provider; these functions turn a canonical row into the text that
 *   WOULD be embedded, and into the hash that detects when it has changed.
 *
 *   Why a renderer exists at all (ADR-066 rule 10): the obvious shortcut is
 *   `JSON.stringify(memory.content)`. That embeds key names, braces and quotes —
 *   tokens that carry no marketing meaning but do move the vector — and it makes
 *   the hash change when an unrelated key is added, re-embedding the corpus for
 *   nothing. Worse, key order in JSONB is not guaranteed stable across writes, so
 *   the "same" record could hash differently on different days.
 *
 *   MEANING-PRESERVATION RULES the renderers follow:
 *     · negation and polarity are preserved verbatim — "converts worse than" must
 *       never be flattened toward "converts than", because the contradiction pair
 *       in the retrieval eval differs by exactly one word
 *     · scope qualifiers (segment, channel, market, timeframe) are kept, because
 *       "Search converts worse than Meta" and the same claim "for enterprise
 *       customers" are different claims
 *     · schema noise (ids, foreign keys, timestamps) is excluded
 *     · field order is fixed, so the hash is stable
 *
 * @security renderPlaybookSignal deliberately emits no free text — see
 *   playbookGeneralizer.ts and ADR-066 rule 45.
 * @dependencies types/embedding, node:crypto
 */

import { createHash } from 'crypto';
import type {
  EmbeddingRenderer, RenderedEmbeddingText, EmbeddingSourceType,
} from '../../types/embedding';

/**
 * Deterministic content hash (Step 3.1B §8).
 *
 * The rendering version is hashed ALONGSIDE the text so that changing the
 * renderer invalidates every embedding even where the output text happens to be
 * unchanged. Without that, a renderer fix would leave a mixed corpus in which
 * some vectors came from the old rules and nothing could tell them apart.
 *
 * @param text             Canonical rendered text
 * @param renderingVersion Version of the renderer that produced it
 * @returns                Lowercase hex sha256 (matches the CHECK on content_hash)
 */
export function contentHash(text: string, renderingVersion: number): string {
  return createHash('sha256').update(`${renderingVersion}\n${text}`, 'utf8').digest('hex');
}

/** Collapses whitespace so incidental formatting cannot change the hash. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Joins labelled parts in a FIXED order, dropping empties.
 *
 * Fixed order matters more than it looks: if the order varied with which fields
 * happened to be populated, two records with identical meaning would hash
 * differently and both would be re-embedded forever.
 */
function compose(parts: Array<[string, string | null | undefined]>): string {
  return normalize(
    parts
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([label, v]) => (label ? `${label}: ${String(v).trim()}` : String(v).trim()))
      .join('. '),
  );
}

function build(text: string, renderingVersion: number): RenderedEmbeddingText | null {
  const t = normalize(text);
  // An empty rendering is not embeddable. Returning a hash of "" would create a
  // row that matches every query equally badly.
  if (t.length === 0) return null;
  return { text: t, renderingVersion, contentHash: contentHash(t, renderingVersion) };
}

// ── marketing_memory ─────────────────────────────────────────────────────────

export interface RenderableMemory {
  memory_type: string;
  title: string;
  content: Record<string, unknown> | null;
  source?: string | null;
}

/**
 * Renders a marketing memory.
 *
 * `content.claim` is the natural-language assertion and leads the rendering.
 * Scope qualifiers follow because they change what the claim means. Numeric
 * fields are included as text (a "-34%" delta is meaningful), but ids, hashes
 * and timestamps are not.
 */
export const marketingMemoryRenderer: EmbeddingRenderer<RenderableMemory> = {
  sourceType: 'marketing_memory',
  renderingVersion: 1,
  render(m) {
    const c = m.content ?? {};
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : null);
    const num = (k: string) => (typeof c[k] === 'number' ? String(c[k]) : null);
    const list = (k: string) => (Array.isArray(c[k]) ? (c[k] as unknown[]).join(', ') : null);

    // Metadata alone is not a memory. Without this, a record with an empty title
    // and empty content still renders "Type: campaign" — a vector that matches
    // every campaign memory equally badly and is worse than no vector at all.
    const substantive = normalize(`${m.title ?? ''} ${str('claim') ?? ''}`);
    if (substantive.length === 0) return null;

    return build(compose([
      ['', m.title],
      ['', str('claim')],
      ['Type', m.memory_type],
      // Scope. Omitting these would merge a general rule with its exception.
      ['Segment',   str('segment')],
      ['Channel',   str('channel') ?? list('channels')],
      ['Market',    str('market')],
      ['Timeframe', str('window') ?? str('timeframe')],
      ['Metric',    str('metric')],
      ['Change',    num('delta_pct') ? `${num('delta_pct')}%` : null],
      // Founder decisions: what was rejected is as load-bearing as what was chosen.
      ['Rejected recommendation', str('rejected_recommendation')],
      ['Previous value',          str('previous_value')],
      ['New value',               str('new_value')],
    ]), this.renderingVersion);
  },
};

// ── evidence ─────────────────────────────────────────────────────────────────

export interface RenderableEvidence {
  evidence_type: string;
  source_table?: string | null;
  data: Record<string, unknown> | null;
}

export const evidenceRenderer: EmbeddingRenderer<RenderableEvidence> = {
  sourceType: 'evidence',
  renderingVersion: 1,
  render(e) {
    const d = e.data ?? {};
    // Evidence is mostly numeric. Key names are rendered as words rather than
    // dropped, because for evidence the measure IS the meaning.
    const measures = Object.entries(d)
      .filter(([k, v]) => (typeof v === 'number' || typeof v === 'string') && !/id$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b))       // stable order → stable hash
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
      .join(', ');

    return build(compose([
      ['Evidence', e.evidence_type.replace(/_/g, ' ')],
      ['Observed', measures],
    ]), this.renderingVersion);
  },
};

// ── product ICP ──────────────────────────────────────────────────────────────

export interface RenderableProductIcp {
  name: string;
  category?: string | null;
  confirmed_icp: Record<string, unknown> | null;
}

export const productIcpRenderer: EmbeddingRenderer<RenderableProductIcp> = {
  sourceType: 'product_icp',
  renderingVersion: 1,
  render(p) {
    const icp = p.confirmed_icp ?? {};
    const str = (k: string) => (typeof icp[k] === 'string' ? (icp[k] as string) : null);
    const list = (k: string) => (Array.isArray(icp[k]) ? (icp[k] as unknown[]).join(', ') : null);

    return build(compose([
      ['Product',    p.name],
      ['Category',   p.category],
      ['Audience',   str('audience') ?? str('primary_audience')],
      ['Pain points', list('pain_points')],
      ['Value',      str('value_proposition')],
    ]), this.renderingVersion);
  },
};

export const RENDERERS: Record<string, EmbeddingRenderer<never>> = {
  marketing_memory: marketingMemoryRenderer as EmbeddingRenderer<never>,
  evidence:         evidenceRenderer         as EmbeddingRenderer<never>,
  product_icp:      productIcpRenderer       as EmbeddingRenderer<never>,
};

/** @returns The renderer for a source type, or null when none is defined yet. */
export function rendererFor(sourceType: EmbeddingSourceType): EmbeddingRenderer<never> | null {
  return RENDERERS[sourceType] ?? null;
}
