export type Currency = string;

export type AssetClass = 'us-equity' | 'international' | 'bonds' | 'unclassified';

export interface Position {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  priceCents: number | null;
  currency: Currency;
  cashEquivalent?: boolean;
}

export interface Account {
  id: string;
  name: string;
  broker: string;
  number: string;
  type: 'taxable' | 'retirement';
  currency: Currency;
  cashCents: number;
  positions: Position[];
  syncedAt: string | null;
  issues: string[];
}

export interface Portfolio {
  mode: 'demo' | 'live';
  asOf: string;
  accounts: Account[];
  warnings: string[];
}

export interface Target {
  assetClass: AssetClass;
  percent: number;
}

export interface PlanOptions {
  targets: Target[];
  allowTaxableSales: boolean;
  /** A fixed reserve in each selected account. It is excluded from the target denominator. */
  cashBufferCents: number;
  /** Hypothetical new cash, allocated to one selected account before planning. */
  contributionCents: number;
  contributionAccountId: string | null;
  minimumTradeCents: number;
  /** Optional deterministic valuation time for tests and reproducible previews. */
  now?: string;
}

export interface Trade {
  accountId: string;
  accountName: string;
  symbol: string;
  assetClass: AssetClass;
  side: 'buy' | 'sell';
  quantity: number;
  priceCents: number;
  valueCents: number;
  reason: string;
}

export interface Allocation {
  assetClass: AssetClass;
  valueCents: number;
  percent: number;
  targetPercent: number;
}

export interface Plan {
  status: 'ready' | 'blocked';
  trades: Trade[];
  warnings: string[];
  blockers: string[];
  before: Allocation[];
  after: Allocation[];
  /** Actual cash including reserves and the hypothetical contribution. */
  cashBeforeCents: number;
  cashAfterCents: number;
  /** Half the absolute class-and-cash allocation error, in percentage points. */
  driftBefore: number;
  driftAfter: number;
  /** Priced non-cash-equivalent holdings + cash + contribution - per-account reserves. */
  totalCents: number;
}
