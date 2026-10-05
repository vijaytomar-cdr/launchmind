import { test, expect, type Page } from '@playwright/test';
const EMAIL = process.env.TEST_EMAIL, PASSWORD = process.env.TEST_PASSWORD;
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}
test('studio switching', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!EMAIL || !PASSWORD, 'no creds');
  await login(page);
  const read = async () => {
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
    const t = await page.locator('main').innerText();
    return (t.match(/Everything LaunchMind has created for (.+)\./)?.[1] ?? '').trim();
  };
  const waitFor = async (want: string | null) => {
    const end = Date.now() + 45000; let seen = '';
    while (Date.now() < end) { seen = await read(); if (want === null ? !!seen : seen === want) return seen; await page.waitForTimeout(2000); }
    return seen;
  };
  const a = await read();
  console.log(`A = ${a}`);
  console.log(`A campaigns: ${(await page.locator('main').innerText()).includes("Rate Your 'Calling Around'") ? 'AllignX campaign present' : 'absent'}`);
  await page.locator('.lm-biz-trigger').first().click();
  await page.locator('.lm-biz-item').nth(1).click();
  let b = await waitFor(null);
  const end = Date.now() + 45000;
  while (b === a && Date.now() < end) { await page.waitForTimeout(2000); b = await read(); }
  console.log(`B = ${b}`);
  const bText = await page.locator('main').innerText();
  console.log(`B shows AllignX campaign: ${bText.includes("Rate Your 'Calling Around'") ? 'YES — LEAK' : 'no'}`);
  console.log(`B body: ${bText.slice(0, 320).replace(/\n+/g, ' | ')}`);
  expect(bText).not.toContain("Rate Your 'Calling Around'");
  await page.locator('.lm-biz-trigger').first().click();
  await page.locator('.lm-biz-item').nth(0).click();
  const back = await waitFor(a);
  console.log(`back = ${back}`);
  expect(back).toBe(a);
});
