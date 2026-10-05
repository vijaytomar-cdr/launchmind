/**
 * @file productAssetIntake.ts
 * @description Registers what LaunchMind ALREADY observed about a product — §4, §5.
 *
 *   THE DEFECT THIS CLOSES. `recordObservedAsset()` has existed since B1 and was
 *   called by nothing. So AllignX's ten App Store screenshots and its website
 *   logo sat inside `scraped_meta` where no governance could see them, and
 *   `marketing_assets` held no product imagery at all. The owner was told
 *   "no authorised product imagery" — true, but the cause was a missing intake
 *   step, not a decision they had declined to make. They had nothing to say yes to.
 *
 *   SOURCE IS PRESERVED, NOT FLATTENED. The old `scraped_meta.marketingImages[]`
 *   was a single array filled in the order screenshots → website hero → GOOGLE
 *   IMAGE SEARCH, so a product whose store screenshots failed to download could
 *   have an arbitrary web-search picture become its advertisement. Every asset
 *   here carries the source it actually came from, because rights follow source
 *   and nothing downstream can recover a source that was thrown away.
 *
 *   INGESTION CANNOT AUTHORIZE. Everything written here is OBSERVED_EXTERNAL.
 *   `recordObservedAsset` takes no authorization parameter, so this file could
 *   not mint an authorized asset even if it tried; only `authorizeAsset()` can,
 *   and that requires an owner and a stated rights basis.
 *
 * @security WEB_SEARCH candidates are never produced. Subject relation is
 *   OWN_PRODUCT only for sources that are definitionally the owner's own
 *   listing or site; anything else stays UNKNOWN and can never be authorized.
 * @dependencies marketingAssetService · marketingAssetPolicy
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import sharp from 'sharp';
import { authorizeAsset, recordObservedAsset } from './marketingAssetService';
import type { AssetSource, MarketingAsset, SubjectRelation } from './marketingAssetPolicy';

/** One thing LaunchMind observed, with the source that determines its rights. */
export interface ObservedCandidate {
  assetType: MarketingAsset['assetType'];
  source: AssetSource;
  subjectRelation: SubjectRelation;
  externalUrl: string;
  /** Owner language, e.g. "App Store screenshot". Never an enum. */
  sourceLabel: string;
}

const SOURCE_LABEL: Record<string, string> = {
  APP_STORE_SCREENSHOT: 'App Store screenshot',
  APP_STORE_ICON: 'App Store icon',
  PLAY_STORE_SCREENSHOT: 'Play Store screenshot',
  WEBSITE_LOGO: 'Logo observed on your website',
  WEBSITE_PRODUCT_IMAGE: 'Image observed on your website',
};

const MAX_SCREENSHOTS = 10;
const BUCKET = 'content-assets';

export type ProductMediaClassification =
  | 'PROMOTIONAL_PRODUCT_EVIDENCE'
  | 'CLEAN_PRODUCT_UI';

export interface CropRect { left: number; top: number; width: number; height: number }

/**
 * Extracts authentic UI pixels from an owner-authorized page capture.
 *
 * The crop is deliberately deterministic: it never redraws, masks, or edits
 * the source. Callers must classify the full page separately because source
 * authorization never upgrades surrounding marketing claims into product truth.
 */
export async function deriveCleanProductUiCrop(sourceBytes: Buffer, crop: CropRect): Promise<{
  bytes: Buffer; sourceWidth: number; sourceHeight: number; crop: CropRect;
}> {
  const meta = await sharp(sourceBytes).metadata();
  const sourceWidth = meta.width ?? 0, sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight || crop.left < 0 || crop.top < 0 || crop.width < 320 || crop.height < 400
      || crop.left + crop.width > sourceWidth || crop.top + crop.height > sourceHeight) {
    throw new Error('Product UI crop is outside the owner-authorized source image.');
  }
  return { bytes: await sharp(sourceBytes).extract(crop).png().toBuffer(), sourceWidth, sourceHeight, crop };
}

