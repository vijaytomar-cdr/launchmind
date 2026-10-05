/**
 * @file contentPackageOrchestrator.ts
 * @description Package → briefs → governed artifacts → versions. Phase 3.5B4.
 *
 *   ORCHESTRATION ONLY. Every channel artifact is produced by the B3 pipeline
 *   (`generateChannelContent`) and persisted by the B3.1 path. This file
 *   contains **no channel-specific generation logic** — a test greps it for
 *   channel shapes, because the moment an orchestrator starts special-casing a
 *   channel it becomes a second, ungoverned generator.
 *
 *   ONE CAMPAIGN, ONE NARRATIVE. Every brief is derived from the SAME strategy,
 *   so the thesis is identical across Google, Meta, landing page, LinkedIn and
 *   video while hooks, tone and format adapt per surface.
 *
 *   A BLOCKED ITEM IS SKIPPED, NOT FAILED. The package reports why, and the
 *   other channels still produce. Refusing the whole package because a video
 *   needs an avatar choice would punish the owner for a decision they have not
 *   been asked to make yet.
 *
 * @security Creates campaigns, strategies, briefs, artifacts and versions only.
 *   No publish, launch, schedule, spend, provider call or Marketing Memory write
 *   is reachable from here.
 * @dependencies contentPackagePolicy, briefComposition, b3ContentGeneration,
 *   contentArtifactPersistence, creativeBriefs
 */

import { planContentPackage, validatePackage, type ContentPackage, type PackageItem } from './contentPackagePolicy';
import { deriveContentBrief, type B3Channel } from './briefComposition';
import { generateChannelContent, type ChannelContentResult } from './b3ContentGeneration';
import { persistGovernedArtifact } from './contentArtifactPersistence';
import { artifactProvenance } from './creativeBriefs';
import type { ContentStrategy } from './strategyComposition';
import type { ProductContentContext } from './productContentContext';
import type { DetectOptions } from './hybridClaimDetection';
import { produceMetaCreativeArtifacts, type ProductionCreativeRender }
  from './productionCreativeSet';

export interface OrchestrationInput {
  ctx: ProductContentContext;
  strategy: ContentStrategy;
  campaignId: string;
  strategyId: string;
  opportunityTitle: string;
  campaignName: string;
  founderId: string;
  mode: 'AI_CMO_RECOMMENDED' | 'OWNER_DIRECTED';
  /** Server-derived brief ids, one per channel. */
  briefIds: Partial<Record<B3Channel, string>>;
  avatarVoiceChosen?: boolean;
  /** Which video mode this package assumes. Defaults to PRODUCT_MOTION — §8. */
  videoMode?: 'PRODUCT_MOTION' | 'AVATAR_SPOKESPERSON' | 'VOICEOVER_CREATIVE';
  /** Test seams ONLY. */
  generate?: (system: string, user: string) => Promise<string>;
  semantic?: DetectOptions['semantic'];
  /** Persist artifacts. False keeps the run entirely in memory. */
  persist?: boolean;
  /** Production supported-static path. Other channels keep the package pipeline. */
  useCreativeSetForMeta?: boolean;
  creativePatterns?: readonly string[];
  firstPartyLearning?: readonly string[];
  renderConcept?: ProductionCreativeRender;
  /** Production-only bounded fan-out for independent variants. */
  parallelVariants?: boolean;
}

export interface GeneratedPackageItem {
  channel: B3Channel;
  variantLabel: string | null;
  assetId: string | null;
  versionNumber: number | null;
  disposition: ChannelContentResult['disposition'];
  reasons: string[];
  quality: ChannelContentResult['quality'];
}

export interface OrchestrationResult {
  package: ContentPackage;
  generated: GeneratedPackageItem[];
  /** Items deliberately not generated, with an owner-safe reason. */
  skipped: Array<{ channel: B3Channel; state: string; reason: string }>;
  provenance: string[];
  narrativeThesis: string;
  generationUnavailable: boolean;
  /** Developer evidence only. Never rendered in owner content. */
  timingsMs: Record<string, number>;
}

/**
 * Plans and produces the package.
 *
 * @security Scope comes from `ctx`. A blocked item is skipped with its reason;
 *   nothing is substituted for a missing asset or an unmade owner decision.
 */
