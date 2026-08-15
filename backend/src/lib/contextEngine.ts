/**
 * @file contextEngine.ts
 * @description Assembles a normalized ContextPackage from all data sources for AI generation.
 *   All sources are queried in parallel. Individual failures are non-fatal (source omitted).
 *   Returns a typed ContextPackage + formatContextForPrompt() serializer.
 * @security founderId comes from JWT, never from request body. All queries filter by founderId.
 * @dependencies supabaseAdmin, marketing_memories, knowledge_nodes, campaigns, campaign_metrics
 */

import { getSupabaseAdmin } from './supabaseAdmin';

// ── Context Package types ─────────────────────────────────────────────────────

export interface FounderContext {
  plan: string;
  tokenBalance: number | null;
}

export interface ProductContext {
  name: string;
  platform: string;
  markets: string[];
  category: string | null;
  confirmedIcp: Record<string, unknown> | null;
  brandVoiceProfile: Record<string, unknown> | null;
  competitorSet: unknown[] | null;
  founderContext: Record<string, unknown> | null;
}

export interface MemoryEntry {
  type: string;
  title: string;
  confidence: number;
  content: Record<string, unknown>;
}

export interface NodeEntry {
  type: string;
  label: string;
  confidence: number;
}

export interface CampaignEntry {
  channel: string;
  market: string;
  status: string;
  hookType: string | null;
  topMetric: string | null;
}

export interface AnalyticsSummary {
  totalInstalls: number;
  avgCtr: number | null;
  avgCpi: number | null;
  topChannel: string | null;
}

export interface BudgetContext {
  plan: string;
  tokenBalance: number | null;
  estimatedMonthlyUSD: number | null;
}

export interface Phase1Goal {
  type: string;
  target: number;
  unit: string;
  horizonDays: number;
  motivation: string | null;
}

export interface Phase1Competitor {
  name: string;
  relationship: string;
  differentiator: string | null;
}

export interface Phase1Direction {
  headline: string;
  rationale: string;
  primaryChannel: string | null;
  week1: unknown;
  week2: unknown;
  week3: unknown;
  week4: unknown;
}

export interface Phase1Context {
  audience: string | null;
  contextDelta: string | null;
  hiddenStrengths: string[] | null;
  recentWins: string[] | null;
  workingStyle: string | null;
  goal: Phase1Goal | null;
  competitors: Phase1Competitor[];
  direction: Phase1Direction | null;
}

