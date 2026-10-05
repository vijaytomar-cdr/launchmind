/**
 * @file mi-retraction.cert.spec.ts
 * @description BROWSER CLOSURE for Phase 3.4C case G — the retraction notice.
 *
 *   The one thing every earlier pass failed to prove: an owner, in a real
 *   browser, seeing that the evidence behind a decision they already made has
 *   since been withdrawn.
 *
 *   NO FALLBACK BRANCH. An earlier version skipped its own assertion when no
 *   settled card was on screen and reported a pass; that is why this file
 *   asserts the precondition first and fails if it is missing. A run that
 *   cannot find the historical card is a FAILED run, not a skipped one.
 *
 * @security Loopback-only, synthetic staging identity, enforced by
 *   scripts/browser-cert-guard.mjs before the browser starts.
 * @dependencies TEST_EMAIL / TEST_PASSWORD from .env.staging
 */

import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const APPROVED_EMAIL = 'staging@launchmind.test';
const NOTICE = 'This source has since been retracted.';

/** Substrings that must never reach an owner-facing surface. */
const FORBIDDEN = [
  'RETRACTED', 'lifecycle_state', 'source_record_id', 'resolution_id',
  'subject_key', 'content_hash', 'independence', 'authority_policy_version',
  'VERIFIED_EXTERNAL', 'app_store:us:', 'play_store:us:',
];

test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres',
    'supabase_db_launchMind', 'psql', '-U', 'supabase_admin', '-d', 'postgres',
    '-tAc', statement], { encoding: 'utf8' }).trim();
}

async function login(page: Page) {
  expect(EMAIL, 'refusing a non-staging identity').toBe(APPROVED_EMAIL);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL!);
  await page.locator('input[type="password"]').fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 60_000 });
}

/** Waits for the page's own work; these pages never reach network idle. */
async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.body.innerText.trim().length > 200,
    undefined, { timeout: 240_000 });
  await page.waitForTimeout(2_000);
}

/** Captures what the PAGE received, using its own cookie session. */
function capture(page: Page, fragment: string) {
  const seen: Record<string, unknown>[] = [];
  page.on('response', async res => {
    // `/intelligence/recommendations` is a PREFIX of
    // `/intelligence/recommendations/decisions`, so a plain substring match
    // captured the history array as the "latest" recommendations response and
    // read `marketIntelligenceAvailable` off it as undefined. Match the path
    // exactly instead.
    const path = (() => { try { return new URL(res.url()).pathname; } catch { return res.url(); } })();
    if (path !== fragment || res.status() !== 200) return;
    try { seen.push(await res.json() as Record<string, unknown>); } catch { /* not json */ }
  });
  return {
    count: () => seen.length,
    latest<T>(): T | null {
      const raw = seen[seen.length - 1];
      return raw ? ((raw.data ?? raw) as T) : null;
    },
    async wait(ms = 180_000) {
      const start = Date.now();
      while (seen.length === 0 && Date.now() - start < ms) await page.waitForTimeout(500);
      return seen.length > 0;
    },
  };
}

type Hist = Array<{
  id?: string; what?: string; decisionStatus?: string; executionStatus?: string;
  supportedBy?: Array<{ kind: string; label: string; currentLifecycleNotice?: string }>;
}>;

/** The "Recently decided" section only — never the whole page. */
const historySection = (page: Page) => page.getByTestId('recently-decided');

async function openHistory(page: Page) {
  const hist = capture(page, '/intelligence/recommendations/decisions');
  await page.goto('/dashboard/intelligence/growth-brain');
  await settle(page);
  await hist.wait();
  return hist;
}

