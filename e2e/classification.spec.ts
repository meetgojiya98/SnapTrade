import { expect, test, type Page } from '@playwright/test';
import { makeDemoPortfolio } from '../src/lib/demo';
import type { Portfolio } from '../src/lib/types';
import {
  livePortfolioNeedingClassification,
  mockLiveWorkspace,
  navigateWorkspace,
} from './fixtures';

const unknownTax =
  'The account tax treatment is unknown. Verify the account type before using a plan.';

async function loadLiveFixture(page: Page, portfolio: Portfolio) {
  const server = await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(page.getByText('Connected workspace', { exact: true })).toBeVisible();
  return server;
}

async function openRebalance(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Rebalance', exact: true })
    .click();
}

async function confirmAssetClass(page: Page) {
  await page.getByRole('button', { name: 'Review classifications', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Make the assumptions yours.', exact: true });
  await dialog
    .getByRole('combobox', { name: 'SCHB classification in Account needing review', exact: true })
    .selectOption('us-equity');
  await dialog
    .getByRole('checkbox', { name: /^I checked these choices against the underlying assets/ })
    .check();
  await dialog.getByRole('button', { name: 'Use my classifications', exact: true }).click();
}

test('explicit asset and account review persists across reload without overriding other data checks', async ({
  page,
}) => {
  const portfolio = livePortfolioNeedingClassification();
  portfolio.accounts[0].issues.push(unknownTax);
  const server = await loadLiveFixture(page, portfolio);
  await openRebalance(page);
  await expect(
    page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review classifications', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Make the assumptions yours.', exact: true });
  await dialog
    .getByRole('combobox', { name: 'SCHB classification in Account needing review', exact: true })
    .selectOption('us-equity');
  await expect(
    dialog.getByRole('button', { name: 'Use my classifications', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: /^I checked these choices against the underlying assets/ })
    .check();
  await dialog.getByRole('button', { name: 'Use my classifications', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  ).toBeVisible();
  const blockedPlan = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  });
  await expect(blockedPlan.getByRole('status')).toContainText('tax treatment is unknown');
  await expect(blockedPlan.getByRole('status')).not.toContainText('asset class is unverified');

  await page.getByRole('button', { name: 'Review classifications', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Make the assumptions yours.', exact: true });
  await expect(
    dialog.getByRole('combobox', {
      name: 'SCHB classification in Account needing review',
      exact: true,
    }),
  ).toHaveValue('us-equity');
  await dialog
    .getByRole('combobox', { name: 'Tax treatment for Account needing review', exact: true })
    .selectOption('taxable');
  await dialog
    .getByRole('checkbox', { name: /^I checked these choices against the underlying assets/ })
    .check();
  await dialog.getByRole('button', { name: 'Use my classifications', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect
    .poll(() => server.getWorkspace().preferences.accountTypes['live-review-account'])
    .toBe('taxable');
  await page.reload();
  await expect(page.getByText('Connected workspace', { exact: true })).toBeVisible();
  await openRebalance(page);
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();
});

for (const issue of ['missing price', 'stale snapshot'] as const) {
  test(`confirming an asset class cannot override a ${issue}`, async ({ page }) => {
    const portfolio = livePortfolioNeedingClassification();
    if (issue === 'missing price') {
      portfolio.accounts[0].positions[0].priceCents = null;
      portfolio.accounts[0].issues.push('SCHB: a valid market price is required.');
    } else {
      portfolio.accounts[0].syncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    }
    await loadLiveFixture(page, portfolio);
    await openRebalance(page);
    await confirmAssetClass(page);
    await expect(
      page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
    ).toBeVisible();
    const blockedPlan = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
    });
    await expect(blockedPlan.getByRole('status')).toContainText(
      issue === 'missing price' ? /price/i : /24 hours/i,
    );
    await expect(blockedPlan.getByRole('status')).not.toContainText('asset class is unverified');
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
    if (issue === 'stale snapshot') {
      portfolio.accounts[0].syncedAt = new Date().toISOString();
      await page.getByRole('button', { name: 'Review account data', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'A more connected portfolio.', exact: true }),
      ).toBeVisible();
      const reloaded = page.waitForResponse('**/api/portfolio');
      await page.getByRole('button', { name: 'Reload snapshots', exact: true }).click();
      await reloaded;
      await navigateWorkspace(page, 'Rebalance');
      await expect(
        page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
      ).toBeVisible();
    }
  });
}

for (const { revoked, warning } of [
  {
    revoked: false,
    warning:
      'Local credentials were deleted, but remote revocation could not be confirmed. Remove this app in your SnapTrade dashboard.',
  },
  {
    revoked: true,
    warning:
      'Cleanup of the encrypted temporary snapshot could not be confirmed. Your ended session cannot access it.',
  },
]) {
  test(`disconnect deletes local access and shows recovery warnings when revoked=${revoked}`, async ({
    page,
  }) => {
    const portfolio = makeDemoPortfolio();
    portfolio.mode = 'live';
    portfolio.warnings = [];
    await page.route('**/api/auth/logout', (route) =>
      route.fulfill({
        json: { disconnected: true, revoked, warning },
      }),
    );
    await loadLiveFixture(page, portfolio);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: /^Connections/ })
      .click();
    await page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Bring your accounts into focus.', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Sample workspace', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: warning })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }),
    ).toHaveCount(0);
  });
}

test('an open live snapshot expires as time advances and cannot be exported', async ({ page }) => {
  const now = new Date();
  await page.clock.install({ time: now });
  const portfolio = makeDemoPortfolio();
  portfolio.mode = 'live';
  portfolio.warnings = [];
  portfolio.accounts[0].syncedAt = new Date(
    now.getTime() - (23 * 60 + 59) * 60 * 1000,
  ).toISOString();
  await loadLiveFixture(page, portfolio);
  await openRebalance(page);
  await expect(
    page.getByRole('heading', { name: 'A plan you can understand.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeVisible();
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.clock.fastForward(2 * 60 * 1000);
  await expect(
    page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  ).toBeVisible();
  const blockedPlan = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Let’s resolve the data first.', exact: true }),
  });
  await expect(blockedPlan.getByRole('status')).toContainText('24 hours');
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
  expect(downloads).toEqual([]);
});
