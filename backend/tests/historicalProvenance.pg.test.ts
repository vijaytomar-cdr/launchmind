/**
 * @file historicalProvenance.pg.test.ts
 * @description CASE G — historical Market Intelligence lifecycle disclosure.
 *
 *   Two timelines meet here: a recommendation is a frozen record of what
 *   LaunchMind said and why; the source it rested on keeps living. The snapshot
 *   must not move, and the owner must still be told when the ground under an old
 *   recommendation has shifted.
 *
 *   Every case drives the real annotator against real Postgres and real source
 *   records. The immutability case captures the persisted row BEFORE and
 *   compares it byte-for-byte AFTER, so "the snapshot did not change" is
 *   measured rather than asserted.
 *
 * @security Asserts that no source id, subject key, lifecycle enum or policy
 *   version reaches the annotated payload.
 * @dependencies historicalProvenance, marketIntelligenceService,
 *   growthBrainDecisionService (all real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import {
  annotateHistoricalProvenance, UNKNOWN_SOURCE_NOTICE,
} from '../src/services/marketIntelligence/historicalProvenance';
import {
  ingestStoreListing, setSourceLifecycle,
} from '../src/services/marketIntelligence/marketIntelligenceService';
import { buildContextPackageV2 } from '../src/lib/context/contextPackageV2';
import { issueEvidenceHandles } from '../src/services/growthBrainOutputGrounding';
import { persistRecommendations, decideRecommendation } from '../src/services/growthBrainDecisionService';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';
import { storeSubjectKey, type LifecycleState } from '../src/services/marketIntelligence/contract';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RUN = `${Date.now()}-${process.pid}`;
const F = uuidFrom(`hp-f-${RUN}`), WS = uuidFrom(`hp-ws-${RUN}`), P = uuidFrom(`hp-p-${RUN}`);
const S = uuidFrom(`hp-s-${RUN}`);
const RIVAL_URL = 'https://apps.apple.com/us/app/rival/id700000001';
const RIVAL = storeSubjectKey('app_store', 'us', 'id700000001');

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

const listing = () => ({
  provider: 'app_store', storefront: 'us', providerId: 'id700000001',
  sourceRef: RIVAL_URL, name: 'Rival', developer: 'RivalCo, Inc.',
  summary: 'Book a trusted local pro in minutes.', category: 'productivity',
  rating: 4.4, ratingCount: 12000, free: true,
  updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  releasedAt: '2020-01-01T00:00:00.000Z', retrievedAt: new Date().toISOString(),
});

/** A recommendation whose provenance is a market handle, as production builds it. */
function recWith(label: string): GrowthBrainRecommendation {
  return {
    type: 'RECOMMENDATION', actionType: 'RESEARCH',
    what: `Compare positioning against Rival ${RUN}`,
    whyNow: 'The competitor listing is strong', nextStep: 'Rewrite the subtitle',
    supportedBy: [{
      kind: 'MARKET_INTELLIGENCE', label, authority: 'VERIFIED_EXTERNAL',
      memoryClass: null, evidenceCount: null,
      detail: 'App Store listing, observed 2026-08-10',
    }],
    supporting: [], founderConflict: null, requiresFounderReview: false,
    expectedEffect: null, requiresApproval: false,
    evidenceStrength: 'some evidence', confidence: null,
  } as GrowthBrainRecommendation;
}

const noticeOf = (r: { supportedBy?: unknown }) =>
  (r.supportedBy as Array<{ currentLifecycleNotice?: string }>)[0]?.currentLifecycleNotice;

