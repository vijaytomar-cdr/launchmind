/**
 * @file appStoreConnect.test.ts
 * @description Unit tests for the App Store Connect reference adapter.
 *
 *   Apple's HTTP responses are stubbed with realistic fixtures — that is the only
 *   way to test an external API deterministically, and it is different from what
 *   Step 1 removed: production code contains no fallback data, so every number the
 *   adapter emits here comes from a response body, exactly as it would from Apple.
 *
 *   The key generated below is a genuine EC P-256 key, so JWT signing is exercised
 *   for real rather than mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import { gzipSync } from 'zlib';
import { decodeProtectedHeader, decodeJwt, jwtVerify, importSPKI } from 'jose';

import {
  normalizePrivateKey,
  packAppleCredential,
  unpackAppleCredential,
  signAppleAssertion,
} from '../src/services/providers/appleJwt';
import { parseDelimited } from '../src/services/providers/appStoreConnectClient';
import { appStoreConnectAdapter } from '../src/services/providers/appStoreConnectAdapter';
import { ProviderError, type AdapterContext } from '../src/services/providers/types';
import { deriveAppStoreInsights } from '../src/services/connectionInsightService';

// A real EC P-256 keypair — Apple's .p8 keys are exactly this shape.
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
});

const ISSUER_ID = '69a6de70-1111-2222-3333-444455556666';
const KEY_ID    = 'ABCD123456';
const APP_ID    = '1234567890';

function ctx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    founderId:            'aaaa0000-0000-0000-0000-00000000000a',
    credential:           packAppleCredential({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey }),
    config:               {},
    selectedResourceId:   APP_ID,
    selectedResourceName: 'Test App',
    traceId:              'lm_00000000000000000000000000000001',
    ...overrides,
  };
}

// ── Apple response fixtures ───────────────────────────────────────────────────

const APPS_RESPONSE = {
  data: [
    { id: APP_ID,      type: 'apps', attributes: { name: 'Test App',   bundleId: 'com.test.app',   sku: 'TESTAPP', primaryLocale: 'en-US' } },
    { id: '9876543210', type: 'apps', attributes: { name: 'Second App', bundleId: 'com.test.two', sku: 'TESTTWO', primaryLocale: 'en-US' } },
  ],
};

const ENGAGEMENT_TSV = [
  'Date\tImpressions\tProduct Page Views\tSource Type\tTerritory',
  '2026-07-01\t5000\t900\tApp Store Search\tUnited States',
  '2026-07-01\t1200\t150\tApp Referrer\tUnited States',
  '2026-07-02\t4800\t850\tApp Store Search\tCanada',
  '2026-07-02\t900\t100\tWeb Referrer\tUnited States',
].join('\n');

const COMMERCE_TSV = [
  'Date\tTotal Downloads\tTerritory',
  '2026-07-01\t42\tUnited States',
  '2026-07-02\t31\tCanada',
].join('\n');

/**
 * Routes a stubbed fetch across Apple's endpoints.
 * @param opts.engagement / opts.commerce - null to simulate Apple not having produced
 *   that report category yet
 */
