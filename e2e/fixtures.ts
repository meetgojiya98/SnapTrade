import { makeDemoPortfolio } from '../src/lib/demo';
import type { Portfolio } from '../src/lib/types';

/** A realistic server-normalized live response requiring explicit asset review. */
export function livePortfolioNeedingClassification(): Portfolio {
  const portfolio = makeDemoPortfolio();
  portfolio.mode = 'live';
  portfolio.warnings = [];
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
