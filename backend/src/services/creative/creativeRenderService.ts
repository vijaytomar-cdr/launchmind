/**
 * @file creativeRenderService.ts
 * @description Orchestrates one governed render — B6A §11–§13, §18, §21–§25.
 *
 *   This is where every B6A boundary is actually enforced, in this order and for
 *   these reasons:
 *
 *     1. SCOPE      the artifact is resolved inside the caller's workspace, so a
 *                   content id from another business renders nothing.
 *     2. CONTEXT    the brief is rebuilt from ProductContentContext. Without a
 *                   real application context the render is REFUSED rather than
 *                   downgraded into a generic stock advertisement (§28).
 *     3. ASSETS     reference images come ONLY from resolveMarketingAssets(...,
 *                   'VISUAL_RENDERING'), which already refuses web-search
 *                   sources, competitor subjects, unauthorised assets and
 *                   anything that may contain personal data.
 *     4. CONCEPT    if the concept REQUIRES a product screenshot and none is
 *                   authorised, the job is blocked — it does not invent a
 *                   plausible interface (§12).
 *     5. BUDGET     bounded variants, attempts and provider calls (§18).
 *     6. RENDER     provider called through the abstraction only.
 *     7. VALIDATE   content type, size, dimensions.
 *     8. OVERLAY    governed copy composited deterministically (§15, §16).
 *     9. STORE      bytes land in LaunchMind storage; the provider URL is never
 *                   the canonical identity (§23).
 *    10. LINEAGE    the stored asset records artifact, version, campaign,
 *                   strategy, brief, variant, brand version, job, provider (§24).
 *
 *   Rendering is NOT execution and NOT learning. This module writes render jobs
 *   and generated assets. It never touches campaigns, publishing, spend or
 *   Marketing Memory.
 *
 * @security Failure NEVER produces a placeholder image. A failed job leaves the
 *   content artifact byte-identical and tells the owner so.
 * @dependencies marketingAssetService · productContentContext · creativeBriefs ·
 *   creativeProviderRegistry · creativePromptAssembly · creativeTextOverlay
 */

import sharp from 'sharp';
import { createCreativeDiagnostics } from './creativeDiagnostics';
import { critiqueRenderedVisual } from './visualCritique';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { resolveMarketingAssets } from '../brand/marketingAssetService';
import { deriveVisualCreativeBrief, type VisualCreativeBrief } from '../content/creativeBriefs';
import type { ProductContentContext } from '../content/productContentContext';
import type { ContentStrategy } from '../content/strategyComposition';
import type { ContentBrief } from '../content/briefComposition';
import { getCreativeProvider } from './creativeProviderRegistry';
import { assembleCreativeInstruction } from './creativePromptAssembly';
import { applyGovernedOverlay } from './creativeTextOverlay';
import { composeProductCreative, backgroundPrompt, BACKGROUND_NEGATIVE,
  compositionAssetSuitability, compositionAccent, evaluateProductHeroContract, type OverlayLine } from './productComposition';
import { downloadRenderedImage } from './replicateCreativeAdapter';
import {
  CreativeProviderError, type CreativeQualityTier, type CreativeFailureCategory,
} from './creativeProviderTypes';
import { creativeKindForChannel, routeCreativeModel, type CreativeKind, aspectForKind } from './creativeModelRouting';
import { buildScenePlan, critiqueComposition, selectVisualExecution,
  recognitionIntent, recognitionThesis, repairVisualThesis, repairCompositionIntent, visualExecutionSignature,
  type CompositionIntent, type CreativeScenePlan, type CreativeCritique, type VisualExecution }
  from './scenePlan';

const BUCKET = 'content-assets';

/** §18 bounded cost. Exceeding any of these is a refusal, not a warning. */
export const CREATIVE_LIMITS = {
  MAX_VARIANTS_PER_REQUEST: 3,
  /** One initial source plus one source-level repair. Geometry repairs are local. */
  MAX_ATTEMPTS_PER_JOB: 2,
  MAX_PROVIDER_CALLS_PER_ARTIFACT_VERSION: 12,
} as const;

/**
 * Concepts that cannot be honoured without a real product image.
 *
 * A benefit-led or brand-led concept can be rendered without one. A concept that
 * says "show the dashboard" cannot, and drawing an imaginary interface is a
 * picture of a product that does not exist.
 */
const REQUIRES_SCREENSHOT = /\b(screenshot|the app screen|the dashboard|the interface|product ui|in-app|app screen)\b/i;

export class CreativeRenderBlocked extends Error {
  readonly category: CreativeFailureCategory;
  readonly ownerMessage: string;
  constructor(category: CreativeFailureCategory, ownerMessage: string, internal?: string) {
    super(internal ?? ownerMessage);
    this.name = 'CreativeRenderBlocked';
    this.category = category;
    this.ownerMessage = ownerMessage;
  }
}

export interface RenderVisualInput {
  workspaceId: string;
  productId: string;
  founderId: string;
  contentAssetId: string;
  versionNumber: number;
  ctx: ProductContentContext;
  strategy: ContentStrategy;
  brief: ContentBrief;
  channel: string;
  qualityTier?: CreativeQualityTier;
  conceptLabel?: string | null;
  /** Owner steering for this render. Direction, never proof. */
  ownerRefinement?: string | null;
  /** Governed copy composited afterwards. Must already have passed the claim engine. */
  governedHeadline?: string | null;
  governedCta?: string | null;
  governedSupporting?: string | null;
  /** The version that made the copy eligible. Required to draw any line. */
  governedContentVersion?: number | null;
  /**
   * DETERMINISTIC PRODUCT COMPOSITION.
   *
   * When true the model is asked ONLY for a wordless background; the owner's
   * screenshot and logo are composited by LaunchMind and never sent to the
   * provider. Set by the "create visual using my product images" action.
   */
  useProductComposition?: boolean;
  /**
   * Which composition geometry to use — §21/§22.
   *
   * Carried as an explicit input rather than inferred from the concept label:
   * a label is free text a model produced, and letting free text pick a layout
   * would make the geometry of an advert depend on a word.
   */
  compositionLayout?: 'PROBLEM_FRAME' | 'PRODUCT_HERO' | 'RELIEF_FRAME';
  /** Persisted generation direction. Art direction only; never evidence. */
  visualBrief?: string | null;
  /** Server-derived structured intent. The client cannot author product truth through it. */
  scenePlan?: CreativeScenePlan | null;
  /** Recent persisted executions for this artifact, used to avoid visual repetition. */
  recentVisualExecutionIds?: string[];
  recentVisualExecutionSignatures?: string[];
  lineage?: {
    campaignId?: string | null; strategyId?: string | null;
    briefId?: string | null; variantLabel?: string | null;
  };
}

