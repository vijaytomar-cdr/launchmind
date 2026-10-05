/**
 * @file creativeApprovalLifecycle.test.ts
 * @description Behavioural proof for creative approval, versioning and
 *   lifecycle — B6A §32, §35, §36, §37.
 *
 *   The structural tests in creativeGovernance prove the SHAPES are right. These
 *   prove the BEHAVIOUR is right, which is where approval bugs actually live: an
 *   inherited tick, a rewritten brand history, a revoked asset quietly reused.
 *
 *   Runs against MemoryDb, which honours query predicates — a version of this
 *   suite on a stub that ignores `.eq()` would pass even if the service forgot
 *   its workspace filter entirely.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MemoryDb } from './helpers/memoryDb';

let db: MemoryDb;
// MemoryDb models tables, not object storage. A minimal storage stub keeps the
// subject under test honest: the service must build the owner-visible URL from
// OUR stored path, and this stub would produce nothing from a provider URL.
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => Object.assign(db.asClient(), {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
      }),
    },
  }),
}));

import { listCreativeRenders, approveCreative, CreativeApprovalError }
  from '../src/services/creative/creativeApprovalService';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PROD = '33333333-3333-4333-8333-333333333333';
const ART = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';

/** Seeds one successful render and its stored output. */
async function seedRender(opts: {
  id: string; version: number; brandVersion: number; workspaceId?: string;
  concept?: string; createdAt: string;
  qualityOutcome?: 'READY_FOR_OWNER_REVIEW' | 'NEEDS_CREATIVE_REVISION';
}): Promise<string> {
  const assetId = `asset-${opts.id}`;
  db.setRows('marketing_assets', [...db.rows('marketing_assets'), {
    id: assetId, workspace_id: opts.workspaceId ?? WS, product_id: PROD,
    source: 'GENERATED', authorization_state: 'OBSERVED_EXTERNAL',
    storage_path: `p/${opts.id}.png`, width_px: 1024, height_px: 1024,
    content_asset_id: ART, content_version_number: opts.version,
    generation_provenance: { lines: ['Rendered with: LaunchMind creative rendering'], notes: [],
      ...(opts.qualityOutcome ? { creativeCritique: {
        outcome: opts.qualityOutcome, summary: opts.qualityOutcome === 'READY_FOR_OWNER_REVIEW'
          ? 'Ready for owner judgment.' : 'The concept did not survive the render clearly.' } } : {}) },
  }]);
  db.setRows('creative_render_jobs', [...db.rows('creative_render_jobs'), {
    id: opts.id, workspace_id: opts.workspaceId ?? WS, product_id: PROD,
    content_asset_id: ART, content_version_number: opts.version,
    brand_kit_version: opts.brandVersion, creative_kind: 'META_AD_VISUAL',
    concept_label: opts.concept ?? null, variant_label: null,
    status: 'SUCCEEDED', output_asset_id: assetId,
    failure_detail: null, created_at: opts.createdAt,
  }]);
  return assetId;
}

beforeEach(() => { db = new MemoryDb(); });

describe('§32 regenerating a visual does not inherit approval', () => {
  it('a newer render is not approved because an older one was', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    await approveCreative({ renderJobId: 'r1', workspaceId: WS, actorId: ACTOR });

    await seedRender({ id: 'r2', version: 1, brandVersion: 3, createdAt: '2026-08-19T11:00:00Z' });

    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    const r1 = views.find(v => v.renderJobId === 'r1')!;
    const r2 = views.find(v => v.renderJobId === 'r2')!;

    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(false);
    // The newer one is what the owner is looking at.
    expect(r2.isCurrent).toBe(true);
    expect(r1.isCurrent).toBe(false);
    // And they are told the approval belongs to something older.
    expect(r2.approvedButSuperseded).toBe(true);
  });

  it('the earlier approval is not revoked — the owner really did approve it', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    await approveCreative({ renderJobId: 'r1', workspaceId: WS, actorId: ACTOR });
    await seedRender({ id: 'r2', version: 1, brandVersion: 3, createdAt: '2026-08-19T11:00:00Z' });

    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    expect(views.find(v => v.renderJobId === 'r1')!.approvedAt).not.toBeNull();
  });

  it('a duplicate approval is refused by the database, and the service says so', () => {
    // MemoryDb does not enforce UNIQUE, so asserting the behaviour here would
    // measure the harness. The constraint is proven structurally; what is
    // testable here is that the service TRANSLATES it rather than leaking it.
    const src = readFileSync(
      resolve(__dirname, '..', 'src/services/creative/creativeApprovalService.ts'), 'utf-8');
    expect(src).toMatch(/duplicate key\|unique/);
    expect(src).toContain('You already approved this visual.');
    expect(CreativeApprovalError).toBeDefined();
  });
});

