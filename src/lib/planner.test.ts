import { describe, expect, it } from 'vitest';
import { makeDemoPortfolio } from './demo';
import { accountValueCents, calculateAllocation, defaultTargets, generatePlan } from './planner';
import type { Account, AssetClass, Plan, PlanOptions, Position } from './types';

const now = '2026-10-14T14:00:00.000Z';
const position = (
  symbol: string,
  assetClass: AssetClass,
  quantity: number,
  priceCents = 10_000,
): Position => ({
  id: symbol,
  symbol,
  name: symbol,
  assetClass,
  quantity,
  priceCents,
  currency: 'USD',
});
const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'account-1',
  name: 'Test retirement',
  broker: 'Test broker',
  number: '••1234',
  type: 'retirement',
  currency: 'USD',
  cashCents: 50_000,
  syncedAt: now,
  issues: [],
  positions: [
    position('VTI', 'us-equity', 60),
    position('VXUS', 'international', 20),
    position('BND', 'bonds', 15),
  ],
  ...overrides,
});
const options = (overrides: Partial<PlanOptions> = {}): PlanOptions => ({
  targets: structuredClone(defaultTargets),
  allowTaxableSales: false,
  cashBufferCents: 25_000,
  contributionCents: 0,
  contributionAccountId: null,
  minimumTradeCents: 10_000,
  now,
  ...overrides,
});

/** Replay recommendations against an independent account ledger, never against planner state. */
function verifyLedger(accounts: Account[], input: PlanOptions, plan: Plan) {
  const balances = new Map(
    accounts.map((entry) => [
      entry.id,
      entry.cashCents + (entry.id === input.contributionAccountId ? input.contributionCents : 0),
    ]),
  );
  const quantities = new Map<string, number>();
  for (const entry of accounts)
    for (const holding of entry.positions)
      quantities.set(
        `${entry.id}:${holding.symbol}`,
        (quantities.get(`${entry.id}:${holding.symbol}`) ?? 0) + holding.quantity,
      );
  let cash = [...balances.values()].reduce((sum, value) => sum + value, 0);
  for (const trade of plan.trades) {
    const entry = accounts.find((candidate) => candidate.id === trade.accountId)!;
    const holding = entry.positions.find((candidate) => candidate.symbol === trade.symbol)!;
    expect(holding).toBeDefined();
    expect(holding.assetClass).toBe(trade.assetClass);
    expect(holding.priceCents).toBe(trade.priceCents);
    expect(holding.cashEquivalent).not.toBe(true);
    expect(Number.isInteger(trade.quantity)).toBe(true);
    expect(trade.quantity).toBeGreaterThan(0);
    expect(trade.valueCents).toBe(trade.quantity * trade.priceCents);
    expect(trade.valueCents).toBeGreaterThanOrEqual(input.minimumTradeCents);
    const key = `${entry.id}:${trade.symbol}`;
    const sign = trade.side === 'buy' ? 1 : -1;
    const quantityAfter = quantities.get(key)! + sign * trade.quantity;
    expect(quantityAfter).toBeGreaterThanOrEqual(0);
    quantities.set(key, quantityAfter);
    balances.set(entry.id, balances.get(entry.id)! - sign * trade.valueCents);
    cash -= sign * trade.valueCents;
    if (trade.side === 'sell' && entry.type === 'taxable')
      expect(input.allowTaxableSales).toBe(true);
    // Sells are listed first within each account, so every proposed buy is funded as replayed.
    expect(balances.get(entry.id)).toBeGreaterThanOrEqual(0);
  }
  for (const balance of balances.values())
    expect(balance).toBeGreaterThanOrEqual(input.cashBufferCents);
  expect(cash).toBe(plan.cashAfterCents);
  expect(
    plan.after.reduce((sum, allocation) => sum + allocation.valueCents, 0) +
      cash -
      input.cashBufferCents * accounts.length,
  ).toBe(plan.totalCents);
  expect(plan.driftAfter).toBeLessThanOrEqual(plan.driftBefore + 0.000_001);
}

