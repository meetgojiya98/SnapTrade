import { expect, test, type Page } from '@playwright/test';
import { defaultWorkspacePreferences } from '../src/lib/workspace';
import { livePortfolio, mockLiveWorkspace, navigateWorkspace } from './fixtures';

const signedOutNotice =
  'Signed out. Your saved preferences and plans are kept for your next sign-in.';

function signOut(page: Page) {
  return page.getByRole('banner').getByRole('button', { name: 'Sign out', exact: true });
}

async function expectSignedOut(page: Page) {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to Balance.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', '/signin');
  await expect(signOut(page)).toHaveCount(0);
}

test('every workspace view exposes a sign-out action without opening connections', async ({
  page,
}) => {
  await mockLiveWorkspace(page);
  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  for (const view of ['Portfolio', 'Rebalance', 'Saved plans', 'Connections'] as const) {
    await navigateWorkspace(page, view);
    await expect(signOut(page)).toBeVisible();
    await expect(signOut(page)).toBeEnabled();
  }
});

test('signing out clears displayed private data while keeping saved preferences, plans, and brokerage access', async ({
  page,
}) => {
  const server = await mockLiveWorkspace(page);
  const destructiveRequests: string[] = [];
  const signOutRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' || new URL(request.url()).pathname === '/api/auth/logout')
      destructiveRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    if (new URL(request.url()).pathname === '/api/auth/signout')
      signOutRequests.push(request.method());
  });
  await page.route('**/api/auth/signout', (route) => route.fulfill({ json: { signedOut: true } }));
  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  await navigateWorkspace(page, 'Rebalance');
  await page
    .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
    .fill('1000');
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await expect.poll(() => server.getWorkspace().preferences.reserveCents).toBe(100_000);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this plan', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Plan name', exact: true })
    .fill('Private retirement plan');
  await dialog.getByRole('button', { name: 'Save plan snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private retirement plan', exact: true }),
  ).toBeVisible();
  const savedWorkspace = structuredClone(server.getWorkspace());
  const savedPlans = structuredClone(server.getPlans());

  await signOut(page).click();
  await expectSignedOut(page);
  await expect(page.getByText(signedOutNotice, { exact: true })).toBeVisible();
  await expect(page.getByText('Private retirement plan', { exact: true })).toHaveCount(0);
  await expect(page.getByText('••4821', { exact: false })).toHaveCount(0);
  expect(server.getWorkspace()).toEqual(savedWorkspace);
  expect(server.getPlans()).toEqual(savedPlans);
  expect(destructiveRequests).toEqual([]);
  expect(signOutRequests).toEqual(['POST']);
});

test('pending sign-out has clear progress and a failed attempt can be retried', async ({
  page,
}) => {
  await mockLiveWorkspace(page);
  let releaseSignOut!: () => void;
  const pendingSignOut = new Promise<void>((resolve) => {
    releaseSignOut = resolve;
  });
  let attempts = 0;
  await page.route('**/api/auth/signout', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await pendingSignOut;
      await route.fulfill({
        status: 503,
        json: { error: 'Sign-out is temporarily unavailable. Try again.' },
      });
    } else await route.fulfill({ json: { signedOut: true } });
  });
  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  await signOut(page).click();
  try {
    await expect(
      page.getByRole('banner').getByRole('button', { name: 'Signing out…', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Disconnecting…', exact: true })).toHaveCount(0);
  } finally {
    releaseSignOut();
  }
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Sign-out is temporarily unavailable. Try again.',
  );
  await expect(signOut(page)).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  await signOut(page).click();
  await expectSignedOut(page);
  expect(attempts).toBe(2);
});

for (const state of ['loading', 'error', 'empty'] as const) {
  test(`sign-out remains reachable from the ${state} workspace state`, async ({ page }) => {
    const portfolio = livePortfolio();
    if (state === 'empty') portfolio.accounts = [];
    await mockLiveWorkspace(page, portfolio);
    let releaseStatus = () => {};
    if (state === 'loading') {
      const pendingStatus = new Promise<void>((resolve) => {
        releaseStatus = resolve;
      });
      await page.route('**/api/status', async (route) => {
        await pendingStatus;
        await route.fulfill({ json: { configured: true, connected: true, requirements: [] } });
      });
    }
    if (state === 'error')
      await page.route('**/api/portfolio', (route) =>
        route.fulfill({ status: 503, json: { error: 'The brokerage service is unavailable.' } }),
      );
    await page.route('**/api/auth/signout', (route) =>
      route.fulfill({ json: { signedOut: true } }),
    );
    const statusRequested = state === 'loading' ? page.waitForRequest('**/api/status') : null;
    await page.goto('/app');
    try {
      if (state === 'loading') await expect(page.getByTestId('workspace-loading')).toBeVisible();
      else
        await expect(
          page.getByRole('heading', {
            name:
              state === 'empty'
                ? 'Add your first brokerage account.'
                : 'Your portfolio couldn’t be loaded.',
            exact: true,
          }),
        ).toBeVisible();
      await expect(signOut(page)).toBeEnabled();
      await signOut(page).click();
      await expectSignedOut(page);
    } finally {
      releaseStatus();
    }
    if (statusRequested) {
      const response = await (await statusRequested).response();
      await response?.finished();
    }
    await expectSignedOut(page);
  });
}

