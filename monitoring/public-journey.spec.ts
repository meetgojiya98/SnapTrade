import { expect, test } from '@playwright/test';

// Paste this entire file into a Checkly Browser Check. No credentials or fixtures are needed.
test.use({ viewport: { width: 1440, height: 1000 } });
test.describe.configure({ retries: 0 }); // Configure the single retry in Checkly, not twice.

test('Balance public landing → sample portfolio → funded rebalance', async ({ page, context }) => {
  test.setTimeout(45_000);
  const origin = 'https://balance-snaptrade.vercel.app';
  const privateRequests: string[] = [];

  // Fail if this anonymous journey ever attempts an API call, and block it before sending.
  await context.route(`${origin}/api/**`, async (route) => {
    privateRequests.push(new URL(route.request().url()).pathname);
    await route.abort('blockedbyclient');
  });

  const response = await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'Public landing is available').toBe(200);
  await page.getByRole('link', { name: 'Try the interactive demo', exact: true }).first().click();
  await expect(page).toHaveURL(`${origin}/demo`);
  await expect(
    page.getByRole('banner').getByText('Sample workspace', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your portfolio, in perspective.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value', exact: true })).toContainText(
    '$124,780',
  );

  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: /^Rebalance(?:\s*\d+)?$/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find your balance.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/\d+ proposed moves\. Indicative prices\. No orders placed\./),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Every move has its own funding.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Account funding ledger', exact: true }).getByRole('row'),
  ).toHaveCount(4); // Header plus the three fictional accounts.
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
  expect(privateRequests, 'Public demo must not access private APIs').toEqual([]);
});