export interface ContextPackage {
  founderId: string;
  productId: string | null;
  assembledAt: string;
  sources: string[];
  founder: FounderContext;
  product: ProductContext | null;
  memories: MemoryEntry[];
  knowledgeNodes: NodeEntry[];
  campaigns: CampaignEntry[];
  analytics: AnalyticsSummary | null;
  budget: BudgetContext;
  phase1: Phase1Context | null;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface ContextOptions {
  includeMemories?:       boolean;  // default true
  includeKnowledgeGraph?: boolean;  // default true
  includeCampaigns?:      boolean;  // default true
  includeAnalytics?:      boolean;  // default true
  maxMemories?:           number;   // default 5
  maxCampaigns?:          number;   // default 10
}

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Assembles a ContextPackage from all data sources for a given founder + product.
 * Sources are queried in parallel. Any single failure is caught and logged — the source
 * is omitted from the context rather than failing the whole assembly.
 * @param founderId  - Authenticated founder UUID
 * @param productId  - Optional product UUID (product context + memories excluded if null)
 * @param opts       - Which sources to include
 * @returns          Normalized ContextPackage ready for prompt injection
 */
export async function buildContextPackage(
  founderId: string,
  productId: string | null,
  opts: ContextOptions = {},
): Promise<ContextPackage> {
  const {
    includeMemories       = true,
    includeKnowledgeGraph = true,
    includeCampaigns      = true,
    includeAnalytics      = true,
    maxMemories           = 5,
    maxCampaigns          = 10,
  } = opts;

  const supabase = getSupabaseAdmin();
  const sources: string[] = [];

  // All queries run in parallel — individual failures caught per source
  const [
    founderResult,
    productResult,
    memoriesResult,
    nodesResult,
    campaignsResult,
    analyticsResult,
    founderContextResult,
    businessGoalResult,
    competitorResult,
    directionResult,
  ] = await Promise.allSettled([
    // 1. Founder
    supabase.from('founders').select('plan, token_balance').eq('id', founderId).single(),

    // 2. Product (only if productId provided)
    productId
      ? supabase
          .from('products')
          .select('name, platform, markets, category, confirmed_icp, brand_voice_profile, competitor_set, founder_context')
          .eq('id', productId)
          .eq('founder_id', founderId)
          .single()
      : Promise.resolve({ data: null, error: null }),

    // 3. Marketing Memories (include founder-level memories where product_id is null)
    includeMemories
      ? supabase
          .from('marketing_memories')
          .select('memory_type, title, confidence, content')
          .eq('founder_id', founderId)
          .eq('status', 'active')
          .order('confidence', { ascending: false })
          .limit(maxMemories)
      : Promise.resolve({ data: [], error: null }),

    // 4. Knowledge Nodes
    includeKnowledgeGraph && productId
      ? supabase
          .from('knowledge_nodes')
          .select('node_type, label, confidence')
          .eq('founder_id', founderId)
          .eq('product_id', productId)
          .order('confidence', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [], error: null }),

    // 5. Campaigns
    includeCampaigns && productId
      ? supabase
          .from('campaigns')
          .select('channel, market, status, hook_type')
          .eq('founder_id', founderId)
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(maxCampaigns)
      : Promise.resolve({ data: [], error: null }),

    // 6. Analytics aggregate (campaign_metrics)
    includeAnalytics && productId
      ? supabase
          .from('campaign_metrics')
          .select('installs, ctr, cpi, campaign_id')
          .eq('founder_id', founderId)
          .order('collected_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),

    // 7. Phase 1 founder context (audience, context delta, working style)
    //
    // SCOPED BY PRODUCT. This previously filtered on founder_id and took the
    // newest row, so a founder with two businesses got whichever they had
    // touched most recently — the other business's positioning, markets and
    // working style, silently. When no product is in scope we return NOTHING
    // rather than guessing: a cross-business answer is worse than none.
    productId ? supabase
      .from('founder_context')
      .select('audience_confirmed, context_delta, hidden_strengths, recent_wins, working_style')
      .eq('founder_id', founderId)
      .eq('product_id', productId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // 8. Phase 1 primary business goal — scoped for the same reason.
    productId ? supabase
      .from('business_goals')
      .select('goal_type, target_value, unit, time_horizon_days, motivation')
      .eq('founder_id', founderId)
      .eq('product_id', productId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // 9. Phase 1 confirmed competitors
    supabase
      .from('competitor_relationships')
      .select('name, relationship, key_differentiator')
      .eq('founder_id', founderId)
      .eq('product_id', productId)          // competitors are per-business
      .eq('relationship', 'CONFIRMED')
      .limit(10),

    // 10. Phase 1 strategy direction (most recent non-draft) — scoped.
    // Missed on the first pass: the two queries above it were scoped by hand and
    // this one was not, so a founder with two businesses got whichever direction
    // was generated most recently for EITHER. Found by tenancyScopeGuard, which
    // is the argument for having it rather than fixing each reader by eye.
    productId ? supabase
      .from('strategy_directions')
      .select('headline, rationale, primary_channel, week_1, week_2, week_3, week_4, status')
      .eq('founder_id', founderId)
      .eq('product_id', productId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // ── Extract results with fallbacks ──────────────────────────────────────────

  let founder: FounderContext = { plan: 'free', tokenBalance: null };
  if (founderResult.status === 'fulfilled' && founderResult.value.data) {
    sources.push('founder');
    const f = founderResult.value.data as { plan: string; token_balance: number | null };
    founder = { plan: f.plan, tokenBalance: f.token_balance };
  }

  let product: ProductContext | null = null;
  if (productResult.status === 'fulfilled' && productResult.value.data) {
    sources.push('product');
    const p = productResult.value.data as {
      name: string; platform: string; markets: string[];
      category: string | null; confirmed_icp: Record<string, unknown> | null;
      brand_voice_profile: Record<string, unknown> | null;
      competitor_set: unknown[] | null;
      founder_context: Record<string, unknown> | null;
    };
    product = {
      name:              p.name,
      platform:          p.platform,
      markets:           p.markets ?? ['usa'],
      category:          p.category,
      confirmedIcp:      p.confirmed_icp,
      brandVoiceProfile: p.brand_voice_profile,
      competitorSet:     p.competitor_set,
      founderContext:    p.founder_context,
    };
  }

  let memories: MemoryEntry[] = [];
  if (memoriesResult.status === 'fulfilled' && memoriesResult.value.data?.length) {
    sources.push('memories');
    memories = (memoriesResult.value.data as { memory_type: string; title: string; confidence: number; content: Record<string, unknown> }[])
      .map(m => ({ type: m.memory_type, title: m.title, confidence: m.confidence, content: m.content }));
  }

  let knowledgeNodes: NodeEntry[] = [];
  if (nodesResult.status === 'fulfilled' && nodesResult.value.data?.length) {
    sources.push('knowledge_graph');
    knowledgeNodes = (nodesResult.value.data as { node_type: string; label: string; confidence: number }[])
      .map(n => ({ type: n.node_type, label: n.label, confidence: n.confidence }));
  }

  let campaigns: CampaignEntry[] = [];
  if (campaignsResult.status === 'fulfilled' && campaignsResult.value.data?.length) {
    sources.push('campaigns');
    campaigns = (campaignsResult.value.data as { channel: string; market: string; status: string; hook_type: string | null }[])
      .map(c => ({ channel: c.channel, market: c.market, status: c.status, hookType: c.hook_type, topMetric: null }));
  }

  let analytics: AnalyticsSummary | null = null;
  if (analyticsResult.status === 'fulfilled' && analyticsResult.value.data?.length) {
    sources.push('analytics');
    const rows = analyticsResult.value.data as { installs: number; ctr: number | null; cpi: number | null }[];
    const totalInstalls = rows.reduce((s, r) => s + (r.installs ?? 0), 0);
    const ctrs = rows.map(r => r.ctr).filter((v): v is number => v !== null);
    const cpis = rows.map(r => r.cpi).filter((v): v is number => v !== null);
    analytics = {
      totalInstalls,
      avgCtr: ctrs.length ? ctrs.reduce((a, b) => a + b, 0) / ctrs.length : null,
      avgCpi: cpis.length ? cpis.reduce((a, b) => a + b, 0) / cpis.length : null,
      topChannel: campaigns[0]?.channel ?? null,
    };
  }

  const budget: BudgetContext = {
    plan: founder.plan,
    tokenBalance: founder.tokenBalance,
    estimatedMonthlyUSD: estimateMonthlyBudget(founder.plan),
  };

  // ── Phase 1 context ─────────────────────────────────────────────────────────

  let phase1: Phase1Context | null = null;
  const hasPhase1Data =
    founderContextResult.status === 'fulfilled' && founderContextResult.value.data;

  if (hasPhase1Data) {
    sources.push('phase1');
    const fc = founderContextResult.value.data as {
      audience_confirmed: string | null;
      context_delta: string | null;
      hidden_strengths: unknown;
      recent_wins: unknown;
      working_style: string | null;
    };

    let goal: Phase1Goal | null = null;
    if (businessGoalResult.status === 'fulfilled' && businessGoalResult.value.data) {
      const bg = businessGoalResult.value.data as {
        goal_type: string; target_value: number; unit: string;
        time_horizon_days: number; motivation: string | null;
      };
      goal = { type: bg.goal_type, target: bg.target_value, unit: bg.unit, horizonDays: bg.time_horizon_days, motivation: bg.motivation };
    }

    const competitors: Phase1Competitor[] =
      competitorResult.status === 'fulfilled' && competitorResult.value.data
        ? (competitorResult.value.data as Array<{ name: string; relationship: string; key_differentiator: string | null }>)
            .map(c => ({ name: c.name, relationship: c.relationship, differentiator: c.key_differentiator }))
        : [];

    let direction: Phase1Direction | null = null;
    if (directionResult.status === 'fulfilled' && directionResult.value.data) {
      const d = directionResult.value.data as {
        headline: string; rationale: string; primary_channel: string | null;
        week_1: unknown; week_2: unknown; week_3: unknown; week_4: unknown;
      };
      direction = {
        headline: d.headline, rationale: d.rationale, primaryChannel: d.primary_channel,
        week1: d.week_1, week2: d.week_2, week3: d.week_3, week4: d.week_4,
      };
    }

    phase1 = {
      audience:       fc.audience_confirmed,
      contextDelta:   fc.context_delta,
      hiddenStrengths: Array.isArray(fc.hidden_strengths) ? fc.hidden_strengths as string[] : null,
      recentWins:      Array.isArray(fc.recent_wins) ? fc.recent_wins as string[] : null,
      workingStyle:    fc.working_style,
      goal,
      competitors,
      direction,
    };
  }

  return {
    founderId,
    productId,
    assembledAt: new Date().toISOString(),
    sources,
    founder,
    product,
    memories,
    knowledgeNodes,
    campaigns,
    analytics,
    budget,
    phase1,
  };
}

// ── Serializer ────────────────────────────────────────────────────────────────

/**
 * Formats a ContextPackage into a prompt-ready string section.
 * This section can be appended to any prompt to give the model full founder context.
 * Keeps output concise — each section is ≤ 300 chars.
 */
export function formatContextForPrompt(ctx: ContextPackage): string {
  const lines: string[] = ['=== FOUNDER CONTEXT ==='];

  if (ctx.product) {
    lines.push(`App: ${ctx.product.name} (${ctx.product.platform}, ${ctx.product.markets.join('+')})`);
    if (ctx.product.category) lines.push(`Category: ${ctx.product.category}`);
    if (ctx.product.founderContext) {
      const fc = ctx.product.founderContext as Record<string, unknown>;
      if (fc.budget) lines.push(`Monthly budget: ${fc.budget}`);
      if (fc.teamSize) lines.push(`Team size: ${fc.teamSize}`);
      if (fc.currentChannels) lines.push(`Current channels: ${fc.currentChannels}`);
      if (fc.monthlyActiveUsers) lines.push(`MAU: ${fc.monthlyActiveUsers}`);
    }
    if (ctx.product.confirmedIcp) {
      const icp = ctx.product.confirmedIcp as Record<string, unknown>;
      if (icp.targetUser) lines.push(`Target user: ${icp.targetUser}`);
    }
  }

  if (ctx.memories.length > 0) {
    lines.push('\nMarketing memories:');
    ctx.memories.slice(0, 3).forEach(m => {
      lines.push(`  [${m.type}] ${m.title} (confidence: ${Math.round(m.confidence * 100)}%)`);
    });
  }

  if (ctx.knowledgeNodes.length > 0) {
    const byType = ctx.knowledgeNodes.reduce<Record<string, string[]>>((acc, n) => {
      if (!acc[n.type]) acc[n.type] = [];
      acc[n.type].push(n.label);
      return acc;
    }, {});
    lines.push('\nKnown entities:');
    Object.entries(byType).slice(0, 4).forEach(([type, labels]) => {
      lines.push(`  ${type}: ${labels.slice(0, 3).join(', ')}`);
    });
  }

  if (ctx.analytics) {
    lines.push(`\nCurrent performance: ${ctx.analytics.totalInstalls} total installs`);
    if (ctx.analytics.avgCtr) lines.push(`  Avg CTR: ${(ctx.analytics.avgCtr * 100).toFixed(2)}%`);
    if (ctx.analytics.avgCpi) lines.push(`  Avg CPI: $${ctx.analytics.avgCpi.toFixed(2)}`);
  }

  if (ctx.campaigns.length > 0) {
    const active = ctx.campaigns.filter(c => c.status === 'launched' || c.status === 'approved');
    if (active.length > 0) {
      lines.push(`\nActive campaigns (${active.length}): ${active.map(c => `${c.channel}/${c.market}`).join(', ')}`);
    }
  }

  if (ctx.phase1) {
    lines.push('\n=== PHASE 1 FOUNDER ALIGNMENT ===');
    if (ctx.phase1.audience) lines.push(`Confirmed audience: ${ctx.phase1.audience}`);
    if (ctx.phase1.contextDelta) lines.push(`Next major change: ${ctx.phase1.contextDelta}`);
    if (ctx.phase1.hiddenStrengths?.length) lines.push(`Hidden strengths: ${ctx.phase1.hiddenStrengths.slice(0, 3).join(', ')}`);
    if (ctx.phase1.recentWins?.length) lines.push(`Recent wins: ${ctx.phase1.recentWins.slice(0, 2).join(', ')}`);
    if (ctx.phase1.workingStyle) lines.push(`Working style: ${ctx.phase1.workingStyle}`);
    if (ctx.phase1.goal) {
      lines.push(`Primary goal: ${ctx.phase1.goal.type} → ${ctx.phase1.goal.target} ${ctx.phase1.goal.unit} in ${ctx.phase1.goal.horizonDays} days`);
      if (ctx.phase1.goal.motivation) lines.push(`  Motivation: ${ctx.phase1.goal.motivation.slice(0, 120)}`);
    }
    if (ctx.phase1.competitors.length > 0) {
      lines.push(`Competitors (${ctx.phase1.competitors.length}): ${ctx.phase1.competitors.slice(0, 5).map(c => c.name).join(', ')}`);
    }
    if (ctx.phase1.direction) {
      lines.push(`Strategic direction: ${ctx.phase1.direction.headline}`);
      if (ctx.phase1.direction.primaryChannel) lines.push(`  Primary channel: ${ctx.phase1.direction.primaryChannel}`);
      const w1 = ctx.phase1.direction.week1 as Record<string, unknown> | null;
      if (w1?.focus) lines.push(`  Week 1 focus: ${w1.focus}`);
    }
    lines.push('=== END PHASE 1 ===');
  }

  lines.push(`Plan: ${ctx.founder.plan}${ctx.founder.tokenBalance !== null ? ` | Tokens: ${ctx.founder.tokenBalance}` : ' (unlimited)'}`);
  lines.push('=== END CONTEXT ===');

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateMonthlyBudget(plan: string): number | null {
  const budgets: Record<string, number> = {
    free: 0, solo: 100, builder: 500, studio: 2000,
  };
  return budgets[plan] ?? null;
}
