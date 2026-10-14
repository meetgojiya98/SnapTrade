import { describe, expect, it } from 'vitest';
import { serializePlanCsv } from './plan-export';
import { defaultWorkspacePreferences, type SavedPlan } from './workspace';
import type { Account, Plan, Trade } from './types';

const asOf = '2026-10-14T12:00:00.000Z';
const savedAt = '2026-10-14T12:05:00.000Z';
const account = (id: string, cashCents: number): Account => ({
  id,
  name: id === 'a' ? 'Individual cash' : 'Retirement',
  broker: 'SnapTrade Sandbox',
  number: id === 'a' ? '••1111' : '••2222',
  type: 'retirement',
  currency: 'USD',
  cashCents,
  positions: [],
  syncedAt: asOf,
  issues: [],
});
const trade = (
  accountId: string,
  side: 'buy' | 'sell',
  valueCents: number,
  symbol = 'VTI',
): Trade => ({
  accountId,
  accountName: accountId === 'a' ? 'Taxable' : 'Retirement',
  symbol,
  assetClass: 'us-equity',
  side,
  quantity: valueCents / 500,
  priceCents: 500,
  valueCents,
  reason: side === 'buy' ? 'Add allocation' : 'Trim allocation',
});
const result = (trades: Trade[] = []): Plan => ({
  status: 'ready',
  trades,
  warnings: [],
  blockers: [],
  before: [],
  after: [],
  cashBeforeCents: 100_000,
  cashAfterCents: 100_000,
  driftBefore: 100,
  driftAfter: 100,
  totalCents: 75_000,
});
function savedPlan(): SavedPlan {
  const plan = result();
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Cash baseline',
    createdAt: savedAt,
    asOf,
    sourceFingerprint: 'original-snapshot',
    status: 'ready',
    driftBefore: plan.driftBefore,
    driftAfter: plan.driftAfter,
    tradeCount: 0,
    totalCents: plan.totalCents,
    historical: true,
    executable: false,
    preferences: structuredClone(defaultWorkspacePreferences),
    contributionCents: 0,
    contributionAccountId: null,
    source: { mode: 'live', asOf, warnings: [], accounts: [account('a', 100_000)] },
    result: plan,
  };
}
const historical = (saved: SavedPlan, suppliedPlan = saved.result) =>
  serializePlanCsv(suppliedPlan, 'USD', { historical: true, asOf, demo: false, savedPlan: saved });

