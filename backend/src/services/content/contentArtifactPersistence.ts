/**
 * @file contentArtifactPersistence.ts
 * @description Governed artifact identity, versions and owner read model.
 *              Phase 3.5B3.1 — CLOSES P1-58.
 *
 *   B3 generated and governed content but never wrote it down, so the lineage
 *   from opportunity to immutable version existed only in test fixtures. This
 *   module is that write path, and it reuses `content_assets`,
 *   `content_versions` and `asset_approvals` — no parallel artifact tables.
 *
 *   IDENTITY vs CONTENT, the distinction the whole file turns on:
 *
 *     ARTIFACT IDENTITY  workspace · product · campaign · strategy · brief ·
 *                        channel · variant · mode · governance lane
 *     VERSION            the words, and the governance verdict on them
 *
 *   Identity must NOT depend on evidence lifecycle, current Market Intelligence,
 *   current Brand Kit values, model wording or execution status — all of which
 *   change after the fact. The same two-timeline rule proved in 3.4C: a
 *   retraction changes what the owner is TOLD, never what the artifact IS.
 *
 *   WHAT IS NEVER PERSISTED AS OWNER-READY: a failed or malformed generation. A
 *   degraded result may be retained for audit, but it is written as DRAFT with
 *   its disposition recorded, so nothing can mistake it for something to use.
 *
 * @security No publish, launch, schedule or spend column is written, because
 *   none exists on the governed lane. Approval binds ONE immutable version.
 * @dependencies b3ContentGeneration, briefComposition, supabaseAdmin
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { ChannelContentResult, ContentDisposition } from './b3ContentGeneration';
import { deriveContentBrief, type ContentBrief, type B3Channel } from './briefComposition';
import type { ProductContentContext } from './productContentContext';
import { deriveContentStrategy, type ContentStrategy } from './strategyComposition';
import type { CampaignMessageArchitecture } from '../opportunity/contentCampaignService';

export const CONTENT_STATUSES = [
  'DRAFT', 'REWRITE_REQUIRED', 'OWNER_CONFIRMATION_REQUIRED',
  'ELIGIBLE_FOR_CONTENT_APPROVAL', 'CONTENT_APPROVED',
] as const;
export type ContentStatus = typeof CONTENT_STATUSES[number];

/**
 * Maps a governance disposition to a content-lane status.
 *
 * ELIGIBLE means "eligible FOR APPROVAL", never "approved" and never "ready to
 * publish". PROHIBITED and DEGRADED both land on DRAFT: neither is something an
 * owner should be offered, and both keep their disposition on the version so
 * the reason survives.
 */
export function statusForDisposition(d: ContentDisposition): ContentStatus {
  switch (d) {
    case 'ELIGIBLE': return 'ELIGIBLE_FOR_CONTENT_APPROVAL';
    case 'REWRITE_REQUIRED': return 'REWRITE_REQUIRED';
    case 'OWNER_CONFIRMATION_REQUIRED': return 'OWNER_CONFIRMATION_REQUIRED';
    case 'PROHIBITED': case 'DEGRADED': return 'DRAFT';
  }
}

export interface ArtifactIdentity {
  workspaceId: string;
  productId: string;
  campaignId: string;
  strategyId: string;
  briefId: string;
  channel: string;
  variantGroupId: string | null;
  variantLabel: string | null;
}

/** Owner-safe governance record kept on every version. */
export interface GovernanceSummary {
  disposition: ContentDisposition;
  reasons: string[];
  claims: Array<{ field: string; text: string; category: string; verdict: string; support: string[] }>;
  structuralIssues: Array<{ field: string; rule: string }>;
  terminologyViolations: Array<{ field: string; term: string }>;
  quality: ChannelContentResult['quality'];
  rewriteAttempts: number;
  provenance: string[];
}

export class ArtifactPersistenceError extends Error {
  constructor(message: string) { super(message); this.name = 'ArtifactPersistenceError'; }
}

