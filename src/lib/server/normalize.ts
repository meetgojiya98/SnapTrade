import type { Account, AssetClass, Position } from '@/lib/types';

type UnknownRecord = Record<string, unknown>;
export const record = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, 240) : fallback;
const currencyCode = (value: unknown): string =>
  /^[A-Z]{3}$/.test(text(value)) ? text(value) : '';

/** Convert decimal dollars to cents without binary floating point rounding at .005 boundaries. */
export function decimalCents(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  let input = String(value);
  if (typeof value === 'number' && /e/i.test(input) && Math.abs(value) < 1e14)
    input = value.toFixed(8);
  const match = /^([+-]?)(\d{1,16})(?:\.(\d{1,20}))?$/.exec(input);
  if (!match) return null;
  const decimals = (match[3] ?? '').padEnd(3, '0');
  let cents = BigInt(match[2]) * 100n + BigInt(decimals.slice(0, 2));
  if (Number(decimals[2]) >= 5) cents += 1n;
  if (match[1] === '-') cents = -cents;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER))
    return null;
  return Number(cents);
}

function units(value: unknown): number | null {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[+-]?\d+(?:\.\d+)?$/.test(String(value))
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= 1e12 ? number : null;
}

const funds: Record<string, AssetClass> = {
  VTI: 'us-equity',
  VOO: 'us-equity',
  IVV: 'us-equity',
  SPY: 'us-equity',
  VXUS: 'international',
  VEA: 'international',
  VWO: 'international',
  BND: 'bonds',
  AGG: 'bonds',
};
const stocks = new Set(['AAPL', 'MSFT', 'NVDA']);