describe('plan CSV export', () => {
  it('preserves the current CSV structure and seven trade columns exactly', () => {
    const plan = result([
      { ...trade('a', 'buy', 1500, 'VXUS'), quantity: 3 },
      { ...trade('b', 'sell', 2000), quantity: 2, priceCents: 1000 },
    ]);
    const expected = [
      '# Balance simulation. Read-only; never executable. No orders placed.',
      `# Snapshot as of ${asOf}. Indicative prices; fees, taxes, FX and settlement are not modeled.`,
      '"Account","Side","Symbol","Shares","Estimated price (USD)","Estimated value (USD)","Reason"',
      '"Retirement","sell","VTI","2","10.00","20.00","Trim allocation"',
      '"Taxable","buy","VXUS","3","5.00","15.00","Add allocation"',
    ].join('\r\n');
    expect(serializePlanCsv(plan, 'USD', { historical: false, asOf, demo: false })).toBe(expected);
    expect(
      serializePlanCsv(plan, 'USD', {
        historical: false,
        asOf,
        demo: false,
        savedPlan: savedPlan(),
      }),
    ).toBe(expected);
  });

  it('makes a zero-trade historical export useful with original policy and cash context', () => {
    const saved = savedPlan();
    saved.contributionCents = 50_000;
    saved.contributionAccountId = 'a';
    saved.result.cashBeforeCents = 150_000;
    saved.result.cashAfterCents = 150_000;
    saved.result.totalCents = 125_000;
    const csv = historical(saved);
    expect(csv).toContain('# Saved plan,"Cash baseline"');
    expect(csv).toContain(`# Saved at,"${savedAt}"`);
    expect(csv).toContain('# Target mix,"US equities 50%; International equities 30%; Bonds 20%"');
    expect(csv).toContain(
      'Reserve per account USD 250.00; minimum trade USD 100.00; taxable sales protected',
    );
    expect(csv).toContain(
      'USD 500.00; destination SnapTrade Sandbox · Individual cash · ••1111; no money transferred',
    );
    expect(csv).toContain(
      'Planning base USD 1250.00; allocation drift 100 pp to 100 pp; 0 proposed moves',
    );
    expect(csv).toContain(
      'reported cash USD 1000.00; new cash USD 500.00; sells USD 0.00; buys USD 0.00; cash after USD 1500.00; protected reserve USD 250.00',
    );
    expect(csv).toContain(`brokerage snapshot ${asOf}`);
    expect(csv.split('\r\n').filter((line) => !line.startsWith('# '))).toHaveLength(1);
  });

  it('preserves each selected account’s own contribution and estimated funding', () => {
    const saved = savedPlan();
    saved.source.accounts = [
      account('a', 100_000),
      account('b', 200_000),
      account('excluded', 999_999),
    ];
    saved.preferences.selectedAccountIds = ['a', 'b'];
    saved.preferences.allowTaxableSales = true;
    saved.contributionCents = 40_000;
    saved.contributionAccountId = 'b';
    saved.result.trades = [
      trade('a', 'sell', 25_000),
      trade('a', 'buy', 10_000),
      trade('b', 'buy', 30_000),
    ];
    const funding = historical(saved)
      .split('\r\n')
      .filter((line) => line.startsWith('# Account funding,'));
    expect(funding).toHaveLength(2);
    expect(funding[0]).toContain(
      'reported cash USD 1000.00; new cash USD 0.00; sells USD 250.00; buys USD 100.00; cash after USD 1150.00',
    );
    expect(funding[1]).toContain(
      'reported cash USD 2000.00; new cash USD 400.00; sells USD 0.00; buys USD 300.00; cash after USD 2100.00',
    );
    expect(historical(saved)).toContain('taxable sales allowed');
    expect(funding.join('\n')).not.toContain('excluded');
  });

  it('uses the immutable saved result and metadata even if a different current preview is supplied', () => {
    const saved = savedPlan();
    saved.name = 'Original policy';
    saved.result.trades = [trade('a', 'buy', 1000, 'ORIGINAL')];
    const before = structuredClone(saved);
    const csv = serializePlanCsv(result([trade('b', 'buy', 5000, 'CURRENT')]), 'USD', {
      historical: true,
      asOf: '2099-01-01T00:00:00.000Z',
      demo: true,
      savedPlan: saved,
    });
    expect(csv).toContain('Snapshot as of 2026-10-14T12:00:00.000Z');
    expect(csv).toContain('Original policy');
    expect(csv).toContain('"ORIGINAL"');
    expect(csv).not.toContain('CURRENT');
    expect(csv).not.toContain('SAMPLE');
    expect(saved).toEqual(before);
  });

  it('disambiguates legacy historical trade names using original source account IDs and masks', () => {
    const saved = savedPlan();
    saved.source.accounts = [account('a', 100_000), account('b', 200_000)];
    saved.source.accounts.forEach((item) => {
      item.broker = 'Shared Broker';
      item.name = 'Brokerage';
    });
    saved.result.trades = [
      { ...trade('a', 'buy', 500), accountName: 'Brokerage' },
      { ...trade('b', 'buy', 1000), accountName: 'Brokerage' },
      { ...trade('missing', 'sell', 500), accountName: 'Legacy missing account' },
    ];
    const before = structuredClone(saved);
    const rows = historical(saved)
      .split('\r\n')
      .filter((line) => !line.startsWith('# '));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatch(/^"Legacy missing account","sell"/);
    expect(rows[2]).toMatch(/^"Shared Broker · Brokerage · ••1111","buy"/);
    expect(rows[3]).toMatch(/^"Shared Broker · Brokerage · ••2222","buy"/);
    expect(saved).toEqual(before);
  });

  it('prevents names from injecting metadata rows or spreadsheet formulas', () => {
    const saved = savedPlan();
    saved.name =
      '=HYPERLINK("https://example.test", "click")\r\n"Injected","sell","EVIL","99"\u2028=SUM(1,1)';
    saved.source.accounts[0].broker = '@SUM(1,1)\nInjected broker';
    saved.source.accounts[0].name = '-1+1\tCash\r\nAccount';
    saved.source.accounts[0].number = '••1111\u2029Injected number';
    saved.result.trades = [
      { ...trade('a', 'buy', 500), accountName: '=SUM(1,1)\r\nInjected trade account' },
    ];
    const csv = historical(saved);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(12); // Two introductory comments, seven policy comments, one account, header, one trade.
    expect(csv).not.toMatch(/[\t\u2028\u2029]/);
    expect(lines.find((line) => line.startsWith('# Saved plan,'))).toMatch(
      /^# Saved plan,"'=HYPERLINK/,
    );
    expect(lines.find((line) => line.startsWith('# Account funding,'))).toMatch(
      /^# Account funding,"'@SUM/,
    );
    expect(lines.at(-1)).toContain(
      '"\'@SUM(1,1) Injected broker · -1+1 Cash Account · ••1111 Injected number","buy"',
    );
    expect(lines.filter((line) => line.startsWith('"Injected"'))).toHaveLength(0);
  });
});