describe('§30 a failed render cannot be approved', () => {
  it('refuses a job that produced no image', async () => {
    db.setRows('creative_render_jobs', [{
      id: 'rf', workspace_id: WS, product_id: PROD, content_asset_id: ART,
      content_version_number: 1, brand_kit_version: 3, creative_kind: 'META_AD_VISUAL',
      status: 'FAILED', output_asset_id: null, failure_detail: 'The image service is busy.',
      created_at: '2026-08-19T10:00:00Z', concept_label: null, variant_label: null,
    }]);
    await expect(approveCreative({ renderJobId: 'rf', workspaceId: WS, actorId: ACTOR }))
      .rejects.toThrow(/was not created/);
  });

  it('a failed render shows an owner-safe sentence and no image', async () => {
    db.setRows('creative_render_jobs', [{
      id: 'rf', workspace_id: WS, product_id: PROD, content_asset_id: ART,
      content_version_number: 1, brand_kit_version: 3, creative_kind: 'META_AD_VISUAL',
      status: 'FAILED', output_asset_id: null, failure_detail: 'The image service is busy.',
      created_at: '2026-08-19T10:00:00Z', concept_label: null, variant_label: null,
    }]);
    const v = (await listCreativeRenders({ contentAssetId: ART, workspaceId: WS }))[0];
    expect(v.imageUrl).toBeNull();
    expect(v.failureMessage).toBe('The image service is busy.');
    expect(v.failureMessage).not.toMatch(/replicate|http|Error:/i);
  });
});

describe('creative quality is distinct from governance eligibility', () => {
  it('refuses approval when the current critique requires creative revision', async () => {
    await seedRender({ id: 'rq', version: 1, brandVersion: 3,
      qualityOutcome: 'NEEDS_CREATIVE_REVISION', createdAt: '2026-08-19T10:00:00Z' });
    const view = (await listCreativeRenders({ contentAssetId: ART, workspaceId: WS }))[0];
    expect(view.qualityOutcome).toBe('NEEDS_CREATIVE_REVISION');
    expect(view.qualitySummary).toMatch(/did not survive/i);
    await expect(approveCreative({ renderJobId: 'rq', workspaceId: WS, actorId: ACTOR }))
      .rejects.toThrow(/still needs revision/i);
  });

  it('allows approval only after an explicit ready critique', async () => {
    await seedRender({ id: 'rr', version: 1, brandVersion: 3,
      qualityOutcome: 'READY_FOR_OWNER_REVIEW', createdAt: '2026-08-19T10:00:00Z' });
    await expect(approveCreative({ renderJobId: 'rr', workspaceId: WS, actorId: ACTOR }))
      .resolves.toMatchObject({ renderJobId: 'rr' });
  });
});

