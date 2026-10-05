/**
 * @file subjectResolver.ts
 * @description Which store entities is THIS product allowed to see evidence about?
 *
 *   This is the gate that makes "wrong entity" and "wrong product" unreachable
 *   rather than merely tested. It answers one question: for a given product,
 *   which `subject_key`s are its own listing, and which are competitors the
 *   OWNER CONFIRMED.
 *
 *   THE AWKWARD SHAPE, AND WHY IT IS RESPECTED RATHER THAN ROUTED AROUND:
 *   `competitor_relationships` records the owner's CONFIRMATION but holds only a
 *   name — no store URL. `products.competitor_set` holds the store URLs but is
 *   scraper output the owner never approved. Neither alone is sufficient:
 *   the first cannot be resolved to an entity, and the second is not consent.
 *
 *   So a competitor becomes a subject only where BOTH agree — the owner
 *   confirmed the name AND a store URL exists for it. A scraped competitor the
 *   owner never confirmed contributes nothing, and a confirmed competitor with
 *   no store URL contributes nothing. Both silences are correct.
 *
 * @security Returns ONLY subject keys derived from this product's own rows. A
 *   caller cannot widen the set, because the set is not an input.
 * @dependencies products, competitor_relationships, contract (pure)
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { providerIdFromStoreUrl, storeSubjectKey } from './contract';

export interface ProductSubjects {
  /** The product's own store listing, when it has a resolvable one. */
  ownSubjectKey: string | null;
  /** Entities the owner explicitly confirmed as competitors. */
  confirmedCompetitorSubjectKeys: string[];
  /** Everything above, for the read. */
  allSubjectKeys: string[];
  /** Owner-facing names, for labels. Never used for identity. */
  labels: Record<string, string>;
  /** Why competitors were dropped — surfaced so silence is explicable. */
  skipped: Array<{ name: string; reason: 'NOT_CONFIRMED' | 'NO_STORE_URL' | 'UNSUPPORTED_URL' }>;
}

const EMPTY: ProductSubjects = {
  ownSubjectKey: null, confirmedCompetitorSubjectKeys: [], allSubjectKeys: [],
  labels: {}, skipped: [],
};

/** Turns a store URL into a subject key, or null when it is not a listing URL. */
export function subjectKeyFromStoreUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = providerIdFromStoreUrl(url);
  if (!id) return null;
  try {
    return storeSubjectKey(id.provider, id.storefront, id.providerId);
  } catch {
    return null;
  }
}

/**
 * Resolves the store entities in scope for one product.
 *
 * @param productId - the product being reasoned about
 * @returns its own subject plus owner-confirmed competitor subjects
 * @security Reads are keyed by product_id, so another business's competitors
 *   are not merely filtered out — they are never selected.
 */
export async function resolveProductSubjects(
  productId: string | null,
): Promise<ProductSubjects> {
  if (!productId) return EMPTY;
  const db = getSupabaseAdmin();

  const [prodRes, confirmedRes] = await Promise.all([
    db.from('products').select('name, store_url, competitor_set').eq('id', productId).maybeSingle(),
    db.from('competitor_relationships').select('name, relationship')
      .eq('product_id', productId).eq('relationship', 'CONFIRMED'),
  ]);

  const product = (prodRes as { data?: Record<string, unknown> | null }).data ?? null;
  if (!product) return EMPTY;

  const labels: Record<string, string> = {};
  const skipped: ProductSubjects['skipped'] = [];

  const ownSubjectKey = subjectKeyFromStoreUrl(product.store_url as string | null);
  if (ownSubjectKey) labels[ownSubjectKey] = (product.name as string) ?? 'Your product';

  // The owner's confirmed names, normalised for comparison only.
  const confirmed = new Map<string, string>();
  for (const row of ((confirmedRes as { data?: Array<{ name?: string }> }).data ?? [])) {
    if (typeof row.name === 'string' && row.name.trim()) {
      confirmed.set(row.name.trim().toLowerCase(), row.name.trim());
    }
  }

  // Store URLs live on the scraped set. Only entries the owner confirmed are used.
  const raw = product.competitor_set;
  const scraped = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
  const seenNames = new Set<string>();

  const competitorKeys: string[] = [];
  for (const c of scraped) {
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    seenNames.add(key);
    if (!confirmed.has(key)) { skipped.push({ name, reason: 'NOT_CONFIRMED' }); continue; }

    const url = typeof c.storeUrl === 'string' ? c.storeUrl : null;
    if (!url) { skipped.push({ name, reason: 'NO_STORE_URL' }); continue; }

    const subject = subjectKeyFromStoreUrl(url);
    if (!subject) { skipped.push({ name, reason: 'UNSUPPORTED_URL' }); continue; }

    if (!competitorKeys.includes(subject)) competitorKeys.push(subject);
    labels[subject] = name;
  }

  // Confirmed by the owner but absent from the scraped set: no way to identify
  // the entity, so no evidence. Recorded so the gap is visible rather than
  // looking like "this competitor has no market signal".
  for (const [key, name] of confirmed) {
    if (!seenNames.has(key)) skipped.push({ name, reason: 'NO_STORE_URL' });
  }

  const all = [...(ownSubjectKey ? [ownSubjectKey] : []), ...competitorKeys];
  return {
    ownSubjectKey,
    confirmedCompetitorSubjectKeys: competitorKeys,
    allSubjectKeys: all,
    labels,
    skipped,
  };
}
