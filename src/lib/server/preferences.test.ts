import { describe, expect, it } from 'vitest';
import { defaultWorkspacePreferences } from '@/lib/workspace';
import { parsePreferences, parseSavePlanInput } from '@/lib/workspace-validation';
import { validatePreferences } from './preferences';

const preferences = () => structuredClone(defaultWorkspacePreferences);

describe('workspace input validation', () => {
  it('accepts a complete policy and returns an independent copy', () => {
    const input = preferences();
    input.selectedAccountIds = ['account-1'];
    input.classifications = { 'account-1:holding-1': 'bonds' };
    expect(parsePreferences(input)).toEqual(input);
    const parsed = parsePreferences(input);
    input.targets[0].percent = 0;
    expect(parsed.targets[0].percent).toBe(50);
  });

  it.each([
    null,
    [],
    {},
    { ...preferences(), trades: [] },
    { ...preferences(), targets: [{ assetClass: 'us-equity', percent: 100 }] },
    {
      ...preferences(),
      targets: [
        { assetClass: 'us-equity', percent: 50 },
        { assetClass: 'us-equity', percent: 30 },
        { assetClass: 'bonds', percent: 20 },
      ],
    },
    {
      ...preferences(),
      targets: [
        { assetClass: 'unclassified', percent: 50 },
        { assetClass: 'international', percent: 30 },
        { assetClass: 'bonds', percent: 20 },
      ],
    },
    {
      ...preferences(),
      targets: [
        { assetClass: 'us-equity', percent: 0 },
        { assetClass: 'international', percent: 30 },
        { assetClass: 'bonds', percent: 20 },
      ],
    },
    { ...preferences(), selectedAccountIds: ['same', 'same'] },
    { ...preferences(), selectedAccountIds: ['../../private'] },
    { ...preferences(), allowTaxableSales: 'true' },
    { ...preferences(), classifications: { 'account:position': 'crypto' } },
    { ...preferences(), accountTypes: { account: 'margin' } },
    { ...preferences(), classifications: JSON.parse('{"__proto__":"bonds"}') },
  ])('rejects malformed or fabricated policy %j', (input) => {
    expect(() => validatePreferences(input)).toThrow();
    try {
      validatePreferences(input);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_input', status: 400 });
    }
  });

  it.each([-1, 0.5, NaN, Infinity, 10_000_000_001, '100'])('rejects invalid money %s', (value) => {
    expect(() => parsePreferences({ ...preferences(), reserveCents: value })).toThrow();
    expect(() => parsePreferences({ ...preferences(), minimumTradeCents: value })).toThrow();
  });

  it('rejects contribution funding outside the selected accounts and all client-generated trades', () => {
    const input = {
      name: 'Quarterly plan',
      preferences: { ...preferences(), selectedAccountIds: ['selected-account'] },
      contributionCents: 100,
      contributionAccountId: 'not-selected',
    };
    expect(() => parseSavePlanInput(input)).toThrow('selected account');
    expect(() => parseSavePlanInput({ ...input, contributionCents: 0, trades: [] })).toThrow(
      'unsupported field',
    );
  });

  it('normalizes a plan name and removes a meaningless zero-dollar contribution account', () => {
    const parsed = parseSavePlanInput({
      name: '  Quarterly plan  ',
      preferences: preferences(),
      contributionCents: 0,
      contributionAccountId: 'account-1',
    });
    expect(parsed.name).toBe('Quarterly plan');
    expect(parsed.contributionAccountId).toBeNull();
  });

  it('allows a concrete contribution account when an empty selection means all, but never accepts missing funding', () => {
    const input = {
      name: 'All accounts',
      preferences: preferences(),
      contributionCents: 100,
      contributionAccountId: 'actual-account',
    };
    expect(parseSavePlanInput(input).contributionAccountId).toBe('actual-account');
    expect(() => parseSavePlanInput({ ...input, contributionAccountId: null })).toThrow(
      'selected account',
    );
  });
});