function classify(symbol: string, kind: string, currency: string): AssetClass {
  if (currency !== 'USD') return 'unclassified';
  if (kind === 'etf') return funds[symbol] ?? 'unclassified';
  if (kind === 'stock' && stocks.has(symbol)) return 'us-equity';
  return 'unclassified';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function taxTreatment(rawType: unknown): { type: Account['type']; known: boolean } {
  const type = text(rawType).trim().toLowerCase();
  if (/\b(ira|roth|401\(?k\)?|403\(?b\)?|pension|retirement|rrsp|rrif|lira)\b/.test(type))
    return { type: 'retirement', known: true };
  if (
    [
      'cash',
      'margin',
      'individual',
      'joint',
      'taxable',
      'individual margin',
      'individual cash',
      'joint margin',
      'joint cash',
      'brokerage',
    ].includes(type)
  )
    return { type: 'taxable', known: true };
  return { type: 'taxable', known: false };
}

export function maskAccountNumber(value: unknown): string {
  const number = text(value).replace(/\s/g, '');
  const suffix = number.replace(/[^A-Za-z0-9]/g, '').slice(-4);
  return suffix ? `•••• ${suffix}` : '••••';
}

export interface AccountContext {
  broker?: string;
  connectionDisabled?: boolean;
  connectionKnown?: boolean;
  errors?: string[];
}

/** Missing source data is represented by a blocking issue, never a usable zero-valued account. */
export function normalizeAccount(
  source: unknown,
  positionResponse: unknown,
  balanceResponse: unknown,
  context: AccountContext = {},
): Account {
  const raw = record(source);
  const issues = [...(context.errors ?? [])];
  const id = text(raw.id);
  const portfolioPositions = record(positionResponse);
  const rawPositions = Array.isArray(portfolioPositions.results) ? portfolioPositions.results : [];
  const balances = Array.isArray(balanceResponse) ? balanceResponse.map(record) : [];
  const netValue = record(raw.net_value);
  const total = record(record(raw.balance).total);
  const currency =
    currencyCode(netValue.currency) ||
    currencyCode(total.currency) ||
    currencyCode(record(balances[0]?.currency).code) ||
    'UNKNOWN';
  if (currency !== 'USD')
    issues.push(
      'Only USD accounts are supported by this planner. No currency conversion has been applied.',
    );
  if (!Array.isArray(portfolioPositions.results))
    issues.push('Positions are unavailable. Reconnect or refresh before creating a plan.');
  if (!Array.isArray(balanceResponse) || !balances.length)
    issues.push('Cash balance is unavailable. Reconnect or refresh before creating a plan.');
  const matchingBalances = balances.filter(
    (balance) => currencyCode(record(balance.currency).code) === currency,
  );
  const cash = matchingBalances.length === 1 ? decimalCents(matchingBalances[0].cash) : null;
  if (cash === null) issues.push('A complete cash balance in the account currency is required.');
  if (cash !== null && cash < 0)
    issues.push('This account has a negative cash balance. Margin borrowing is not supported.');
  for (const balance of balances) {
    const balanceCurrency = currencyCode(record(balance.currency).code);
    if (!balanceCurrency || (balanceCurrency !== currency && decimalCents(balance.cash) !== 0)) {
      issues.push(
        'This account holds cash in another or unknown currency. Currency conversion is required.',
      );
    }
  }
  const treatment = taxTreatment(raw.raw_type ?? record(raw.meta).type);
  if (!treatment.known)
    issues.push(
      'The account tax treatment is unknown. Verify the account type before using a plan.',
    );
  if (context.connectionDisabled)
    issues.push(
      'This brokerage connection is disabled. Reconnect it in SnapTrade before creating a plan.',
    );
  if (context.connectionKnown === false)
    issues.push(
      'The brokerage connection status could not be verified. Refresh before creating a plan.',
    );
  if (['closed', 'archived', 'unavailable'].includes(text(raw.status)))
    issues.push('This account is not available for planning.');
  const sync = record(raw.sync_status);
  const holdings = record(sync.holdings);
  if (holdings.holdings_unavailable === true || holdings.initial_sync_completed === false)
    issues.push('The brokerage has not provided complete account holdings.');
  const positionTime = timestamp(record(portfolioPositions.data_freshness).as_of);
  const balanceTime = timestamp(sync.balances) ?? timestamp(holdings.last_successful_sync);
  if (!positionTime) issues.push('The positions snapshot has no valid freshness timestamp.');
  if (!balanceTime) issues.push('The cash balance has no valid freshness timestamp.');
  const syncedAt =
    positionTime && balanceTime
      ? new Date(Math.min(Date.parse(positionTime), Date.parse(balanceTime))).toISOString()
      : null;

  const positions: Position[] = [];
  const ids = new Set<string>();
  for (const [index, value] of rawPositions.entries()) {
    const position = record(value);
    // Cash sweeps already appear in balances.cash and would otherwise be counted twice.
    if (position.cash_equivalent === true) continue;
    const instrument = record(position.instrument);
    const symbol = text(instrument.symbol, text(instrument.raw_symbol, 'Unknown'));
    const kind = text(instrument.kind);
    const supportedKind = kind === 'stock' || kind === 'etf';
    if (!supportedKind) issues.push(`${symbol}: ${kind || 'unknown'} instruments are unsupported.`);
    const quantity = units(position.units);
    if (quantity === null) issues.push(`${symbol}: position quantity is unavailable or invalid.`);
    if (quantity !== null && quantity < 0)
      issues.push(`${symbol}: short positions are unsupported.`);
    const positionCurrency =
      currencyCode(position.currency) || currencyCode(instrument.currency) || 'UNKNOWN';
    if (positionCurrency !== currency)
      issues.push(`${symbol}: position currency differs from the account currency or is unknown.`);
    const price = supportedKind ? decimalCents(position.price) : null;
    if (supportedKind && (price === null || price <= 0))
      issues.push(`${symbol}: a valid market price is required.`);
    const assetClass = classify(symbol, kind, positionCurrency);
    if (assetClass === 'unclassified')
      issues.push(
        `${symbol}: asset class is unverified. This holding cannot be included in a plan.`,
      );
    const positionId = text(instrument.id, `${id}:${index}`);
    if (!text(instrument.id))
      issues.push(
        `${symbol}: stable instrument identity is unavailable. Refresh before creating a plan.`,
      );
    if (ids.has(positionId))
      issues.push(
        `${symbol}: duplicate instrument data was returned. Refresh before creating a plan.`,
      );
    ids.add(positionId);
    positions.push({
      id: positionId,
      symbol,
      name: text(instrument.description, symbol),
      assetClass,
      quantity: quantity ?? 0,
      priceCents: price,
      currency: positionCurrency,
    });
  }

  // Detect omissions and incomplete snapshots without treating a brokerage-reported total as cash.
  const reportedTotal = decimalCents(netValue.amount ?? total.amount);
  const completeValuation = positions.every(
    (position) =>
      position.currency === currency && position.priceCents !== null && position.priceCents >= 0,
  );
  if (reportedTotal !== null && cash !== null && completeValuation) {
    const calculated =
      cash +
      positions.reduce(
        (sum, position) => sum + Math.round(position.quantity * (position.priceCents ?? 0)),
        0,
      );
    if (
      !Number.isSafeInteger(calculated) ||
      Math.abs(reportedTotal - calculated) > Math.max(100, Math.abs(reportedTotal) * 0.01)
    ) {
      issues.push(
        'Holdings and cash do not reconcile with the brokerage account value. Refresh before creating a plan.',
      );
    }
  }
  return {
    id,
    name: text(raw.display_name, text(raw.name, 'Investment account')),
    broker: context.broker || text(raw.institution_name, 'Connected brokerage'),
    number: maskAccountNumber(raw.masked_account_number ?? raw.number),
    type: treatment.type,
    currency,
    cashCents: cash ?? 0,
    positions,
    syncedAt,
    issues: [...new Set(issues)],
  };
}