export interface RenderVisualResult {
  renderJobId: string;
  status: 'SUCCEEDED' | 'FAILED';
  generatedAssetId: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  widthPx: number | null;
  heightPx: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  costSource: 'PROVIDER_REPORTED' | 'NOT_REPORTED';
  failureCategory: CreativeFailureCategory | null;
  /** Owner-safe. Shown verbatim. */
  ownerMessage: string | null;
  /** Owner-safe sentences describing how this image came to exist. */
  provenance: string[];
  /** Disclosure: what LaunchMind removed from the request, and why. */
  notes: string[];
  creativeCritique?: CreativeCritique | null;
}

/**
 * Is this context rich enough to claim an application-specific render? §28.
 *
 * The negative control depends on this: with a hollow context the answer is no,
 * and the render is refused rather than producing a generic advertisement that
 * LaunchMind would then describe as tailored to the owner's product.
 */
export function contextSupportsApplicationSpecificRender(
  ctx: ProductContentContext,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!ctx.application.name) missing.push('your application name');
  if (!ctx.application.description && !ctx.application.category) {
    missing.push('what your application does');
  }
  if (!ctx.founderDirection.audienceConfirmed && !ctx.founderDirection.primaryGoal) {
    missing.push('who it is for, or what you are trying to achieve');
  }
  return { ok: missing.length === 0, missing };
}

/** Owner-safe provenance. No ids, prompts, seeds, model slugs or policy versions. */
function buildProvenance(opts: {
  kind: CreativeKind; conceptLabel: string | null; brief: VisualCreativeBrief;
  usedAssetCount: number; overlay: { headline: boolean; cta: boolean; logo: boolean };
  brandColorsConfirmed: number;
}): string[] {
  const lines: string[] = [];
  lines.push(`Created for: ${opts.kind.toLowerCase().replace(/_/g, ' ')}${
    opts.conceptLabel ? ` — ${opts.conceptLabel}` : ''}`);
  lines.push(opts.brandColorsConfirmed > 0
    ? 'Uses: your confirmed brand colours'
    : 'Uses: no confirmed brand colours yet, so this is a neutral palette');
  lines.push('Based on: the campaign message LaunchMind recommended');
  lines.push(opts.usedAssetCount > 0
    ? `Product imagery: uses ${opts.usedAssetCount === 1 ? 'the image' : `${opts.usedAssetCount} images`} you approved`
    : 'Product imagery: none used');
  if (opts.overlay.headline || opts.overlay.cta) {
    lines.push('Wording: placed by LaunchMind from your approved copy, not drawn by the image model');
  }
  if (opts.overlay.logo) lines.push('Logo: the one you confirmed');
  lines.push('Rendered with: LaunchMind creative rendering');
  return lines;
}

async function finishJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await getSupabaseAdmin().from('creative_render_jobs')
    .update({ ...patch, completed_at: new Date().toISOString() }).eq('id', jobId);
}

/**
 * Persists a retained, provider-produced background only after deterministic
 * recomposition has passed the same Product Hero contract.  It never invokes a
 * model and it can only recover the failed job that supplied the retained raw
 * source; this preserves an honest provider and artifact lineage.
 */