function summaryOf(result: ChannelContentResult, provenance: string[]): GovernanceSummary {
  return {
    disposition: result.disposition,
    reasons: result.reasons,
    claims: result.claims,
    structuralIssues: result.structuralIssues.map(i => ({ field: i.field, rule: i.rule })),
    terminologyViolations: result.terminologyViolations,
    quality: result.quality,
    rewriteAttempts: result.rewriteAttempts,
    provenance,
  };
}

export interface PersistInput {
  identity: ArtifactIdentity;
  /** The grounded planning item this artifact fulfils, when Studio owns the run. */
  planningWorkId?: string;
  result: ChannelContentResult;
  brief: ContentBrief;
  ctx: ProductContentContext;
  founderId: string;
  provenance: string[];
  mode: 'AI_CMO_RECOMMENDED' | 'OWNER_DIRECTED';
}

/**
 * Creates a governed artifact and its immutable version 1.
 *
 * @security Refuses to persist a generation that produced nothing — a
 *   non-existent artifact must never acquire an id an owner could act on.
 *   Scope is taken from the identity, which came from verified context.
 */
/**
 * Maps a product's market label to the canonical content vocabulary.
 *
 * FOUND BY RUNNING IT, B6A: this previously passed `markets[0]` straight into
 * `content_assets.market`, whose CHECK allows only usa | india | both. A product
 * onboarded with "united_states" therefore could not have ANY governed content
 * created — the insert failed on a constraint violation with no owner-facing
 * explanation. It went unnoticed because the fixture product happens to store
 * "usa" already.
 *
 * @security An unrecognised label falls back to 'usa' rather than being written
 *   through. Guessing a market wrongly is a labelling error; writing an
 *   unconstrained value is a failed save the owner cannot act on.
 */
function normalizeMarket(markets: readonly string[] | null | undefined): 'usa' | 'india' | 'both' {
  const seen = new Set((markets ?? []).map(m => String(m).trim().toLowerCase()));
  const isUsa = ['usa', 'us', 'united_states', 'united states', 'america'].some(k => seen.has(k));
  const isIndia = ['india', 'in', 'bharat'].some(k => seen.has(k));
  if (isUsa && isIndia) return 'both';
  if (isIndia) return 'india';
  return 'usa';
}

export async function persistGovernedArtifact(
  input: PersistInput,
): Promise<{ assetId: string; versionNumber: number; status: ContentStatus }> {
  const { result, identity } = input;
  if (result.fields.length === 0) {
    throw new ArtifactPersistenceError(
      'Nothing was generated, so there is no artifact to save.');
  }

  const db = getSupabaseAdmin();
  const status = statusForDisposition(result.disposition);

  // A planning item owns one current generated artifact.  If a process died
  // after writing it but before the planning state was updated, resume that
  // artifact instead of creating a second version-one row.
  if (input.planningWorkId) {
    const { data: existing } = await db.from('content_assets')
      .select('id, content_status')
      .eq('parent_asset_id', input.planningWorkId)
      .eq('workspace_id', identity.workspaceId)
      .maybeSingle();
    if (existing) {
      const { data: versions } = await db.from('content_versions')
        .select('version_number').eq('asset_id', (existing as { id: string }).id)
        .order('version_number', { ascending: false }).limit(1);
      const versionNumber = Number((versions as Array<{ version_number: number }> | null)?.[0]?.version_number);
      if (!versionNumber) {
        throw new ArtifactPersistenceError('artifact recovery failed: persisted artifact has no immutable version');
      }
      return { assetId: (existing as { id: string }).id, versionNumber,
        status: (existing as { content_status: ContentStatus }).content_status };
    }
  }

  const { data: asset, error } = await db.from('content_assets').insert({
    workspace_id: identity.workspaceId,
    product_id: identity.productId,
    founder_id: input.founderId,
    governance: 'GOVERNED_CONTENT_INTELLIGENCE',
    content_campaign_id: identity.campaignId,
    strategy_id: identity.strategyId,
    content_brief_id: identity.briefId,
    asset_type: channelToAssetType(identity.channel),
    channel: identity.channel.toLowerCase(),
    market: normalizeMarket(input.ctx.application.markets),
    variant_group_id: identity.variantGroupId,
    variant_label: identity.variantLabel,
    parent_asset_id: input.planningWorkId ?? null,
    content_status: status,
    brand_kit_version: input.ctx.brand.version,
    structured_data: result.payload,
    status: 'pending',
  }).select('id').single();
  if (error) throw new ArtifactPersistenceError(`artifact write failed: ${error.message}`);

  const assetId = (asset as { id: string }).id;
  try {
    await writeVersion(db, {
      assetId, versionNumber: 1, input, changeType: 'ai_regen',
      changeSummary: `Generated for ${identity.channel}`,
    });
  } catch (error) {
    // Do not strand an artifact that can never be owner-reviewable.  The
    // version is the immutable governance record, so an artifact without one
    // is not a recoverable owner draft.
    await db.from('content_assets').delete().eq('id', assetId)
      .eq('workspace_id', identity.workspaceId);
    throw error;
  }
  return { assetId, versionNumber: 1, status };
}

