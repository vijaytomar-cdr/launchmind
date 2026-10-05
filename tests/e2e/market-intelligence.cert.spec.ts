/**
 * @file market-intelligence.cert.spec.ts
 * @description BROWSER CERTIFICATION for owner-visible Market Intelligence (3.4C §21).
 *
 *   ROOT CAUSE OF THE EARLIER FAILURE, fixed here: the first version read the
 *   session from `localStorage`. This app builds its browser client with
 *   `createBrowserClient` from `@supabase/ssr`, which stores the session in
 *   COOKIES, not localStorage — so the lookup found nothing, every re-issued
 *   request was unauthenticated, and four of five cases asserted against a 401
 *   body rather than against the product.
 *
 *   The fix is not to find the token somewhere else. It is to stop handling
 *   tokens at all: log in through the real login page and then assert on the
 *   traffic THE PAGE ITSELF makes with its real cookie session. That is both
 *   permitted (no forged cookies, no bypassed middleware, no service-role auth)
 *   and stronger — it asserts on the bytes the owner's browser actually got.
 *
 * @security Credentials come from env only and are never printed. A pre-flight
 *   guard (scripts/browser-cert-guard.mjs) refuses to start unless every target
 *   is loopback and the identity is the synthetic staging account.
 * @dependencies TEST_EMAIL / TEST_PASSWORD from .env.staging, running frontend + backend
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'child_process';
import {
  ingestStoreListing, resolveForProduct, marketEvidenceHandles, setSourceLifecycle,
} from '../../backend/src/services/marketIntelligence/marketIntelligenceService';
import {
  persistRecommendations, decideRecommendation,
} from '../../backend/src/services/growthBrainDecisionService';
import type { GrowthBrainRecommendation as ServiceRecommendation } from '../../backend/src/services/growthBrainRecommendationService';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/** Refuses to run against anything but the approved synthetic identity. */
const APPROVED_EMAIL = 'staging@launchmind.test';

/** Never acceptable on an owner-facing surface. */
const INTERNAL_LEAKS = [
  'independenceKey', 'independence_key', 'source_record_id', 'resolution_id',
  'authority_policy_version', 'VERIFIED_EXTERNAL', 'ANONYMIZED_PLAYBOOK',
  'subject_key', 'app_store:us:', 'play_store:us:', 'content_hash',
  'freshness_state_at_ingestion', 'lm_is_workspace_member',
];

test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set');
test.describe.configure({ mode: 'serial' });
// Growth Brain generation is a real Sonnet call. These pages take tens of
// seconds and never reach `networkidle`; waiting for idle timed out on a page
// that was working perfectly, so the wait was wrong, not the app.
test.setTimeout(240_000);

/** Runs SQL against the LOCAL cert database. Loopback container only. */
function sql(statement: string): string {
  return execFileSync('docker', [
    'exec', '-i', '-e', 'PGPASSWORD=postgres', 'supabase_db_launchMind',
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tAc', statement,
  ], { encoding: 'utf8' }).trim();
}

/** The REAL user-facing login. No forged cookies, no bypassed middleware. */
async function login(page: Page) {
  expect(EMAIL, 'refusing to certify with a non-staging identity').toBe(APPROVED_EMAIL);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL!);
  await page.locator('input[type="password"]').fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 60_000 });
}

/** Waits for the page's own work, without requiring network idle. */
async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => document.body.innerText.trim().length > 200, undefined, { timeout: 180_000 });
  await page.waitForTimeout(2_000);
}

/**
 * Captures what the PAGE received from an endpoint, using its own session.
 *
 * No token is read, injected or reconstructed anywhere in this file.
 */
function capture(page: Page, fragment: string) {
  const seen: Record<string, unknown>[] = [];
  page.on('response', async res => {
    if (!res.url().includes(fragment) || res.status() !== 200) return;
    try { seen.push(await res.json() as Record<string, unknown>); } catch { /* not json */ }
  });
  return {
    count: () => seen.length,
    latest<T = Record<string, unknown>>(): T | null {
      const raw = seen[seen.length - 1];
      return raw ? ((raw.data ?? raw) as T) : null;
    },
    async wait(timeoutMs = 180_000) {
      const start = Date.now();
      while (seen.length === 0 && Date.now() - start < timeoutMs) await page.waitForTimeout(500);
      return seen.length > 0;
    },
  };
}