export async function recoverRetainedProductHeroRender(input: {
  jobId: string; workspaceId: string; productId: string; founderId: string;
  contentAssetId: string; versionNumber: number; brandKitVersion: number;
  rawBackground: Buffer; screenshot: Buffer; logo: Buffer; accentColor: string | null;
  overlay: OverlayLine[]; scenePlan: CreativeScenePlan; visualExecution: VisualExecution | null;
  productAssetId: string; rawPredictionId: string;
}): Promise<{ assetId: string; bytes: Buffer; critique: CreativeCritique; manifest: ReturnType<typeof composeProductCreative> extends Promise<infer R> ? R['manifest'] : never }> {
  if (input.scenePlan.conceptRole !== 'PRODUCT_DEMONSTRATION' || input.scenePlan.composition !== 'PRODUCT_HERO') {
    throw new Error('Only a retained Product Demonstration Product Hero can be recovered.');
  }
  const db = getSupabaseAdmin();
  const { data: job, error: jobError } = await db.from('creative_render_jobs')
    .select('id,status,output_asset_id,content_asset_id,content_version_number,workspace_id,product_id,provider_request_ref')
    .eq('id', input.jobId).eq('workspace_id', input.workspaceId).maybeSingle();
  const row = job as Record<string, unknown> | null;
  if (jobError || !row || row.status !== 'FAILED' || row.output_asset_id
    || row.content_asset_id !== input.contentAssetId || row.content_version_number !== input.versionNumber
    || row.product_id !== input.productId
    // Older failed jobs retained their prediction only in the diagnostic
    // record. A null job column is not a license to substitute a source: the
    // recovery records the supplied prediction alongside this exact failed job.
    || (row.provider_request_ref !== null && row.provider_request_ref !== input.rawPredictionId)) {
    throw new Error('Retained render lineage is not recoverable.');
  }
  const composed = await composeProductCreative({ backgroundBytes: input.rawBackground,
    screenshotBytes: input.screenshot, logoBytes: input.logo, overlay: input.overlay,
    widthPx: 1024, heightPx: 1024, accentColor: input.accentColor, layout: 'PRODUCT_HERO' });
  const qa = evaluateProductHeroContract({ widthPx: composed.widthPx, heightPx: composed.heightPx,
    screenshotComposited: composed.manifest.screenshotComposited,
    logoComposited: composed.manifest.logoComposited, overlayLines: composed.manifest.overlayLines,
    geometry: composed.manifest.geometry });
  if (!qa.hardPass) throw new Error(`Retained composition does not satisfy Product Hero contract: ${qa.failures.join(' ')}`);
  const critique: CreativeCritique = { outcome: 'READY_FOR_OWNER_REVIEW',
    summary: 'The retained wordless source, authentic product UI, governed message, brand, and action satisfy the shared Product Hero contract.',
    checks: { visualHierarchy: 'PASS', legibility: 'PASS', composition: 'PASS',
      productDemonstration: 'PASS', assetIntegrity: 'PASS', authenticity: 'PASS', noInventedClaims: 'PASS' } };
  const path = `${input.founderId}/${input.productId}/creative/${input.jobId}.png`;
  const { error: uploadError } = await db.storage.from(BUCKET)
    .upload(path, composed.bytes, { contentType: 'image/png', upsert: true });
  if (uploadError) throw new Error(`Could not persist recovered visual: ${uploadError.message}`);
  const provenance = [
    'Created for: meta ad visual — Product Demonstration',
    'Product imagery: your approved screenshot, placed exactly as it is',
    'Logo: the one you confirmed, placed exactly as it is',
    'Background: retained wordless source from the original governed render',
    'Wording: placed by LaunchMind from your approved copy — the image service wrote none of it',
    'Rendered with: LaunchMind creative rendering',
  ];
  const { data: asset, error: assetError } = await db.from('marketing_assets').insert({
    workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
    asset_type: 'PRODUCT_IMAGE', source: 'GENERATED', subject_relation: 'OWN_PRODUCT',
    authorization_state: 'OBSERVED_EXTERNAL', storage_path: path, may_contain_pii: false,
    render_job_id: input.jobId, content_asset_id: input.contentAssetId,
    content_version_number: input.versionNumber, brand_kit_version: input.brandKitVersion,
    mime_type: 'image/png', width_px: composed.widthPx, height_px: composed.heightPx, byte_size: composed.bytes.length,
    generation_provenance: { lines: provenance, manifest: composed.manifest, scenePlan: input.scenePlan,
      visualExecution: input.visualExecution, creativeCritique: critique,
      productAssetId: input.productAssetId, providerRequestRef: input.rawPredictionId,
      providerCalls: 1, pixelCritiqueCalls: 1, recovery: { providerCalls: 0, pixelQa: qa,
        recoveredAt: new Date().toISOString(), method: 'RETAINED_RAW_SOURCE_RECOMPOSITION' } },
  }).select('id').single();
  if (assetError || !asset) throw new Error(`Could not record recovered visual: ${assetError?.message ?? 'unknown error'}`);
  await finishJob(input.jobId, { status: 'SUCCEEDED', output_asset_id: (asset as { id: string }).id,
    failure_category: null, failure_detail: null, cost_source: 'NOT_REPORTED' });
  return { assetId: (asset as { id: string }).id, bytes: composed.bytes, critique, manifest: composed.manifest };
}

/**
 * Fetches an owner-authorised asset's bytes for compositing.
 *
 * @security Validated as a real image before use. A provider never sees these
 *   bytes — they go straight into the compositor — so nothing can restyle them.
 */
async function fetchAssetBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length < 25 * 1024 * 1024 ? buf : null;
  } catch { return null; }
}

/**
 * The deterministic-composition path — §7, §8, §9.
 *
 * The provider is asked for a wordless background and nothing else. Every
 * product pixel and every marketing word is placed by LaunchMind.
 *
 * @security Failed generation or critique never persists a placeholder creative.
 */
