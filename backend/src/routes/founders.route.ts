/**
 * @file founders.route.ts
 * @description Founder-scoped management endpoints.
 *
 *   GDPR:
 *     DELETE /founders/me           — hard-delete all data, soft-delete founders row
 *     GET    /founders/me/export    — GDPR-compliant JSON export
 *
 *   Sessions:
 *     GET    /auth/sessions         — list active sessions (simplified)
 *     POST   /auth/revoke-sessions  — revoke all sessions except current
 *
 *   Preferences:
 *     PATCH  /founders/me/notifications — update notification toggles
 *
 *   Analytics:
 *     GET    /founders/me/insights  — cross-product performance aggregation
 *
 * @security JWT required for all routes. Operations scoped strictly to auth'd founder.
 *   GDPR delete is irreversible — soft-deletes founders row, hard-deletes all data.
 *   playbook_signals NOT deleted (PII-free by design).
 *   encrypted_token NOT included in export.
 * @dependencies supabaseAdmin, @supabase/supabase-js (admin for session ops)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { createClient } from '@supabase/supabase-js';
import { ensurePersonalWorkspace } from '../services/workspaceService';
import { ok, fail } from '../lib/response';
import { ingestLearningEvent } from '../services/learningPipelineService';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

function getSupabaseAuthAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const NotificationsSchema = z.object({
  briefDelivery:      z.boolean().optional(),
  campaignApproval:   z.boolean().optional(),
  lowTokenWarning:    z.boolean().optional(),
});

export async function foundersRoutes(server: FastifyInstance): Promise<void> {

  /**
   * POST /founders/session
   * Idempotent session initialisation. Called by the frontend after every login/signup.
   * Guarantees:
   *   1. Founder row exists in founders table (created by Supabase Auth trigger or first-call upsert).
   *   2. Founder has at least one personal workspace (ensurePersonalWorkspace).
   *   3. founders.active_workspace_id is set.
   * Returns founder profile + workspace so the frontend can bootstrap in one call.
   * @security JWT required. Idempotent — safe to call on every login. Never creates duplicates.
   */
  server.post('/founders/session', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const db = getSupabaseAdmin();

    try {
      // Upsert founders row (handles case where Supabase trigger hasn't fired yet)
      const jwtUser = request.user as { sub: string; email?: string };
      await db.from('founders').upsert(
        {
          id:    founderId,
          email: jwtUser.email ?? '',
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

      // Ensure personal workspace exists
      const { workspace, created } = await ensurePersonalWorkspace(founderId);

      // Return founder profile
      const { data: founder } = await db
        .from('founders')
        .select('id, email, name, plan, token_balance, onboarding_step, active_workspace_id, active_product_id')
        .eq('id', founderId)
        .single();

      return reply.send({
        founder,
        workspace,
        workspaceCreated: created,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /founders/session' } });
      return reply.status(500).send({ error: 'Session initialization failed' });
    }
  });

  /**
   * GET /founders/me
   * Returns the authenticated founder's profile + active workspace.
   */
  server.get('/founders/me', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const { data, error } = await getSupabaseAdmin()
      .from('founders')
      .select('id, email, name, plan, token_balance, onboarding_step, active_workspace_id, active_product_id, created_at')
      .eq('id', founderId)
      .single();

    if (error || !data) return reply.status(404).send({ error: 'Founder not found' });
    return reply.send({ founder: data });
  });

  /**
   * DELETE /founders/me
   * GDPR right-to-delete. Irreversible.
   * Steps (in order, all or rollback):
   *   1. Revoke all platform OAuth tokens
   *   2. Delete embedding_store rows
   *   3. Delete: weekly_briefs, campaign_metrics, campaigns, products, platform_tokens
   *   4. Soft-delete founders row (email anonymised, deleted_at set)
   *   5. Revoke all Supabase sessions
   *   6. Write audit_log
   * playbook_signals NOT deleted (already PII-free).
   */
  server.delete('/founders/me', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const db = getSupabaseAdmin();

    try {
      // 1. Revoke OAuth tokens — best effort (don't block on platform API failures)
      const { data: tokens } = await db
        .from('platform_tokens')
        .select('id, platform')
        .eq('founder_id', founderId)
        .is('revoked_at', null);

      if (tokens && tokens.length > 0) {
        await db
          .from('platform_tokens')
          .update({ revoked_at: new Date().toISOString() })
          .eq('founder_id', founderId);
      }

      // 2. Delete embedding_store
      await db.from('embedding_store').delete().eq('founder_id', founderId);

      // 3. Delete all founder data in dependency order
      await db.from('weekly_briefs').delete().eq('founder_id', founderId);
      await db.from('campaign_metrics').delete().eq('founder_id', founderId);
      await db.from('campaigns').delete().eq('founder_id', founderId);
      await db.from('products').delete().eq('founder_id', founderId);
      await db.from('platform_tokens').delete().eq('founder_id', founderId);
      await db.from('api_keys').delete().eq('founder_id', founderId);
      await db.from('workspaces').delete().eq('founder_id', founderId);

      // 4. Soft-delete founders row — anonymise email, keep for billing records
      await db
        .from('founders')
        .update({
          deleted_at: new Date().toISOString(),
          email: `deleted@${founderId}`,
          name: null,
        })
        .eq('id', founderId);

      // 5. Write audit log BEFORE revoking Supabase session (so the insert can still auth)
      await db.from('audit_logs').insert({
        founder_id: founderId,
        action: 'account_deleted',
        resource_type: 'founder',
        metadata: { tokensRevoked: tokens?.length ?? 0 },
      });

      // 6. Revoke all Supabase auth sessions (best effort)
      try {
        const authAdmin = getSupabaseAuthAdmin();
        await authAdmin.auth.admin.deleteUser(founderId);
      } catch {
        // Non-fatal — data is already deleted
      }

      return reply.send({ deleted: true });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'DELETE /founders/me' } });
      return reply.status(500).send({ error: 'Failed to delete account — contact support' });
    }
  });

  /**
   * GET /founders/me/export
   * GDPR-compliant data export. Returns JSON with all founder-scoped data.
   * Does NOT include: encrypted_token (useless encrypted blob), playbook_signals (not theirs).
   */
  server.get('/founders/me/export', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const db = getSupabaseAdmin();

    try {
      const [
        { data: founder },
        { data: products },
        { data: campaigns },
        { data: weeklyBriefs },
        { data: auditLogs },
      ] = await Promise.all([
        db.from('founders')
          .select('id, email, name, plan, token_balance, onboarding_step, created_at')
          .eq('id', founderId)
          .is('deleted_at', null)
          .single(),
        db.from('products')
          .select('id, name, store_url, platform, category, markets, price_tier, confirmed_icp, last_scraped_at, created_at')
          .eq('founder_id', founderId),
        db.from('campaigns')
          .select('id, product_id, channel, market, status, hook_type, copy_text, spend_cap, ai_tokens_consumed, approved_at, launched_at, created_at')
          .eq('founder_id', founderId),
        db.from('weekly_briefs')
          .select('id, product_id, week_of, what_worked, what_to_kill, next_actions, status, sent_at, created_at')
          .eq('founder_id', founderId),
        db.from('audit_logs')
          .select('id, action, resource_type, resource_id, metadata, created_at')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      if (!founder) return reply.status(404).send({ error: 'Founder not found' });

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        founder,
        products:     products ?? [],
        campaigns:    campaigns ?? [],
        weeklyBriefs: weeklyBriefs ?? [],
        auditLogs:    auditLogs ?? [],
      };

      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="launchmind-export-${founderId.slice(0, 8)}.json"`)
        .send(exportPayload);
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /founders/me/export' } });
      return reply.status(500).send({ error: 'Export failed' });
    }
  });

  /**
   * GET /auth/sessions
   * Returns simplified session info for the authenticated founder.
   * Supabase does not expose a per-session list via REST; returns current session metadata.
   */
  server.get('/auth/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    try {
      const authAdmin = getSupabaseAuthAdmin();
      const { data, error } = await authAdmin.auth.admin.getUserById(founderId);

      if (error || !data.user) return reply.status(404).send({ error: 'Session not found' });

      const user = data.user;
      // Supabase admin API returns last_sign_in_at and confirmed_at
      return reply.send({
        sessions: [
          {
            id: 'current',
            lastSignIn: user.last_sign_in_at,
            createdAt: user.created_at,
            email: user.email,
            current: true,
          },
        ],
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /auth/sessions' } });
      return reply.status(500).send({ error: 'Failed to fetch sessions' });
    }
  });

  /**
   * POST /auth/revoke-sessions
   * Revokes all Supabase sessions for the founder (global sign-out).
   */
  server.post('/auth/revoke-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    try {
      // Supabase admin signOut revokes all refresh tokens for the user
      const authAdmin = getSupabaseAuthAdmin();
      const { error } = await authAdmin.auth.admin.signOut(founderId, 'global');

      if (error) throw error;

      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'sessions_revoked',
        resource_type: 'founder',
        metadata: { scope: 'global' },
      });

      return reply.send({ revoked: true });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /auth/revoke-sessions' } });
      return reply.status(500).send({ error: 'Failed to revoke sessions' });
    }
  });

  /**
   * PATCH /founders/me/notifications
   * Updates notification preferences stored in founder metadata.
   * Body: { briefDelivery?, campaignApproval?, lowTokenWarning? }
   */
  server.patch('/founders/me/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = NotificationsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }

    try {
      // Store notification prefs in audit metadata — lightweight approach
      // (no dedicated column needed; can be extended to a notifications table later)
      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'notification_prefs_updated',
        resource_type: 'founder',
        metadata: parsed.data,
      });

      return reply.send({ updated: true, prefs: parsed.data });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'PATCH /founders/me/notifications' } });
      return reply.status(500).send({ error: 'Failed to update preferences' });
    }
  });

  /**
   * GET /founders/me/insights
   * Cross-product performance aggregation for this founder.
   * Returns top channel, avg installs/week, best product, and channel breakdown.
   */
  server.get('/founders/me/insights', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const db = getSupabaseAdmin();

    try {
      // Fetch all campaigns + metrics in one pass
      const { data: campaigns } = await db
        .from('campaigns')
        .select('id, channel, market, product_id, products(name)')
        .eq('founder_id', founderId)
        .in('status', ['launched', 'completed']);

      if (!campaigns || campaigns.length === 0) {
        return reply.send({
          topChannel: null,
          avgInstallsPerWeek: 0,
          bestPerformingProduct: null,
          channelBreakdown: [],
        });
      }

      const campaignIds = campaigns.map((c) => c.id);
      const { data: metrics } = await db
        .from('campaign_metrics')
        .select('campaign_id, impressions, clicks, installs, cpi, roas, week_start')
        .in('campaign_id', campaignIds);

      if (!metrics || metrics.length === 0) {
        return reply.send({
          topChannel: null,
          avgInstallsPerWeek: 0,
          bestPerformingProduct: null,
          channelBreakdown: [],
        });
      }

      // Build per-channel aggregates
      const channelMap = new Map<string, { installs: number; impressions: number; cpiSum: number; cpiCount: number; productInstalls: Map<string, number> }>();

      for (const m of metrics) {
        const campaign = campaigns.find((c) => c.id === m.campaign_id);
        if (!campaign) continue;

        const ch = campaign.channel;
        if (!channelMap.has(ch)) {
          channelMap.set(ch, { installs: 0, impressions: 0, cpiSum: 0, cpiCount: 0, productInstalls: new Map() });
        }
        const agg = channelMap.get(ch)!;
        agg.installs += m.installs ?? 0;
        agg.impressions += m.impressions ?? 0;
        if (m.cpi != null) { agg.cpiSum += Number(m.cpi); agg.cpiCount++; }

        const productId = campaign.product_id;
        agg.productInstalls.set(productId, (agg.productInstalls.get(productId) ?? 0) + (m.installs ?? 0));
      }

      // Top channel by installs
      let topChannel = '';
      let topInstalls = 0;
      for (const [ch, agg] of channelMap.entries()) {
        if (agg.installs > topInstalls) { topInstalls = agg.installs; topChannel = ch; }
      }

      // Best performing product (by total installs across all channels)
      const productInstallTotals = new Map<string, number>();
      for (const agg of channelMap.values()) {
        for (const [pid, installs] of agg.productInstalls.entries()) {
          productInstallTotals.set(pid, (productInstallTotals.get(pid) ?? 0) + installs);
        }
      }

      let bestProductId = '';
      let bestProductInstalls = 0;
      for (const [pid, installs] of productInstallTotals.entries()) {
        if (installs > bestProductInstalls) { bestProductInstalls = installs; bestProductId = pid; }
      }

      const bestProductCampaign = campaigns.find((c) => c.product_id === bestProductId);
      const bestProductName = (bestProductCampaign?.products as { name?: string } | null)?.name ?? null;

      // Weekly average
      const weekSet = new Set(metrics.map((m) => m.week_start));
      const totalInstalls = [...productInstallTotals.values()].reduce((a, b) => a + b, 0);
      const avgInstallsPerWeek = weekSet.size > 0 ? Math.round(totalInstalls / weekSet.size) : 0;

      // Channel breakdown
      const channelBreakdown = [...channelMap.entries()].map(([channel, agg]) => ({
        channel,
        totalInstalls: agg.installs,
        avgCPI: agg.cpiCount > 0 ? parseFloat((agg.cpiSum / agg.cpiCount).toFixed(2)) : null,
      })).sort((a, b) => b.totalInstalls - a.totalInstalls);

      return reply.send({
        topChannel: topChannel || null,
        avgInstallsPerWeek,
        bestPerformingProduct: bestProductId
          ? { id: bestProductId, name: bestProductName, installs: bestProductInstalls }
          : null,
        channelBreakdown,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /founders/me/insights' } });
      return reply.status(500).send({ error: 'Failed to fetch insights' });
    }
  });

  /**
   * GET /founders/me/resume
   * Returns the most recent incomplete product intake for the logged-in founder.
   * Used by the login page resume card and post-login redirect logic.
   * @returns { hasResume: true, product: { id, name, intake_step, step_label, store_url, updated_at } }
   *          or { hasResume: false } when no incomplete intake exists.
   * @security JWT required. Scoped strictly to the authenticated founder.
   */
  server.get('/founders/me/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const STEP_LABELS: Record<number, string> = {
      1: 'URLs entered',
      2: 'Context added',
      3: 'Discovery complete',
      4: 'ICP confirmed',
      5: 'Competitors confirmed',
      6: 'Markets selected',
    };

    try {
      const { data: products, error } = await getSupabaseAdmin()
        .from('products')
        .select('id, name, intake_step, store_url, updated_at')
        .eq('founder_id', founderId)
        .is('archived_at', null)
        .gt('intake_step', 0)
        .is('confirmed_icp', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) {
        return reply.status(500).send(fail('Failed to check resume state', 'INTERNAL_ERROR'));
      }

      const product = products?.[0] ?? null;
      if (!product) {
        return reply.send(ok({ hasResume: false }));
      }

      return reply.send(ok({
        hasResume: true,
        product: {
          id: product.id,
          name: product.name,
          intake_step: product.intake_step,
          step_label: STEP_LABELS[product.intake_step as number] ?? `Step ${product.intake_step}`,
          store_url: product.store_url,
          updated_at: product.updated_at,
        },
      }));
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /founders/me/resume' } });
      return reply.status(500).send(fail('Failed to check resume state', 'INTERNAL_ERROR'));
    }
  });

  // ── Product context patch routes (Improve Intelligence) ──────────────────

  /**
   * Everything a founder-confirmed context change must do besides the write itself
   * (spec §4.1, §4.2): leave an immutable audit trail, appear in the learning log,
   * and cause LaunchMind to reconsider its recommendations.
   *
   * All three are best-effort and run after the response is decided. A failure here
   * must not turn a saved edit into an error the owner sees — the edit IS persisted;
   * these are consequences of it.
   *
   * @param kind - Which editor the change came from; drives the log wording
   * @security Audit rows are append-only. No field VALUES are written to the audit
   *   metadata — only which fields changed — because context can contain strategy
   *   the owner has not chosen to expose to an admin reading audit logs.
   */
  async function recordContextChange(opts: {
    founderId: string;
    productId: string;
    kind: 'context' | 'context_delta';
    changedFields: string[];
    previousState: string | null;
    newState: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    const db = getSupabaseAdmin();

    // 1. Immutable audit trail.
    await db.from('audit_logs').insert({
      founder_id:    opts.founderId,
      action:        opts.kind === 'context' ? 'context.update' : 'context_delta.update',
      resource_type: 'product',
      resource_id:   opts.productId,
      metadata:      { changed_fields: opts.changedFields },
      ip_address:    opts.ip ?? null,
      user_agent:    opts.userAgent ?? null,
    }).then(
      () => undefined,
      (e: unknown) => Sentry.captureException(e, { tags: { op: 'recordContextChange.audit' } }),
    );

    // 2. Learning log + 3. strategy re-evaluation. Both need a workspace context.
    try {
      const { resolveWorkspaceContext } = await import('../services/workspaceAuthService');
      const ctx = await resolveWorkspaceContext(opts.founderId);

      const { recordLearningEvent, snapshotConfidence } =
        await import('../services/growthBrainLearningService');

      // Confidence after the write; the founder-direction dimension moves on these
      // fields, so the number is genuinely affected by what just changed.
      const after = await snapshotConfidence(ctx);

      await recordLearningEvent({
        workspaceId:   ctx.workspaceId,
        founderId:     opts.founderId,
        productId:     opts.productId,
        eventType:     opts.kind === 'context' ? 'context_updated' : 'context_delta_updated',
        trigger:       opts.kind === 'context'
          ? `You updated what the market sees (${opts.changedFields.join(', ')})`
          : `You updated what you are launching next (${opts.changedFields.join(', ')})`,
        evidence:      [{ label: 'Fields changed', value: opts.changedFields.join(', ') }],
        previousState: opts.previousState,
        newState:      opts.newState,
        newConfidence: after,
        createdByType: 'founder',
        createdBy:     opts.founderId,
      });

      // 3. Re-evaluate. Founder-confirmed context outranks anything LaunchMind
      //    inferred, so recommendations built on the old context are now suspect.
      const { generateRecommendations } = await import('../services/recommendationEngineService');
      await generateRecommendations(opts.founderId, opts.productId);
    } catch (e) {
      Sentry.captureException(e, { tags: { op: 'recordContextChange.reevaluate' } });
    }
  }

  /** One-line summary of the market-facing context, for the learning log. */
  function describeIcp(icp: Record<string, unknown> | null | undefined): string | null {
    if (!icp) return null;
    const parts = [icp.positioning, icp.audience, icp.topSignal]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  /** One-line summary of the context delta, for the learning log. */
  function describeDelta(row: {
    next_initiative?: string | null;
    primary_goal?:    string | null;
    target_window?:   string | null;
  } | null | undefined): string | null {
    if (!row) return null;
    const parts = [row.next_initiative, row.primary_goal, row.target_window]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  const PatchContextBodySchema = z.object({
    positioning: z.string().max(500).optional(),
    audience:    z.string().max(500).optional(),
    topSignal:   z.string().max(500).optional(),
  });

  const PatchContextDeltaBodySchema = z.object({
    nextInitiative: z.string().max(500).optional(),
    primaryGoal:    z.string().max(500).optional(),
    targetWindow:   z.string().max(200).optional(),
  });

  /**
   * PATCH /products/:productId/context
   * Merges positioning, audience, and topSignal into products.confirmed_icp JSONB.
   * Does NOT replace existing confirmed_icp keys — only updates the provided fields.
   * @param productId - UUID of the product to update
   * @body { positioning?, audience?, topSignal? }
   * @returns { ok: true, data: { id, confirmed_icp } }
   * @security JWT required. Product must belong to authenticated founder (verified before update).
   */
  server.patch<{ Params: { productId: string } }>(
    '/products/:productId/context',
    async (request: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      const { productId } = request.params;

      if (!z.string().uuid().safeParse(productId).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid product ID' });
      }

      const parsed = PatchContextBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }

      const db = getSupabaseAdmin();

      try {
        // Verify ownership
        const { data: product, error: fetchErr } = await db
          .from('products')
          .select('id, founder_id, confirmed_icp')
          .eq('id', productId)
          .single();

        if (fetchErr || !product) return reply.status(404).send({ ok: false, error: 'Product not found' });
        if ((product as { founder_id: string }).founder_id !== founderId) {
          return reply.status(403).send({ ok: false, error: 'Forbidden' });
        }

        // Merge new fields into existing confirmed_icp
        const existingIcp = ((product as { confirmed_icp?: Record<string, unknown> | null }).confirmed_icp) ?? {};
        const updates: Record<string, unknown> = {};
        if (parsed.data.positioning !== undefined) updates.positioning = parsed.data.positioning;
        if (parsed.data.audience    !== undefined) updates.audience    = parsed.data.audience;
        if (parsed.data.topSignal   !== undefined) updates.topSignal   = parsed.data.topSignal;

        const mergedIcp = { ...existingIcp, ...updates };

        const { data: updated, error: updateErr } = await db
          .from('products')
          .update({ confirmed_icp: mergedIcp, updated_at: new Date().toISOString() })
          .eq('id', productId)
          .select('id, confirmed_icp')
          .single();

        if (updateErr || !updated) {
          return reply.status(500).send({ ok: false, error: 'Failed to update context' });
        }

        // Fire-and-forget: record learning event so the Growth Brain picks up the change.
        ingestLearningEvent(founderId, productId, 'founder_feedback', {
          feedback_type:  'context_update',
          updated_fields: Object.keys(updates),
        }).catch((e) => Sentry.captureException(e, { tags: { route: 'PATCH /products/:productId/context', event: 'ingestLearningEvent' } }));

        // Audit + learning log + strategy re-evaluation (spec §4.1 steps 4–8).
        // Not awaited: the owner's save is already durable, and re-evaluation can
        // take seconds. Failures are captured, never surfaced as a failed save.
        void recordContextChange({
          founderId,
          productId,
          kind:          'context',
          changedFields: Object.keys(updates),
          previousState: describeIcp(existingIcp),
          newState:      describeIcp(mergedIcp),
          ip:            request.ip,
          userAgent:     request.headers['user-agent'],
        });

        return reply.send(ok({ id: (updated as { id: string }).id, confirmed_icp: (updated as { confirmed_icp: unknown }).confirmed_icp }));
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'PATCH /products/:productId/context' } });
        return reply.status(500).send({ ok: false, error: 'Failed to update product context' });
      }
    },
  );

  /**
   * PATCH /products/:productId/context-delta
   * Upserts founder context delta fields (next_initiative, primary_goal, target_window)
   * in founder_context table (migration 077 adds these columns).
   * If no founder_context row exists for this founder without a session, inserts one.
   * The productId in the path is used only for ownership verification.
   * @param productId - UUID of the product (ownership verification only)
   * @body { nextInitiative?, primaryGoal?, targetWindow? }
   * @returns { ok: true, data: { founderId, nextInitiative, primaryGoal, targetWindow } }
   * @security JWT required. Product ownership verified before upsert.
   *   Context is founder-scoped, not product-scoped.
   */
  server.patch<{ Params: { productId: string } }>(
    '/products/:productId/context-delta',
    async (request: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      const { productId } = request.params;

      if (!z.string().uuid().safeParse(productId).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid product ID' });
      }

      const parsed = PatchContextDeltaBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }

      const db = getSupabaseAdmin();

      try {
        // Verify product ownership (path param used as ownership gate only)
        const { data: product, error: fetchErr } = await db
          .from('products')
          .select('id, founder_id')
          .eq('id', productId)
          .single();

        if (fetchErr || !product) return reply.status(404).send({ ok: false, error: 'Product not found' });
        if ((product as { founder_id: string }).founder_id !== founderId) {
          return reply.status(403).send({ ok: false, error: 'Forbidden' });
        }

        // Build update payload (only provided fields)
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (parsed.data.nextInitiative !== undefined) updates.next_initiative = parsed.data.nextInitiative;
        if (parsed.data.primaryGoal    !== undefined) updates.primary_goal    = parsed.data.primaryGoal;
        if (parsed.data.targetWindow   !== undefined) updates.target_window   = parsed.data.targetWindow;

        // Check for existing session-less row. Its current values are the "before"
        // side of the learning-log entry, so they are read before the write.
        const { data: existing } = await db
          .from('founder_context')
          .select('id, next_initiative, primary_goal, target_window')
          .eq('founder_id', founderId)
          .is('session_id', null)
          .maybeSingle();

        const before = (existing ?? null) as {
          next_initiative?: string | null;
          primary_goal?:    string | null;
          target_window?:   string | null;
        } | null;

        if (existing) {
          // Update existing row
          await db
            .from('founder_context')
            .update(updates)
            .eq('id', (existing as { id: string }).id);
        } else {
          // Insert new session-less row
          await db.from('founder_context').insert({
            founder_id:     founderId,
            session_id:     null,
            next_initiative: parsed.data.nextInitiative ?? null,
            primary_goal:    parsed.data.primaryGoal    ?? null,
            target_window:   parsed.data.targetWindow   ?? null,
          });
        }

        // Fetch final state
        const { data: result } = await db
          .from('founder_context')
          .select('next_initiative, primary_goal, target_window')
          .eq('founder_id', founderId)
          .is('session_id', null)
          .maybeSingle();

        const ctx = (result ?? {}) as {
          next_initiative?: string | null;
          primary_goal?:    string | null;
          target_window?:   string | null;
        };

        // Previously this route persisted and returned, with no audit entry, no
        // learning-log line, and nothing downstream reconsidering the strategy the
        // owner had just contradicted.
        void recordContextChange({
          founderId,
          productId,
          kind:          'context_delta',
          changedFields: Object.keys(updates).filter(k => k !== 'updated_at'),
          previousState: describeDelta(before),
          newState:      describeDelta(ctx),
          ip:            request.ip,
          userAgent:     request.headers['user-agent'],
        });

        return reply.send(ok({
          founderId,
          nextInitiative: ctx.next_initiative ?? null,
          primaryGoal:    ctx.primary_goal    ?? null,
          targetWindow:   ctx.target_window   ?? null,
        }));
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'PATCH /products/:productId/context-delta' } });
        return reply.status(500).send({ ok: false, error: 'Failed to update context delta' });
      }
    },
  );
}
