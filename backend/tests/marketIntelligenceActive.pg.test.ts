/**
 * @file marketIntelligenceActive.pg.test.ts
 * @description THE PHASE 3.4C ACCEPTANCE MATRIX — cases A–Z, owner-visible path.
 *
 *   3.4B proved the governed pipeline in isolation. This proves the PRODUCTION
 *   path: subject resolution from the product's own rows → resolution →
 *   ContextPackageV2 → server-issued handles → grounding → provenance. The model
 *   is not called; `issueEvidenceHandles` IS the evidence set the model receives,
 *   so asserting on it is deterministic and stronger than asserting on prose.
 *
 *   MODE IS SET PER TEST, never globally, so the SHADOW and OFF cases are real
 *   comparisons against the same fixtures rather than a separate run.
 *
 * @security Cases F and Z are the isolation proofs; X and Y are the
 *   synthetic-data proofs. Any failure here is a §25 stop condition.
 * @dependencies contextPackageV2, subjectResolver, growthBrainOutputGrounding,
 *   marketIntelligenceService, growthBrainDecisionService (all real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { formatContextPackageForModel } from '../src/lib/context/contextFormatter';
import {
  issueEvidenceHandles, groundClaims, detectFounderConflict, type EvidenceHandle,
} from '../src/services/growthBrainOutputGrounding';
import {
  ingestStoreListing, setSourceLifecycle, detectExternalConflicts, resolveForProduct,
} from '../src/services/marketIntelligence/marketIntelligenceService';
import { resolveProductSubjects } from '../src/services/marketIntelligence/subjectResolver';
import { storeSubjectKey, entityGroupKey, canonicalPublisher } from '../src/services/marketIntelligence/contract';
import { persistRecommendations, decideRecommendation } from '../src/services/growthBrainDecisionService';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RUN = `${Date.now()}-${process.pid}`;
const FA = uuidFrom(`ac-fa-${RUN}`), FB = uuidFrom(`ac-fb-${RUN}`);
const WSA = uuidFrom(`ac-wsa-${RUN}`), WSB = uuidFrom(`ac-wsb-${RUN}`);
const PA = uuidFrom(`ac-pa-${RUN}`), PA2 = uuidFrom(`ac-pa2-${RUN}`), PB = uuidFrom(`ac-pb-${RUN}`);
const SESSION = uuidFrom(`ac-s-${RUN}`);

/**
 * Real listing URLs → real subject keys, exactly as production derives them.
 *
 * Provider ids are UNIQUE TO THIS SUITE. The source-record table is global and
 * shared, so a fixture id reused across suites means one suite's cleanup
 * deletes another's rows mid-run — which is exactly how case O in the 3.4B
 * matrix started failing only when the two suites ran together.
 */
const OWN_URL = 'https://apps.apple.com/us/app/mine/id100000001';
const RIVAL_URL = 'https://apps.apple.com/us/app/rival/id100000002';
const RIVAL_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.rivalco.threefourc';
const GHOST_URL = 'https://apps.apple.com/us/app/ghost/id100000003';
const OWN = storeSubjectKey('app_store', 'us', 'id100000001');
const RIVAL = storeSubjectKey('app_store', 'us', 'id100000002');
const RIVAL_PLAY = storeSubjectKey('play_store', 'us', 'com.rivalco.threefourc');
const GHOST = storeSubjectKey('app_store', 'us', 'id100000003');

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function listing(over: Record<string, unknown> = {}) {
  return {
    provider: 'app_store', storefront: 'us', providerId: 'id100000002',
    sourceRef: RIVAL_URL, name: 'Rival', developer: 'RivalCo, Incorporated',
    summary: 'Book a trusted local pro in minutes.', category: 'productivity',
    rating: 4.7, ratingCount: 12000, free: true,
    updatedAt: days(5), releasedAt: '2020-01-01T00:00:00.000Z',
    retrievedAt: new Date().toISOString(), ...over,
  };
}

async function pkgFor(productId: string, workspaceId = WSA, founderId = FA) {
  return buildContextPackageV2({
    workspaceId, founderId, productId, intent: 'MORNING_BRIEF',
    query: 'What should this product focus on next?', persist: false,
  });
}