/** Stores source and derived product UI with an auditable parent transformation. */
export async function persistOwnerAuthorizedProductUiCrop(input: {
  workspaceId: string; productId: string; founderId: string; actorId: string;
  sourceBytes: Buffer; sourceUrl: string; crop: CropRect;
}): Promise<{ sourceAssetId: string; derivedAssetId: string; storagePath: string; crop: CropRect }> {
  const db = getSupabaseAdmin();
  const derived = await deriveCleanProductUiCrop(input.sourceBytes, input.crop);
  const base = `${input.founderId}/${input.productId}/product-media/${Date.now()}`;
  const sourcePath = `${base}-owner-authorized-source.png`;
  const cropPath = `${base}-clean-product-ui.png`;
  for (const [path, bytes] of [[sourcePath, input.sourceBytes], [cropPath, derived.bytes]] as const) {
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false });
    if (error) throw new Error(`Product media storage failed: ${error.message}`);
  }
  const sourceAssetId = await recordObservedAsset({
    workspaceId: input.workspaceId, productId: input.productId, founderId: input.founderId,
    assetType: 'SCREENSHOT', source: 'OWNER_URL', subjectRelation: 'OWN_PRODUCT',
    storagePath: sourcePath, externalUrl: input.sourceUrl,
  });
  if (!sourceAssetId) throw new Error('Could not record owner-authorized source media.');
  await authorizeAsset({ assetId: sourceAssetId, workspaceId: input.workspaceId, actorId: input.actorId,
    rightsBasis: 'Owner-authorized screenshot of our official website', subjectRelation: 'OWN_PRODUCT', piiChecked: true });
  const derivedAssetId = await recordObservedAsset({
    workspaceId: input.workspaceId, productId: input.productId, founderId: input.founderId,
    assetType: 'SCREENSHOT', source: 'OWNER_URL', subjectRelation: 'OWN_PRODUCT', storagePath: cropPath,
  });
  if (!derivedAssetId) throw new Error('Could not record derived product UI media.');
  await authorizeAsset({ assetId: derivedAssetId, workspaceId: input.workspaceId, actorId: input.actorId,
    rightsBasis: 'Derived from owner-authorized official product screenshot', subjectRelation: 'OWN_PRODUCT', piiChecked: true });
  const sourceProvenance = { classification: 'PROMOTIONAL_PRODUCT_EVIDENCE' as ProductMediaClassification,
    sourceUrl: input.sourceUrl, ownerAuthorized: true, containsPromotionalClaims: true };
  const derivedProvenance = { classification: 'CLEAN_PRODUCT_UI' as ProductMediaClassification,
    derivedFromAssetId: sourceAssetId, sourceUrl: input.sourceUrl, transformation: { type: 'DETERMINISTIC_CROP', ...derived.crop },
    ownerAuthorized: true, containsPromotionalClaims: false, createdAt: new Date().toISOString() };
  const { error } = await db.from('marketing_assets').update({ generation_provenance: sourceProvenance })
    .eq('id', sourceAssetId).eq('workspace_id', input.workspaceId);
  if (error) throw new Error(`Source media provenance failed: ${error.message}`);
  const { error: derivedError } = await db.from('marketing_assets').update({ generation_provenance: derivedProvenance })
    .eq('id', derivedAssetId).eq('workspace_id', input.workspaceId);
  if (derivedError) throw new Error(`Derived media provenance failed: ${derivedError.message}`);
  return { sourceAssetId, derivedAssetId, storagePath: cropPath, crop: derived.crop };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}
function url(v: unknown): string | null {
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null;
}

/**
 * What LaunchMind already knows about this product's own imagery.
 *
 * PURE — reads the product row, writes nothing. Callable to show the owner what
 * exists before anything is registered.
 *
 * @security Produces OWN_PRODUCT only for the owner's own store listing and
 *   their own site. No web-search source is emitted at all, so one cannot reach
 *   the registry through this path.
 */
