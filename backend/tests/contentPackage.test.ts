/**
 * @file contentPackage.test.ts
 * @description Phase 3.5B4 acceptance — content package orchestration.
 *
 *   The question is whether LaunchMind plans a COMPLETE, BOUNDED package from a
 *   strategy and produces it through the existing governed pipeline — not
 *   whether it can emit more content.
 *
 * @security MemoryDb only. No network, no provider call, no execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { ProductContentContext } from '../src/services/content/productContentContext';
import type { ContentStrategy } from '../src/services/content/strategyComposition';

const WS_A = '11111111-1111-4111-8111-111111111111';
const PROD_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PROD_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const FOUNDER = 'ffffffff-1111-4111-8111-111111111111';
const CAMP = 'cccccccc-1111-4111-8111-111111111111';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db,
}));

const P = async () => import('../src/services/content/contentPackagePolicy');
const O = async () => import('../src/services/content/contentPackageOrchestrator');

const silent = async () => ({ byField: new Map(), artifactClaims: [],
  unresolvedFields: [], unverifiable: false, failureReason: null });

const ALL_CHANNELS = ['GOOGLE_RSA', 'META_AD', 'LANDING_PAGE',
                      'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT'] as const;

const confirmed = (k: string, v: unknown) =>
  ({ fieldKey: k, value: v, provenance: 'OWNER_CONFIRMED', sourceLabel: null,
     ownerConfirmed: true, supersededCount: 0 });

/** A product whose governed fields the owner HAS resolved. */
const RESOLVED_BRAND = { productId: PROD_A, workspaceId: WS_A, version: 3, missing: [],
  fields: { cta_destination: confirmed('cta_destination', 'https://example.test/start'),
            pricing: confirmed('pricing', 'from $19') } } as never;

const ctxOf = (over: Partial<ProductContentContext> = {}): ProductContentContext => ({
  workspaceId: WS_A, productId: PROD_A,
  application: { name: 'ClientPulse', category: 'analytics', markets: ['usa'], description: null },
  brand: { productId: PROD_A, workspaceId: WS_A, version: 3, missing: [], fields: {} } as never,
  prohibitedTerms: [],
  founderDirection: { audienceConfirmed: 'agency owners', contextDelta: null,
    primaryGoal: 'acquisition', competitors: [] },
  evidence: [{ ref: 'product', kind: 'PRODUCT_CONTEXT', label: 'Your product profile', text: 'x' } as never],
  authorizedAssets: [], observedAssetCount: 0, marketIntelligenceAvailable: false,
  brandProvenance: [], unavailable: [], ...over,
} as ProductContentContext);

const strategyOf = (over: Partial<ContentStrategy> = {}): ContentStrategy => ({
  workspaceId: WS_A, productId: PROD_A, objective: 'get the week back',
  audience: 'agency owners', campaignThesis: 'reporting time is client time',
  angle: 'reporting time is client time',
  coreNarrative: 'reporting time is client time — framed by a durable product truth.',
  messageHierarchy: ['reporting time is client time'],
  proofAvailable: ['Your product profile'], proofUnavailable: [],
  ctaIntent: 'start a trial', constraints: [], objections: [],
  productRole: 'ClientPulse writes the report', primaryBenefit: 'get the week back',
  brandDirectives: [], prohibitedTerminology: [],
  intelligenceInformed: [], founderOverrides: [], memoryApplied: [],
  brandKitVersion: 3, ...over,
} as ContentStrategy);

const briefIds = Object.fromEntries(ALL_CHANNELS.map((c, i) => [c, `brief-${i}`]));

const model = async () => JSON.stringify({
  content: { primaryText: 'Reporting eats the week.', headline: 'Get it back',
    description: 'For agencies',
    headlines: ['Reporting handled', 'Get the week back', 'Built for agencies'],
    descriptions: ['Spend the week on clients.', 'Reporting that writes itself.'],
    h1: 'Reporting time is client time', subhead: 'ClientPulse writes the report.',
    proofSection: 'Built for agency reporting.', benefits: ['Less admin'],
    objectionSection: 'Setup takes minutes.', ctas: ['Start free'],
    hook: 'Most agencies lose Friday.', body: 'Most agencies lose Friday to reporting.',
    authorMode: 'COMPANY',
    scenePlan: [{ scene: 1, purpose: 'p', visual: 'v', voiceover: 'Reporting eats your week.', onScreenText: 'Friday again' },
                { scene: 2, purpose: 'p', visual: 'v', voiceover: 'It writes itself.', onScreenText: 'Monday clear' }],
    cta: 'Try it', estimatedSeconds: 18 },
  declaredClaims: [],
});