/** Finds an already-persisted result for an interrupted planning run. */
export async function persistedPlanningArtifact(opts: { planningWorkId: string; workspaceId: string }) {
  const db = getSupabaseAdmin();
  const { data: asset } = await db.from('content_assets')
    .select('id, content_status').eq('parent_asset_id', opts.planningWorkId)
    .eq('workspace_id', opts.workspaceId).maybeSingle();
  if (!asset) return null;
  const assetId = (asset as { id: string }).id;
  const view = await ownerContentView(assetId, opts.workspaceId);
  if (!view || view.status !== 'ELIGIBLE_FOR_CONTENT_APPROVAL') return null;
  return { assetId, versionNumber: view.versionNumber, artifact: view };
}

/** Existing asset-type vocabulary; new channels map onto the nearest member. */
function channelToAssetType(channel: string): string {
  switch (channel) {
    case 'GOOGLE_RSA': return 'google_uac_variants';
    case 'META_AD': return 'meta_body';
    case 'LANDING_PAGE': return 'landing_page_copy';
    case 'LINKEDIN_POST': return 'linkedin_founder_story';
    case 'SHORT_FORM_VIDEO_SCRIPT': return 'video_reels_30s';
    default: return 'meta_body';
  }
}

async function writeVersion(
  db: ReturnType<typeof getSupabaseAdmin>,
  o: { assetId: string; versionNumber: number; input: PersistInput;
       changeType: 'ai_regen' | 'editor_save'; changeSummary: string },
): Promise<void> {
  const { error } = await db.from('content_versions').insert({
    asset_id: o.assetId,
    version_number: o.versionNumber,
    structured_data: o.input.result.payload,
    text_content: null,
    change_type: o.changeType,
    change_summary: o.changeSummary,
    changed_by: o.input.founderId,
    disposition: o.input.result.disposition,
    governance_summary: summaryOf(o.input.result, o.input.provenance),
    brand_kit_version: o.input.ctx.brand.version,
    // Refs eligible AT GENERATION TIME. A later retraction does not rewrite this.
    evidence_refs: o.input.ctx.evidence.map(h => h.ref),
    authorized_asset_ids: o.input.ctx.authorizedAssets.map(a => a.id),
  });
  if (error) throw new ArtifactPersistenceError(`version write failed: ${error.message}`);
}

/**
 * Adds the next immutable version to an EXISTING artifact.
 *
 * @param changeType `ai_regen` for regeneration, `editor_save` for an owner edit
 * @security The caller must have re-run the full pipeline; this function
 *   persists a verdict, it does not produce one. Prior versions are never
 *   touched — `content_versions` is append-only by migration 047.
 */