d('Phase 3.4C case G — historical lifecycle disclosure', () => {
  let marketLabel = '';

  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: `hp-${RUN}@lab.invalid`, name: 'HP LAB', plan: 'studio' }, { onConflict: 'id' }));
    await must('workspaces', db().from('workspaces').upsert(
      { id: WS, founder_id: F, name: `HP WS ${RUN}` }, { onConflict: 'id' }));
    await must('products', db().from('products').upsert({
      id: P, founder_id: F, workspace_id: WS, name: 'Mine',
      store_url: 'https://apps.apple.com/us/app/mine/id700000009', platform: 'app_store',
      category: 'productivity', markets: ['usa'],
      competitor_set: [{ name: 'Rival', storeUrl: RIVAL_URL }],
    }, { onConflict: 'id' }));
    await must('session', db().from('onboarding_sessions').upsert(
      { id: S, founder_id: F, current_state: 'PHASE_1_COMPLETE', product_id: P }, { onConflict: 'id' }));
    await must('competitor', db().from('competitor_relationships').upsert({
      id: uuidFrom(`hp-c-${RUN}`), founder_id: F, product_id: P, session_id: S,
      name: 'Rival', relationship: 'CONFIRMED', key_differentiator: 'cheaper',
    }, { onConflict: 'id' }));

    process.env.MARKET_INTELLIGENCE_MODE = 'ACTIVE';
    await ingestStoreListing(listing());

    // The label a REAL package produces — not a guess, so the annotator's match
    // is exercised against production wording.
    const pkg = await buildContextPackageV2({
      workspaceId: WS, founderId: F, productId: P, intent: 'MORNING_BRIEF',
      query: 'q', persist: false,
    });
    const h = issueEvidenceHandles(pkg).find(x => x.kind === 'MARKET_INTELLIGENCE');
    marketLabel = h?.label ?? '';
    expect(marketLabel, 'no market handle issued — every case would be vacuous').not.toBe('');
  }, 180_000);

  afterAll(async () => {
    await db().from('market_intelligence_resolutions').delete().eq('workspace_id', WS);
    await db().from('market_intelligence_source_records').delete().eq('subject_key', RIVAL);
    await db().from('growth_brain_recommendations').delete().eq('workspace_id', WS);
    await db().from('competitor_relationships').delete().eq('product_id', P);
    await db().from('onboarding_sessions').delete().eq('id', S);
    await db().from('products').delete().eq('id', P);
    await db().from('workspaces').delete().eq('id', WS);
    await db().from('founders').delete().eq('id', F);
    delete process.env.MARKET_INTELLIGENCE_MODE;
  });

  const setState = async (state: LifecycleState) => {
    const { data } = await db().from('market_intelligence_source_records')
      .select('id').eq('subject_key', RIVAL);
    for (const row of (data ?? []) as Array<{ id: string }>) {
      await setSourceLifecycle(row.id, state, { reason: 'case G' });
    }
  };

  it('A — an ACTIVE source shows normal provenance and NO notice', async () => {
    await setState('ACTIVE');
    const [out] = await annotateHistoricalProvenance(P, [recWith(marketLabel)]);
    expect(noticeOf(out)).toBeUndefined();
    // The entry itself is otherwise untouched.
    const entry = (out.supportedBy as Array<Record<string, unknown>>)[0];
    expect(entry.label).toBe(marketLabel);
    expect(entry.detail).toBe('App Store listing, observed 2026-08-10');
  }, 120_000);

  it('B/HISTORICAL_IMMUTABILITY — retraction does not touch the persisted snapshot', async () => {
    await setState('ACTIVE');
    const [row] = await persistRecommendations(
      { workspaceId: WS, founderId: F, productId: P }, [recWith(marketLabel)]);
    await decideRecommendation({ workspaceId: WS, founderId: F, productId: P }, row.id, 'APPROVE');

    const before = await db().from('growth_brain_recommendations')
      .select('what, why_now, next_step, supported_by, supporting, fingerprint, action_key, decision_status, execution_status')
      .eq('id', row.id).single();

    await setState('RETRACTED');

    const after = await db().from('growth_brain_recommendations')
      .select('what, why_now, next_step, supported_by, supporting, fingerprint, action_key, decision_status, execution_status')
      .eq('id', row.id).single();

    expect(after.data).toEqual(before.data);
    expect((after.data as { decision_status: string }).decision_status).toBe('APPROVED');
  }, 180_000);

  it('C — a RETRACTED source is disclosed in plain language', async () => {
    await setState('RETRACTED');
    const [out] = await annotateHistoricalProvenance(P, [recWith(marketLabel)]);
    expect(noticeOf(out)).toBe('This source has since been retracted.');
  }, 120_000);

  it('D/E — a RETRACTED source issues no handle and creates no availability', async () => {
    await setState('RETRACTED');
    const pkg = await buildContextPackageV2({
      workspaceId: WS, founderId: F, productId: P, intent: 'MORNING_BRIEF',
      query: 'q', persist: false,
    });
    expect(pkg.marketEvidence).toEqual([]);
    expect(pkg.marketIntelligence.available).toBe(false);
    expect(issueEvidenceHandles(pkg).filter(h => h.kind === 'MARKET_INTELLIGENCE')).toHaveLength(0);
  }, 120_000);

  it('F/G — CORRECTED and UNAVAILABLE reuse the same mechanism', async () => {
    await setState('CORRECTED');
    expect(noticeOf((await annotateHistoricalProvenance(P, [recWith(marketLabel)]))[0]))
      .toBe('This source has since been corrected.');
    await setState('UNAVAILABLE');
    expect(noticeOf((await annotateHistoricalProvenance(P, [recWith(marketLabel)]))[0]))
      .toBe('This source is no longer available.');
  }, 120_000);

  it('H — an unresolvable source is reported honestly, never as ACTIVE', async () => {
    await setState('ACTIVE');
    // A provenance entry naming an entity this product has no record for.
    const [out] = await annotateHistoricalProvenance(P, [recWith('Ghost — App Store observation')]);
    expect(noticeOf(out)).toBe(UNKNOWN_SOURCE_NOTICE);
    expect(noticeOf(out)).not.toBeUndefined();

    // And a product with no subjects at all cannot silently look healthy.
    const [none] = await annotateHistoricalProvenance(null, [recWith(marketLabel)]);
    expect(noticeOf(none)).toBeUndefined();   // no product ⇒ nothing claimed either way
  }, 120_000);

  it('I — the annotation exposes no internal identifier', async () => {
    await setState('RETRACTED');
    const [out] = await annotateHistoricalProvenance(P, [recWith(marketLabel)]);
    const raw = JSON.stringify(out);
    for (const leak of ['RETRACTED', 'subject_key', 'source_record_id', 'lifecycle_state',
                        'app_store:us:', 'authority_policy_version', 'content_hash']) {
      expect(raw, `leaked ${leak}`).not.toContain(leak);
    }
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  }, 120_000);

  it('J — non-market provenance is returned byte-identical', async () => {
    await setState('RETRACTED');
    const rec = {
      supportedBy: [
        { kind: 'FOUNDER_DIRECTION', label: 'Your confirmed direction', detail: 'You told LaunchMind this' },
        { kind: 'MARKETING_MEMORY', label: 'Trust badges lift bookings', detail: null },
        { kind: 'CAMPAIGN_PERFORMANCE', label: 'Your campaign performance', detail: '2 metric week(s)' },
      ],
    };
    const [out] = await annotateHistoricalProvenance(P, [rec]);
    expect(out).toEqual(rec);
  }, 120_000);
});