beforeEach(() => {
  db = new MemoryDb({
    products: [{ id: PROD_A, workspace_id: WS_A }, { id: PROD_B, workspace_id: WS_A }],
    content_campaigns: [{ id: CAMP, workspace_id: WS_A, product_id: PROD_A, name: 'Know who is coming' }],
    content_assets: [], content_versions: [], asset_approvals: [],
    marketing_memories: [], publishing_targets: [], campaigns: [],
  });
  (globalThis as { __db: MemoryDb }).__db = db;
});

// ── G/H — package model and bounds ─────────────────────────────────────────
describe('package planning', () => {
  it('G — a package plans multiple channels with reasons', async () => {
    const { planContentPackage } = await P();
    const pkg = planContentPackage({
      campaignId: CAMP, channels: ALL_CHANNELS, authorizedAssetCount: 2,
      hasEvidence: true, ownerConfirmationRequired: [], avatarVoiceChosen: true,
      opportunityType: 'PRODUCT_BENEFIT' });
    expect(pkg.items.length).toBe(5);
    for (const i of pkg.items) expect(i.reason.length).toBeGreaterThan(10);
    expect(pkg.reviewFirst?.channel).toBe('LANDING_PAGE');
  });

  it('H/M2 — the package is bounded and its own limits are enforced', async () => {
    const { planContentPackage, validatePackage, PACKAGE_LIMITS } = await P();
    const pkg = planContentPackage({
      campaignId: CAMP,
      channels: [...ALL_CHANNELS, ...ALL_CHANNELS, ...ALL_CHANNELS] as never,
      authorizedAssetCount: 5, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: true, opportunityType: 'PRODUCT_BENEFIT' });
    expect(pkg.items.length).toBeLessThanOrEqual(PACKAGE_LIMITS.maxChannels);
    const total = pkg.items.reduce((n, i) => n + i.quantity, 0);
    expect(total).toBeLessThanOrEqual(PACKAGE_LIMITS.maxTotalArtifacts);
    expect(validatePackage(pkg).ok).toBe(true);
  });

  it('a package that breaks its own ceiling is invalid', async () => {
    const { validatePackage, PACKAGE_LIMITS } = await P();
    const bad = { campaignId: CAMP, items: Array.from({ length: 9 }, () => ({
      channel: 'META_AD', quantity: 4, state: 'READY_TO_GENERATE', reason: 'r',
      blockedReason: null, variants: [] })), totalPlannedArtifacts: 36,
      readyCount: 9, blockedCount: 0, notes: [], reviewFirst: null } as never;
    const v = validatePackage(bad);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain(String(PACKAGE_LIMITS.maxChannels));
  });
});

