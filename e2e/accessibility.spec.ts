import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateWorkspace } from './fixtures';

const violations = (result: Awaited<ReturnType<AxeBuilder['analyze']>>) =>
  result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
  }));

test('landing, workspace, target dialog, and mobile planning meet WCAG A/AA automated checks', async ({
  page,
}) => {
  for (const path of ['/', '/demo']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
});
