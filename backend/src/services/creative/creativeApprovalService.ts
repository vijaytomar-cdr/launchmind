/**
 * @file creativeApprovalService.ts
 * @description Creative approval and creative history — B6A §30, §32, §35–§37.
 *
 *   THE BOUNDARY THIS FILE EXISTS TO HOLD:
 *
 *     approving COPY is not approving a PICTURE
 *     approving a PICTURE is not authorising PUBLISHING
 *
 *   Both are easy to lose by accident. The first is lost by reading
 *   content_assets.approved_at and showing a tick next to an image. The second
 *   is lost the moment anything here returns a value another module could read
 *   as permission. So a creative approval is a row that names exactly one
 *   rendered output, one content version, one actor and one moment, and it is
 *   stored in a table with no publish, launch, schedule, send or spend column.
 *
 *   REGENERATION DOES NOT INHERIT APPROVAL. A new render is a new output with no
 *   approval row. The earlier approval is NOT revoked — the owner really did
 *   approve that image and erasing the fact would be dishonest — but it stops
 *   being the CURRENT creative, and the owner is told both things.
 *
 *   BRAND AND ASSET HISTORY ARE IMMUTABLE. An image rendered under brand kit v3
 *   remains a v3 image after the owner confirms a new colour and the kit becomes
 *   v4. Rewriting that identity would make every historical creative a lie about
 *   what the brand looked like when it was made.
 *
 * @security Every read and write is scoped by workspace. Approval refuses a
 *   render job that did not succeed, so an approval cannot exist for an image
 *   that was never produced.
 * @dependencies supabaseAdmin only. Deliberately imports nothing from
 *   publishing, campaigns, spend or Marketing Memory.
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { critiqueComposition, type CreativeScenePlan } from './scenePlan';
import type { CompositionLayout } from './productComposition';

export class CreativeApprovalError extends Error {
  constructor(message: string) { super(message); this.name = 'CreativeApprovalError'; }
}

export interface CreativeRenderView {
  renderJobId: string;
  status: 'QUEUED' | 'RENDERING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  creativeKind: string;
  conceptLabel: string | null;
  variantLabel: string | null;
  contentVersionNumber: number;
  brandKitVersion: number;
  imageUrl: string | null;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: string;
  /** Owner-safe sentences. No prompt, seed, model slug or provider id. */
  provenance: string[];
  notes: string[];
  /** Owner-safe failure sentence when this render did not produce an image. */
  failureMessage: string | null;
  approved: boolean;
  approvedAt: string | null;
  /** True when this is the newest successful render for its content version. */
  isCurrent: boolean;
  /** True when the approved creative is not the current one. */
  approvedButSuperseded: boolean;
  /** Stated when the brand has moved on since this was made. */
  brandMovedOn: boolean;
  qualityOutcome: 'READY_FOR_OWNER_REVIEW' | 'NEEDS_CREATIVE_REVISION' |
    'ASSET_PROBLEM' | 'CONCEPT_DID_NOT_SURVIVE_RENDER' | 'NOT_ASSESSED';
  qualitySummary: string | null;
}

interface JobRow {
  id: string; status: string; creative_kind: string; concept_label: string | null;
  variant_label: string | null; content_version_number: number; brand_kit_version: number;
  output_asset_id: string | null; failure_detail: string | null; created_at: string;
}

const BUCKET = 'content-assets';

/**
 * Every render for one artifact, newest first, with approval and currency.
 *
 * @param currentBrandKitVersion so the view can say "the brand has moved on"
 *   without this module reaching into brand state itself
 */
