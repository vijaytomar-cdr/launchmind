/**
 * @file contentArtifactPersistence.test.ts
 * @description Phase 3.5B3.1 acceptance matrix — P1-58 closure.
 *
 *   Proves the lineage that B3 could only demonstrate in memory: a governed
 *   result becomes a real artifact with an immutable version, regeneration adds
 *   a version, an owner edit adds a governed version, and a variant is a
 *   different artifact rather than a different version of the same one.
 *
 * @security MemoryDb honours predicates, so an isolation case fails if a service
 *   forgets its workspace filter. No network, no execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { ChannelContentResult } from '../src/services/content/b3ContentGeneration';
import type { ProductContentContext } from '../src/services/content/productContentContext';
import type { ContentBrief } from '../src/services/content/briefComposition';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const PROD_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PROD_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const FOUNDER = 'ffffffff-1111-4111-8111-111111111111';
const CAMP = 'cccccccc-1111-4111-8111-111111111111';
const STRAT = 'dddddddd-1111-4111-8111-111111111111';
const BRIEF = 'eeeeeeee-1111-4111-8111-111111111111';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db,
}));

const P = async () => import('../src/services/content/contentArtifactPersistence');

const ctxOf = (over: Partial<ProductContentContext> = {}): ProductContentContext => ({
  workspaceId: WS_A, productId: PROD_A,
  application: { name: 'ClientPulse', category: 'analytics', markets: ['usa'], description: null },
  brand: { productId: PROD_A, workspaceId: WS_A, version: 3, missing: [], fields: {} } as never,
  prohibitedTerms: [],
  founderDirection: { audienceConfirmed: 'agency owners', contextDelta: null,
    primaryGoal: 'acquisition', competitors: [] },
  evidence: [{ ref: 'product', kind: 'PRODUCT_CONTEXT', label: 'Your product profile',
    text: 'x' } as never],
  authorizedAssets: [], observedAssetCount: 0, marketIntelligenceAvailable: false,
  brandProvenance: [], unavailable: [], ...over,
} as ProductContentContext);

const resultOf = (over: Partial<ChannelContentResult> = {}): ChannelContentResult => ({
  channel: 'META_AD',
  payload: { primaryText: 'Reporting eats the week.', headline: 'Get it back', description: 'For agencies' },
  fields: [{ name: 'headline', text: 'Get it back' }],
  disposition: 'ELIGIBLE', reasons: [], claims: [], structuralIssues: [],
  terminologyViolations: [], rewriteAttempts: 0, degraded: false,
  quality: { factualSafety: 'CERTIFIED_SUPPORTED', structuralValidity: 'VALID',
    brandAlignment: 'NOT_ASSESSABLE', strategicRelevance: 'LINKED_TO_STRATEGY',
    creativeQuality: 'NOT_CERTIFIED', performance: 'UNKNOWN_UNTIL_EXECUTED' },
  ...over,
} as ChannelContentResult);

const briefOf = () => ({ channel: 'META_AD', prohibitedTerminology: [] } as unknown as ContentBrief);

const inputOf = (over: Record<string, unknown> = {}) => ({
  identity: { workspaceId: WS_A, productId: PROD_A, campaignId: CAMP, strategyId: STRAT,
    briefId: BRIEF, channel: 'META_AD', variantGroupId: null, variantLabel: null },
  result: resultOf(), brief: briefOf(), ctx: ctxOf(), founderId: FOUNDER,
  provenance: ['Created from the opportunity "Trust gap"'],
  mode: 'OWNER_DIRECTED' as const, ...over,
});

beforeEach(() => {
  db = new MemoryDb({
    products: [{ id: PROD_A, workspace_id: WS_A }, { id: PROD_B, workspace_id: WS_B }],
    content_campaigns: [{ id: CAMP, workspace_id: WS_A, product_id: PROD_A, name: 'Know who is coming' }],
    content_assets: [], content_versions: [], asset_approvals: [],
    marketing_memories: [], publishing_targets: [], campaigns: [],
  });
  (globalThis as { __db: MemoryDb }).__db = db;
});

describe('artifact identity and immutable versions', () => {
  it('A/B — a governed result persists as an artifact with immutable version 1', async () => {
    const { persistGovernedArtifact } = await P();
    const out = await persistGovernedArtifact(inputOf() as never);
    expect(out.versionNumber).toBe(1);
    expect(out.status).toBe('ELIGIBLE_FOR_CONTENT_APPROVAL');

    const asset = db.rows('content_assets')[0];
    expect(asset.governance).toBe('GOVERNED_CONTENT_INTELLIGENCE');
    expect(asset.content_campaign_id).toBe(CAMP);
    expect(asset.strategy_id).toBe(STRAT);
    expect(asset.content_brief_id).toBe(BRIEF);
    expect(asset.brand_kit_version).toBe(3);

    const v = db.rows('content_versions')[0];
    expect(v.version_number).toBe(1);
    expect(v.disposition).toBe('ELIGIBLE');
    expect(v.brand_kit_version).toBe(3);
    expect((v.governance_summary as Record<string, unknown>).provenance).toBeTruthy();
  });

  it('W/X — a generation that produced nothing is never persisted', async () => {
    const { persistGovernedArtifact } = await P();
    await expect(persistGovernedArtifact(inputOf({
      result: resultOf({ fields: [], disposition: 'DEGRADED' }) }) as never))
      .rejects.toThrow(/no artifact to save/i);
    expect(db.rows('content_assets')).toHaveLength(0);
  });

  it('a DEGRADED result that DID produce fields is retained but never owner-ready', async () => {
    const { persistGovernedArtifact } = await P();
    const out = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'DEGRADED' }) }) as never);
    expect(out.status).toBe('DRAFT');
    expect(db.rows('content_versions')[0].disposition).toBe('DEGRADED');
  });

  it('a PROHIBITED result is DRAFT, not eligible', async () => {
    const { persistGovernedArtifact, statusForDisposition } = await P();
    expect(statusForDisposition('PROHIBITED')).toBe('DRAFT');
    const out = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'PROHIBITED' }) }) as never);
    expect(out.status).toBe('DRAFT');
  });

  it('a planning replay resumes its persisted artifact and immutable version instead of duplicating either', async () => {
    const { persistGovernedArtifact, persistedPlanningArtifact, ownerContentView } = await P();
    const planningWorkId = '99999999-2222-4222-8222-222222222222';
    const first = await persistGovernedArtifact(inputOf({ planningWorkId }) as never);
    const replay = await persistGovernedArtifact(inputOf({ planningWorkId }) as never);
    const resumed = await persistedPlanningArtifact({ planningWorkId, workspaceId: WS_A });

    expect(replay).toEqual(first);
    expect(db.rows('content_assets')).toHaveLength(1);
    expect(db.rows('content_versions')).toHaveLength(1);
    expect(db.rows('content_assets')[0].parent_asset_id).toBe(planningWorkId);
    expect(resumed).toMatchObject({ assetId: first.assetId, versionNumber: 1 });
    expect(await ownerContentView(first.assetId, WS_A)).toMatchObject({
      content: resultOf().payload, versionNumber: 1, status: 'ELIGIBLE_FOR_CONTENT_APPROVAL',
    });
  });
});

describe('regeneration, owner edit and variants', () => {
  it('C/D — regeneration adds v2 and leaves v1 untouched', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    const v1Before = JSON.stringify(db.rows('content_versions')[0]);

    const out = await appendGovernedVersion({
      assetId, workspaceId: WS_A, changeType: 'ai_regen', changeSummary: 'Regenerated',
      input: inputOf({ result: resultOf({
        payload: { primaryText: 'Second take.', headline: 'New', description: 'd' } }) }) as never,
    });
    expect(out.versionNumber).toBe(2);
    expect(db.rows('content_assets')).toHaveLength(1);          // same artifact
    const v1After = db.rows('content_versions').find(v => v.version_number === 1)!;
    expect(JSON.stringify(v1After)).toBe(v1Before);             // immutable
  });

  it('E/F — an owner edit adds a governed version and cannot be eligible by typing', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    const out = await appendGovernedVersion({
      assetId, workspaceId: WS_A, changeType: 'editor_save', changeSummary: 'Owner edit',
      input: inputOf({ result: resultOf({
        payload: { primaryText: 'Trusted by 50,000 companies.', headline: 'Join them', description: 'd' },
        disposition: 'REWRITE_REQUIRED',
        claims: [{ field: 'primary_text', text: 'Trusted by 50,000 companies.',
          category: 'CUSTOMER_COUNT', verdict: 'UNSUPPORTED', support: [] }],
      }) }) as never,
    });
    expect(out.versionNumber).toBe(2);
    expect(out.status, 'an owner edit became eligible merely by being typed')
      .toBe('REWRITE_REQUIRED');
    expect(db.rows('content_versions').find(v => v.version_number === 2)!.change_type)
      .toBe('editor_save');
  });

  it('G/H — variants are separate artifacts, each starting at version 1', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const group = '99999999-1111-4111-8111-111111111111';
    const a = await persistGovernedArtifact(inputOf({ identity: {
      workspaceId: WS_A, productId: PROD_A, campaignId: CAMP, strategyId: STRAT, briefId: BRIEF,
      channel: 'META_AD', variantGroupId: group, variantLabel: 'pain-led' } }) as never);
    const b = await persistGovernedArtifact(inputOf({ identity: {
      workspaceId: WS_A, productId: PROD_A, campaignId: CAMP, strategyId: STRAT, briefId: BRIEF,
      channel: 'META_AD', variantGroupId: group, variantLabel: 'benefit-led' } }) as never);

    expect(a.assetId).not.toBe(b.assetId);
    expect(a.versionNumber).toBe(1);
    expect(b.versionNumber).toBe(1);
    expect(db.rows('content_assets')).toHaveLength(2);

    // Regenerating A must not touch B.
    await appendGovernedVersion({ assetId: a.assetId, workspaceId: WS_A,
      changeType: 'ai_regen', changeSummary: 'r', input: inputOf() as never });
    expect(db.rows('content_versions').filter(v => v.asset_id === a.assetId)).toHaveLength(2);
    expect(db.rows('content_versions').filter(v => v.asset_id === b.assetId)).toHaveLength(1);
  });
});

describe('lineage, brand version and asset references', () => {
  it('I/J — lineage persists for both creation modes', async () => {
    const { persistGovernedArtifact } = await P();
    await persistGovernedArtifact(inputOf({ mode: 'AI_CMO_RECOMMENDED' }) as never);
    await persistGovernedArtifact(inputOf({ mode: 'OWNER_DIRECTED' }) as never);
    for (const a of db.rows('content_assets')) {
      expect(a.content_campaign_id).toBe(CAMP);
      expect(a.strategy_id).toBe(STRAT);
      expect(a.content_brief_id).toBe(BRIEF);
      expect(a.workspace_id).toBe(WS_A);
    }
  });

  it('K/L — the brand version at generation is retained; a later rebrand does not rewrite it', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    await appendGovernedVersion({ assetId, workspaceId: WS_A, changeType: 'ai_regen',
      changeSummary: 'after rebrand',
      input: inputOf({ ctx: ctxOf({ brand: { productId: PROD_A, workspaceId: WS_A,
        version: 4, missing: [], fields: {} } as never }) }) as never });

    const versions = db.rows('content_versions').sort((a, b) =>
      Number(a.version_number) - Number(b.version_number));
    expect(versions[0].brand_kit_version).toBe(3);   // history is history
    expect(versions[1].brand_kit_version).toBe(4);
  });

  it('M/N — a version records the asset ids eligible AT GENERATION TIME', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const withAsset = ctxOf({ authorizedAssets: [{ id: 'asset-1' } as never] });
    const { assetId } = await persistGovernedArtifact(inputOf({ ctx: withAsset }) as never);
    expect(db.rows('content_versions')[0].authorized_asset_ids).toEqual(['asset-1']);

    // The asset is later revoked: regeneration re-resolves and records nothing.
    await appendGovernedVersion({ assetId, workspaceId: WS_A, changeType: 'ai_regen',
      changeSummary: 'after revocation', input: inputOf({ ctx: ctxOf() }) as never });
    const v2 = db.rows('content_versions').find(v => v.version_number === 2)!;
    expect(v2.authorized_asset_ids).toEqual([]);
    // …and v1 still records what was true then.
    expect(db.rows('content_versions').find(v => v.version_number === 1)!.authorized_asset_ids)
      .toEqual(['asset-1']);
  });

  it('O/P — another workspace cannot append to this artifact', async () => {
    const { persistGovernedArtifact, appendGovernedVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    await expect(appendGovernedVersion({ assetId, workspaceId: WS_B,
      changeType: 'ai_regen', changeSummary: 'x', input: inputOf() as never }))
      .rejects.toThrow(/Not found/);
    expect(db.rows('content_versions')).toHaveLength(1);
  });
});

describe('approval, read model and boundaries', () => {
  it('T/U — approval binds ONE version and grants no execution', async () => {
    const { persistGovernedArtifact, approveContentVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    await approveContentVersion({ assetId, workspaceId: WS_A, versionNumber: 1,
      actorId: FOUNDER, note: 'looks right' });

    const approval = db.rows('asset_approvals')[0];
    expect(approval.version_number).toBe(1);
    expect(approval.founder_id).toBe(FOUNDER);
    const asset = db.rows('content_assets')[0];
    expect(asset.content_status).toBe('CONTENT_APPROVED');
    expect(asset.content_approved_version).toBe(1);
    // Nothing about execution was written.
    for (const f of ['launched_at', 'published_at', 'spend_cap', 'scheduled_at',
                     'external_campaign_id']) {
      expect(asset[f] ?? null, `approval wrote ${f}`).toBeNull();
    }
  });

  it('an artifact that is not eligible cannot be approved', async () => {
    const { persistGovernedArtifact, approveContentVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'REWRITE_REQUIRED' }) }) as never);
    await expect(approveContentVersion({ assetId, workspaceId: WS_A, versionNumber: 1,
      actorId: FOUNDER })).rejects.toThrow(/not eligible/i);
    expect(db.rows('asset_approvals')).toHaveLength(0);
  });

  it('Q/R — the owner read model exposes no handles, enums or prompts', async () => {
    const { persistGovernedArtifact, ownerContentView } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf({
      result: resultOf({ claims: [
        { field: 'headline', text: 'SOC 2 compliant', category: 'COMPLIANCE_CERTIFICATION',
          verdict: 'NEEDS_OWNER_CONFIRMATION', support: [] },
        { field: 'primary_text', text: 'Reporting eats the week.', category: 'OTHER_FACTUAL_CLAIM',
          verdict: 'SUPPORTED', support: ['Your product profile'] },
      ] }) }) as never);

    const view = (await ownerContentView(assetId, WS_A))!;
    expect(view.versionNumber).toBe(1);
    expect(view.campaignName).toBe('Know who is coming');
    expect(view.brandVersion).toBe(3);
    expect(view.proof).toEqual(['Your product profile']);
    expect(view.confirmationGaps).toEqual(['SOC 2 compliant']);
    expect(view.whyCreated.join(' ')).toContain('Trust gap');

    const serialised = JSON.stringify(view);
    for (const leak of ['product"', 'OWNER_CONFIRMED', 'FOUNDER_ASSERTED',
                        'evidence_refs', 'promptId', 'systemPrompt']) {
      expect(serialised, `read model leaked ${leak}`).not.toContain(leak);
    }
  });

  it('another workspace gets nothing from the read model', async () => {
    const { persistGovernedArtifact, ownerContentView } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    expect(await ownerContentView(assetId, WS_B)).toBeNull();
  });

  it('S/V — no execution state exists and Marketing Memory is untouched', async () => {
    const { persistGovernedArtifact, approveContentVersion, CONTENT_STATUSES } = await P();
    for (const forbidden of ['EXECUTED', 'LAUNCHED', 'PUBLISHED', 'SPEND_APPROVED']) {
      expect(CONTENT_STATUSES as readonly string[]).not.toContain(forbidden);
    }
    const { assetId } = await persistGovernedArtifact(inputOf() as never);
    await approveContentVersion({ assetId, workspaceId: WS_A, versionNumber: 1, actorId: FOUNDER });
    expect(db.rows('marketing_memories')).toHaveLength(0);
    expect(db.rows('publishing_targets')).toHaveLength(0);
    expect(db.rows('campaigns')).toHaveLength(0);
  });

  it('the persistence module cannot reach execution or memory surfaces', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../src/services/content/contentArtifactPersistence.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const f of ['publishing_targets', 'spend_cap', 'launched_at', 'scheduled_at',
                     'marketing_memories', 'external_campaign_id']) {
      expect(src, `persistence touches ${f}`).not.toContain(f);
    }
  });
});

describe('approval fails closed against CURRENT capability rules', () => {
  const PRODUCT_TRUTH = 'Connect with trusted, vetted home service professionals ' +
    'in your neighborhood — quickly, safely, and conveniently.';

  it('an ELIGIBLE artifact whose stored text now violates §6 is refused, not approved', async () => {
    db.setRows('products', [{ id: PROD_A, workspace_id: WS_A,
      scraped_meta: { websiteMeta: { description: PRODUCT_TRUTH } } }]);
    const { persistGovernedArtifact, approveContentVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'ELIGIBLE', payload: {
        h1: 'Connect with vetted plumbing professionals nearby.',
        benefits: ["Plumbing professionals on AllignX are vetted before they " +
          "appear on the platform — meaning your connection starts with " +
          "professionals who have gone through the platform's vetting process."],
      } }) }) as never);

    expect(db.rows('content_assets')[0].content_status).toBe('ELIGIBLE_FOR_CONTENT_APPROVAL');
    await expect(approveContentVersion({ assetId, workspaceId: WS_A, versionNumber: 1,
      actorId: FOUNDER })).rejects.toThrow(/not eligible/i);
    // Fails CLOSED: the stale ELIGIBLE status is corrected in place, not left
    // standing for the owner to see again, and no approval row is written.
    expect(db.rows('content_assets')[0].content_status).toBe('REWRITE_REQUIRED');
    expect(db.rows('asset_approvals')).toHaveLength(0);
  });

  it('the supported qualifier "vetted professionals" is unaffected — approval still succeeds', async () => {
    db.setRows('products', [{ id: PROD_A, workspace_id: WS_A,
      scraped_meta: { websiteMeta: { description: PRODUCT_TRUTH } } }]);
    const { persistGovernedArtifact, approveContentVersion } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'ELIGIBLE', payload: {
        h1: 'Connect with trusted, vetted plumbing professionals nearby.',
        benefits: ['The platform is neighborhood-based, so the professionals ' +
          'you connect with are local to your area.'],
      } }) }) as never);

    await approveContentVersion({ assetId, workspaceId: WS_A, versionNumber: 1, actorId: FOUNDER });
    expect(db.rows('content_assets')[0].content_status).toBe('CONTENT_APPROVED');
  });

  it('a status other than ELIGIBLE is left untouched by revalidation', async () => {
    const { revalidateEligibleArtifact, persistGovernedArtifact } = await P();
    const { assetId } = await persistGovernedArtifact(inputOf({
      result: resultOf({ disposition: 'REWRITE_REQUIRED' }) }) as never);
    const result = await revalidateEligibleArtifact({ assetId, workspaceId: WS_A });
    expect(result).toEqual({ status: 'REWRITE_REQUIRED', violations: [] });
  });
});

describe('UX2.9 visual lineage uses the persisted governance verdict', () => {
  it.each(['ELIGIBLE', 'REWRITE_REQUIRED', 'OWNER_CONFIRMATION_REQUIRED', 'DEGRADED', 'PROHIBITED'] as const)(
    'only ELIGIBLE supplies image copy (%s)', async disposition => {
      const p = await P();
      const saved = await p.persistGovernedArtifact(inputOf({ result: resultOf({ disposition }) }));
      const lineage = await p.rebuildGovernedLineage({ workspaceId: WS_A, productId: PROD_A,
        founderId: FOUNDER, contentAssetId: saved.assetId, ctx: ctxOf() });
      expect(lineage).not.toBeNull();
      expect(lineage!.textEligibleForImage).toBe(disposition === 'ELIGIBLE');
      expect(lineage!.headline).toBe(disposition === 'ELIGIBLE' ? 'Get it back' : null);
    });
});