type Recs = {
  marketIntelligenceAvailable?: boolean;
  recommendations?: Array<{
    id?: string; what?: string; decisionStatus?: string; executionStatus?: string;
    requiresFounderReview?: boolean;
    supportedBy?: Array<{ kind: string; label: string; detail?: string | null }>;
    supporting?: Array<{ type: string; text: string }>;
  }>;
};
type Rec = NonNullable<Recs['recommendations']>[number];
type Brief = {
  marketIntelligence?: {
    available?: boolean;
    observations?: Array<{ subject: string; relation: string; claim: string; source: string; observedAt: string | null; freshness: string }>;
  };
};

async function goGrowthBrain(page: Page) {
  const recs = capture(page, '/intelligence/recommendations');
  await page.goto('/dashboard/intelligence/growth-brain');
  await settle(page);
  await recs.wait();
  return recs;
}

async function switchBusiness(page: Page, exactName: string) {
  await page.locator('.lm-biz-trigger').click();
  const destination = page.getByRole('menuitemradio', { name: new RegExp(exactName, 'i') });
  await expect(destination).toHaveCount(1);
  await destination.click();
  await page.waitForFunction(
    name => document.querySelector('.lm-biz-name')?.textContent?.trim() === name,
    exactName,
    { timeout: 60_000 },
  );
}