describe('portfolio valuation', () => {
  it('counts real cash once, rounds fractional holdings to cents, and excludes cash equivalents', () => {
    const entry = account({
      cashCents: 1_000,
      positions: [
        position('VTI', 'us-equity', 1.125, 100_01),
        { ...position('USD', 'unclassified', 500, 100), cashEquivalent: true },
      ],
    });
    expect(accountValueCents(entry)).toBe(12_251);
    const snapshot = calculateAllocation([entry], [{ assetClass: 'us-equity', percent: 100 }]);
    expect(snapshot[0].valueCents).toBe(11_251);
    expect(snapshot[0].percent).toBeCloseTo((11_251 / 12_251) * 100);
    expect(snapshot.some((item) => item.assetClass === 'unclassified')).toBe(false);
  });

  it('uses a fixed contribution-and-reserve denominator on both sides', () => {
    const accounts = [account()];
    const input = options({ contributionCents: 20_000, contributionAccountId: 'account-1' });
    const plan = generatePlan(accounts, input);
    expect(plan.totalCents).toBe(accountValueCents(accounts[0]) + 20_000 - 25_000);
    expect(plan.cashBeforeCents).toBe(70_000);
    expect(plan.before[0].percent).toBeCloseTo((600_000 / plan.totalCents) * 100);
    expect(plan.before.reduce((sum, row) => sum + row.percent, 0)).toBeLessThan(100);
    verifyLedger(accounts, input, plan);
  });

  it('includes uninvested cash in drift so a portfolio cannot look balanced by selling everything', () => {
    const entry = account({
      cashCents: 100_000,
      positions: [
        position('VTI', 'us-equity', 5),
        position('VXUS', 'international', 3),
        position('BND', 'bonds', 2),
      ],
    });
    const plan = generatePlan([entry], options({ cashBufferCents: 0 }));
    expect(plan.driftBefore).toBeCloseTo(50);
    expect(plan.driftAfter).toBe(0);
    expect(plan.cashAfterCents).toBe(0);
  });
});

describe('whole-share rebalancing', () => {
  it('materially improves the demo without taxable sales, fabricated symbols, or cash transfers', () => {
    const portfolio = makeDemoPortfolio();
    const input = options({ now: portfolio.asOf });
    const original = structuredClone(portfolio.accounts);
    const plan = generatePlan(portfolio.accounts, input);
    expect(plan.status).toBe('ready');
    expect(plan.blockers).toEqual([]);
    expect(plan.driftBefore).toBeGreaterThan(20);
    expect(plan.driftAfter).toBeLessThan(1);
    expect(plan.trades.some((trade) => trade.side === 'sell')).toBe(true);
    expect(
      plan.trades.some((trade) => trade.side === 'sell' && trade.accountId === 'demo-fidelity'),
    ).toBe(false);
    expect(portfolio.accounts).toEqual(original);
    verifyLedger(portfolio.accounts, input, plan);
  });

  it('is deterministic even when account and position input order changes', () => {
    const portfolio = makeDemoPortfolio();
    const input = options({ now: portfolio.asOf });
    const reordered = structuredClone(portfolio.accounts)
      .reverse()
      .map((entry) => ({ ...entry, positions: entry.positions.reverse() }));
    expect(generatePlan(reordered, input)).toEqual(generatePlan(portfolio.accounts, input));
  });

  it('cannot spend cash from another account, even if the portfolio has ample cash', () => {
    const entries = [
      account({ id: 'cash', cashCents: 1_000_000, positions: [position('VTI', 'us-equity', 0)] }),
      account({ id: 'bonds', cashCents: 0, positions: [position('BND', 'bonds', 10)] }),
    ];
    const input = options({ cashBufferCents: 0, targets: [{ assetClass: 'bonds', percent: 100 }] });
    const plan = generatePlan(entries, input);
    expect(plan.status).toBe('ready');
    expect(plan.trades).toEqual([]);
    expect(plan.cashAfterCents).toBe(1_000_000);
    expect(plan.driftAfter).toBe(plan.driftBefore);
    verifyLedger(entries, input, plan);
  });

  it('retains fractional shares and never sells more than the whole shares held', () => {
    const entries = [
      account({
        cashCents: 0,
        positions: [position('VTI', 'us-equity', 5.75), position('BND', 'bonds', 0, 6_000)],
      }),
    ];
    const input = options({
      cashBufferCents: 0,
      minimumTradeCents: 0,
      targets: [{ assetClass: 'bonds', percent: 100 }],
    });
    const plan = generatePlan(entries, input);
    expect(plan.trades.find((trade) => trade.side === 'sell')?.quantity).toBe(5);
    expect(plan.after.find((row) => row.assetClass === 'us-equity')?.valueCents).toBe(7_500);
    verifyLedger(entries, input, plan);
  });

  it('requires explicit opt-in for taxable sales', () => {
    const entries = [account({ type: 'taxable', cashCents: 0 })];
    const locked = generatePlan(entries, options({ cashBufferCents: 0 }));
    expect(locked.trades).toEqual([]);
    const input = options({ allowTaxableSales: true, cashBufferCents: 0 });
    const unlocked = generatePlan(entries, input);
    expect(unlocked.trades.some((trade) => trade.side === 'sell')).toBe(true);
    verifyLedger(entries, input, unlocked);
  });

  it('respects the minimum for both sides of a sale-and-purchase pair', () => {
    const entries = [
      account({
        cashCents: 0,
        positions: [
          position('VTI', 'us-equity', 60, 10_000),
          position('VXUS', 'international', 0, 13_700),
          position('BND', 'bonds', 0, 7_300),
        ],
      }),
    ];
    const input = options({ cashBufferCents: 0, minimumTradeCents: 100_000 });
    const plan = generatePlan(entries, input);
    expect(plan.trades.length).toBeGreaterThan(0);
    verifyLedger(entries, input, plan);
  });

  it('does not sell an overweight class when no other eligible security can receive the proceeds', () => {
    const entries = [account({ cashCents: 0, positions: [position('VTI', 'us-equity', 10)] })];
    const plan = generatePlan(entries, options({ cashBufferCents: 0 }));
    expect(plan.status).toBe('ready');
    expect(plan.trades).toEqual([]);
    expect(plan.cashAfterCents).toBe(0);
  });

  it('preserves funding, quantity, and value invariants across 200 reproducible portfolios', () => {
    let seed = 98_341;
    const random = (maximum: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % maximum;
    };
    for (let sample = 0; sample < 200; sample += 1) {
      const entries = Array.from({ length: 1 + random(4) }, (_, index) =>
        account({
          id: `account-${index}`,
          type: random(2) ? 'taxable' : 'retirement',
          cashCents: 25_000 + random(300_000),
          positions: [
            position('VTI', 'us-equity', random(100) + random(100) / 100, 1_000 + random(40_000)),
            position(
              'VXUS',
              'international',
              random(100) + random(100) / 100,
              1_000 + random(10_000),
            ),
            position('BND', 'bonds', random(100) + random(100) / 100, 1_000 + random(10_000)),
          ],
        }),
      );
      const input = options({
        allowTaxableSales: Boolean(random(2)),
        minimumTradeCents: random(15_000),
        contributionCents: random(50_000),
        contributionAccountId: entries[random(entries.length)].id,
      });
      const plan = generatePlan(entries, input);
      expect(plan.status).toBe('ready');
      verifyLedger(entries, input, plan);
    }
  });

  it('restores an account reserve with a permitted sale, or blocks the entire plan if that is impossible', () => {
    const retirement = account({ cashCents: 0, positions: [position('VTI', 'us-equity', 10)] });
    const plan = generatePlan(
      [retirement],
      options({ targets: [{ assetClass: 'us-equity', percent: 100 }] }),
    );
    expect(plan.status).toBe('ready');
    expect(plan.cashAfterCents).toBeGreaterThanOrEqual(25_000);
    expect(plan.trades[0].reason).toContain('cash reserve');
    const blocked = generatePlan([{ ...retirement, type: 'taxable' }], options());
    expect(blocked.status).toBe('blocked');
    expect(blocked.trades).toEqual([]);
    expect(blocked.blockers.join(' ')).toContain('allow taxable sales');
  });
});

