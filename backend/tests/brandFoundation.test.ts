/**
 * @file brandFoundation.test.ts
 * @description Phase 3.5B1 acceptance matrix A–V.
 *
 *   Runs against MemoryDb, which honours query predicates — so an isolation test
 *   fails if a service forgets its workspace or product filter, rather than
 *   passing because the stub ignored the argument.
 *
 *   No Docker required: the rights and precedence rules are pure functions, and
 *   the services are exercised against the in-memory database. The SQL CHECKs in
 *   migration 116 assert the same cases independently and are listed in the
 *   report as WRITTEN-NOT-APPLIED.
 *
 * @security No network, no real database, no execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { MemoryDb } from './helpers/memoryDb';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const PROD_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PROD_A2 = 'aaaaaaaa-2222-4222-8222-222222222222';   // sibling in WS_A
const PROD_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const FOUNDER = 'ffffffff-1111-4111-8111-111111111111';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db,
}));

const asset = (over: Record<string, unknown> = {}) => ({
  id: `asset-${Math.abs(JSON.stringify(over).length)}-${Object.keys(over).join('')}`,
  workspace_id: WS_A, product_id: PROD_A, founder_id: FOUNDER,
  asset_type: 'SCREENSHOT', source: 'APP_STORE', subject_relation: 'OWN_PRODUCT',
  authorization_state: 'OBSERVED_EXTERNAL', storage_path: 'p/1.png',
  external_url: null, rights_basis: null, may_contain_pii: true,
  archived_at: null, ...over,
});

const product = (id: string, ws: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: ws, founder_id: FOUNDER,
  brand_voice_profile: {}, website_meta: {}, scraped_meta: {}, content_preferences: {},
  ...over,
});

beforeEach(() => {
  db = new MemoryDb({
    products: [
      product(PROD_A, WS_A, { website_meta: { logoUrl: 'https://a.example/logo.png' } }),
      product(PROD_A2, WS_A, { website_meta: { logoUrl: 'https://a2.example/logo.png' } }),
      product(PROD_B, WS_B, { website_meta: { logoUrl: 'https://b.example/logo.png' } }),
    ],
    brand_kits: [], brand_kit_fields: [], brand_kit_field_history: [],
    marketing_assets: [],
  });
  (globalThis as { __db: MemoryDb }).__db = db;
});

// ── Brand precedence (pure) ────────────────────────────────────────────────
describe('brand field precedence — representation, not evidence authority', () => {
  it('D — owner-confirmed overrides inferred and scraped', async () => {
    const { resolveBrandField } = await import('../src/services/brand/brandFieldPolicy');
    const r = resolveBrandField([
      { fieldKey: 'primary_color', value: '#000', provenance: 'SCRAPED' },
      { fieldKey: 'primary_color', value: '#111', provenance: 'INFERRED' },
      { fieldKey: 'primary_color', value: '#0b8f69', provenance: 'OWNER_CONFIRMED' },
    ])!;
    expect(r.value).toBe('#0b8f69');
    expect(r.ownerConfirmed).toBe(true);
    expect(r.supersededCount).toBe(2);
  });

  it('E — inferred beats scraped when no confirmation exists', async () => {
    const { resolveBrandField } = await import('../src/services/brand/brandFieldPolicy');
    expect(resolveBrandField([
      { fieldKey: 'tone', value: 'loud', provenance: 'SCRAPED' },
      { fieldKey: 'tone', value: 'plain', provenance: 'INFERRED' },
    ])!.value).toBe('plain');
  });

  it('F — a scraped field never becomes founder-confirmed automatically', async () => {
    const { resolveBrandField, mayAssertAsBrandFact } =
      await import('../src/services/brand/brandFieldPolicy');
    const r = resolveBrandField([
      { fieldKey: 'tagline', value: 'The best CRM', provenance: 'SCRAPED', sourceLabel: 'your website' },
    ])!;
    expect(r.ownerConfirmed).toBe(false);
    expect(mayAssertAsBrandFact(r), 'a scraped tagline was assertable as fact').toBe(false);
  });

  it('an observed value is described honestly, never as confirmed', async () => {
    const { resolveBrandField, brandProvenanceLabel } =
      await import('../src/services/brand/brandFieldPolicy');
    const r = resolveBrandField([
      { fieldKey: 'tagline', value: 'x', provenance: 'SCRAPED', sourceLabel: 'your website' },
    ])!;
    expect(brandProvenanceLabel(r)).toMatch(/observed.*not yet confirmed/);
  });

  it('same provenance ties break by recency, never randomly', async () => {
    const { resolveBrandField } = await import('../src/services/brand/brandFieldPolicy');
    const r = resolveBrandField([
      { fieldKey: 'tone', value: 'old', provenance: 'SCRAPED', observedAt: '2026-01-01' },
      { fieldKey: 'tone', value: 'new', provenance: 'SCRAPED', observedAt: '2026-08-01' },
    ])!;
    expect(r.value).toBe('new');
  });
});

// ── Asset rights (pure) ────────────────────────────────────────────────────
describe('marketing asset rights', () => {
  const P = async () => import('../src/services/brand/marketingAssetPolicy');

  it('G — a scraped external image is OBSERVED only', async () => {
    const { isEligibleForPurpose } = await P();
    const a = { id: '1', workspaceId: WS_A, productId: PROD_A, assetType: 'SCREENSHOT',
      source: 'APP_STORE', subjectRelation: 'OWN_PRODUCT',
      authorizationState: 'OBSERVED_EXTERNAL' } as never;
    expect(isEligibleForPurpose(a, 'PRODUCT_CONTEXT_DISPLAY').eligible).toBe(true);
    expect(isEligibleForPurpose(a, 'CONTENT_CREATION')).toEqual(
      { eligible: false, reason: 'NOT_AUTHORIZED_FOR_MARKETING' });
  });

  it('K — a competitor screenshot is never creative input', async () => {
    const { isEligibleForPurpose } = await P();
    const a = { id: '1', workspaceId: WS_A, productId: PROD_A, assetType: 'SCREENSHOT',
      source: 'APP_STORE', subjectRelation: 'COMPETITOR',
      authorizationState: 'AUTHORIZED_MARKETING', mayContainPii: false } as never;
    expect(isEligibleForPurpose(a, 'CONTENT_CREATION').reason).toBe('SUBJECT_IS_NOT_OWN_PRODUCT');
  });

  it('M — a web-search image can never be authorised, whatever else is set', async () => {
    const { isEligibleForPurpose } = await P();
    const a = { id: '1', workspaceId: WS_A, productId: PROD_A, assetType: 'OTHER',
      source: 'WEB_SEARCH', subjectRelation: 'OWN_PRODUCT',
      authorizationState: 'AUTHORIZED_MARKETING', mayContainPii: false } as never;
    expect(isEligibleForPurpose(a, 'CONTENT_CREATION').reason).toBe('SOURCE_CANNOT_CONFER_RIGHTS');
  });

  it('L — an authorised product-owned screenshot is usable', async () => {
    const { isEligibleForPurpose } = await P();
    const a = { id: '1', workspaceId: WS_A, productId: PROD_A, assetType: 'SCREENSHOT',
      source: 'APP_STORE', subjectRelation: 'OWN_PRODUCT',
      authorizationState: 'AUTHORIZED_MARKETING', mayContainPii: false } as never;
    expect(isEligibleForPurpose(a, 'CONTENT_CREATION').eligible).toBe(true);
    expect(isEligibleForPurpose(a, 'VISUAL_RENDERING').eligible).toBe(true);
  });

  it('visual PII — an unexamined image is refused for rendering', async () => {
    const { isEligibleForPurpose } = await P();
    const a = { id: '1', workspaceId: WS_A, productId: PROD_A, assetType: 'SCREENSHOT',
      source: 'OWNER_UPLOAD', subjectRelation: 'OWN_PRODUCT',
      authorizationState: 'AUTHORIZED_MARKETING', mayContainPii: true } as never;
    expect(isEligibleForPurpose(a, 'CONTENT_CREATION').eligible).toBe(true);
    expect(isEligibleForPurpose(a, 'VISUAL_RENDERING').reason).toBe('MAY_CONTAIN_PERSONAL_DATA');
  });
});

describe('governed product UI extraction', () => {
  it('preserves only the requested source pixels and records a deterministic crop', async () => {
    const { deriveCleanProductUiCrop } = await import('../src/services/brand/productAssetIntake');
    const source = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from('<svg width="400" height="500"><rect width="400" height="500" fill="#4f5dff"/></svg>'), left: 500, top: 120 }])
      .png().toBuffer();
    const result = await deriveCleanProductUiCrop(source, { left: 500, top: 120, width: 400, height: 500 });
    expect(result.crop).toEqual({ left: 500, top: 120, width: 400, height: 500 });
    expect(result.sourceWidth).toBe(1000);
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 400, height: 500 });
  });

  it('refuses a crop that would silently include unknown source pixels', async () => {
    const { deriveCleanProductUiCrop } = await import('../src/services/brand/productAssetIntake');
    const source = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(deriveCleanProductUiCrop(source, { left: 300, top: 100, width: 320, height: 400 }))
      .rejects.toThrow(/outside/i);
  });
});

// ── Resolver + isolation (MemoryDb) ────────────────────────────────────────
describe('asset resolver and isolation', () => {
  it('H — observed assets are excluded from CONTENT_CREATION', async () => {
    db.setRows('marketing_assets', [
      asset({ id: 'obs', authorization_state: 'OBSERVED_EXTERNAL' }),
      asset({ id: 'auth', authorization_state: 'AUTHORIZED_MARKETING',
        rights_basis: 'our own listing', may_contain_pii: false }),
    ]);
    const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
    const out = await resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION');
    expect(out.map(a => a.id)).toEqual(['auth']);
  });

  it('J — a Storage path alone grants nothing', async () => {
    // The asset exists, is stored in our own bucket, and its path is known.
    db.setRows('marketing_assets', [asset({ id: 'stored', storage_path: 'workspace/known/path.png' })]);
    const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
    expect(await resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION')).toHaveLength(0);
    // …and it is still available for showing the owner their own product.
    expect(await resolveMarketingAssets(WS_A, PROD_A, 'PRODUCT_CONTEXT_DISPLAY')).toHaveLength(1);
  });

  it('B/S — Product B and Workspace B assets never resolve for Product A', async () => {
    db.setRows('marketing_assets', [
      asset({ id: 'a', authorization_state: 'AUTHORIZED_MARKETING', rights_basis: 'r', may_contain_pii: false }),
      asset({ id: 'b', workspace_id: WS_B, product_id: PROD_B,
        authorization_state: 'AUTHORIZED_MARKETING', rights_basis: 'r', may_contain_pii: false }),
    ]);
    const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
    expect((await resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION')).map(a => a.id)).toEqual(['a']);
    expect((await resolveMarketingAssets(WS_B, PROD_B, 'CONTENT_CREATION')).map(a => a.id)).toEqual(['b']);
  });

  it('C — sibling products in ONE workspace stay isolated', async () => {
    db.setRows('marketing_assets', [
      asset({ id: 'a1', product_id: PROD_A, authorization_state: 'AUTHORIZED_MARKETING',
        rights_basis: 'r', may_contain_pii: false }),
      asset({ id: 'a2', product_id: PROD_A2, authorization_state: 'AUTHORIZED_MARKETING',
        rights_basis: 'r', may_contain_pii: false }),
    ]);
    const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
    expect((await resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION')).map(a => a.id)).toEqual(['a1']);
  });

  it('I — an owner upload can be authorised and then used', async () => {
    db.setRows('marketing_assets', [asset({ id: 'up', source: 'OWNER_UPLOAD' })]);
    const svc = await import('../src/services/brand/marketingAssetService');
    await svc.authorizeAsset({ assetId: 'up', workspaceId: WS_A, actorId: FOUNDER,
      rightsBasis: 'we created this image', subjectRelation: 'OWN_PRODUCT', piiChecked: true });
    expect((await svc.resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION')).map(a => a.id))
      .toEqual(['up']);
  });

  it('authorisation refuses web-search and non-own subjects, with a reason', async () => {
    db.setRows('marketing_assets', [
      asset({ id: 'web', source: 'WEB_SEARCH' }),
      asset({ id: 'comp', subject_relation: 'COMPETITOR' }),
    ]);
    const svc = await import('../src/services/brand/marketingAssetService');
    await expect(svc.authorizeAsset({ assetId: 'web', workspaceId: WS_A, actorId: FOUNDER,
      rightsBasis: 'found it online' })).rejects.toThrow(/web search/i);
    await expect(svc.authorizeAsset({ assetId: 'comp', workspaceId: WS_A, actorId: FOUNDER,
      rightsBasis: 'looks fine' })).rejects.toThrow(/your own product/i);
  });

  it('M10 — cross-workspace authorisation is refused as not-found', async () => {
    db.setRows('marketing_assets', [asset({ id: 'a' })]);
    const svc = await import('../src/services/brand/marketingAssetService');
    await expect(svc.authorizeAsset({ assetId: 'a', workspaceId: WS_B, actorId: FOUNDER,
      rightsBasis: 'ours really' })).rejects.toThrow(/Not found/);
  });

  it('M10 — workspace scope is enforced even for the SAME product id', async () => {
    // The earlier isolation test varied product AND workspace together, so
    // dropping the workspace predicate still passed. Same product id, two
    // workspaces, is the case that actually proves the filter.
    db.setRows('marketing_assets', [
      asset({ id: 'ws-a', workspace_id: WS_A, product_id: PROD_A,
        authorization_state: 'AUTHORIZED_MARKETING', rights_basis: 'r', may_contain_pii: false }),
      asset({ id: 'ws-b', workspace_id: WS_B, product_id: PROD_A,
        authorization_state: 'AUTHORIZED_MARKETING', rights_basis: 'r', may_contain_pii: false }),
    ]);
    const { resolveMarketingAssets } = await import('../src/services/brand/marketingAssetService');
    expect((await resolveMarketingAssets(WS_A, PROD_A, 'CONTENT_CREATION')).map(a => a.id))
      .toEqual(['ws-a']);
  });

  it('an ingestion path cannot mint an authorised asset', async () => {
    const svc = await import('../src/services/brand/marketingAssetService');
    await svc.recordObservedAsset({ workspaceId: WS_A, productId: PROD_A, founderId: FOUNDER,
      assetType: 'SCREENSHOT', source: 'WEB_SEARCH' });
    expect(db.rows('marketing_assets')[0].authorization_state).toBe('OBSERVED_EXTERNAL');
    expect(db.rows('marketing_assets')[0].may_contain_pii).toBe(true);
  });
});

// ── Brand kit resolution and confirmation (MemoryDb) ───────────────────────
describe('brand kit', () => {
  it('A — Product A resolves its own kit from its own sources', async () => {
    const { resolveBrandKit } = await import('../src/services/brand/brandKitService');
    const kit = await resolveBrandKit(WS_A, PROD_A);
    expect(kit.fields.logo?.value).toBe('https://a.example/logo.png');
    expect(kit.fields.logo?.ownerConfirmed).toBe(false);
  });

  it('B/T — Product A never receives Product B brand values', async () => {
    const { resolveBrandKit } = await import('../src/services/brand/brandKitService');
    const a = await resolveBrandKit(WS_A, PROD_A);
    const b = await resolveBrandKit(WS_B, PROD_B);
    expect(a.fields.logo?.value).not.toBe(b.fields.logo?.value);
    expect(String(a.fields.logo?.value)).toContain('a.example');
  });

  it('C — sibling products resolve different logos', async () => {
    const { resolveBrandKit } = await import('../src/services/brand/brandKitService');
    expect(String((await resolveBrandKit(WS_A, PROD_A)).fields.logo?.value)).toContain('a.example');
    expect(String((await resolveBrandKit(WS_A, PROD_A2)).fields.logo?.value)).toContain('a2.example');
  });

  it('N/Q — confirmation records an actor and preserves prior value in history', async () => {
    const svc = await import('../src/services/brand/brandKitService');
    const { kitVersion } = await svc.confirmBrandField({
      workspaceId: WS_A, productId: PROD_A, founderId: FOUNDER, actorId: FOUNDER,
      fieldKey: 'logo', value: 'https://a.example/confirmed.png',
    });
    expect(kitVersion).toBe(1);
    const field = db.rows('brand_kit_fields')[0];
    expect(field.provenance).toBe('OWNER_CONFIRMED');
    expect(field.confirmed_by).toBe(FOUNDER);
    // History exists so a later rebrand cannot erase what an artifact used.
    expect(db.rows('brand_kit_field_history')).toHaveLength(1);
    const kit = await svc.resolveBrandKit(WS_A, PROD_A);
    expect(kit.fields.logo?.ownerConfirmed).toBe(true);
    expect(kit.fields.logo?.value).toBe('https://a.example/confirmed.png');
  });

  it('confirming nothing is refused', async () => {
    const svc = await import('../src/services/brand/brandKitService');
    await expect(svc.confirmBrandField({ workspaceId: WS_A, productId: PROD_A,
      founderId: FOUNDER, actorId: FOUNDER, fieldKey: 'logo', value: '' }))
      .rejects.toThrow(/value is required/i);
  });

  it('O — a missing logo stays missing; nothing is fabricated', async () => {
    db.setRows('products', [product(PROD_A, WS_A)]);
    const { resolveBrandKit } = await import('../src/services/brand/brandKitService');
    const kit = await resolveBrandKit(WS_A, PROD_A);
    expect(kit.fields.logo).toBeUndefined();
    expect(kit.missing).toContain('logo');
  });
});

// ── Prohibited terminology (pure) ──────────────────────────────────────────
describe('P — prohibited terminology is deterministic, not a prompt request', () => {
  const V = async () => import('../src/services/brand/prohibitedTerminology');

  it('detects a banned word in any generated field', async () => {
    const { validateTerminology } = await V();
    const r = validateTerminology(
      [{ name: 'headline', text: 'A revolutionary way to plan' }], ['revolutionary']);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ term: 'revolutionary', field: 'headline' });
  });

  it('matches on word boundaries, not substrings', async () => {
    const { validateTerminology } = await V();
    expect(validateTerminology([{ name: 'h', text: 'we are evolutionary' }], ['revolution']).ok).toBe(true);
    expect(validateTerminology([{ name: 'h', text: 'a Revolution now' }], ['revolution']).ok).toBe(false);
  });

  it('reports every violation, not just the first', async () => {
    const { validateTerminology } = await V();
    const r = validateTerminology(
      [{ name: 'h', text: 'revolutionary' }, { name: 'd', text: 'game-changing' }],
      ['revolutionary', 'game-changing']);
    expect(r.violations).toHaveLength(2);
  });

  it('an empty term list matches nothing rather than everything', async () => {
    const { validateTerminology } = await V();
    expect(validateTerminology([{ name: 'h', text: 'anything' }], ['', '  ']).ok).toBe(true);
  });
});

// ── Brand → generation behaviour ───────────────────────────────────────────
describe('brand constraints reaching generation', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    workspaceId: WS_A, productId: PROD_A,
    application: { name: 'X', category: null, markets: [], description: null },
    brand: { productId: PROD_A, workspaceId: WS_A, version: 3, fields: {}, missing: [] },
    prohibitedTerms: [], founderDirection: { audienceConfirmed: null, contextDelta: null,
      primaryGoal: null, competitors: [] },
    evidence: [], authorizedAssets: [], observedAssetCount: 0,
    marketIntelligenceAvailable: false, brandProvenance: [], unavailable: [],
    ...over,
  }) as never;

  it('A(18) — a confirmed brand voice becomes a directive', async () => {
    const { brandConstraints } = await import('../src/services/content/brandGovernedGeneration');
    const out = brandConstraints(ctx({ brand: { productId: PROD_A, workspaceId: WS_A, version: 1,
      missing: [], fields: { brand_voice: { fieldKey: 'brand_voice', value: 'direct, plain language',
        provenance: 'OWNER_CONFIRMED', sourceLabel: null, ownerConfirmed: true, supersededCount: 0 } } } }));
    expect(out.join(' ')).toContain('Write in this brand voice: direct, plain language');
  });

  it('B(18) — an unconfirmed voice is offered as observed, never as a directive', async () => {
    const { brandConstraints } = await import('../src/services/content/brandGovernedGeneration');
    const out = brandConstraints(ctx({ brand: { productId: PROD_A, workspaceId: WS_A, version: 1,
      missing: [], fields: { brand_voice: { fieldKey: 'brand_voice', value: 'loud and bold',
        provenance: 'SCRAPED', sourceLabel: 'your website', ownerConfirmed: false, supersededCount: 0 } } } }));
    expect(out.join(' ')).toContain('Observed brand voice (not confirmed)');
    expect(out.join(' ')).not.toContain('Write in this brand voice');
  });

  it('an observed tagline is never presented as approved', async () => {
    const { brandConstraints } = await import('../src/services/content/brandGovernedGeneration');
    const out = brandConstraints(ctx({ brand: { productId: PROD_A, workspaceId: WS_A, version: 1,
      missing: [], fields: { tagline: { fieldKey: 'tagline', value: 'The best CRM',
        provenance: 'SCRAPED', sourceLabel: 'your website', ownerConfirmed: false, supersededCount: 0 } } } }));
    expect(out.join(' ')).toContain('not approved, do not quote as official');
  });

  it('prohibited terms reach the prompt AND remain enforced afterwards', async () => {
    const { brandConstraints } = await import('../src/services/content/brandGovernedGeneration');
    expect(brandConstraints(ctx({ prohibitedTerms: ['revolutionary'] })).join(' '))
      .toContain('Never use the word or phrase: revolutionary');
  });

  it('C(18)/M7 — a prohibited term in generated copy BLOCKS the artifact', async () => {
    // The prompt asks; the validator decides. This drives the real wrapper, so
    // removing the post-generation check cannot pass unnoticed.
    const { generateBrandGovernedContent } =
      await import('../src/services/content/brandGovernedGeneration');
    const silent = async () => ({ byField: new Map(), artifactClaims: [],
      unresolvedFields: [], unverifiable: false, failureReason: null });
    const out = await generateBrandGovernedContent(
      ctx({ prohibitedTerms: ['revolutionary'] }),
      {
        channel: 'meta_ads',
        brief: { objective: 'o', audience: 'a', keyMessage: 'k' },
        founderId: 'system',
        semantic: silent as never,
        generate: async () => JSON.stringify({
          content: { primaryText: 'A calmer way to work.', headline: 'A revolutionary plan' },
          declaredClaims: [],
        }),
      } as never);
    expect(out.terminology.ok).toBe(false);
    expect(out.eligible, 'a prohibited term did not block the artifact').toBe(false);
    expect(out.blockedReasons.join(' ')).toContain('prohibited term "revolutionary"');
    expect(out.brandKitVersion).toBe(3);
  });

  it('clean copy under the same constraints stays eligible', async () => {
    const { generateBrandGovernedContent } =
      await import('../src/services/content/brandGovernedGeneration');
    const silent = async () => ({ byField: new Map(), artifactClaims: [],
      unresolvedFields: [], unverifiable: false, failureReason: null });
    const out = await generateBrandGovernedContent(
      ctx({ prohibitedTerms: ['revolutionary'] }),
      {
        channel: 'meta_ads',
        brief: { objective: 'o', audience: 'a', keyMessage: 'k' },
        founderId: 'system',
        semantic: silent as never,
        generate: async () => JSON.stringify({
          content: { primaryText: 'A calmer way to work.', headline: 'Marketing, less scattered' },
          declaredClaims: [],
        }),
      } as never);
    expect(out.terminology.ok).toBe(true);
    expect(out.eligible).toBe(true);
  });

  it('no authorised imagery is stated, so the model does not invent screenshots', async () => {
    const { brandConstraints } = await import('../src/services/content/brandGovernedGeneration');
    expect(brandConstraints(ctx()).join(' ')).toContain('No authorised product imagery');
  });
});

// ── Boundaries, history and remediation (structural) ───────────────────────
describe('boundaries the code must not cross', () => {
  const read = async (rel: string) => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    return readFileSync(join(__dirname, '..', rel), 'utf8');
  };
  const code = (src: string) => src.split('\n')
    .filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n');

  it('R — Market Intelligence cannot rewrite Brand Kit', async () => {
    // Structural, because the tempting shortcut is "competitors use purple, so
    // make the brand purple". MI informs message and positioning; it has no
    // path to brand identity at all.
    for (const f of ['src/services/brand/brandKitService.ts',
                     'src/services/brand/brandFieldPolicy.ts']) {
      const src = code(await read(f));
      for (const forbidden of ['marketIntelligence', 'market_intelligence',
                               'marketEvidence', 'competitor_set']) {
        expect(src, `${f} reaches Market Intelligence`).not.toContain(forbidden);
      }
    }
  });

  it('brand precedence never touches evidence authority', async () => {
    const src = code(await read('src/services/brand/brandFieldPolicy.ts'));
    for (const forbidden of ['authorityPolicy', 'FOUNDER_ASSERTED', 'mayAutoOverride',
                             'AuthorityTier', 'evidenceSupportPolicy']) {
      expect(src, `brand precedence leaked into evidence authority (${forbidden})`)
        .not.toContain(forbidden);
    }
  });

  it('U/V — brand modules cannot mutate memory, publish, launch or spend', async () => {
    for (const f of ['src/services/brand/brandKitService.ts',
                     'src/services/brand/marketingAssetService.ts',
                     'src/services/brand/marketingAssetPolicy.ts',
                     'src/services/brand/prohibitedTerminology.ts',
                     'src/services/content/productContentContext.ts']) {
      const src = code(await read(f));
      for (const forbidden of ['marketing_memories', 'marketing_memory_versions',
                               'publishing_targets', 'campaigns', 'spend_cap',
                               'approved_at', 'launched_at']) {
        expect(src, `${f} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('SCRAPED-ASSET REMEDIATION — content generation no longer reads the JSONB array', async () => {
    const src = code(await read('src/services/contentService.ts'));
    expect(src, 'contentService still reads scraped_meta.marketingImages')
      .not.toContain('scrapedMeta?.marketingImages');
    expect(src, 'contentService does not use the authorisation-aware resolver')
      .toContain('resolveMarketingAssets');
    expect(src).toContain("'VISUAL_RENDERING'");
  });

  it('Q — artifacts can record the brand version they were built with', async () => {
    const src = await read('migrations/20260818_000116_brand_kit_marketing_assets.sql');
    expect(src).toContain('brand_kit_version');
    // History is append-only, so a rebrand cannot erase the prior value.
    expect(src).toContain('REVOKE UPDATE, DELETE ON brand_kit_field_history');
  });

  it('the migration makes the three dangerous states unrepresentable', async () => {
    const src = await read('migrations/20260818_000116_brand_kit_marketing_assets.sql');
    expect(src).toContain('marketing_asset_authorized_has_actor');
    expect(src).toContain('marketing_asset_web_search_never_authorized');
    expect(src).toContain('marketing_asset_subject_must_be_own');
    expect(src).toContain('brand_field_confirmed_has_actor');
  });

  it('the frozen claim contract is not imported into brand modules', async () => {
    for (const f of ['src/services/brand/brandKitService.ts',
                     'src/services/brand/marketingAssetService.ts']) {
      const src = code(await read(f));
      for (const frozen of ['copyClaimClassifier', 'semanticClaimClassifier',
                            'hybridClaimDetection', 'threeSignalClaimDiscovery',
                            'generatorClaimDeclaration', 'contentClaimPolicy']) {
        expect(src, `${f} imports frozen ${frozen}`).not.toContain(frozen);
      }
    }
  });
});