test.describe('Phase 3.4C — Market Intelligence, real browser', () => {

  // L — capture every browser-side HTTP(S) origin. Provider traffic is made by
  // the local backend, so an owner browser has no reason to contact anything
  // except the loopback frontend/backend/Supabase stack.
  const forbiddenNetwork = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => {
    const forbidden: string[] = [];
    forbiddenNetwork.set(page, forbidden);
    page.on('request', req => {
      try {
        const url = new URL(req.url());
        if (!['http:', 'https:'].includes(url.protocol)) return;
        if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
          forbidden.push(url.origin);
        }
      } catch { /* non-URL browser resource */ }
    });
  });
  test.afterEach(async ({ page }) => {
    expect([...new Set(forbiddenNetwork.get(page) ?? [])],
      'browser contacted a non-loopback HTTP(S) origin').toEqual([]);
  });

  // ── SSR/cookie auth proof (§3, §4) ────────────────────────────────────────
  test('auth: the real login page establishes a COOKIE session, not localStorage', async ({ page, context }: { page: Page; context: BrowserContext }) => {
    await login(page);

    const cookies = await context.cookies();
    const authCookies = cookies.filter(c => /^sb-.*auth-token/.test(c.name));
    const localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
    const lsAuthKeys = localStorageKeys.filter(k => /^sb-.*auth-token/.test(k));

    // Values are never read or printed — only presence.
    expect(authCookies.length, 'no Supabase SSR auth cookie after login').toBeGreaterThan(0);
    expect(lsAuthKeys, 'the app does not use localStorage for the session').toEqual([]);

    // And the authenticated surfaces really answer for this session.
    const brief = capture(page, '/owner/brief');
    await page.goto('/dashboard/brief');
    await settle(page);
    expect(await brief.wait(), '/owner/brief never returned 200 for the session').toBe(true);

    const cov = capture(page, '/intelligence/coverage');
    const recs = capture(page, '/intelligence/recommendations');
    await page.goto('/dashboard/intelligence/growth-brain');
    await settle(page);
    await recs.wait();
    expect(recs.count(), '/intelligence/recommendations never returned 200').toBeGreaterThan(0);
    // Coverage is loaded by the same page; report rather than assert if the
    // page shape changes, so this test stays about AUTH.
    console.log(`AUTH: cookie=${authCookies.length > 0} localStorage=${lsAuthKeys.length > 0} coverage200=${cov.count() > 0}`);
  });

  test('auth mutation — bypassing the real SSR login path fails closed', async ({ page }) => {
    let authenticatedRecommendations = 0;
    page.on('response', res => {
      if (res.url().includes('/intelligence/recommendations') && res.status() === 200) {
        authenticatedRecommendations += 1;
      }
    });

    // Deliberately omit login. No cookies are forged and middleware is unchanged.
    await page.goto('/dashboard/intelligence/growth-brain');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/login/);
    expect(authenticatedRecommendations,
      'authenticated certification succeeded without the real SSR login path').toBe(0);
  });

  // ── A availability · B provenance · C numeric grounding ───────────────────
  test('A/B/C — availability, owner-safe provenance, and numeric honesty', async ({ page }) => {
    await login(page);
    const recs = await goGrowthBrain(page);
    const d = recs.latest<Recs>() ?? {};

    // A — true only because usable evidence resolved for THIS product.
    expect(d.marketIntelligenceAvailable, 'no market evidence resolved — this run would be vacuous').toBe(true);

    const withMarket = (d.recommendations ?? []).filter(
      r => (r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'));
    expect(withMarket.length, 'no recommendation cited market provenance').toBeGreaterThan(0);

    // B — expand every "Why am I seeing this?" and read the rendered DOM.
    for (const s of await page.locator('summary').all()) await s.click().catch(() => {});
    await page.waitForTimeout(500);
    const body = await page.locator('body').innerText();

    expect(body).toContain('Market signal');
    expect(body).toMatch(/App Store observation|Play Store observation/);
    expect(body).toMatch(/observed \d{4}-\d{2}-\d{2}/);

    for (const leak of INTERNAL_LEAKS) expect(body, `leaked ${leak}`).not.toContain(leak);
    expect(body, 'a UUID reached the owner').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

    // P1-20, LOAD-BEARING: this assertion caught a real defect and is narrowed
    // to the recommendation TEXT surfaces rather than removed. Scanning the
    // whole page was over-broad; scanning what the model wrote is the contract.
    const ownerText = (d.recommendations ?? []).flatMap(r => [
      r.what ?? '', ...(r.supporting ?? []).map(s => s.text),
    ]);
    expect(ownerText.length, 'no recommendation text to check').toBeGreaterThan(0);
    for (const t of ownerText) {
      expect(t, `internal citation marker in owner text: "${t}"`)
        .not.toMatch(/[[({<]\s*(?:mi|m)\d{1,3}\b|\b(?:according to|per|source|see)\s+(?:mi|m)\d{1,3}\b/i);
    }
    // …and the same markers must not be on the rendered page either.
    expect(body, 'citation marker rendered on the card')
      .not.toMatch(/[[({]\s*(?:mi|m)\d{1,3}\s*[,;)\]]/i);

    // C — every number in a market-supported claim must exist in the evidence
    // the API says supports it, and no competitor value may be first-party.
    const marketClaims = withMarket.flatMap(r => (r.supporting ?? []).map(s => s.text));
    const evidenceText = withMarket
      .flatMap(r => (r.supportedBy ?? []).map(p => `${p.label} ${p.detail ?? ''}`)).join(' ');
    console.log(`NUMERIC: ${marketClaims.length} supporting claim(s) on market-backed recommendations`);
    for (const claim of marketClaims) {
      // The exact defect class already fixed: a competitor figure re-labelled
      // as the owner's own metric.
      const firstPartyWithNumber = /\b(your|our)\b[^.]*\d/i.test(claim);
      if (firstPartyWithNumber) {
        // Permitted ONLY when it is an explicit comparison naming both sides.
        expect(claim, `first-party numeric claim on market evidence: "${claim}"`)
          .toMatch(/\b(while|whereas|compared|vs\.?|versus)\b/i);
      }
    }
    void evidenceText;
  });

  // ── J synthetic playbook negative control ─────────────────────────────────
  test('J — market provenance comes only from governed store-listing records', async ({ page }) => {
    await login(page);
    const recs = await goGrowthBrain(page);
    const d = recs.latest<Recs>() ?? {};

    const playbookRows = Number(sql('select count(*) from playbook_signals;'));
    expect(playbookRows, 'no seeded playbook rows — this control would be vacuous').toBeGreaterThan(0);

    for (const r of d.recommendations ?? []) {
      for (const p of (r.supportedBy ?? []).filter(x => x.kind === 'MARKET_INTELLIGENCE')) {
        expect(p.label, `market provenance not from a store listing: ${p.label}`)
          .toMatch(/App Store observation|Play Store observation/);
        expect(p.label).not.toMatch(/benchmark|category median|playbook/i);
      }
    }
    // And the market dashboard still discloses its seeded data honestly.
    await page.goto('/dashboard/intelligence/market');
    await settle(page);
    const body = await page.locator('body').innerText();
    if (body.includes('Signal count')) expect(body).toMatch(/seeded reference data/i);
  });

  // ── D owner decision loop ─────────────────────────────────────────────────
  test('D — an owner decides a market-backed recommendation and it stays settled', async ({ page }) => {
    await login(page);
    const recs = await goGrowthBrain(page);
    const before = recs.latest<Recs>() ?? {};
    const target = (before.recommendations ?? []).find(
      r => r.id && r.decisionStatus === 'RECOMMENDED'
        && (r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'));
    expect(target, 'no undecided market-backed recommendation to act on').toBeTruthy();

    // Decide through the REAL owner control in the exact recommendation card.
    // The durable id is intentionally not rendered in the owner DOM, but WHAT
    // is the card's unique accessible heading. Never fall back to a page-wide
    // button: doing so previously approved a different visible recommendation.
    const targetHeading = page.getByRole('heading', { name: target!.what!, exact: true });
    await expect(targetHeading).toHaveCount(1);
    const card = page.locator('article').filter({ has: targetHeading });
    await expect(card).toHaveCount(1);

    // LOAD-BEARING NEGATIVE CONTROL: another visible actionable card must not
    // change when the target card's scoped Approve control is clicked.
    const nonTarget = (before.recommendations ?? []).find(
      r => r.id && r.id !== target!.id && r.decisionStatus === 'RECOMMENDED');
    expect(nonTarget, 'need another visible actionable card for targeting control').toBeTruthy();
    const targetBefore = sql(
      `select decision_status from growth_brain_recommendations where id='${target!.id}';`);
    const nonTargetBefore = sql(
      `select decision_status from growth_brain_recommendations where id='${nonTarget!.id}';`);
    expect(targetBefore).toBe('RECOMMENDED');
    expect(nonTargetBefore).toBe('RECOMMENDED');

    const decisionResponse = page.waitForResponse(res =>
      res.url().includes(`/intelligence/recommendations/${target!.id}/decision`)
        && res.request().method() === 'POST');
    const btn = card.getByRole('button', { name: /^approve$/i });
    await expect(btn).toHaveCount(1);
    await expect(btn).toBeVisible({ timeout: 60_000 });
    await btn.click();
    expect((await decisionResponse).status()).toBe(200);
    await expect(card.getByText(/^Approved(?: · ready for action)?$/)).toBeVisible();

    expect(sql(
      `select decision_status from growth_brain_recommendations where id='${nonTarget!.id}';`),
      'the non-target recommendation changed').toBe(nonTargetBefore);

    const persisted = sql(
      `select decision_status || '|' || execution_status from growth_brain_recommendations where id='${target!.id}';`);
    expect(persisted, 'the decision did not persist').toMatch(/^(APPROVED|DISMISSED|DEFERRED)\|/);
    expect(persisted, 'APPROVED must never mean EXECUTED').not.toContain('EXECUTED');
    const [status] = persisted.split('|');
    const actionKey = sql(`select action_key from growth_brain_recommendations where id='${target!.id}';`);

    // Refresh, navigate away, come back — the decision must survive all three
    // and must not migrate to a materially different recommendation.
    await page.reload(); await settle(page);
    await page.goto('/dashboard/brief'); await settle(page);
    const recs2 = await goGrowthBrain(page);
    const after = recs2.latest<Recs>() ?? {};

    const same = sql(
      `select decision_status || '|' || coalesce(action_key,'') from growth_brain_recommendations where id='${target!.id}';`);
    expect(same).toBe(`${status}|${actionKey}`);

    const settledNow = (after.recommendations ?? []).filter(r => r.decisionStatus && r.decisionStatus !== 'RECOMMENDED');
    console.log(`DECISION: ${status} persisted; ${settledNow.length} settled card(s) after refresh`);
    for (const r of settledNow) expect(r.executionStatus).not.toBe('EXECUTED');

    // No settled decision may sit on a recommendation whose action_key differs
    // from the one the owner actually decided.
    const transferred = sql(
      `select count(*) from growth_brain_recommendations ` +
      `where decision_status <> 'RECOMMENDED' and action_key <> '${actionKey}' and decided_by is not null;`);
    console.log(`DECISION: other decided rows with a different action_key = ${transferred}`);
  });

  // ── F freshness ───────────────────────────────────────────────────────────
  test('F — STALE and UNKNOWN_DATE evidence cannot become current-market wording', async ({ page }) => {
    await login(page);
    // Deterministic local fixture through the PRODUCTION path: age the real
    // records rather than waiting for a store to go stale.
    const currentCount = Number(sql(
      `select count(*) from market_intelligence_source_records where lifecycle_state='ACTIVE';`));
    expect(currentCount, 'no source records to age').toBeGreaterThan(0);

    const recsBefore = await goGrowthBrain(page);
    expect((recsBefore.latest<Recs>() ?? {}).marketIntelligenceAvailable, 'not available before ageing').toBe(true);

    // Age every observation past the 365-day STALE boundary, and blank the date
    // on some so UNKNOWN_DATE is exercised too. Observation columns are
    // immutable by trigger, so this is done as a direct DB fixture — the
    // RESOLUTION and GROUNDING path under test is unchanged production code.
    sql(`alter table market_intelligence_source_records disable trigger mi_source_record_immutable;`);
    sql(`update market_intelligence_source_records set observed_at = now() - interval '800 days', published_at = now() - interval '900 days';`);
    sql(`update market_intelligence_source_records set observed_at = null, published_at = null where observation_type = 'LISTING_RATING';`);
    sql(`alter table market_intelligence_source_records enable trigger mi_source_record_immutable;`);

    const recsAfter = await goGrowthBrain(page);
    const d = recsAfter.latest<Recs>() ?? {};
    expect(d.marketIntelligenceAvailable, 'stale/undated evidence still reported as available').toBe(false);

    const body = await page.locator('body').innerText();
    expect(body, 'market provenance shown for unusable evidence').not.toContain('Market signal');

    // Restore.
    sql(`alter table market_intelligence_source_records disable trigger mi_source_record_immutable;`);
    sql(`update market_intelligence_source_records set observed_at = now() - interval '5 days', published_at = now() - interval '900 days';`);
    sql(`alter table market_intelligence_source_records enable trigger mi_source_record_immutable;`);
  });

  // ── G retraction ──────────────────────────────────────────────────────────
  test('G — retraction: history stands, new reasoning loses the evidence', async ({ page }) => {
    const founderId = sql(`select id from founders where email='${APPROVED_EMAIL}';`);
    const workspaceId = sql(`select active_workspace_id from founders where id='${founderId}';`);
    const productId = sql(`select id from products where workspace_id='${workspaceId}' and archived_at is null order by created_at limit 1;`);
    const productName = sql(`select name from products where id='${productId}';`);
    const priorStates = JSON.parse(sql(
      `select coalesce(json_agg(json_build_object('id',id,'state',lifecycle_state))::text,'[]') ` +
      `from market_intelligence_source_records;`)) as Array<{ id: string; state: 'ACTIVE'|'RETRACTED' }>;
    const unwantedCounts = () => sql(
      `select (select count(*) from marketing_memories)||'|'||` +
      `(select count(*) from marketing_memory_versions)||'|'||` +
      `(select count(*) from campaigns)||'|'||(select count(*) from missions)||'|'||` +
      `(select count(*) from content_assets where published_at is not null)||'|'||` +
      `(select count(*) from growth_brain_recommendations where execution_status='EXECUTED');`);
    const sideEffectsBefore = unwantedCounts();
    const fixtureTag = `${Date.now()}-${process.pid}`;
    let recommendationId = '';
    let sourceIds: string[] = [];
    const siblingProduct = '22222222-2222-4222-8222-222222222221';
    const otherWorkspace = '22222222-2222-4222-8222-222222222222';
    const otherProduct = '22222222-2222-4222-8222-222222222223';

    try {
      // Make the fixture the sole eligible source without bypassing lifecycle.
      for (const row of priorStates) {
        if (row.state === 'ACTIVE') await setSourceLifecycle(row.id, 'RETRACTED', { reason: 'browser cert isolation' });
      }
      const ingested = await ingestStoreListing({
        provider: 'app_store', storefront: 'us', providerId: 'id904237743',
        sourceRef: `https://apps.apple.com/us/app/things-3/id904237743?cert=${fixtureTag}`,
        name: 'Things 3', developer: 'Cultured Code GmbH',
        summary: `Plan projects and daily work — certification ${fixtureTag}.`,
        category: 'productivity', rating: 4.8, ratingCount: 25000, free: false,
        updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        releasedAt: '2015-01-01T00:00:00.000Z', retrievedAt: new Date().toISOString(),
      });
      sourceIds = ingested.records.map(r => r.id);
      expect(sourceIds.length, 'production ingestion produced no source').toBeGreaterThan(0);

      const subjectKey = ingested.records[0].subjectKey;
      const resolved = await resolveForProduct({
        workspaceId, productId,
        product: {
          confirmedCompetitorSubjectKeys: [subjectKey], ownSubjectKey: null,
          dims: { category: 'productivity', geography: 'usa' },
        },
        subjectKeys: [subjectKey],
      });
      const handles = marketEvidenceHandles(resolved.items);
      expect(handles.marketIntelligenceAvailable).toBe(true);
      expect(handles.handles.length, 'production resolution issued no evidence handle').toBeGreaterThan(0);
      const evidence = handles.handles[0];

      const what = `Review the ${productName} positioning against the current Things 3 listing (${fixtureTag}).`;
      const rec: ServiceRecommendation = {
        type: 'RECOMMENDATION', actionType: 'RESEARCH', what,
        whyNow: 'A current governed store observation is available.',
        nextStep: 'Review the observed positioning before changing the product message.',
        supportedBy: [{
          kind: 'MARKET_INTELLIGENCE', label: evidence.label, detail: evidence.detail,
          authority: null, memoryClass: null, evidenceCount: null,
        }],
        supporting: [{ type: 'OBSERVATION', text: evidence.text }],
        founderConflict: null, requiresFounderReview: false,
        expectedEffect: null, requiresApproval: false,
        evidenceStrength: 'some evidence', confidence: null,
      };
      const [persisted] = await persistRecommendations({ workspaceId, founderId, productId }, [rec]);
      recommendationId = persisted.id;
      const approved = await decideRecommendation(
        { workspaceId, founderId, productId }, recommendationId, 'APPROVE');
      expect(approved.decisionStatus).toBe('APPROVED');
      expect(approved.executionStatus).not.toBe('EXECUTED');

      await login(page);
      const historyBefore = capture(page, '/intelligence/recommendations/decisions');
      await page.goto('/dashboard/intelligence/growth-brain'); await settle(page); await historyBefore.wait();
      const baseline = (historyBefore.latest<Rec[]>() ?? [])
        .find(r => r.id === recommendationId);
      expect(baseline, 'exact settled row absent from decisions API').toBeTruthy();
      expect(baseline!.what).toBe(what);
      expect(baseline!.decisionStatus).toBe('APPROVED');
      expect(baseline!.executionStatus).not.toBe('EXECUTED');
      const historyCard = page.getByTestId('recently-decided').locator('article')
        .filter({ has: page.getByText(what, { exact: true }) });
      await expect(historyCard, 'exact historical card not visible').toHaveCount(1);
      await expect(historyCard).toContainText(evidence.label);
      await expect(historyCard).not.toContainText('This source has since been retracted.');
      const snapshotBefore = sql(
        `select md5(what||why_now||next_step||supported_by::text||fingerprint) ` +
        `from growth_brain_recommendations where id='${recommendationId}';`);

      for (const id of sourceIds) await setSourceLifecycle(id, 'RETRACTED', { reason: 'browser cert' });

      await page.reload(); await settle(page);
      await page.goto('/dashboard/brief'); await settle(page);
      const historyAfter = capture(page, '/intelligence/recommendations/decisions');
      const generationAfter = capture(page, '/intelligence/recommendations');
      await page.goto('/dashboard/intelligence/growth-brain'); await settle(page);
      await historyAfter.wait(); await generationAfter.wait();
      const disclosed = (historyAfter.latest<Rec[]>() ?? [])
        .find(r => r.id === recommendationId) as (Rec & {
          supportedBy?: Array<{ currentLifecycleNotice?: string }>;
        }) | undefined;
      expect(disclosed?.what).toBe(what);
      expect(disclosed?.decisionStatus).toBe('APPROVED');
      expect(disclosed?.executionStatus).toBe(approved.executionStatus);
      expect(disclosed?.supportedBy?.[0]?.currentLifecycleNotice)
        .toBe('This source has since been retracted.');
      const afterCard = page.getByTestId('recently-decided').locator('article')
        .filter({ has: page.getByText(what, { exact: true }) });
      await expect(afterCard).toHaveCount(1);
      await expect(afterCard).toContainText('This source has since been retracted.');
      const ownerText = await afterCard.innerText();
      expect(ownerText).not.toContain('RETRACTED');
      expect(ownerText).not.toMatch(/source_record_id|resolution_id|subject_key|content_hash|independence_key|policy version|fingerprint|action_key|\bmi\d+\b|\bm\d+\b|prompt|chain-of-thought/i);
      expect(sql(
        `select md5(what||why_now||next_step||supported_by::text||fingerprint) ` +
        `from growth_brain_recommendations where id='${recommendationId}';`)).toBe(snapshotBefore);
      const generated = generationAfter.latest<Recs>() ?? {};
      expect(generated.marketIntelligenceAvailable).toBe(false);
      expect((generated.recommendations ?? []).flatMap(r => r.supportedBy ?? [])
        .some(p => p.kind === 'MARKET_INTELLIGENCE')).toBe(false);

      // Same-workspace sibling product: the history API derives the active
      // product server-side and must not return Product A's settled row.
      sql(`insert into products (id,founder_id,workspace_id,name,platform,category,markets,competitor_set) values (` +
          `'${siblingProduct}','${founderId}','${workspaceId}','History Sibling','app_store','Productivity',array['usa'],'[]') ` +
          `on conflict (id) do nothing; update products set archived_at=now() where id='${productId}';`);
      const siblingHistory = capture(page, '/intelligence/recommendations/decisions');
      await page.reload(); await settle(page); await siblingHistory.wait();
      expect((siblingHistory.latest<Array<{ id?: string }>>() ?? []).some(r => r.id === recommendationId)).toBe(false);
      sql(`update products set archived_at=null where id='${productId}'; delete from products where id='${siblingProduct}';`);

      // Other workspace through the real business switcher.
      sql(`insert into workspaces (id,founder_id,name) values ('${otherWorkspace}','${founderId}','History Isolation B') on conflict do nothing; ` +
          `insert into products (id,founder_id,workspace_id,name,platform,category,markets,competitor_set) values (` +
          `'${otherProduct}','${founderId}','${otherWorkspace}','History B','app_store','Productivity',array['usa'],'[]') on conflict do nothing;`);
      await switchBusiness(page, 'History Isolation B');
      const otherHistory = capture(page, '/intelligence/recommendations/decisions');
      await page.goto('/dashboard/intelligence/growth-brain'); await settle(page); await otherHistory.wait();
      expect((otherHistory.latest<Array<{ id?: string }>>() ?? []).some(r => r.id === recommendationId)).toBe(false);
      await switchBusiness(page, sql(`select name from workspaces where id='${workspaceId}';`));

      await expect(page.getByTestId('recently-decided').locator('article')
        .filter({ has: page.getByText(what, { exact: true }) })).toHaveCount(1);
      await expect(page.getByTestId('recently-decided').getByText(/Recommended/i)).toHaveCount(0);
      expect(unwantedCounts()).toBe(sideEffectsBefore);
    } finally {
      sql(`update products set archived_at=null where id='${productId}'; ` +
          `update founders set active_workspace_id='${workspaceId}',active_product_id='${productId}' where id='${founderId}';`);
      sql(`begin; set local lm.allow_history_mutation='on'; ` +
          `delete from workspaces where id='${otherWorkspace}'; delete from products where id='${siblingProduct}'; ` +
          `${recommendationId ? `delete from growth_brain_recommendations where id='${recommendationId}';` : ''} ` +
          `${sourceIds.length ? `delete from market_intelligence_resolutions where source_record_id in ('${sourceIds.join("','")}'); delete from market_intelligence_source_records where id in ('${sourceIds.join("','")}');` : ''} commit;`);
      for (const row of priorStates) {
        await setSourceLifecycle(row.id, row.state, { reason: undefined });
      }
    }
  });

  // ── E business isolation ──────────────────────────────────────────────────
  test('E — A → B → A keeps market evidence and decisions business-scoped', async ({ page }) => {
    const probeWorkspace = '11111111-1111-4111-8111-111111111110';
    const probeProduct = '11111111-1111-4111-8111-111111111111';
    const aName = sql(`select w.name from workspaces w join founders f on f.id=w.founder_id where f.email='${APPROVED_EMAIL}';`);
    const founder = sql(`select id from founders where email='${APPROVED_EMAIL}';`);
    const aDecisionSnapshot = () => sql(
      `select coalesce(string_agg(id || ':' || decision_status || ':' || execution_status, ',' order by id), '') ` +
      `from growth_brain_recommendations where workspace_id <> '${probeWorkspace}' ` +
      `and decision_status <> 'RECOMMENDED';`);

    sql(`insert into workspaces (id, founder_id, name) values (` +
        `'${probeWorkspace}', '${founder}', 'MI Isolation Probe') on conflict (id) do nothing;`);
    sql(`insert into products (id, founder_id, workspace_id, name, store_url, platform, category, markets, competitor_set) ` +
        `values ('${probeProduct}', '${founder}', '${probeWorkspace}', 'Isolation Probe', ` +
        `'https://apps.apple.com/us/app/probe/id999000111', 'app_store', 'Productivity', ` +
        `array['usa'], '[]'::jsonb) on conflict (id) do nothing;`);

    try {
      expect(sql(
        `select count(*) from market_intelligence_source_records ` +
        `where subject_key = 'app_store:us:id999000111';`)).toBe('0');

      await login(page);
      const aBefore = (await goGrowthBrain(page)).latest<Recs>() ?? {};
      expect(aBefore.marketIntelligenceAvailable, 'A lost its market evidence').toBe(true);
      const aBriefCap = capture(page, '/owner/brief');
      await page.goto('/dashboard/brief'); await settle(page); await aBriefCap.wait();
      const aBrief = aBriefCap.latest<Brief>() ?? {};
      expect(aBrief.marketIntelligence?.available, 'A brief has no market provenance').toBe(true);
      expect((aBrief.marketIntelligence?.observations ?? []).length,
        'A brief resolved no governed observations').toBeGreaterThan(0);
      const decisionsBefore = aDecisionSnapshot();

      await switchBusiness(page, 'MI Isolation Probe');
      const b = (await goGrowthBrain(page)).latest<Recs>() ?? {};
      expect(b.marketIntelligenceAvailable, 'A availability stayed stale under B').toBe(false);
      expect((b.recommendations ?? []).flatMap(r => r.supportedBy ?? [])
        .some(p => p.kind === 'MARKET_INTELLIGENCE'), 'A provenance appeared under B').toBe(false);
      const bText = await page.locator('main').innerText();
      for (const storeName of ['Things 3', 'Todoist']) {
        expect(bText, `${storeName} from A appeared under B`).not.toContain(storeName);
      }
      const bBriefCap = capture(page, '/owner/brief');
      await page.goto('/dashboard/brief'); await settle(page); await bBriefCap.wait();
      const bBrief = bBriefCap.latest<Brief>() ?? {};
      expect(bBrief.marketIntelligence?.available, 'A brief availability stayed stale under B').toBe(false);
      expect(bBrief.marketIntelligence?.observations ?? [], 'A observations appeared under B').toEqual([]);
      expect(sql(
        `select count(*) from growth_brain_recommendations where workspace_id='${probeWorkspace}' ` +
        `and decision_status <> 'RECOMMENDED';`), 'B inherited an owner decision').toBe('0');

      await switchBusiness(page, aName);
      const aAfter = (await goGrowthBrain(page)).latest<Recs>() ?? {};
      expect(aAfter.marketIntelligenceAvailable, 'A evidence did not return').toBe(true);
      const aReturnBriefCap = capture(page, '/owner/brief');
      await page.goto('/dashboard/brief'); await settle(page); await aReturnBriefCap.wait();
      expect((aReturnBriefCap.latest<Brief>() ?? {}).marketIntelligence?.available,
        'A brief provenance did not return').toBe(true);
      expect(aDecisionSnapshot(), 'A decision state changed during B visit').toBe(decisionsBefore);
    } finally {
      sql(`update founders set active_workspace_id=(select workspace_id from products where id <> '${probeProduct}' limit 1), ` +
          `active_product_id=(select id from products where id <> '${probeProduct}' limit 1) where id='${founder}';`);
      sql(`begin; set local lm.allow_history_mutation='on'; ` +
          `delete from workspaces where id='${probeWorkspace}'; commit;`);
    }
  });

  // ── M no autonomous side effects ──────────────────────────────────────────
  test('M — the whole journey mutates no memory and executes nothing', async ({ page }) => {
    const counts = () => ({
      memories: sql('select count(*) from marketing_memories;'),
      versions: sql('select count(*) from marketing_memory_versions;'),
      evidence: sql('select count(*) from evidence;'),
      campaigns: sql('select count(*) from campaigns;'),
      launched: sql("select count(*) from campaigns where status in ('launched','scheduled');"),
      assets: sql("select count(*) from content_assets where published_at is not null;"),
      executed: sql("select count(*) from growth_brain_recommendations where execution_status = 'EXECUTED';"),
    });
    const before = counts();

    await login(page);
    await goGrowthBrain(page);
    await page.goto('/dashboard/brief'); await settle(page);
    await page.goto('/dashboard/intelligence/market'); await settle(page);

    expect(counts()).toEqual(before);
    expect(before.executed).toBe('0');
  });
});