// ── I — dependencies ───────────────────────────────────────────────────────
describe('package dependencies', () => {
  it('I/M3 — a blocked item is named, not substituted, and the rest survive', async () => {
    const { planContentPackage } = await P();
    const pkg = planContentPackage({
      campaignId: CAMP, channels: ALL_CHANNELS,
      authorizedAssetCount: 0,          // Meta blocked on asset
      hasEvidence: false,               // landing page blocked on proof
      ownerConfirmationRequired: ['ctaDestination'],   // Google blocked on owner
      avatarVoiceChosen: false,
      // A SPOKESPERSON VIDEO blocks on a presenter. PRODUCT_MOTION — the
      // default — does not, and this test used to assert the opposite because
      // readiness ignored the mode entirely (§8). The intent here is that each
      // blocker is NAMED and the unaffected channel survives, so the mode that
      // genuinely needs a person is the one to ask for.
      videoMode: 'AVATAR_SPOKESPERSON',
      opportunityType: 'PRODUCT_BENEFIT' });

    const by = Object.fromEntries(pkg.items.map(i => [i.channel, i]));
    expect(by.META_AD.state).toBe('BLOCKED_ON_ASSET');
    expect(by.LANDING_PAGE.state).toBe('BLOCKED_ON_PROOF');
    expect(by.SHORT_FORM_VIDEO_SCRIPT.state).toBe('BLOCKED_ON_OWNER_CONFIRMATION');
    expect(by.GOOGLE_RSA.state).toBe('BLOCKED_ON_OWNER_CONFIRMATION');
    // LinkedIn needs none of those, so it stays usable.
    expect(by.LINKEDIN_POST.state).toBe('READY_TO_GENERATE');
    expect(pkg.readyCount).toBe(1);
    expect(pkg.blockedCount).toBe(4);
    for (const i of pkg.items.filter(x => x.state !== 'READY_TO_GENERATE')) {
      expect(i.blockedReason, `${i.channel} blocked with no reason`).toBeTruthy();
    }
  });

  it('a proof-led variant is not planned when there is nothing to prove', async () => {
    const { planContentPackage } = await P();
    const withProof = planContentPackage({ campaignId: CAMP, channels: ['META_AD'],
      authorizedAssetCount: 1, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: true, opportunityType: 'PRODUCT_BENEFIT' });
    const without = planContentPackage({ campaignId: CAMP, channels: ['META_AD'],
      authorizedAssetCount: 1, hasEvidence: false, ownerConfirmationRequired: [],
      avatarVoiceChosen: true, opportunityType: 'PRODUCT_BENEFIT' });
    expect(withProof.items[0].variants.map(v => v.label)).toContain('proof-led');
    expect(without.items[0].variants.map(v => v.label)).not.toContain('proof-led');
  });
});

