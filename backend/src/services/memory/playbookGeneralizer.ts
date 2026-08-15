/**
 * @file playbookGeneralizer.ts
 * @description Generalized, non-identifying rendering for cross-founder playbook
 *   signals — the only representation that may ever be embedded (ADR-066 rule 45).
 *
 *   Phase 3.1B: contract + generalizer ONLY. No signal is embedded here.
 *
 *   WHY THIS EXISTS. `playbook_signals` is already anonymised at the row level:
 *   it carries no founder_id or product_id, and ADR-053 requires a minimum
 *   cohort of three before a benchmark is published. That is sufficient for
 *   aggregate reporting and NOT sufficient for embeddings. An embedding of a
 *   distinctive sentence is a fingerprint: with nearest-neighbour search, anyone
 *   holding the original phrasing can confirm its presence in the corpus, and a
 *   sufficiently unusual phrase identifies the founder who wrote it. Aggregate
 *   anonymity does not survive similarity search over free text.
 *
 *   THE APPROACH IS ALLOW-LIST, NOT REDACTION. A redaction pass ("strip names,
 *   strip company") fails on exactly the cases that matter — an unusual product
 *   category, a distinctive metric combination, an idiosyncratic turn of phrase.
 *   So no free text survives at all: the generalizer emits ONLY values drawn
 *   from closed vocabularies plus numbers bucketed into ranges. If a field is
 *   not on the allow-list it cannot reach the output, which means a future
 *   column addition is safe by default rather than dangerous by default.
 *
 *   Numbers are BUCKETED rather than exact. An exact "install_delta_pct = 41.7"
 *   is close to a unique key when combined with category and market; "+25-50%"
 *   preserves the reusable lesson and not the fingerprint.
 *
 * @security This module is the boundary between per-founder data and the shared
 *   corpus. Anything it emits may be embedded into a store readable by every
 *   tenant through the global policy in migration 089.
 * @dependencies types/embedding
 */

import type { EmbeddingRenderer, RenderedEmbeddingText } from '../../types/embedding';
import { contentHash } from './embeddingRenderer';

/** Closed vocabularies. A value outside these makes the signal ineligible. */
const ALLOWED_MARKETS  = new Set(['usa', 'india']);
const ALLOWED_CHANNELS = new Set([
  'meta', 'google', 'google_ads', 'whatsapp', 'linkedin', 'email',
  'aso_rewrite', 'app_store', 'search_console', 'organic',
]);
const ALLOWED_PRICE_TIERS = new Set(['free', 'freemium', 'low', 'mid', 'high', 'subscription']);

/**
 * Category is the one field with an open-ended source, so it is normalised and
 * length-capped. A category long enough to be a sentence is a description, not a
 * category, and descriptions are what this module exists to exclude.
 */
const MAX_CATEGORY_LEN = 40;

export interface RenderablePlaybookSignal {
  category: string | null;
  market: string | null;
  channel: string | null;
  hook_type: string | null;
  price_tier: string | null;
  install_delta_pct: number | null;
  conversion_rate: number | null;
  retention_d7: number | null;
}

export interface GeneralizationResult {
  eligible: boolean;
  /** Present only when eligible. */
  rendered: RenderedEmbeddingText | null;
  /** Why it was refused — surfaced so ineligibility is explainable, not silent. */
  reason?: string;
}

export const GENERALIZATION_VERSION = 1;

/** Buckets a percentage delta into a reusable band. */
function bucketDelta(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const a = Math.abs(pct);
  const dir = pct >= 0 ? 'increase' : 'decrease';
  if (a < 5)   return `negligible ${dir}`;
  if (a < 15)  return `small ${dir} (5-15%)`;
  if (a < 25)  return `moderate ${dir} (15-25%)`;
  if (a < 50)  return `large ${dir} (25-50%)`;
  return `very large ${dir} (50%+)`;
}

/** Buckets a 0..1 rate. */
function bucketRate(rate: number | null, label: string): string | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const p = rate <= 1 ? rate * 100 : rate;
  if (p < 1)  return `${label} under 1%`;
  if (p < 3)  return `${label} 1-3%`;
  if (p < 6)  return `${label} 3-6%`;
  if (p < 12) return `${label} 6-12%`;
  return `${label} above 12%`;
}

/** Lowercased, punctuation-stripped, length-capped. */
function normalizeCategory(c: string | null): string | null {
  if (!c) return null;
  const n = c.toLowerCase().replace(/[^a-z0-9 &-]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length === 0 || n.length > MAX_CATEGORY_LEN) return null;
  return n;
}

/**
 * Produces the generalized rendering, or refuses.
 *
 * Refusal is a normal outcome, not an error: a signal that cannot be generalized
 * is marked `ineligible` and simply never contributes to the shared corpus. The
 * cost is slightly weaker cross-founder benchmarks; the alternative cost is a
 * re-identifiable embedding, which is not a trade LaunchMind should make.
 */
export function generalizePlaybookSignal(s: RenderablePlaybookSignal): GeneralizationResult {
  const category = normalizeCategory(s.category);
  if (!category) {
    return { eligible: false, rendered: null,
      reason: 'category missing, or too long/specific to be a safe generalization' };
  }

  const market = (s.market ?? '').toLowerCase();
  if (!ALLOWED_MARKETS.has(market)) {
    return { eligible: false, rendered: null, reason: `market "${s.market}" is not in the closed vocabulary` };
  }

  const channel = (s.channel ?? '').toLowerCase();
  if (!ALLOWED_CHANNELS.has(channel)) {
    return { eligible: false, rendered: null, reason: `channel "${s.channel}" is not in the closed vocabulary` };
  }

  // hook_type and price_tier are optional; an unrecognised value is DROPPED
  // rather than making the whole signal ineligible, because neither is required
  // for the lesson to be reusable.
  const priceTier = ALLOWED_PRICE_TIERS.has((s.price_tier ?? '').toLowerCase())
    ? (s.price_tier as string).toLowerCase() : null;
  const hookType = s.hook_type && /^[a-z_]{1,24}$/i.test(s.hook_type)
    ? s.hook_type.toLowerCase() : null;

  const outcomes = [
    bucketDelta(s.install_delta_pct) ? `installs ${bucketDelta(s.install_delta_pct)}` : null,
    bucketRate(s.conversion_rate, 'conversion'),
    bucketRate(s.retention_d7, 'day-7 retention'),
  ].filter(Boolean);

  if (outcomes.length === 0) {
    return { eligible: false, rendered: null, reason: 'no measurable outcome to generalize' };
  }

  // Fixed order → stable hash.
  const text = [
    `Category ${category}`,
    `market ${market}`,
    `channel ${channel}`,
    hookType  ? `hook ${hookType}` : null,
    priceTier ? `price tier ${priceTier}` : null,
    `outcome ${outcomes.join(', ')}`,
  ].filter(Boolean).join('. ');

  return {
    eligible: true,
    rendered: { text, renderingVersion: GENERALIZATION_VERSION, contentHash: contentHash(text, GENERALIZATION_VERSION) },
  };
}

export const playbookSignalRenderer: EmbeddingRenderer<RenderablePlaybookSignal> = {
  sourceType: 'playbook_signal',
  renderingVersion: GENERALIZATION_VERSION,
  render(s) {
    return generalizePlaybookSignal(s).rendered;
  },
};