export async function orchestrateContentPackage(
  input: OrchestrationInput,
): Promise<OrchestrationResult> {
  const { ctx, strategy } = input;

  const pkg = planContentPackage({
    campaignId: input.campaignId,
    channels: strategy.messageHierarchy.length >= 0
      ? (Object.keys(input.briefIds) as B3Channel[])
      : [],
    authorizedAssetCount: ctx.authorizedAssets.length,
    hasEvidence: strategy.proofAvailable.length > 0,
    ownerConfirmationRequired: unresolvedFields(ctx, strategy),
    avatarVoiceChosen: input.avatarVoiceChosen === true,
    videoMode: input.videoMode,
    opportunityType: 'PRODUCT_BENEFIT',
  });

  const limits = validatePackage(pkg);
  if (!limits.ok) {
    // A plan that breaks its own ceiling is a bug, not a bigger campaign.
    throw new Error(`package exceeds its limits: ${limits.violations.join('; ')}`);
  }

  const provenance = artifactProvenance({
    ctx, strategy,
    opportunityTitle: input.opportunityTitle, campaignName: input.campaignName,
  });

  const generated: GeneratedPackageItem[] = [];
  const skipped: OrchestrationResult['skipped'] = [];
  let generationUnavailable = false;
  const timingsMs: Record<string, number> = {};

  packageItems: for (const item of pkg.items) {
    const channel = item.channel as B3Channel;
    const briefId = input.briefIds[channel];
    if (item.state !== 'READY_TO_GENERATE') {
      skipped.push({ channel, state: item.state, reason: item.blockedReason ?? 'blocked' });
      continue;
    }
    if (!briefId) {
      skipped.push({ channel, state: 'UNSUPPORTED_CHANNEL', reason: 'no brief for this channel' });
      continue;
    }

    // ONE strategy → many briefs. The thesis cannot drift between channels
    // because it is never re-derived per channel.
    const brief = deriveContentBrief(channel, strategy, ctx);
    if (channel === 'META_AD' && input.useCreativeSetForMeta) {
      const produced = await produceMetaCreativeArtifacts({ ctx, strategy,
        campaignId: input.campaignId, strategyId: input.strategyId, briefId,
        founderId: input.founderId, provenance, mode: input.mode,
        persist: input.persist !== false, generate: input.generate, semantic: input.semantic,
        creativePatterns: input.creativePatterns, firstPartyLearning: input.firstPartyLearning,
        render: input.renderConcept });
      for (const [stage, duration] of Object.entries(produced.timingsMs ?? {})) {
        timingsMs[`meta.${stage}`] = duration;
      }
      skipped.push(...produced.skipped.map(s => ({ channel, ...s })));
      generated.push(...produced.artifacts.map(a => ({ channel,
        variantLabel: a.variantLabel, assetId: a.assetId, versionNumber: a.versionNumber,
        disposition: a.result.disposition, reasons: a.result.reasons, quality: a.result.quality })));
      if (produced.generationUnavailable) {
        generationUnavailable = true;
        break;
      }
      continue;
    }
    const variantLabels = item.variants.length > 0
      ? item.variants.map(v => v.label) : [null];
    // UUID column and one package group per campaign. The old descriptive
    // string passed validation in TypeScript but failed only at the database.
    const variantGroupId = item.variants.length > 0 ? input.campaignId : null;

    const produceVariant = async (label: string | null): Promise<{
      generated: GeneratedPackageItem | null; degraded: boolean;
    }> => {
      const stageKey = `${channel}.${label ?? 'default'}`;
      const generationStartedAt = Date.now();
      const result = await generateChannelContent({
        brief, strategy, ctx, founderId: input.founderId,
        variantLabel: label, maxRewrites: 0,
        generate: input.generate, semantic: input.semantic,
      });
      timingsMs[`${stageKey}.generation_and_governance`] = Date.now() - generationStartedAt;

      // DEGRADED means the generator did not return usable content, not that
      // this one variant needs a rewrite. It is an authoritative availability
      // failure for this request, so stop before probing sibling variants or
      // later channels. Previously a known outage could be multiplied across
      // the whole package before the owner saw one generic failure.
      if (result.disposition === 'DEGRADED') {
        return { generated: null, degraded: true };
      }

      let assetId: string | null = null;
      let versionNumber: number | null = null;
      if (input.persist !== false && result.fields.length > 0) {
        const persistenceStartedAt = Date.now();
        const persisted = await persistGovernedArtifact({
          identity: {
            workspaceId: ctx.workspaceId, productId: ctx.productId,
            campaignId: input.campaignId, strategyId: input.strategyId,
            briefId, channel,
            variantGroupId, variantLabel: label,
          },
          result, brief, ctx, founderId: input.founderId, provenance, mode: input.mode,
        });
        assetId = persisted.assetId;
        versionNumber = persisted.versionNumber;
        timingsMs[`${stageKey}.persistence`] = Date.now() - persistenceStartedAt;
      }

      return { degraded: false, generated: {
        channel, variantLabel: label, assetId, versionNumber,
        disposition: result.disposition, reasons: result.reasons, quality: result.quality,
      } };
    };

    const variantResults = input.parallelVariants && variantLabels.length > 1
      ? await Promise.all(variantLabels.map(produceVariant))
      : await (async () => {
          const results: Awaited<ReturnType<typeof produceVariant>>[] = [];
          for (const label of variantLabels) {
            const result = await produceVariant(label);
            results.push(result);
            if (result.degraded) break;
          }
          return results;
        })();
    for (const result of variantResults) {
      if (result.generated) generated.push(result.generated);
      if (result.degraded) generationUnavailable = true;
    }
    if (generationUnavailable) break packageItems;
  }

  return { package: pkg, generated, skipped, provenance,
    narrativeThesis: strategy.campaignThesis, generationUnavailable, timingsMs };
}

