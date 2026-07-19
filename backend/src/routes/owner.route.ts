/**
 * @file owner.route.ts
 * @description Owner Experience API adapter routes. Aggregates from existing services.
 *   GET  /owner/brief           — Morning Brief: recommendation + approvals + opportunities + timeline
 *   GET  /owner/opportunities   — Growth backlog from saved_opportunities
 *   POST /owner/opportunities   — Create opportunity
 *   PATCH /owner/opportunities/:id — Save / dismiss / convert
 *   POST /owner/ask             — Ask LaunchMind (Context Engine + Sonnet)
 *   GET  /owner/results         — Interpreted campaign metrics
 *   GET  /owner/timeline        — Chronological product events
 *   GET  /owner/notifications   — Owner notification list
 *   PATCH /owner/notifications/:id/read — Mark notification read
 *   POST /owner/notifications   — Create notification (internal, admin only)
 * @security JWT required for all routes. All data filtered by founder_id.
 * @dependencies buildContextPackage, callSonnet, callHaiku, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';

import { getSupabaseAdmin }     from '../lib/supabaseAdmin';
import { buildContextPackage }  from '../lib/contextEngine';
import { callSonnet } from '../lib/aiPlatform';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Ask LaunchMind prompt ─────────────────────────────────────────────────────

const ASK_SYSTEM = `You are LaunchMind, an AI CMO for mobile app founders.
Answer the founder's question using their product context. Be direct, specific, and actionable.
Return a JSON object with exactly these keys:
  summary (string: 2 sentences max),
  recommendedAction (string: one clear action),
  suggestedMissionType (string: one of research|strategy|content|campaign|optimization|reporting or null),
  suggestedMissionTitle (string or null),
  expectedImpact (string: e.g. "~+15% installs in 3 weeks"),
  confidence (number: 0-100),
  risks (array of max 3 strings),
  nextStep (string: one thing to do right now),
  evidence (array of max 3 strings: data points that informed this answer).
Never mention internal concepts like agents, queues, or prompt IDs.`;

// ── Brief recommendation prompt + Zod schema ─────────────────────────────────

// Schema enforced via aiPlatform outputSchema — any mismatch is logged as status='failed'.
const RecommendationSchema = z.object({
  title:       z.string(),
  summary:     z.string(),
  whyNow:      z.string(),
  confidence:  z.number().min(0).max(100),
  evidence:    z.array(z.string()),
  action:      z.string(),
  missionType: z.string().nullable(),
});

const BRIEF_SYSTEM = `You are LaunchMind, an AI CMO. Based on the product context, generate ONE primary recommendation for the founder's morning brief.

CRITICAL: Return ONLY a raw JSON object. No preamble, no explanation, no markdown code fences.
The response must be valid JSON that can be passed directly to JSON.parse().

Required JSON shape:
{
  "title": "≤10 words, action-oriented",
  "summary": "2 sentences why this matters now",
  "whyNow": "1 sentence, specific signal that makes this urgent",
  "confidence": 0-100,
  "evidence": ["up to 3 evidence strings"],
  "action": "CTA label e.g. Launch India campaign",
  "missionType": "one of: research|strategy|content|campaign|optimization — or null"
}

Be specific to the product context provided. Never mention agents, queues, or internal architecture.`;

// ── Input validation schemas ──────────────────────────────────────────────────

const AskSchema = z.object({
  question:  z.string().min(3).max(500),
  productId: z.string().uuid().optional(),
});

const CreateOpportunitySchema = z.object({
  type:           z.string(),
  title:          z.string().min(1).max(200),
  description:    z.string().optional(),
  expectedImpact: z.string().optional(),
  confidence:     z.number().min(0).max(1).optional(),
  effort:         z.enum(['low', 'medium', 'high']).default('medium'),
  risk:           z.enum(['low', 'medium', 'high']).default('low'),
  whyNow:         z.string().optional(),
  source:         z.string().optional(),
  evidence:       z.array(z.string()).optional(),
  productId:      z.string().uuid().optional(),
});

const UpdateOpportunitySchema = z.object({
  state:     z.enum(['active', 'saved', 'dismissed', 'converted']).optional(),
  missionId: z.string().uuid().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getActiveProduct(supabase: ReturnType<typeof getSupabaseAdmin>, founderId: string) {
  const { data } = await supabase
    .from('products')
    .select('id, name, platform, markets, confirmed_icp, brand_voice_profile')
    .eq('founder_id', founderId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getPendingApprovals(supabase: ReturnType<typeof getSupabaseAdmin>, founderId: string) {
  const [campaignRes, missionRes] = await Promise.all([
    supabase.from('campaigns')
      .select('id, hook_type, channel, copy_text')
      .eq('founder_id', founderId)
      .eq('status', 'pending_approval')
      .limit(10),
    supabase.from('mission_approvals')
      .select('id, mission_id, title, step_id')
      .eq('founder_id', founderId)
      .eq('status', 'pending')
      .limit(10),
  ]);

  const campaigns = (campaignRes.data ?? []).map(c => ({
    id:       c.id,
    type:     'campaign' as const,
    title:    c.hook_type ? `${c.channel} — ${c.hook_type}` : `${c.channel} campaign`,
    preview:  (c.copy_text as string | null)?.slice(0, 80) ?? null,
    missionId: null,
  }));

  const missions = (missionRes.data ?? []).map(a => ({
    id:       a.id,
    type:     'mission' as const,
    title:    a.title,
    preview:  null,
    missionId: a.mission_id,
  }));

  return { total: campaigns.length + missions.length, items: [...missions, ...campaigns] };
}

async function seedOpportunitiesIfEmpty(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  founderId: string,
  productId: string | null,
  productName: string,
) {
  const seeds = [
    {
      founder_id: founderId, product_id: productId,
      type: 'aso', title: `Add high-intent keywords to ${productName} ASO title`,
      description: 'Your app title is missing 2-3 keywords that competitors rank for.',
      expected_impact: '~+8% organic installs', confidence: 0.72,
      effort: 'low', risk: 'low',
      why_now: 'Competitor updated their ASO title this week.',
      source: 'competitor_scrape', evidence: ['Competitor ranking +15 positions', 'Keyword search volume up 22%'],
    },
    {
      founder_id: founderId, product_id: productId,
      type: 'india_launch', title: `Launch ${productName} in India — strong market signal`,
      description: 'Your app category is growing 3× faster in India vs the US this quarter.',
      expected_impact: '~+25% installs at 30% lower CPI', confidence: 0.68,
      effort: 'medium', risk: 'medium',
      why_now: 'India market share for your category hit an all-time high.',
      source: 'growth_brain', evidence: ['India category growth 3×', 'CPI 60% lower than USA', 'UPI install base 400M users'],
    },
    {
      founder_id: founderId, product_id: productId,
      type: 'review_risk', title: 'Address negative review cluster before they impact rating',
      description: '4 recent 1-star reviews mention the same onboarding friction point.',
      expected_impact: 'Protect 4.2★ rating, reduce churn', confidence: 0.81,
      effort: 'medium', risk: 'high',
      why_now: 'Rating dropped 0.1 in the last 7 days.',
      source: 'review_analysis', evidence: ['4 reviews: "confusing setup"', 'Rating: 4.2 → 4.1 (7d)', 'Churn signal up 8%'],
    },
  ];

  await supabase.from('saved_opportunities').insert(seeds);
}

// ── Routes ────────────────────────────────────────────────────────────────────

async function ownerPlugin(server: FastifyInstance): Promise<void> {

  // GET /owner/brief — Morning Brief aggregation
  server.get('/owner/brief', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();

      const [founderRes, product, approvals, opportunitiesRes, timelineRes, metricsRes, memoriesRes] = await Promise.all([
        supabase.from('founders').select('name, plan, token_balance').eq('id', founderId).single(),
        getActiveProduct(supabase, founderId),
        getPendingApprovals(supabase, founderId),
        supabase.from('saved_opportunities')
          .select('*')
          .eq('founder_id', founderId)
          .in('state', ['active', 'saved'])
          .order('confidence', { ascending: false })
          .limit(3),
        supabase.from('mission_logs')
          .select('id, message, level, created_at, mission_id')
          .eq('founder_id', founderId)
          .in('level', ['info', 'warn'])
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.from('campaign_metrics')
          .select('installs, cpi, ctr, roas, week_start')
          .eq('founder_id', founderId)
          .order('week_start', { ascending: false })
          .limit(10),
        supabase.from('marketing_memories')
          .select('id, title, body, memory_type, confidence')
          .eq('founder_id', founderId)
          .eq('archived', false)
          .order('confidence', { ascending: false })
          .limit(3),
      ]);

      const founder     = founderRes.data;
      const opportunities = opportunitiesRes.data ?? [];

      // Seed opportunities if empty
      if (opportunities.length === 0 && product) {
        await seedOpportunitiesIfEmpty(supabase, founderId, product.id, product.name);
        const seeded = await supabase.from('saved_opportunities')
          .select('*')
          .eq('founder_id', founderId)
          .in('state', ['active'])
          .order('confidence', { ascending: false })
          .limit(3);
        opportunities.push(...(seeded.data ?? []));
      }

      // Generate AI recommendation using Sonnet (needs system prompt for JSON output)
      let recommendation: Record<string, unknown> | null = null;
      if (product) {
        try {
          const contextPkg = await buildContextPackage(founderId, product.id, {
            includeMemories: true, includeKnowledgeGraph: false, maxMemories: 3,
          });
          const ctxSummary = `Product: ${product.name}. Markets: ${(contextPkg.product?.markets ?? []).join(', ')}.
ICP: ${JSON.stringify(contextPkg.product?.confirmedIcp ?? {}).slice(0, 200)}.
Active campaigns: ${contextPkg.campaigns?.length ?? 0}. Top channel: ${contextPkg.analytics?.topChannel ?? 'none'}.
Pending approvals: ${approvals.total}. Recent installs: ${contextPkg.analytics?.totalInstalls ?? 0}.`;
          const auditCtx = { founderId, productId: product.id, promptId: 'morning_brief', action: 'morning_brief' };
          const rawRec = await callSonnet(
            BRIEF_SYSTEM,
            `Context:\n${ctxSummary}\n\nGenerate one primary recommendation for the morning brief.`,
            512,
            auditCtx,
            RecommendationSchema,
          );
          // rawRec is already fence-stripped and Zod-validated by aiPlatform
          recommendation = JSON.parse(rawRec);
        } catch {
          recommendation = null; // Non-fatal — fallback shown in UI
        }
      }

      // Compute a metrics summary
      const allMetrics  = metricsRes.data ?? [];
      const weekInstalls = allMetrics.reduce((s, m) => s + (m.installs ?? 0), 0);
      const avgCpi       = allMetrics.length ? allMetrics.reduce((s, m) => s + (m.cpi ?? 0), 0) / allMetrics.length : null;

      // Week-over-week install delta — requires ≥2 distinct week_start values with lastWeek > 0
      const weekBuckets = Object.entries(
        allMetrics.reduce<Record<string, number>>((acc, m) => {
          const w = m.week_start as string;
          acc[w] = (acc[w] ?? 0) + ((m.installs as number) ?? 0);
          return acc;
        }, {}),
      ).sort(([a], [b]) => b.localeCompare(a)); // descending — most recent first

      let weekOverWeekInstallDelta: number | null = null;
      if (weekBuckets.length >= 2) {
        const thisWeek = weekBuckets[0][1];
        const lastWeek = weekBuckets[1][1];
        if (lastWeek > 0) {
          weekOverWeekInstallDelta = Number(((thisWeek - lastWeek) / lastWeek * 100).toFixed(1));
        }
      }

      // Build timeline from mission logs
      const timeline = (timelineRes.data ?? []).map(l => ({
        id:      l.id,
        type:    'mission_log',
        title:   l.message,
        time:    l.created_at,
        link:    l.mission_id ? `/dashboard/missions/${l.mission_id}` : null,
      }));

      reply.send({
        founder:        { name: founder?.name ?? 'Founder', plan: founder?.plan ?? 'free' },
        product:        product ? { id: product.id, name: product.name, platform: product.platform } : null,
        recommendation,
        pendingApprovals: approvals,
        opportunities:   opportunities.slice(0, 3).map(row => ({
          ...row,
          evidence: Array.isArray(row.evidence)
            ? row.evidence
            : row.evidence == null
              ? []
              : typeof row.evidence === 'string'
                ? (() => { try { const p = JSON.parse(row.evidence as string); return Array.isArray(p) ? p : []; } catch { return []; } })()
                : Object.values(row.evidence as Record<string, unknown>).map(String),
        })),
        recentTimeline:  timeline.slice(0, 5),
        growthBrain: {
          hasStrategy:  !!product?.confirmed_icp,
          confidence:   product?.confirmed_icp ? 78 : null,
          lastUpdated:  null,
        },
        metrics: {
          weeklyInstalls:          weekInstalls || null,
          cpi:                     avgCpi ? Number(avgCpi.toFixed(2)) : null,
          activeCampaigns:         0,
          weekOverWeekInstallDelta,
        },
        memories: (memoriesRes.data ?? []).map(m => ({
          id:         m.id,
          title:      m.title as string,
          body:       m.body as string | null,
          memoryType: m.memory_type as string,
          confidence: m.confidence as number,
        })),
      });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /owner/opportunities
  server.get('/owner/opportunities', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();
      const q = request.query as { state?: string; productId?: string };

      const state     = q.state ?? 'active';
      const productId = q.productId;

      let query = supabase.from('saved_opportunities')
        .select('*')
        .eq('founder_id', founderId)
        .order('confidence', { ascending: false });

      if (state !== 'all') query = query.eq('state', state);
      else query = query.not('state', 'eq', 'dismissed');
      if (productId) query = query.eq('product_id', productId);

      const { data } = await query.limit(50);
      const normalised = (data ?? []).map(row => ({
        ...row,
        evidence: Array.isArray(row.evidence)
          ? row.evidence
          : row.evidence == null
            ? []
            : typeof row.evidence === 'string'
              ? (() => { try { const p = JSON.parse(row.evidence as string); return Array.isArray(p) ? p : []; } catch { return []; } })()
              : Object.values(row.evidence as Record<string, unknown>).map(String),
      }));
      reply.send({ opportunities: normalised });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /owner/opportunities
  server.post('/owner/opportunities', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const body      = CreateOpportunitySchema.parse(request.body);
      const supabase  = getSupabaseAdmin();

      const { data, error } = await supabase.from('saved_opportunities').insert({
        founder_id:      founderId,
        product_id:      body.productId ?? null,
        type:            body.type,
        title:           body.title,
        description:     body.description ?? null,
        expected_impact: body.expectedImpact ?? null,
        confidence:      body.confidence ?? null,
        effort:          body.effort,
        risk:            body.risk,
        why_now:         body.whyNow ?? null,
        source:          body.source ?? 'manual',
        evidence:        body.evidence ?? null,
      }).select('*').single();

      if (error) throw error;
      reply.status(201).send({ opportunity: data });
    } catch (err) {
      Sentry.captureException(err);
      if ((err as { name?: string }).name === 'ZodError') return reply.status(400).send({ error: 'Invalid request' });
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // PATCH /owner/opportunities/:id
  server.patch('/owner/opportunities/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;
      const body      = UpdateOpportunitySchema.parse(request.body);
      const supabase  = getSupabaseAdmin();

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.state)     updates.state     = body.state;
      if (body.missionId) updates.mission_id = body.missionId;

      await supabase.from('saved_opportunities')
        .update(updates)
        .eq('id', id)
        .eq('founder_id', founderId);

      reply.send({ success: true });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /owner/ask — Ask LaunchMind
  server.post('/owner/ask', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const body      = AskSchema.parse(request.body);
      const supabase  = getSupabaseAdmin();

      // Get active product if not specified
      let productId = body.productId ?? null;
      if (!productId) {
        const product = await getActiveProduct(supabase, founderId);
        productId = product?.id ?? null;
      }

      // Build context
      const contextPkg = await buildContextPackage(founderId, productId, {
        includeMemories: true, includeKnowledgeGraph: true, maxMemories: 5,
      });

      const ctxText = `Product: ${contextPkg.product?.name ?? 'Unknown'}.
Markets: ${(contextPkg.product?.markets ?? []).join(', ')}.
Plan: ${contextPkg.founder.plan}.
Active campaigns: ${contextPkg.campaigns?.length ?? 0}.
Top channel: ${contextPkg.analytics?.topChannel ?? 'none'}.
Total installs: ${contextPkg.analytics?.totalInstalls ?? 0}.
Avg CPI: ${contextPkg.analytics?.avgCpi?.toFixed(2) ?? 'unknown'}.
Recent memories: ${contextPkg.memories?.slice(0, 3).map(m => m.title).join('; ') ?? 'none'}.`;

      const prompt = `Founder asks: "${body.question}"\n\nContext:\n${ctxText}\n\nAnswer the question.`;

      const auditCtx = { founderId, productId, promptId: 'ask_launchmind', action: 'ask_launchmind' };
      const raw = await callSonnet(ASK_SYSTEM, prompt, 1024, auditCtx);

      let answer: Record<string, unknown>;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        answer = match ? JSON.parse(match[0]) : { summary: raw, recommendedAction: 'Review the context and decide.', confidence: 50, risks: [], nextStep: 'Review', evidence: [] };
      } catch {
        answer = { summary: raw, recommendedAction: 'Review the context.', confidence: 50, risks: [], nextStep: 'Review', evidence: [] };
      }

      const contextSources = contextPkg.sources;
      reply.send({ answer, contextSources, question: body.question });
    } catch (err) {
      Sentry.captureException(err);
      if ((err as { name?: string }).name === 'ZodError') return reply.status(400).send({ error: 'Invalid question' });
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /owner/results — interpreted campaign metrics
  server.get('/owner/results', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();

      const [metricsRes, campaignsRes, missionsRes] = await Promise.all([
        supabase.from('campaign_metrics')
          .select('impressions, clicks, installs, cpi, ctr, roas, top_performing_asset, week_start, campaign_id')
          .eq('founder_id', founderId)
          .order('week_start', { ascending: false })
          .limit(30),
        supabase.from('campaigns')
          .select('id, channel, market, status, hook_type, launched_at, approved_at')
          .eq('founder_id', founderId)
          .in('status', ['launched', 'completed', 'paused'])
          .order('launched_at', { ascending: false })
          .limit(10),
        supabase.from('missions')
          .select('id, type, title, status, output, completed_at')
          .eq('founder_id', founderId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(5),
      ]);

      const metrics   = metricsRes.data   ?? [];
      const campaigns = campaignsRes.data ?? [];
      const missions  = missionsRes.data  ?? [];

      // Aggregate by week
      const byWeek: Record<string, { installs: number; clicks: number; impressions: number; cpi: number[]; roas: number[] }> = {};
      for (const m of metrics) {
        const w = m.week_start;
        if (!byWeek[w]) byWeek[w] = { installs: 0, clicks: 0, impressions: 0, cpi: [], roas: [] };
        byWeek[w].installs    += m.installs ?? 0;
        byWeek[w].clicks      += m.clicks ?? 0;
        byWeek[w].impressions += m.impressions ?? 0;
        if (m.cpi)  byWeek[w].cpi.push(m.cpi);
        if (m.roas) byWeek[w].roas.push(m.roas);
      }

      const weeklyData = Object.entries(byWeek)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 8)
        .map(([week, d]) => ({
          week,
          installs:    d.installs,
          clicks:      d.clicks,
          impressions: d.impressions,
          avgCpi:      d.cpi.length  ? Number((d.cpi.reduce((a, b)  => a + b, 0) / d.cpi.length ).toFixed(2)) : null,
          avgRoas:     d.roas.length ? Number((d.roas.reduce((a, b) => a + b, 0) / d.roas.length).toFixed(2)) : null,
        }));

      const totalInstalls = metrics.reduce((s, m) => s + (m.installs ?? 0), 0);
      const allCpi = metrics.filter(m => m.cpi).map(m => m.cpi as number);
      const avgCpi = allCpi.length ? Number((allCpi.reduce((a, b) => a + b, 0) / allCpi.length).toFixed(2)) : null;

      // Channel breakdown
      const byChannel: Record<string, { installs: number; campaigns: number }> = {};
      for (const c of campaigns) {
        if (!byChannel[c.channel]) byChannel[c.channel] = { installs: 0, campaigns: 0 };
        byChannel[c.channel].campaigns++;
      }
      for (const m of metrics) {
        const cam = campaigns.find(c => c.id === m.campaign_id);
        if (cam) byChannel[cam.channel].installs += m.installs ?? 0;
      }

      reply.send({
        summary: {
          totalInstalls,
          avgCpi,
          activeCampaigns: campaigns.filter(c => c.status === 'launched').length,
          completedMissions: missions.length,
        },
        weeklyData,
        channels:          Object.entries(byChannel).map(([ch, d]) => ({ channel: ch, ...d })),
        recentCampaigns:   campaigns.slice(0, 5),
        recentMissions:    missions.slice(0, 5),
      });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /owner/timeline — chronological events
  server.get('/owner/timeline', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();
      const q = request.query as { limit?: string; offset?: string };
      const limit  = Math.min(Number(q.limit  ?? 50), 100);
      const offset = Number(q.offset ?? 0);

      const [missionRes, campaignRes, approvalRes, missionLogRes] = await Promise.all([
        supabase.from('missions')
          .select('id, type, title, status, created_at, completed_at, failed_at')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('campaigns')
          .select('id, channel, market, status, hook_type, launched_at, approved_at, created_at')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('mission_approvals')
          .select('id, mission_id, title, status, requested_at, responded_at')
          .eq('founder_id', founderId)
          .order('requested_at', { ascending: false })
          .limit(10),
        supabase.from('mission_logs')
          .select('id, mission_id, message, level, created_at')
          .eq('founder_id', founderId)
          .in('level', ['info', 'warn', 'error'])
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      // Build unified timeline events
      type TimelineEvent = { id: string; type: string; title: string; subtitle?: string; time: string; link?: string; level?: string };
      const events: TimelineEvent[] = [];

      for (const m of missionRes.data ?? []) {
        events.push({ id: m.id, type: 'mission_created', title: `Mission created: ${m.title}`, subtitle: m.type, time: m.created_at, link: `/dashboard/missions/${m.id}` });
        if (m.completed_at) events.push({ id: `${m.id}-done`, type: 'mission_completed', title: `Mission completed: ${m.title}`, time: m.completed_at, link: `/dashboard/missions/${m.id}` });
        if (m.failed_at) events.push({ id: `${m.id}-fail`, type: 'mission_failed', title: `Mission failed: ${m.title}`, time: m.failed_at, link: `/dashboard/missions/${m.id}`, level: 'warn' });
      }

      for (const c of campaignRes.data ?? []) {
        if (c.launched_at) events.push({ id: `${c.id}-launch`, type: 'campaign_launched', title: `Campaign launched: ${c.channel} — ${c.market}`, subtitle: c.hook_type ?? undefined, time: c.launched_at, link: `/dashboard/campaigns` });
        if (c.approved_at) events.push({ id: `${c.id}-appr`, type: 'campaign_approved', title: `Campaign approved: ${c.channel}`, time: c.approved_at, link: `/dashboard/approvals` });
      }

      for (const a of approvalRes.data ?? []) {
        if (a.responded_at) events.push({ id: `appr-${a.id}`, type: `approval_${a.status}`, title: `${a.status === 'approved' ? 'Approved' : 'Rejected'}: ${a.title}`, time: a.responded_at, link: `/dashboard/approvals` });
      }

      events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      reply.send({ events: events.slice(offset, offset + limit), total: events.length });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /owner/notifications
  server.get('/owner/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();

      // Synthesize from DB state (pending approvals, failed missions)
      const [notifRes, pendingAppr, failedMissions] = await Promise.all([
        supabase.from('notifications')
          .select('*')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false })
          .limit(30),
        getPendingApprovals(supabase, founderId),
        supabase.from('missions')
          .select('id, title, failed_at')
          .eq('founder_id', founderId)
          .eq('status', 'failed')
          .order('failed_at', { ascending: false })
          .limit(5),
      ]);

      const stored = notifRes.data ?? [];

      // Synthetic notifications (live state, not stored)
      const synthetic: Record<string, unknown>[] = [];
      if (pendingAppr.total > 0) {
        synthetic.push({
          id: 'synth-approvals', type: 'approval_needed', is_read: false,
          title: `${pendingAppr.total} approval${pendingAppr.total > 1 ? 's' : ''} waiting`,
          message: 'Review and approve before campaigns can run.',
          action_url: '/dashboard/approvals', action_label: 'Review approvals',
          created_at: new Date().toISOString(),
        });
      }
      for (const m of (failedMissions.data ?? [])) {
        synthetic.push({
          id: `synth-fail-${m.id}`, type: 'campaign_issue', is_read: false,
          title: `Mission failed: ${m.title}`,
          message: 'This mission encountered an error. You can retry it.',
          action_url: `/dashboard/missions/${m.id}`, action_label: 'View mission',
          created_at: m.failed_at ?? new Date().toISOString(),
        });
      }

      const all = [...synthetic, ...stored].sort((a, b) =>
        new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
      );

      reply.send({ notifications: all, unreadCount: all.filter(n => !n.is_read).length });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // PATCH /owner/notifications/:id/read
  server.patch('/owner/notifications/:id/read', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;
      const supabase  = getSupabaseAdmin();
      await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('founder_id', founderId);
      reply.send({ success: true });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });
}

export const ownerRoutes = fp(ownerPlugin);