describe('§36 a brand change does not rewrite creative history', () => {
  it('an image rendered under v3 stays a v3 image after the kit becomes v4', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    const views = await listCreativeRenders({
      contentAssetId: ART, workspaceId: WS, currentBrandKitVersion: 4 });
    expect(views[0].brandKitVersion).toBe(3);
    // And the owner is told, rather than shown a silently stale image.
    expect(views[0].brandMovedOn).toBe(true);
  });

  it('an image rendered under the current brand is not flagged', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 4, createdAt: '2026-08-19T10:00:00Z' });
    const views = await listCreativeRenders({
      contentAssetId: ART, workspaceId: WS, currentBrandKitVersion: 4 });
    expect(views[0].brandMovedOn).toBe(false);
  });
});

describe('§35 currency is per content version', () => {
  it('a render for version 2 does not make a version 1 render stale', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    await seedRender({ id: 'r2', version: 2, brandVersion: 3, createdAt: '2026-08-19T11:00:00Z' });
    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    expect(views.find(v => v.renderJobId === 'r1')!.isCurrent).toBe(true);
    expect(views.find(v => v.renderJobId === 'r2')!.isCurrent).toBe(true);
  });
});

describe('§45 creative is product- and workspace-scoped', () => {
  it('another workspace cannot see or approve this creative', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    expect(await listCreativeRenders({ contentAssetId: ART, workspaceId: OTHER_WS })).toEqual([]);
    await expect(approveCreative({ renderJobId: 'r1', workspaceId: OTHER_WS, actorId: ACTOR }))
      // 404-shaped: a foreign job reads as absent, never as forbidden.
      .rejects.toThrow(/Not found/);
  });

  it('a render in another workspace never appears in this one', async () => {
    await seedRender({ id: 'rx', version: 1, brandVersion: 3,
      workspaceId: OTHER_WS, createdAt: '2026-08-19T10:00:00Z' });
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T11:00:00Z' });
    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    expect(views.map(v => v.renderJobId)).toEqual(['r1']);
  });
});