export async function appendGovernedVersion(opts: {
  assetId: string; workspaceId: string; input: PersistInput;
  changeType: 'ai_regen' | 'editor_save'; changeSummary: string;
}): Promise<{ versionNumber: number; status: ContentStatus }> {
  const db = getSupabaseAdmin();

  const { data: asset } = await db.from('content_assets')
    .select('id, workspace_id')
    .eq('id', opts.assetId).eq('workspace_id', opts.workspaceId).maybeSingle();
  // 404-shaped: another workspace's artifact must not be distinguishable from
  // one that does not exist.
  if (!asset) throw new ArtifactPersistenceError('Not found.');

  // Approval is an identity-bound owner decision. Re-reading or re-clicking
  // the same approved version is idempotent; a newer version is never covered.
  if ((asset as { content_status?: string; content_approved_version?: number }).content_status === 'CONTENT_APPROVED'
    && (asset as { content_approved_version?: number }).content_approved_version === opts.versionNumber) return;

  const { data: versions } = await db.from('content_versions')
    .select('version_number').eq('asset_id', opts.assetId);
  const next = Math.max(0, ...((versions ?? []) as Array<{ version_number: number }>)
    .map(v => Number(v.version_number))) + 1;

  await writeVersion(db, {
    assetId: opts.assetId, versionNumber: next, input: opts.input,
    changeType: opts.changeType, changeSummary: opts.changeSummary,
  });

  const status = statusForDisposition(opts.input.result.disposition);
  await db.from('content_assets').update({
    content_status: status,
    structured_data: opts.input.result.payload,
    brand_kit_version: opts.input.ctx.brand.version,
  }).eq('id', opts.assetId).eq('workspace_id', opts.workspaceId);

  return { versionNumber: next, status };
}

/**
 * Re-checks a stored ELIGIBLE_FOR_CONTENT_APPROVAL artifact against CURRENT
 * deterministic capability rules before it is approved or shown as ready.
 *
 * `content_status` is written ONCE, at generation time. If the capability
 * boundary later tightens — a verb or field shape it previously missed — an
 * old artifact can sit at ELIGIBLE_FOR_CONTENT_APPROVAL forever even though
 * the SAME stored payload would now be refused. Both approval and display
 * must observe the rule as it stands today, not the rule that ran when the
 * row was written.
 *
 * Downgrades in place to REWRITE_REQUIRED — an existing, already owner-facing
 * status — rather than inventing a new one. Only ELIGIBLE_FOR_CONTENT_APPROVAL
 * is re-checked: every other status already reads as "not ready", and
 * CONTENT_APPROVED is a separate, already-recorded owner decision this does
 * not revisit.
 *
 * @security Deterministic only — runs the same §6 capability boundary content
 *   generation itself runs (productCapabilityContract), no AI call. Scope is
 *   taken from the caller's verified workspace; a compare-and-set update means
 *   a concurrent approval or edit is never silently overwritten.
 */
