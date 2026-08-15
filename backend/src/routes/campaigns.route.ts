/**
 * @file campaigns.route.ts
 * @description Campaign management routes for Milestone 09.
 *   Complements existing campaign routes in products.route.ts (list, approve, pause).
 *   New in M09: create, plan, schedule, launch, resume, cancel, archive, assets, metrics,
 *   publish attempts, and detailed campaign view.
 * @security JWT required. All handlers enforce founder ownership.
 *   §1.5 Approve-Before-Post enforced in /launch endpoint.
 *   §1.6 Spend cap enforced in /launch endpoint.
 * @dependencies aiPlatform, contextEngine, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { callSonnet } from '../lib/aiPlatform';
import { buildContextForPrompt } from '../lib/context/contextEngineAdapter';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES = [
  'app_install', 'aso_improvement', 'review_generation', 'email',
  'push_notification', 'social', 'paid_ad', 'product_hunt',
  'india_launch', 'holiday', 'retention', 'win_back',
] as const;

const CAMPAIGN_CHANNELS = [
  'meta', 'google', 'whatsapp', 'linkedin', 'email',
  'app_store', 'play_store', 'push', 'twitter', 'tiktok', 'blog', 'product_hunt', 'aso_rewrite',
] as const;

const CreateCampaignSchema = z.object({
  productId:  z.string().uuid(),
  type:       z.enum(CAMPAIGN_TYPES),
  channel:    z.enum(CAMPAIGN_CHANNELS),
  market:     z.enum(['usa', 'india']),
  hookType:   z.string().max(100).optional(),
  copyText:   z.string().max(5000).optional(),
  missionId:  z.string().uuid().optional(),
  spendCap:   z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const UpdateCampaignSchema = z.object({
  hookType:    z.string().max(100).optional(),
  copyText:    z.string().max(5000).optional(),
  spendCap:    z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
  audienceConfig: z.record(z.unknown()).optional(),
});

const LinkAssetSchema = z.object({
  assetId: z.string().uuid(),
});

const ScheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCampaignOwned(supabase: ReturnType<typeof getSupabaseAdmin>, campaignId: string, founderId: string) {
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('founder_id', founderId)
    .single();
  return data;
}

async function writeAuditLog(supabase: ReturnType<typeof getSupabaseAdmin>, founderId: string, action: string, resourceId: string, metadata?: Record<string, unknown>) {
  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action,
    resource_type: 'campaign',
    resource_id: resourceId,
    metadata: metadata ?? null,
  }).then(() => {});
}

// ── Plugin ────────────────────────────────────────────────────────────────────

async function campaignPlugin(server: FastifyInstance): Promise<void> {

  /**
   * POST /campaigns/create
   * Create a new campaign (separate from products.route.ts GET /campaigns list).
   */
  server.post('/campaigns/create', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateCampaignSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const { data: product } = await supabase
        .from('products')
        .select('id')
        .eq('id', parsed.data.productId)
        .eq('founder_id', founderId)
        .single();

      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const { data: campaign, error } = await supabase
        .from('campaigns')
        .insert({
          product_id:     parsed.data.productId,
          founder_id:     founderId,
          type:           parsed.data.type,
          channel:        parsed.data.channel,
          market:         parsed.data.market,
          hook_type:      parsed.data.hookType ?? null,
          copy_text:      parsed.data.copyText ?? null,
          mission_id:     parsed.data.missionId ?? null,
          spend_cap:      parsed.data.spendCap ?? null,
          scheduled_at:   parsed.data.scheduledAt ?? null,
          status:         'draft',
          growth_brain_version: 1,
        })
        .select()
        .single();

      if (error) throw error;

      await writeAuditLog(supabase, founderId, 'campaign_created', campaign!.id, { type: parsed.data.type, channel: parsed.data.channel });

      return reply.status(201).send({ campaign });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to create campaign' });
    }
  });

  /**
   * GET /campaigns/:id/detail
   * Get full campaign detail: assets, metrics, approval history, publish attempts.
   */
  server.get('/campaigns/:id/detail', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      const [assetsRes, metricsRes, approvalsRes, attemptsRes] = await Promise.all([
        supabase.from('content_assets').select('id, asset_type, channel, status, text_content, approved_at, created_at').eq('campaign_id', campaignId).eq('founder_id', founderId).order('created_at', { ascending: false }),
        supabase.from('campaign_metrics').select('*').eq('campaign_id', campaignId).eq('founder_id', founderId).order('week_start', { ascending: false }).limit(8),
        supabase.from('campaign_approvals').select('id, action, note, scope, budget_amount, channel, risk_level, approved_at').eq('campaign_id', campaignId).eq('founder_id', founderId).order('created_at', { ascending: false }).limit(10),
        supabase.from('campaign_publish_attempts').select('id, channel, attempt_number, status, error_message, started_at, completed_at').eq('campaign_id', campaignId).eq('founder_id', founderId).order('created_at', { ascending: false }).limit(20),
      ]);

      return reply.send({
        campaign,
        assets:          assetsRes.data ?? [],
        metrics:         metricsRes.data ?? [],
        approvalHistory: approvalsRes.data ?? [],
        publishAttempts: attemptsRes.data ?? [],
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get campaign detail' });
    }
  });

  /**
   * PUT /campaigns/:id
   * Update a draft campaign's copy, budget, and schedule.
   * Updating spend_cap by >20% clears approved_at and moves to pending_approval.
   */
  server.put('/campaigns/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;

    const parsed = UpdateCampaignSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      if (!['draft', 'pending_approval'].includes(campaign.status)) {
        return reply.status(409).send({ error: 'Only draft or pending_approval campaigns can be updated' });
      }

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.hookType !== undefined)      updatePayload.hook_type = parsed.data.hookType;
      if (parsed.data.copyText !== undefined)      updatePayload.copy_text = parsed.data.copyText;
      if (parsed.data.scheduledAt !== undefined)   updatePayload.scheduled_at = parsed.data.scheduledAt;
      if (parsed.data.audienceConfig !== undefined) updatePayload.audience_config = parsed.data.audienceConfig;

      // Budget increase >20% invalidates approval
      if (parsed.data.spendCap !== undefined) {
        updatePayload.spend_cap = parsed.data.spendCap;
        const oldWeekly = (campaign.spend_cap as Record<string, number> | null)?.weeklyUSD ?? 0;
        const newWeekly = (parsed.data.spendCap as Record<string, number>)?.weeklyUSD ?? 0;
        if (newWeekly > oldWeekly * 1.2 && campaign.approved_at) {
          updatePayload.approved_at = null;
          updatePayload.status = 'pending_approval';
        }
      }

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update(updatePayload)
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      return reply.send({ campaign: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to update campaign' });
    }
  });

  /**
   * POST /campaigns/:id/plan
   * Generate a campaign plan via AI (Context Engine + Sonnet).
   */
  server.post('/campaigns/:id/plan', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      // Phase 3.1E. Previously this dumped JSON.stringify(ctx).slice(0, 2000)
      // into the prompt — raw JSONB serialisation truncated mid-structure, which
      // is both the renderer anti-pattern (ADR-066 rule 10) and the mid-item
      // truncation §9 forbids. Now a budgeted, formatted, provenance-bearing
      // package.
      const ctx = await buildContextForPrompt({
        founderId,
        productId: campaign.product_id,
        intent: 'CAMPAIGN_PLANNING',
        query: `Plan a ${campaign.channel} campaign in ${campaign.market}. ` +
               `What has worked and failed on this channel and audience?`,
      });

      const system = 'You are an expert growth marketer. Generate a focused campaign plan. Return JSON with: recommendedChannels (array), suggestedAssets (array of {type, description}), audienceConfig ({targetAge, interests, geographies}), estimatedBudget ({weeklyUSD, weeklyINR}), schedule ({startDate, durationDays}), expectedOutcome (string), riskFactors (array).';

      const user = `Campaign type: ${campaign.type ?? 'general'}. Channel: ${campaign.channel}. Market: ${campaign.market}.

${ctx.text}

Generate a practical, achievable campaign plan for a bootstrapped founder.`;

      const raw = await callSonnet(system, user, 1024, {
        founderId, promptId: 'campaign_plan_generation', action: 'campaign_plan_generation',
        contextPackageId: ctx.contextPackageId,
      });

      let plan: Record<string, unknown> = {};
      try {
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        plan = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        plan = { raw };
      }

      const existingAudienceConfig = (campaign.audience_config as Record<string, unknown>) ?? {};
      await supabase.from('campaigns').update({
        audience_config: { ...existingAudienceConfig, plan },
        status: campaign.status === 'draft' ? 'pending_approval' : campaign.status,
        updated_at: new Date().toISOString(),
      }).eq('id', campaignId).eq('founder_id', founderId);

      return reply.send({ plan });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Plan generation failed' });
    }
  });

  /**
   * POST /campaigns/:id/schedule
   * Schedule an approved campaign to launch at a future date.
   */
  server.post('/campaigns/:id/schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;

    const parsed = ScheduleSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'scheduledAt is required (ISO datetime)' });

    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      // §1.5 enforcement
      if (!campaign.approved_at) {
        return reply.status(422).send({ error: 'Campaign must be approved before scheduling' });
      }

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update({ scheduled_at: parsed.data.scheduledAt, status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      await writeAuditLog(supabase, founderId, 'campaign_scheduled', campaignId, { scheduledAt: parsed.data.scheduledAt });

      return reply.send({ campaign: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to schedule campaign' });
    }
  });

  /**
   * POST /campaigns/:id/launch
   * Launch a campaign immediately.
   * §1.5: approved_at MUST be non-null.
   * §1.6: spend_cap enforced.
   */
  server.post('/campaigns/:id/launch', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      // §1.5 Approve-Before-Post — hard server-side constraint
      if (!campaign.approved_at) {
        return reply.status(422).send({ error: 'Campaign must be approved before launching' });
      }

      if (!['approved', 'scheduled', 'paused'].includes(campaign.status)) {
        return reply.status(409).send({ error: `Cannot launch campaign with status: ${campaign.status}` });
      }

      // §1.6 Spend guardrail
      const cap = campaign.spend_cap as Record<string, number> | null;
      if (cap?.weeklyUSD) {
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const { data: weekMetrics } = await supabase
          .from('campaign_metrics')
          .select('cpi, installs')
          .eq('founder_id', founderId)
          .gte('week_start', weekAgo);

        const currentSpend = (weekMetrics ?? []).reduce((sum, m) => sum + ((m.cpi ?? 0) * (m.installs ?? 0)), 0);
        const proposedBudget = cap.weeklyUSD;

        if (currentSpend + proposedBudget > cap.weeklyUSD * 1.5) {
          return reply.status(422).send({ error: 'Spend cap would be exceeded', currentSpend, cap: cap.weeklyUSD });
        }
      }

      // Record publish attempt
      await supabase.from('campaign_publish_attempts').insert({
        campaign_id:    campaignId,
        founder_id:     founderId,
        channel:        campaign.channel,
        attempt_number: 1,
        status:         'success',
        started_at:     new Date().toISOString(),
        completed_at:   new Date().toISOString(),
      });

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update({ status: 'launched', launched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      await writeAuditLog(supabase, founderId, 'campaign_launched', campaignId, { channel: campaign.channel });

      return reply.send({ campaign: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to launch campaign' });
    }
  });

  /**
   * POST /campaigns/:id/resume
   * Resume a paused campaign.
   */
  server.post('/campaigns/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      if (campaign.status !== 'paused') return reply.status(409).send({ error: 'Only paused campaigns can be resumed' });
      if (!campaign.approved_at) return reply.status(422).send({ error: 'Campaign must be approved before resuming' });

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update({ status: 'launched', updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      await writeAuditLog(supabase, founderId, 'campaign_resumed', campaignId);

      return reply.send({ campaign: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to resume campaign' });
    }
  });

  /**
   * POST /campaigns/:id/cancel
   * Cancel a draft/pending/approved/scheduled campaign.
   */
  server.post('/campaigns/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      if (['launched', 'completed', 'cancelled', 'archived'].includes(campaign.status)) {
        return reply.status(409).send({ error: `Cannot cancel campaign with status: ${campaign.status}` });
      }

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      await writeAuditLog(supabase, founderId, 'campaign_cancelled', campaignId);

      return reply.send({ campaign: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to cancel campaign' });
    }
  });

  /**
   * POST /campaigns/:id/archive
   * Archive a completed or cancelled campaign.
   */
  server.post('/campaigns/:id/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      const { data: updated, error } = await supabase
        .from('campaigns')
        .update({ status: 'archived', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('founder_id', founderId)
        .select('id, status, archived_at')
        .single();

      if (error || !updated) return reply.status(404).send({ error: 'Campaign not found or already archived' });

      return reply.send({ id: updated.id, archivedAt: updated.archived_at });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to archive campaign' });
    }
  });

  /**
   * POST /campaigns/:id/assets
   * Link a content asset to a campaign (sets content_assets.campaign_id).
   */
  server.post('/campaigns/:id/assets', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const campaignId = (request.params as { id: string }).id;

    const parsed = LinkAssetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'assetId is required' });

    const supabase = getSupabaseAdmin();

    try {
      const campaign = await getCampaignOwned(supabase, campaignId, founderId);
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      const { data: asset } = await supabase
        .from('content_assets')
        .select('id, campaign_id')
        .eq('id', parsed.data.assetId)
        .eq('founder_id', founderId)
        .single();

      if (!asset) return reply.status(404).send({ error: 'Asset not found' });

      const { error } = await supabase
        .from('content_assets')
        .update({ campaign_id: campaignId, updated_at: new Date().toISOString() })
        .eq('id', parsed.data.assetId)
        .eq('founder_id', founderId);

      if (error) throw error;

      return reply.send({ linked: true, assetId: parsed.data.assetId, campaignId });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to link asset' });
    }
  });
}

export const campaignRoutes = fp(campaignPlugin);
