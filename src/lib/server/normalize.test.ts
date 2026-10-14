import { describe, expect, it } from 'vitest';
import { decimalCents, maskAccountNumber, normalizeAccount } from './normalize';
import { loadPortfolio } from './portfolio';
import { UpstreamError } from './errors';
import type { OAuthService } from './oauth';

const asOf = '2026-10-14T14:00:00.000Z';
const account = {
  id: 'account-one',
  kind: 'investment',
  connection_id: 'connection-one',
  display_name: 'My investments',
  masked_account_number: '****1234',
  raw_type: 'Margin',
  net_value: { amount: 1500, currency: 'USD' },
  sync_status: { balances: asOf },
};
const position = {
  instrument: {
    kind: 'etf',
    id: 'vti',
    symbol: 'VTI',
    description: 'Vanguard Total Stock Market ETF',
    currency: 'USD',
  },
  units: '2',
  price: '500.00',
  currency: 'USD',
};
const positionResponse = { results: [position], data_freshness: { as_of: asOf } };
const balances = [{ currency: { code: 'USD' }, cash: 500, buying_power: 1000 }];

describe('SnapTrade normalization', () => {
  it('converts decimal strings exactly with safe bounds and null handling', () => {
    expect(decimalCents('10.005')).toBe(1001);
    expect(decimalCents('-10.005')).toBe(-1001);
    expect(decimalCents(0.29)).toBe(29);
    expect(decimalCents(1e-7)).toBe(0);
    for (const input of [
      null,
      undefined,
      '',
      'Infinity',
      Number.NaN,
      '10x',
      '90071992547409.92',
      {},
    ])
      expect(decimalCents(input)).toBeNull();
  });
  it('uses cash rather than buying power, masks account numbers, and classifies a verified ETF', () => {
    const result = normalizeAccount(account, positionResponse, balances, {
      broker: 'Test brokerage',
      connectionKnown: true,
    });
    expect(result.cashCents).toBe(50000);
    expect(result.positions[0]).toMatchObject({
      symbol: 'VTI',
      quantity: 2,
      priceCents: 50000,
      assetClass: 'us-equity',
    });
    expect(result.number).toBe('•••• 1234');
    expect(result.syncedAt).toBe(asOf);
    expect(result.issues).toEqual([]);
    expect(maskAccountNumber('123')).toBe('•••• 123');
  });
  it('excludes cash-equivalent sweeps from holdings to prevent double counting', () => {
    const response = {
      ...positionResponse,
      results: [
        ...positionResponse.results,
        {
          instrument: { kind: 'mutualfund', symbol: 'SPAXX' },
          units: '500',
          price: '1',
          cash_equivalent: true,
        },
      ],
    };
    const result = normalizeAccount(account, response, balances);
    expect(result.positions).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });
  it('does not infer asset classes from arbitrary ticker names or unsupported instruments', () => {
    const response = {
      ...positionResponse,
      results: [
        { ...position, instrument: { ...position.instrument, id: 'unknown', symbol: 'UNKNOWN' } },
        {
          ...position,
          instrument: { ...position.instrument, id: 'crypto', kind: 'crypto', symbol: 'VTI' },
        },
      ],
    };
    const result = normalizeAccount(account, response, balances);
    expect(result.positions.every((item) => item.assetClass === 'unclassified')).toBe(true);
    expect(result.positions[1].priceCents).toBeNull();
    expect(result.issues.join(' ')).toContain('crypto instruments are unsupported');
  });
  it('blocks missing data, unknown tax treatment, short positions, and FX without silent guesses', () => {
    const response = { results: [{ ...position, units: '-2', price: null, currency: 'CAD' }] };
    const result = normalizeAccount(
      { ...account, raw_type: null },
      response,
      [{ currency: { code: 'USD' }, cash: null }],
      { connectionKnown: false },
    );
    expect(result.positions[0].priceCents).toBeNull();
    expect(result.issues.join(' ')).toMatch(
      /cash balance.*tax treatment.*connection status.*freshness.*short positions.*currency.*market price/i,
    );
  });
  it('recognizes retirement raw types and uses the older of cash and positions timestamps', () => {
    const result = normalizeAccount(
      { ...account, raw_type: 'Roth IRA', sync_status: { balances: '2026-10-13T14:00:00Z' } },
      positionResponse,
      balances,
    );
    expect(result.type).toBe('retirement');
    expect(result.syncedAt).toBe('2026-10-13T14:00:00.000Z');
  });
  it('blocks cash borrowing, a disabled connection, duplicate holdings, and unreconciled account values', () => {
    const result = normalizeAccount(
      account,
      { ...positionResponse, results: [position, position] },
      [{ currency: { code: 'USD' }, cash: -50 }],
      { connectionDisabled: true },
    );
    expect(result.issues.join(' ')).toMatch(/negative cash.*disabled.*duplicate/);
    expect(
      normalizeAccount(
        { ...account, net_value: { amount: 9999, currency: 'USD' } },
        positionResponse,
        balances,
      ).issues.join(),
    ).toContain('do not reconcile');
  });
});

describe('portfolio source completeness', () => {
  const api = (handler: (path: string) => unknown): Pick<OAuthService, 'api'> => ({
    api: async <T>(_id: string, path: string) => handler(path) as T,
  });
  it('loads modern investment accounts and clearly omits bank accounts', async () => {
    const portfolio = await loadPortfolio(
      'session',
      api((path) => {
        if (path === '/accounts/all')
          return { results: [account, { id: 'bank', kind: 'deposit' }] };
        if (path === '/authorizations')
          return [{ id: 'connection-one', disabled: false, brokerage: { name: 'Test broker' } }];
        if (path.endsWith('/positions/all')) return positionResponse;
        return balances;
      }),
    );
    expect(portfolio.mode).toBe('live');
    expect(portfolio.accounts).toHaveLength(1);
    expect(portfolio.accounts[0].issues).toEqual([]);
    expect(portfolio.accounts[0].broker).toBe('Test broker');
    expect(portfolio.warnings.join()).toContain('non-investment accounts are excluded');
  });
  it('marks partial account failures so unknown cash cannot become a spendable zero', async () => {
    const portfolio = await loadPortfolio(
      'session',
      api((path) => {
        if (path === '/accounts/all') return { results: [account] };
        if (path === '/authorizations') return [{ id: 'connection-one', disabled: false }];
        if (path.endsWith('/positions/all')) return positionResponse;
        throw new UpstreamError(429, '60');
      }),
    );
    expect(portfolio.accounts[0].cashCents).toBe(0);
    expect(portfolio.accounts[0].issues.join()).toContain('rate limited');
    expect(portfolio.accounts[0].issues.join()).toContain('Retry after 60');
    expect(portfolio.accounts[0].issues.length).toBeGreaterThan(0);
  });
  it('blocks all accounts when connection status could not be loaded', async () => {
    const portfolio = await loadPortfolio(
      'session',
      api((path) => {
        if (path === '/accounts/all') return { results: [account] };
        if (path === '/authorizations') throw new UpstreamError(503);
        return path.endsWith('/positions/all') ? positionResponse : balances;
      }),
    );
    expect(portfolio.accounts[0].issues.join()).toContain(
      'connection status could not be verified',
    );
  });
});
