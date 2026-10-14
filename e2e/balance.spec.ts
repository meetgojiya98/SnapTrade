import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function navigate(page: Page, name: 'Portfolio' | 'Rebalance' | 'Connections') {
  const mobileMenu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    .click();
}

function planSummary(page: Page): Locator {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: /Closer to your kind of balance\./ }),
  });
}

function cashRemaining(page: Page): Locator {
  return planSummary(page).getByRole('definition').last();
}

function dollarValue(value: string | null): number {
  return Number((value ?? '').replace(/[^\d.-]/g, ''));
}

async function assertNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  // Keep this UI suite reproducible even when the developer has live credentials.
  // Protocol and database behavior are verified by the separate server suites.
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: { configured: false, connected: false, requirements: ['SNAPTRADE_CLIENT_ID'] },
    }),
  );
});

test('demo shows its actual total, cash, and twelve positions', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your portfolio, in perspective.' }),
  ).toBeVisible();
  const value = page.getByRole('region', { name: 'Portfolio value' });
  await expect(value).toContainText('$124,780');
  await expect(value).toContainText('$119,330');
  await expect(value).toContainText('$5,450');
  await expect(page.getByText('Demo workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(13);
  await expect(
    page.getByText('Showing 12 positions · cash shown separately', { exact: true }),
  ).toBeVisible();
  if (process.env.CAPTURE_SCREENSHOTS === '1') {
    await mkdir('docs/images', { recursive: true });
    await page.screenshot({ path: 'docs/images/portfolio.png', fullPage: true });
  }
});

test('default plan exports five whole-share moves without taxable-account sells', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Rebalance');
  await expect(page.getByRole('heading', { level: 1, name: 'Find your balance.' })).toBeVisible();
  await expect(
    page.getByText('5 proposed moves. Indicative prices. No orders placed.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: /Allow sales in taxable accounts/ }),
  ).not.toBeChecked();
  if (process.env.CAPTURE_SCREENSHOTS === '1') {
    await mkdir('docs/images', { recursive: true });
    await page.screenshot({ path: 'docs/images/rebalance.png', fullPage: true });
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('balance-rebalance-plan.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  const moves = [...csv.matchAll(/^"([^"]*)","(buy|sell)","([^"]*)","(\d+)"/gm)].map(
    ([, account, side, symbol, shares]) => ({ account, side, symbol, shares: Number(shares) }),
  );
  expect(moves).toHaveLength(5);
  expect(moves.some((move) => move.side === 'sell')).toBe(true);
  expect(
    moves.some((move) => move.account === 'Individual brokerage' && move.side === 'sell'),
  ).toBe(false);
  expect(moves.every((move) => Number.isInteger(move.shares) && move.shares > 0)).toBe(true);
  expect(csv).toContain('no orders placed');
});

test('allocation targets reject an invalid total and retain a valid update', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit targets', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Give your portfolio a direction.' }),
  ).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'US equities target', exact: true }).fill('40');
  await expect(dialog.getByRole('button', { name: 'Save targets', exact: true })).toBeDisabled();
  await expect(dialog.getByText('90%', { exact: true })).toBeVisible();
  await dialog
    .getByRole('spinbutton', { name: 'International equities target', exact: true })
    .fill('40');
  await expect(dialog.getByRole('button', { name: 'Save targets', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save targets', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('Targets updated. Your plan has been recalculated.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit targets', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('spinbutton', { name: 'US equities target', exact: true }),
  ).toHaveValue('40');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('spinbutton', { name: 'International equities target', exact: true }),
  ).toHaveValue('40');
  await expect(
    page.getByRole('dialog').getByRole('spinbutton', { name: 'Bonds target', exact: true }),
  ).toHaveValue('20');
});

test('account selection and holdings search compose without changing account valuation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fidelity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fidelity', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$56,720');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(6);
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill('VTI');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('table')).toContainText('Fidelity');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$56,720');

  await page.getByRole('button', { name: /^All accounts/ }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(13);
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill('not-a-holding');
  await expect(page.getByRole('heading', { name: 'No holdings found', exact: true })).toBeVisible();
});

test('cash reserve recalculates the plan and protects every selected account', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Rebalance');
  const originalCash = await cashRemaining(page).textContent();
  await page
    .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
    .fill('1000');
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();
  await expect(cashRemaining(page)).not.toHaveText(originalCash!);
  expect(dollarValue(await cashRemaining(page).textContent())).toBeGreaterThanOrEqual(3000);
});

