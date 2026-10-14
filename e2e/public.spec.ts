import { expect, test, type Page } from '@playwright/test';

const privateApi = /\/api\/(?:status|portfolio|workspace|plans|support|auth)(?:[/?]|$)/;

async function withinViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test('public resources lead through the sample and safe support draft to an informed connection gate', async ({
  browser,
  page,
  context,
}) => {
  const privateRequests: string[] = [];
  const runtimeErrors: string[] = [];
  const captureErrors = (surface: Page) =>
    surface.on('pageerror', (error) => runtimeErrors.push(error.message));
  captureErrors(page);
  context.on('page', captureErrors);
  context.on('request', (request) => {
    if (privateApi.test(request.url())) privateRequests.push(new URL(request.url()).pathname);
  });
  await context.route('**/api/status', (route) =>
    route.fulfill({ json: { configured: true, connected: false, requirements: [] } }),
  );
  for (const path of ['/', '/guide', '/support', '/privacy', '/signin', '/signup']) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} response`).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical, `${path} canonical`).toHaveAttribute('href', /^https:\/\//);
    expect(new URL((await canonical.getAttribute('href'))!).pathname).toBe(path);
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  noScript.on('request', (request) => {
    if (privateApi.test(request.url())) privateRequests.push(new URL(request.url()).pathname);
  });
  try {
    const help = await noScript.newPage();
    await help.goto(new URL('/support', page.url()).toString());
    await expect(
      help.getByRole('textbox', { name: 'Request reference (optional)', exact: true }),
    ).toBeDisabled();
    await expect(
      help.getByRole('combobox', { name: 'What needs attention?', exact: true }),
    ).toBeDisabled();
    await expect(
      help.getByText('Review issue draft on GitHub', { exact: true }),
    ).not.toHaveAttribute('href', /.+/);
    await expect(
      help.getByRole('link', { name: 'write a public issue on GitHub', exact: true }),
    ).toHaveAttribute('href', 'https://github.com/meetgojiya98/SnapTrade/issues/new');
  } finally {
    await noScript.close();
  }
  const missing = await page.goto('/this-balance-page-does-not-exist');
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'A little off course.', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to Balance', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Try the interactive demo', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/demo(?:[?#]|$)/);
  await expect(
    page.getByRole('banner').getByText('Sample workspace', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const guideLink = page.getByRole('link', { name: 'Open the guide in a new tab', exact: true });
  await expect(guideLink).toHaveAttribute('target', '_blank');
  const opened = page.waitForEvent('popup');
  await guideLink.click();
  const guide = await opened;
  await expect(
    guide.getByRole('heading', {
      name: 'From a scattered portfolio to a considered plan.',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('banner').getByText('Sample workspace', { exact: true }),
  ).toBeVisible();
  await guide
    .getByRole('navigation', { name: 'Resources navigation', exact: true })
    .getByRole('link', { name: 'Support', exact: true })
    .focus();
  await guide.keyboard.press('Enter');
  await expect(guide).toHaveURL(/\/support$/);
  await expect(
    guide.getByRole('heading', { name: 'A clear next step, when you need one.', exact: true }),
  ).toBeVisible();
  const reference = guide.getByRole('textbox', {
    name: 'Request reference (optional)',
    exact: true,
  });
  const issueDraft = guide.getByRole('link', { name: 'Review issue draft on GitHub', exact: true });
  await reference.fill('account 12345 balance 9000');
  await expect(reference).toHaveAttribute('aria-invalid', 'true');
  expect(new URL((await issueDraft.getAttribute('href'))!).searchParams.get('body')).not.toContain(
    'account 12345 balance 9000',
  );
  await issueDraft.click();
  await expect(reference).toBeFocused();
  const requestReference = '00000000-0000-4000-8000-000000000001';
  await reference.fill(requestReference);
  await guide
    .getByRole('combobox', { name: 'What needs attention?', exact: true })
    .selectOption('Saved plans or export');
  await expect(reference).toHaveAttribute('aria-invalid', 'false');
  const draftUrl = new URL((await issueDraft.getAttribute('href'))!);
  expect(draftUrl.origin).toBe('https://github.com');
  expect(draftUrl.pathname).toBe('/meetgojiya98/SnapTrade/issues/new');
  expect(draftUrl.searchParams.get('title')).toBe('[Balance] Saved plans or export');
  expect(draftUrl.searchParams.get('body')).toContain(`Request reference: ${requestReference}`);
  expect(draftUrl.searchParams.get('body')).toContain('GitHub issues are public');
  expect(privateRequests).toEqual([]);
  await guide
    .getByRole('banner')
    .getByRole('link', { name: 'Open workspace', exact: true })
    .focus();
  await guide.keyboard.press('Enter');
  await expect(
    guide.getByRole('heading', { name: 'Sign in to Balance.', exact: true }),
  ).toBeVisible();
  await expect(guide.getByRole('list', { name: 'Before you connect', exact: true })).toContainText(
    'SnapTrade Personal',
  );
  await expect(guide.getByRole('list', { name: 'Before you connect', exact: true })).toContainText(
    'CIBC',
  );
  await expect(guide.getByText(/up to 5 connected users/)).toBeVisible();
  await expect(
    guide.getByRole('link', { name: 'Continue with SnapTrade', exact: true }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(guide.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(privateRequests.length).toBeGreaterThan(0);
  expect([...new Set(privateRequests)]).toEqual(['/api/status']);
  expect(runtimeErrors).toEqual([]);
});

test('the landing simulation and mobile navigation work with a keyboard without private API calls', async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (privateApi.test(request.url())) privateRequests.push(request.url());
  });
  await page.goto('/');
  const preview = page.getByRole('region', { name: 'Sample allocation preview', exact: true });
  const before = preview.getByRole('button', { name: 'Before plan', exact: true });
  const after = preview.getByRole('button', { name: 'After simulation', exact: true });
  await expect(before).toHaveAttribute('aria-pressed', 'true');
  const current = await preview.textContent();
  await after.focus();
  await page.keyboard.press('Space');
  await expect(after).toHaveAttribute('aria-pressed', 'true');
  await expect(before).toHaveAttribute('aria-pressed', 'false');
  await expect(preview).not.toHaveText(current!);
  await expect(preview.getByRole('img')).toHaveAccessibleName(
    'Simulated sample allocation. Percentages are listed alongside.',
  );
  await before.focus();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveText(current!);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await withinViewport(page);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Get started', exact: true }),
    ).toBeVisible();
    for (const control of [
      page.getByRole('banner').getByRole('link', { name: 'Balance home', exact: true }),
      page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }),
      page.getByRole('banner').getByRole('link', { name: 'Get started', exact: true }),
      page.getByRole('button', { name: 'Open navigation', exact: true }),
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
  const menuButton = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await menu.getByRole('link', { name: 'Guide', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await page.keyboard.press('Enter');
  await menu.getByRole('link', { name: 'Guide', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await withinViewport(page);
  await page
    .getByRole('navigation', { name: 'Footer navigation', exact: true })
    .getByRole('link', { name: 'Support', exact: true })
    .click();
  await expect(page).toHaveURL(/\/support$/);
  await withinViewport(page);
  await page
    .getByRole('navigation', { name: 'Footer navigation', exact: true })
    .getByRole('link', { name: 'Privacy', exact: true })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
  await withinViewport(page);
  expect(privateRequests).toEqual([]);
});

test('sign-in and signup explain the Personal account journey and start OAuth only after explicit continuation', async ({
  page,
  context,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\//.test(request.url())) apiRequests.push(new URL(request.url()).pathname);
  });
  // Verify the UI handoff without creating provider state, identities or grants.
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><h1>Authorization handoff reached.</h1></body></html>',
    }),
  );
  await page.goto('/');
  const banner = page.getByRole('banner');
  const signIn = banner.getByRole('link', { name: 'Sign in', exact: true });
  await expect(signIn).toHaveAttribute('href', '/signin');
  await expect(banner.getByRole('link', { name: 'Get started', exact: true })).toHaveAttribute(
    'href',
    '/signup',
  );
  await signIn.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to Balance.', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Account access', exact: true })
      .getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Create your workspace', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create your Balance workspace.', exact: true }),
  ).toBeVisible();
  const setup = page.getByRole('list', { name: 'Create your connected workspace', exact: true });
  await expect(setup).toContainText('choose Personal, sign up, and verify your email');
  await expect(setup).toContainText('returning to Balance');
  const dashboard = page.getByRole('link', { name: 'Open SnapTrade Personal', exact: true });
  await expect(dashboard).toHaveAttribute('href', 'https://dashboard.snaptrade.com');
  await expect(dashboard).toHaveAttribute('target', '_blank');
  await expect(dashboard).toHaveAttribute('rel', /noreferrer/);
  await expect(
    page.getByRole('link', { name: 'Follow SnapTrade’s account setup guide', exact: true }),
  ).toHaveAttribute('href', 'https://snaptrade.com/personal-account-setup');
  await expect(page.getByRole('main')).toContainText('do not need a separate Balance password');
  await expect(page.getByRole('main')).toContainText('CIBC');
  await expect(page.getByRole('main')).toContainText('up to 5 users');
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(
    (await context.cookies()).filter((cookie) => /balance_(?:login|session)/.test(cookie.name)),
  ).toEqual([]);
  const create = page.getByRole('link', { name: 'Create workspace with SnapTrade', exact: true });
  await expect(create).toHaveAttribute('href', '/api/auth/login');
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Authorization handoff reached.', exact: true }),
  ).toBeVisible();
  expect(apiRequests).toEqual(['/api/auth/login']);
  await page.goBack();
  await expect(page).toHaveURL(/\/signup$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await withinViewport(page);
  await page.getByRole('link', { name: 'Sign in instead', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/signin$/);
  await withinViewport(page);
  await expect(
    page.getByRole('link', { name: 'Open your workspace', exact: true }),
  ).toHaveAttribute('href', '/app');
  const continueSignIn = page.getByRole('link', { name: 'Sign in with SnapTrade', exact: true });
  await expect(continueSignIn).toHaveAttribute('href', '/api/auth/login');
  expect(apiRequests).toEqual(['/api/auth/login']);
  await continueSignIn.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Authorization handoff reached.', exact: true }),
  ).toBeVisible();
  expect(apiRequests).toEqual(['/api/auth/login', '/api/auth/login']);
});
