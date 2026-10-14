import { expect, test } from '@playwright/test';
import { livePortfolio, mockLiveWorkspace, navigateWorkspace } from './fixtures';

test('the public entry makes sample data an explicit choice and the demo never calls private APIs', async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:status|portfolio|workspace|plans)(?:[/?]|$)/.test(request.url()))
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
      status: 502,
      json: { code: 'upstream_unavailable', error: 'The brokerage service is unavailable.' },
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
  await page.route('**/api/portfolio', (route) =>
    route.fulfill({
      status: 401,
      json: {
        code: 'reconnect_required',
        error: 'Your SnapTrade session has ended. Connect again to continue.',
      },
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