export async function revalidateEligibleArtifact(opts: {
  assetId: string; workspaceId: string;
}): Promise<{ status: ContentStatus; violations: string[] }> {
  const db = getSupabaseAdmin();
  const { data: asset } = await db.from('content_assets')
    .select('id, product_id, content_status, structured_data')
    .eq('id', opts.assetId).eq('workspace_id', opts.workspaceId).maybeSingle();
  if (!asset) throw new ArtifactPersistenceError('Not found.');
  const a = asset as { id: string; product_id: string; content_status: string;
    structured_data: Record<string, unknown> | null };
  if (a.content_status !== 'ELIGIBLE_FOR_CONTENT_APPROVAL') {
    return { status: (a.content_status as ContentStatus) ?? 'DRAFT', violations: [] };
  }

  // Deliberately NOT the full ContextPackageV2 → buildProductContentContext
  // pipeline: that assembles evidence, memory retrieval and marketing assets,
  // none of which this deterministic check reads. Resolving only the three
  // inputs buildProductCapabilityContract actually uses — the authoritative
  // description, the brand kit and the confirmed service catalog — through
  // their OWN canonical functions keeps this revalidation as light as the
  // boundary it re-runs, and still cannot drift from the description
  // precedence, brand-confirmation or catalog rules the real generation path
  // uses, because both are the same functions.
  //
  // The catalog is not optional here. Owner-confirmed service knowledge is a
  // capability source, so omitting it would rebuild a NARROWER contract than
  // generation used and mark an eligible draft REWRITE_REQUIRED for using the
  // owner's own words — a check that fails work it authorised.
  const { pickProductDescription } = await import('../../lib/context/contextPackageV2');
  const { resolveBrandKit } = await import('../brand/brandKitService');
  const { resolveCatalog } = await import('./serviceCatalog');
  const { buildProductCapabilityContract, validatePayloadCapabilities } =
    await import('./productCapabilityContract');

  const [{ data: productRow }, brand] = await Promise.all([
    db.from('products').select('id,scraped_meta,confirmed_icp').eq('id', a.product_id)
      .eq('workspace_id', opts.workspaceId).maybeSingle(),
    resolveBrandKit(opts.workspaceId, a.product_id),
  ]);
  const ctx = {
    application: { description: pickProductDescription(
      (productRow as { scraped_meta?: unknown } | null)?.scraped_meta) },
    brand,
    signalFoundation: productRow
      ? { catalog: resolveCatalog(productRow as Record<string, unknown>) } : null,
  } as unknown as import('./productContentContext').ProductContentContext;
  const contract = buildProductCapabilityContract(ctx);
  const violations = validatePayloadCapabilities(a.structured_data ?? {}, contract);
  if (violations.length === 0) return { status: 'ELIGIBLE_FOR_CONTENT_APPROVAL', violations: [] };

  // CAS: only downgrade the state this check actually observed. A concurrent
  // approval or regeneration between the read above and this write must win.
  await db.from('content_assets').update({ content_status: 'REWRITE_REQUIRED' })
    .eq('id', opts.assetId).eq('workspace_id', opts.workspaceId)
    .eq('content_status', 'ELIGIBLE_FOR_CONTENT_APPROVAL');
  return { status: 'REWRITE_REQUIRED', violations: violations.map(v => v.reason) };
}

/**
 * Records owner approval of ONE immutable version.
 *
 * @security Grants no publish, launch, schedule, budget, send or provider
 *   permission. Those live in 3.6 and have no column on this lane. Fails
 *   closed: revalidates against CURRENT capability rules before honoring a
 *   status that may have been written under an older, looser check.
 */
export async function approveContentVersion(opts: {
  assetId: string; workspaceId: string; versionNumber: number; actorId: string; note?: string;
}): Promise<void> {
  const db = getSupabaseAdmin();
  const { data: asset } = await db.from('content_assets')
    .select('id, content_status, content_approved_version')
    .eq('id', opts.assetId).eq('workspace_id', opts.workspaceId).maybeSingle();
  if (!asset) throw new ArtifactPersistenceError('Not found.');

  let current = (asset as { content_status?: string }).content_status;
  if (current === 'ELIGIBLE_FOR_CONTENT_APPROVAL') {
    const revalidated = await revalidateEligibleArtifact(
      { assetId: opts.assetId, workspaceId: opts.workspaceId });
    current = revalidated.status;
  }
  if (current !== 'ELIGIBLE_FOR_CONTENT_APPROVAL') {
    throw new ArtifactPersistenceError(
      'This version is not eligible for approval yet.');
  }
  const { data: version } = await db.from('content_versions')
    .select('id').eq('asset_id', opts.assetId)
    .eq('version_number', opts.versionNumber).maybeSingle();
  if (!version) throw new ArtifactPersistenceError('That version does not exist.');

  await db.from('asset_approvals').insert({
    asset_id: opts.assetId, founder_id: opts.actorId,
    action: 'approved', note: opts.note ?? null,
    version_number: opts.versionNumber,
  });
  await db.from('content_assets').update({
    content_status: 'CONTENT_APPROVED',
    content_approved_at: new Date().toISOString(),
    content_approved_version: opts.versionNumber,
    content_approved_by: opts.actorId,
  }).eq('id', opts.assetId).eq('workspace_id', opts.workspaceId);
}