describe('§25 owner provenance carries no provider mechanics', () => {
  it('nothing in the view names a provider, model, prompt or id', async () => {
    await seedRender({ id: 'r1', version: 1, brandVersion: 3, createdAt: '2026-08-19T10:00:00Z' });
    const blob = JSON.stringify(await listCreativeRenders({ contentAssetId: ART, workspaceId: WS })).toLowerCase();
    for (const forbidden of ['replicate', 'flux', 'black-forest', 'prompt', 'seed',
                             'model_ref', 'provider_request', 'policy_version', 'authority']) {
      expect(blob, `owner view leaks "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

// ── §28/§29 presenter and voice changes make NEW creative ─────────────────
describe('§28 changing the presenter, §29 changing the voice', () => {
  /** Seeds one video render with the selections it was made with. */
  async function seedVideo(opts: {
    id: string; avatar: string; voice: string; createdAt: string; brandVersion?: number;
  }): Promise<void> {
    const assetId = `asset-${opts.id}`;
    db.setRows('marketing_assets', [...db.rows('marketing_assets'), {
      id: assetId, workspace_id: WS, product_id: PROD, source: 'GENERATED',
      authorization_state: 'OBSERVED_EXTERNAL', storage_path: `p/${opts.id}.mp4`,
      content_asset_id: ART, content_version_number: 1,
      generation_provenance: { lines: [`Presenter: ${opts.avatar}`], notes: [] },
    }]);
    db.setRows('creative_render_jobs', [...db.rows('creative_render_jobs'), {
      id: opts.id, workspace_id: WS, product_id: PROD, content_asset_id: ART,
      content_version_number: 1, brand_kit_version: opts.brandVersion ?? 3,
      creative_kind: 'SHORT_FORM_VIDEO', video_mode: 'AVATAR_SPOKESPERSON',
      concept_label: null, variant_label: null,
      avatar_selection: { providerAvatarId: opts.avatar, displayName: opts.avatar,
        presenterKind: 'SYNTHETIC_PRESENTER' },
      voice_selection: { providerVoiceId: opts.voice, displayName: opts.voice,
        kind: 'PROVIDER_STOCK' },
      status: 'SUCCEEDED', output_asset_id: assetId, failure_detail: null,
      created_at: opts.createdAt,
    }]);
  }

  it('a video made with presenter B does not inherit presenter A’s approval', async () => {
    await seedVideo({ id: 'vA', avatar: 'Avatar A', voice: 'Voice A', createdAt: '2026-08-19T10:00:00Z' });
    await approveCreative({ renderJobId: 'vA', workspaceId: WS, actorId: ACTOR });
    await seedVideo({ id: 'vB', avatar: 'Avatar B', voice: 'Voice A', createdAt: '2026-08-19T11:00:00Z' });

    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    expect(views.find(v => v.renderJobId === 'vA')!.approved).toBe(true);
    expect(views.find(v => v.renderJobId === 'vB')!.approved).toBe(false);
    expect(views.find(v => v.renderJobId === 'vB')!.approvedButSuperseded).toBe(true);
  });

  it('a video made with voice B does not inherit voice A’s approval', async () => {
    await seedVideo({ id: 'vA', avatar: 'Avatar A', voice: 'Voice A', createdAt: '2026-08-19T10:00:00Z' });
    await approveCreative({ renderJobId: 'vA', workspaceId: WS, actorId: ACTOR });
    await seedVideo({ id: 'vC', avatar: 'Avatar A', voice: 'Voice B', createdAt: '2026-08-19T12:00:00Z' });

    const views = await listCreativeRenders({ contentAssetId: ART, workspaceId: WS });
    expect(views.find(v => v.renderJobId === 'vC')!.approved).toBe(false);
  });

  it('the historical video stays attributable to what it was made with', async () => {
    await seedVideo({ id: 'vA', avatar: 'Avatar A', voice: 'Voice A',
      createdAt: '2026-08-19T10:00:00Z', brandVersion: 3 });
    await seedVideo({ id: 'vB', avatar: 'Avatar B', voice: 'Voice B',
      createdAt: '2026-08-19T11:00:00Z', brandVersion: 4 });

    const rows = db.rows('creative_render_jobs');
    const a = rows.find(r => r.id === 'vA') as Record<string, { providerAvatarId?: string }>;
    expect(a.avatar_selection?.providerAvatarId).toBe('Avatar A');
    expect((a as unknown as { brand_kit_version: number }).brand_kit_version).toBe(3);

    // §30 — a later brand version never rewrites an earlier video's identity.
    const views = await listCreativeRenders({
      contentAssetId: ART, workspaceId: WS, currentBrandKitVersion: 4 });
    expect(views.find(v => v.renderJobId === 'vA')!.brandKitVersion).toBe(3);
    expect(views.find(v => v.renderJobId === 'vA')!.brandMovedOn).toBe(true);
    expect(views.find(v => v.renderJobId === 'vB')!.brandMovedOn).toBe(false);
  });
});


describe('UX2.9 final-pixel critique remains authoritative', () => {
  it('does not replace a failed visual critique with a passing geometry check', async () => {
    const id=await seedRender({id:'pixel-rejected',version:1,brandVersion:3,
      qualityOutcome:'NEEDS_CREATIVE_REVISION',createdAt:'2026-09-04T10:00:00Z'});
    const {buildScenePlan}=await import('../src/services/creative/scenePlan');
    db.setRows('marketing_assets',db.rows('marketing_assets').map(row=>row.id===id?{
      ...row,generation_provenance:{...(row.generation_provenance as Record<string,unknown>),
        scenePlan:buildScenePlan({conceptLabel:'Problem recognition',channel:'META_AD'}),
        manifest:{layout:'PROBLEM_FRAME',screenshotComposited:true,overlayLines:[{}]}}}:row));
    const view=(await listCreativeRenders({contentAssetId:ART,workspaceId:WS}))[0];
    expect(view.qualityOutcome).toBe('NEEDS_CREATIVE_REVISION');
    await expect(approveCreative({renderJobId:'pixel-rejected',workspaceId:WS,actorId:ACTOR}))
      .rejects.toThrow(/still needs revision/i);
  });
});
