import type { Page } from '@playwright/test';
import { makeDemoPortfolio } from '../src/lib/demo';
import { generatePlan } from '../src/lib/planner';
import type { Portfolio } from '../src/lib/types';
import {
  defaultWorkspacePreferences,
  summarizePlan,
  type SavedPlan,
  type SavePlanInput,
  type Workspace,
} from '../src/lib/workspace';

/** Controlled normalized data. These fixtures do not verify external brokerage access. */
export function livePortfolio(): Portfolio {
  const portfolio = makeDemoPortfolio();
  portfolio.mode = 'live';
  portfolio.warnings = [];
  return portfolio;
}

export function livePortfolioNeedingClassification(): Portfolio {
  const portfolio = livePortfolio();
  const account = portfolio.accounts[0];
  account.id = 'live-review-account';
  account.name = 'Account needing review';
  account.positions[0] = {
    ...account.positions[0],
    id: 'unclassified-us-etf',
    symbol: 'SCHB',
    name: 'Schwab U.S. Broad Market ETF',
    assetClass: 'unclassified',
  };
  account.issues = ['SCHB: asset class is unverified. This holding cannot be included in a plan.'];
  return portfolio;
}

/** In-browser API harness for app behavior, separate from real protocol/store tests. */
export async function mockLiveWorkspace(
  page: Page,
  portfolio = livePortfolio(),
  options: { deleteWarning?: string } = {},
) {
  let workspace: Workspace = {
    version: 1,
    preferences: structuredClone(defaultWorkspacePreferences),
    updatedAt: new Date().toISOString(),
  };
  const writes: Workspace[] = [];
  let plans: SavedPlan[] = [];
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { configured: true, connected: true, requirements: [] } }),
  );
  await page.route('**/api/portfolio', (route) => route.fulfill({ json: portfolio }));
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'DELETE') {
      workspace = {
        version: 1,
        preferences: structuredClone(defaultWorkspacePreferences),
        updatedAt: null,
      };
      plans = [];
      await route.fulfill({
        json: {
          deleted: true,
          ...(options.deleteWarning ? { warning: options.deleteWarning } : {}),
        },
      });
      return;
    }
    if (route.request().method() === 'PUT') {
      workspace = {
        version: 1,
        preferences: route.request().postDataJSON().preferences,
        updatedAt: new Date().toISOString(),
      };
      writes.push(structuredClone(workspace));
    }
    await route.fulfill({ json: workspace });
  });
  await page.route('**/api/plans**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'DELETE') {
      plans = plans.filter((plan) => plan.id !== url.pathname.split('/').at(-1));
      await route.fulfill({ json: { deleted: true } });
      return;
    }
    if (request.method() === 'POST') {
      const input: SavePlanInput = request.postDataJSON();
      const preferences = input.preferences;
      const accounts = portfolio.accounts.filter(
        (account) =>
          !preferences.selectedAccountIds.length ||
          preferences.selectedAccountIds.includes(account.id),
      );
      const result = generatePlan(accounts, {
        targets: preferences.targets,
        cashBufferCents: preferences.reserveCents,
        minimumTradeCents: preferences.minimumTradeCents,
        allowTaxableSales: preferences.allowTaxableSales,
        contributionCents: input.contributionCents,
        contributionAccountId: input.contributionAccountId,
      });
      const plan: SavedPlan = {
        id: '00000000-0000-4000-8000-000000000001',
        name: input.name,
        createdAt: new Date().toISOString(),
        asOf: portfolio.asOf,
        sourceFingerprint: 'controlled-portfolio-fingerprint',
        status: result.status,
        driftBefore: result.driftBefore,
        driftAfter: result.driftAfter,
        tradeCount: result.trades.length,
        totalCents: result.totalCents,
        historical: true,
        executable: false,
        preferences: structuredClone(preferences),
        contributionCents: input.contributionCents,
        contributionAccountId: input.contributionAccountId,
        source: structuredClone(portfolio),
        result,
      };
      plans.unshift(plan);
      await route.fulfill({ status: 201, json: { plan } });
      return;
    }
    const id = url.searchParams.get('id');
    await route.fulfill({
      json: id
        ? { plan: plans.find((plan) => plan.id === id) }
        : { plans: plans.map(summarizePlan) },
    });
  });
  return {
    writes,
    getWorkspace: () => workspace,
    getPlans: () => plans,
    setPortfolio(next: Portfolio) {
      Object.assign(portfolio, next);
    },
  };
}

export async function navigateWorkspace(
  page: Page,
  name: 'Portfolio' | 'Rebalance' | 'Connections' | 'Saved plans',
) {
  const mobileMenu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    .click();
}