// ── J/K/L/M — orchestration ────────────────────────────────────────────────
describe('orchestration', () => {
  const run = async (over: Record<string, unknown> = {}) => {
    const { orchestrateContentPackage } = await O();
    return orchestrateContentPackage({
      ctx: ctxOf({ authorizedAssets: [{ id: 'a1', assetType: 'SCREENSHOT' } as never],
        brand: RESOLVED_BRAND }),
      strategy: strategyOf(), campaignId: CAMP, strategyId: 'strat-1',
      opportunityTitle: 'Trust gap', campaignName: 'Know who is coming',
      founderId: FOUNDER, mode: 'AI_CMO_RECOMMENDED', briefIds: briefIds as never,
      avatarVoiceChosen: true, generate: model, semantic: silent as never, ...over,
    } as never);
  };

  it('J/M4 — every channel is produced through the B3 pipeline and persisted', async () => {
    const out = await run();
    expect(out.generated.length).toBeGreaterThanOrEqual(5);
    for (const g of out.generated) {
      expect(g.assetId, `${g.channel} was not persisted`).toBeTruthy();
      expect(g.versionNumber).toBe(1);
      // Governance ran: a disposition exists and quality is dimensional.
      expect(g.disposition).toBeTruthy();
      expect(g.quality.performance).toBe('UNKNOWN_UNTIL_EXECUTED');
      expect(g.quality.creativeQuality).toBe('NOT_CERTIFIED');
    }
    expect(db.rows('content_versions').every(v => v.version_number === 1)).toBe(true);
  });

  it('stops the package after the first authoritative generation outage', async () => {
    const generate = vi.fn(async () => '{}');
    const out = await run({ generate, useCreativeSetForMeta: true });
    expect(out.generationUnavailable).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.generated).toHaveLength(0);
    expect(db.rows('content_assets')).toHaveLength(0);
  });

  it('production Meta delegation persists the A/B/C concept identities and lineage', async () => {
    const out = await run({ useCreativeSetForMeta: true,
      creativePatterns: ['Problem-first opening', 'Product reveal after recognition'],
      firstPartyLearning: [] });
    const meta = out.generated.filter(g => g.channel === 'META_AD');
    expect(meta.map(g => g.variantLabel)).toEqual([
      'Problem recognition', 'Product demonstration', 'Relief',
    ]);
    expect(meta.every(g => g.assetId && g.versionNumber === 1)).toBe(true);
    const rows = db.rows('content_assets').filter(r => r.channel === 'meta_ad');
    expect(rows.map(r => r.variant_label)).toEqual([
      'Problem recognition', 'Product demonstration', 'Relief',
    ]);
    for (const row of rows) {
      const payload = row.structured_data as Record<string, unknown>;
      expect(payload.creativeBrief).toBeTruthy();
      expect(payload.scenePlan).toBeTruthy();
    }
  });

  it('passes each ready concept scene plan into the production render seam', async () => {
    const render = vi.fn(async () => undefined);
    const byLabel: Record<string, Record<string, string>> = {
      A: { headline: 'Still waiting on a callback?',
        primaryText: 'AllignX connects you with vetted professionals.',
        description: 'See how AllignX works', visualBrief: 'tension then product reveal' },
      B: { headline: 'AllignX connects you with vetted pros',
        primaryText: 'AllignX connects you with trusted professionals.',
        description: 'See how AllignX works', visualBrief: 'product interface first' },
      C: { headline: 'Home projects could feel calmer',
        primaryText: 'AllignX connects you with vetted professionals.',
        description: 'See how AllignX works', visualBrief: 'open calm space then product' },
    };
    await run({ useCreativeSetForMeta: true, renderConcept: render,
      briefIds: { META_AD: 'brief-meta' },
      ctx: ctxOf({ application: { name: 'AllignX', category: 'home services', markets: ['usa'],
        description: 'Connect with vetted home service professionals in your neighborhood.' },
        authorizedAssets: [{ id: 'a1', assetType: 'SCREENSHOT' } as never],
        brand: RESOLVED_BRAND }),
      strategy: strategyOf({ audience: 'homeowners', campaignThesis: 'finding help is hard',
        angle: 'finding help is hard', coreNarrative: 'finding help is hard',
        messageHierarchy: ['finding help is hard'],
        productRole: 'AllignX connects homeowners with vetted professionals',
        primaryBenefit: 'connect with vetted professionals',
        ctaIntent: 'See how AllignX works' }),
      generate: async (system: string) => JSON.stringify({ content:
        /Problem recognition/.test(system) ? byLabel.A
          : /Product demonstration/.test(system) ? byLabel.B : byLabel.C,
        declaredClaims: [] }) });
    // Only concepts that pass the pre-render creative-quality gate render.
    // The scripted B is deliberately held back by that gate; its PRODUCT_HERO
    // mapping is covered by creativeScenePlan.test.ts.
    expect(render.mock.calls.map(call => call[0].scenePlan.composition)).toEqual([
      'PROBLEM_FRAME', 'RELIEF_FRAME',
    ]);
  });

  it('M4 — the orchestrator surfaces REAL governance verdicts, not a rubber stamp', async () => {
    // A fake ELIGIBLE result satisfies "a disposition exists". The only
    // assertion a bypass cannot satisfy is one that requires the claim engine
    // to have actually rejected something.
    const out = await run({
      generate: async () => JSON.stringify({ content: {
        primaryText: 'Cut acquisition cost by 40%.', headline: 'Cut CAC 40%',
        description: 'Trusted by 50,000 teams', h1: 'Cut CAC by 40%',
        subhead: 'Trusted by 50,000 teams.', ctas: ['Start'],
        hook: 'Cut CAC by 40%', body: 'We cut acquisition cost by 40% for agencies.',
        authorMode: 'COMPANY',
        headlines: ['Cut CAC 40%', 'Save 40% now', 'Built for agencies'],
        descriptions: ['We cut acquisition cost by 40%.', 'Trusted by 50,000 teams.'],
        proofSection: 'Trusted by 50,000 teams', benefits: ['Less spend'],
        objectionSection: 'It works.',
        scenePlan: [{ scene: 1, purpose: 'p', visual: 'v', voiceover: 'We cut CAC by 40%.', onScreenText: '40%' },
                    { scene: 2, purpose: 'p', visual: 'v', voiceover: 'Really.', onScreenText: '50,000 teams' }],
        cta: 'Try', estimatedSeconds: 15 }, declaredClaims: [] }),
    });
    expect(out.generated.length).toBeGreaterThan(0);
    const rejected = out.generated.filter(g => g.disposition === 'REWRITE_REQUIRED');
    expect(rejected.length, 'unsupported claims passed through the orchestrator').toBeGreaterThan(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/claim more than your evidence supports/i);
    expect(rejected[0].quality.factualSafety).toBe('NOT_SUPPORTED');
  });

  it('K/M6 — one campaign, one thesis, across every channel', async () => {
    const out = await run();
    expect(out.narrativeThesis).toBe('reporting time is client time');
    // Every artifact links to the same campaign and strategy.
    const assets = db.rows('content_assets');
    expect(new Set(assets.map(a => a.content_campaign_id)).size).toBe(1);
    expect(new Set(assets.map(a => a.strategy_id)).size).toBe(1);
  });

  it('I(orch) — a blocked item is skipped with a reason; others still generate', async () => {
    const out = await run({
      ctx: ctxOf({ authorizedAssets: [], brand: RESOLVED_BRAND }),  // Meta blocked on asset
      // Only a spokesperson video waits on a person — see §8.
      avatarVoiceChosen: false,
      videoMode: 'AVATAR_SPOKESPERSON',
    });
    const skippedChannels = out.skipped.map(s => s.channel);
    expect(skippedChannels).toContain('META_AD');
    expect(skippedChannels).toContain('SHORT_FORM_VIDEO_SCRIPT');
    for (const s of out.skipped) expect(s.reason.length).toBeGreaterThan(5);
    expect(out.generated.length).toBeGreaterThan(0);   // package not failed
  });

  it('an unresolved CTA destination blocks the paid channels, by design', async () => {
    // Found while writing these tests: with no confirmed destination, Google and
    // Meta are BLOCKED_ON_OWNER_CONFIRMATION. That is correct — a search ad
    // whose destination nobody has confirmed should not be produced — and it is
    // asserted here so it can never become an accident.
    const out = await run({ ctx: ctxOf({
      authorizedAssets: [{ id: 'a1', assetType: 'SCREENSHOT' } as never] }) });
    const blocked = out.skipped.map(s2 => s2.channel);
    expect(blocked).toContain('GOOGLE_RSA');
    expect(blocked).toContain('META_AD');
    expect(out.skipped.find(s2 => s2.channel === 'GOOGLE_RSA')!.reason)
      .toMatch(/where this should send people/i);
    expect(out.generated.length).toBeGreaterThan(0);
  });

  it('the orchestrator contains no channel-specific generation logic', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../src/services/content/contentPackageOrchestrator.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    // Channel payload shapes belong to B3. If they appear here, a second
    // generator has been born.
    for (const shape of ['primaryText', 'headlines', 'scenePlan', 'subhead', 'CHANNEL_SHAPE']) {
      expect(src, `orchestrator re-implements ${shape}`).not.toContain(shape);
    }
  });

  it('M1 — package artifacts inherit product scope from the context', async () => {
    await run();
    for (const a of db.rows('content_assets')) {
      expect(a.product_id).toBe(PROD_A);
      expect(a.workspace_id).toBe(WS_A);
    }
  });

  it('AC — a different product produces a different package plan', async () => {
    const { planContentPackage } = await P();
    const a = planContentPackage({ campaignId: CAMP, channels: ALL_CHANNELS,
      authorizedAssetCount: 3, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: true, opportunityType: 'PRODUCT_BENEFIT' });
    const b = planContentPackage({ campaignId: CAMP, channels: ALL_CHANNELS,
      authorizedAssetCount: 0, hasEvidence: false, ownerConfirmationRequired: ['ctaDestination'],
      avatarVoiceChosen: false, opportunityType: 'PRODUCT_BENEFIT' });
    expect(a.readyCount).not.toBe(b.readyCount);
    expect(a.totalPlannedArtifacts).toBeGreaterThan(b.totalPlannedArtifacts);
  });
});

