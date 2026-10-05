/**
 * @file marketIntelligenceNonInfluence.pg.test.ts
 * @description THE MANDATORY SHADOW PROOF (Phase 3.4B §18).
 *
 *   The claim under test is negative and therefore easy to assert and hard to
 *   earn: shadow Market Intelligence changes NOTHING an owner sees.
 *
 *   It is proved by DIFFERENCE, not by inspection. The owner-visible surface is
 *   captured with the shadow corpus absent, then a full ingest + resolve cycle
 *   runs against the same product, then the surface is captured again and the
 *   two are compared field by field. A proof that only looked at the second
 *   state could not tell "unchanged" from "changed identically every time".
 *
 *   The model is deliberately NOT called: `issueEvidenceHandles` IS the set of
 *   evidence offered to the model, so counting its output is a stronger and
 *   deterministic measurement of "what the model was given" than reading what
 *   the model said back.
 *
 * @security Any non-zero MARKET_INTELLIGENCE count here is a P0 stop condition.
 * @dependencies contextPackageV2, growthBrainOutputGrounding,
 *   marketIntelligenceService (all real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { issueEvidenceHandles } from '../src/services/growthBrainOutputGrounding';
import { deriveUnavailable } from '../src/services/growthBrainRecommendationService';
import {
  ingestStoreListing, resolveForProduct, marketEvidenceHandles,
} from '../src/services/marketIntelligence/marketIntelligenceService';
import { storeSubjectKey, resolveMarketIntelligenceMode } from '../src/services/marketIntelligence/contract';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RUN = `${Date.now()}-${process.pid}`;
const F = uuidFrom(`mini-f-${RUN}`);
const WS = uuidFrom(`mini-ws-${RUN}`);
const P = uuidFrom(`mini-p-${RUN}`);
const SESSION = uuidFrom(`mini-s-${RUN}`);
const COMP = storeSubjectKey('app_store', 'us', 'id333333333');

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

/** Everything an owner could observe, reduced to something comparable. */
async function ownerVisibleSurface() {
  const pkg = await buildContextPackageV2({
    workspaceId: WS, founderId: F, productId: P,
    intent: 'MORNING_BRIEF',
    query: 'What are the most important marketing priorities for this product right now?',
    persist: false,
  });
  const handles = issueEvidenceHandles(pkg);
  return {
    handleRefs: handles.map(h => `${h.ref}:${h.kind}`).sort(),
    handleTexts: handles.map(h => h.text).sort(),
    marketHandles: handles.filter(h => h.kind === 'MARKET_INTELLIGENCE').length,
    unavailable: deriveUnavailable(pkg, false).sort(),
    memoryCount: pkg.retrievedMemories.length,
    competitors: pkg.founderContext.competitors.map(c => c.name).sort(),
    metrics: pkg.operational.recentMetrics.length,
    // The package itself must gain no market-shaped field.
    packageKeys: Object.keys(pkg).sort(),
    operationalKeys: Object.keys(pkg.operational).sort(),
  };
}

/**
 * Counts scoped to THIS lab.
 *
 * Global counts were wrong and the certification run proved it: other PG suites
 * insert and delete into the same tables concurrently, so a whole-table count
 * measures the test runner, not this subsystem. Scoping by workspace/founder is
 * also the stronger assertion — it is specifically "market intelligence did not
 * write into THIS business".
 */
async function tableCounts() {
  const byWs = async (t: string) =>
    (await db().from(t).select('id', { count: 'exact', head: true }).eq('workspace_id', WS)).count ?? 0;
  const byFounder = async (t: string) =>
    (await db().from(t).select('id', { count: 'exact', head: true }).eq('founder_id', F)).count ?? 0;
  return {
    marketing_memories: await byWs('marketing_memories'),
    marketing_memory_versions: await byWs('marketing_memory_versions'),
    evidence: await byWs('evidence'),
    growth_brain_recommendations: await byWs('growth_brain_recommendations'),
    missions: await byWs('missions'),
    campaigns: await byFounder('campaigns'),
    content_assets: await byFounder('content_assets'),
  };
}

