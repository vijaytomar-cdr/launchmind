/**
 * @file opportunityEligibility.ts
 * @description Which starter opportunities a product is actually eligible for.
 *
 *   THE DEFECT THIS REPLACES was worse than evidence-blindness. The seeder was
 *   three hardcoded templates emitted for every product, carrying invented
 *   evidence presented as measurement:
 *
 *     "Competitor ranking +15 positions"      — no competitor scrape ran
 *     "Rating: 4.2 → 4.1 (7d)"                — AllignX has ZERO reviews
 *     "4 reviews: 'confusing setup'"          — quoting reviews that do not exist
 *     source: 'review_analysis'               — claiming provenance that never ran
 *
 *   It also assumed capabilities: LaunchMind, a pre-launch product with no store
 *   listing, was told to "Add high-intent keywords to Launchmind ASO title".
 *   There is no title to optimise.
 *
 *   TWO RULES HERE:
 *     1. ELIGIBILITY comes from what the product demonstrably has. No store
 *        listing, no store advice.
 *     2. EVIDENCE is derived from real state or omitted. A starter opportunity
 *        is a suggestion of where to look — it must never cite a measurement
 *        LaunchMind never took.
 *
 *   Fewer opportunities is the correct outcome for a product we know little
 *   about. Filling the list is not a goal.
 *
 * @security Pure function of product state. No founder-wide reads, no network.
 * @dependencies none
 */

/** What the product demonstrably has, derived from scraped_meta + columns. */
export interface ProductCapabilities {
  hasAppStore:  boolean;
  hasPlayStore: boolean;
  hasWebsite:   boolean;
  hasReviews:   boolean;
  isPreLaunch:  boolean;
  markets:      string[];
}

export interface SeedOpportunity {
  type: string;
  title: string;
  description: string;
  expected_impact: string | null;
  confidence: number;
  effort: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  why_now: string;
  source: string;
  /** Only statements that are true of THIS product. Often empty. */
  evidence: string[];
}

/**
 * Reads capabilities from the product row.
 *
 * Uses the multi-source discovery shape (`stores[]` + `websiteMeta`) with a
 * fallback to the legacy flat scalar, so products onboarded before that change
 * are still classified correctly rather than defaulting to "has everything".
 */
export function readCapabilities(product: {
  maturity?: string | null;
  markets?: string[] | null;
  scraped_meta?: Record<string, unknown> | null;
}): ProductCapabilities {
  const meta = product.scraped_meta ?? {};
  const stores = Array.isArray(meta.stores) ? (meta.stores as Array<Record<string, unknown>>) : [];
  const platforms = new Set(stores.map(s => String(s.platform)));

  // Legacy products predate stores[]; the flat scalar still means a real listing.
  if (platforms.size === 0 && typeof meta.platform === 'string' && meta.name) {
    platforms.add(meta.platform);
  }

  const website = (meta.websiteMeta as Record<string, unknown>) ?? {};
  const reviews = Array.isArray(meta.reviews) ? meta.reviews : [];

  return {
    hasAppStore:  platforms.has('app_store'),
    hasPlayStore: platforms.has('play_store'),
    // An empty object is what scrapeWebsite returns on failure — not a website.
    hasWebsite:   Object.keys(website).length > 0,
    hasReviews:   reviews.length > 0,
    isPreLaunch:  meta.preLaunch === true || product.maturity === 'pre_launch',
    markets:      product.markets ?? [],
  };
}

/**
 * Starter opportunities this product is genuinely eligible for.
 *
 * @param productName - used only for readable titles, never for eligibility
 * @returns 0–3 opportunities. An empty array is a valid, honest answer.
 */
export function eligibleOpportunities(
  productName: string,
  caps: ProductCapabilities,
): SeedOpportunity[] {
  const out: SeedOpportunity[] = [];

  // ── Store optimisation — only where a listing exists ──────────────────────
  if (caps.hasAppStore || caps.hasPlayStore) {
    const stores = [caps.hasAppStore && 'App Store', caps.hasPlayStore && 'Google Play']
      .filter(Boolean).join(' and ');
    out.push({
      type: 'aso',
      title: `Review how ${productName} is described on the ${stores}`,
      description:
        `Your listing title and subtitle are the first thing a searcher reads. ` +
        `Reviewing the keywords they contain is usually the cheapest install lever.`,
      expected_impact: null,   // no baseline observed — a number here would be invented
      confidence: 0.5,
      effort: 'low', risk: 'low',
      why_now: 'A starting point while LaunchMind has no performance data yet.',
      source: 'product_context',
      // Only what is demonstrably true.
      evidence: [`Listing detected on ${stores}`],
    });
  }

  // ── Review response — only where reviews were actually read ───────────────
  if (caps.hasReviews) {
    out.push({
      type: 'review_risk',
      title: 'Read your recent reviews for repeated complaints',
      description:
        'Repeated wording across reviews usually points at one fixable friction point.',
      expected_impact: null,
      confidence: 0.5,
      effort: 'medium', risk: 'medium',
      why_now: 'Public reviews were found for your product.',
      source: 'review_analysis',
      evidence: ['Public reviews available for this product'],
    });
  }

  // ── Website / content — only where a site was read ────────────────────────
  if (caps.hasWebsite) {
    out.push({
      type: 'seo_content',
      title: `Check what ${productName}'s site says to a first-time visitor`,
      description:
        'Your homepage is doing the explaining when nobody is there to answer questions.',
      expected_impact: null,
      confidence: 0.5,
      effort: 'medium', risk: 'low',
      why_now: 'A website was found during discovery.',
      source: 'product_context',
      evidence: ['Website detected during discovery'],
    });
  }

  // ── Pre-launch — no public surface to optimise, so different advice ───────
  if (caps.isPreLaunch && !caps.hasAppStore && !caps.hasPlayStore) {
    out.push({
      type: 'launch_prep',
      title: 'Start a waitlist before launch',
      description:
        'A list of people who already want it turns launch day into a send, not a gamble.',
      expected_impact: null,
      confidence: 0.5,
      effort: 'low', risk: 'low',
      why_now: 'Your product is pre-launch, so there is nothing public to optimise yet.',
      source: 'founder_context',
      evidence: ['Product recorded as pre-launch'],
    });
    out.push({
      type: 'positioning_test',
      title: 'Test your positioning with a handful of target customers',
      description:
        'Confirming the words that land is cheaper before launch than after.',
      expected_impact: null,
      confidence: 0.5,
      effort: 'medium', risk: 'low',
      why_now: 'Positioning is founder-confirmed but has not been tested against real customers.',
      source: 'founder_context',
      evidence: ['Positioning confirmed during setup'],
    });
  }

  // NOTE: no market-expansion seed. The old "Launch in India — strong market
  // signal" cited "India category growth 3×" and "CPI 60% lower than USA" for
  // every product regardless of category or market. Recommending a market entry
  // needs real comparative data, and none is observed at this point.

  return out.slice(0, 3);
}