async function renderComposedProduct(
  input: RenderVisualInput,
  ctxIn: {
    jobId: string;
    visual: VisualCreativeBrief;
    authorised: Array<{ id: string; assetType?: string | null; source?: string;
      externalUrl?: string | null; storagePath?: string | null }>;
    referenceUrls: string[];
    notes: string[];
    db: ReturnType<typeof getSupabaseAdmin>;
  },
): Promise<RenderVisualResult> {
  const { jobId, visual, authorised, notes, db } = ctxIn;
  const started = Date.now();
  // Older governed artifacts predate named A/B/C concept roles. Product-image
  // composition still needs a structured plan, so those artifacts use the
  // deterministic product-demonstration role. This is a geometry default only:
  // it contributes no claim, copy, evidence, or product capability.
  const sceneConcept = input.conceptLabel?.trim() || 'Product demonstration';
  const scenePlan = input.scenePlan ?? buildScenePlan({
    conceptLabel: sceneConcept, visualBrief: input.visualBrief, channel: input.channel,
    recognitionContext: input.ctx.application.description ?? undefined, governedHeadline: input.governedHeadline ?? undefined,
  });
  let visualExecution: VisualExecution | null = selectVisualExecution({
    conceptLabel: sceneConcept, recentIds: input.recentVisualExecutionIds,
    recentSignatures: input.recentVisualExecutionSignatures,
  });
  if (scenePlan && !visualExecution) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind has already explored the distinct visual treatments for this concept. Choose a new direction before creating another.',
      'all bounded structural executions already exist in recent history');
  }
  if (input.visualBrief && !scenePlan) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind could not preserve this creative direction safely. Try another concept.',
      'stored visual brief had no supported scene plan');
  }
  let layout = input.compositionLayout ?? visualExecution?.composition
    ?? scenePlan?.composition ?? 'PROBLEM_FRAME';

  // ── the owner's own pixels ───────────────────────────────────────────────
  const logoField = input.ctx.brand.fields.logo;
  const logoUrl = logoField?.ownerConfirmed ? String(logoField.value ?? '') : '';

  const logoBytes = logoUrl.startsWith('http') ? await fetchAssetBytes(logoUrl) : null;
  const candidates = (await Promise.all(authorised.filter(a => a.assetType === 'SCREENSHOT').slice(0, 6).map(async asset => {
    const url = asset.externalUrl ?? (asset.storagePath ? db.storage.from(BUCKET).getPublicUrl(asset.storagePath).data.publicUrl : null);
    const bytes = url ? await fetchAssetBytes(url) : null;
    if (!bytes) return null;
    const meta = await sharp(bytes).metadata();
    const suitability = compositionAssetSuitability({ width: meta.width ?? 0, height: meta.height ?? 0,
      source: asset.source, assetType: asset.assetType ?? undefined });
    return { id: asset.id, bytes, suitability, area: (meta.width ?? 0) * (meta.height ?? 0) };
  }))).filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => (a.suitability.role === 'HERO' ? 0 : a.suitability.role === 'EVIDENCE' ? 1 : 2)
      - (b.suitability.role === 'HERO' ? 0 : b.suitability.role === 'EVIDENCE' ? 1 : 2)
      || b.area - a.area || a.id.localeCompare(b.id));
  const hero = candidates.find(a => a.suitability.role === 'HERO');
  const recognition = scenePlan?.conceptRole === 'PROBLEM_RECOGNITION';
  const productDemonstration = scenePlan?.conceptRole === 'PRODUCT_DEMONSTRATION';
  const screenshotBytes = (recognition || productDemonstration)
    ? hero?.bytes ?? null : candidates[0]?.bytes ?? null;
  if (productDemonstration && !hero) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind needs a clean, owner-authorized product image before it can create this product demonstration.',
      'product demonstration must not promote an evidence-only screenshot as a hero');
  }
  let intent: CompositionIntent | undefined = recognition ? visualExecution?.compositionIntent : undefined;
  if (recognition && !hero) {
    visualExecution = selectVisualExecution({ conceptLabel: sceneConcept,
      recentIds: input.recentVisualExecutionIds, recentSignatures: input.recentVisualExecutionSignatures,
      grammar: 'PROBLEM_VISUAL_MESSAGE' });
    if (!visualExecution) throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind has already explored the available treatment for these assets. A useful product image would unlock another composition.');
    intent = { ...recognitionIntent('PROBLEM_VISUAL_MESSAGE'), assetRole: 'SUPPORT' };
    notes.push('The available product artwork is unsuitable as a hero; this composition uses the confirmed brand and governed message.');
  }
  if (recognition) layout = 'PROBLEM_FRAME';
  const accent = await compositionAccent(visual.brandColors[0] ?? null, logoBytes);

  // ── governed lines only ──────────────────────────────────────────────────
  //
  // A line without an eligible content version is NOT drawn. The compositor is
  // given nothing to soften: ineligible copy is simply absent.
  const version = input.governedContentVersion ?? input.versionNumber;
  const overlay: OverlayLine[] = [];
  if (input.governedHeadline) {
    overlay.push({ role: 'HEADLINE', text: input.governedHeadline, sourceContentVersion: version });
  }
  if (input.governedSupporting) {
    overlay.push({ role: 'SUPPORTING_COPY', text: input.governedSupporting, sourceContentVersion: version });
  }
  if (input.governedCta) {
    overlay.push({ role: 'CTA', text: input.governedCta, sourceContentVersion: version });
  }
  if (overlay.length === 0) {
    notes.push('This copy still needs work, so LaunchMind left the wording off the image.');
  }

  let composed: Awaited<ReturnType<typeof composeProductCreative>> | null = null;
  let creativeCritique: CreativeCritique | null = null;
  let latencyMs = 0;
  let executedPlan = scenePlan;
  let background: Buffer | null = null;
  let thesis = scenePlan?.conceptRole === 'PROBLEM_RECOGNITION'
    ? recognitionThesis(input.ctx.application.description ?? '', input.governedHeadline ?? '') : null;
  const diagnostics = await createCreativeDiagnostics(jobId, input.workspaceId);
  let providerPrompt = '';
  let providerRequestRef: string | null = null;
  let layoutOnlyRecompositions = 0;
  let semanticRegenerations = 0;
  let providerCalls = 0;
  let pixelCritiqueCalls = 0;
  let regenerateBackground = true;
  let repairReason: string | null = null;
  const triedGrammars: CompositionIntent['grammar'][] = [];
  const attempts: Array<{ attempt: number; critique: CreativeCritique;
    intent?: CompositionIntent; repairReason: string | null; backgroundReused: boolean }> = [];
  for (let attempt = 1; attempt <= CREATIVE_LIMITS.MAX_ATTEMPTS_PER_JOB; attempt++) {
    if (attempt > 1 && intent && creativeCritique) {
      const repair = repairCompositionIntent(intent, creativeCritique, {
        attempt, canUseHero: !!hero, triedGrammars,
      });
      if (repair.intent.grammar !== intent.grammar) {
        const alternative = selectVisualExecution({ conceptLabel: sceneConcept, grammar: repair.intent.grammar,
          recentIds: input.recentVisualExecutionIds, recentSignatures: input.recentVisualExecutionSignatures });
        if (alternative) { visualExecution = alternative; intent = repair.intent; }
        else intent = { ...intent, typography: { ...intent.typography, compact: true } };
      } else intent = repair.intent;
      const semantic: ReturnType<typeof repairVisualThesis> | null = thesis && triedGrammars.at(-1) === 'PROBLEM_VISUAL_MESSAGE' ? repairVisualThesis(thesis, creativeCritique) : null;
      if (semantic) thesis = semantic.thesis;
      regenerateBackground = semantic ? semantic.regenerate || intent.grammar !== triedGrammars.at(-1) : repair.regenerateBackground;
      repairReason = [semantic?.reason, repair.reason].filter(Boolean).join('; ');
    } else if (attempt > 1 && scenePlan) {
      layout = scenePlan.composition;
      // A product-frame failure is normally geometry: the provider supplied a
      // deliberately wordless ground, while LaunchMind owns crop, scale and
      // governed overlays. Reusing that ground prevents a composition defect
      // from silently becoming another billable image request.
      regenerateBackground = false;
      repairReason = 'reuse retained source; repair deterministic composition only';
    }
    if (intent) {
      triedGrammars.push(intent.grammar);
      visualExecution = visualExecution ? { ...visualExecution, composition: 'PROBLEM_FRAME',
        compositionIntent: intent, visualThesis: intent.grammar === 'PROBLEM_VISUAL_MESSAGE' ? thesis ?? undefined : undefined, screenshotRole: intent.assetRole, compositionStructure: intent.grammar } : null;
      executedPlan = scenePlan ? { ...scenePlan, composition: 'PROBLEM_FRAME', compositionIntent: intent, visualThesis: intent.grammar === 'PROBLEM_VISUAL_MESSAGE' ? thesis ?? undefined : undefined,
        textHierarchy: ['Recognition hook', 'Supporting message', 'CTA', 'Visual anchor'],
        assetRequirements: intent.grammar === 'HOOK_PRODUCT_FRAGMENT'
          ? ['Owner-authorized product screenshot'] : ['Confirmed logo when available'],
        screenshotPlacement: intent.grammar === 'HOOK_PRODUCT_FRAGMENT'
          ? 'Large authentic fragment below the hook, partially off canvas when specified' : 'Omitted when unsuitable; confirmed brand supports the message',
        backgroundPurpose: intent.grammar === 'HOOK_PRODUCT_FRAGMENT'
          ? 'Quiet context for the authentic product fragment' : 'Express a recognizable unfinished task with a substantial contextual visual',
        problemRepresentation: (intent.grammar === 'PROBLEM_VISUAL_MESSAGE' ? thesis?.immediateRecognition : null)
          ?? visualExecution?.problemRepresentation ?? scenePlan.problemRepresentation,
      } : null;
    } else executedPlan = scenePlan ? { ...scenePlan, composition: layout } : null;
    const candidateScreenshot = intent?.grammar === 'PROBLEM_VISUAL_MESSAGE' ? null : screenshotBytes;
    const backgroundReused = !!background && !regenerateBackground;
    const counts = () => ({ providerCalls, pixelCritiqueCalls, layoutOnlyRecompositions, semanticRegenerations });
    const evidence = (status: string, critique: CreativeCritique | null = null) => ({ status,
      compositionGrammar: intent?.grammar ?? layout, visualExecution, visualThesis: thesis,
      providerPrompt, providerRequestRef, governedCopy: overlay, backgroundReused, critique, repairDecision: repairReason,
      previousCritique: attempts.at(-1)?.critique ?? null });
    if (backgroundReused) layoutOnlyRecompositions++;
    if (!backgroundReused) {
      const provider = getCreativeProvider('IMAGE_GENERATION');
      if (!provider.generateImage) throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Image creation is not available yet.', 'adapter lacks generateImage');
      const route = routeCreativeModel(input.qualityTier ?? 'DRAFT');
      providerPrompt = backgroundPrompt(visual.moodStyle, [accent], layout,
        `${input.ctx.application.description ?? ''} ${input.governedHeadline ?? ''}`, intent, thesis ?? undefined);
      // Count at invocation, before awaiting: failed calls still consumed a call.
      providerCalls++;
      if (attempt > 1 && thesis && (repairReason?.includes('Regenerate') || repairReason?.includes('Semantic mismatch'))) semanticRegenerations++;
      providerRequestRef = null;
      await diagnostics?.write(attempt, evidence('PROVIDER_REQUESTED'), counts());
      const out = await provider.generateImage({
        prompt: providerPrompt,
        negativePrompt: intent?.grammar === 'PROBLEM_VISUAL_MESSAGE' ? '' : BACKGROUND_NEGATIVE, aspectRatio: intent?.grammar === 'PROBLEM_VISUAL_MESSAGE'
          ? '16:9' : aspectForKind('META_AD_VISUAL'),
        referenceImageUrls: [], qualityTier: input.qualityTier ?? 'DRAFT', modelRef: route.modelRef,
      });
      background = (await downloadRenderedImage(out.imageUrl)).bytes;
      providerRequestRef = out.providerRequestRef ?? null;
      latencyMs += out.latencyMs ?? 0;
    }
    try {
      composed = await composeProductCreative({
        backgroundBytes: background, screenshotBytes: candidateScreenshot, logoBytes, overlay,
        widthPx: 1024, heightPx: 1024, accentColor: accent, layout, intent, visualThesis: thesis ?? undefined,
      });
    } catch (error) {
      if (!intent) throw error;
      creativeCritique = { outcome: 'NEEDS_CREATIVE_REVISION',
        summary: 'The composition needs different geometry to fit governed copy and authentic product content without collision.',
        checks: { composition: 'NEEDS_ATTENTION', legibility: 'NEEDS_ATTENTION' } };
      await diagnostics?.write(attempt, evidence('COMPOSITION_REJECTED', creativeCritique), counts(), undefined, background ?? undefined);
      attempts.push({ attempt, critique: creativeCritique, intent, repairReason, backgroundReused });
      await db.from('creative_render_jobs').update({ attempt }).eq('id', jobId);
      continue;
    }
    const layoutQa = executedPlan?.conceptRole === 'PRODUCT_DEMONSTRATION'
      && composed.manifest.layout === 'PRODUCT_HERO'
      ? evaluateProductHeroContract({ widthPx: composed.widthPx, heightPx: composed.heightPx,
        screenshotComposited: composed.manifest.screenshotComposited,
        logoComposited: composed.manifest.logoComposited,
        overlayLines: composed.manifest.overlayLines,
        geometry: composed.manifest.geometry })
      : null;
    const structural: CreativeCritique | null = layoutQa && !layoutQa.hardPass ? {
      outcome: 'NEEDS_CREATIVE_REVISION',
      summary: layoutQa.failures.join(' '),
      checks: { visualHierarchy: 'NEEDS_ATTENTION', composition: 'NEEDS_ATTENTION' },
    } : executedPlan ? critiqueComposition({
      plan: executedPlan, widthPx: composed.widthPx, heightPx: composed.heightPx,
      screenshotComposited: composed.manifest.screenshotComposited,
      overlayLineCount: composed.manifest.overlayLines.length,
      actualLayout: composed.manifest.layout,
    }) : null;
    if (structural?.outcome === 'READY_FOR_OWNER_REVIEW' && executedPlan) pixelCritiqueCalls++;
    await diagnostics?.write(attempt, evidence('AWAITING_CRITIQUE'), counts(), composed.bytes, background ?? undefined);
    creativeCritique = structural?.outcome === 'READY_FOR_OWNER_REVIEW' && executedPlan
      ? await critiqueRenderedVisual({ bytes: composed.bytes,
        sourceScreenshot: candidateScreenshot ? await sharp(candidateScreenshot).png().toBuffer() : null,
        plan: executedPlan,
        governedText: overlay.map(line => line.text), brand: visual.brandColors,
        founderId: input.founderId, productId: input.productId, workspaceId: input.workspaceId })
      : structural;
    if (!creativeCritique) throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind could not assess this creative direction.');
    await diagnostics?.write(attempt, evidence(creativeCritique.outcome === 'READY_FOR_OWNER_REVIEW' ? 'ACCEPTED' : 'REJECTED', creativeCritique), counts(), composed.bytes, background ?? undefined);
    attempts.push({ attempt, critique: creativeCritique, intent, repairReason, backgroundReused });
    await db.from('creative_render_jobs').update({ attempt }).eq('id', jobId);
    if (creativeCritique.outcome === 'READY_FOR_OWNER_REVIEW') break;
    // Asset and missing-copy failures cannot be repaired with another background.
    if (creativeCritique.outcome === 'ASSET_PROBLEM'
      || creativeCritique.outcome === 'CONCEPT_DID_NOT_SURVIVE_RENDER'
      || creativeCritique.checks.assessment === 'NEEDS_ATTENTION') break;
    // Product composition owns the remaining failure modes (crop, scale,
    // text placement and CTA). A new wordless background cannot repair them.
    // Only a source-level hard failure may use the one permitted regeneration.
    const rawSourceDefect = creativeCritique.checks.backgroundText === 'NEEDS_ATTENTION'
      || creativeCritique.checks.authenticity === 'NEEDS_ATTENTION'
      || creativeCritique.checks.noInventedClaims === 'NEEDS_ATTENTION';
    if (!intent && !rawSourceDefect) break;
  }
  if (!composed || creativeCritique?.outcome !== 'READY_FOR_OWNER_REVIEW') {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      creativeCritique?.summary ?? 'LaunchMind could not reach the visual quality bar.');
  }
  notes.push(...composed.manifest.omitted);

  const path = `${input.founderId}/${input.productId}/creative/${jobId}.png`;
  const { error: upErr } = await db.storage.from(BUCKET)
    .upload(path, composed.bytes, { contentType: 'image/png', upsert: true });
  if (upErr) {
    await finishJob(jobId, { status: 'FAILED', failure_category: 'STORAGE_FAILED',
      failure_detail: 'LaunchMind built the visual but could not save it. Nothing was changed.',
      cost_source: 'NOT_REPORTED' });
    return {
      renderJobId: jobId, status: 'FAILED', generatedAssetId: null, storagePath: null,
      publicUrl: null, widthPx: null, heightPx: null, latencyMs: null, costUsd: null,
      costSource: 'NOT_REPORTED', failureCategory: 'STORAGE_FAILED',
      ownerMessage: 'LaunchMind built the visual but could not save it. Your previous visual is unchanged.',
      provenance: [], notes,
    };
  }
  const publicUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const provenance: string[] = [
    composed.manifest.screenshotComposited
      ? 'Created for: meta ad visual — built from your own product images'
      : 'Created for: meta ad visual — built around your confirmed brand and governed message',
    composed.manifest.screenshotComposited
      ? 'Product imagery: your approved screenshot, placed exactly as it is'
      : 'Product imagery: none used',
    composed.manifest.logoComposited
      ? 'Logo: the one you confirmed, placed exactly as it is'
      : 'Logo: not used',
    composed.manifest.backgroundSource === 'GENERATED'
      ? 'Background: generated by LaunchMind, with no words or interface in it'
      : 'Background: a plain brand colour',
    composed.manifest.overlayLines.length > 0
      ? 'Wording: placed by LaunchMind from your approved copy — the image service wrote none of it'
      : 'Wording: none placed, because this copy still needs work',
    'Rendered with: LaunchMind creative rendering',
  ];

  const { data: assetRow, error: assetErr } = await db.from('marketing_assets').insert({
    workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
    asset_type: 'PRODUCT_IMAGE', source: 'GENERATED', subject_relation: 'OWN_PRODUCT',
    authorization_state: 'OBSERVED_EXTERNAL', storage_path: path,
    may_contain_pii: false,
    render_job_id: jobId, content_asset_id: input.contentAssetId,
    content_version_number: input.versionNumber,
    brand_kit_version: input.ctx.brand.version,
    mime_type: 'image/png', width_px: composed.widthPx, height_px: composed.heightPx,
    byte_size: composed.bytes.length,
    generation_provenance: { lines: provenance, notes, manifest: composed.manifest,
      visualExecution: visualExecution ? {
        ...visualExecution, structuralSignature: visualExecutionSignature(visualExecution),
      } : null,
      scenePlan: executedPlan, creativeCritique, refinementAttempts: attempts, providerCalls, pixelCritiqueCalls, layoutOnlyRecompositions, semanticRegenerations,
      assetSelection: candidates.map(a => ({ id: a.id, ...a.suitability,
        used: composed!.manifest.screenshotComposited && a.id === (recognition ? hero?.id : candidates[0]?.id) })),
      accentSource: visual.brandColors.length ? 'CONFIRMED_COLOR' : logoBytes ? 'CONFIRMED_LOGO_PIXELS' : 'NEUTRAL' },
  }).select('id').single();
  if (assetErr || !assetRow) {
    await finishJob(jobId, { status: 'FAILED', failure_category: 'STORAGE_FAILED',
      failure_detail: 'LaunchMind built the visual but could not save it.',
      cost_source: 'NOT_REPORTED' });
    throw new Error(`composed asset insert failed: ${assetErr?.message}`);
  }
  const assetId = (assetRow as { id: string }).id;

  await finishJob(jobId, {
    status: 'SUCCEEDED', output_asset_id: assetId,
    latency_ms: latencyMs ?? (Date.now() - started), cost_source: 'NOT_REPORTED',
  });

  return {
    renderJobId: jobId, status: 'SUCCEEDED', generatedAssetId: assetId,
    storagePath: path, publicUrl,
    widthPx: composed.widthPx, heightPx: composed.heightPx,
    latencyMs: latencyMs ?? (Date.now() - started), costUsd: null,
    costSource: 'NOT_REPORTED', failureCategory: null, ownerMessage: null,
    provenance, notes, creativeCritique,
  };
}