// ── L/M5 — variants ────────────────────────────────────────────────────────
describe('variants', () => {
  it('L — variants are strategic dimensions, not reworded copies', async () => {
    const { planContentPackage, VARIANT_DIMENSIONS } = await P();
    const pkg = planContentPackage({ campaignId: CAMP, channels: ['META_AD'],
      authorizedAssetCount: 2, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: true, opportunityType: 'PRODUCT_BENEFIT' });
    const variants = pkg.items[0].variants;
    expect(variants.length).toBeGreaterThanOrEqual(2);
    for (const v of variants) {
      expect(VARIANT_DIMENSIONS as readonly string[]).toContain(v.dimension);
      expect(v.intent.length).toBeGreaterThan(15);   // says what it CHANGES
    }
    expect(new Set(variants.map(v => v.label)).size).toBe(variants.length);
  });

  it('M/M5 — each variant is a separate artifact at version 1, sharing lineage', async () => {
    const { orchestrateContentPackage } = await O();
    await orchestrateContentPackage({
      ctx: ctxOf({ authorizedAssets: [{ id: 'a1', assetType: 'SCREENSHOT' } as never],
        brand: RESOLVED_BRAND }), strategy: strategyOf(),
      campaignId: CAMP, strategyId: 'strat-1', opportunityTitle: 'o', campaignName: 'c',
      founderId: FOUNDER, mode: 'OWNER_DIRECTED',
      briefIds: { META_AD: 'brief-meta' } as never, avatarVoiceChosen: true,
      generate: model, semantic: silent as never,
    } as never);

    const metas = db.rows('content_assets').filter(a => a.channel === 'meta_ad');
    expect(metas.length).toBeGreaterThanOrEqual(2);
    // Separate artifacts…
    expect(new Set(metas.map(a => a.id)).size).toBe(metas.length);
    // …each at version 1…
    for (const m of metas) {
      expect(db.rows('content_versions').filter(v => v.asset_id === m.id)).toHaveLength(1);
    }
    // …sharing one variant group, campaign and strategy.
    expect(new Set(metas.map(a => a.variant_group_id)).size).toBe(1);
    expect(new Set(metas.map(a => a.content_campaign_id)).size).toBe(1);
    expect(new Set(metas.map(a => a.variant_label)).size).toBe(metas.length);
  });
});

