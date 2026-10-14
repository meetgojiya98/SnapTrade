import { makeDemoPortfolio } from '@/lib/demo';
import { parsePreferences, parseSavePlanInput, validPlanId } from '@/lib/workspace-validation';
import type { SavedPlan, WorkspacePreferences } from '@/lib/workspace';

export const demoStorageKey = 'balance.demo.workspace.v1';
export const demoTime = '2026-10-14T12:00:00.000Z';
export function samplePortfolio(scenario = 'normal') {
  const portfolio = makeDemoPortfolio();
  portfolio.asOf = demoTime;
  portfolio.accounts.forEach((account) => {
    account.syncedAt = demoTime;
  });
  if (scenario === 'stale') portfolio.accounts[0].syncedAt = '2026-10-12T12:00:00.000Z';
  if (scenario === 'currency') {
    portfolio.accounts[2].currency = 'CAD';
    portfolio.accounts[2].positions.forEach((position) => {
      position.currency = 'CAD';
    });
  }
  if (scenario === 'missing') portfolio.accounts[0].positions[0].priceCents = null;
  return portfolio;
}

export type DemoWorkspace = {
  version: 1;
  preferences: WorkspacePreferences;
  onboarded: boolean;
  plans: SavedPlan[];
};
export function readDemoWorkspace(): DemoWorkspace | null {
  try {
    const raw = localStorage.getItem(demoStorageKey);
    if (!raw || raw.length > 2_000_000) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('preferences' in value)
    )
      return null;
    const preferences = parsePreferences(value.preferences);
    const stored = value as { onboarded?: unknown; plans?: unknown };
    const plans = Array.isArray(stored.plans) ? stored.plans.filter(isSamplePlan).slice(0, 25) : [];
    return { version: 1, preferences, onboarded: stored.onboarded === true, plans };
  } catch {
    return null;
  }
}
export function writeDemoWorkspace(workspace: DemoWorkspace) {
  localStorage.setItem(demoStorageKey, JSON.stringify(workspace));
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const amount = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const assetClasses = new Set(['us-equity', 'international', 'bonds', 'unclassified']);
function isSamplePlan(value: unknown): value is SavedPlan {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !validPlanId(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !timestamp(value.createdAt) ||
    !timestamp(value.asOf) ||
    value.historical !== true ||
    value.executable !== false ||
    value.status !== 'ready' ||
    !amount(value.totalCents) ||
    !finite(value.driftBefore) ||
    !finite(value.driftAfter) ||
    !amount(value.tradeCount)
  )
    return false;
  try {
    parseSavePlanInput({
      name: value.name,
      preferences: value.preferences,
      contributionCents: value.contributionCents,
      contributionAccountId: value.contributionAccountId,
    });
  } catch {
    return false;
  }
  const source = value.source;
  const result = value.result;
  if (
    !object(source) ||
    source.mode !== 'demo' ||
    !timestamp(source.asOf) ||
    !strings(source.warnings) ||
    !Array.isArray(source.accounts) ||
    source.accounts.length > 100 ||
    !object(result) ||
    result.status !== 'ready' ||
    !Array.isArray(result.trades) ||
    result.trades.length > 1000 ||
    !Array.isArray(result.before) ||
    !Array.isArray(result.after) ||
    !strings(result.warnings) ||
    !strings(result.blockers) ||
    !amount(result.cashBeforeCents) ||
    !amount(result.cashAfterCents) ||
    !amount(result.totalCents) ||
    !finite(result.driftBefore) ||
    !finite(result.driftAfter)
  )
    return false;
  const validAccounts = source.accounts.every(
    (account) =>
      object(account) &&
      typeof account.id === 'string' &&
      typeof account.name === 'string' &&
      typeof account.broker === 'string' &&
      typeof account.number === 'string' &&
      (account.type === 'taxable' || account.type === 'retirement') &&
      typeof account.currency === 'string' &&
      /^[A-Z]{3}$/.test(account.currency) &&
      amount(account.cashCents) &&
      (account.syncedAt === null || timestamp(account.syncedAt)) &&
      strings(account.issues) &&
      Array.isArray(account.positions) &&
      account.positions.length <= 1000 &&
      account.positions.every(
        (position: unknown) =>
          object(position) &&
          typeof position.id === 'string' &&
          typeof position.symbol === 'string' &&
          typeof position.name === 'string' &&
          typeof position.assetClass === 'string' &&
          assetClasses.has(position.assetClass) &&
          finite(position.quantity) &&
          position.quantity >= 0 &&
          (position.priceCents === null || amount(position.priceCents)) &&
          typeof position.currency === 'string' &&
          /^[A-Z]{3}$/.test(position.currency),
      ),
  );
  const validTrades = result.trades.every(
    (trade) =>
      object(trade) &&
      typeof trade.accountId === 'string' &&
      typeof trade.accountName === 'string' &&
      typeof trade.symbol === 'string' &&
      typeof trade.assetClass === 'string' &&
      assetClasses.has(trade.assetClass) &&
      (trade.side === 'buy' || trade.side === 'sell') &&
      amount(trade.quantity) &&
      amount(trade.priceCents) &&
      amount(trade.valueCents) &&
      typeof trade.reason === 'string',
  );
  const validAllocations = [...result.before, ...result.after].every(
    (allocation) =>
      object(allocation) &&
      typeof allocation.assetClass === 'string' &&
      assetClasses.has(allocation.assetClass) &&
      amount(allocation.valueCents) &&
      finite(allocation.percent) &&
      finite(allocation.targetPercent),
  );
  return validAccounts && validTrades && validAllocations;
}
