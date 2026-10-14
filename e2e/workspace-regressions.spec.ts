import { expect, test, type Page } from '@playwright/test';
import { livePortfolio, mockLiveWorkspace, navigateWorkspace } from './fixtures';

const demoStorageKey = 'balance.demo.workspace.v1';
const unknownTaxTreatment =
  'The account tax treatment is unknown. Verify the account type before using a plan.';

async function saveReviewedDemoDefaults(page: Page) {
  await page.goto('/demo');
  await page.getByRole('button', { name: /Review targets/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save targets', exact: true }).click();
  await page.getByRole('button', { name: /Review cash reserve/ }).click();
  await page.getByRole('button', { name: /Review classifications/ }).click();
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect(page.locator('.preference-status')).toContainText(
    'Sample preferences saved in this browser.',
  );
}

async function storedDemoReserve(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || '{}').preferences?.reserveCents,
    demoStorageKey,
  );
}

test('demo history writes preserve the saved policy while snapshots retain draft inputs', async ({
  page,
}) => {
  await saveReviewedDemoDefaults(page);
  const reserve = page.getByRole('spinbutton', {
    name: 'Cash reserve per account',
    exact: true,
  });
  await expect(reserve).toHaveValue('250');
  await reserve.fill('1000');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
  await saveDialog
    .getByRole('textbox', { name: 'Plan name', exact: true })
    .fill('Draft reserve plan');
  await saveDialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Draft reserve plan', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('You have unsaved workspace preferences.', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => storedDemoReserve(page)).toBe(25_000);

  await page.reload();
  await navigateWorkspace(page, 'Rebalance');
  await expect(reserve).toHaveValue('250');
  await expect(
    page.getByText('You have unsaved workspace preferences.', { exact: true }),
  ).toHaveCount(0);
  await navigateWorkspace(page, 'Saved plans');
  await page.getByRole('button', { name: 'View snapshot', exact: true }).click();
  const snapshot = page.getByRole('dialog', { name: 'Draft reserve plan', exact: true });
  await expect(snapshot.getByText(/\$1,000\.00 reserve per account/)).toBeVisible();
  await snapshot.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await navigateWorkspace(page, 'Rebalance');
  await reserve.fill('2000');
  await navigateWorkspace(page, 'Saved plans');
  await page.getByRole('button', { name: 'Delete Draft reserve plan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
  ).toBeVisible();
  await expect.poll(() => storedDemoReserve(page)).toBe(25_000);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Draft reserve plan', exact: true }),
  ).toBeVisible();
  await expect.poll(() => storedDemoReserve(page)).toBe(25_000);
  await expect(
    page.getByText('You have unsaved workspace preferences.', { exact: true }),
  ).toBeVisible();

  await page.reload();
  await navigateWorkspace(page, 'Rebalance');
  await expect(reserve).toHaveValue('250');
  await navigateWorkspace(page, 'Saved plans');
  await page.getByRole('button', { name: 'View snapshot', exact: true }).click();
  await expect(snapshot.getByText(/\$1,000\.00 reserve per account/)).toBeVisible();
});

for (const accountType of ['taxable', 'retirement'] as const) {
  test(`connections identify unverified tax treatment until it is confirmed as ${accountType}`, async ({
    page,
  }) => {
    const portfolio = livePortfolio();
    const account = portfolio.accounts[0];
    account.issues.push(unknownTaxTreatment);
    const server = await mockLiveWorkspace(page, portfolio);
    await page.goto('/app');
    await expect(page.getByText('Connected workspace', { exact: true })).toBeVisible();
    await navigateWorkspace(page, 'Connections');
    const card = page.locator('.connection-card').filter({
      has: page.getByRole('heading', { name: account.broker, exact: true }),
    });
    const details = card.locator('.connection-details');
    await expect(details.getByText('Tax treatment unverified', { exact: true })).toBeVisible();
    await expect(details.getByText('Taxable', { exact: true })).toHaveCount(0);
    await expect(details.getByText('Retirement', { exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Review classifications', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Make the assumptions yours.', exact: true });
    await dialog
      .getByRole('combobox', { name: `Tax treatment for ${account.name}`, exact: true })
      .selectOption(accountType);
    await dialog
      .getByRole('checkbox', { name: /^I checked these choices against the underlying assets/ })
      .check();
    await dialog.getByRole('button', { name: 'Use my classifications', exact: true }).click();
    const confirmedLabel = accountType === 'taxable' ? 'Taxable' : 'Retirement';
    await expect(details.getByText(confirmedLabel, { exact: true })).toBeVisible();
    await expect(details.getByText('Tax treatment unverified', { exact: true })).toHaveCount(0);
    await expect(card.getByText(unknownTaxTreatment, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
    await expect
      .poll(() => server.getWorkspace().preferences.accountTypes[account.id])
      .toBe(accountType);
    await page.reload();
    await expect(details.getByText(confirmedLabel, { exact: true })).toBeVisible();
    await expect(details.getByText('Tax treatment unverified', { exact: true })).toHaveCount(0);
  });
}
