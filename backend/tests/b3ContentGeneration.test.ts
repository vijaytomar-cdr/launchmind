/**
 * @file b3ContentGeneration.test.ts
 * @description Phase 3.5B3 acceptance matrix A–AJ.
 *
 *   The question is whether LaunchMind produces APPLICATION-SPECIFIC governed
 *   content from real intelligence — not whether it produces text. Most cases
 *   are therefore about what shapes the output and what it refuses to say.
 *
 * @security No network, no database writes beyond MemoryDb, no execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { ProductContentContext } from '../src/services/content/productContentContext';
import type { CampaignMessageArchitecture } from '../src/services/opportunity/contentCampaignService';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const PROD_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PROD_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const FOUNDER = 'ffffffff-1111-4111-8111-111111111111';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db,
}));

const h = (ref: string, kind: string, label: string, text = label) =>
  ({ ref, kind, label, text }) as never;
const confirmed = (k: string, v: unknown) =>
  ({ fieldKey: k, value: v, provenance: 'OWNER_CONFIRMED', sourceLabel: null,
     ownerConfirmed: true, supersededCount: 0 });

const silent = async () => ({ byField: new Map(), artifactClaims: [],
  unresolvedFields: [], unverifiable: false, failureReason: null });

function ctxOf(over: Partial<ProductContentContext> = {}): ProductContentContext {
  return {
    workspaceId: WS_A, productId: PROD_A,
    application: { name: 'ClientPulse', category: 'agency analytics', markets: ['usa'], description: null },
    brand: { productId: PROD_A, workspaceId: WS_A, version: 3, missing: [],
      fields: { tone: confirmed('tone', 'direct, plain language') } } as never,
    prohibitedTerms: [],
    founderDirection: { audienceConfirmed: 'agency owners', contextDelta: null,
      primaryGoal: 'customer acquisition', competitors: ['Rival'] },
    evidence: [h('product', 'PRODUCT_CONTEXT', 'Your product profile',
      'ClientPulse · instant booking and Shopify integration · agency analytics')],
    authorizedAssets: [], observedAssetCount: 4,
    marketIntelligenceAvailable: false, brandProvenance: [], unavailable: [],
    ...over,
  } as ProductContentContext;
}

const arch = (over: Partial<CampaignMessageArchitecture> = {}): CampaignMessageArchitecture => ({
  name: 'Know who is coming', thesis: 'reporting time is client time',
  audience: 'agency owners', coreProblem: 'reporting eats the week',
  messageAngle: 'reporting time is client time', productRole: 'ClientPulse does the reporting',
  primaryBenefit: 'get the week back', objections: [], ctaIntent: 'start a trial',
  proofAvailable: ['Your product profile'], proofUnavailable: ['ctaDestination requires your confirmation'],
  recommendedChannels: ['GOOGLE_RSA'], contentPackage: [], packageNotes: [],
  brandDirectives: ['Tone: direct, plain language'], prohibitedTerms: [],
  ...over,
});

const S = async () => import('../src/services/content/strategyComposition');
const B = async () => import('../src/services/content/briefComposition');
const G = async () => import('../src/services/content/b3ContentGeneration');
const C = async () => import('../src/services/content/creativeBriefs');

async function strategyOf(over: Record<string, unknown> = {}, ctx = ctxOf()) {
  const { deriveContentStrategy } = await S();
  return deriveContentStrategy({ ctx, architecture: arch(), ...over } as never);
}

beforeEach(() => {
  db = new MemoryDb({
    products: [{ id: PROD_A, workspace_id: WS_A }, { id: PROD_B, workspace_id: WS_B }],
    content_campaigns: [], content_strategies: [], content_briefs: [],
    marketing_memories: [], publishing_targets: [], campaigns: [], content_assets: [],
  });
  (globalThis as { __db: MemoryDb }).__db = db;
});

// ── A–I strategy ───────────────────────────────────────────────────────────
describe('strategy from real intelligence', () => {
  it('A — a strategy derives from the campaign architecture', async () => {
    const s = await strategyOf();
    expect(s.campaignThesis).toBe('reporting time is client time');
    expect(s.messageHierarchy.length).toBeGreaterThan(0);
    expect(s.brandKitVersion).toBe(3);
  });

  it('B — Product A strategy carries only Product A proof', async () => {
    const a = await strategyOf({}, ctxOf());
    const b = await strategyOf({}, ctxOf({
      workspaceId: WS_B, productId: PROD_B,
      application: { name: 'FitTrack', category: 'fitness', markets: ['india'], description: null },
      evidence: [h('product', 'PRODUCT_CONTEXT', 'Your product profile', 'FitTrack · workout logging')],
    }));
    expect(a.productId).toBe(PROD_A);
    expect(b.productId).toBe(PROD_B);
    expect(a.proofAvailable).toEqual(['Your product profile']);
    expect(b.workspaceId).toBe(WS_B);
  });

  it('C/D — relevant intelligence shapes the thesis; unrelated fields stay stable', async () => {
    const withMI = await strategyOf({
      intelligenceAngles: [{ angle: 'rivals lead on automation, you lead on trust',
        ref: 'mi1', objection: 'is it really faster?' }],
    }, ctxOf({ marketIntelligenceAvailable: true,
      evidence: [h('mi1', 'MARKET_INTELLIGENCE', 'A competitor listing observation'),
                 h('product', 'PRODUCT_CONTEXT', 'Your product profile')] }));
    const withoutMI = await strategyOf();

    expect(withMI.campaignThesis).not.toBe(withoutMI.campaignThesis);
    expect(withMI.intelligenceInformed).toContain('campaignThesis');
    expect(withMI.objections).toContain('is it really faster?');
    // Unrelated identity is unchanged.
    expect(withMI.audience).toBe(withoutMI.audience);
    expect(withMI.brandDirectives).toEqual(withoutMI.brandDirectives);
    expect(withoutMI.intelligenceInformed).toEqual([]);
  });

  it('E — founder direction beats a market signal', async () => {
    const s = await strategyOf({
      intelligenceAngles: [{ angle: 'compete on price against cheaper rivals', ref: 'mi1' }],
    }, ctxOf({ marketIntelligenceAvailable: true,
      founderDirection: { audienceConfirmed: 'agency owners',
        contextDelta: 'Do not compete on price. We win on trust.',
        primaryGoal: 'customer acquisition', competitors: ['Rival'] },
      evidence: [h('mi1', 'MARKET_INTELLIGENCE', 'A competitor listing observation')] }));
    expect(s.campaignThesis).not.toMatch(/price/i);
    expect(s.founderOverrides.length).toBeGreaterThan(0);
    expect(s.intelligenceInformed).not.toContain('campaignThesis');
  });

  it('F/G — memory shapes form, and never becomes proof', async () => {
    const s = await strategyOf({
      memoryPreferences: [{ label: 'outcome-led headlines have performed better', kind: 'HOOK_STYLE' }],
    });
    expect(s.memoryApplied).toContain('outcome-led headlines have performed better');
    expect(s.messageHierarchy[0]).toBe('get the week back');
    // Preference did NOT add a proof entry.
    expect(s.proofAvailable).toEqual(['Your product profile']);
  });

  it('H/I — proof available is recomputed; unavailable is carried, never dropped', async () => {
    const s = await strategyOf();
    expect(s.proofAvailable).toContain('Your product profile');
    expect(s.proofUnavailable.join(' ')).toContain('ctaDestination requires your confirmation');
  });

  it('AJ — evidence retracted since the campaign fails closed at strategy time', async () => {
    const s = await strategyOf({
      architecture: arch({ proofAvailable: ['Your campaign performance', 'Your product profile'] }),
    });
    expect(s.proofAvailable).toEqual(['Your product profile']);
    expect(s.proofUnavailable.join(' ')).toContain('no longer available as proof');
  });
});

// ── J/K briefs ─────────────────────────────────────────────────────────────
describe('channel briefs', () => {
  it('J — one strategy produces one brief per channel', async () => {
    const { deriveBriefSet } = await B();
    const briefs = deriveBriefSet(
      ['GOOGLE_RSA', 'META_AD', 'LANDING_PAGE', 'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT'],
      await strategyOf(), ctxOf());
    expect(briefs).toHaveLength(5);
    expect(new Set(briefs.map(b => b.message)).size).toBe(1);   // one narrative
    expect(briefs.find(b => b.channel === 'GOOGLE_RSA')!.channelConstraints.join(' '))
      .toContain('30 characters');
  });

  it('K — unresolved owner decisions are NAMED, never defaulted', async () => {
    const { deriveContentBrief } = await B();
    const b = deriveContentBrief('META_AD', await strategyOf(), ctxOf());
    expect(b.ctaDestination).toBeNull();
    expect(b.offer).toBeNull();
    for (const f of ['ctaDestination', 'offer', 'pricing', 'certification', 'guarantee', 'endorsement']) {
      expect(b.ownerConfirmationRequired).toContain(f);
    }
  });

  it('X — branding presence follows the surface, not a global preference', async () => {
    const { deriveContentBrief } = await B();
    const ctx = ctxOf({
      brand: { productId: PROD_A, workspaceId: WS_A, version: 1, missing: [],
        fields: { logo: confirmed('logo', 'https://a/logo.png') } } as never,
      authorizedAssets: [{ id: 'a', assetType: 'SCREENSHOT' } as never],
    });
    const s = await strategyOf({}, ctx);
    expect(deriveContentBrief('META_AD', s, ctx).brandingPresence).toBe('PROMINENT');
    expect(deriveContentBrief('GOOGLE_RSA', s, ctx).brandingPresence).toBe('MINIMAL');
    // No confirmed logo anywhere → MINIMAL regardless of channel.
    expect(deriveContentBrief('META_AD', await strategyOf(), ctxOf()).brandingPresence).toBe('MINIMAL');
  });

  it('Y/Z/AA — only AUTHORISED assets reach a brief', async () => {
    const { deriveContentBrief } = await B();
    const b = deriveContentBrief('META_AD', await strategyOf(), ctxOf({ observedAssetCount: 9 }));
    expect(b.authorizedAssetRefs).toEqual([]);
    expect(b.visualDirection).toContain('no authorised product imagery');
  });
});

// ── L–P channel content ────────────────────────────────────────────────────
describe('governed content per channel', () => {
  const run = async (channel: string, content: Record<string, unknown>,
                     ctx = ctxOf(), declared: unknown[] = []) => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const strategy = await strategyOf({}, ctx);
    return generateChannelContent({
      brief: deriveContentBrief(channel as never, strategy, ctx),
      strategy, ctx, founderId: FOUNDER, semantic: silent as never,
      generate: async () => JSON.stringify({ content, declaredClaims: declared }),
    });
  };

  it('L — Google RSA: every headline is claimed independently', async () => {
    const out = await run('GOOGLE_RSA', {
      headlines: ['Reporting, handled', 'Get your week back', 'Built for agencies',
                  'Cut CAC by 40%', 'Client-ready in minutes'],
      descriptions: ['Spend the week on clients, not spreadsheets.', 'Reporting that writes itself.'],
    });
    // The unsupported number is caught on ITS OWN field; the others are not
    // condemned with it and none inherits the others' grounding.
    const bad = out.claims.find(c => c.text.includes('40%'));
    expect(bad?.verdict).toBe('UNSUPPORTED');
    expect(out.disposition).toBe('REWRITE_REQUIRED');
    expect(out.claims.map(c => c.field)).toContain('headline_4');
  });

  it('M — Meta ad produces structured copy and a visual brief', async () => {
    const out = await run('META_AD', {
      primaryText: 'Reporting eats the week. It does not have to.',
      headline: 'Get the week back', description: 'For agencies',
      visualBrief: 'a calm desk, one screen',
    });
    expect(out.payload.visualBrief).toBeTruthy();
    expect(out.quality.structuralValidity).toBe('VALID');
  });

  it('N — a landing page does not invent a testimonial block', async () => {
    const out = await run('LANDING_PAGE', {
      h1: 'Reporting time is client time', subhead: 'ClientPulse writes the report.',
      proofSection: 'Trusted by 10,000 agencies', benefits: ['Less admin'],
      objectionSection: 'Setup takes minutes.', ctas: ['Start free'],
    });
    const proof = out.claims.find(c => c.field === 'proof_section');
    expect(proof?.verdict, 'an invented customer count was accepted').toBe('UNSUPPORTED');
    expect(out.disposition).toBe('REWRITE_REQUIRED');
  });

  it('O — a LinkedIn post is structurally validated', async () => {
    const out = await run('LINKEDIN_POST', {
      hook: 'Most agencies lose Friday to reporting.',
      body: 'Most agencies lose Friday to reporting. #a #b #c #d #e #f',
      authorMode: 'COMPANY',
    });
    expect(out.structuralIssues.some(i => i.rule === 'hashtags')).toBe(true);
  });

  it('P/M16 — video: EVERY spoken line and caption is a claim surface', async () => {
    const out = await run('SHORT_FORM_VIDEO_SCRIPT', {
      hook: 'Friday, 6pm. Still reporting.',
      scenePlan: [
        { scene: 1, purpose: 'problem', visual: 'clock', voiceover: 'Reporting eats your week.', onScreenText: 'Friday again' },
        { scene: 2, purpose: 'proof', visual: 'app', voiceover: 'It writes itself.', onScreenText: 'Rated 4.9 by 900 agencies' },
      ],
      cta: 'Try it', estimatedSeconds: 20,
    });
    const caption = out.claims.find(c => c.field === 'on_screen_text_2');
    expect(caption, 'on-screen text escaped claim detection').toBeTruthy();
    expect(caption!.verdict).toBe('UNSUPPORTED');
  });

  it('AI — a model failure degrades honestly, never to generic copy', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    const out = await generateChannelContent({
      brief: deriveContentBrief('META_AD', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never,
      generate: async () => { throw new Error('provider down'); },
    });
    expect(out.disposition).toBe('DEGRADED');
    expect(out.fields).toHaveLength(0);
    expect(out.quality.factualSafety).toBe('UNVERIFIED');
  });
});

// ── Q/V/W/U — adaptation, rewrite, prohibition, pipeline ───────────────────
describe('narrative, rewrite and pipeline', () => {
  it('Q — five channels share one thesis', async () => {
    const { deriveBriefSet } = await B();
    const s = await strategyOf();
    const briefs = deriveBriefSet(
      ['GOOGLE_RSA', 'META_AD', 'LANDING_PAGE', 'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT'], s, ctxOf());
    for (const b of briefs) expect(b.message).toBe(s.campaignThesis);
    // …while hooks legitimately differ per surface.
    expect(new Set(briefs.map(b => b.hookDirection)).size).toBe(5);
  });

  it('V — an unsupported claim triggers a BOUNDED rewrite that is re-governed', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    let call = 0;
    const out = await generateChannelContent({
      brief: deriveContentBrief('META_AD', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 2,
      generate: async (system: string) => {
        call++;
        if (call === 1) {
          return JSON.stringify({ content: { primaryText: 'Cut acquisition cost by 40%.',
            headline: 'Cut CAC 40%', description: 'For agencies' }, declaredClaims: [] });
        }
        // The rewrite prompt must carry WHY the previous attempt failed.
        expect(system).toContain('PREVIOUS ATTEMPT REJECTED');
        // STATES NO CAPABILITY. This fixture's context has `description: null`,
        // so the product capability contract is empty and NO capability may be
        // stated at all — which is the correct, strict behaviour for a product
        // LaunchMind knows nothing about. The previous replacement copy said
        // "Find where acquisition spend is wasted", attributing a finding
        // capability to a product with no description, and correctly triggered
        // a third rewrite. The test's subject is the BOUNDED loop and the
        // carried reason, not that particular sentence.
        return JSON.stringify({ content: { primaryText: 'Acquisition spend deserves a closer look.',
          headline: 'Spend with intent', description: 'For agencies' }, declaredClaims: [] });
      },
    });
    expect(call).toBe(2);
    expect(out.rewriteAttempts).toBe(1);
    expect(out.disposition).toBe('ELIGIBLE');
  });

  it('the rewrite loop is bounded and ends in a state, not a hang', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    let call = 0;
    const out = await generateChannelContent({
      brief: deriveContentBrief('META_AD', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 2,
      generate: async () => { call++; return JSON.stringify({ content: {
        primaryText: 'Cut acquisition cost by 40%.', headline: 'Cut CAC 40%',
        description: 'x' }, declaredClaims: [] }); },
    });
    expect(call).toBe(3);
    expect(out.disposition).toBe('REWRITE_REQUIRED');
  });

  it('W — a prohibited term blocks even when every claim is supported', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf({ prohibitedTerms: ['revolutionary'] });
    const strategy = await strategyOf({}, ctx);
    const out = await generateChannelContent({
      brief: deriveContentBrief('META_AD', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 0,
      generate: async () => JSON.stringify({ content: {
        primaryText: 'A revolutionary way to work.', headline: 'Calmer weeks',
        description: 'For agencies' }, declaredClaims: [] }),
    });
    expect(out.terminologyViolations[0].term).toBe('revolutionary');
    expect(out.disposition).toBe('REWRITE_REQUIRED');
  });

  it('M19 — a claim needing owner confirmation is NOT eligible', async () => {
    // The dangerous shortcut: "no unsupported claims" reading as "ready to use".
    // A compliance statement is not unsupported — it is unverifiable by
    // LaunchMind, and only the owner can stand behind it.
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    const out = await generateChannelContent({
      brief: deriveContentBrief('META_AD', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 0,
      generate: async () => JSON.stringify({ content: {
        primaryText: 'Your client data stays private. SOC 2 Type II compliant.',
        headline: 'Reporting, handled', description: 'For agencies' }, declaredClaims: [] }),
    });
    const compliance = out.claims.find(c => c.verdict === 'NEEDS_OWNER_CONFIRMATION');
    expect(compliance, 'no owner-confirmation claim was detected').toBeTruthy();
    expect(out.disposition, 'an unverifiable claim was marked eligible')
      .toBe('OWNER_CONFIRMATION_REQUIRED');
    expect(out.reasons.join(' ')).toMatch(/need your confirmation/i);
  });

  it('U/AF — a generator-declared claim survives silent auditors, and virality is refused', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    const out = await generateChannelContent({
      brief: deriveContentBrief('LINKEDIN_POST', strategy, ctx), strategy, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 0,
      generate: async () => JSON.stringify({
        content: { hook: 'Your funnel, unclogged', body: 'Your funnel, unclogged. Here is how.',
          authorMode: 'COMPANY' },
        declaredClaims: [{ fieldId: 'hook', textSpan: 'Your funnel, unclogged',
          category: 'OUTCOME_PROMISE', requirement: 'EVIDENCE' }],
      }),
    });
    const c = out.claims.find(k => k.category === 'OUTCOME_PROMISE');
    expect(c, 'the generator-declared claim was lost').toBeTruthy();
    expect(c!.verdict).toBe('UNSUPPORTED');

    const { promisesVirality } = await import('../src/services/opportunity/contentOpportunityPolicy');
    expect(promisesVirality('this will go viral')).toBe(true);
  });
});

// ── R/S/T — variants, versions, owner edit ─────────────────────────────────
describe('variants, versions and owner edits', () => {
  it('R — variants share a brief and are generated separately', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const strategy = await strategyOf({}, ctx);
    const brief = deriveContentBrief('META_AD', strategy, ctx);
    const seen: string[] = [];
    for (const label of ['pain-led', 'benefit-led', 'proof-led']) {
      await generateChannelContent({
        brief, strategy, ctx, founderId: FOUNDER, semantic: silent as never,
        variantLabel: label, maxRewrites: 0,
        generate: async (system: string) => { seen.push(system); return JSON.stringify({
          content: { primaryText: 'x', headline: 'y', description: 'z' }, declaredClaims: [] }); },
      });
    }
    expect(seen).toHaveLength(3);
    for (const [i, label] of ['pain-led', 'benefit-led', 'proof-led'].entries()) {
      expect(seen[i]).toContain(`VARIANT FRAMING: ${label}`);
    }
    // Same brief, same thesis — alternatives, not revisions.
    expect(new Set(seen.map(s => s.split('CAMPAIGN THESIS')[1]?.split('\n')[0])).size).toBe(1);
  });

  it('T — an owner edit re-enters the full pipeline', async () => {
    const { regovernOwnerEdit } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const out = await regovernOwnerEdit({
      channel: 'META_AD',
      payload: { primaryText: 'Used by 50,000 teams.', headline: 'Join them', description: 'For agencies' },
      brief: deriveContentBrief('META_AD', await strategyOf({}, ctx), ctx),
      ctx, founderId: FOUNDER, semantic: silent as never,
    });
    const claim = out.claims.find(c => c.text.includes('50,000'));
    expect(claim, 'the owner edit escaped claim detection').toBeTruthy();
    expect(claim!.verdict).toBe('UNSUPPORTED');
    expect(out.disposition).toBe('REWRITE_REQUIRED');
    expect(out.quality.factualSafety).toBe('NOT_SUPPORTED');
  });
});

// ── AB/AC/AD/AE — creative briefs, provenance, specificity ─────────────────
describe('creative briefs, provenance and application specificity', () => {
  it('AB — a visual brief refuses an unconfirmed logo and scraped imagery', async () => {
    const { deriveVisualCreativeBrief } = await C();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf({ observedAssetCount: 7 });
    const s = await strategyOf({}, ctx);
    const v = deriveVisualCreativeBrief(deriveContentBrief('META_AD', s, ctx), s, ctx);
    expect(v.logoUsage).toBe('NONE');
    expect(v.screenshotUsage).toBe('NONE');
    expect(v.authorizedAssetRefs).toEqual([]);
    expect(v.unavailable).toContain('no confirmed logo');
    expect(v.prohibitedContent.join(' ')).toContain('no competitor imagery');
    expect(v.prohibitedContent.join(' ')).toContain('no invented statistics');
  });

  it('AC — a video brief states what is NEEDED and defers avatar/voice to the owner', async () => {
    const { deriveVideoCreativeBrief } = await C();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const v = deriveVideoCreativeBrief(
      deriveContentBrief('SHORT_FORM_VIDEO_SCRIPT', await strategyOf({}, ctx), ctx), ctx,
      { scenePlan: [{ scene: 1, purpose: 'p', visual: 'v', voiceover: 'vo', onScreenText: 'ost' }],
        estimatedSeconds: 18 });
    expect(v.avatarNeeded).toBe(true);
    expect(v.voiceNeeded).toBe(true);
    expect(v.selectionDeferredToOwner).toEqual(['avatar', 'voice']);
    expect(v).not.toHaveProperty('avatarId');
    expect(v).not.toHaveProperty('voiceId');
    expect(v.captionsRequired).toBe(true);
  });

  it('a render request never carries authority, approval, spend or memory', async () => {
    const { buildCreativeRenderRequest, deriveVisualCreativeBrief, PROVIDER_FORBIDDEN_FIELDS } = await C();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const s = await strategyOf({}, ctx);
    const req = buildCreativeRenderRequest({
      workspaceId: WS_A, productId: PROD_A, artifactId: 'art-1', versionNumber: 1,
      channel: 'META_AD',
      brief: deriveVisualCreativeBrief(deriveContentBrief('META_AD', s, ctx), s, ctx),
      authorizedAssetRefs: [], brandKitVersion: 3,
    });
    const serialised = JSON.stringify(req);
    for (const f of PROVIDER_FORBIDDEN_FIELDS) {
      expect(serialised, `render request carries ${f}`).not.toContain(f);
    }
  });

  it('AD — provenance is owner-safe', async () => {
    const { artifactProvenance } = await C();
    const ctx = ctxOf({ marketIntelligenceAvailable: true,
      evidence: [h('mi1', 'MARKET_INTELLIGENCE', 'A competitor listing observation')] });
    const s = await strategyOf({ intelligenceAngles: [{ angle: 'trust beats speed', ref: 'mi1' }] }, ctx);
    const lines = artifactProvenance({ ctx, strategy: s,
      opportunityTitle: 'Trust gap', campaignName: 'Know who is coming' }).join(' | ');
    expect(lines).toContain('Trust gap');
    expect(lines).toMatch(/market observation/i);
    for (const leak of ['mi1', 'MARKET_INTELLIGENCE', 'OWNER_CONFIRMED', WS_A, PROD_A]) {
      expect(lines, `provenance leaked ${leak}`).not.toContain(leak);
    }
  });

  it('AE/M20 — two different applications produce materially different briefs', async () => {
    const { deriveContentBrief } = await B();
    const a = ctxOf();
    const b = ctxOf({
      workspaceId: WS_B, productId: PROD_B,
      application: { name: 'FitTrack', category: 'fitness', markets: ['india'], description: null },
      brand: { productId: PROD_B, workspaceId: WS_B, version: 1, missing: [],
        fields: { tone: confirmed('tone', 'energetic and blunt') } } as never,
      founderDirection: { audienceConfirmed: 'gym owners', contextDelta: null,
        primaryGoal: 'retention', competitors: [] },
      evidence: [h('product', 'PRODUCT_CONTEXT', 'Your product profile', 'FitTrack · workout logging')],
    });
    const sa = await strategyOf({}, a);
    const sb = await strategyOf({ architecture: arch({
      thesis: 'members quit when progress is invisible', audience: 'gym owners',
      primaryBenefit: 'keep members longer', brandDirectives: ['Tone: energetic and blunt'] }) }, b);
    const ba = deriveContentBrief('META_AD', sa, a);
    const bb = deriveContentBrief('META_AD', sb, b);

    // Not a name substitution: audience, message, tone and hook all differ.
    expect(bb.audience).not.toBe(ba.audience);
    expect(bb.message).not.toBe(ba.message);
    expect(bb.tone).not.toBe(ba.tone);
    expect(bb.hookDirection).not.toBe(ba.hookDirection);
    expect(bb.productId).toBe(PROD_B);
  });
});

// ── AG/AH — side effects ───────────────────────────────────────────────────
describe('no learning, no execution', () => {
  it('AG/AH — generation writes no memory, publish, campaign or approval', async () => {
    const { generateChannelContent } = await G();
    const { deriveContentBrief } = await B();
    const ctx = ctxOf();
    const s = await strategyOf({}, ctx);
    await generateChannelContent({
      brief: deriveContentBrief('META_AD', s, ctx), strategy: s, ctx,
      founderId: FOUNDER, semantic: silent as never, maxRewrites: 0,
      generate: async () => JSON.stringify({ content: { primaryText: 'a', headline: 'b',
        description: 'c' }, declaredClaims: [] }),
    });
    expect(db.rows('marketing_memories')).toHaveLength(0);
    expect(db.rows('publishing_targets')).toHaveLength(0);
    expect(db.rows('campaigns')).toHaveLength(0);
  });

  it('B3 modules cannot reach execution or memory surfaces', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    for (const f of ['strategyComposition.ts', 'briefComposition.ts',
                     'b3ContentGeneration.ts', 'creativeBriefs.ts']) {
      const src = readFileSync(join(__dirname, '../src/services/content', f), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      for (const forbidden of ['publishing_targets', 'spend_cap', 'launched_at',
                               'marketing_memories', 'asset_approvals', 'heygen', 'replicate']) {
        expect(src.toLowerCase(), `${f} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('UX2.9 recognition repair keeps the idea within the capability contract', () => {
  it('feeds the rejected payload and unsupported action into repair, then re-governs the replacement', async () => {
    const description = 'Connect with trusted, vetted home service professionals in your neighborhood.';
    const ctx = ctxOf({ application: { name:'AllignX', description, category:'home services',markets:['usa'] },
      evidence:[h('product','PRODUCT_CONTEXT','Your product profile',description)] });
    const strategy = await strategyOf({},ctx);
    const brief = (await B()).deriveContentBrief('META_AD',strategy,ctx);
    const prompts:string[]=[];
    const out=await (await G()).generateChannelContent({ctx,strategy,brief,founderId:FOUNDER,
      variantLabel:'Problem recognition',semantic:silent as never,
      generate:async system=>{
        prompts.push(system);
        return JSON.stringify({content:{
          headline:prompts.length===1?'Should finding help be this hard?':'Still calling around?',
          primaryText:'AllignX connects you with trusted, vetted home service professionals in your neighborhood.',
          description:'For your home projects',visualBrief:'Recognition before product reveal'},declaredClaims:[]});
      }});
    expect(out.disposition).toBe('ELIGIBLE');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Should finding help be this hard?');
    expect(prompts[1]).toContain('no record that this product can find');
    expect(out.payload.headline).toBe('Still calling around?');
  });
});

describe('UX2.9 Meta CTA governance', () => {
  it('discovers CTA claims and refuses unsupported actions or promises there', async () => {
    const ctx=ctxOf({application:{name:'AllignX',description:'Connect with home service professionals.',category:'home services',markets:[]},
      evidence:[h('product','PRODUCT_CONTEXT','Your product profile','AllignX connects with home service professionals.')]});
    const strategy=await strategyOf({},ctx);
    const brief=(await B()).deriveContentBrief('META_AD',strategy,ctx);
    const gen=await G();
    const payload={headline:'Still calling around?',primaryText:'AllignX connects with home service professionals.',description:'For your home projects',cta:'Book instantly'};
    expect(gen.fieldsFor('META_AD',payload)).toContainEqual({name:'cta',text:'Book instantly'});
    const out=await gen.generateChannelContent({ctx,strategy,brief,founderId:FOUNDER,maxRewrites:0,
      semantic:silent as never,generate:async()=>JSON.stringify({content:payload,declaredClaims:[]})});
    expect(out.disposition).not.toBe('ELIGIBLE');
  });
});
