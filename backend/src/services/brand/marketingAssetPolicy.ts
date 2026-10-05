/**
 * @file marketingAssetPolicy.ts
 * @description Asset rights eligibility — ADR-071 §18, Phase 3.5B1.
 *
 *   THE MEASURED DEFECT THIS EXISTS TO CLOSE. `collectMarketingImages`
 *   downloads App Store screenshots, website hero imagery and **Google Custom
 *   Search image results** into Storage as `scraped_meta.marketingImages`, and
 *   `generateImageFromBrief` uses `marketingImages[0]` DIRECTLY as advertising
 *   creative when style='mockup'. The array is ordered screenshots → hero →
 *   web-search, so a product whose store screenshots failed to download can have
 *   an arbitrary image found by web search become its advertisement.
 *
 *   Three things were being conflated, and this module separates them:
 *
 *     OBSERVATION    we fetched it
 *     OWNERSHIP      whose product it depicts
 *     AUTHORIZATION  the owner may publish it as their marketing
 *
 *   Downloading is observation. Storing it in LaunchMind's bucket is still
 *   observation. Only an owner assertion is authorization.
 *
 * @security PURE, and deliberately so: the database CHECKs in migration 116 and
 *   this function must agree, and a rule that exists only in SQL cannot be
 *   unit-tested against the resolver that consumes it.
 * @dependencies none (pure)
 */

export const ASSET_PURPOSES = [
  /** Showing the owner their own product inside LaunchMind. */
  'PRODUCT_CONTEXT_DISPLAY',
  /** Text/creative generation that will become owner marketing. */
  'CONTENT_CREATION',
  /** Compositing into a rendered image or video. */
  'VISUAL_RENDERING',
] as const;
export type AssetPurpose = typeof ASSET_PURPOSES[number];

export type AuthorizationState = 'OBSERVED_EXTERNAL' | 'AUTHORIZED_MARKETING';
export type AssetSource =
  | 'APP_STORE' | 'PLAY_STORE' | 'WEBSITE' | 'WEB_SEARCH'
  | 'OWNER_UPLOAD' | 'OWNER_URL' | 'GENERATED';
export type SubjectRelation = 'OWN_PRODUCT' | 'COMPETITOR' | 'THIRD_PARTY' | 'UNKNOWN';

export interface MarketingAsset {
  id: string;
  workspaceId: string;
  productId: string;
  assetType: string;
  source: AssetSource;
  subjectRelation: SubjectRelation;
  authorizationState: AuthorizationState;
  storagePath?: string | null;
  externalUrl?: string | null;
  rightsBasis?: string | null;
  mayContainPii?: boolean;
  archivedAt?: string | null;
}

export type IneligibleReason =
  | 'ARCHIVED'
  | 'NOT_AUTHORIZED_FOR_MARKETING'
  | 'SUBJECT_IS_NOT_OWN_PRODUCT'
  | 'SOURCE_CANNOT_CONFER_RIGHTS'
  | 'MAY_CONTAIN_PERSONAL_DATA';

export interface EligibilityVerdict {
  eligible: boolean;
  reason?: IneligibleReason;
}

/** Sources that can never confer marketing-use rights, whatever else is true. */
const RIGHTS_IMPOSSIBLE_SOURCES: ReadonlySet<AssetSource> = new Set(['WEB_SEARCH']);

/**
 * May this asset be used for this purpose?
 *
 * @security Fails toward refusal. Every unknown — unknown subject, unknown
 *   rights, unexamined contents — is a refusal for creative purposes, because
 *   the cost of wrongly refusing is a missing image and the cost of wrongly
 *   allowing is publishing someone else's property as the owner's advertisement.
 */
export function isEligibleForPurpose(
  asset: MarketingAsset, purpose: AssetPurpose,
): EligibilityVerdict {
  if (asset.archivedAt) return { eligible: false, reason: 'ARCHIVED' };

  // Displaying the owner's own product context inside LaunchMind is not
  // publishing. An observed store screenshot is exactly the right thing to show
  // when telling an owner "this is the app I am marketing".
  if (purpose === 'PRODUCT_CONTEXT_DISPLAY') return { eligible: true };

  if (RIGHTS_IMPOSSIBLE_SOURCES.has(asset.source)) {
    return { eligible: false, reason: 'SOURCE_CANNOT_CONFER_RIGHTS' };
  }
  if (asset.subjectRelation !== 'OWN_PRODUCT') {
    return { eligible: false, reason: 'SUBJECT_IS_NOT_OWN_PRODUCT' };
  }
  if (asset.authorizationState !== 'AUTHORIZED_MARKETING') {
    return { eligible: false, reason: 'NOT_AUTHORIZED_FOR_MARKETING' };
  }
  // Rendering composites the image into published creative, so an unexamined
  // image is refused there even when it is otherwise authorized. Text
  // generation only REFERENCES it, so the bar is authorization alone.
  if (purpose === 'VISUAL_RENDERING' && asset.mayContainPii !== false) {
    return { eligible: false, reason: 'MAY_CONTAIN_PERSONAL_DATA' };
  }
  return { eligible: true };
}

/** Owner-safe explanation. Never an id, path or internal enum. */
export function ineligibilityLabel(reason: IneligibleReason): string {
  switch (reason) {
    case 'ARCHIVED':                     return 'This asset was archived.';
    case 'NOT_AUTHORIZED_FOR_MARKETING': return 'You have not authorised this image for marketing use.';
    case 'SUBJECT_IS_NOT_OWN_PRODUCT':   return 'This image is not of your product.';
    case 'SOURCE_CANNOT_CONFER_RIGHTS':  return 'This image was found on the web, so it cannot be used in your marketing.';
    case 'MAY_CONTAIN_PERSONAL_DATA':    return 'This image has not been checked for personal information.';
  }
}