test('a minimum trade larger than the portfolio suppresses proposed moves', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Rebalance');
  await page.getByRole('spinbutton', { name: 'Minimum trade value', exact: true }).fill('1000000');
  await expect(
    page.getByRole('heading', { name: 'No practical moves within these boundaries.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
  await expect(cashRemaining(page)).toHaveText('$5,450.00');
});

test('clearing reserve or minimum blocks planning until an explicit value is restored', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Rebalance');
  const reserve = page.getByRole('spinbutton', { name: 'Cash reserve per account', exact: true });
  await reserve.fill('');
  await expect(
    page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
  await reserve.fill('0');
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();

  const minimum = page.getByRole('spinbutton', { name: 'Minimum trade value', exact: true });
  await minimum.fill('');
  await expect(
    page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
  await minimum.fill('100');
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeVisible();
});

test('hypothetical cash is applied to the chosen account and recalculates the plan', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Rebalance');
  const originalSummary = await planSummary(page).textContent();
  await page
    .getByRole('combobox', { name: 'Contribution account', exact: true })
    .selectOption('demo-fidelity');
  await page
    .getByRole('spinbutton', { name: 'Hypothetical contribution', exact: true })
    .fill('1000');
  await expect(planSummary(page)).not.toHaveText(originalSummary!);
  await expect(planSummary(page).getByRole('definition').nth(2)).toHaveText('$1,000.00');
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();
  await navigate(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$124,780');
});

for (const scenario of [
  { value: 'stale', reason: /24 hours/i },
  { value: 'missing', reason: /price/i },
  { value: 'currency', reason: /currenc/i },
]) {
  test(`${scenario.value} data blocks the plan and resetting restores it`, async ({ page }) => {
    await page.goto('/');
    await navigate(page, 'Rebalance');
    await page
      .getByRole('combobox', { name: 'Demo scenario', exact: true })
      .selectOption(scenario.value);
    await expect(
      page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
    ).toBeVisible();
    const blockedPlan = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
    });
    await expect(blockedPlan.getByRole('status')).toContainText(scenario.reason);
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Demo scenario', exact: true })).toHaveValue(
      'normal',
    );
    await expect(
      page.getByText('5 proposed moves. Indicative prices. No orders placed.', { exact: true }),
    ).toBeVisible();
  });
}

test('Connections explains missing OAuth setup and the distinct test workspace', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Connections');
  await expect(
    page.getByRole('heading', { level: 1, name: 'A more connected portfolio.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Connect real accounts in three steps.', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Create a Commercial workspace', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Use a Personal workspace with a sandbox connection to verify sign-in and real API responses.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Read the SnapTrade OAuth guide', exact: true }),
  ).toHaveAttribute('href', 'https://docs.snaptrade.com/docs/oauth-apps');

  await page.getByRole('button', { name: 'Connect with SnapTrade', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Real accounts need a little setup.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Continue with SnapTrade/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'View connection setup', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Connect real accounts in three steps.', exact: true }),
  ).toBeVisible();
});

test('configured OAuth offers the server login route without putting secrets in the URL', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: { configured: true, connected: false, requirements: [] },
    }),
  );
  const statusResponse = page.waitForResponse('**/api/status');
  await page.goto('/');
  await statusResponse;
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: /Continue with SnapTrade/ }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(
    page.getByRole('dialog').getByText('Read-only by design', { exact: true }),
  ).toBeVisible();
});

test('methodology opens accessibly and Escape returns focus to its trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open methodology', exact: true });
  await trigger.click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: 'A plan with nothing to hide.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Targets and drift', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('mobile portfolio, planning, connections, and modal stay within the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your portfolio, in perspective.' }),
  ).toBeVisible();
  await assertNoPageOverflow(page);
  await navigate(page, 'Rebalance');
  await expect(page.getByRole('heading', { level: 1, name: 'Find your balance.' })).toBeVisible();
  await assertNoPageOverflow(page);
  await navigate(page, 'Connections');
  await expect(
    page.getByRole('heading', { level: 1, name: 'A more connected portfolio.' }),
  ).toBeVisible();
  await assertNoPageOverflow(page);
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertNoPageOverflow(page);
});
