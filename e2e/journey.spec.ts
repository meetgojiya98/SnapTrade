import { expect, test } from '@playwright/test';
import { livePortfolio, mockLiveWorkspace, navigateWorkspace } from './fixtures';

test('the public entry makes sample data an explicit choice and the demo never calls private APIs', async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:status|portfolio|workspace|plans|support)(?:[/?]|$)/.test(request.url()))
      privateRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toHaveCount(0);
  await expect(page.getByText('Alex’s workspace', { exact: true })).toHaveCount(0);
  await page
    .getByRole('link', { name: /(?:explore|try|open).*?(?:demo|sample)/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/demo(?:[?#]|$)/);
  await expect(
    page.getByRole('banner').getByText('Sample workspace', { exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, 'Rebalance');
  await expect(
    page.getByText('5 proposed moves. Indicative prices. No orders placed.', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem(
      'balance.demo.workspace.v1',
      '{"version":1,"preferences":{"reserveCents":"invalid"}}',
    ),
  );
  await page.reload();
  await expect(
    page.getByRole('banner').getByText('Sample workspace', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('5 proposed moves. Indicative prices. No orders placed.', { exact: true }),
  ).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test('private workspace loading, failure, and sign-in recovery never display sample accounts', async ({
  page,
}) => {
  await mockLiveWorkspace(page);
  let releaseStatus!: () => void;
  const statusPending = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route('**/api/status', async (route) => {
    await statusPending;
    await route.fulfill({ json: { configured: true, connected: true, requirements: [] } });
  });
  await page.route('**/api/portfolio', (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: 'service_unavailable',
        error: 'The brokerage service is unavailable.',
        requestId: '00000000-0000-4000-8000-000000000001',
      },
    }),
  );
  await page.goto('/app');
  await expect(page.getByTestId('workspace-loading')).toBeVisible();
  await expect(page.getByText('Alex’s workspace', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toHaveCount(0);
  releaseStatus();
  await expect(
    page.getByRole('heading', { name: 'Your portfolio couldn’t be loaded.', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Sample workspace', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reference: 00000000-0000-4000-8000-000000000001' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open support for this error in a new tab', exact: true }),
  ).toHaveAttribute('href', '/support');
  await expect(
    page.getByRole('link', { name: 'Open support for this error in a new tab', exact: true }),
  ).toHaveAttribute('target', '_blank');
  await page.route('**/api/portfolio', (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: 'service_unavailable',
        error: 'The brokerage service is unavailable.',
        requestId: 'account 12345 balance 9000',
      },
    }),
  );
  const failedRetry = page.waitForResponse('**/api/portfolio');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await failedRetry;
  await expect(
    page.getByRole('heading', { name: 'Your portfolio couldn’t be loaded.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The brokerage service is unavailable.' }),
  ).not.toContainText('Reference:');
  await expect(page.getByText('account 12345 balance 9000', { exact: false })).toHaveCount(0);
  await page.route('**/api/portfolio', (route) =>
    route.fulfill({
      status: 401,
      json: null,
    }),
  );
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Bring your accounts into focus.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue with SnapTrade', exact: true }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(page.getByText('Sample workspace', { exact: true })).toHaveCount(0);
});

test('signed-out visitors get a direct consent path with no developer configuration instructions', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { configured: true, connected: false, requirements: [] } }),
  );
  const forbiddenRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(portfolio|workspace|plans)(?:[/?]|$)/.test(request.url()))
      forbiddenRequests.push(request.url());
  });
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Bring your accounts into focus.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue with SnapTrade', exact: true }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(page.getByText(/Create a Commercial workspace|Configure your backend/)).toHaveCount(
    0,
  );
  const checklist = page.getByRole('list', { name: 'Before you connect', exact: true });
  await expect(checklist).toContainText('SnapTrade Personal');
  await expect(checklist).toContainText('CIBC');
  await expect(page.getByText(/up to 5 connected users/)).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});

test('an empty live workspace hands off to Personal brokerage management and reloads connected data', async ({
  page,
}) => {
  const portfolio = livePortfolio();
  portfolio.accounts = [];
  portfolio.warnings = ['No investment accounts are connected.'];
  const server = await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Add your first brokerage account.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Open SnapTrade dashboard/ })).toHaveAttribute(
    'href',
    'https://dashboard.snaptrade.com',
  );
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toHaveCount(0);
  server.setPortfolio(livePortfolio());
  await page.getByRole('button', { name: 'I connected an account, reload', exact: true }).click();
  await expect(page.getByText('Connected workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
});

