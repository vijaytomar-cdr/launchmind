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
 * @dependencies buildContextForPrompt (ContextPackage V2), callSonnet, callHaiku, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';

import { getSupabaseAdmin }     from '../lib/supabaseAdmin';
import { buildContextForPrompt } from '../lib/context/contextEngineAdapter';
import { callSonnet } from '../lib/aiPlatform';
import { applyBacklogFilter } from '../services/opportunityBacklog';

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

/**
 * The product of the business the owner is CURRENTLY OPERATING.
 *
 * WAS: "newest non-archived product owned by this founder" — a founder-wide
 * read that ignored `active_workspace_id` entirely. With two businesses it
 * silently decided which company the Morning Brief was about, so switching the
 * top-bar control changed the chrome and nothing else. That is the tenancy
 * incident this route is at the centre of.
 *
 * Resolution now goes through the ONE verified path (activeBusinessService),
 * which re-checks workspace membership and returns null rather than guessing.
 *
 * @returns the active product, or null when no business is selected or it has
 *   no product yet. Callers must render "no data" — never substitute another.
 * @security The workspace is verified server-side; a client cannot select one.
 */
/**
 * Campaign ids belonging to ONE product.
 *
 * `campaign_metrics` has a founder_id but no product_id, so reading it by
 * founder returns every business's numbers. Scoping through the product's own
 * campaigns is the strongest scope the schema allows.
 *
 * @returns campaign ids, or a single impossible id when the product has none.
 *   Verified: PostgREST `.in()` with `[]` matches nothing, so the sentinel is
 *   belt-and-braces — it makes the intent explicit rather than resting on a
 *   silent correctness dependency (same convention as intelligenceService).
 */
async function campaignIdsForProduct(
  supabase: ReturnType<typeof getSupabaseAdmin>, productId: string,
): Promise<string[]> {
  const { data } = await supabase.from('campaigns').select('id').eq('product_id', productId);
  const ids = (data ?? []).map(r => String((r as { id: string }).id));
  return ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
}

/**
 * Mission ids belonging to ONE product. Same reasoning as above:
 * `mission_logs` carries no product_id, so it is scoped through missions.
 */
async function missionIdsForProduct(
  supabase: ReturnType<typeof getSupabaseAdmin>, productId: string,
): Promise<string[]> {
  const { data } = await supabase.from('missions').select('id').eq('product_id', productId);
  const ids = (data ?? []).map(r => String((r as { id: string }).id));
  return ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
}

async function getActiveProduct(supabase: ReturnType<typeof getSupabaseAdmin>, founderId: string) {
  const { getActiveBusiness } = await import('../services/activeBusinessService');
  const business = await getActiveBusiness(founderId);
  if (!business?.productId) return null;

  const { data } = await supabase
    .from('products')
    .select('id, name, platform, markets, confirmed_icp, brand_voice_profile, workspace_id, maturity, scraped_meta')
    // Scoped to the RESOLVED product, and re-checked against its workspace so a
    // stale pointer cannot reach across businesses.
    .eq('id', business.productId)
    .eq('workspace_id', business.workspaceId)
    .is('archived_at', null)
    .maybeSingle();
  return data;
}

/**
 * Approvals awaiting the owner FOR THE BUSINESS THEY ARE OPERATING.
 *
 * Was founder-wide on both queries, so a campaign awaiting approval in one
 * business appeared while the owner was looking at another — and could have
 * been approved there. Approving something is an authority act; showing it
 * under the wrong company is the most dangerous form of this leak.
 *
 * `mission_approvals` carries no product_id, so it is scoped through the
 * missions that belong to this product rather than by founder.
 *
 * @param productId - the ACTIVE product; null means no business is selected,
 *   in which case nothing is pending because nothing is in scope.
 */