function stubApple(opts: {
  engagement?: string | null;
  commerce?:   string | null;
  appsStatus?: number;
  appsErrorCode?: string;
  instancesEmpty?: boolean;
  appMissing?: boolean;
} = {}) {
  const engagement = opts.engagement === undefined ? ENGAGEMENT_TSV : opts.engagement;
  const commerce   = opts.commerce   === undefined ? COMMERCE_TSV   : opts.commerce;
  const calls: string[] = [];

  const impl = vi.fn(async (input: string) => {
    const url = String(input);
    calls.push(url);

    const json = (body: unknown, status = 200) => ({
      ok: status < 400, status,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as Response;

    if (url.includes('/v1/apps/') && !url.includes('analyticsReportRequests')) {
      if (opts.appMissing) return json({ errors: [{ code: 'NOT_FOUND' }] }, 404);
      return json({ data: APPS_RESPONSE.data[0] });
    }
    if (url.includes('/v1/apps?')) {
      if (opts.appsStatus && opts.appsStatus >= 400) {
        return json({ errors: [{ code: opts.appsErrorCode ?? 'ERROR' }] }, opts.appsStatus);
      }
      return json(APPS_RESPONSE);
    }
    if (url.includes('/analyticsReportRequests') && url.includes('/v1/apps/')) {
      return json({ data: [{ id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] });
    }
    if (url.includes('/reports')) {
      const category = url.includes('APP_STORE_ENGAGEMENT') ? 'engagement' : 'commerce';
      const available = category === 'engagement' ? engagement : commerce;
      if (available === null) return json({ data: [] });
      return json({
        data: [{
          id: `report-${category}`,
          attributes: {
            name: category === 'engagement'
              ? 'App Store Discovery and Engagement Detailed Daily'
              : 'App Store Downloads Detailed Daily',
            category: category === 'engagement' ? 'APP_STORE_ENGAGEMENT' : 'COMMERCE',
          },
        }],
      });
    }
    if (url.includes('/instances')) {
      if (opts.instancesEmpty) return json({ data: [] });
      const which = url.includes('report-engagement') ? 'engagement' : 'commerce';
      return json({
        data: [{ id: `instance-${which}`, attributes: { granularity: 'DAILY', processingDate: '2026-07-03' } }],
      });
    }
    if (url.includes('/segments')) {
      const which = url.includes('instance-engagement') ? 'engagement' : 'commerce';
      return json({ data: [{ attributes: { url: `https://apple-cdn.test/${which}.gz`, sizeInBytes: 100 } }] });
    }
    if (url.startsWith('https://apple-cdn.test/')) {
      const which = url.includes('engagement') ? engagement : commerce;
      const buf = gzipSync(Buffer.from(which ?? '', 'utf-8'));
      return {
        ok: true, status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        json: async () => ({}),
      } as unknown as Response;
    }
    return json({ data: [] });
  });

  vi.stubGlobal('fetch', impl);
  return { calls, impl };
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

// ── Apple JWT ─────────────────────────────────────────────────────────────────

describe('Apple assertion signing', () => {
  it('produces a JWT Apple would accept', async () => {
    const token = await signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey });

    const header = decodeProtectedHeader(token);
    expect(header).toMatchObject({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });

    const claims = decodeJwt(token);
    expect(claims.iss).toBe(ISSUER_ID);
    expect(claims.aud).toBe('appstoreconnect-v1');

    // Apple rejects anything over 20 minutes.
    const lifetime = (claims.exp as number) - (claims.iat as number);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(20 * 60);
  });

  it('is verifiable with the matching public key', async () => {
    const token = await signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey });
    const spki = createPublicKey(publicKey).export({ type: 'spki', format: 'pem' }).toString();
    const { payload } = await jwtVerify(token, await importSPKI(spki, 'ES256'), {
      audience: 'appstoreconnect-v1', issuer: ISSUER_ID,
    });
    expect(payload.iss).toBe(ISSUER_ID);
  });

  it('mints a fresh assertion each time rather than reusing one', async () => {
    const a = await signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey });
    await new Promise(r => setTimeout(r, 1100)); // iat has 1-second resolution
    const b = await signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey });
    expect(a).not.toBe(b);
  });

  it('repairs the PEM framing owners commonly mangle', () => {
    const escaped = privateKey.replace(/\n/g, '\\n');
    expect(normalizePrivateKey(escaped)).toBe(normalizePrivateKey(privateKey));

    const crlf = privateKey.replace(/\n/g, '\r\n');
    expect(normalizePrivateKey(crlf)).toBe(normalizePrivateKey(privateKey));

    // Body only, header and footer stripped.
    const bodyOnly = privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s+/g, '');
    expect(normalizePrivateKey(bodyOnly)).toBe(normalizePrivateKey(privateKey));
  });

  it('rejects a value that is not a key with a recoverable owner-facing error', () => {
    for (const bad of ['', '   ', 'hunter2']) {
      let thrown: unknown;
      try { normalizePrivateKey(bad); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ProviderError);
      expect((thrown as ProviderError).kind).toBe('NEEDS_REAUTH');
    }
  });

  it('fails signing with a syntactically valid but unusable key', async () => {
    const fake = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`;
    await expect(signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey: fake }))
      .rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });
  });

  it('never echoes key material in the error message', async () => {
    const fake = `-----BEGIN PRIVATE KEY-----\nSECRETMATERIALSECRETMATERIAL\n-----END PRIVATE KEY-----`;
    const err = await signAppleAssertion({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey: fake })
      .catch(e => e as ProviderError);
    expect(err.message).not.toContain('SECRETMATERIAL');
  });

  it('round-trips pack/unpack and recovers ids from connection_config', () => {
    const packed = packAppleCredential({ issuerId: ISSUER_ID, keyId: KEY_ID, privateKey });
    expect(unpackAppleCredential(packed)).toMatchObject({ issuerId: ISSUER_ID, keyId: KEY_ID });

    // Legacy shape: bare key plus ids held in connection_config.
    const legacy = unpackAppleCredential(privateKey, { issuer_id: ISSUER_ID, key_id: KEY_ID });
    expect(legacy.issuerId).toBe(ISSUER_ID);
  });

  it('refuses a credential missing its issuer or key id', () => {
    expect(() => unpackAppleCredential(privateKey, {})).toThrow(/Issuer ID or Key ID/);
  });
});

// ── Report parsing ────────────────────────────────────────────────────────────

describe('report parsing', () => {
  it('parses Apple tab-separated reports', () => {
    const parsed = parseDelimited(ENGAGEMENT_TSV);
    expect(parsed?.columns).toEqual(['Date', 'Impressions', 'Product Page Views', 'Source Type', 'Territory']);
    expect(parsed?.rows).toHaveLength(4);
    expect(parsed?.rows[0]).toMatchObject({ Date: '2026-07-01', Impressions: '5000' });
  });

  it('returns null for a header-only or empty file', () => {
    expect(parseDelimited('Date\tImpressions')).toBeNull();
    expect(parseDelimited('')).toBeNull();
  });

  it('tolerates CRLF line endings', () => {
    const parsed = parseDelimited(ENGAGEMENT_TSV.replace(/\n/g, '\r\n'));
    expect(parsed?.rows).toHaveLength(4);
    expect(parsed?.columns[0]).toBe('Date');
  });
});

// ── Adapter: authorization and enumeration ────────────────────────────────────

describe('appStoreConnectAdapter — authorization', () => {
  it('proves the credential with a real call before returning', async () => {
    const { calls } = stubApple();
    const identity = await appStoreConnectAdapter.verifyCredential(ctx());
    expect(calls.some(c => c.includes('/v1/apps'))).toBe(true);
    // Issuer ID is the account-substitution guard.
    expect(identity.externalAccountId).toBe(ISSUER_ID);
  });

  it('maps 401 to NEEDS_REAUTH', async () => {
    stubApple({ appsStatus: 401, appsErrorCode: 'NOT_AUTHORIZED' });
    await expect(appStoreConnectAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });
  });

  it('maps 403 to PERMISSION_DENIED with an actionable message', async () => {
    stubApple({ appsStatus: 403 });
    const err = await appStoreConnectAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
    expect(err.kind).toBe('PERMISSION_DENIED');
    expect(err.ownerMessage).toMatch(/role/i);
  });

  it('maps 429 and 5xx to PROVIDER_UNAVAILABLE', async () => {
    stubApple({ appsStatus: 429 });
    await expect(appStoreConnectAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' });

    stubApple({ appsStatus: 503 });
    await expect(appStoreConnectAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' });
  });

  it('maps a network failure to PROVIDER_UNAVAILABLE without claiming a change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const err = await appStoreConnectAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
    expect(err.kind).toBe('PROVIDER_UNAVAILABLE');
    expect(err.ownerMessage).toMatch(/unchanged/i);
  });

  it('lists the real apps Apple returned', async () => {
    stubApple();
    const accounts = await appStoreConnectAdapter.listAccounts(ctx());
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ id: APP_ID, name: 'Test App' });
    expect(accounts[1].name).toBe('Second App');
  });

  it('validateSelection rejects an app Apple no longer returns', async () => {
    stubApple({ appMissing: true });
    await expect(appStoreConnectAdapter.validateSelection?.(ctx(), APP_ID))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('checkHealth reports authorized vs unauthorized truthfully', async () => {
    stubApple();
    await expect(appStoreConnectAdapter.checkHealth?.(ctx()))
      .resolves.toMatchObject({ reachable: true, authorized: true });

    stubApple({ appsStatus: 401, appsErrorCode: 'NOT_AUTHORIZED' });
    await expect(appStoreConnectAdapter.checkHealth?.(ctx()))
      .resolves.toMatchObject({ authorized: false });
  });
});

// ── Adapter: sync ─────────────────────────────────────────────────────────────

describe('appStoreConnectAdapter — sync', () => {
  it('imports real metrics and computes conversion from them', async () => {
    stubApple();
    const result = await appStoreConnectAdapter.fetchSignals(ctx());

    const byType = (t: string) => result.signals.filter(s => s.signalType === t);

    // Impressions: 5000 + 1200 + 4800 + 900
    expect(byType('impressions')[0].signalData.value).toBe(11900);
    // Downloads: 42 + 31
    expect(byType('downloads')[0].signalData.value).toBe(73);

    // Conversion = downloads ÷ page views (900+150+850+100 = 2000)
    const conversion = byType('conversion')[0];
    expect(conversion.signalData.product_page_views).toBe(2000);
    expect(conversion.signalData.value).toBeCloseTo(73 / 2000, 6);

    // Period comes from the Date column, not from the clock.
    expect(conversion.periodStart).toBe('2026-07-01');
    expect(conversion.periodEnd).toBe('2026-07-02');
    expect(result.partial).toBeFalsy();
  });

  it('breaks down acquisition sources from the Source Type column', async () => {
    stubApple();
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    const source = result.signals.find(
      s => s.signalType === 'territory' && s.signalData.dimension === 'source_type',
    );
    // App Store Search: 900 + 850 = 1750 of 2000
    expect(source?.signalData.top).toBe('App Store Search');
    expect(source?.signalData.top_share).toBeCloseTo(1750 / 2000, 4);
  });

  it('breaks down territories', async () => {
    stubApple();
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    const territory = result.signals.find(
      s => s.signalType === 'territory' && s.signalData.dimension === 'territory',
    );
    expect(territory?.signalData.top).toBe('United States');
  });

  it('every signal carries a real period so replay is deduplicated', async () => {
    stubApple();
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    // Migration 078's dedup index is partial on period_start IS NOT NULL.
    for (const s of result.signals) {
      expect(s.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('reports progress only as real Apple calls complete', async () => {
    stubApple();
    const seen: Array<{ progress: number; step: string }> = [];
    await appStoreConnectAdapter.fetchSignals(ctx(), async u => { seen.push(u); });

    expect(seen[0].step).toBe('Authorization verified');
    expect(seen[1].step).toBe('App selected');
    expect(seen.map(s => s.step)).toContain('Calculating store conversion');
    // Monotonic, and never claims completion before the last step.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].progress).toBeGreaterThanOrEqual(seen[i - 1].progress);
    }
    expect(seen[seen.length - 1].progress).toBeLessThanOrEqual(100);
  });

  it('returns NO_HISTORY when Apple has produced no report instance yet', async () => {
    // The genuine first-connection state: the opt-in exists, data does not.
    stubApple({ instancesEmpty: true });
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    expect(result.noHistory).toBe(true);
    expect(result.signals).toEqual([]);
  });

  it('returns PARTIAL with an explanation when only engagement is available', async () => {
    stubApple({ commerce: null });
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    expect(result.partial).toBe(true);
    expect(result.partialReason).toMatch(/commerce report/i);
    // Impressions arrived; conversion did not, because downloads are missing.
    expect(result.signals.some(s => s.signalType === 'impressions')).toBe(true);
    expect(result.signals.some(s => s.signalType === 'conversion')).toBe(false);
  });

  it('returns PARTIAL when only commerce is available', async () => {
    stubApple({ engagement: null });
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    expect(result.partial).toBe(true);
    expect(result.partialReason).toMatch(/engagement report/i);
    expect(result.signals.some(s => s.signalType === 'downloads')).toBe(true);
  });

  it('refuses to sync without a selected app', async () => {
    stubApple();
    await expect(appStoreConnectAdapter.fetchSignals(ctx({ selectedResourceId: null })))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('surfaces WRONG_ACCOUNT when the selected app disappears', async () => {
    stubApple({ appMissing: true });
    await expect(appStoreConnectAdapter.fetchSignals(ctx()))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('exposes no method capable of writing to App Store Connect', () => {
    // Read-only is structural, not a promise: there is nothing to call.
    const surface = Object.keys(appStoreConnectAdapter);
    for (const forbidden of ['publish', 'updateMetadata', 'createCampaign', 'spend', 'setBudget']) {
      expect(surface).not.toContain(forbidden);
    }
    expect(appStoreConnectAdapter.readScopes.every(s => s.endsWith('.read'))).toBe(true);
  });
});

// ── Insight derivation ────────────────────────────────────────────────────────

describe('insight derivation from real signals', () => {
  const sig = (type: string, data: Record<string, unknown>, id = `s-${type}`) => ({
    id, signal_type: type, signal_data: data,
    period_start: '2026-07-01', period_end: '2026-07-02',
  });

  it('flags conversion below the store benchmark, with evidence', () => {
    const insights = deriveAppStoreInsights([
      sig('conversion', { value: 0.018, product_page_views: 2000, downloads: 36 }),
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].insightKey).toBe('app_store.conversion_vs_benchmark');
    expect(insights[0].headline).toContain('1.8%');

    // Evidence must carry the numbers the claim rests on.
    const labels = insights[0].evidence.map(e => e.label);
    expect(labels).toContain('Product page views');
    expect(labels).toContain('Downloads');
    expect(labels).toContain('Store benchmark');
    expect(insights[0].sourceSignalIds).toEqual(['s-conversion']);
    expect(insights[0].method).toMatch(/downloads ÷ product page views/);
  });

  it('recognises above-benchmark conversion and changes the recommendation', () => {
    const insights = deriveAppStoreInsights([
      sig('conversion', { value: 0.06, product_page_views: 3000, downloads: 180 }),
    ]);
    expect(insights[0].headline).toMatch(/above the typical/);
    expect(insights[0].recommendedFocus).toMatch(/[Rr]each/);
  });

  it('stays silent when the sample is too small to conclude from', () => {
    // 40 page views cannot support a claim about conversion.
    expect(deriveAppStoreInsights([
      sig('conversion', { value: 0.01, product_page_views: 40, downloads: 1 }),
    ])).toEqual([]);
  });

  it('stays silent when conversion is close to the benchmark', () => {
    expect(deriveAppStoreInsights([
      sig('conversion', { value: 0.036, product_page_views: 5000, downloads: 180 }),
    ])).toEqual([]);
  });

  it('produces nothing at all from empty signals — no filler insight', () => {
    expect(deriveAppStoreInsights([])).toEqual([]);
  });

  it('flags source concentration only when a source genuinely dominates', () => {
    const dominant = deriveAppStoreInsights([
      sig('territory', {
        dimension: 'source_type', top: 'App Store Search', top_share: 0.87, total: 2000,
        breakdown: [{ key: 'App Store Search', value: 1740 }, { key: 'Web Referrer', value: 260 }],
      }),
    ]);
    expect(dominant[0].insightKey).toBe('app_store.source_concentration');
    expect(dominant[0].headline).toContain('App Store Search');

    const even = deriveAppStoreInsights([
      sig('territory', { dimension: 'source_type', top: 'App Store Search', top_share: 0.34, total: 2000, breakdown: [] }),
    ]);
    expect(even).toEqual([]);
  });

  it('scales confidence with sample size and never claims certainty', () => {
    const small = deriveAppStoreInsights([sig('conversion', { value: 0.01, product_page_views: 250, downloads: 3 })]);
    const large = deriveAppStoreInsights([sig('conversion', { value: 0.01, product_page_views: 50_000, downloads: 500 })]);
    expect(large[0].confidence).toBeGreaterThan(small[0].confidence);
    expect(large[0].confidence).toBeLessThan(1);
  });

  it('explains reach-without-conversion when only engagement arrived', () => {
    const insights = deriveAppStoreInsights([
      sig('impressions', { value: 11900, unit: 'impressions' }),
    ]);
    expect(insights[0].insightKey).toBe('app_store.reach_without_conversion');
    expect(insights[0].detail).toMatch(/commerce report/i);
  });

  it('derives an insight end to end from adapter output', async () => {
    // The full path: Apple rows → adapter signals → derived insight.
    stubApple({
      commerce: ['Date\tTotal Downloads\tTerritory', '2026-07-01\t20\tUnited States', '2026-07-02\t16\tCanada'].join('\n'),
    });
    const result = await appStoreConnectAdapter.fetchSignals(ctx());
    const rows = result.signals.map((s, i) => ({
      id: `sig-${i}`, signal_type: s.signalType, signal_data: s.signalData,
      period_start: s.periodStart, period_end: s.periodEnd,
    }));

    const insights = deriveAppStoreInsights(rows);
    expect(insights.length).toBeGreaterThan(0);
    // 36 downloads ÷ 2000 page views = 1.8%, materially below the 3.5% benchmark.
    const conversionInsight = insights.find(i => i.insightKey === 'app_store.conversion_vs_benchmark');
    expect(conversionInsight?.headline).toContain('1.8%');
    // Nothing hard-coded: change the data, change the number.
    expect(conversionInsight?.headline).not.toContain('3.2%');
  });
});