for (const mode of ['demo', 'live'] as const) {
  test(`${mode} preferences and named historical plans survive reload and can be deleted`, async ({
    page,
  }) => {
    const server = mode === 'live' ? await mockLiveWorkspace(page) : null;
    if (mode === 'live') {
      let firstHistoryLoad = true;
      await page.route('**/api/plans', async (route) => {
        if (route.request().method() === 'GET' && firstHistoryLoad) {
          firstHistoryLoad = false;
          await route.fulfill({
            status: 503,
            json: {
              code: 'service_unavailable',
              error: 'Saved plan history is temporarily unavailable.',
            },
          });
        } else await route.fallback();
      });
    }
    await page.goto(mode === 'demo' ? '/demo' : '/app');
    await expect(
      page
        .getByRole('banner')
        .getByText(mode === 'demo' ? 'Sample workspace' : 'Connected workspace', { exact: true }),
    ).toBeVisible();
    if (mode === 'demo') {
      await page.getByRole('button', { name: /Review targets/ }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Save targets', exact: true })
        .click();
      await page.getByRole('button', { name: /Review cash reserve/ }).click();
      await page.getByRole('button', { name: /Review classifications/ }).click();
      await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
    }
    await navigateWorkspace(page, 'Saved plans');
    if (mode === 'live') {
      await expect(
        page.getByRole('heading', { name: 'Saved history is unavailable.', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Your saved plan history' }),
      ).toContainText('current portfolio and preferences are ready');
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
    }
    await expect(
      page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Build a plan', exact: true }).click();
    await page
      .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
      .fill('1000');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
    await saveDialog
      .getByRole('textbox', { name: 'Plan name', exact: true })
      .fill('Quarterly review');
    await saveDialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
    await navigateWorkspace(page, 'Saved plans');
    await expect(
      page.getByRole('heading', { name: 'Quarterly review', exact: true }),
    ).toBeVisible();
    await navigateWorkspace(page, 'Rebalance');
    await page
      .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
      .fill('2000');
    if (mode === 'live') {
      const leaving = page.waitForEvent('dialog').then(async (confirmation) => {
        expect(confirmation.type()).toBe('beforeunload');
        await confirmation.dismiss();
      });
      await Promise.all([
        leaving,
        page.getByRole('link', { name: 'Balance home', exact: true }).click(),
      ]);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Find your balance.', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('spinbutton', { name: 'Cash reserve per account', exact: true }),
      ).toHaveValue('2000');
    }
    await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
    if (server)
      await expect.poll(() => server.getWorkspace().preferences.reserveCents).toBe(200_000);
    else
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem('balance.demo.workspace.v1') || '{}').preferences
                ?.reserveCents,
          ),
        )
        .toBe(200_000);
    if (server) {
      const latestPortfolio = livePortfolio();
      for (const account of latestPortfolio.accounts) {
        for (const position of account.positions)
          if (position.symbol === 'VTI') position.priceCents = 29_000;
      }
      server.setPortfolio(latestPortfolio);
    }
    await page.reload();
    await expect(
      page
        .getByRole('banner')
        .getByText(mode === 'demo' ? 'Sample workspace' : 'Connected workspace', { exact: true }),
    ).toBeVisible();
    if (server) {
      await navigateWorkspace(page, 'Portfolio');
      await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$126,780');
    }
    await navigateWorkspace(page, 'Rebalance');
    await expect(
      page.getByRole('spinbutton', { name: 'Cash reserve per account', exact: true }),
    ).toHaveValue('2000');
    if (mode === 'live') {
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('balance.')),
        ),
      ).toEqual([]);
    }
    await navigateWorkspace(page, 'Saved plans');
    await page.getByRole('button', { name: 'View snapshot', exact: true }).click();
    const snapshot = page.getByRole('dialog', { name: 'Quarterly review', exact: true });
    await expect(snapshot.getByText(/historical snapshot.*read-only/i)).toBeVisible();
    await expect(
      snapshot.getByRole('heading', { name: 'Preferences used', exact: true }),
    ).toBeVisible();
    await expect(snapshot.getByText(/\$1,000\.00 reserve per account/)).toBeVisible();
    await expect(
      snapshot.getByRole('heading', { name: 'Source accounts', exact: true }),
    ).toBeVisible();
    await snapshot.getByText('Original holdings and prices', { exact: true }).click();
    const historicalHoldings = snapshot.getByRole('region', {
      name: 'Historical holdings, scroll horizontally to see all columns',
      exact: true,
    });
    await expect(historicalHoldings.getByRole('table').getByRole('row')).toHaveCount(13);
    await expect(
      historicalHoldings.getByRole('cell', { name: '$280.00', exact: true }),
    ).toHaveCount(3);
    const downloadPending = page.waitForEvent('download');
    await snapshot.getByRole('button', { name: 'Download historical CSV', exact: true }).click();
    const download = await downloadPending;
    expect(download.suggestedFilename()).toBe('historical-Quarterly-review.csv');
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('HISTORICAL snapshot');
    expect(csv).toContain('Snapshot as of');
    expect(csv).toContain('never executable');
    expect(csv).toContain('# Saved policy,"Reserve per account USD 1000.00;');
    expect(csv).toContain('# Funding equation,');
    expect(csv).toContain('# Account funding,');
    await snapshot.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Delete Quarterly review', exact: true }).click();
    if (mode === 'live') {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete saved plan', exact: true })
        .click();
    }
    await expect(
      page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('banner')
        .getByText(mode === 'demo' ? 'Sample workspace' : 'Connected workspace', { exact: true }),
    ).toBeVisible();
    await navigateWorkspace(page, 'Saved plans');
    await expect(
      page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
    ).toBeVisible();
  });
}

