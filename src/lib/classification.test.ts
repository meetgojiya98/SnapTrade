import { describe, expect, it } from 'vitest';
import { applyClassifications } from './classification';
import { defaultTargets, generatePlan } from './planner';
import { normalizeAccount } from './server/normalize';
import type { AssetClass, Portfolio } from './types';

const asOf = '2026-10-14T14:00:00.000Z';
const unknownTax =
  'The account tax treatment is unknown. Verify the account type before using a plan.';
const unclassified = 'TSLA: asset class is unverified. This holding cannot be included in a plan.';
const options = {
  targets: defaultTargets,
  allowTaxableSales: false,
  cashBufferCents: 0,
  contributionCents: 0,
  contributionAccountId: null,
  minimumTradeCents: 100,
  now: asOf,
};

function source(): Portfolio {
  return {
    mode: 'live',
    asOf,
    warnings: ['Review source data.'],
    accounts: [
      {
        id: 'account-one',
        name: 'Investments',
        broker: 'Broker',
        number: '•••• 1234',
        type: 'taxable',
        currency: 'USD',
        cashCents: 50000,
        syncedAt: asOf,
        issues: [unclassified, unknownTax],
        positions: [
          {
            id: 'tsla',
            symbol: 'TSLA',
            name: 'Tesla',
            assetClass: 'unclassified',
            quantity: 2,
            priceCents: 10000,
            currency: 'USD',
          },
        ],
      },
    ],
  };
}