describe('fail-closed safety checks', () => {
  it.each([
    [
      'missing price',
      { positions: [{ ...position('VTI', 'us-equity', 10), priceCents: null }] },
      'price',
    ],
    ['zero price', { positions: [position('VTI', 'us-equity', 10, 0)] }, 'price'],
    ['fractional cent price', { positions: [position('VTI', 'us-equity', 10, 100.5)] }, 'price'],
    ['negative cash', { cashCents: -1 }, 'margin'],
    ['fractional cent cash', { cashCents: 100.5 }, 'cash'],
    ['negative holdings', { positions: [position('VTI', 'us-equity', -1)] }, 'short'],
    ['non-finite holdings', { positions: [position('VTI', 'us-equity', Number.NaN)] }, 'quantity'],
    ['unclassified holding', { positions: [position('UNKNOWN', 'unclassified', 10)] }, 'classify'],
    ['missing sync', { syncedAt: null }, 'sync'],
    ['old sync', { syncedAt: '2026-10-13T13:59:59.999Z' }, '24 hours'],
    ['future sync', { syncedAt: '2026-10-14T14:05:00.001Z' }, 'future'],
    ['provider issue', { issues: ['Connection needs reauthorization'] }, 'reauthorization'],
    [
      'position currency mismatch',
      { positions: [{ ...position('VTI', 'us-equity', 10), currency: 'CAD' }] },
      'currency',
    ],
  ] as [string, Partial<Account>, string][])(
    'blocks %s without recommending partial trades',
    (_label, overrides, message) => {
      const plan = generatePlan([account(), account({ id: 'unsafe', ...overrides })], options());
      expect(plan.status).toBe('blocked');
      expect(plan.trades).toEqual([]);
      expect(plan.blockers.join(' ')).toContain(message);
    },
  );

  it('accepts data exactly 24 hours old, but not one millisecond older', () => {
    expect(
      generatePlan([account({ syncedAt: '2026-10-13T14:00:00.000Z' })], options()).status,
    ).toBe('ready');
    expect(
      generatePlan([account({ syncedAt: '2026-10-13T13:59:59.999Z' })], options()).status,
    ).toBe('blocked');
  });

  it('separates currencies and rejects conflicting symbol classifications', () => {
    const cad = account({
      id: 'cad',
      currency: 'CAD',
      positions: [{ ...position('VTI', 'us-equity', 10), currency: 'CAD' }],
    });
    expect(generatePlan([account(), cad], options()).blockers.join(' ')).toContain('one currency');
    const conflicting = account({ id: 'conflicting', positions: [position('VTI', 'bonds', 10)] });
    expect(generatePlan([account(), conflicting], options()).blockers.join(' ')).toContain(
      'inconsistent asset classes',
    );
  });

  it('rejects duplicate IDs, conflicting same-account quotes, and unsafe monetary ranges', () => {
    expect(generatePlan([account(), account()], options()).blockers.join(' ')).toContain(
      'unique ID',
    );
    const duplicate = account({
      positions: [position('VTI', 'us-equity', 1), position('VTI', 'us-equity', 1, 11_000)],
    });
    expect(generatePlan([duplicate], options()).blockers.join(' ')).toContain(
      'inconsistent prices',
    );
    const huge = account({ positions: [position('VTI', 'us-equity', Number.MAX_SAFE_INTEGER)] });
    expect(generatePlan([huge], options()).status).toBe('blocked');
  });

  it('blocks distinct instruments sharing a normalized symbol even when prices and classes agree', () => {
    const entry = account({
      cashCents: 0,
      positions: [
        position('VTI', 'us-equity', 20),
        { ...position(' vti ', 'us-equity', 30), id: 'different-instrument' },
        position('BND', 'bonds', 1),
      ],
    });
    const plan = generatePlan([entry], options({ cashBufferCents: 0 }));
    expect(plan.status).toBe('blocked');
    expect(plan.trades).toEqual([]);
    expect(plan.blockers.join(' ')).toContain('VTI appears more than once');
  });

  it('blocks duplicate instrument records while preserving the same symbol across separate accounts', () => {
    const holding = position('VTI', 'us-equity', 20);
    const duplicate = account({ positions: [holding, { ...holding }] });
    const blocked = generatePlan([duplicate], options());
    expect(blocked.status).toBe('blocked');
    expect(blocked.trades).toEqual([]);
    expect(blocked.blockers.join(' ')).toContain('appears more than once');

    const entries = [account({ id: 'first' }), account({ id: 'second' })];
    const plan = generatePlan(entries, options());
    expect(plan.status).toBe('ready');
    verifyLedger(entries, options(), plan);
  });

  it.each([
    { targets: [{ assetClass: 'us-equity', percent: 99 }] },
    {
      targets: [
        { assetClass: 'us-equity', percent: 50 },
        { assetClass: 'us-equity', percent: 50 },
      ],
    },
    { targets: [{ assetClass: 'unclassified', percent: 100 }] },
    { targets: [{ assetClass: 'us-equity', percent: Number.NaN }] },
    { cashBufferCents: -1 },
    { minimumTradeCents: 0.1 },
    { contributionCents: 1, contributionAccountId: null },
    { contributionCents: 1, contributionAccountId: 'not-selected' },
    { contributionCents: Number.POSITIVE_INFINITY },
    { now: 'invalid' },
  ] satisfies Partial<PlanOptions>[])('rejects unsafe plan options %j', (overrides) => {
    const plan = generatePlan([account()], options(overrides));
    expect(plan.status).toBe('blocked');
    expect(plan.trades).toEqual([]);
  });

  it('blocks empty selections and reserves exceeding total assets', () => {
    expect(generatePlan([], options()).status).toBe('blocked');
    expect(generatePlan([account()], options({ cashBufferCents: 2_000_000 })).status).toBe(
      'blocked',
    );
  });

  it('excludes a cash-equivalent position without requiring a synthetic price or classification', () => {
    const entries = [
      account({
        positions: [
          ...account().positions,
          { ...position('USD', 'unclassified', 500), priceCents: null, cashEquivalent: true },
        ],
      }),
    ];
    const plan = generatePlan(entries, options());
    expect(plan.status).toBe('ready');
    expect(plan.trades.some((trade) => trade.symbol === 'USD')).toBe(false);
    expect(plan.warnings.join(' ')).toContain('cash-equivalent');
    verifyLedger(entries, options(), plan);
  });
});