test('committed workspace deletion clears preferences and history while exposing cache cleanup warnings', async ({
  page,
}) => {
  const warning =
    'Saved preferences and plans were deleted, but cleanup of encrypted temporary snapshots could not be confirmed. Older snapshots are invalidated and cannot be reused.';
  const server = await mockLiveWorkspace(page, livePortfolio(), { deleteWarning: warning });
  await page.goto('/app');
  await expect(
    page.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, 'Rebalance');
  await page
    .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
    .fill('1000');
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect.poll(() => server.getWorkspace().preferences.reserveCents).toBe(100_000);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
  await saveDialog
    .getByRole('textbox', { name: 'Plan name', exact: true })
    .fill('Before privacy deletion');
  await saveDialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Before privacy deletion', exact: true }),
  ).toBeVisible();
  await expect.poll(() => server.getPlans().length).toBe(1);

  await navigateWorkspace(page, 'Connections');
  await page.getByRole('button', { name: 'Delete saved workspace data', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', {
    name: 'Delete saved workspace data?',
    exact: true,
  });
  await deleteDialog.getByRole('button', { name: 'Delete all saved data', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: warning })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Make this workspace yours.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }),
  ).toBeVisible();
  expect(server.getWorkspace().updatedAt).toBeNull();
  expect(server.getWorkspace().preferences.reserveCents).toBe(25_000);
  expect(server.getPlans()).toHaveLength(0);
  await navigateWorkspace(page, 'Rebalance');
  await expect(
    page.getByRole('spinbutton', { name: 'Cash reserve per account', exact: true }),
  ).toHaveValue('250');
  await navigateWorkspace(page, 'Saved plans');
  await expect(
    page.getByRole('heading', { name: 'Before privacy deletion', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your first plan belongs here.', exact: true }),
  ).toBeVisible();
});

