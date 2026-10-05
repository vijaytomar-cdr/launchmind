/**
 * @file marketingAssetService.ts
 * @description THE authorization-aware asset resolver — ADR-071 §18, T3, T11.
 *
 *   Content generation must obtain assets through this module and never by
 *   reading a Storage path or a JSONB array. That is the whole point of T3:
 *   **a Storage path is not authorization.** Resolving an object, knowing its
 *   URL, or finding it in `scraped_meta` says nothing about whether the owner
 *   may publish it.
 *
 * @security Every read is workspace+product scoped at the query, not filtered
 *   afterwards. CONTENT_CREATION and VISUAL_RENDERING return only assets that
 *   pass isEligibleForPurpose, which agrees with migration 116's CHECKs by
 *   construction — both are asserted against the same table of cases.
 * @dependencies supabaseAdmin, marketingAssetPolicy
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import {
  isEligibleForPurpose, type AssetPurpose, type MarketingAsset,
  type AssetSource, type SubjectRelation,
} from './marketingAssetPolicy';

interface Row {
  id: string; workspace_id: string; product_id: string; asset_type: string;
  source: string; subject_relation: string; authorization_state: string;
  storage_path: string | null; external_url: string | null;
  rights_basis: string | null; may_contain_pii: boolean; archived_at: string | null;
}

const toAsset = (r: Row): MarketingAsset => ({
  id: r.id, workspaceId: r.workspace_id, productId: r.product_id,
  assetType: r.asset_type, source: r.source as AssetSource,
  subjectRelation: r.subject_relation as SubjectRelation,
  authorizationState: r.authorization_state as MarketingAsset['authorizationState'],
  storagePath: r.storage_path, externalUrl: r.external_url,
  rightsBasis: r.rights_basis, mayContainPii: r.may_contain_pii,
  archivedAt: r.archived_at,
});

/**
 * Resolves assets a caller may use for one purpose.
 *
 * @param workspaceId VERIFIED workspace context, never a client hint
 * @param productId   the product the content is for
 * @param purpose     what the caller intends to do with the asset
 * @returns only eligible assets; ineligible ones are omitted, not flagged —
 *   a caller that receives an asset may use it, with no second check to forget
 * @security A cross-product or cross-workspace asset cannot appear here, because
 *   both are predicates on the query rather than filters on the result.
 */
export async function resolveMarketingAssets(
  workspaceId: string, productId: string, purpose: AssetPurpose,
): Promise<MarketingAsset[]> {
  if (!workspaceId || !productId) return [];
  const { data, error } = await getSupabaseAdmin()
    .from('marketing_assets')
    .select('id, workspace_id, product_id, asset_type, source, subject_relation, ' +
            'authorization_state, storage_path, external_url, rights_basis, ' +
            'may_contain_pii, archived_at')
    .eq('workspace_id', workspaceId)
    .eq('product_id', productId)
    .is('archived_at', null);
  if (error) throw new Error(`marketing asset resolution failed: ${error.message}`);

  return ((data ?? []) as unknown as Row[])
    .map(toAsset)
    .filter(a => isEligibleForPurpose(a, purpose).eligible);
}

export interface ObservedAssetInput {
  workspaceId: string; productId: string; founderId: string;
  assetType: MarketingAsset['assetType'];
  source: AssetSource;
  subjectRelation?: SubjectRelation;
  storagePath?: string | null;
  externalUrl?: string | null;
}

/**
 * Records something LaunchMind observed.
 *
 * There is no `authorizationState` parameter, and that is deliberate: an
 * ingestion path must be structurally unable to mint an authorized asset. The
 * only route to AUTHORIZED_MARKETING is authorizeAsset(), which requires an
 * owner.
 */
export async function recordObservedAsset(input: ObservedAssetInput): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('marketing_assets')
    .insert({
      workspace_id: input.workspaceId, product_id: input.productId,
      founder_id: input.founderId, asset_type: input.assetType,
      source: input.source,
      subject_relation: input.subjectRelation ?? 'UNKNOWN',
      storage_path: input.storagePath ?? null,
      external_url: input.externalUrl ?? null,
      authorization_state: 'OBSERVED_EXTERNAL',
      may_contain_pii: true,
    })
    .select('id').single();
  if (error) throw new Error(`observed asset write failed: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? null;
}

export class AssetAuthorizationError extends Error {
  constructor(message: string) { super(message); this.name = 'AssetAuthorizationError'; }
}

/**
 * The ONLY path to AUTHORIZED_MARKETING.
 *
 * @param rightsBasis what the OWNER asserts, e.g. "our own App Store listing".
 *   Required and non-empty: an authorization nobody can explain is one nobody
 *   can defend later.
 * @security Refuses sources and subjects that cannot confer rights BEFORE the
 *   write, so the owner gets a reason rather than a constraint violation. The
 *   database refuses the same cases independently — this is not the only guard.
 */
export async function authorizeAsset(opts: {
  assetId: string; workspaceId: string; actorId: string;
  rightsBasis: string; subjectRelation?: SubjectRelation;
  piiChecked?: boolean;
}): Promise<void> {
  const basis = String(opts.rightsBasis ?? '').trim();
  if (basis.length < 4) {
    throw new AssetAuthorizationError('A rights basis is required to authorise an asset.');
  }
  const db = getSupabaseAdmin();
  const { data } = await db.from('marketing_assets')
    .select('id, source, subject_relation')
    .eq('id', opts.assetId).eq('workspace_id', opts.workspaceId).maybeSingle();
  const row = data as { source?: string; subject_relation?: string } | null;
  // 404-shaped: a non-member must not learn that another workspace's asset exists.
  if (!row) throw new AssetAuthorizationError('Not found.');

  if (row.source === 'WEB_SEARCH') {
    throw new AssetAuthorizationError(
      'An image found by web search cannot be authorised for marketing use.');
  }
  const subject = opts.subjectRelation ?? (row.subject_relation as SubjectRelation);
  if (subject !== 'OWN_PRODUCT') {
    throw new AssetAuthorizationError(
      'Only images of your own product can be authorised for marketing use.');
  }

  const { error } = await db.from('marketing_assets').update({
    authorization_state: 'AUTHORIZED_MARKETING',
    authorized_by: opts.actorId,
    authorized_at: new Date().toISOString(),
    rights_basis: basis,
    subject_relation: subject,
    ...(opts.piiChecked === true ? { may_contain_pii: false } : {}),
  }).eq('id', opts.assetId).eq('workspace_id', opts.workspaceId);
  if (error) throw new AssetAuthorizationError(error.message);
}
