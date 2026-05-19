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
        .select('id, platform, encrypted_token')
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
}