test('same-broker accounts with identical names retain their identity in selection and funding', async ({
  page,
}) => {
  const portfolio = livePortfolio();
  const names = ['Individual', 'IRA Account', 'Individual'];
  for (const [index, account] of portfolio.accounts.entries()) {
    account.broker = 'SnapTrade Sandbox';
    account.name = names[index];
    account.number = `•••• ${1001 + index}`;
  }
  const server = await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(
    page.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  const cash = page.getByRole('button', {
    name: 'SnapTrade Sandbox · Individual · •••• 1001',
    exact: true,
  });
  const ira = page.getByRole('button', {
    name: 'SnapTrade Sandbox · IRA Account · •••• 1002',
    exact: true,
  });
  const margin = page.getByRole('button', {
    name: 'SnapTrade Sandbox · Individual · •••• 1003',
    exact: true,
  });
  await expect(cash).toBeVisible();
  await expect(ira).toBeVisible();
  await expect(margin).toBeVisible();
  await ira.click();
  await expect(ira).toHaveAttribute('aria-pressed', 'true');
  await expect(cash).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$42,135');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('table')).toContainText('NVDA');
  await expect(page.getByRole('table')).not.toContainText('AAPL');
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect
    .poll(() => server.getWorkspace().preferences.selectedAccountIds)
    .toEqual([portfolio.accounts[1].id]);

  await page.getByRole('button', { name: /^All accounts/ }).click();
  await cash.click();
  await expect(cash).toHaveAttribute('aria-pressed', 'true');
  await expect(ira).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$56,720');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(6);
  await expect(page.getByRole('table')).toContainText('AAPL');
  await expect(page.getByRole('table')).not.toContainText('NVDA');
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect
    .poll(() => server.getWorkspace().preferences.selectedAccountIds)
    .toEqual([portfolio.accounts[0].id]);

  await page.getByRole('button', { name: /^All accounts/ }).click();
  await navigateWorkspace(page, 'Rebalance');
  const destination = page.getByRole('combobox', { name: 'Contribution account', exact: true });
  const firstIndividual = 'SnapTrade Sandbox · Individual · •••• 1001';
  const secondIndividual = 'SnapTrade Sandbox · Individual · •••• 1003';
  await expect(
    destination.getByRole('option', { name: firstIndividual, exact: true }),
  ).toHaveAttribute('value', portfolio.accounts[0].id);
  await expect(
    destination.getByRole('option', { name: secondIndividual, exact: true }),
  ).toHaveAttribute('value', portfolio.accounts[2].id);
  await destination.selectOption({ label: secondIndividual });
  await page
    .getByRole('spinbutton', { name: 'Hypothetical contribution', exact: true })
    .fill('1000');
  const funding = page.getByRole('table', { name: 'Account funding ledger', exact: true });
  await expect(
    funding.getByRole('row').filter({ hasText: '•••• 1001' }).getByRole('cell').nth(1),
  ).toHaveText('$1,800.00');
  await expect(
    funding.getByRole('row').filter({ hasText: '•••• 1003' }).getByRole('cell').nth(1),
  ).toHaveText('$2,450.00');
  await expect(
    page.locator('.trade-row').filter({ hasText: secondIndividual }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
  await saveDialog
    .getByRole('textbox', { name: 'Plan name', exact: true })
    .fill('Distinct account funding');
  await saveDialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Distinct account funding', exact: true }),
  ).toBeVisible();
  expect(server.getPlans()[0].contributionAccountId).toBe(portfolio.accounts[2].id);
  expect(server.getPlans()[0].contributionCents).toBe(100_000);
  await page.getByRole('button', { name: 'View snapshot', exact: true }).click();
  const snapshot = page.getByRole('dialog', { name: 'Distinct account funding', exact: true });
  await expect(
    snapshot.locator('.snapshot-moves').getByText(secondIndividual, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    snapshot
      .getByRole('table', { name: 'Account funding ledger', exact: true })
      .getByRole('row')
      .filter({ hasText: '•••• 1003' })
      .getByRole('cell')
      .nth(1),
  ).toHaveText('$2,450.00');
  await snapshot.getByText('Original holdings and prices', { exact: true }).click();
  const originalHoldings = snapshot.getByRole('region', {
    name: 'Historical holdings, scroll horizontally to see all columns',
    exact: true,
  });
  await expect(originalHoldings.getByRole('row').filter({ hasText: '•••• 1001' })).toHaveCount(5);
  await expect(originalHoldings.getByRole('row').filter({ hasText: '•••• 1003' })).toHaveCount(3);
  const downloadPending = page.waitForEvent('download');
  await snapshot.getByRole('button', { name: 'Download historical CSV', exact: true }).click();
  const download = await downloadPending;
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain(
    '# Hypothetical contribution,"USD 1000.00; destination ' + secondIndividual,
  );
  expect(csv).toContain(
    '# Account funding,"' + firstIndividual + '; reported cash USD 1800.00; new cash USD 0.00',
  );
  expect(csv).toContain(
    '# Account funding,"' + secondIndividual + '; reported cash USD 1450.00; new cash USD 1000.00',
  );
});

test('delayed snapshot reload and logout show their own progress without mislabeling disconnect', async ({
  page,
}) => {
  const portfolio = livePortfolio();
  await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(
    page.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, 'Connections');
  let releaseReload!: () => void;
  const reloadPending = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  await page.route('**/api/portfolio', async (route) => {
    await reloadPending;
    await route.fulfill({ json: portfolio });
  });
  const reloadRequested = page.waitForRequest('**/api/portfolio');
  await page.getByRole('button', { name: 'Reload snapshots', exact: true }).click();
  await reloadRequested;
  try {
    await expect(
      page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Disconnecting…', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading your brokerage snapshots…' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Disconnecting from SnapTrade…' }),
    ).toHaveCount(0);
  } finally {
    releaseReload();
  }
  await expect(
    page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }),
  ).toBeEnabled();

  let releaseLogout!: () => void;
  const logoutPending = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });
  await page.route('**/api/auth/logout', async (route) => {
    await logoutPending;
    await route.fulfill({ json: { disconnected: true, revoked: true } });
  });
  await page.getByRole('button', { name: 'Disconnect SnapTrade', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Disconnecting…', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'Disconnecting from SnapTrade…' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading your brokerage snapshots…' }),
    ).toHaveCount(0);
  } finally {
    releaseLogout();
  }
  await expect(
    page.getByRole('heading', { name: 'Bring your accounts into focus.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnecting…', exact: true })).toHaveCount(0);
  await expect(page.getByText('Sample workspace', { exact: true })).toHaveCount(0);
});