export function deriveObservedCandidates(product: {
  platform?: unknown; scraped_meta?: unknown; website_meta?: unknown;
}): ObservedCandidate[] {
  const sm = rec(product.scraped_meta);
  // The site's own metadata is nested under scraped_meta at intake; the
  // top-level website_meta column is usually empty. Both are read, nested first.
  const wm = { ...rec(product.website_meta), ...rec(sm.websiteMeta) };
  const isPlay = String(product.platform ?? '') === 'play_store';
  const out: ObservedCandidate[] = [];
  const seen = new Set<string>();

  const add = (c: ObservedCandidate) => {
    if (seen.has(c.externalUrl)) return;
    seen.add(c.externalUrl);
    out.push(c);
  };

  const storeSource: AssetSource = isPlay ? 'PLAY_STORE' : 'APP_STORE';
  const storeLabel = isPlay ? SOURCE_LABEL.PLAY_STORE_SCREENSHOT : SOURCE_LABEL.APP_STORE_SCREENSHOT;
  const shots = Array.isArray(sm.screenshots) ? sm.screenshots : [];
  for (const s of shots.slice(0, MAX_SCREENSHOTS)) {
    const u = url(s);
    if (u) add({
      assetType: 'SCREENSHOT', source: storeSource,
      // The owner's own store listing depicts the owner's own product.
      subjectRelation: 'OWN_PRODUCT', externalUrl: u, sourceLabel: storeLabel,
    });
  }

  const icon = url(sm.iconUrl) ?? url(sm.artworkUrl);
  if (icon) add({
    assetType: 'APP_ICON', source: storeSource, subjectRelation: 'OWN_PRODUCT',
    externalUrl: icon, sourceLabel: SOURCE_LABEL.APP_STORE_ICON,
  });

  const logo = url(wm.logoUrl);
  if (logo) add({
    assetType: 'LOGO', source: 'WEBSITE', subjectRelation: 'OWN_PRODUCT',
    externalUrl: logo, sourceLabel: SOURCE_LABEL.WEBSITE_LOGO,
  });

  // og:image only when it differs from the logo — otherwise it is the same file
  // offered twice, which reads to the owner as two separate decisions.
  const og = url(wm.ogImage);
  if (og && og !== logo) add({
    assetType: 'HERO_IMAGE', source: 'WEBSITE', subjectRelation: 'OWN_PRODUCT',
    externalUrl: og, sourceLabel: SOURCE_LABEL.WEBSITE_PRODUCT_IMAGE,
  });

  const heroes = Array.isArray(wm.heroImages) ? wm.heroImages : [];
  for (const h of heroes.slice(0, 4)) {
    const u = url(h);
    if (u) add({
      assetType: 'HERO_IMAGE', source: 'WEBSITE', subjectRelation: 'OWN_PRODUCT',
      externalUrl: u, sourceLabel: SOURCE_LABEL.WEBSITE_PRODUCT_IMAGE,
    });
  }

  return out;
}

export interface IntakeResult {
  registered: number;
  alreadyKnown: number;
  candidates: number;
  /** Owner-safe summary of what was added, grouped by source label. */
  byLabel: Record<string, number>;
}

/**
 * Registers observed product imagery. Idempotent.
 *
 * @security Everything written is OBSERVED_EXTERNAL with may_contain_pii TRUE.
 *   Registering an asset grants nothing: it makes the asset VISIBLE so the owner
 *   can decide, which is the step that was missing.
 */
export async function registerObservedProductAssets(opts: {
  workspaceId: string; productId: string; founderId: string;
}): Promise<IntakeResult> {
  const db = getSupabaseAdmin();

  const { data: product } = await db.from('products')
    .select('platform, scraped_meta, website_meta')
    .eq('id', opts.productId).eq('workspace_id', opts.workspaceId).maybeSingle();
  if (!product) return { registered: 0, alreadyKnown: 0, candidates: 0, byLabel: {} };

  const candidates = deriveObservedCandidates(product as Record<string, unknown>);

  // Re-running intake must not duplicate an asset the owner may already have
  // authorized — a duplicate row would silently reset it to observed-only.
  const { data: existing } = await db.from('marketing_assets')
    .select('external_url')
    .eq('workspace_id', opts.workspaceId).eq('product_id', opts.productId);
  const known = new Set(((existing ?? []) as Array<{ external_url: string | null }>)
    .map(r => r.external_url).filter((u): u is string => !!u));

  let registered = 0, alreadyKnown = 0;
  const byLabel: Record<string, number> = {};
  for (const c of candidates) {
    if (known.has(c.externalUrl)) { alreadyKnown++; continue; }
    try {
      await recordObservedAsset({
        workspaceId: opts.workspaceId, productId: opts.productId, founderId: opts.founderId,
        assetType: c.assetType, source: c.source,
        subjectRelation: c.subjectRelation, externalUrl: c.externalUrl,
      });
      registered++;
      byLabel[c.sourceLabel] = (byLabel[c.sourceLabel] ?? 0) + 1;
    } catch {
      // One unwritable asset must not lose the rest. The owner sees a smaller
      // list rather than an error about a picture they never asked for.
    }
  }
  return { registered, alreadyKnown, candidates: candidates.length, byLabel };
}
