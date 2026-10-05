import { test, expect, type Page } from '@playwright/test';
const EMAIL = process.env.TEST_EMAIL, PASSWORD = process.env.TEST_PASSWORD;
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}
test('sidebar grouping', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!EMAIL || !PASSWORD, 'no creds');
  await login(page);
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  const nav = await page.locator('nav').first().innerText();
  console.log('===== SIDEBAR =====');
  console.log(nav);
  // Both content surfaces sit under CREATE, between COMMAND and EXECUTION.
  const iCommand = nav.indexOf('COMMAND'), iCreate = nav.indexOf('CREATE');
  const iExec = nav.indexOf('EXECUTION'), iIntel = nav.indexOf('INTELLIGENCE');
  expect(iCommand).toBeGreaterThan(-1);
  expect(iCreate).toBeGreaterThan(iCommand);
  expect(iExec).toBeGreaterThan(iCreate);
  expect(iIntel).toBeGreaterThan(iExec);
  const create = nav.slice(iCreate, iExec);
  expect(create).toMatch(/Content Intelligence/);
  expect(create).toMatch(/Content Studio/);
  // Nothing lost.
  for (const l of ['Morning Brief','Opportunities','Approvals','Missions','Campaigns',
                   'Calendar','Experiments','Growth Brain','Improve Intelligence',
                   'Market Intelligence','Marketing Memory','Knowledge Graph',
                   'Launch Readiness','Settings']) {
    expect(nav, `${l} missing from sidebar`).toContain(l);
  }
  // Both links still resolve.
  for (const [name, url] of [['Content Intelligence', /intelligence\/content/],
                             ['Content Studio', /dashboard\/content$/]] as const) {
    await page.getByRole('link', { name: new RegExp(`^${name}$`) }).click();
    // waitForURL, not networkidle — the latter can settle before the client
    // router has navigated, which measures the test's patience, not the link.
    await page.waitForURL(url, { timeout: 20_000 });
    expect(page.url()).toMatch(url);
  }
});