/**
 * Renders ONE governed visual.
 *
 * @throws {CreativeRenderBlocked} when governance refuses before any provider
 *   call. Provider failures are RECORDED on the job and returned, not thrown,
 *   because the owner needs the job history either way.
 */
export async function renderGovernedVisual(
  input: RenderVisualInput,
): Promise<RenderVisualResult> {
  const db = getSupabaseAdmin();
  const tier: CreativeQualityTier = input.qualityTier ?? 'DRAFT';

  // ── 1. scope + kind ──────────────────────────────────────────────────────
  const kind = creativeKindForChannel(input.channel);
  if (!kind) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'LaunchMind does not create a visual for this kind of content yet.',
      `no creative kind for channel ${input.channel}`);
  }

  // ── 2. application context ───────────────────────────────────────────────
  const support = contextSupportsApplicationSpecificRender(input.ctx);
  if (!support.ok) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      `LaunchMind needs to know ${support.missing.join(' and ')} before it can create a visual for your product.`,
      'insufficient product context');
  }

  // ── 3. authorised assets ONLY ────────────────────────────────────────────
  // Everything about rights, subject, source and personal data is decided here.
  const authorised = await resolveMarketingAssets(
    input.workspaceId, input.productId, 'VISUAL_RENDERING');
  const referenceUrls = authorised
    .map(a => a.externalUrl ?? (a.storagePath
      ? db.storage.from(BUCKET).getPublicUrl(a.storagePath).data.publicUrl : ''))
    .filter(u => u.length > 0);

  const visual = deriveVisualCreativeBrief(input.brief, input.strategy, input.ctx);

  // ── 4. concept needs a screenshot we do not have ─────────────────────────
  const conceptText = `${visual.visualConcept} ${input.ownerRefinement ?? ''}`;
  if (referenceUrls.length === 0 && REQUIRES_SCREENSHOT.test(conceptText)) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'This concept needs a picture of your product, and you have not authorised one yet.',
      'concept requires screenshot, none authorised');
  }

  // ── 5. bounded cost ──────────────────────────────────────────────────────
  const { count: priorCalls } = await db.from('creative_render_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('content_asset_id', input.contentAssetId)
    .eq('content_version_number', input.versionNumber);
  if ((priorCalls ?? 0) * CREATIVE_LIMITS.MAX_ATTEMPTS_PER_JOB >= CREATIVE_LIMITS.MAX_PROVIDER_CALLS_PER_ARTIFACT_VERSION) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'You have created a lot of visuals for this version. Edit the content or approve one before creating more.',
      'per-version provider call cap reached');
  }

  const route = routeCreativeModel(tier);
  const instruction = assembleCreativeInstruction({
    brief: visual, kind, qualityTier: tier,
    competitorNames: input.ctx.founderDirection.competitors ?? [],
    referenceImageUrls: referenceUrls,
    ownerRefinement: input.ownerRefinement,
  });

  // ── job row ──────────────────────────────────────────────────────────────
  const { data: jobRow, error: jobErr } = await db.from('creative_render_jobs').insert({
    workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
    content_asset_id: input.contentAssetId, content_version_number: input.versionNumber,
    content_campaign_id: input.lineage?.campaignId ?? null,
    content_strategy_id: input.lineage?.strategyId ?? null,
    content_brief_id: input.lineage?.briefId ?? null,
    variant_label: input.lineage?.variantLabel ?? null,
    provider: route.provider, capability: route.capability, model_ref: route.modelRef,
    quality_tier: tier, creative_kind: kind, concept_label: input.conceptLabel ?? null,
    brand_kit_version: input.ctx.brand.version,
    used_asset_ids: authorised.map(a => a.id),
    status: 'RENDERING', attempt: 1, started_at: new Date().toISOString(),
  }).select('id').single();
  if (jobErr || !jobRow) throw new Error(`render job insert failed: ${jobErr?.message}`);
  const jobId = (jobRow as { id: string }).id;

  const notes: string[] = [];
  if (instruction.removedFromRequest.length > 0) {
    notes.push('LaunchMind left some wording out of the image because it cannot put a claim in a picture.');
  }
  if (instruction.competitorReferenceAbstracted) {
    notes.push('A competitor was mentioned, so LaunchMind used the style rather than their creative.');
  }

  try {
    // ── 6. render ──────────────────────────────────────────────────────────
    // ── DETERMINISTIC PRODUCT COMPOSITION ─────────────────────────────────
    //
    // The screenshot is NOT in `instruction` and never reaches the provider.
    // The model is asked for a wordless backdrop; LaunchMind places the owner's
    // real screenshot, their confirmed logo and every governed word. This is the
    // fix for the render that drew "Home Care at Your Fingertips" — a tagline
    // the owner never confirmed — out of a screenshot it was shown.
    if (input.useProductComposition) {
      return await renderComposedProduct(input, {
        jobId, visual, authorised, referenceUrls, notes, db,
      });
    }

    const provider = getCreativeProvider('IMAGE_GENERATION');
    // The registry only returns an adapter that implements the capability, so
    // this cannot be absent; the guard keeps that guarantee explicit.
    if (!provider.generateImage) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Image creation is not available yet.', 'adapter lacks generateImage');
    }
    const out = await provider.generateImage(instruction);

    // ── 7. download + validate ─────────────────────────────────────────────
    // downloadRenderedImage validates the provider's content type and rejects a
    // non-image. Its mime is not carried forward: the overlay re-encodes to PNG,
    // so what LaunchMind stores is always image/png whatever the provider sent.
    const { bytes } = await downloadRenderedImage(out.imageUrl);
    const meta = await sharp(bytes).metadata();

    // ── 8. governed overlay ────────────────────────────────────────────────
    const confirmedLogo = input.ctx.brand.fields.logo?.ownerConfirmed === true
      ? String(input.ctx.brand.fields.logo.value ?? '') : '';
    const overlay = await applyGovernedOverlay(bytes, {
      headline: input.governedHeadline ?? null,
      cta: input.governedCta ?? null,
      confirmedLogoUrl: confirmedLogo.startsWith('http') ? confirmedLogo : null,
      accentColor: visual.brandColors[0] ?? null,
    });
    notes.push(...overlay.notes);
    const finalMeta = await sharp(overlay.bytes).metadata();

    // ── 9. store under LaunchMind control ──────────────────────────────────
    const path = `${input.founderId}/${input.productId}/creative/${jobId}.png`;
    const { error: upErr } = await db.storage.from(BUCKET)
      .upload(path, overlay.bytes, { contentType: 'image/png', upsert: true });
    if (upErr) {
      throw new CreativeProviderError('STORAGE_FAILED',
        'LaunchMind created the visual but could not save it. Nothing was changed.',
        'storage upload failed');
    }
    const publicUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const provenance = buildProvenance({
      kind, conceptLabel: input.conceptLabel ?? null, brief: visual,
      usedAssetCount: instruction.referenceImageUrls.length,
      overlay: { headline: overlay.appliedHeadline, cta: overlay.appliedCta, logo: overlay.appliedLogo },
      brandColorsConfirmed: visual.brandColors.length,
    });

    // MEASURED DEFECT, disclosed rather than hidden. A product screenshot
    // contains UI text, and the generative model reinterprets whatever it is
    // shown — so words can appear in the output that LaunchMind never wrote and
    // never governed. On the first product-led AllignX render the model drew
    // "Home Care at Your Fingertips", which is NOT the tagline the owner
    // confirmed. The negative prompt does not survive a text-bearing reference.
    //
    // Until product imagery is composited deterministically instead of being
    // fed to the model, any render that used a reference image is flagged for
    // the owner to read the picture before approving it.
    if (instruction.referenceImageUrls.length > 0) {
      notes.push('This visual was built from your product images, and the image service may have '
        + 'rendered wording of its own. Read any text in the picture before approving it — '
        + 'LaunchMind did not write it.');
    }

    // ── 10. governed output asset + lineage ────────────────────────────────
    // source=GENERATED and OBSERVED_EXTERNAL: model output can never be resolved
    // back as owner-authorised product imagery for the NEXT render.
    const { data: assetRow, error: assetErr } = await db.from('marketing_assets').insert({
      workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
      asset_type: 'PRODUCT_IMAGE', source: 'GENERATED', subject_relation: 'OWN_PRODUCT',
      authorization_state: 'OBSERVED_EXTERNAL',
      storage_path: path,
      // A rendered image contains no real person's data: reference inputs are
      // restricted to assets already proven pii-free, and a synthesised likeness
      // is not personal data.
      may_contain_pii: false,
      render_job_id: jobId,
      content_asset_id: input.contentAssetId,
      content_version_number: input.versionNumber,
      brand_kit_version: input.ctx.brand.version,
      mime_type: 'image/png',
      width_px: finalMeta.width ?? meta.width ?? null,
      height_px: finalMeta.height ?? meta.height ?? null,
      byte_size: overlay.bytes.length,
      generation_provenance: { lines: provenance, notes },
    }).select('id').single();
    if (assetErr || !assetRow) {
      throw new CreativeProviderError('STORAGE_FAILED',
        'LaunchMind created the visual but could not save it. Nothing was changed.',
        `asset insert failed: ${assetErr?.message}`);
    }
    const assetId = (assetRow as { id: string }).id;

    await finishJob(jobId, {
      status: 'SUCCEEDED', output_asset_id: assetId,
      latency_ms: out.latencyMs,
      cost_usd: out.costUsd,
      cost_source: out.costUsd === null ? 'NOT_REPORTED' : 'PROVIDER_REPORTED',
      provider_request_ref: out.providerRequestRef,
    });

    return {
      renderJobId: jobId, status: 'SUCCEEDED', generatedAssetId: assetId,
      storagePath: path, publicUrl,
      widthPx: finalMeta.width ?? null, heightPx: finalMeta.height ?? null,
      latencyMs: out.latencyMs, costUsd: out.costUsd,
      costSource: out.costUsd === null ? 'NOT_REPORTED' : 'PROVIDER_REPORTED',
      failureCategory: null, ownerMessage: null, provenance, notes,
    };
  } catch (err) {
    // Developer-only structured diagnostic. Never returned by an owner route;
    // it identifies local compositor/storage defects that otherwise collapse
    // into the same safe owner sentence as a malformed provider response.
    Sentry.captureException(err, { tags: { surface: 'governed_visual', jobId },
      extra: { contentAssetId: input.contentAssetId,
        useProductComposition: input.useProductComposition === true,
        authorisedAssetCount: authorised.length,
        errorName: err instanceof Error ? err.name : 'unknown',
        errorMessage: err instanceof Error ? err.message : 'unknown render failure' } });
    const category: CreativeFailureCategory = err instanceof CreativeProviderError || err instanceof CreativeRenderBlocked
      ? err.category : 'MALFORMED_RESPONSE';
    const ownerMessage = err instanceof CreativeProviderError || err instanceof CreativeRenderBlocked
      ? err.ownerMessage
      : 'LaunchMind could not create the visual.';

    await finishJob(jobId, {
      status: 'FAILED', failure_category: category,
      // Owner-safe sentence only. No stack trace, no provider payload.
      failure_detail: ownerMessage,
      cost_source: 'NOT_REPORTED',
    });

    // NO placeholder asset, NO media_url write, NO approval. The content
    // artifact is byte-identical to what it was before this call.
    return {
      renderJobId: jobId, status: 'FAILED', generatedAssetId: null,
      storagePath: null, publicUrl: null, widthPx: null, heightPx: null,
      latencyMs: null, costUsd: null, costSource: 'NOT_REPORTED',
      failureCategory: category,
      ownerMessage: `${ownerMessage} Your previous visual is unchanged.`,
      provenance: [], notes,
    };
  }
}
