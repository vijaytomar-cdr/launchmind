import { generateCreativeSet } from './creativeSetOrchestrator';
import { CreativeRenderBlocked } from '../creative/creativeRenderService';
import { buildScenePlan, type CreativeScenePlan } from '../creative/scenePlan';
import { persistGovernedArtifact } from './contentArtifactPersistence';
import { deriveContentBrief } from './briefComposition';
import type { ChannelContentResult } from './b3ContentGeneration';
import type { ProductContentContext } from './productContentContext';
import type { ContentStrategy } from './strategyComposition';
import type { DetectOptions } from './hybridClaimDetection';
import type { CreativeBriefContract } from './creativeBriefContract';

export interface ProductionCreativeRenderInput {
  assetId: string;
  versionNumber: number;
  variantLabel: string;
  scenePlan: CreativeScenePlan;
  creativeBrief: CreativeBriefContract;
  content: Record<string, unknown>;
}

export type ProductionCreativeRender = (input: ProductionCreativeRenderInput) => Promise<void>;

export interface ProductionCreativeArtifact {
  variantLabel: string;
  assetId: string | null;
  versionNumber: number | null;
  result: ChannelContentResult;
}

/**
 * Adapter from the package decision into the creative-set production lane.
 * Creative Intelligence may shape structure; all product truth still comes
 * from the governed context and the normal content-generation gates.
 */
export async function produceMetaCreativeArtifacts(input: {
  ctx: ProductContentContext;
  strategy: ContentStrategy;
  campaignId: string;
  strategyId: string;
  briefId: string;
  founderId: string;
  provenance: string[];
  mode: 'AI_CMO_RECOMMENDED' | 'OWNER_DIRECTED';
  persist: boolean;
  generate?: (system: string, user: string) => Promise<string>;
  semantic?: DetectOptions['semantic'];
  creativePatterns?: readonly string[];
  firstPartyLearning?: readonly string[];
  render?: ProductionCreativeRender;
}): Promise<{ artifacts: ProductionCreativeArtifact[];
  skipped: Array<{ state: string; reason: string }>; generationUnavailable: boolean;
  timingsMs?: Record<string, number> }> {
  const set = await generateCreativeSet({
    ctx: input.ctx, strategy: input.strategy, founderId: input.founderId,
    channel: 'META_AD', generate: input.generate, semantic: input.semantic,
    maxConceptAttempts: 3,
    creativePatterns: input.creativePatterns, firstPartyLearning: input.firstPartyLearning,
  });
  const brief = deriveContentBrief('META_AD', input.strategy, input.ctx);
  const artifacts: ProductionCreativeArtifact[] = [];
  const skipped: Array<{ state: string; reason: string }> = [];
  let persistenceMs = 0;

  for (const concept of set.concepts) {
    if (!concept.result || !concept.creativeBrief) {
      skipped.push({ state: concept.status,
        reason: concept.ownerReason ?? `${concept.name} could not be created` });
      continue;
    }
    const scenePlan = buildScenePlan({ conceptLabel: concept.name,
      visualBrief: typeof concept.result.payload.visualBrief === 'string'
        ? concept.result.payload.visualBrief : null, channel: 'META_AD' });
    if (!scenePlan) throw new Error(`creative scene plan missing for ${concept.name}`);
    const result: ChannelContentResult = { ...concept.result,
      payload: { ...concept.result.payload, creativeBrief: concept.creativeBrief, scenePlan } };
    let assetId: string | null = null;
    let versionNumber: number | null = null;
    if (input.persist && result.fields.length > 0) {
      const persistenceStartedAt = Date.now();
      const saved = await persistGovernedArtifact({
        identity: { workspaceId: input.ctx.workspaceId, productId: input.ctx.productId,
          campaignId: input.campaignId, strategyId: input.strategyId, briefId: input.briefId,
          // `variant_group_id` is a UUID column. The campaign id is already a
          // stable workspace-scoped UUID and one campaign has one current Meta
          // concept set, so it is the correct persisted group identity. The
          // previous descriptive string made every successful generation fail
          // only when the database insert began.
          channel: 'META_AD', variantGroupId: input.campaignId,
          variantLabel: concept.name },
        result, brief, ctx: input.ctx, founderId: input.founderId,
        provenance: input.provenance, mode: input.mode,
      });
      persistenceMs += Date.now() - persistenceStartedAt;
      assetId = saved.assetId; versionNumber = saved.versionNumber;
      if (concept.status === 'READY') {
        try {
          if (input.render) {
            await input.render({ assetId, versionNumber, variantLabel: concept.name,
              scenePlan, creativeBrief: concept.creativeBrief, content: result.payload });
          } else {
            const { renderGovernedVisual } = await import('../creative/creativeRenderService');
            const visual = await renderGovernedVisual({
              workspaceId: input.ctx.workspaceId, productId: input.ctx.productId,
              founderId: input.founderId, contentAssetId: assetId, versionNumber,
              ctx: input.ctx, strategy: input.strategy, brief, channel: 'META_AD',
              conceptLabel: concept.name, scenePlan, useProductComposition: true,
              compositionLayout: scenePlan.composition,
              visualBrief: scenePlan.sourceVisualBrief,
              governedHeadline: String(result.payload.headline ?? ''),
              governedSupporting: String(result.payload.description ?? ''),
              governedCta: String(result.payload.cta ?? ''),
              governedContentVersion: versionNumber,
              lineage: { campaignId: input.campaignId, strategyId: input.strategyId,
                briefId: input.briefId, variantLabel: concept.name },
            });
            if (visual.status !== 'SUCCEEDED') skipped.push({ state: 'CREATIVE_REFINEMENT_FAILED',
              reason: visual.ownerMessage ?? 'LaunchMind could not reach the visual quality bar.' });
          }
        } catch (error) {
          if (!(error instanceof CreativeRenderBlocked)) throw error;
          skipped.push({ state: 'CREATIVE_REFINEMENT_FAILED', reason: error.ownerMessage });
        }
      }
    }
    artifacts.push({ variantLabel: concept.name, assetId, versionNumber, result });
  }
  return { artifacts, skipped,
    generationUnavailable: set.concepts.some(c => c.result?.disposition === 'DEGRADED'),
    timingsMs: { ...set.timingsMs, persistence: persistenceMs } };
}