async function getPendingApprovals(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  founderId: string,
  productId: string | null,
) {
  if (!productId) {
    return { total: 0, items: [] as Array<Record<string, unknown>> };
  }

  const { data: missionRows } = await supabase
    .from('missions').select('id').eq('product_id', productId);
  const missionIds = ((missionRows ?? []) as Array<{ id: string }>).map(m => m.id);

  const [campaignRes, missionRes] = await Promise.all([
    supabase.from('campaigns')
      .select('id, hook_type, channel, copy_text')
      .eq('founder_id', founderId)
      .eq('product_id', productId)
      .eq('status', 'pending_approval')
      .limit(10),
    missionIds.length
      ? supabase.from('mission_approvals')
          .select('id, mission_id, title, step_id')
          .eq('founder_id', founderId)
          .in('mission_id', missionIds)
          .eq('status', 'pending')
          .limit(10)
      : Promise.resolve({ data: [] }),
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

/**
 * Seeds starter opportunities for a product that has none.
 *
 * WAS three hardcoded templates with invented evidence — "Competitor ranking
 * +15 positions", "Rating: 4.2 - 4.1 (7d)", "4 reviews: 'confusing setup'" —
 * emitted for every product regardless of what LaunchMind had observed. AllignX
 * has zero reviews and still received the review-cluster opportunity; LaunchMind
 * is pre-launch with no listing and was told to optimise its ASO title.
 *
 * Eligibility and evidence now come from the product's real state, and fewer
 * opportunities is an acceptable outcome.
 *
 * @param product - the ACTIVE product row, already business-verified by caller
 */
async function seedOpportunitiesIfEmpty(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  founderId: string,
  productId: string | null,
  productName: string,
  product?: { maturity?: string | null; markets?: string[] | null; scraped_meta?: Record<string, unknown> | null },
) {
  const { readCapabilities, eligibleOpportunities } =
    await import('../services/opportunityEligibility');

  const caps = readCapabilities(product ?? {});
  const eligible = eligibleOpportunities(productName, caps);

  // Nothing defensible to suggest is a valid answer — better than filling the
  // list with advice about capabilities the product does not have.
  if (eligible.length === 0) return;

  await supabase.from('saved_opportunities').insert(
    eligible.map(o => ({ ...o, founder_id: founderId, product_id: productId })),
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

async function ownerPlugin(server: FastifyInstance): Promise<void> {

  // GET /owner/counts — Lightweight badge counts for sidebar (cached by layout)
  server.get('/owner/counts', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();
      // Badge counts are business-scoped too: a sidebar showing "3 opportunities"
      // from the other company is the same leak in miniature, and it is what the
      // owner sees on every page.
      const countsProduct = await getActiveProduct(supabase, founderId);
      const countsProductId = (countsProduct as { id?: string } | null)?.id ?? null;
      const [approvalsData, opportunitiesData, notificationsData] = await Promise.all([
        getPendingApprovals(supabase, founderId, countsProductId),
        // Counted through applyBacklogFilter — the SAME predicate the
        // Opportunities page uses. This previously read
        // .in('state', ['active','saved']), which silently excluded `converted`
        // rows that the page still lists, so the badge under-reported the
        // backlog the owner could actually see.
        countsProductId
          ? applyBacklogFilter(
              supabase.from('saved_opportunities')
                .select('id', { count: 'exact', head: true })
                .eq('product_id', countsProductId),
            )
          : Promise.resolve({ count: 0, error: null }),
        supabase.from('notifications').select('id', { count: 'exact', head: true })
          .eq('founder_id', founderId).eq('read', false),
      ]);
      // notifications table may not exist yet — treat error as 0
      const unreadNotifications = notificationsData.error ? 0 : (notificationsData.count ?? 0);
      reply.send({
        opportunities: opportunitiesData.count ?? 0,
        approvals: approvalsData.total,
        notifications: unreadNotifications,
      });
    } catch {
      reply.status(500).send({ opportunities: 0, approvals: 0, notifications: 0 });
    }
  });

  // GET /owner/brief — Morning Brief aggregation
  server.get('/owner/brief', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const supabase  = getSupabaseAdmin();

      // Resolved BEFORE the batch so business context can be scoped to it.
      // Previously founder_context was read founder-wide with newest-wins, so a
      // founder with two businesses saw whichever they had touched most
      // recently — on both briefs.
      const activeProduct = await getActiveProduct(supabase, founderId);
      const briefProductId = (activeProduct as { id?: string } | null)?.id ?? null;

      const [founderRes, product, approvals, opportunitiesRes, timelineRes, metricsRes, memoriesRes, onboardingRes, directionRes, founderContextRes, businessGoalRes] = await Promise.all([
        supabase.from('founders').select('name, plan, token_balance').eq('id', founderId).single(),
        Promise.resolve(activeProduct),
        getPendingApprovals(supabase, founderId, briefProductId),
        // Opportunities carry product_id and were read founder-wide, which is
        // why LaunchMind's brief listed "Improve AllignX App Store ASO".
        briefProductId ? supabase.from('saved_opportunities')
          .select('*')
          .eq('product_id', briefProductId)
          .in('state', ['active', 'saved'])
          .order('confidence', { ascending: false })
          .limit(3)
          : Promise.resolve({ data: [] }),
        // Timeline is business-specific: mission activity from the other
        // company under this brief's header is the same leak in narrative form.
        // mission_logs carries no product_id, so it is scoped through missions.
        briefProductId ? supabase.from('mission_logs')
          .select('id, message, level, created_at, mission_id')
          .in('mission_id', await missionIdsForProduct(supabase, briefProductId))
          .in('level', ['info', 'warn'])
          .order('created_at', { ascending: false })
          .limit(8)
          : Promise.resolve({ data: [] }),
        // Metrics belong to campaigns, which belong to a product. Reading them
        // founder-wide put another business's installs/CPI under this header.
        // Currently zero rows either way — but a read is not correct merely
        // because today's dataset is empty.
        briefProductId ? supabase.from('campaign_metrics')
          .select('installs, cpi, ctr, roas, week_start, campaign_id')
          .in('campaign_id', await campaignIdsForProduct(supabase, briefProductId))
          .order('week_start', { ascending: false })
          .limit(10)
          : Promise.resolve({ data: [] }),
        // Scoped to the active product for the same reason as the context,
        // goal and direction reads above. This one was MEASURED mixing the two
        // businesses: both carry populated product_id/workspace_id (zero nulls),
        // so "top 3 by confidence, founder-wide" spanned both companies.
        briefProductId ? supabase.from('marketing_memories')
          .select('id, title, content, memory_type, confidence')
          .eq('product_id', briefProductId)
          .eq('status', 'active')
          .order('confidence', { ascending: false })
          .limit(3)
          : Promise.resolve({ data: [] }),
        // Check if Phase 1 onboarding is complete (new onboarding flow)
        // Scoped to the active product, like every other business-specific read
        // in this handler. Founder-wide, ANY completed onboarding anywhere made
        // phase1Done true for EVERY brief — so a second, untouched business
        // reported hasStrategy=true and rendered a phase1 payload it had never
        // earned. A completed session always has a product, so product_id is the
        // correct key; workspace-only rows belong to states that are not
        // complete and are therefore irrelevant to this check.
        briefProductId ? supabase.from('onboarding_sessions')
          .select('current_state')
          .eq('product_id', briefProductId)
          .in('current_state', ['PHASE_1_COMPLETE', 'DIRECTION_COMPLETE'])
          .limit(1)
          : Promise.resolve({ data: [] }),
        // Fetch full strategy direction content (not just existence)
        // Scoped for the same reason as the context and goal below: a brief
        // headed "AllignX" must not carry the strategy generated for LaunchMind.
        briefProductId ? supabase.from('strategy_directions')
          .select('id, headline, rationale, primary_channel, week_1, week_2, week_3, week_4, status')
          .eq('founder_id', founderId)
          .eq('product_id', briefProductId)
          .in('status', ['ready', 'acknowledged'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          : Promise.resolve({ data: null }),
        // Phase 1 founder context — scoped to the product this brief is about.
        // Previously founder-wide with newest-wins, so a founder with two
        // businesses saw whichever they touched last on BOTH briefs.
        briefProductId ? supabase.from('founder_context')
          .select('audience_confirmed, context_delta, working_style')
          .eq('founder_id', founderId)
          .eq('product_id', briefProductId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          // No product in scope means no business context — returning another
          // business's is worse than returning none.
          : Promise.resolve({ data: null }),
        // Phase 1 primary business goal — scoped to the same product as the
        // context above. business_goals already carries product_id; reading it
        // founder-wide put "Increase service bookings" on the brief for a SaaS
        // product owned by the same founder.
        briefProductId ? supabase.from('business_goals')
          .select('goal_type, target_value, unit, time_horizon_days')
          .eq('product_id', briefProductId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const founder     = founderRes.data;
      const opportunities = opportunitiesRes.data ?? [];
      const phase1Done  = (onboardingRes.data ?? []).length > 0;
      const direction   = directionRes.data ?? null;
      const hasDirection = direction !== null;
      const founderCtx  = founderContextRes.data ?? null;
      const primaryGoal = businessGoalRes.data ?? null;

      // Resolve founder display name: founders.name → auth user_metadata.full_name → 'Founder'
      let founderDisplayName = founder?.name ?? null;
      if (!founderDisplayName) {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(founderId);
          founderDisplayName = (authUser?.user?.user_metadata?.full_name as string | undefined)
            ?? (authUser?.user?.user_metadata?.name as string | undefined)
            ?? null;
          // Persist so future requests skip this admin call
          if (founderDisplayName) {
            await supabase.from('founders').update({ name: founderDisplayName }).eq('id', founderId);
          }
        } catch { /* non-fatal */ }
      }

      // Seed opportunities if empty
      if (opportunities.length === 0 && product) {
        await seedOpportunitiesIfEmpty(
          supabase, founderId, product.id, product.name,
          product as { maturity?: string | null; markets?: string[] | null; scraped_meta?: Record<string, unknown> | null });
        // Same product filter as the initial read at the top of this handler.
        // Dropping it here re-opened the cross-business leak on the seeding path.
        const seeded = await supabase.from('saved_opportunities')
          .select('*')
          .eq('product_id', product.id)
          .in('state', ['active'])
          .order('confidence', { ascending: false })
          .limit(3);
        opportunities.push(...(seeded.data ?? []));
      }

      // Phase 3.3E: persisted Growth Brain decisions, read ONCE and used for
      // both the model context and the payload, so the two surfaces cannot
      // disagree about what the owner already settled.
      const { listRecommendationDecisions } = await import('../services/growthBrainDecisionService');
      const decidedForPayload = (product && product.workspace_id)
        ? await listRecommendationDecisions(
            { workspaceId: product.workspace_id as string, productId: product.id }, 10)
        : [];

      // Generate AI recommendation using Sonnet (needs system prompt for JSON output)
      let recommendation: Record<string, unknown> | null = null;
      if (product) {
        try {
          // Phase 3.1E: targeted retrieval + persisted provenance, replacing the
          // ad-hoc context string this route used to concatenate itself.
          const ctx = await buildContextForPrompt({
            founderId,
            productId: product.id,
            intent: 'MORNING_BRIEF',
            // Retrieval input, NOT a model instruction (§8). Derived from the
            // task and the product, never from a system prompt.
            query: `What should ${product.name} focus on next? Recent performance, ` +
                   `channel learning, and outstanding decisions.`,
          });
          // Phase 3.3E: the brief must not ask the owner to decide something
          // they already decided in Growth Brain. Persisted decisions are
          // supplied as STATE — the brief still generates its own
          // recommendation; it is simply told what is already settled. Owner
          // decisions are NOT turned into Marketing Memory and carry no
          // authority here.
          const decided = decidedForPayload;
          const decidedLines = decided.length
            ? `\n\nALREADY DECIDED BY THE OWNER (do not ask them to decide these again):\n` +
              decided.map(d =>
                `- "${d.what}" — ${d.decisionStatus.toLowerCase()}` +
                `${d.executionStatus === 'READY_FOR_ACTION' ? ' (approved, awaiting action — NOT yet done)' : ''}`)
                .join('\n')
            : '';
          const ctxSummary = `${ctx.text}${decidedLines}\n\nPending approvals: ${approvals.total}.`;
          const auditCtx = {
            founderId, productId: product.id,
            promptId: 'morning_brief', action: 'morning_brief',
            contextPackageId: ctx.contextPackageId,
          };
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

      // Growth Brain is active when: confirmed_icp set (old intake) OR Phase 1 complete (new onboarding)
      const growthBrainActive = !!product?.confirmed_icp || phase1Done || hasDirection;
      // Confidence: 96 if phase1 complete, 78 if confirmed_icp only, null if neither
      // MEASUREMENT HONESTY: this was `phase1Done ? 96 : 78` — two literals
      // rendered to the owner as a percentage confidence. Nothing measured
      // either one. There IS a real coverage figure (GET /intelligence/coverage,
      // computed from connections and signals); inventing a second, different
      // number here and calling it confidence is worse than showing none.
      // Omitted rather than replaced: an absent number is honest, a
      // freshly-invented one is not.
      const growthBrainConfidence = null;

      reply.send({
        founder:        { name: founderDisplayName ?? 'Founder', plan: founder?.plan ?? 'free' },
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
        // Owner-visible decision state, so the two surfaces agree. Read-only.
        decidedRecommendations: decidedForPayload.map(d => ({
          id: d.id, what: d.what,
          decisionStatus: d.decisionStatus, executionStatus: d.executionStatus,
          requiresApproval: d.requiresApproval,
          founderReviewRequired: d.founderReviewRequired,
        })),
        growthBrain: {
          hasStrategy:  growthBrainActive,
          confidence:   growthBrainConfidence,
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
          body:       ((m.content as Record<string, unknown>)?.audienceConfirmed
                    ?? (m.content as Record<string, unknown>)?.contextDelta
                    ?? null) as string | null,
          memoryType: m.memory_type as string,
          confidence: m.confidence as number,
        })),
        // Phase 1 data surfaced in brief for the UI to render direction + goal
        phase1: (phase1Done || hasDirection || founderCtx) ? {
          direction: direction ? {
            headline:       direction.headline as string,
            rationale:      direction.rationale as string,
            primaryChannel: direction.primary_channel as string | null,
            week1:          direction.week_1,
            week2:          direction.week_2,
            week3:          direction.week_3,
            week4:          direction.week_4,
          } : null,
          audience:    (founderCtx as Record<string, unknown> | null)?.audience_confirmed as string | null ?? null,
          contextDelta:(founderCtx as Record<string, unknown> | null)?.context_delta as string | null ?? null,
          workingStyle:(founderCtx as Record<string, unknown> | null)?.working_style as string | null ?? null,
          primaryGoal: primaryGoal ? {
            type:        (primaryGoal as Record<string, unknown>).goal_type as string,
            target:      (primaryGoal as Record<string, unknown>).target_value as number,
            unit:        (primaryGoal as Record<string, unknown>).unit as string,
            horizonDays: (primaryGoal as Record<string, unknown>).time_horizon_days as number,
          } : null,
        } : null,
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
      const state = q.state ?? 'active';

      // THE ACTIVE BUSINESS DECIDES, not the query string. `productId` was
      // client-supplied AND optional, so omitting it returned every opportunity
      // the founder owned — which is why LaunchMind listed "Improve AllignX App
      // Store ASO". A client hint is now only honoured when it names the
      // resolved product; anything else is ignored rather than trusted.
      const activeProduct = await getActiveProduct(supabase, founderId);
      const activeProductId = (activeProduct as { id?: string } | null)?.id ?? null;
      if (!activeProductId || (q.productId && q.productId !== activeProductId)) {
        // No business selected, or a product that is not the active one: return
        // nothing rather than another company's backlog.
        reply.send({ opportunities: [] });
        return;
      }

      let query = supabase.from('saved_opportunities')
        .select('*')
        .eq('product_id', activeProductId)
        .order('confidence', { ascending: false });

      // 'all' means the backlog, defined once in opportunityBacklog.ts so the
      // sidebar badge counts exactly this population and cannot drift from it.
      if (state !== 'all') query = query.eq('state', state);
      else query = applyBacklogFilter(query);

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

      const activeProduct = await getActiveProduct(supabase, founderId);
      const writeProductId = (activeProduct as { id?: string } | null)?.id ?? null;
      if (!writeProductId) {
        return reply.status(409).send({ error: 'Select a business before creating an opportunity.' });
      }
      if (body.productId && body.productId !== writeProductId) {
        // Refuse rather than silently retarget: writing into another business is
        // exactly the corruption the read fixes above are cleaning up.
        return reply.status(404).send({ error: 'Product not found in the current business.' });
      }

      const { data, error } = await supabase.from('saved_opportunities').insert({
        founder_id:      founderId,
        // WRITE SCOPE (§10). Was `body.productId ?? null` — an unverified
        // client value, and NULL when omitted, which creates an opportunity
        // belonging to no business that every founder-wide reader then picks up.
        // The active business decides; a mismatched hint is refused above.
        product_id:      writeProductId,
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

      // Phase 3.1E. The owner's question IS the retrieval query — that is the
      // one place raw owner text legitimately drives retrieval. It selects
      // nothing about POLICY: the intent, memory types, budget and archived
      // eligibility all come from the governed intent, not from what was typed.
      const ctx = await buildContextForPrompt({
        founderId,
        productId,
        intent: 'OWNER_QUESTION',
        query: body.question,
      });

      const prompt = `Founder asks: "${body.question}"\n\n${ctx.text}\n\nAnswer the question.`;

      const auditCtx = {
        founderId, productId, promptId: 'ask_launchmind', action: 'ask_launchmind',
        contextPackageId: ctx.contextPackageId,
      };
      const raw = await callSonnet(ASK_SYSTEM, prompt, 1024, auditCtx);

      let answer: Record<string, unknown>;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        answer = match ? JSON.parse(match[0]) : { summary: raw, recommendedAction: 'Review the context and decide.', confidence: 50, risks: [], nextStep: 'Review', evidence: [] };
      } catch {
        answer = { summary: raw, recommendedAction: 'Review the context.', confidence: 50, risks: [], nextStep: 'Review', evidence: [] };
      }

      // Surfaces retrieval honesty to the caller: a degraded package must not
      // look like a fully-informed one (§15).
      const contextSources = ctx.package
        ? [`retrieval:${ctx.package.retrieval.mode}`, `memories:${ctx.package.retrieval.memoriesSelected}`]
        : ['legacy'];
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

      const [missionRes, campaignRes, approvalRes, _missionLogRes] = await Promise.all([
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
      // Same rule as every other surface: notifications describe the business
      // being operated, not the founder across all of them.
      const notifProduct = await getActiveProduct(supabase, founderId);
      const notifProductId = (notifProduct as { id?: string } | null)?.id ?? null;

      // Synthesize from DB state (pending approvals, failed missions)
      const [notifRes, pendingAppr, failedMissions] = await Promise.all([
        supabase.from('notifications')
          .select('*')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false })
          .limit(30),
        getPendingApprovals(supabase, founderId, notifProductId),
        notifProductId ? supabase.from('missions')
          .select('id, title, failed_at')
          .eq('product_id', notifProductId)
          .eq('status', 'failed')
          .order('failed_at', { ascending: false })
          .limit(5)
          : Promise.resolve({ data: [] }),
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