/** Governed fields still unresolved for this product. */
function unresolvedFields(ctx: ProductContentContext, strategy: ContentStrategy): string[] {
  const out: string[] = [];
  if (!ctx.brand.fields.cta_destination?.ownerConfirmed) out.push('ctaDestination');
  if (!ctx.brand.fields.pricing?.ownerConfirmed) out.push('pricing');
  if (strategy.proofUnavailable.some(p => /offer/i.test(p))) out.push('offer');
  return out;
}

export interface OwnerPackageView {
  campaignName: string;
  thesis: string;
  items: Array<{
    channel: string;
    label: string;
    status: 'READY' | 'NEEDS_YOU' | 'NEEDS_PROOF' | 'NEEDS_ASSET' | 'NOT_AVAILABLE';
    why: string;
    blockedReason: string | null;
    count: number;
    variants: string[];
  }>;
  reviewFirst: string | null;
  notes: string[];
  readyCount: number;
  blockedCount: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  GOOGLE_RSA: 'Google Ads', META_AD: 'Meta Ads', LANDING_PAGE: 'Landing page',
  LINKEDIN_POST: 'LinkedIn', SHORT_FORM_VIDEO_SCRIPT: 'Short video',
};

const STATE_LABEL: Record<string, OwnerPackageView['items'][number]['status']> = {
  READY_TO_GENERATE: 'READY',
  BLOCKED_ON_OWNER_CONFIRMATION: 'NEEDS_YOU',
  BLOCKED_ON_PROOF: 'NEEDS_PROOF',
  BLOCKED_ON_ASSET: 'NEEDS_ASSET',
  UNSUPPORTED_CHANNEL: 'NOT_AVAILABLE',
};

/**
 * The owner-facing package.
 *
 * @security Owner-safe copy only — no ids, handles, enums beyond the plain
 *   status words, prompts or policy internals.
 */
export function ownerPackageView(
  pkg: ContentPackage, campaignName: string, thesis: string,
): OwnerPackageView {
  return {
    campaignName, thesis,
    items: pkg.items.map((i: PackageItem) => ({
      channel: i.channel,
      label: CHANNEL_LABEL[i.channel] ?? i.channel,
      status: STATE_LABEL[i.state] ?? 'NOT_AVAILABLE',
      why: i.reason,
      blockedReason: i.blockedReason,
      count: i.quantity,
      variants: i.variants.map(v => v.label),
    })),
    reviewFirst: pkg.reviewFirst
      ? `${CHANNEL_LABEL[pkg.reviewFirst.channel] ?? pkg.reviewFirst.channel} — ${pkg.reviewFirst.reason}`
      : null,
    notes: pkg.notes,
    readyCount: pkg.readyCount,
    blockedCount: pkg.blockedCount,
  };
}