const mkRec = (what: string): GrowthBrainRecommendation => ({
  type: 'RECOMMENDATION', actionType: 'RESEARCH', what,
  whyNow: 'because', nextStep: 'look into it',
  supportedBy: [{ kind: 'MARKET_INTELLIGENCE', label: 'Rival — App Store observation', authority: 'VERIFIED_EXTERNAL', memoryClass: null, evidenceCount: null, detail: 'App Store listing, observed today' }],
  supporting: [], founderConflict: null, requiresFounderReview: false,
  expectedEffect: null, requiresApproval: false,
  evidenceStrength: 'some evidence', confidence: null,
} as GrowthBrainRecommendation);

async function clearEvidence() {
  await db().from('market_intelligence_resolutions').delete().in('workspace_id', [WSA, WSB]);
  await db().from('market_intelligence_source_records').delete()
    .in('subject_key', [OWN, RIVAL, RIVAL_PLAY, GHOST]);
}

d('Phase 3.4C — owner-visible acceptance matrix (A–Z)', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert([
      { id: FA, email: `ac-a-${RUN}@lab.invalid`, name: 'AC A', plan: 'studio' },
      { id: FB, email: `ac-b-${RUN}@lab.invalid`, name: 'AC B', plan: 'studio' },
    ], { onConflict: 'id' }));
    await must('workspaces', db().from('workspaces').upsert([
      { id: WSA, founder_id: FA, name: `AC WS A ${RUN}` },
      { id: WSB, founder_id: FB, name: `AC WS B ${RUN}` },
    ], { onConflict: 'id' }));
    await must('products', db().from('products').upsert([
      { id: PA, founder_id: FA, workspace_id: WSA, name: 'Mine', store_url: OWN_URL,
        platform: 'app_store', category: 'productivity', markets: ['usa'],
        // The owner CONFIRMED Rival (below); Ghost is scraped but unconfirmed.
        competitor_set: [
          { name: 'Rival', storeUrl: RIVAL_URL },
          { name: 'Rival', storeUrl: RIVAL_PLAY_URL },
          { name: 'Ghost', storeUrl: GHOST_URL },
        ] },
      { id: PA2, founder_id: FA, workspace_id: WSA, name: 'Sibling', store_url: 'https://apps.apple.com/us/app/sib/id100000009',
        platform: 'app_store', category: 'productivity', markets: ['usa'], competitor_set: [] },
      { id: PB, founder_id: FB, workspace_id: WSB, name: 'Other business', store_url: 'https://apps.apple.com/us/app/oth/id100000008',
        platform: 'app_store', category: 'productivity', markets: ['usa'], competitor_set: [] },
    ], { onConflict: 'id' }));
    await must('session', db().from('onboarding_sessions').upsert(
      { id: SESSION, founder_id: FA, current_state: 'PHASE_1_COMPLETE', product_id: PA }, { onConflict: 'id' }));
    await must('competitor', db().from('competitor_relationships').upsert({
      id: uuidFrom(`ac-c-${RUN}`), founder_id: FA, product_id: PA, session_id: SESSION,
      name: 'Rival', relationship: 'CONFIRMED', key_differentiator: 'cheaper',
    }, { onConflict: 'id' }));
    await must('founder_context', db().from('founder_context').upsert({
      id: uuidFrom(`ac-fc-${RUN}`), founder_id: FA, workspace_id: WSA, product_id: PA,
      audience_confirmed: 'Solo tradespeople booking local jobs',
      // Carries a DIRECTION, because the existing founder-conflict detector is
      // valence-based (same subject, opposite direction). A neutral statement
      // of fact is not something a recommendation can contradict, and §10
      // forbids adding a second market-specific guard to work around that.
      context_delta: 'Enterprise positioning reduces trust with solo tradespeople',
      primary_goal: 'Grow local bookings',
    }, { onConflict: 'id' }));
  }, 180_000);

  afterAll(async () => {
    await clearEvidence();
    await db().from('growth_brain_recommendations').delete().in('workspace_id', [WSA, WSB]);
    await db().from('founder_context').delete().eq('workspace_id', WSA);
    await db().from('competitor_relationships').delete().eq('product_id', PA);
    await db().from('onboarding_sessions').delete().eq('id', SESSION);
    await db().from('products').delete().in('id', [PA, PA2, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB]);
    await db().from('founders').delete().in('id', [FA, FB]);
    delete process.env.MARKET_INTELLIGENCE_MODE;
  });

  beforeEach(() => { process.env.MARKET_INTELLIGENCE_MODE = 'ACTIVE'; });

  // ── A / B / C / D ─────────────────────────────────────────────────────────
  it('A — ACTIVE with no usable market intelligence reports the flag false', async () => {
    await clearEvidence();
    const pkg = await pkgFor(PA);
    expect(pkg.marketIntelligence.mode).toBe('ACTIVE');
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(pkg.marketIntelligence.reason).toMatch(/No market observations/);
    expect(issueEvidenceHandles(pkg).filter(h => h.kind === 'MARKET_INTELLIGENCE')).toHaveLength(0);
  }, 120_000);

  it('B/C/D — a valid current observation reaches the package, the flag and the model', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const pkg = await pkgFor(PA);

    expect(pkg.marketIntelligence.available).toBe(true);        // B
    expect(pkg.marketEvidence.length).toBeGreaterThan(0);       // C
    const item = pkg.marketEvidence[0];
    expect(item.freshness).toBe('CURRENT');
    expect(item.subjectRelation).toBe('CONFIRMED_COMPETITOR');
    expect(item.lifecycle).toBe('ACTIVE');
    expect(item.authorityTier).toBe('VERIFIED_EXTERNAL');

    const handles = issueEvidenceHandles(pkg).filter(h => h.kind === 'MARKET_INTELLIGENCE');
    expect(handles.length).toBe(pkg.marketEvidence.length);      // D
    // And it genuinely reaches the model text, labelled as external.
    const text = formatContextPackageForModel(pkg);
    expect(text).toMatch(/EXTERNAL MARKET OBSERVATIONS/);
    expect(text).toMatch(/NOT this business's own performance data/);
    // No internal identifiers in what the model sees.
    expect(text).not.toContain(item.independenceKey);
  }, 120_000);

  // ── E ─────────────────────────────────────────────────────────────────────
  it('E — a market handle the server never issued cannot resolve', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const handles = issueEvidenceHandles(await pkgFor(PA));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Competitors are well rated', evidenceRefs: ['mi99', 'market', 'benchmark'],
    }], handles);
    expect(out.claims[0].refs).toHaveLength(0);
    expect(out.claims[0].type).toBe('INFERENCE');
  }, 120_000);

  // ── F / Z ─────────────────────────────────────────────────────────────────
  it('F — a sibling product in the SAME workspace gets no evidence about an entity it never confirmed', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const sibling = await pkgFor(PA2);
    expect(sibling.marketEvidence).toEqual([]);
    expect(sibling.marketIntelligence.available).toBe(false);
    // The owning product still does.
    expect((await pkgFor(PA)).marketIntelligence.available).toBe(true);
  }, 120_000);

  it('F2 — a SCRAPED competitor the owner never confirmed contributes nothing', async () => {
    // Ghost is in products.competitor_set (scraper output) but has NO
    // competitor_relationships row, so the owner never confirmed it.
    // Scraper output is not consent, and this is the gate that says so.
    await clearEvidence();
    await ingestStoreListing(listing({
      providerId: 'id100000003', sourceRef: GHOST_URL,
      name: 'Ghost', developer: 'GhostCo, Inc.',
    }));
    const subjects = await resolveProductSubjects(PA);
    expect(subjects.confirmedCompetitorSubjectKeys).not.toContain(GHOST);
    expect(subjects.skipped.some(x => x.name === 'Ghost' && x.reason === 'NOT_CONFIRMED')).toBe(true);

    const pkg = await pkgFor(PA);
    expect(pkg.marketEvidence.map(m => m.subject)).not.toContain('Ghost');
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(issueEvidenceHandles(pkg).filter(h => h.kind === 'MARKET_INTELLIGENCE')).toHaveLength(0);

    // And a CONFIRMED competitor in the same set still works, so this is a
    // consent gate rather than a blanket refusal.
    await ingestStoreListing(listing());
    expect((await pkgFor(PA)).marketIntelligence.available).toBe(true);
  }, 180_000);

  it('X2 — a benchmark-shaped item cannot enter the market evidence set', async () => {
    // Direct probe of the ONLY assembly point. Everything in marketEvidence
    // must trace to a governed store-listing source record: real subject key,
    // real store provider, VERIFIED_EXTERNAL, real observation date.
    await clearEvidence();
    await ingestStoreListing(listing());
    const pkg = await pkgFor(PA);
    expect(pkg.marketEvidence.length).toBeGreaterThan(0);
    for (const m of pkg.marketEvidence) {
      expect(['app_store', 'play_store']).toContain(m.provider);
      expect(m.authorityTier).toBe('VERIFIED_EXTERNAL');
      expect(m.observationType.startsWith('LISTING_')).toBe(true);
      expect(m.independenceKey).toBeTruthy();
      expect(m.observedAt).toBeTruthy();
      // A playbook aggregate has no entity and no date; nothing shaped like one
      // can satisfy the above.
      expect(m.subject).not.toMatch(/benchmark|category median|playbook/i);
    }
    // The package's own count agrees with what resolution produced — an item
    // appended from anywhere else would break this equality.
    expect(pkg.marketIntelligence.eligible).toBe(pkg.marketEvidence.length);
    expect(pkg.marketIntelligence.eligible).toBeLessThanOrEqual(pkg.marketIntelligence.resolved);
  }, 120_000);

  it('Z — another workspace cannot reach the same global evidence', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const other = await pkgFor(PB, WSB, FB);
    expect(other.marketEvidence).toEqual([]);
    expect(other.marketIntelligence.available).toBe(false);
    // Subject resolution is the reason: the other business owns no such entity.
    expect((await resolveProductSubjects(PB)).allSubjectKeys).not.toContain(RIVAL);
  }, 120_000);

  // ── G / H ─────────────────────────────────────────────────────────────────
  it('G — a fabricated market metric is dropped, not downgraded', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const handles = issueEvidenceHandles(await pkgFor(PA));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Category conversion improved 31% last quarter',
      evidenceRefs: handles.filter(h => h.kind === 'MARKET_INTELLIGENCE').map(h => h.ref),
    }], handles);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('UNSUPPORTED_MEASUREMENT');
    expect(out.downgraded).toBe(0);
  }, 120_000);

  it('H — first-party and external values stay distinct', async () => {
    await clearEvidence();
    await ingestStoreListing(listing({ rating: 4.7 }));
    const handles = issueEvidenceHandles(await pkgFor(PA));
    const mi = handles.filter(h => h.kind === 'MARKET_INTELLIGENCE').map(h => h.ref);
    const fp: EvidenceHandle = {
      ref: 'perf', kind: 'CAMPAIGN_PERFORMANCE', label: 'Your store performance',
      text: 'Your App Store listing holds a 3.90 star rating.', authority: null,
    };

    // FORBIDDEN: the competitor's number restated as the owner's.
    const collapsed = groundClaims([{
      type: 'OBSERVATION', text: 'Your rating is 4.70', evidenceRefs: mi,
    }], [...handles, fp]);
    expect(collapsed.claims).toHaveLength(0);
    expect(collapsed.dropped[0].reason).toBe('EXTERNAL_CANNOT_SUPPORT_FIRST_PARTY_CLAIM');

    // ALLOWED: the comparison, citing BOTH.
    const compared = groundClaims([{
      type: 'OBSERVATION', text: 'Rival is rated 4.70 while your listing is rated 3.90',
      evidenceRefs: [...mi, 'perf'],
    }], [...handles, fp]);
    expect(compared.claims).toHaveLength(1);
    const kinds = compared.claims[0].refs.map(r => r.kind);
    expect(kinds).toContain('MARKET_INTELLIGENCE');
    expect(kinds).toContain('CAMPAIGN_PERFORMANCE');
  }, 120_000);

  // ── I ─────────────────────────────────────────────────────────────────────
  it('I — two independent external sources disagreeing are both preserved', async () => {
    await clearEvidence();
    await ingestStoreListing(listing({ rating: 4.4, summary: null, ratingCount: null, free: null, category: 'productivity' }));
    await ingestStoreListing(listing({
      provider: 'play_store', providerId: 'com.rivalco.threefourc', sourceRef: RIVAL_PLAY_URL,
      developer: 'RivalCo, Inc.', rating: 2.9, summary: null, ratingCount: null, free: null,
      category: 'productivity',
    }));
    const pkg = await pkgFor(PA);
    const ratings = pkg.marketEvidence.filter(m => m.observationType === 'LISTING_RATING');
    expect(ratings.map(r => r.structuredValue).sort()).toEqual([2.9, 4.4]);

    // The entity grouping fix is what lets these be compared as ONE entity.
    expect(ratings[0].entityGroupKey).toBe(ratings[1].entityGroupKey);
    expect(ratings[0].entityGroupKey).not.toBeNull();

    const resolved = await resolveForProduct({
      workspaceId: WSA, productId: PA,
      product: { confirmedCompetitorSubjectKeys: [RIVAL, RIVAL_PLAY], ownSubjectKey: OWN,
                 dims: { category: 'productivity', geography: 'usa' } },
      subjectKeys: [RIVAL, RIVAL_PLAY],
    });
    const grouped = resolved.items.map(i => ({
      ...i, record: { ...i.record, subjectKey: i.record.entityGroupKey ?? i.record.subjectKey },
    }));
    const conflict = detectExternalConflicts(grouped).find(c => c.observationType === 'LISTING_RATING');
    expect(conflict).toBeDefined();
    expect(conflict!.independentSources).toBe(2);
    expect(conflict!.ownerStatement).toContain('not choosing between them');
    expect(conflict!.ownerStatement).not.toMatch(/3\.65/);
  }, 120_000);

  // ── J ─────────────────────────────────────────────────────────────────────
  it('J — founder direction still outranks market evidence, via the EXISTING machinery', async () => {
    await clearEvidence();
    await ingestStoreListing(listing({ summary: 'Enterprise teams standardise on Rival for procurement.' }));
    const pkg = await pkgFor(PA);
    const handles = issueEvidenceHandles(pkg);
    // Founder direction is present and is a separate handle kind.
    expect(handles.some(h => h.kind === 'FOUNDER_DIRECTION')).toBe(true);
    // No second, market-specific guard exists — the same detector is used.
    const conflict = detectFounderConflict(
      'Enterprise positioning improves trust with solo tradespeople, so reposition', handles);
    expect(conflict).not.toBeNull();
    expect(conflict!.kind).toBe('FOUNDER_DIRECTION');

    // NOT a blanket refusal: a recommendation that shares no subject with any
    // founder-authority statement passes untouched, market evidence and all.
    expect(detectFounderConflict(
      'Review the ordering of the store screenshots', handles)).toBeNull();

    // OBSERVED, and reported rather than asserted away: re-stating the founder's
    // OWN direction ("...reduces trust... so stay local") still trips the
    // BUSINESS_GOAL handle, because "reduces" and "Grow local bookings" share
    // the subject "local" with opposite valence. That is pre-existing detector
    // noise (P1-13 churn), not a market-intelligence regression — it fires
    // identically with no market evidence present. It errs toward asking the
    // owner, which is the safe direction, so it is recorded here rather than
    // suppressed with a market-specific exception §10 forbids.
    const noisy = detectFounderConflict(
      'Enterprise positioning reduces trust with solo tradespeople, so stay local', handles);
    expect(noisy?.kind).toBe('BUSINESS_GOAL');
    // Market evidence never carries founder authority.
    for (const h of handles.filter(h => h.kind === 'MARKET_INTELLIGENCE')) {
      expect(h.authority).toBe('VERIFIED_EXTERNAL');
    }
  }, 120_000);

  // ── K / L ─────────────────────────────────────────────────────────────────
  it('K — STALE evidence cannot support present-tense market wording', async () => {
    await clearEvidence();
    await ingestStoreListing(listing({ updatedAt: days(800), releasedAt: days(1200) }));
    const pkg = await pkgFor(PA);
    // STALE is not handle-eligible at all, so it never reaches the model.
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(pkg.marketIntelligence.reason).toMatch(/none is currently applicable and fresh enough/);

    // And even if a STALE handle were somehow presented, the wording is refused.
    const stale: EvidenceHandle[] = [{
      ref: 'mi1', kind: 'MARKET_INTELLIGENCE', label: 'x',
      text: 'Rival holds a 4.70 star public store rating.',
      authority: 'VERIFIED_EXTERNAL', freshness: 'STALE',
    }];
    const hostile = groundClaims([{
      type: 'OBSERVATION', text: 'The market currently rates Rival at 4.70', evidenceRefs: ['mi1'],
    }], stale);
    expect(hostile.claims).toHaveLength(0);
    expect(hostile.dropped[0].reason).toBe('STALE_EVIDENCE_CANNOT_SUPPORT_CURRENT_CLAIM');
    // Historical framing of the same fact IS allowed.
    expect(groundClaims([{
      type: 'OBSERVATION', text: 'Rival was rated 4.70 when last observed', evidenceRefs: ['mi1'],
    }], stale).claims).toHaveLength(1);
  }, 120_000);

  it('L — UNKNOWN_DATE evidence cannot carry a numeric current-market claim', async () => {
    await clearEvidence();
    await ingestStoreListing(listing({ updatedAt: null, releasedAt: null }));
    const pkg = await pkgFor(PA);
    expect(pkg.marketEvidence).toEqual([]);          // undated is not eligible

    const undated: EvidenceHandle[] = [{
      ref: 'mi1', kind: 'MARKET_INTELLIGENCE', label: 'x',
      text: 'Rival holds a 4.70 star public store rating.',
      authority: 'VERIFIED_EXTERNAL', freshness: 'UNKNOWN_DATE',
    }];
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Rival is rated 4.70 in the market', evidenceRefs: ['mi1'],
    }], undated);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('UNDATED_EVIDENCE_CANNOT_SUPPORT_NUMERIC_CLAIM');
  }, 120_000);

  // ── M / N / R ─────────────────────────────────────────────────────────────
  it('M/N/R — retraction: history is preserved, new generations lose the evidence', async () => {
    await clearEvidence();
    const ing = await ingestStoreListing(listing());
    const src = ing.records[0];

    const before = await pkgFor(PA);
    expect(before.marketIntelligence.available).toBe(true);

    const [rec] = await persistRecommendations(
      { workspaceId: WSA, founderId: FA, productId: PA },
      [mkRec(`Compare positioning against Rival ${RUN}`)]);
    const snapshotBefore = await db().from('growth_brain_recommendations').select('*').eq('id', rec.id).single();
    await decideRecommendation(
      { workspaceId: WSA, founderId: FA, productId: PA }, rec.id, 'APPROVE');
    const decidedBefore = await db().from('growth_brain_recommendations')
      .select('decision_status, execution_status, action_key').eq('id', rec.id).single();

    for (const r of ing.records) await setSourceLifecycle(r.id, 'RETRACTED', { reason: 'publisher withdrew' });

    // N — the snapshot is byte-identical; provenance still names the source.
    const snapshotAfter = await db().from('growth_brain_recommendations').select('*').eq('id', rec.id).single();
    expect(snapshotAfter.data!.what).toEqual(snapshotBefore.data!.what);
    expect(snapshotAfter.data!.supported_by).toEqual(snapshotBefore.data!.supported_by);
    expect(snapshotAfter.data!.fingerprint).toEqual(snapshotBefore.data!.fingerprint);

    // R — the settled decision is untouched by an evidence refresh.
    const decidedAfter = await db().from('growth_brain_recommendations')
      .select('decision_status, execution_status, action_key').eq('id', rec.id).single();
    expect(decidedAfter.data).toEqual(decidedBefore.data);
    expect(decidedAfter.data!.decision_status).toBe('APPROVED');

    // M — a NEW generation does not receive the retracted evidence.
    const after = await pkgFor(PA);
    expect(after.marketEvidence).toEqual([]);
    expect(after.marketIntelligence.available).toBe(false);
    expect(issueEvidenceHandles(after).filter(h => h.kind === 'MARKET_INTELLIGENCE')).toHaveLength(0);
    void src;
  }, 180_000);

  // ── O ─────────────────────────────────────────────────────────────────────
  it('O — owner-facing provenance is safe: no ids, handles, keys or policy internals', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    const pkg = await pkgFor(PA);
    for (const m of pkg.marketEvidence) {
      // Owner-safe surface: a readable label naming the store and the entity.
      expect(m.label).toMatch(/App Store observation|Play Store observation/);
      expect(m.label).not.toMatch(/[0-9a-f]{16}/);      // no hashes/ids
      expect(m.subject).not.toMatch(/^app_store:|^play_store:/);
      expect(m.observedAt).toBeTruthy();
    }
    // The raw source row is never client-readable (migration 113).
    const res = await fetch(`${pg.url}/rest/v1/market_intelligence_source_records?select=id`,
      { headers: { apikey: pg.anonKey, Authorization: `Bearer ${pg.anonKey}` } });
    expect((await res.json() as unknown[]).length ?? 0).toBe(0);
  }, 120_000);

  // ── P ─────────────────────────────────────────────────────────────────────
  it('P — Morning Brief and Growth Brain read the SAME resolved contract', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    // Both surfaces build a package for the same product; the market arm is a
    // property of the package, so there is structurally one resolver.
    const brief = await buildContextPackageV2({
      workspaceId: WSA, founderId: FA, productId: PA, intent: 'MORNING_BRIEF',
      query: 'What should Mine focus on next?', persist: false,
    });
    const growth = await pkgFor(PA);
    expect(brief.marketIntelligence.available).toBe(growth.marketIntelligence.available);
    expect(brief.marketEvidence.map(m => m.claim).sort())
      .toEqual(growth.marketEvidence.map(m => m.claim).sort());

    // And there is exactly one code path: the brief route holds no resolver.
    const routeSrc = await import('fs').then(fs =>
      fs.readFileSync('src/routes/owner.route.ts', 'utf8'));
    expect(routeSrc).not.toMatch(/resolveForProduct|ingestStoreListing|resolveProductSubjects/);
  }, 180_000);

  // ── Q ─────────────────────────────────────────────────────────────────────
  it('Q — a provider outage degrades honestly and leaves first-party reasoning intact', async () => {
    await clearEvidence();
    const { fetchStoreListing, StoreListingUnavailable } =
      await import('../src/services/marketIntelligence/storeListingAdapter');
    await expect(fetchStoreListing('https://example.invalid/nope'))
      .rejects.toBeInstanceOf(StoreListingUnavailable);

    const pkg = await pkgFor(PA);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(pkg.marketIntelligence.reason).toBeTruthy();
    // First-party evidence is unaffected — the owner still gets a brief.
    const handles = issueEvidenceHandles(pkg);
    expect(handles.some(h => h.kind === 'FOUNDER_DIRECTION')).toBe(true);
    expect(handles.some(h => h.kind === 'BUSINESS_GOAL')).toBe(true);
  }, 120_000);

  // ── S / T ─────────────────────────────────────────────────────────────────
  it('S/T — activation mutates no Marketing Memory and performs no execution', async () => {
    await clearEvidence();
    const counts = async () => {
      const w = async (t: string) => (await db().from(t).select('id', { count: 'exact', head: true }).eq('workspace_id', WSA)).count ?? 0;
      const f = async (t: string) => (await db().from(t).select('id', { count: 'exact', head: true }).eq('founder_id', FA)).count ?? 0;
      return { mem: await w('marketing_memories'), ver: await w('marketing_memory_versions'),
               ev: await w('evidence'), missions: await w('missions'),
               campaigns: await f('campaigns'), assets: await f('content_assets') };
    };
    const before = await counts();
    await ingestStoreListing(listing());
    const pkg = await pkgFor(PA);
    expect(pkg.marketIntelligence.available).toBe(true);   // non-vacuous
    issueEvidenceHandles(pkg);
    expect(await counts()).toEqual(before);

    // No execution surface exists on any market module.
    for (const mod of [
      await import('../src/services/marketIntelligence/marketIntelligenceService'),
      await import('../src/services/marketIntelligence/subjectResolver'),
      await import('../src/services/marketIntelligence/storeListingAdapter'),
    ]) {
      for (const name of Object.keys(mod)) {
        expect(name).not.toMatch(/^(execute|launch|publish|spend|post|send|apply)/i);
      }
    }
  }, 180_000);

  // ── U / V / W ─────────────────────────────────────────────────────────────
  it('U — SHADOW behaviour is unchanged by activation', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    process.env.MARKET_INTELLIGENCE_MODE = 'SHADOW';
    const pkg = await pkgFor(PA);
    expect(pkg.marketIntelligence.mode).toBe('SHADOW');
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(issueEvidenceHandles(pkg).filter(h => h.kind === 'MARKET_INTELLIGENCE')).toHaveLength(0);
  }, 120_000);

  it('V — OFF behaviour is unchanged', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    process.env.MARKET_INTELLIGENCE_MODE = 'OFF';
    const pkg = await pkgFor(PA);
    expect(pkg.marketIntelligence.mode).toBe('OFF');
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
  }, 120_000);

  it('W — availability is per product and per request, not a subsystem property', async () => {
    await clearEvidence();
    await ingestStoreListing(listing());
    // Same non-empty table, same workspace, same ACTIVE mode — different answers.
    expect((await pkgFor(PA)).marketIntelligence.available).toBe(true);
    expect((await pkgFor(PA2)).marketIntelligence.available).toBe(false);
    // And it changes WITHIN one product as the evidence changes.
    await clearEvidence();
    expect((await pkgFor(PA)).marketIntelligence.available).toBe(false);
  }, 180_000);

  // ── X / Y ─────────────────────────────────────────────────────────────────
  it('X — synthetic playbook signals can never become market handles', async () => {
    await clearEvidence();
    const { count } = await db().from('playbook_signals').select('id', { count: 'exact', head: true });
    expect(count ?? 0, 'no seeded playbook rows, so this case would be vacuous').toBeGreaterThan(0);

    const pkg = await pkgFor(PA);
    expect(pkg.marketEvidence).toEqual([]);   // playbook rows exist; MI does not

    // Structural: no market module reads playbook_signals or benchmarks.
    const fs = await import('fs');
    for (const f of ['contract', 'ingestionBoundary', 'applicabilityPolicy',
                     'marketIntelligenceService', 'subjectResolver', 'storeListingAdapter']) {
      const src = fs.readFileSync(`src/services/marketIntelligence/${f}.ts`, 'utf8');
      expect(src, `${f} reads playbook data`).not.toMatch(/playbook_signals|getBenchmarks|intelligence_trends/);
    }
  }, 120_000);

  it('Y — the unsourced 3.5% reference point never becomes market evidence', async () => {
    const fs = await import('fs');
    // It stays a labelled heuristic inside connection insights (P1-15)…
    const insights = fs.readFileSync('src/services/connectionInsightService.ts', 'utf8');
    expect(insights).toMatch(/APP_STORE_CONVERSION_REFERENCE/);
    expect(insights).toMatch(/not measured market data/);
    // …and the Growth Brain route no longer derives availability from benchmarks.
    const route = fs.readFileSync('src/routes/channels.route.ts', 'utf8');
    expect(route).not.toMatch(/marketIntelligenceAvailable = \(await getBenchmarks/);
    // …and the caller hint is explicitly ignored by the generator.
    const gen = fs.readFileSync('src/services/growthBrainRecommendationService.ts', 'utf8');
    expect(gen).toMatch(/void req\.marketIntelligenceAvailable;/);
    expect(gen).toMatch(/pkg\.marketIntelligence\.available === true/);
  });
});

