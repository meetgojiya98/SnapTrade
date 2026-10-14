import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateWorkspace } from './fixtures';

const violations = (result: Awaited<ReturnType<AxeBuilder['analyze']>>) =>
  result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
  }));

test('public resources, connection gate, workspace, dialogs, and mobile navigation meet WCAG A/AA automated checks', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { configured: true, connected: false, requirements: [] } }),
  );
  for (const path of [
    '/',
    '/guide',
    '/support',
    '/privacy',
    '/signin',
    '/signup',
    '/app',
    '/demo',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (path === '/app')
      await expect(
        page.getByRole('heading', { name: 'Sign in to Balance.', exact: true }),
      ).toBeVisible();
    if (path === '/demo')
      await expect(
        page.getByRole('banner').getByText('Sample workspace', { exact: true }),
      ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect.soft(violations(result), `${path} accessibility violations`).toEqual([]);
  }
  await page.getByRole('button', { name: 'Edit targets', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialogResult = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect.soft(violations(dialogResult), 'Target dialog accessibility violations').toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateWorkspace(page, 'Rebalance');
  const mobileResult = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect.soft(violations(mobileResult), 'Mobile planner accessibility violations').toEqual([]);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const mobileLanding = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect.soft(violations(mobileLanding), 'Mobile landing accessibility violations').toEqual([]);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation', exact: true }),
  ).toBeVisible();
  const mobileMenu = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect.soft(violations(mobileMenu), 'Mobile navigation accessibility violations').toEqual([]);
  for (const path of ['/signin', '/signup']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const authPage = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect.soft(violations(authPage), `Mobile ${path} accessibility violations`).toEqual([]);
  }
});