export interface OwnerContentView {
  content: Record<string, unknown>;
  channel: string;
  versionNumber: number;
  variantLabel: string | null;
  status: ContentStatus;
  campaignName: string | null;
  whyCreated: string[];
  brandVersion: number | null;
  proof: string[];
  confirmationGaps: string[];
  needsAttention: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * The owner-facing projection.
 *
 * @security Emits owner-safe copy only. No evidence handle, authority enum,
 *   policy version, prompt, reasoning, provider credential or internal id
 *   beyond what the owner needs to act.
 */
export async function ownerContentView(
  assetId: string, workspaceId: string,
): Promise<OwnerContentView | null> {
  const db = getSupabaseAdmin();
  const { data: asset } = await db.from('content_assets')
    .select('id, channel, content_status, variant_label, structured_data, ' +
            'brand_kit_version, content_campaign_id, created_at, updated_at')
    .eq('id', assetId).eq('workspace_id', workspaceId).maybeSingle();
  if (!asset) return null;
  const a = asset as unknown as Record<string, unknown>;

  const { data: versions } = await db.from('content_versions')
    .select('version_number, disposition, governance_summary')
    .eq('asset_id', assetId);
  const rows = ((versions ?? []) as unknown as Array<Record<string, unknown>>)
    .sort((x, y) => Number(y.version_number) - Number(x.version_number));
  const latest = rows[0];
  const summary = (latest?.governance_summary ?? {}) as Partial<GovernanceSummary>;

  let campaignName: string | null = null;
  if (a.content_campaign_id) {
    const { data: c } = await db.from('content_campaigns')
      .select('name').eq('id', a.content_campaign_id as string)
      .eq('workspace_id', workspaceId).maybeSingle();
    campaignName = (c as { name?: string } | null)?.name ?? null;
  }

  const claims = summary.claims ?? [];
  return {
    content: (a.structured_data ?? {}) as Record<string, unknown>,
    channel: String(a.channel ?? ''),
    versionNumber: Number(latest?.version_number ?? 1),
    variantLabel: (a.variant_label as string | null) ?? null,
    status: (a.content_status as ContentStatus) ?? 'DRAFT',
    campaignName,
    whyCreated: summary.provenance ?? [],
    brandVersion: (a.brand_kit_version as number | null) ?? null,
    // Owner-safe LABELS of what supports the content — never a handle.
    proof: [...new Set(claims.flatMap(c => c.support))],
    confirmationGaps: claims.filter(c => c.verdict === 'NEEDS_OWNER_CONFIRMATION')
      .map(c => c.text),
    needsAttention: summary.reasons ?? [],
    createdAt: (a.created_at as string | null) ?? null,
    updatedAt: (a.updated_at as string | null) ?? null,
  };
}

/**
 * Rebuilds the governed lineage behind a stored artifact — Phase 3.5B6A.
 *
 * Creative rendering needs the SAME strategy and brief the copy was written
 * from, or the picture illustrates a different campaign than the words. Those
 * are re-derived from the persisted campaign, strategy and brief rows rather
 * than accepted from the caller: a client-supplied brief would carry no brand
 * governance, no prohibited terms and no proof boundary, and would be the one
 * unguarded door into the render pipeline.
 *
 * Also returns the GOVERNED headline and CTA. These are the only strings the
 * overlay may place on an image, because they are the only ones that have been
 * through claim discovery and grounding.
 *
 * @returns null when the artifact has no campaign lineage — the caller must
 *   refuse rather than render something with no campaign behind it
 * @security Everything is read inside the caller's workspace. A strategy or
 *   brief belonging to another business resolves to nothing.
 */
export async function rebuildGovernedLineage(opts: {
  workspaceId: string; founderId: string; productId: string;
  contentAssetId: string; ctx: ProductContentContext;
}): Promise<{
  strategy: ContentStrategy; brief: ContentBrief; strategyId: string | null;
  headline: string | null; cta: string | null; supporting: string | null;
  /** False when the latest version did not pass governance. */
  textEligibleForImage: boolean;
  disposition: string | null;
  versionNumber: number;
} | null> {
  const db = getSupabaseAdmin();

  const { data: assetRow } = await db.from('content_assets')
    .select('id, channel, content_campaign_id, content_brief_id, structured_data')
    .eq('id', opts.contentAssetId).eq('workspace_id', opts.workspaceId).maybeSingle();
  const a = assetRow as Record<string, unknown> | null;
  if (!a || !a.content_campaign_id) return null;

  const { data: campRow } = await db.from('content_campaigns')
    .select('name, thesis, audience, core_problem, message_angle, product_role, ' +
            'primary_benefit, objections, cta_intent, proof_unavailable, ' +
            'recommended_channels, content_package')
    .eq('id', String(a.content_campaign_id)).eq('workspace_id', opts.workspaceId).maybeSingle();
  const c = campRow as Record<string, unknown> | null;
  if (!c) return null;

  const { data: stRow } = await db.from('content_strategies')
    .select('id').eq('content_campaign_id', String(a.content_campaign_id))
    .eq('workspace_id', opts.workspaceId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const strategyId = (stRow as { id?: string } | null)?.id ?? null;

  const channel = String(a.channel ?? '').toUpperCase() as B3Channel;

  // proofAvailable is deliberately EMPTY here: deriveContentStrategy recomputes
  // it from the context's CURRENT evidence, and a stale campaign copy is how a
  // withdrawn number survives into a picture.
  const architecture: CampaignMessageArchitecture = {
    name: String(c.name ?? ''), thesis: String(c.thesis ?? ''),
    // Historical rows may hold the OBJECTIVE in cta_intent; see
    // deriveViewerCtaIntent. Not reinterpreted here — snapshots stay as written.
    campaignObjective: null,
    audience: String(c.audience ?? ''),
    coreProblem: (c.core_problem as string | null) ?? null,
    messageAngle: String(c.message_angle ?? ''),
    productRole: (c.product_role as string | null) ?? null,
    primaryBenefit: (c.primary_benefit as string | null) ?? null,
    objections: (c.objections as string[] | null) ?? [],
    ctaIntent: (c.cta_intent as string | null) ?? null,
    proofAvailable: [],
    proofUnavailable: (c.proof_unavailable as string[] | null) ?? [],
    recommendedChannels: (c.recommended_channels as string[] | null) ?? [channel],
    contentPackage: [], packageNotes: [],
    brandDirectives: [], prohibitedTerms: [...opts.ctx.prohibitedTerms],
  };

  const strategy = deriveContentStrategy({ ctx: opts.ctx, architecture });
  const brief = deriveContentBrief(channel, strategy, opts.ctx);

  // The governed copy already written for this artifact. Taken from the stored
  // structured payload, never regenerated — the overlay must show the exact
  // words the owner reviewed.
  const payload = (a.structured_data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = payload[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return String(v[0]).trim();
    }
    return null;
  };
  const headline = pick('headline', 'headlines', 'primaryText', 'hook', 'title');
  const cta = pick('cta', 'ctaText', 'callToAction');
  const supporting = pick('description', 'subhead', 'supportingCopy', 'body');

  // The disposition of the version this copy belongs to. Text from a version
  // the claim engine refused must not be placed in a picture: every governance
  // layer built in 3.5 inspects text fields, and none of them can read an image.
  const { data: ver } = await db.from('content_versions')
    .select('version_number, disposition').eq('asset_id', opts.contentAssetId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle();
  const v = ver as { version_number?: number; disposition?: string } | null;
  const textEligibleForImage = v?.disposition === 'ELIGIBLE';

  return {
    strategy, brief, strategyId,
    headline: textEligibleForImage ? headline : null,
    cta: textEligibleForImage ? cta : null,
    supporting: textEligibleForImage ? supporting : null,
    textEligibleForImage,
    disposition: v?.disposition ?? null,
    versionNumber: v?.version_number ?? 1,
  };
}