// ── N — owner view ─────────────────────────────────────────────────────────
describe('owner package view', () => {
  it('N/AE — the owner sees plain status and reasons, no internals', async () => {
    const { planContentPackage } = await P();
    const { ownerPackageView } = await O();
    const pkg = planContentPackage({ campaignId: CAMP, channels: ALL_CHANNELS,
      authorizedAssetCount: 0, hasEvidence: true, ownerConfirmationRequired: [],
      avatarVoiceChosen: false, videoMode: 'AVATAR_SPOKESPERSON',
      opportunityType: 'PRODUCT_BENEFIT' });
    const view = ownerPackageView(pkg, 'Know who is coming', 'reporting time is client time');

    expect(view.items.find(i => i.channel === 'META_AD')!.status).toBe('NEEDS_ASSET');
    expect(view.items.find(i => i.channel === 'SHORT_FORM_VIDEO_SCRIPT')!.status).toBe('NEEDS_YOU');
    expect(view.items.find(i => i.channel === 'LANDING_PAGE')!.status).toBe('READY');
    expect(view.reviewFirst).toContain('Landing page');
    for (const i of view.items) expect(i.why.length).toBeGreaterThan(10);

    const s = JSON.stringify(view);
    for (const leak of [WS_A, PROD_A, CAMP, 'BLOCKED_ON_', 'evidence_refs', 'OWNER_CONFIRMED']) {
      expect(s, `owner package view leaked ${leak}`).not.toContain(leak);
    }
  });
});

// ── AA/AB — side effects ───────────────────────────────────────────────────
describe('package side effects', () => {
  it('AA/AB/M12 — a full package writes no publish, launch, spend or memory', async () => {
    const { orchestrateContentPackage } = await O();
    await orchestrateContentPackage({
      ctx: ctxOf({ authorizedAssets: [{ id: 'a1', assetType: 'SCREENSHOT' } as never],
        brand: RESOLVED_BRAND }), strategy: strategyOf(),
      campaignId: CAMP, strategyId: 'strat-1', opportunityTitle: 'o', campaignName: 'c',
      founderId: FOUNDER, mode: 'AI_CMO_RECOMMENDED', briefIds: briefIds as never,
      avatarVoiceChosen: true, generate: model, semantic: silent as never,
    } as never);
    expect(db.rows('content_assets').length).toBeGreaterThan(0);   // it DID work
    expect(db.rows('marketing_memories')).toHaveLength(0);
    expect(db.rows('publishing_targets')).toHaveLength(0);
    expect(db.rows('campaigns')).toHaveLength(0);
    for (const a of db.rows('content_assets')) {
      expect(a.published_at ?? null).toBeNull();
      expect(a.content_status).not.toBe('CONTENT_APPROVED');
    }
  });

  it('package modules cannot reach execution or provider surfaces', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    for (const f of ['contentPackagePolicy.ts', 'contentPackageOrchestrator.ts']) {
      const src = readFileSync(join(__dirname, '../src/services/content', f), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      for (const forbidden of ['publishing_targets', 'spend_cap', 'launched_at',
                               'marketing_memories', 'heygen', 'replicate', 'elevenlabs']) {
        expect(src.toLowerCase(), `${f} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
