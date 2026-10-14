import type { Account, AssetClass, Portfolio, Position } from './types';

function holding(
  symbol: string,
  name: string,
  assetClass: AssetClass,
  quantity: number,
  priceCents: number,
): Position {
  return { id: symbol, symbol, name, assetClass, quantity, priceCents, currency: 'USD' };
}

/** Entirely simulated USD accounts. Prices are scenario data, never market quotes. */
export function makeDemoPortfolio(): Portfolio {
  const asOf = new Date().toISOString();
  const accounts: Account[] = [
    {
      id: 'demo-fidelity',
      name: 'Individual brokerage',
      broker: 'Fidelity',
      number: '••4821',
      type: 'taxable',
      currency: 'USD',
      cashCents: 180_000,
      syncedAt: asOf,
      issues: [],
      positions: [
        holding('VTI', 'Vanguard Total Stock Market ETF', 'us-equity', 75, 28_000),
        holding('AAPL', 'Apple Inc.', 'us-equity', 60, 23_000),
        holding('MSFT', 'Microsoft Corporation', 'us-equity', 25, 48_000),
        holding('VXUS', 'Vanguard Total International Stock ETF', 'international', 80, 6_500),
        holding('BND', 'Vanguard Total Bond Market ETF', 'bonds', 40, 7_300),
      ],
    },
    {
      id: 'demo-ibkr',
      name: 'Rollover IRA',
      broker: 'Interactive Brokers',
      number: '••7309',
      type: 'retirement',
      currency: 'USD',
      cashCents: 220_000,
      syncedAt: asOf,
      issues: [],
      positions: [
        holding('VTI', 'Vanguard Total Stock Market ETF', 'us-equity', 85, 28_000),
        holding('NVDA', 'NVIDIA Corporation', 'us-equity', 50, 14_000),
        holding('VXUS', 'Vanguard Total International Stock ETF', 'international', 90, 6_500),
        holding('BND', 'Vanguard Total Bond Market ETF', 'bonds', 45, 7_300),
      ],
    },
    {
      id: 'demo-wealthsimple',
      name: 'Retirement portfolio',
      broker: 'Wealthsimple',
      number: '••9186',
      type: 'retirement',
      currency: 'USD',
      cashCents: 145_000,
      syncedAt: asOf,
      issues: [],
      positions: [
        holding('VTI', 'Vanguard Total Stock Market ETF', 'us-equity', 40, 28_000),
        holding('VXUS', 'Vanguard Total International Stock ETF', 'international', 120, 6_500),
        holding('BND', 'Vanguard Total Bond Market ETF', 'bonds', 75, 7_300),
      ],
    },
  ];
  return {
    mode: 'demo',
    asOf,
    accounts,
    warnings: [
      'Simulated accounts and prices. This preview does not connect to a brokerage or place orders.',
    ],
  };
}
