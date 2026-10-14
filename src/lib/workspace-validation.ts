import type { AssetClass } from '@/lib/types';
import type { SavePlanInput, WorkspacePreferences } from '@/lib/workspace';

export class WorkspaceInputError extends Error {}

const classes = new Set<AssetClass>(['us-equity', 'international', 'bonds']);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const maxMoneyCents = 10_000_000_000;

function invalid(message: string): never {
  throw new WorkspaceInputError(message);
}

function object(value: unknown, allowed?: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid('Provide a valid JSON object.');
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => forbiddenKeys.has(key) || (allowed && !allowed.includes(key)))
  )
    invalid('The request contains an unsupported field.');
  return result;
}

function money(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maxMoneyCents
  )
    invalid(`${name} must be whole cents from zero to $100 million.`);
  return value;
}

export function parsePreferences(value: unknown): WorkspacePreferences {
  const input = object(value, [
    'targets',
    'reserveCents',
    'minimumTradeCents',
    'allowTaxableSales',
    'selectedAccountIds',
    'classifications',
    'accountTypes',
  ]);
  if (!Array.isArray(input.targets) || input.targets.length !== 3)
    invalid('Provide exactly one target for US equity, international equity, and bonds.');
  const seen = new Set<string>();
  const targets = input.targets.map((value) => {
    const target = object(value, ['assetClass', 'percent']);
    if (
      typeof target.assetClass !== 'string' ||
      !classes.has(target.assetClass as AssetClass) ||
      seen.has(target.assetClass)
    )
      invalid('Each supported asset class needs exactly one target.');
    if (
      typeof target.percent !== 'number' ||
      !Number.isFinite(target.percent) ||
      target.percent < 0 ||
      target.percent > 100
    )
      invalid('Allocation targets must be between 0 and 100 percent.');
    seen.add(target.assetClass);
    return { assetClass: target.assetClass as AssetClass, percent: target.percent };
  });
  if (Math.abs(targets.reduce((sum, target) => sum + target.percent, 0) - 100) > 0.000001)
    invalid('Allocation targets must total 100 percent.');
  if (typeof input.allowTaxableSales !== 'boolean')
    invalid('Choose whether taxable sales are allowed.');
  if (
    !Array.isArray(input.selectedAccountIds) ||
    input.selectedAccountIds.length > 100 ||
    input.selectedAccountIds.some((id) => typeof id !== 'string' || !idPattern.test(id)) ||
    new Set(input.selectedAccountIds).size !== input.selectedAccountIds.length
  )
    invalid('Select up to 100 unique account IDs.');
  const classifications = object(input.classifications);
  if (Object.keys(classifications).length > 1000) invalid('Confirm at most 1,000 holdings.');
  for (const [key, assetClass] of Object.entries(classifications)) {
    const [account, position, extra] = key.split(':');
    if (
      !account ||
      !idPattern.test(account) ||
      !position ||
      !idPattern.test(position) ||
      extra !== undefined ||
      typeof assetClass !== 'string' ||
      !classes.has(assetClass as AssetClass)
    )
      invalid('Holding confirmations need an account ID, position ID, and supported asset class.');
  }
  const accountTypes = object(input.accountTypes);
  if (Object.keys(accountTypes).length > 100) invalid('Confirm at most 100 account types.');
  for (const [id, type] of Object.entries(accountTypes))
    if (!idPattern.test(id) || (type !== 'taxable' && type !== 'retirement'))
      invalid('Account confirmations need a valid account ID and tax treatment.');
  return {
    targets,
    reserveCents: money(input.reserveCents, 'Cash reserve'),
    minimumTradeCents: money(input.minimumTradeCents, 'Minimum trade'),
    allowTaxableSales: input.allowTaxableSales,
    selectedAccountIds: [...input.selectedAccountIds] as string[],
    classifications: { ...classifications } as Record<string, AssetClass>,
    accountTypes: { ...accountTypes } as Record<string, 'taxable' | 'retirement'>,
  };
}

export function parseWorkspaceInput(value: unknown): WorkspacePreferences {
  return parsePreferences(object(value, ['preferences']).preferences);
}

export function parseSavePlanInput(value: unknown): SavePlanInput {
  const input = object(value, [
    'name',
    'preferences',
    'contributionCents',
    'contributionAccountId',
  ]);
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 80 ||
    /[\u0000-\u001f\u007f]/.test(input.name)
  )
    invalid('Name this plan using 1 to 80 characters.');
  const preferences = parsePreferences(input.preferences);
  const contributionCents = money(input.contributionCents, 'Contribution');
  if (
    input.contributionAccountId !== null &&
    (typeof input.contributionAccountId !== 'string' ||
      !idPattern.test(input.contributionAccountId))
  )
    invalid('Choose a valid account for the hypothetical contribution.');
  if (
    contributionCents > 0 &&
    (typeof input.contributionAccountId !== 'string' ||
      (preferences.selectedAccountIds.length > 0 &&
        !preferences.selectedAccountIds.includes(input.contributionAccountId)))
  )
    invalid('Choose a selected account for the hypothetical contribution.');
  return {
    name: input.name.trim(),
    preferences,
    contributionCents,
    contributionAccountId: contributionCents > 0 ? (input.contributionAccountId as string) : null,
  };
}

export function validPlanId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
