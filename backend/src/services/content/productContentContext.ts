/**
 * @file productContentContext.ts
 * @description THE canonical product+brand context for content — ADR-071 §4.
 *
 *   Composition, not a new store. Application, founder direction, intelligence,
 *   evidence and Marketing Memory already resolve through ContextPackageV2 under
 *   the CONTENT_GENERATION intent; brand and authorised assets are the two arms
 *   that did not exist. This module joins them and is the single thing content
 *   generation asks.
 *
 *   WHY NOT A TABLE: every field here has a governed owner elsewhere. A
 *   persisted copy would be a second source of truth that drifts, and the
 *   drifting copy is always the one someone reads.
 *
 * @security Scope is derived from a VERIFIED workspace, and both the package and
 *   the brand kit are queried with workspace AND product predicates. A product
 *   from another workspace resolves to nothing rather than to another business's
 *   brand — asserted by test, not assumed.
 * @dependencies contextPackageV2, brandKitService, marketingAssetService,
 *   growthBrainOutputGrounding
 */

import {loadSignalFoundation,type SignalFoundation} from '../opportunity/signalFoundation';
import type { ContextPackageV2 } from '../../lib/context/contextPackageV2';
import { resolveBrandKit, prohibitedTermsOf, brandProvenanceLines, type BrandKit } from '../brand/brandKitService';
import { resolveMarketingAssets } from '../brand/marketingAssetService';
import type { MarketingAsset } from '../brand/marketingAssetPolicy';
import { issueEvidenceHandles, type EvidenceHandle } from '../growthBrainOutputGrounding';

export interface ProductContentContext {
  signalFoundation?: SignalFoundation;
  offerings?: Array<{ id: string; name: string; source: 'OWNER_CONFIRMED' | 'PRODUCT_CONTEXT' }>;
  workspaceId: string;
  productId: string;
  /** Owner-safe application facts. */
  application: {
    name: string | null;
    category: string | null;
    markets: string[];
    description: string | null;
  };
  brand: BrandKit;
  /** Deterministic constraint, enforced after generation — never only in a prompt. */
  prohibitedTerms: string[];
  founderDirection: {
    audienceConfirmed: string | null;
    contextDelta: string | null;
    primaryGoal: string | null;
    competitors: string[];
  };
  /** The ONLY evidence a claim may be grounded against. */
  evidence: EvidenceHandle[];
  /** Authorised for creative use. Observed-only assets are absent by construction. */
  authorizedAssets: MarketingAsset[];
  /** Present for display/reasoning; NEVER creative input. */
  observedAssetCount: number;
  marketIntelligenceAvailable: boolean;
  /** Owner-safe lines: "logo — you confirmed this". */
  brandProvenance: string[];
  /** What is missing, so callers degrade honestly instead of inventing. */
  unavailable: string[];
}

/**
 * Assembles the content context for one product.
 *
 * @param pkg a ContextPackageV2 already built for THIS workspace+product
 * @security The package carries its own scope; this function does not accept a
 *   separate workspace argument, so the two cannot disagree.
 */
export async function buildProductContentContext(
  pkg: ContextPackageV2,
  planningFoundation?: SignalFoundation,
): Promise<ProductContentContext> {
  const workspaceId = pkg.workspaceId;
  const productId = pkg.productId;
  if (!productId) throw new Error('PRODUCT_CONTEXT_REQUIRES_PRODUCT');

  const [brand, authorizedAssets, allDisplayable] = await Promise.all([
    resolveBrandKit(workspaceId, productId),
    resolveMarketingAssets(workspaceId, productId, 'CONTENT_CREATION').catch(() => []),
    resolveMarketingAssets(workspaceId, productId, 'PRODUCT_CONTEXT_DISPLAY').catch(() => []),
  ]);

  const evidence = issueEvidenceHandles(pkg);
  const unavailable: string[] = [];
  if (brand.missing.includes('logo')) unavailable.push('no logo is on file');
  if (!brand.fields.primary_color) unavailable.push('brand colours are not confirmed');
  if (authorizedAssets.length === 0) unavailable.push('no authorised product imagery');
  if (evidence.length === 0) unavailable.push('no evidence LaunchMind can cite');

  const signalFoundation = planningFoundation ?? await loadSignalFoundation(workspaceId, productId);
  return {
    signalFoundation,
    workspaceId, productId,
    offerings: signalFoundation.catalog.confirmed.map(e=>({id:e.id,name:e.name,source:'OWNER_CONFIRMED' as const})),
    application: {
      name: pkg.authoritative.productName ?? null,
      category: pkg.authoritative.category ?? null,
      markets: pkg.authoritative.markets ?? [],
      description: pkg.authoritative.description ?? null,
    },
    brand,
    prohibitedTerms: prohibitedTermsOf(brand),
    founderDirection: {
      audienceConfirmed: pkg.founderContext.audienceConfirmed ?? null,
      contextDelta: pkg.founderContext.contextDelta ?? null,
      primaryGoal: pkg.founderContext.primaryGoal ?? null,
      competitors: (pkg.founderContext.competitors ?? []).map(c => c.name),
    },
    evidence,
    authorizedAssets,
    // Observed assets are counted, never returned: a caller that never receives
    // one cannot accidentally use it.
    observedAssetCount: Math.max(0, allDisplayable.length - authorizedAssets.length),
    marketIntelligenceAvailable:
      pkg.marketIntelligence.available === true && (pkg.marketEvidence ?? []).length > 0,
    brandProvenance: brandProvenanceLines(brand),
    unavailable,
  };
}