export async function listCreativeRenders(opts: {
  contentAssetId: string; workspaceId: string; currentBrandKitVersion?: number;
}): Promise<CreativeRenderView[]> {
  const db = getSupabaseAdmin();

  const { data: jobs, error } = await db.from('creative_render_jobs')
    .select('id, status, creative_kind, concept_label, variant_label, ' +
            'content_version_number, brand_kit_version, output_asset_id, failure_detail, created_at')
    .eq('content_asset_id', opts.contentAssetId)
    .eq('workspace_id', opts.workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw new CreativeApprovalError(error.message);
  const rows = (jobs ?? []) as unknown as JobRow[];
  if (rows.length === 0) return [];

  const assetIds = rows.map(r => r.output_asset_id).filter((x): x is string => !!x);
  const { data: assets } = assetIds.length > 0
    ? await db.from('marketing_assets')
        .select('id, storage_path, width_px, height_px, generation_provenance')
        .in('id', assetIds)
    : { data: [] };
  const assetById = new Map(((assets ?? []) as Array<{
    id: string; storage_path: string | null; width_px: number | null;
    height_px: number | null; generation_provenance: { lines?: string[]; notes?: string[];
      manifest?: { layout?: CompositionLayout; screenshotComposited?: boolean; overlayLines?: unknown[] };
      scenePlan?: CreativeScenePlan;
      creativeCritique?: { outcome?: CreativeRenderView['qualityOutcome']; summary?: string } } | null;
  }>).map(a => [a.id, a]));

  const { data: approvals } = await db.from('creative_approvals')
    .select('render_job_id, approved_at')
    .eq('content_asset_id', opts.contentAssetId)
    .eq('workspace_id', opts.workspaceId);
  const approvedAtByJob = new Map(((approvals ?? []) as Array<{
    render_job_id: string; approved_at: string }>).map(a => [a.render_job_id, a.approved_at]));

  // "Current" is per content version: a render for version 2 does not stop
  // being current because someone rendered version 3.
  const currentByVersion = new Map<number, string>();
  for (const r of rows) {
    if (r.status !== 'SUCCEEDED') continue;
    if (!currentByVersion.has(r.content_version_number)) {
      currentByVersion.set(r.content_version_number, r.id);
    }
  }
  const approvedJobsByVersion = new Map<number, boolean>();
  for (const r of rows) {
    if (approvedAtByJob.has(r.id)) approvedJobsByVersion.set(r.content_version_number, true);
  }

  return rows.map(r => {
    const asset = r.output_asset_id ? assetById.get(r.output_asset_id) : undefined;
    const isCurrent = currentByVersion.get(r.content_version_number) === r.id;
    const approved = approvedAtByJob.has(r.id);
    const stored = asset?.generation_provenance;
    const structure = stored?.scenePlan && stored.manifest?.layout
      ? critiqueComposition({ plan: stored.scenePlan,
          widthPx: asset?.width_px ?? 0, heightPx: asset?.height_px ?? 0,
          screenshotComposited: stored.manifest.screenshotComposited === true,
          overlayLineCount: stored.manifest.overlayLines?.length ?? 0,
          actualLayout: stored.manifest.layout })
      : stored?.creativeCritique;
    const currentCritique = structure?.outcome !== 'READY_FOR_OWNER_REVIEW'
      ? structure : stored?.creativeCritique ?? structure;
    return {
      renderJobId: r.id,
      status: r.status as CreativeRenderView['status'],
      creativeKind: r.creative_kind,
      conceptLabel: r.concept_label,
      variantLabel: r.variant_label,
      contentVersionNumber: r.content_version_number,
      brandKitVersion: r.brand_kit_version,
      imageUrl: asset?.storage_path
        ? db.storage.from(BUCKET).getPublicUrl(asset.storage_path).data.publicUrl : null,
      widthPx: asset?.width_px ?? null,
      heightPx: asset?.height_px ?? null,
      createdAt: r.created_at,
      provenance: asset?.generation_provenance?.lines ?? [],
      notes: asset?.generation_provenance?.notes ?? [],
      failureMessage: r.status === 'FAILED' ? r.failure_detail : null,
      approved,
      approvedAt: approvedAtByJob.get(r.id) ?? null,
      isCurrent,
      // The owner approved something, and what they are looking at now is newer.
      approvedButSuperseded: !approved && isCurrent
        && approvedJobsByVersion.get(r.content_version_number) === true,
      brandMovedOn: typeof opts.currentBrandKitVersion === 'number'
        && r.brand_kit_version < opts.currentBrandKitVersion,
      qualityOutcome: currentCritique?.outcome ?? 'NOT_ASSESSED',
      qualitySummary: currentCritique?.summary ?? null,
    };
  });
}

/**
 * Approves ONE rendered image for ONE content version.
 *
 * @security Grants no publish, launch, schedule, send or spend — there is no
 *   column in which any of those could be recorded. Refuses a job that did not
 *   succeed, so an approval cannot point at an image that does not exist.
 * @throws {CreativeApprovalError} on an unknown, foreign, unsuccessful or
 *   already-approved job
 */
export async function approveCreative(opts: {
  renderJobId: string; workspaceId: string; actorId: string; note?: string;
}): Promise<{ renderJobId: string; contentVersionNumber: number; brandKitVersion: number }> {
  const db = getSupabaseAdmin();

  const { data: job } = await db.from('creative_render_jobs')
    .select('id, product_id, content_asset_id, content_version_number, ' +
            'brand_kit_version, output_asset_id, status')
    .eq('id', opts.renderJobId).eq('workspace_id', opts.workspaceId).maybeSingle();
  const j = job as {
    id: string; product_id: string; content_asset_id: string; content_version_number: number;
    brand_kit_version: number; output_asset_id: string | null; status: string } | null;

  // 404-shaped: a foreign job must read as absent, not as forbidden.
  if (!j) throw new CreativeApprovalError('Not found.');
  if (j.status !== 'SUCCEEDED' || !j.output_asset_id) {
    throw new CreativeApprovalError('That visual was not created, so it cannot be approved.');
  }
  const { data: generated } = await db.from('marketing_assets')
    .select('generation_provenance, width_px, height_px').eq('id', j.output_asset_id)
    .eq('workspace_id', opts.workspaceId).maybeSingle();
  const generatedView = generated as { width_px?: number | null; height_px?: number | null;
    generation_provenance?: {
    creativeCritique?: { outcome?: string }; scenePlan?: CreativeScenePlan;
    manifest?: { layout?: CompositionLayout; screenshotComposited?: boolean; overlayLines?: unknown[] } } } | null;
  const provenance = generatedView?.generation_provenance;
  const structure = provenance?.scenePlan && provenance.manifest?.layout
    ? critiqueComposition({ plan: provenance.scenePlan,
        widthPx: generatedView?.width_px ?? 0, heightPx: generatedView?.height_px ?? 0,
        screenshotComposited: provenance.manifest.screenshotComposited === true,
        overlayLineCount: provenance.manifest.overlayLines?.length ?? 0,
        actualLayout: provenance.manifest.layout })
    : provenance?.creativeCritique;
  const critique = structure?.outcome !== 'READY_FOR_OWNER_REVIEW'
    ? structure : provenance?.creativeCritique ?? structure;
  if (critique?.outcome && critique.outcome !== 'READY_FOR_OWNER_REVIEW') {
    throw new CreativeApprovalError(
      'This visual still needs revision before it can be approved.');
  }

  const { data: existing } = await db.from('creative_approvals')
    .select('render_job_id, content_version_number, brand_kit_version')
    .eq('render_job_id', opts.renderJobId).maybeSingle();
  if (existing) return { renderJobId: opts.renderJobId,
    contentVersionNumber: (existing as { content_version_number: number }).content_version_number,
    brandKitVersion: (existing as { brand_kit_version: number }).brand_kit_version };

  const { error } = await db.from('creative_approvals').insert({
    workspace_id: opts.workspaceId, product_id: j.product_id,
    content_asset_id: j.content_asset_id,
    content_version_number: j.content_version_number,
    render_job_id: j.id, generated_asset_id: j.output_asset_id,
    brand_kit_version: j.brand_kit_version,
    approved_by: opts.actorId,
    // Set explicitly rather than left to the column default. The service knows
    // the moment it approved; relying on the default meant a row could exist
    // with the approval recorded but no time attached to it.
    approved_at: new Date().toISOString(),
    note: opts.note ?? null,
  });
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw new CreativeApprovalError('You already approved this visual.');
    }
    throw new CreativeApprovalError(error.message);
  }

  return {
    renderJobId: j.id,
    contentVersionNumber: j.content_version_number,
    brandKitVersion: j.brand_kit_version,
  };
}