test('a cash-only account explains its investment-selection boundary and can save a baseline snapshot', async ({
  page,
}) => {
  const portfolio = livePortfolio();
  portfolio.accounts = [
    { ...portfolio.accounts[0], name: 'Cash-only account', cashCents: 1_000_000, positions: [] },
  ];
  const server = await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(
    page.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toContainText('$10,000');
  await navigateWorkspace(page, 'Rebalance');
  await expect(
    page.getByRole('heading', { name: 'No holdings available to rebalance.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Balance only buys securities already held in each account. Select an account with supported holdings, or save this cash snapshot as a record of your current position.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No practical moves within these boundaries.', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Cash-only baseline');
  await dialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cash-only baseline', exact: true }),
  ).toBeVisible();
  expect(server.getPlans()).toHaveLength(1);
  expect(server.getPlans()[0].result.status).toBe('ready');
  expect(server.getPlans()[0].result.trades).toEqual([]);
  expect(server.getPlans()[0].source.accounts[0].positions).toEqual([]);
  expect(server.getPlans()[0].source.accounts[0].cashCents).toBe(1_000_000);
  expect(server.getPlans()[0].preferences.reserveCents).toBe(25_000);
  expect(server.getPlans()[0].result.cashAfterCents).toBe(1_000_000);
  expect(server.getPlans()[0].historical).toBe(true);
  expect(server.getPlans()[0].executable).toBe(false);
  await page.getByRole('button', { name: 'View snapshot', exact: true }).click();
  const historical = page.getByRole('dialog', { name: 'Cash-only baseline', exact: true });
  await expect(
    historical.getByText('Historical snapshot · read-only', { exact: true }),
  ).toBeVisible();
  await expect(
    historical.getByText('No proposed moves within the saved boundaries.', { exact: true }),
  ).toBeVisible();
  const downloadPending = page.waitForEvent('download');
  await historical.getByRole('button', { name: 'Download historical CSV', exact: true }).click();
  const download = await downloadPending;
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('# Saved policy,"Reserve per account USD 250.00;');
  expect(csv).toContain('# Saved result,"Planning base USD 9750.00;');
  expect(csv).toContain('0 proposed moves');
  expect(csv).toContain(
    '# Account funding,"Fidelity · Cash-only account · ••4821; reported cash USD 10000.00;',
  );
  expect(csv).toContain('cash after USD 10000.00; protected reserve USD 250.00;');
});
