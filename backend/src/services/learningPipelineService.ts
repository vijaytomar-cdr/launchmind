/**
 * @file learningPipelineService.ts
 * @description Learning ingestion pipeline — single entry point for all learning events.
 *   Writes a learning_events audit record, extracts memories from the event payload,
 *   deduplicates, persists to marketing_memories, and builds knowledge graph nodes/edges.
 *   Synchronous for founder-facing events; async (BullMQ) for high-volume events.
 * @security founderId comes from JWT — never from request body.
 * @dependencies marketingMemoryService, knowledgeGraphService, supabaseAdmin, Sentry
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  createMemory,
  findDuplicateMemory,
  updateMemory,
  addEvidence,
} from './marketingMemoryService';
import {
  createNode,
  createEdge,
} from './knowledgeGraphService';
import type { LearningEventType } from '../types/memory';

interface PipelineResult {
  eventId: string;
  memoriesCreated: number;
  memoriesUpdated: number;
  nodesCreated: number;
  edgesCreated: number;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Ingests a learning event through the full pipeline.
 * Writes audit record → extracts memories → deduplicates → persists → builds graph.
 * @returns Pipeline stats for observability.
 */
export async function ingestLearningEvent(
  founderId: string,
  productId: string | null,
  eventType: LearningEventType,
  payload: Record<string, unknown>,
): Promise<PipelineResult> {
  const supabase = getSupabaseAdmin();

  // 1. Write audit record
  const { data: event, error: eventErr } = await supabase
    .from('learning_events')
    .insert({ founder_id: founderId, product_id: productId ?? null, event_type: eventType, payload, status: 'processing' })
    .select('id')
    .single();

  if (eventErr || !event) {
    Sentry.captureException(eventErr, { tags: { service: 'learningPipeline', fn: 'ingestEvent' } });
    throw eventErr ?? new Error('Learning event insert failed');
  }

  const result: PipelineResult = { eventId: event.id, memoriesCreated: 0, memoriesUpdated: 0, nodesCreated: 0, edgesCreated: 0 };

  try {
    // 2. Dispatch to event-specific handler
    switch (eventType) {
      case 'intake_completed':
        await processIntakeEvent(founderId, productId, payload, result);
        break;
      case 'campaign_result':
        await processCampaignResult(founderId, productId, payload, result);
        break;
      case 'review_ingested':
        await processReviewIngested(founderId, productId, payload, result);
        break;
      case 'founder_feedback':
        await processFounderFeedback(founderId, productId, payload, result);
        break;
      case 'growth_brain_approved':
        await processGrowthBrainApproved(founderId, productId, payload, result);
        break;
      case 'analytics_synced':
        await processAnalyticsSynced(founderId, productId, payload, result);
        break;
      case 'experiment_result':
        await processExperimentResult(founderId, productId, payload, result);
        break;
      case 'ai_conversation':
        await processAiConversation(founderId, productId, payload, result);
        break;
    }

    // 3. Mark completed
    await supabase
      .from('learning_events')
      .update({
        status:           'completed',
        memories_created: result.memoriesCreated,
        memories_updated: result.memoriesUpdated,
        nodes_created:    result.nodesCreated,
        edges_created:    result.edgesCreated,
        processed_at:     new Date().toISOString(),
      })
      .eq('id', event.id);

  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'learningPipeline', event: eventType } });
    await supabase
      .from('learning_events')
      .update({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .eq('id', event.id);
    throw err;
  }

  return result;
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function processIntakeEvent(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const icp        = payload.confirmedIcp as Record<string, unknown> | undefined;
  const brandVoice = payload.brandVoiceProfile as Record<string, unknown> | undefined;
  const competitors = payload.competitorSet as unknown[] | undefined;
  const productName = (payload.productName as string | undefined) ?? 'Product';

  // 1. Product memory — what this product is
  if (icp) {
    await upsertMemory(founderId, productId, 'product', `${productName} — Product Profile`, {
      targetUser: icp.targetUser,
      painPoints: icp.painPoints,
      geography:  icp.geography,
      priceTier:  icp.priceTier,
    }, 'intake', 0.7, result);

    // 2. Customer memory — ICP
    await upsertMemory(founderId, productId, 'customer', `${productName} — Ideal Customer`, {
      targetUser: icp.targetUser,
      painPoints: icp.painPoints,
      geography:  icp.geography,
      suggestedMarkets: icp.suggestedMarkets,
    }, 'intake', 0.65, result);
  }

  // 3. Brand memory — voice + values
  if (brandVoice) {
    await upsertMemory(founderId, null, 'brand', `${productName} — Brand Voice`, brandVoice, 'intake', 0.6, result);
  }

  // 4. Competitor memories — one per competitor
  if (Array.isArray(competitors)) {
    for (const c of competitors.slice(0, 5)) {
      const comp = c as Record<string, unknown>;
      const title = `Competitor — ${(comp.name as string | undefined) ?? 'Unknown'}`;
      await upsertMemory(founderId, productId, 'competitor', title, comp, 'intake', 0.55, result);
    }
  }

  // 5. Build knowledge graph nodes
  if (productId && icp) {
    const productNode = await createNode(founderId, productId, 'product', productName, {}, productId, 'products', 0.8);
    result.nodesCreated++;

    if (icp.targetUser) {
      const personaNode = await createNode(founderId, productId, 'persona', icp.targetUser as string, {}, undefined, undefined, 0.65);
      result.nodesCreated++;
      await createEdge(founderId, productNode.id, personaNode.id, 'targets', 0.8).catch(() => null);
      result.edgesCreated++;
    }

    if (Array.isArray(icp.painPoints)) {
      for (const pain of (icp.painPoints as string[]).slice(0, 3)) {
        const featureNode = await createNode(founderId, productId, 'feature', pain, { type: 'pain_point' }, undefined, undefined, 0.6).catch(() => null);
        if (featureNode) {
          result.nodesCreated++;
          await createEdge(founderId, productNode.id, featureNode.id, 'has_feature', 0.7).catch(() => null);
          result.edgesCreated++;
        }
      }
    }

    if (Array.isArray(competitors)) {
      for (const c of competitors.slice(0, 3)) {
        const comp = c as Record<string, unknown>;
        const compName = (comp.name as string | undefined) ?? 'Competitor';
        const compNode = await createNode(founderId, productId, 'competitor', compName, comp, undefined, undefined, 0.5).catch(() => null);
        if (compNode) {
          result.nodesCreated++;
          await createEdge(founderId, productNode.id, compNode.id, 'competes_with', 0.7).catch(() => null);
          result.edgesCreated++;
        }
      }
    }
  }
}

async function processCampaignResult(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const channel      = payload.channel as string | undefined;
  const market       = payload.market as string | undefined;
  const hookType     = payload.hookType as string | undefined;
  const cpi          = payload.cpi as number | undefined;
  const ctr          = payload.ctr as number | undefined;
  const installs     = payload.installs as number | undefined;
  const campaignId   = payload.campaignId as string | undefined;
  const productName  = (payload.productName as string | undefined) ?? 'Product';

  if (!channel) return;

  const label     = `${channel} — ${market ?? 'all'} — Performance`;
  const confidence = ctr && ctr > 0.04 ? 0.8 : ctr && ctr > 0.02 ? 0.65 : 0.5;

  await upsertMemory(founderId, productId, 'campaign', label, {
    channel, market, hookType, cpi, ctr, installs, campaignId,
    performanceSignal: ctr && ctr > 0.04 ? 'strong' : ctr && ctr > 0.02 ? 'moderate' : 'weak',
  }, 'campaign_performance', confidence, result);

  // Evidence linking
  if (campaignId && productId) {
    const dupId = await findDuplicateMemory(founderId, productId, 'campaign', label);
    if (dupId) {
      await addEvidence(founderId, productId, dupId, 'campaign_metric', { ctr, cpi, installs }, confidence - 0.5, campaignId, 'campaigns');
    }
  }

  // Knowledge graph: channel node + campaign node
  if (productId) {
    const chanNode  = await createNode(founderId, productId, 'channel', channel, { market }, undefined, undefined, confidence).catch(() => null);
    if (chanNode) result.nodesCreated++;

    if (campaignId && chanNode) {
      const campNode = await createNode(founderId, productId, 'campaign', `${productName} ${channel} ${market ?? ''}`.trim(), { cpi, ctr, installs }, campaignId, 'campaigns', confidence).catch(() => null);
      if (campNode) {
        result.nodesCreated++;
        await createEdge(founderId, campNode.id, chanNode.id, 'appears_in', confidence).catch(() => null);
        result.edgesCreated++;
      }
    }
  }
}

async function processReviewIngested(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const themes    = payload.themes as string[] | undefined;
  const sentiment = payload.sentiment as string | undefined;
  const painPoint = payload.newPainPoint as string | undefined;
  const productName = (payload.productName as string | undefined) ?? 'Product';

  if (themes && themes.length > 0) {
    await upsertMemory(founderId, productId, 'review', `${productName} — Review Themes`, {
      themes, sentiment, sampleCount: payload.sampleCount ?? 1,
    }, 'review', 0.6, result);
  }

  if (painPoint) {
    await upsertMemory(founderId, productId, 'customer', `Customer Pain — ${painPoint}`, {
      painPoint, discoveredFrom: 'reviews',
    }, 'review', 0.55, result);
  }
}

async function processFounderFeedback(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const { memoryType, title, content, confidence } = payload as {
    memoryType: import('../types/memory').MemoryType;
    title: string;
    content: Record<string, unknown>;
    confidence?: number;
  };

  if (!memoryType || !title || !content) return;

  await upsertMemory(founderId, productId, memoryType, title, content, 'founder_feedback', confidence ?? 0.85, result);
}

async function processGrowthBrainApproved(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const positioning = payload.positioning as string | undefined;
  const channels    = payload.primaryChannels as string[] | undefined;
  const productName = (payload.productName as string | undefined) ?? 'Product';

  if (positioning) {
    await upsertMemory(founderId, productId, 'product', `${productName} — Approved Positioning`, {
      positioning, approvedAt: new Date().toISOString(),
    }, 'growth_brain', 0.9, result);
  }

  if (channels && productId) {
    for (const ch of channels) {
      const node = await createNode(founderId, productId, 'channel', ch, { approvedByGrowthBrain: true }, undefined, undefined, 0.85).catch(() => null);
      if (node) result.nodesCreated++;
    }
  }
}

async function processAnalyticsSynced(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const market     = payload.market as string | undefined;
  const metric     = payload.metric as string | undefined;
  const value      = payload.value as number | undefined;
  const productName = (payload.productName as string | undefined) ?? 'Product';

  if (market && metric) {
    await upsertMemory(founderId, productId, 'market', `${productName} — ${market} Analytics`, {
      market, metric, value, syncedAt: new Date().toISOString(),
    }, 'analytics', 0.6, result);
  }
}

async function processExperimentResult(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const hypothesis = payload.hypothesis as string | undefined;
  const outcome    = payload.outcome as string | undefined;
  const _productName = (payload.productName as string | undefined) ?? 'Product';

  if (hypothesis && outcome) {
    await upsertMemory(founderId, productId, 'experiment', `Experiment — ${hypothesis.slice(0, 60)}`, {
      hypothesis, outcome, significant: payload.significant,
    }, 'experiment', 0.75, result);
  }
}

async function processAiConversation(
  founderId: string,
  productId: string | null,
  payload: Record<string, unknown>,
  result: PipelineResult,
): Promise<void> {
  const learnings = payload.learnings as Array<{
    memoryType: import('../types/memory').MemoryType;
    title: string;
    content: Record<string, unknown>;
    confidence: number;
  }> | undefined;

  if (!Array.isArray(learnings)) return;

  for (const l of learnings.slice(0, 5)) {
    if (l.memoryType && l.title && l.content) {
      await upsertMemory(founderId, productId, l.memoryType, l.title, l.content, 'ai_conversation', l.confidence ?? 0.5, result);
    }
  }
}

// ── Shared upsert helper ──────────────────────────────────────────────────────

async function upsertMemory(
  founderId: string,
  productId: string | null,
  memoryType: import('../types/memory').MemoryType,
  title: string,
  content: Record<string, unknown>,
  source: import('../types/memory').MemorySource,
  confidence: number,
  result: PipelineResult,
): Promise<string> {
  const existingId = await findDuplicateMemory(founderId, productId, memoryType, title);

  if (existingId) {
    // Update existing memory — creates a version record
    await updateMemory(existingId, founderId, {
      content,
      confidence: Math.min(1.0, confidence + 0.05),
      change_note: `Re-ingested from ${source}`,
      changed_by: 'system',
    });
    result.memoriesUpdated++;
    return existingId;
  }

  const mem = await createMemory(founderId, productId, memoryType, title, content, source, confidence);
  result.memoriesCreated++;
  return mem.id;
}