test('a failed sign-out during initial loading offers a working workspace retry', async ({
  page,
}) => {
  await mockLiveWorkspace(page);
  let releaseStatus!: () => void;
  const pendingStatus = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  let statusRequests = 0;
  let allowStatus = false;
  await page.route('**/api/status', async (route) => {
    statusRequests += 1;
    if (!allowStatus) await pendingStatus;
    await route.fulfill({ json: { configured: true, connected: true, requirements: [] } });
  });
  await page.route('**/api/auth/signout', (route) =>
    route.fulfill({ status: 503, json: { error: 'Sign-out is temporarily unavailable.' } }),
  );
  const statusRequested = page.waitForRequest('**/api/status');
  await page.goto('/app');
  await statusRequested;
  try {
    await expect(page.getByTestId('workspace-loading')).toBeVisible();
    await signOut(page).click();
    await expect(page.getByTestId('workspace-loading')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Your portfolio couldn’t be loaded.', exact: true }),
    ).toBeVisible();
    const initialRequests = statusRequests;
    allowStatus = true;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
    await expect(signOut(page)).toBeEnabled();
    expect(statusRequests).toBeGreaterThan(initialRequests);
  } finally {
    releaseStatus();
  }
});

test('an expired saved-history request cannot be undone by a concurrent portfolio reload', async ({
  page,
}) => {
  const portfolio = livePortfolio();
  await mockLiveWorkspace(page, portfolio);
  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  let releaseHistory!: () => void;
  let releasePortfolio!: () => void;
  const pendingHistory = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const pendingPortfolio = new Promise<void>((resolve) => {
    releasePortfolio = resolve;
  });
  await page.route('**/api/plans', async (route) => {
    await pendingHistory;
    await route.fulfill({ status: 401, json: { error: 'Your session has expired.' } });
  });
  await page.route('**/api/portfolio', async (route) => {
    await pendingPortfolio;
    await route.fulfill({ json: portfolio });
  });
  await navigateWorkspace(page, 'Saved plans');
  const historyRequested = page.waitForRequest('**/api/plans');
  await page.getByRole('button', { name: 'Reload history', exact: true }).click();
  await historyRequested;
  await navigateWorkspace(page, 'Connections');
  const portfolioRequested = page.waitForRequest('**/api/portfolio');
  await page.getByRole('button', { name: 'Reload snapshots', exact: true }).click();
  const portfolioRequest = await portfolioRequested;
  try {
    releaseHistory();
    await expectSignedOut(page);
    releasePortfolio();
    const response = await portfolioRequest.response();
    await response?.finished();
    await expectSignedOut(page);
    await expect(page.getByText('Connected workspace', { exact: true })).toHaveCount(0);
  } finally {
    releaseHistory();
    releasePortfolio();
  }
});

test('a late preferences error cannot replace a completed sign-out', async ({ page }) => {
  await mockLiveWorkspace(page);
  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  let releaseSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await pendingSave;
    await route.fulfill({ status: 503, json: { error: 'A late preferences failure.' } });
  });
  await page.route('**/api/auth/signout', (route) => route.fulfill({ json: { signedOut: true } }));
  await navigateWorkspace(page, 'Rebalance');
  await page
    .getByRole('spinbutton', { name: 'Cash reserve per account', exact: true })
    .fill('1000');
  const saveRequested = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/workspace' && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save workspace preferences', exact: true }).click();
  await saveRequested;
  try {
    await signOut(page).click();
    await expectSignedOut(page);
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/workspace' &&
        response.request().method() === 'PUT',
    );
    releaseSave();
    await (await saveResponse).finished();
    await expectSignedOut(page);
    await expect(page.getByText('A late preferences failure.', { exact: false })).toHaveCount(0);
    await expect(page.getByText(signedOutNotice, { exact: true })).toBeVisible();
  } finally {
    releaseSave();
  }
});

test('signing out also clears private data in another open workspace tab', async ({
  page,
  context,
}) => {
  const otherPage = await context.newPage();
  await mockLiveWorkspace(page);
  await mockLiveWorkspace(otherPage);
  await page.route('**/api/auth/signout', (route) => route.fulfill({ json: { signedOut: true } }));
  await page.goto('/app');
  await otherPage.goto('/app?view=connections');
  await expect(page.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  await expect(
    otherPage.getByRole('banner').getByText('Connected workspace', { exact: true }),
  ).toBeVisible();
  await signOut(page).click();
  await expectSignedOut(page);
  await expectSignedOut(otherPage);
  await expect(
    otherPage.getByText('You were signed out in another tab. Sign in again to continue.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(otherPage.getByText('••4821', { exact: false })).toHaveCount(0);
});

test('mobile navigation contains keyboard focus, dismisses with Escape, and focuses the selected view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Build a rebalance plan', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find your balance.', exact: true }),
  ).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  const openNavigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  await openNavigation.click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  await expect(drawer).toBeVisible();
  await expect
    .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  const focusable = drawer.locator('a[href], button:not([disabled]), [tabindex="0"]');
  const last = focusable.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect
    .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(openNavigation).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await openNavigation.click();
  await drawer.getByRole('button', { name: /^Saved plans(?:\s*\d+)?$/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('main')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page).toHaveURL(/view=plans/);
});

test('exiting the demo returns home without signing out or deleting sample preferences', async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:status|portfolio|workspace|plans|support|auth)(?:[/?]|$)/.test(request.url()))
      privateRequests.push(request.url());
  });
  await page.goto('/demo');
  const storedSample = JSON.stringify({
    version: 1,
    preferences: { ...defaultWorkspacePreferences, reserveCents: 50_000 },
    onboarded: true,
    plans: [],
  });
  await page.evaluate(
    (value) => localStorage.setItem('balance.demo.workspace.v1', value),
    storedSample,
  );
  const exitDemo = page.getByRole('banner').getByRole('link', { name: 'Exit demo', exact: true });
  await expect(exitDemo).toHaveAttribute('href', '/');
  await exitDemo.click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('balance.demo.workspace.v1'))).toBe(
    storedSample,
  );
  expect(privateRequests).toEqual([]);
});