// ── P1-17: entity grouping, closed in this milestone ────────────────────────
describe('Phase 3.4C — entity grouping (P1-17)', () => {
  it('links a legal-suffix variant of the SAME publisher', () => {
    const a = entityGroupKey('Notion: Notes, Tasks, AI', 'Notion Labs, Incorporated');
    const b = entityGroupKey('Notion', 'Notion Labs, Inc.');
    expect(a).not.toBeNull();
    expect(a!.key).toBe(b!.key);
  });

  it('does NOT link a similar display name from a different developer', () => {
    const a = entityGroupKey('Rival', 'RivalCo, Inc.');
    const b = entityGroupKey('Rival', 'Copycat Software, Inc.');
    expect(a!.key).not.toBe(b!.key);
  });

  it('does NOT link when the publisher is ambiguous', () => {
    // A publisher that is ONLY a legal form identifies nobody.
    expect(entityGroupKey('Rival', 'Inc.')).toBeNull();
    expect(entityGroupKey('Rival', 'Ltd')).toBeNull();
    expect(canonicalPublisher('Inc.')).toBe('');
    // A one-character product name identifies no product.
    expect(entityGroupKey('X', 'RivalCo, Inc.')).toBeNull();
  });

  it('links the same publisher across App Store and Play Store', () => {
    const apple = entityGroupKey('Rival: Local Pros', 'RivalCo Technologies, Inc.');
    const play = entityGroupKey('Rival - Local Pros', 'RivalCo Technologies Incorporated');
    expect(apple!.key).toBe(play!.key);
  });

  it('does NOT collapse genuinely different publishers that share a word', () => {
    expect(canonicalPublisher('Rival Software')).not.toBe(canonicalPublisher('Rival Systems'));
    expect(entityGroupKey('Rival', 'Rival Software')!.key)
      .not.toBe(entityGroupKey('Rival', 'Rival Systems')!.key);
  });

  it('grouping never touches authority', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/services/marketIntelligence/contract.ts', 'utf8');
    const fn = src.slice(src.indexOf('export function entityGroupKey'), src.indexOf('const LEGAL_SUFFIXES'));
    expect(fn).not.toMatch(/authority|AUTHORITY|tier/i);
  });
});