test.describe('Phase 3.4C — retraction disclosure, real browser', () => {

  test('PRECONDITION — a settled MI-backed card renders under Recently decided', async ({ page }) => {
    // Fail loudly if the fixture is absent. A run without the historical card
    // proves nothing, and must never be reported as a pass.
    expect(Number(sql(
      `select count(*) from growth_brain_recommendations where decision_status='APPROVED';`)),
      'no APPROVED recommendation exists — precondition missing').toBeGreaterThan(0);
    expect(Number(sql(
      `select count(*) from market_intelligence_source_records where lifecycle_state='ACTIVE';`)),
      'no ACTIVE market source exists — precondition missing').toBeGreaterThan(0);

    await login(page);
    const hist = await openHistory(page);
    expect(hist.count(), 'the page never called the decisions endpoint').toBeGreaterThan(0);

    const rows = hist.latest<Hist>() ?? [];
    const target = rows.find(r => (r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'));
    expect(target, 'no MI-backed settled row in the decisions API').toBeTruthy();

    await expect(historySection(page)).toBeVisible({ timeout: 30_000 });
    const section = await historySection(page).innerText();
    expect(section, 'the settled card is not rendered').toContain(target!.what!.slice(0, 40));
    expect(section).toMatch(/approved/i);
    expect(section).toMatch(/App Store observation|Play Store observation/);
  });

  test('BASELINE — an ACTIVE source shows no lifecycle warning', async ({ page }) => {
    await login(page);
    const hist = await openHistory(page);
    const rows = hist.latest<Hist>() ?? [];
    const target = rows.find(r => (r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'))!;

    for (const p of target.supportedBy ?? []) {
      expect(p.currentLifecycleNotice, 'a notice appeared while the source is ACTIVE').toBeUndefined();
    }
    expect(target.decisionStatus).toBe('APPROVED');
    expect(target.executionStatus).toBe('NOT_STARTED');

    const section = await historySection(page).innerText();
    expect(section).not.toContain(NOTICE);
    expect(section).not.toContain('⚠');
  });

  test('DISCLOSURE — after retraction the browser renders the notice', async ({ page }) => {
    // Snapshot BEFORE, so immutability is measured rather than assumed.
    const before = sql(
      `select md5(string_agg(what||why_now||next_step||supported_by::text||fingerprint||` +
      `coalesce(action_key,'')||decision_status||execution_status,'|' order by id)) ` +
      `from growth_brain_recommendations where decision_status<>'RECOMMENDED';`);

    // Production lifecycle path — the same UPDATE setSourceLifecycle performs.
    sql(`update market_intelligence_source_records ` +
        `set lifecycle_state='RETRACTED', lifecycle_reason='browser closure', updated_at=now();`);

    await login(page);
    const hist = await openHistory(page);
    const rows = hist.latest<Hist>() ?? [];
    const target = rows.find(r => (r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'));
    expect(target, 'the historical row disappeared after retraction').toBeTruthy();

    // API first.
    const notices = (target!.supportedBy ?? [])
      .filter(p => p.kind === 'MARKET_INTELLIGENCE')
      .map(p => p.currentLifecycleNotice);
    expect(notices.every(n => n === NOTICE), `API notices: ${JSON.stringify(notices)}`).toBe(true);

    // THEN the rendered page — navigate away and back, so it is not a stale DOM.
    await page.goto('/dashboard/brief');
    await settle(page);
    await page.goto('/dashboard/intelligence/growth-brain');
    await settle(page);
    await expect(historySection(page)).toBeVisible({ timeout: 30_000 });
    const section = await historySection(page).innerText();

    // THE ASSERTION THIS WHOLE PHASE EXISTS FOR.
    expect(section, 'the retraction notice is not visible to the owner').toContain(NOTICE);
    // The frozen claim is still there beside it.
    expect(section).toContain(target!.what!.slice(0, 40));
    expect(section).toMatch(/approved/i);

    // IMMUTABILITY — only the read-time overlay moved.
    expect(sql(
      `select md5(string_agg(what||why_now||next_step||supported_by::text||fingerprint||` +
      `coalesce(action_key,'')||decision_status||execution_status,'|' order by id)) ` +
      `from growth_brain_recommendations where decision_status<>'RECOMMENDED';`)).toBe(before);

    // PRIVACY — owner-safe copy only.
    for (const leak of FORBIDDEN) expect(section, `leaked ${leak}`).not.toContain(leak);
    // The decision badge is uppercased by CSS; that is the STATUS, not a
    // lifecycle enum. Asserted explicitly so the two cannot be confused.
    expect(section).toMatch(/approved/i);
    expect(section).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(section).not.toMatch(/[[({]\s*(?:mi|m)\d{1,3}\b/i);
  });

  test('EXCLUSION — the retracted source cannot reach a NEW generation', async ({ page }) => {
    await login(page);
    const recs = capture(page, '/intelligence/recommendations');
    await page.goto('/dashboard/intelligence/growth-brain');
    await settle(page);
    await recs.wait();

    const d = recs.latest<{ marketIntelligenceAvailable?: boolean;
      recommendations?: Array<{ supportedBy?: Array<{ kind: string }> }> }>() ?? {};
    expect(d.marketIntelligenceAvailable, 'retracted evidence still reported available').toBe(false);
    for (const r of d.recommendations ?? []) {
      expect((r.supportedBy ?? []).some(p => p.kind === 'MARKET_INTELLIGENCE'),
        'a new recommendation cited retracted evidence').toBe(false);
    }
  });

  test('HISTORY CONTROLS + ISOLATION + SIDE EFFECTS', async ({ page }) => {
    const counts = () => ({
      mem: sql('select count(*) from marketing_memories;'),
      ver: sql('select count(*) from marketing_memory_versions;'),
      camp: sql("select count(*) from campaigns where status in ('launched','scheduled');"),
      miss: sql('select count(*) from missions;'),
      pub: sql('select count(*) from content_assets where published_at is not null;'),
      exec: sql("select count(*) from growth_brain_recommendations where execution_status='EXECUTED';"),
    });
    const before = counts();

    await login(page);
    const hist = await openHistory(page);
    const rows = hist.latest<Hist>() ?? [];

    // Settled only: no RECOMMENDED row may appear in history.
    for (const r of rows) expect(r.decisionStatus).not.toBe('RECOMMENDED');
    expect(rows.some(r => r.decisionStatus === 'APPROVED')).toBe(true);
    // One card per owner action — no duplicate from a regenerated snapshot.
    const ids = rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Isolation: history is scoped to the active product of this workspace.
    const inScope = sql(
      `select count(*) from growth_brain_recommendations g join products p on p.id=g.product_id ` +
      `where g.decision_status<>'RECOMMENDED' and p.workspace_id=` +
      `(select workspace_id from products order by created_at limit 1);`);
    expect(rows.length).toBeLessThanOrEqual(Number(inScope));

    expect(counts()).toEqual(before);
    expect(before.exec).toBe('0');

    // Restore for any later run.
    sql(`update market_intelligence_source_records set lifecycle_state='ACTIVE', lifecycle_reason=null;`);
  });
});
