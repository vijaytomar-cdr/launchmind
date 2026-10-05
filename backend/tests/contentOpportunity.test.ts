/**
 * @file contentOpportunity.test.ts
 * @description Phase 3.5B2 acceptance matrix A–AJ.
 *
 *   The question this suite answers is not "does it generate?" but "does
 *   LaunchMind make a MARKETING DECISION, and can that decision lie?". Most
 *   cases are therefore about what the system refuses: invented evidence, a
 *   market trigger with no market, a promise of virality, a campaign that could
 *   spend money.
 *
 *   Runs against MemoryDb (which honours predicates) and pure policy, so no
 *   database is required — migration 117 is written but unapplied.
 *
 * @security No network, no execution, no publishing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { ProductContentContext } from '../src/services/content/productContentContext';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const PROD_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PROD_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const FOUNDER = 'ffffffff-1111-4111-8111-111111111111';
const REC_ID = 'rrrrrrrr-1111-4111-8111-111111111111';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db,
}));

const handle = (ref: string, kind: string, label: string, text = label) =>
  ({ ref, kind, label, text }) as never;

function ctxOf(over: Partial<ProductContentContext> = {}): ProductContentContext {
  return {
    workspaceId: WS_A, productId: PROD_A,
    application: { name: 'ClientPulse', category: 'SaaS analytics', markets: ['usa'], description: null },
    brand: { productId: PROD_A, workspaceId: WS_A, version: 2, fields: {}, missing: [] },
    prohibitedTerms: [],
    founderDirection: { audienceConfirmed: 'agency owners', contextDelta: null,
      primaryGoal: 'customer acquisition', competitors: ['Rival'] },
    evidence: [handle('perf', 'CAMPAIGN_PERFORMANCE', 'Your campaign performance')],
    authorizedAssets: [], observedAssetCount: 3,
    marketIntelligenceAvailable: false,
    brandProvenance: [], unavailable: [],
    ...over,
  } as ProductContentContext;
}

const candidate = (over: Record<string, unknown> = {}) => ({
  contentOpportunityType: 'PRODUCT_BENEFIT',
  title: 'Show agencies what they are losing',
  objective: 'customer acquisition',
  audienceHypothesis: 'agency owners drowning in client reporting',
  messageAngle: 'reporting time is client time',
  whyNow: 'agencies plan budgets this quarter',
  whyNowKind: 'EVERGREEN',
  recommendedChannels: ['GOOGLE_RSA'],
  evidenceRefs: ['perf'],
  viralHypothesis: null,
  ...over,
});

const model = (arr: unknown[]) => async () => JSON.stringify(arr);

beforeEach(() => {
  db = new MemoryDb({
    products: [
      { id: PROD_A, workspace_id: WS_A, founder_id: FOUNDER },
      { id: PROD_B, workspace_id: WS_B, founder_id: FOUNDER },
    ],
    saved_opportunities: [], content_campaigns: [],
    marketing_memories: [], publishing_targets: [], campaigns: [],
  });
  (globalThis as { __db: MemoryDb }).__db = db;
});

const gen = async () => import('../src/services/opportunity/contentOpportunityService');
const pol = async () => import('../src/services/opportunity/contentOpportunityPolicy');
const camp = async () => import('../src/services/opportunity/contentCampaignService');

// ── A/D/E/F — product-specific, both modes, one pipeline ───────────────────
describe('opportunity generation', () => {
  it('A/D — AI-CMO mode produces product-specific, prioritised opportunities', async () => {
    const { generateContentOpportunities } = await gen();
    const out = await generateContentOpportunities({
      ctx: ctxOf(), origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER,
      generate: model([candidate(), candidate({ title: 'Second idea' })]),
    });
    expect(out.prioritised.length).toBeGreaterThan(0);
    expect(out.prioritised[0].aiCmoRecommended).toBe(true);
    expect(out.degraded).toBe(false);
  });

  it('E/AF — owner direction enters the SAME pipeline and is never evidence', async () => {
    const { generateContentOpportunities, buildOpportunityPrompt } = await gen();
    const ctx = ctxOf();
    const out = await generateContentOpportunities({
      ctx, origin: 'OWNER_DIRECTED', founderId: FOUNDER,
      ownerRequest: 'Create a campaign about our new instant booking feature',
      generate: model([candidate({ evidenceRefs: ['instant-booking-proof'] })]),
    });
    // The owner's sentence did not create an evidence handle.
    expect(out.validation.discardedRefs).toContain('instant-booking-proof');
    expect(out.prioritised[0].candidate.evidenceRefs).toEqual([]);
    // …and the base prompt never presents owner text as evidence.
    expect(buildOpportunityPrompt(ctx)).not.toContain('instant booking');
  });

  it('M13 — the owner request is fenced and labelled as direction, not fact', async () => {
    // The policy discards invented refs regardless, but the fence is the first
    // line and must not quietly become "treat this as established fact".
    const { generateContentOpportunities } = await gen();
    let seen = '';
    await generateContentOpportunities({
      ctx: ctxOf(), origin: 'OWNER_DIRECTED', founderId: FOUNDER,
      ownerRequest: 'we are the market leader',
      generate: async (prompt: string) => { seen = prompt; return '[]'; },
    });
    expect(seen).toContain('OWNER_REQUEST');
    expect(seen).toMatch(/DIRECTION, not evidence/);
    expect(seen).toMatch(/does not make anything true/i);
    expect(seen, 'the owner request was presented as fact').not.toMatch(/established fact/i);
  });

  it('AG — malformed model output degrades to nothing, never to a fabrication', async () => {
    const { generateContentOpportunities } = await gen();
    const out = await generateContentOpportunities({
      ctx: ctxOf(), origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER,
      generate: async () => 'I cannot do that',
    });
    expect(out.prioritised).toHaveLength(0);
    const failed = await generateContentOpportunities({
      ctx: ctxOf(), origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER,
      generate: async () => { throw new Error('provider down'); },
    });
    expect(failed.degraded).toBe(true);
    expect(failed.prioritised).toHaveLength(0);
  });
});

// ── G/H/I/J — why-now grounding ────────────────────────────────────────────
describe('why now must be real', () => {
  it('G — an intelligence trigger is accepted when eligible intelligence exists', async () => {
    const { validateOpportunityCandidates } = await pol();
    const out = validateOpportunityCandidates(
      [candidate({ whyNowKind: 'INTELLIGENCE_TRIGGERED', evidenceRefs: ['mi1'] })],
      { issuedRefs: ['mi1'], allowedChannels: ['GOOGLE_RSA'], intelligenceAvailable: true });
    expect(out.accepted).toHaveLength(1);
  });

  it('I/J — a trigger with no eligible intelligence is REJECTED, not downgraded', async () => {
    const { validateOpportunityCandidates } = await pol();
    // Downgrading to EVERGREEN would keep a claim about the world and relabel it.
    const out = validateOpportunityCandidates(
      [candidate({ whyNowKind: 'INTELLIGENCE_TRIGGERED', evidenceRefs: ['mi1'] })],
      { issuedRefs: [], allowedChannels: ['GOOGLE_RSA'], intelligenceAvailable: false });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0].reason).toBe('TRIGGER_WITHOUT_INTELLIGENCE');
  });

  it('H/AE — with no intelligence at all, evergreen opportunities still work', async () => {
    const { generateContentOpportunities } = await gen();
    const out = await generateContentOpportunities({
      ctx: ctxOf({ marketIntelligenceAvailable: false, evidence: [] }),
      origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER,
      generate: model([candidate({ evidenceRefs: [] })]),
    });
    expect(out.prioritised).toHaveLength(1);
    expect(out.prioritised[0].candidate.whyNowKind).toBe('EVERGREEN');
  });
});

// ── K/L — viral growth without promises ────────────────────────────────────
describe('viral growth is a hypothesis, never a promise', () => {
  const viral = (over: Record<string, unknown> = {}) => candidate({
    contentOpportunityType: 'VIRAL_GROWTH',
    viralHypothesis: { whyStop: 'a surprising number', whyCare: 'they feel this weekly',
      whyShare: 'it names a shared frustration', whyProductBelongs: 'the product produces the number' },
    ...over,
  });

  it('K — a complete hypothesis is accepted', async () => {
    const { validateOpportunityCandidates } = await pol();
    expect(validateOpportunityCandidates([viral()],
      { issuedRefs: ['perf'], allowedChannels: ['SHORT_FORM_VIDEO_SCRIPT'], intelligenceAvailable: false })
      .accepted).toHaveLength(1);
  });

  it('an incomplete hypothesis is rejected — no mechanism, no opportunity', async () => {
    const { validateOpportunityCandidates } = await pol();
    const out = validateOpportunityCandidates(
      [viral({ viralHypothesis: { whyStop: 'x', whyCare: '', whyShare: '', whyProductBelongs: '' } })],
      { issuedRefs: ['perf'], allowedChannels: ['SHORT_FORM_VIDEO_SCRIPT'], intelligenceAvailable: false });
    expect(out.rejected[0].reason).toBe('VIRAL_HYPOTHESIS_INCOMPLETE');
  });

  it('L — any promise of virality is rejected outright', async () => {
    const { validateOpportunityCandidates, promisesVirality } = await pol();
    for (const claim of [
      'This will go viral', 'Guaranteed to go viral on TikTok',
      'Make it go viral in a week', 'guaranteed organic reach',
    ]) expect(promisesVirality(claim), claim).toBe(true);
    // …and the topic itself is still allowed.
    expect(promisesVirality('increase the chance people share this')).toBe(false);

    const out = validateOpportunityCandidates(
      [viral({ messageAngle: 'This will go viral with agencies' })],
      { issuedRefs: ['perf'], allowedChannels: ['SHORT_FORM_VIDEO_SCRIPT'], intelligenceAvailable: false });
    expect(out.rejected[0].reason).toBe('VIRALITY_PROMISED');
  });
});

// ── AC/AD — shaped diff ────────────────────────────────────────────────────
describe('intelligence must change the decision, and only where it should', () => {
  it('AC — relevant intelligence enables a trigger the same product cannot otherwise make', async () => {
    const { generateContentOpportunities } = await gen();
    const triggered = candidate({ whyNowKind: 'INTELLIGENCE_TRIGGERED', evidenceRefs: ['mi1'] });
    const withMI = await generateContentOpportunities({
      ctx: ctxOf({ marketIntelligenceAvailable: true,
        evidence: [handle('mi1', 'MARKET_INTELLIGENCE', 'A competitor listing observation')] }),
      origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER, generate: model([triggered]),
    });
    const withoutMI = await generateContentOpportunities({
      ctx: ctxOf({ marketIntelligenceAvailable: false, evidence: [] }),
      origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER, generate: model([triggered]),
    });
    expect(withMI.prioritised).toHaveLength(1);
    expect(withoutMI.prioritised, 'the same trigger survived without intelligence').toHaveLength(0);
  });

  it('AD — an irrelevant evidence difference does not reshape an evergreen decision', async () => {
    const { generateContentOpportunities } = await gen();
    const base = candidate({ evidenceRefs: [] });
    const a = await generateContentOpportunities({
      ctx: ctxOf(), origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER, generate: model([base]),
    });
    const b = await generateContentOpportunities({
      ctx: ctxOf({ evidence: [
        handle('perf', 'CAMPAIGN_PERFORMANCE', 'Your campaign performance'),
        handle('product', 'PRODUCT_CONTEXT', 'Your product profile'),
      ] }),
      origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER, generate: model([base]),
    });
    expect(b.prioritised[0].candidate.recommendedChannels)
      .toEqual(a.prioritised[0].candidate.recommendedChannels);
    expect(b.prioritised[0].candidate.whyNowKind).toBe(a.prioritised[0].candidate.whyNowKind);
  });
});

// ── S–X — channels and package ─────────────────────────────────────────────
describe('channel and package recommendation', () => {
  const rec = async () => import('../src/services/opportunity/channelRecommendation');

  it('S/T/U — product benefit with evidence reaches Google, Meta and a landing page', async () => {
    const { recommendChannels } = await rec();
    const out = recommendChannels({ contentOpportunityType: 'PRODUCT_BENEFIT',
      objective: 'acquisition', audienceHypothesis: 'homeowners',
      authorizedAssetCount: 2, hasEvidence: true }).map(c => c.channel);
    expect(out).toContain('GOOGLE_RSA');
    expect(out).toContain('META_AD');
    expect(out).toContain('LANDING_PAGE');
  });

  it('M10 — a message with no evidence does NOT get a landing page', async () => {
    // A landing page exists to show proof. Recommending one for an unprovable
    // message is the shape of intelligence contaminating an unrelated decision.
    const { recommendChannels } = await rec();
    const withEvidence = recommendChannels({ contentOpportunityType: 'PRODUCT_FEATURE',
      objective: 'acquisition', audienceHypothesis: 'homeowners',
      authorizedAssetCount: 0, hasEvidence: true }).map(c => c.channel);
    const without = recommendChannels({ contentOpportunityType: 'PRODUCT_FEATURE',
      objective: 'acquisition', audienceHypothesis: 'homeowners',
      authorizedAssetCount: 0, hasEvidence: false }).map(c => c.channel);
    expect(withEvidence).toContain('LANDING_PAGE');
    expect(without, 'an unprovable message was given a proof surface').not.toContain('LANDING_PAGE');
  });

  it('V — a B2B audience reaches LinkedIn', async () => {
    const { recommendChannels } = await rec();
    expect(recommendChannels({ contentOpportunityType: 'PRODUCT_BENEFIT',
      objective: 'acquisition', audienceHypothesis: 'agency owners and SaaS founders',
      authorizedAssetCount: 0, hasEvidence: false }).map(c => c.channel)).toContain('LINKEDIN_POST');
  });

  it('W — viral growth reaches short-form video script', async () => {
    const { recommendChannels } = await rec();
    expect(recommendChannels({ contentOpportunityType: 'VIRAL_GROWTH', objective: 'reach',
      audienceHypothesis: 'homeowners', authorizedAssetCount: 0, hasEvidence: false })
      .map(c => c.channel)).toContain('SHORT_FORM_VIDEO_SCRIPT');
  });

  it('X — the package flags formats blocked on unauthorised imagery', async () => {
    const { recommendChannels, recommendContentPackage } = await rec();
    const pkg = recommendContentPackage(recommendChannels({
      contentOpportunityType: 'PRODUCT_BENEFIT', objective: 'acquisition',
      audienceHypothesis: 'homeowners', authorizedAssetCount: 0, hasEvidence: true }));
    const meta = pkg.items.find(i => i.channel === 'META_AD')!;
    expect(meta.blockedOnAssets).toBe(true);
    expect(pkg.notes.join(' ')).toMatch(/not authorised/i);
    expect(pkg.totalArtifacts).toBeGreaterThan(0);
  });

  it('provider credentials are never an input to channel choice', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../src/services/opportunity/channelRecommendation.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const f of ['credential', 'workspace_connections', 'platform_tokens', 'oauth', 'connectionService']) {
      expect(src, `channel choice consults ${f}`).not.toContain(f);
    }
  });

  it('AB — prioritisation returns a bounded, explained set with ONE recommendation', async () => {
    const { prioritiseOpportunities } = await pol();
    const many = Array.from({ length: 8 }, (_, i) => candidate({ title: `Idea ${i}` })) as never[];
    const top = prioritiseOpportunities(many, { objective: 'customer acquisition' });
    expect(top).toHaveLength(3);
    expect(top.filter(t => t.aiCmoRecommended)).toHaveLength(1);
    for (const t of top) expect(t.reasons.length).toBeGreaterThan(0);
    // Dimensions are reported separately — there is no single verdict number.
    expect(Object.keys(top[0].dimensions).sort())
      .toEqual(['channelFit', 'evidenceReadiness', 'strategicRelevance', 'timeliness']);
    expect(top[0]).not.toHaveProperty('score');
  });
});

// ── M/N/O/P/Q/R — campaign ─────────────────────────────────────────────────
describe('content campaign', () => {
  const seedOpp = () => db.setRows('saved_opportunities', [{
    id: 'opp-1', workspace_id: WS_A, product_id: PROD_A, founder_id: FOUNDER,
    title: 'x', type: 'general', state: 'active',
  }]);

  it('M/O — a campaign is created with immutable lineage to its opportunity', async () => {
    seedOpp();
    const { createContentCampaign } = await camp();
    const out = await createContentCampaign({
      ctx: ctxOf(), founderId: FOUNDER, opportunityId: 'opp-1', candidate: candidate() as never });
    expect(out.id).toBeTruthy();
    const row = db.rows('content_campaigns')[0];
    expect(row.opportunity_id).toBe('opp-1');
    expect(row.workspace_id).toBe(WS_A);
    expect(row.brand_kit_version).toBe(2);
  });

  it('N — a content campaign has NO column able to hold execution authority', async () => {
    seedOpp();
    const { createContentCampaign } = await camp();
    await createContentCampaign({ ctx: ctxOf(), founderId: FOUNDER,
      opportunityId: 'opp-1', candidate: candidate() as never });
    const row = db.rows('content_campaigns')[0];
    for (const forbidden of ['spend_cap', 'budget', 'scheduled_at', 'launched_at',
                             'execution_approved_at', 'approved_at', 'external_campaign_id']) {
      expect(row, `content campaign carries ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it('the migration itself cannot express execution authority', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(__dirname, '../migrations/20260818_000117_content_opportunity_campaign.sql'), 'utf8');
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS content_campaigns'),
                            sql.indexOf('-- DELIBERATELY ABSENT'));
    for (const forbidden of ['spend_cap', 'budget', 'scheduled_at', 'launched_at',
                             'execution_approved_at', 'external_campaign_id']) {
      expect(table, `content_campaigns declares ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('P/Q/R — the message architecture names what it can and cannot prove', async () => {
    const { deriveCampaignArchitecture } = await camp();
    const a = deriveCampaignArchitecture(candidate() as never, ctxOf());
    expect(a.proofAvailable).toContain('Your campaign performance');
    expect(a.proofUnavailable.join(' ')).toContain('no authorised product imagery');
    expect(a.proofUnavailable.join(' ')).toContain('ctaDestination requires your confirmation');
    expect(a.thesis).toBeTruthy();
    expect(a.audience).toBe('agency owners drowning in client reporting');
  });

  it('a narrative with no cited evidence says so rather than implying proof', async () => {
    const { deriveCampaignArchitecture } = await camp();
    const a = deriveCampaignArchitecture(candidate({ evidenceRefs: [] }) as never, ctxOf());
    expect(a.proofAvailable).toHaveLength(0);
    expect(a.proofUnavailable.join(' ')).toContain('no evidence supports this message yet');
  });

  it('AH/AI — a cross-workspace or cross-product opportunity is refused', async () => {
    seedOpp();
    const { createContentCampaign } = await camp();
    await expect(createContentCampaign({ ctx: ctxOf({ workspaceId: WS_B }), founderId: FOUNDER,
      opportunityId: 'opp-1', candidate: candidate() as never })).rejects.toThrow(/Not found/);
    await expect(createContentCampaign({ ctx: ctxOf({ productId: PROD_B }), founderId: FOUNDER,
      opportunityId: 'opp-1', candidate: candidate() as never })).rejects.toThrow(/different product/);
  });
});

// ── Y/Z — brand influences HOW, never WHAT IS TRUE ─────────────────────────
describe('brand influence on the campaign', () => {
  const confirmed = (key: string, value: unknown) => ({
    fieldKey: key, value, provenance: 'OWNER_CONFIRMED', sourceLabel: null,
    ownerConfirmed: true, supersededCount: 0,
  });
  const observed = (key: string, value: unknown) => ({
    fieldKey: key, value, provenance: 'SCRAPED', sourceLabel: 'your website',
    ownerConfirmed: false, supersededCount: 0,
  });

  it('Y — a confirmed tone becomes a directive the brief inherits', async () => {
    const { deriveCampaignArchitecture } = await camp();
    const a = deriveCampaignArchitecture(candidate() as never, ctxOf({
      brand: { productId: PROD_A, workspaceId: WS_A, version: 4, missing: [],
        fields: { tone: confirmed('tone', 'direct, plain language') } } as never }));
    expect(a.brandDirectives.join(' ')).toContain('Tone: direct, plain language');
  });

  it('Y2 — a scraped tagline never becomes the official campaign tagline', async () => {
    const { deriveCampaignArchitecture } = await camp();
    const a = deriveCampaignArchitecture(candidate() as never, ctxOf({
      brand: { productId: PROD_A, workspaceId: WS_A, version: 1, missing: [],
        fields: { tagline: observed('tagline', 'The best CRM') } } as never }));
    const joined = a.brandDirectives.join(' ');
    expect(joined).toContain('not approved, do not quote as official');
    expect(joined).not.toContain('Approved tagline');
  });

  it('Z — prohibited terminology travels with the campaign', async () => {
    const { deriveCampaignArchitecture } = await camp();
    const a = deriveCampaignArchitecture(candidate() as never,
      ctxOf({ prohibitedTerms: ['revolutionary'] }));
    expect(a.prohibitedTerms).toContain('revolutionary');
    expect(a.brandDirectives.join(' ')).toContain('Never use the word or phrase: revolutionary');
  });

  it('brand cannot decide what the evidence proves', async () => {
    const { deriveCampaignArchitecture } = await camp();
    // A fully confirmed brand with NO cited evidence still proves nothing.
    const a = deriveCampaignArchitecture(candidate({ evidenceRefs: [] }) as never, ctxOf({
      brand: { productId: PROD_A, workspaceId: WS_A, version: 9, missing: [],
        fields: { tone: confirmed('tone', 'confident'),
                  brand_voice: confirmed('brand_voice', 'authoritative') } } as never }));
    expect(a.proofAvailable).toHaveLength(0);
    expect(a.proofUnavailable.join(' ')).toContain('no evidence supports this message yet');
  });
});

// ── B/C/AA/AJ — isolation, provenance, side effects ────────────────────────
describe('isolation, provenance and side effects', () => {
  it('B/C — persistence takes scope from the CONTEXT, never from the candidate', async () => {
    const { persistContentOpportunity } = await gen();
    await persistContentOpportunity({
      ctx: ctxOf(), founderId: FOUNDER, origin: 'OWNER_DIRECTED',
      candidate: { ...candidate(), workspaceId: WS_B, productId: PROD_B } as never,
    });
    const row = db.rows('saved_opportunities')[0];
    expect(row.workspace_id).toBe(WS_A);
    expect(row.product_id).toBe(PROD_A);
  });

  it('an AI-recommended opportunity cannot exist without a recommendation', async () => {
    const { persistContentOpportunity } = await gen();
    await expect(persistContentOpportunity({ ctx: ctxOf(), founderId: FOUNDER,
      origin: 'AI_CMO_RECOMMENDED', candidate: candidate() as never }))
      .rejects.toThrow(/requires a recommendation/);
    await expect(persistContentOpportunity({ ctx: ctxOf(), founderId: FOUNDER,
      origin: 'AI_CMO_RECOMMENDED', candidate: candidate() as never, recommendationId: REC_ID }))
      .resolves.toBeTruthy();
  });

  it('AA — owner-safe provenance exposes no handles, ids or enums', async () => {
    const { generateContentOpportunities } = await gen();
    const out = await generateContentOpportunities({
      ctx: ctxOf({ marketIntelligenceAvailable: true,
        evidence: [handle('mi1', 'MARKET_INTELLIGENCE', 'A competitor listing observation')] }),
      origin: 'AI_CMO_RECOMMENDED', founderId: FOUNDER,
      generate: model([candidate({ evidenceRefs: ['mi1'] })]),
    });
    const text = out.provenance.join(' | ');
    expect(text).toMatch(/objective you confirmed|market opportunity/i);
    for (const leak of ['mi1', 'perf', 'MARKET_INTELLIGENCE', 'CAMPAIGN_PERFORMANCE',
                        'AI_CMO_RECOMMENDED', 'INTELLIGENCE_TRIGGERED', WS_A, PROD_A]) {
      expect(text, `provenance leaked ${leak}`).not.toContain(leak);
    }
  });

  it('AJ — nothing published, launched, spent or learned', async () => {
    seedAll();
    const { generateContentOpportunities, persistContentOpportunity } = await gen();
    const { createContentCampaign } = await camp();
    const out = await generateContentOpportunities({
      ctx: ctxOf(), origin: 'OWNER_DIRECTED', founderId: FOUNDER,
      ownerRequest: 'anything', generate: model([candidate()]) });
    const oppId = await persistContentOpportunity({ ctx: ctxOf(), founderId: FOUNDER,
      origin: 'OWNER_DIRECTED', candidate: out.prioritised[0].candidate });
    await createContentCampaign({ ctx: ctxOf(), founderId: FOUNDER,
      opportunityId: oppId!, candidate: out.prioritised[0].candidate });
    expect(db.rows('marketing_memories')).toHaveLength(0);
    expect(db.rows('publishing_targets')).toHaveLength(0);
    expect(db.rows('campaigns')).toHaveLength(0);
  });

  function seedAll() {
    db.setRows('marketing_memories', []);
    db.setRows('publishing_targets', []);
    db.setRows('campaigns', []);
  }

  it('opportunity and campaign services cannot reach execution surfaces', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    for (const f of ['contentOpportunityService.ts', 'contentCampaignService.ts',
                     'contentOpportunityPolicy.ts', 'channelRecommendation.ts']) {
      const src = readFileSync(join(__dirname, '../src/services/opportunity', f), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      for (const forbidden of ['publishing_targets', 'spend_cap', 'launched_at',
                               'marketing_memories', 'approved_at', 'execute']) {
        expect(src, `${f} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
