/**
 * @file assetCanonicalization.ts
 * @description One review decision per unique visual — §3, §4.
 *
 *   THE DEFECT. The Product Media review showed every App Store screenshot
 *   twice. They are NOT duplicate bytes — measured, every one of the 11 observed
 *   assets has a distinct sha256 — so a content-hash check finds nothing. They
 *   are the same Apple screenshot delivered in two renditions:
 *
 *       .../1.png/300x650bb.webp        16,466 B   300x649
 *       .../1.png/300x650bb-60.jpg      31,359 B   300x649
 *
 *   Apple's CDN encodes the RENDITION in the last path segment and the SOURCE in
 *   the segment before it. Intake stored both, so the owner was asked to make the
 *   same rights decision twice about the same picture.
 *
 *   THREE LAYERS, IN THIS ORDER, because each catches what the previous cannot:
 *
 *     1. EXACT CONTENT HASH   identical bytes, whatever the URL
 *     2. SOURCE IDENTITY      same origin image, different rendition
 *     3. never anything looser — no perceptual matching. Two genuinely different
 *        screenshots of similar screens must stay separate, and a fuzzy match
 *        that merged them would silently drop one from the owner's choices.
 *
 *   NOTHING IS DELETED. Every source row is preserved for provenance; the owner
 *   simply reviews one representative per group.
 *
 * @security Authorization is UNIONED across a group, never invented: if the
 *   owner allowed any member, the group reads as allowed, because they allowed
 *   that picture. Grouping is only ever by proven identity, so this can never
 *   extend a decision to an image they did not see.
 * @dependencies marketingAssetPolicy (types only)
 */

import { createHash } from 'crypto';
import type { MarketingAsset } from './marketingAssetPolicy';

/**
 * Apple/Google CDN rendition suffixes.
 *
 * `.../<source>.png/300x650bb.webp` and `.../<source>.png/300x650bb-60.jpg` are
 * the SAME source at different encodings. The source segment is what identifies
 * the picture; the last segment is a delivery detail.
 */
// Linear: fixed alternations, no nested quantifier. This runs on provider URLs,
// and a backtracking pattern here would be a denial-of-service surface.
const RENDITION_TAIL = /\/\d+x\d+[a-z]*-?\d*\.(?:webp|jpeg|jpg|png)$/i;

/** Normalised identity of the underlying image, independent of rendition. */
export function sourceIdentity(url: string | null | undefined): string | null {
  const u = String(url ?? '').trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    // Drop the rendition segment when present; otherwise use the whole path.
    const path = parsed.pathname.replace(RENDITION_TAIL, '');
    return `${parsed.host}${path}`.toLowerCase();
  } catch { return u.toLowerCase(); }
}

export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface CanonicalGroup {
  /** The asset the owner reviews. Highest-quality member of the group. */
  canonical: MarketingAsset;
  /** Every source row, preserved. Includes the canonical one. */
  members: MarketingAsset[];
  /** True when ANY member is authorized — the owner allowed this picture. */
  anyAuthorized: boolean;
  /** How the group was proven to be one picture. */
  groupedBy: 'CONTENT_HASH' | 'SOURCE_IDENTITY' | 'UNIQUE';
}

/**
 * Which representation should the owner see and authorize?
 *
 * Larger pixels first, then larger bytes at equal size. A 44x48 thumbnail and a
 * 300x649 screenshot are the same picture; only one of them is usable creative.
 */
function betterOf(a: MarketingAsset & Sized, b: MarketingAsset & Sized): MarketingAsset & Sized {
  const areaA = (a.widthPx ?? 0) * (a.heightPx ?? 0);
  const areaB = (b.widthPx ?? 0) * (b.heightPx ?? 0);
  if (areaA !== areaB) return areaA > areaB ? a : b;
  return (a.byteSize ?? 0) >= (b.byteSize ?? 0) ? a : b;
}

/** Measurements the caller supplies alongside each asset. */
export interface Sized {
  widthPx?: number | null;
  heightPx?: number | null;
  byteSize?: number | null;
  /** sha256 of the bytes, when the caller has fetched them. */
  sha256?: string | null;
}

/**
 * Groups assets so the owner reviews each unique visual once.
 *
 * @security Grouping is by PROVEN identity only — identical bytes, or the same
 *   source image at a different rendition. Two different screenshots never merge,
 *   so an authorization can never silently extend to a picture the owner did not
 *   look at.
 */
export function canonicalizeAssets<T extends MarketingAsset & Sized>(
  assets: readonly T[],
): CanonicalGroup[] {
  const groups = new Map<string, { key: string; how: CanonicalGroup['groupedBy']; items: T[] }>();

  for (const a of assets) {
    // Identical bytes are the same picture, whatever the URL says.
    const byHash = a.sha256 ? `h:${a.sha256}` : null;
    const bySource = sourceIdentity(a.externalUrl ?? a.storagePath);
    const key = byHash ?? (bySource ? `s:${bySource}` : `id:${a.id}`);
    const how: CanonicalGroup['groupedBy'] =
      byHash ? 'CONTENT_HASH' : bySource ? 'SOURCE_IDENTITY' : 'UNIQUE';
    const g = groups.get(key) ?? { key, how, items: [] };
    g.items.push(a);
    groups.set(key, g);
  }

  // A hash group and a source group can describe the same picture. Merge the
  // hash groups into their source groups so the owner still sees it once.
  const bySourceKey = new Map<string, string[]>();
  for (const [key, g] of groups) {
    const src = sourceIdentity(g.items[0].externalUrl ?? g.items[0].storagePath);
    if (!src) continue;
    const list = bySourceKey.get(src) ?? [];
    list.push(key);
    bySourceKey.set(src, list);
  }
  for (const keys of bySourceKey.values()) {
    if (keys.length < 2) continue;
    const [keep, ...rest] = keys;
    const target = groups.get(keep)!;
    for (const k of rest) {
      target.items.push(...groups.get(k)!.items);
      groups.delete(k);
    }
    target.how = 'SOURCE_IDENTITY';
  }

  return [...groups.values()].map(g => {
    const canonical = g.items.reduce((best, cur) => betterOf(best, cur) as T);
    return {
      canonical,
      members: g.items,
      // UNIONED, never invented: any member allowed means the owner allowed
      // this picture, and the rendition they clicked is not a separate decision.
      anyAuthorized: g.items.some(m => m.authorizationState === 'AUTHORIZED_MARKETING'),
      groupedBy: g.items.length > 1 ? g.how : 'UNIQUE',
    };
  });
}