describe('explicit portfolio classification confirmations', () => {
  it('applies asset class and account type to an immutable copy and resolves only their exact issues', () => {
    const portfolio = source();
    const original = structuredClone(portfolio);
    const result = applyClassifications(
      portfolio,
      { 'account-one:tsla': 'us-equity' },
      { 'account-one': 'retirement' },
    );
    expect(result.accounts[0].positions[0].assetClass).toBe('us-equity');
    expect(result.accounts[0].type).toBe('retirement');
    expect(result.accounts[0].issues).toEqual([]);
    expect(result.warnings).toEqual(portfolio.warnings);
    expect(portfolio).toEqual(original);
    expect(result).not.toBe(portfolio);
    expect(result.accounts[0]).not.toBe(portfolio.accounts[0]);
    expect(result.accounts[0].positions[0]).not.toBe(portfolio.accounts[0].positions[0]);
    expect(generatePlan(result.accounts, options).status).toBe('ready');
  });
  it.each(['us-equity', 'international', 'bonds'] as const)(
    'permits %s as an explicit classification',
    (assetClass) => {
      const result = applyClassifications(source(), { 'account-one:tsla': assetClass }, {});
      expect(result.accounts[0].positions[0].assetClass).toBe(assetClass);
      expect(result.accounts[0].issues).toEqual([unknownTax]);
    },
  );
  it('ignores unclassified, invalid values, and unrelated or inherited keys', () => {
    const portfolio = source();
    const inherited = Object.create({ 'account-one:tsla': 'bonds' }) as Record<string, AssetClass>;
    expect(applyClassifications(portfolio, inherited, {}).accounts[0].issues).toEqual(
      portfolio.accounts[0].issues,
    );
    for (const value of ['unclassified', 'crypto']) {
      const result = applyClassifications(
        portfolio,
        { 'account-one:tsla': value as AssetClass, 'different:tsla': 'bonds' },
        { 'account-one': 'unknown' as 'taxable' },
      );
      expect(result.accounts[0].positions[0].assetClass).toBe('unclassified');
      expect(result.accounts[0].issues).toEqual(portfolio.accounts[0].issues);
    }
  });
  it('keeps stale, cash, currency, price, and unsupported instrument blockers after user confirmation', () => {
    const portfolio = source();
    const blockers = [
      'TSLA: option instruments are unsupported.',
      'TSLA: a valid market price is required.',
      'This account has a negative cash balance. Margin borrowing is not supported.',
      'Only USD accounts are supported by this planner. No currency conversion has been applied.',
      'The cash balance has no valid freshness timestamp.',
      `${unclassified} Additional provider context.`,
      `${unknownTax} Additional provider context.`,
    ];
    portfolio.accounts[0].issues.push(...blockers);
    portfolio.accounts[0].positions[0].priceCents = null;
    const result = applyClassifications(
      portfolio,
      { 'account-one:tsla': 'us-equity' },
      { 'account-one': 'taxable' },
    );
    expect(result.accounts[0].issues).toEqual(blockers);
    expect(result.accounts[0].positions[0].priceCents).toBeNull();
    expect(generatePlan(result.accounts, options).status).toBe('blocked');
  });
  it('requires a confirmation for each account and instrument, even with the same ticker', () => {
    const portfolio = source();
    portfolio.accounts.push({ ...structuredClone(portfolio.accounts[0]), id: 'account-two' });
    portfolio.accounts[0].positions.push({
      ...portfolio.accounts[0].positions[0],
      id: 'tsla-other',
    });
    const result = applyClassifications(
      portfolio,
      { 'account-one:tsla': 'us-equity' },
      { 'account-one': 'retirement' },
    );
    expect(result.accounts[0].issues).toEqual([unclassified]);
    expect(result.accounts[0].positions[1].assetClass).toBe('unclassified');
    expect(result.accounts[1]).toEqual(portfolio.accounts[1]);
    expect(result.accounts[1].issues).toContain(unknownTax);
  });
  it('keeps newly known source classifications after reloading with earlier user confirmations', () => {
    const earlier = source();
    const overrides = { 'account-one:tsla': 'us-equity' } satisfies Record<string, AssetClass>;
    const accountTypes = { 'account-one': 'retirement' } as const;
    expect(applyClassifications(earlier, overrides, accountTypes).accounts[0].type).toBe(
      'retirement',
    );

    const reloaded = source();
    reloaded.accounts[0].type = 'taxable';
    reloaded.accounts[0].issues = [];
    reloaded.accounts[0].positions[0].assetClass = 'international';
    const result = applyClassifications(reloaded, overrides, accountTypes);
    expect(result.accounts[0].type).toBe('taxable');
    expect(result.accounts[0].positions[0].assetClass).toBe('international');
    expect(result).toEqual(reloaded);
  });
  it('does not let an earlier retirement confirmation enable sales in a now-known taxable account', () => {
    const reloaded = source();
    const account = reloaded.accounts[0];
    account.type = 'taxable';
    account.issues = [];
    account.cashCents = 0;
    account.positions[0] = {
      ...account.positions[0],
      assetClass: 'us-equity',
      quantity: 100,
    };
    account.positions.push({
      id: 'bnd',
      symbol: 'BND',
      name: 'Bond ETF',
      assetClass: 'bonds',
      quantity: 10,
      priceCents: 10000,
      currency: 'USD',
    });
    const result = applyClassifications(
      reloaded,
      { 'account-one:tsla': 'bonds' },
      { 'account-one': 'retirement' },
    );
    expect(result.accounts[0].type).toBe('taxable');
    expect(result.accounts[0].positions[0].assetClass).toBe('us-equity');
    const plan = generatePlan(result.accounts, options);
    expect(plan.status).toBe('ready');
    expect(plan.trades.filter((trade) => trade.side === 'sell')).toEqual([]);
  });
  it('does not clear a stale classification issue when the source class is already known', () => {
    const portfolio = source();
    portfolio.accounts[0].positions[0].assetClass = 'bonds';
    const result = applyClassifications(portfolio, { 'account-one:tsla': 'us-equity' }, {});
    expect(result.accounts[0].positions[0].assetClass).toBe('bonds');
    expect(result.accounts[0].issues).toEqual(portfolio.accounts[0].issues);
  });
  it('preserves a brokerage value mismatch after classifying previously unknown live holdings', () => {
    const account = normalizeAccount(
      {
        id: 'account-one',
        raw_type: null,
        net_value: { amount: 9999, currency: 'USD' },
        sync_status: { balances: asOf },
      },
      {
        results: [
          {
            instrument: { id: 'tsla', kind: 'stock', symbol: 'TSLA' },
            units: '2',
            price: '100.00',
            currency: 'USD',
          },
        ],
        data_freshness: { as_of: asOf },
      },
      [{ currency: { code: 'USD' }, cash: 500 }],
    );
    const result = applyClassifications(
      { mode: 'live', asOf, warnings: [], accounts: [account] },
      { 'account-one:tsla': 'us-equity' },
      { 'account-one': 'taxable' },
    );
    expect(result.accounts[0].issues.join()).toContain('do not reconcile');
    expect(generatePlan(result.accounts, options).status).toBe('blocked');
  });
});