d('Phase 3.4B §18 — shadow Market Intelligence influences nothing', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: `mini-${RUN}@lab.invalid`, name: 'MI NONINF', plan: 'studio' }, { onConflict: 'id' }));
    await must('workspaces', db().from('workspaces').upsert(
      { id: WS, founder_id: F, name: `MI NONINF ${RUN}` }, { onConflict: 'id' }));
    await must('products', db().from('products').upsert({
      id: P, founder_id: F, workspace_id: WS, name: 'NonInfluence App',
      store_url: 'https://mi.invalid/noninf', platform: 'app_store',
      category: 'productivity', markets: ['usa'],
    }, { onConflict: 'id' }));
    // competitor_relationships.session_id is NOT NULL, so a confirmed competitor
    // only exists downstream of an onboarding session. Seeding one rather than
    // dropping the competitor: the surface must be non-trivial for the
    // before/after comparison to mean anything.
    await must('onboarding_session', db().from('onboarding_sessions').upsert({
      id: SESSION, founder_id: F, current_state: 'PHASE_1_COMPLETE', product_id: P,
    }, { onConflict: 'id' }));
    await must('competitors', db().from('competitor_relationships').upsert({
      id: uuidFrom(`mini-c-${RUN}`), founder_id: F, product_id: P, session_id: SESSION,
      name: 'Rival', relationship: 'CONFIRMED', key_differentiator: 'cheaper',
    }, { onConflict: 'id' }));
  }, 120_000);

  afterAll(async () => {
    await db().from('market_intelligence_resolutions').delete().eq('workspace_id', WS);
    await db().from('market_intelligence_source_records').delete().eq('subject_key', COMP);
    await db().from('competitor_relationships').delete().eq('product_id', P);
    await db().from('onboarding_sessions').delete().eq('id', SESSION);
    await db().from('products').delete().eq('id', P);
    await db().from('workspaces').delete().eq('id', WS);
    await db().from('founders').delete().eq('id', F);
  });

  it('the owner-visible surface is IDENTICAL before and after a full shadow cycle', async () => {
    expect(resolveMarketIntelligenceMode()).toBe('SHADOW');

    const beforeSurface = await ownerVisibleSurface();
    const beforeCounts = await tableCounts();
    expect(beforeSurface.marketHandles).toBe(0);

    // A full shadow cycle: ingest, resolve, and confirm shadow really did work.
    const ing = await ingestStoreListing({
      provider: 'app_store', storefront: 'us', providerId: 'id333333333',
      sourceRef: 'https://apps.apple.com/us/app/rival/id333333333',
      name: 'Rival', developer: 'RivalCo',
      summary: 'Book a trusted local pro in minutes.', category: 'productivity',
      rating: 4.4, ratingCount: 12000, free: true,
      updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      releasedAt: '2020-01-01T00:00:00.000Z',
      retrievedAt: new Date().toISOString(),
    });
    expect(ing.records.length, 'shadow ingestion produced nothing, so the test would be vacuous')
      .toBeGreaterThan(0);

    const resolved = await resolveForProduct({
      workspaceId: WS, productId: P,
      product: {
        confirmedCompetitorSubjectKeys: [COMP], ownSubjectKey: null,
        dims: { category: 'productivity', geography: 'usa' },
      },
      subjectKeys: [COMP],
    });
    const decision = marketEvidenceHandles(resolved.items);
    expect(decision.wouldBeHandles.length, 'nothing was eligible, so non-influence would be vacuous')
      .toBeGreaterThan(0);

    // ── THE PROOF ────────────────────────────────────────────────────────────
    const afterSurface = await ownerVisibleSurface();
    expect(afterSurface).toEqual(beforeSurface);
    expect(afterSurface.marketHandles).toBe(0);

    // marketIntelligenceAvailable stays false even though evidence resolved.
    expect(decision.marketIntelligenceAvailable).toBe(false);
    expect(decision.handles).toHaveLength(0);

    // No mutation anywhere that matters.
    expect(await tableCounts()).toEqual(beforeCounts);
  }, 180_000);

  it('the Growth Brain generator still hard-codes availability false, unchanged by 3.4B', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/services/growthBrainRecommendationService.ts', 'utf8'));
    // 3.4C: the hardcoded override is replaced by a DERIVED value. The safety
    // property is unchanged and is now stronger — availability comes from what
    // actually resolved for this product, so SHADOW (empty marketEvidence)
    // still yields false, and no flag can make it true without real evidence.
    expect(src).toMatch(/pkg\.marketIntelligence\.available === true && pkg\.marketEvidence\.length > 0/);
    // The caller-supplied hint must remain ignored: it was computed from
    // seeded synthetic playbook_signals.
    expect(src).toMatch(/void req\.marketIntelligenceAvailable;/);
  });

  it('ContextPackageV2 carries the market fields but they are EMPTY in shadow', async () => {
    // 3.4B asserted the fields did not exist. 3.4C adds them, so the assertion
    // moves from "absent" to "present and inert" — which is the stronger claim
    // anyway: the wiring exists and still yields nothing in SHADOW.
    const pkg = await buildContextPackageV2({
      workspaceId: WS, founderId: F, productId: P, intent: 'MORNING_BRIEF',
      query: 'What should this product focus on next?', persist: false,
    });
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(pkg.marketIntelligence.mode).toBe('SHADOW');
    // The operational section must not have grown a market field of its own —
    // there is exactly ONE place market evidence lives.
    for (const k of Object.keys(pkg.operational)) {
      expect(k.toLowerCase(), `${k} looks like a second market path`)
        .not.toMatch(/market(intel|_intel)|benchmark|externalevidence/);
    }
  }, 120_000);
});
