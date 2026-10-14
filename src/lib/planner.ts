import type { Account, Allocation, AssetClass, Plan, PlanOptions, Target, Trade } from './types';
import { accountDisplayName } from './account-label';

export const defaultTargets: Target[] = [
  { assetClass: 'us-equity', percent: 50 },
  { assetClass: 'international', percent: 30 },
  { assetClass: 'bonds', percent: 20 },
];

const classes: AssetClass[] = ['us-equity', 'international', 'bonds', 'unclassified'];
const supportedClasses = new Set<AssetClass>(['us-equity', 'international', 'bonds']);
const dayMs = 24 * 60 * 60 * 1_000;
const epsilon = 0.000_001;
const maxIterations = 160;
const maxEvaluations = 250_000;

type Values = Record<AssetClass, number>;
type Security = { symbol: string; assetClass: AssetClass; quantity: number; priceCents: number };
type WorkingAccount = { source: Account; cashCents: number; securities: Security[] };
type Action = {
  account: WorkingAccount;
  buy: Security;
  buyQuantity: number;
  sell?: Security;
  sellQuantity: number;
  improvement: number;
  classError: number;
  turnover: number;
  key: string;
};

const emptyValues = (): Values => ({ 'us-equity': 0, international: 0, bonds: 0, unclassified: 0 });
const isMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;
const normalizedCurrency = (currency: string) => currency.trim().toUpperCase();

function positionValue(quantity: number, priceCents: number | null): number {
  return priceCents !== null && Number.isFinite(quantity) && Number.isFinite(priceCents)
    ? Math.round(quantity * priceCents)
    : 0;
}

/** Gross value used by this planner; cash-equivalent positions are excluded, not counted twice as cash. */
export function accountValueCents(account: Account): number {
  return (
    account.cashCents +
    account.positions.reduce(
      (sum, position) =>
        sum + (position.cashEquivalent ? 0 : positionValue(position.quantity, position.priceCents)),
      0,
    )
  );
}

function valuesFor(accounts: Account[]): Values {
  const values = emptyValues();
  for (const account of accounts) {
    for (const position of account.positions) {
      if (!position.cashEquivalent && classes.includes(position.assetClass)) {
        values[position.assetClass] += positionValue(position.quantity, position.priceCents);
      }
    }
  }
  return values;
}

function allocations(values: Values, targets: Target[], denominator: number): Allocation[] {
  return classes
    .filter(
      (assetClass) =>
        assetClass !== 'unclassified' ||
        values.unclassified > 0 ||
        targets.some((target) => target.assetClass === assetClass),
    )
    .map((assetClass) => ({
      assetClass,
      valueCents: values[assetClass],
      percent: denominator > 0 ? (values[assetClass] / denominator) * 100 : 0,
      targetPercent: targets.find((target) => target.assetClass === assetClass)?.percent ?? 0,
    }));
}

/** A gross portfolio snapshot. generatePlan applies contribution and reserve adjustments to its own snapshots. */
export function calculateAllocation(accounts: Account[], targets: Target[]): Allocation[] {
  return allocations(
    valuesFor(accounts),
    targets,
    accounts.reduce((sum, account) => sum + accountValueCents(account), 0),
  );
}

function classError(values: Values, targetValues: Values): number {
  return classes.reduce(
    (sum, assetClass) => sum + Math.abs(values[assetClass] - targetValues[assetClass]),
    0,
  );
}

function drift(
  values: Values,
  targetValues: Values,
  cashCents: number,
  denominator: number,
): number {
  return denominator > 0
    ? ((classError(values, targetValues) + Math.abs(cashCents)) / (2 * denominator)) * 100
    : 0;
}

function minimumQuantity(priceCents: number, minimumTradeCents: number): number {
  return Math.max(1, Math.ceil(minimumTradeCents / priceCents));
}

function quantitiesNear(candidates: number[], maximum: number, minimum: number): number[] {
  const result = new Set<number>();
  for (const candidate of candidates) {
    for (const quantity of [Math.floor(candidate), Math.ceil(candidate)]) {
      if (quantity >= minimum && quantity <= maximum && Number.isSafeInteger(quantity))
        result.add(quantity);
    }
  }
  return [...result].sort((left, right) => left - right);
}

/**
 * Deterministic, bounded whole-share preview, not an order executor or a global optimizer.
 * Its objective is class L1 error plus residual investable cash. A sale/buy pair is
 * evaluated together so an account never sells solely to create unusable cash.
 * Target percentages refer to holdings + cash + contribution - a reserve per account.
 * Each account funds its own buys; only explicitly mapped, already present securities
 * are eligible. There is no currency conversion, transfer, margin, or short selling.
 */
export function generatePlan(accounts: Account[], options: PlanOptions): Plan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nowMs = options.now === undefined ? Date.now() : Date.parse(options.now);
  const rawValues = valuesFor(accounts);
  const grossCents = accounts.reduce((sum, account) => sum + accountValueCents(account), 0);
  const initialCashCents = accounts.reduce((sum, account) => sum + account.cashCents, 0);

  if (accounts.length === 0) blockers.push('Select at least one account to build a plan.');
  if (!Number.isFinite(nowMs)) blockers.push('The planning time is invalid.');
  if (accounts.reduce((sum, account) => sum + account.positions.length, 0) > 1_000) {
    blockers.push('This preview supports up to 1,000 positions. Select fewer accounts.');
  }
  for (const [name, value] of [
    ['Cash reserve', options.cashBufferCents],
    ['Contribution', options.contributionCents],
    ['Minimum trade', options.minimumTradeCents],
  ] as const) {
    if (!isMoney(value)) blockers.push(`${name} must be a nonnegative, whole number of cents.`);
  }
  const seenTargets = new Set<AssetClass>();
  let targetSum = 0;
  for (const target of options.targets) {
    if (!classes.includes(target.assetClass))
      blockers.push('A target has an unsupported asset class.');
    if (seenTargets.has(target.assetClass))
      blockers.push(`There is more than one target for ${target.assetClass}.`);
    seenTargets.add(target.assetClass);
    if (!Number.isFinite(target.percent) || target.percent < 0 || target.percent > 100) {
      blockers.push('Each target must be between 0% and 100%.');
    }
    if (target.assetClass === 'unclassified' && target.percent !== 0) {
      blockers.push(
        'Unclassified holdings cannot have a target. Map them to a supported class first.',
      );
    }
    targetSum += target.percent;
  }
  if (Math.abs(targetSum - 100) > epsilon) blockers.push('Allocation targets must add up to 100%.');
  if (
    options.contributionCents > 0 &&
    !accounts.some((account) => account.id === options.contributionAccountId)
  ) {
    blockers.push('Choose a selected account for the hypothetical contribution.');
  }

  const seenAccounts = new Set<string>();
  const currencies = new Set<string>();
  const symbolClasses = new Map<string, AssetClass>();
  let excludedPositions = 0;
  for (const account of accounts) {
    if (!account.id || seenAccounts.has(account.id))
      blockers.push('Each selected account must have a unique ID.');
    seenAccounts.add(account.id);
    const currency = normalizedCurrency(account.currency);
    if (!currency) blockers.push(`${account.name}: account currency is missing.`);
    currencies.add(currency);
    if (!isMoney(account.cashCents))
      blockers.push(
        `${account.name}: cash must be nonnegative whole cents; margin balances are unsupported.`,
      );
    if (account.type !== 'taxable' && account.type !== 'retirement')
      blockers.push(`${account.name}: account tax treatment is unknown.`);
    const syncedMs = account.syncedAt ? Date.parse(account.syncedAt) : Number.NaN;
    if (!Number.isFinite(syncedMs))
      blockers.push(`${account.name}: sync the account before planning.`);
    else if (nowMs - syncedMs > dayMs)
      blockers.push(`${account.name}: holdings are older than 24 hours. Sync before planning.`);
    else if (syncedMs - nowMs > 5 * 60 * 1_000)
      blockers.push(`${account.name}: the sync timestamp is in the future.`);
    for (const issue of account.issues) blockers.push(`${account.name}: ${issue}`);

    const seenSymbols = new Map<string, { priceCents: number | null; assetClass: AssetClass }>();
    for (const position of account.positions) {
      if (position.cashEquivalent) {
        excludedPositions += 1;
        continue;
      }
      const symbol = position.symbol.trim().toUpperCase();
      if (!symbol) blockers.push(`${account.name}: a holding has no tradable symbol.`);
      if (!Number.isFinite(position.quantity) || position.quantity < 0)
        blockers.push(
          `${account.name}: ${symbol || 'a holding'} has an invalid or short quantity.`,
        );
      if (
        position.priceCents === null ||
        !Number.isSafeInteger(position.priceCents) ||
        position.priceCents <= 0
      ) {
        blockers.push(`${account.name}: ${symbol || 'a holding'} needs a valid positive price.`);
      }
      if (!Number.isSafeInteger(positionValue(position.quantity, position.priceCents))) {
        blockers.push(
          `${account.name}: ${symbol || 'a holding'} has a value outside the supported range.`,
        );
      }
      if (normalizedCurrency(position.currency) !== currency)
        blockers.push(
          `${account.name}: ${symbol || 'a holding'} uses a different currency from its account.`,
        );
      if (!supportedClasses.has(position.assetClass))
        blockers.push(
          `${account.name}: classify ${symbol || 'the unknown holding'} before planning.`,
        );
      const previous = seenSymbols.get(symbol);
      if (previous) {
        blockers.push(
          `${account.name}: ${symbol} appears more than once. Resolve duplicate records or distinct instruments sharing a symbol before planning.`,
        );
      }
      if (
        previous &&
        (previous.priceCents !== position.priceCents || previous.assetClass !== position.assetClass)
      ) {
        blockers.push(`${account.name}: ${symbol} has inconsistent prices or classifications.`);
      }
      seenSymbols.set(symbol, { priceCents: position.priceCents, assetClass: position.assetClass });
      const previousClass = symbolClasses.get(symbol);
      if (previousClass && previousClass !== position.assetClass)
        blockers.push(`${symbol} has inconsistent asset classes across selected accounts.`);
      symbolClasses.set(symbol, position.assetClass);
    }
  }
  if (currencies.size > 1)
    blockers.push('Select accounts in one currency. This preview does not convert currencies.');
  if (excludedPositions > 0)
    warnings.push(
      `${excludedPositions} cash-equivalent position${excludedPositions === 1 ? ' is' : 's are'} excluded from allocation and trading; only reported cash balances are spendable.`,
    );

  const contribution = isMoney(options.contributionCents) ? options.contributionCents : 0;
  const reserve = isMoney(options.cashBufferCents) ? options.cashBufferCents : 0;
  const cashBeforeCents = initialCashCents + contribution;
  const totalCents = grossCents + contribution - reserve * accounts.length;
  if (
    !Number.isSafeInteger(grossCents) ||
    !Number.isSafeInteger(grossCents + contribution) ||
    !Number.isSafeInteger(cashBeforeCents) ||
    !Number.isSafeInteger(totalCents)
  ) {
    blockers.push('The portfolio value is outside the supported monetary range.');
  }
  if (accounts.length > 0 && totalCents <= 0)
    blockers.push('The portfolio must have a positive investable value after cash reserves.');
  const targetValues = emptyValues();
  for (const target of options.targets) {
    if (classes.includes(target.assetClass) && Number.isFinite(target.percent))
      targetValues[target.assetClass] = (totalCents * target.percent) / 100;
  }
  const before = allocations(rawValues, options.targets, totalCents);
  const driftBefore = drift(
    rawValues,
    targetValues,
    cashBeforeCents - reserve * accounts.length,
    totalCents,
  );
  const blockedPlan = (): Plan => ({
    status: 'blocked',
    trades: [],
    warnings,
    blockers: [...new Set(blockers)],
    before,
    after: before,
    cashBeforeCents,
    cashAfterCents: cashBeforeCents,
    driftBefore,
    driftAfter: driftBefore,
    totalCents,
  });
  if (blockers.length > 0) return blockedPlan();

  const working: WorkingAccount[] = [...accounts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((account) => {
      const securities = new Map<string, Security>();
      for (const position of account.positions) {
        if (position.cashEquivalent) continue;
        const symbol = position.symbol.trim().toUpperCase();
        const existing = securities.get(symbol);
        if (existing) existing.quantity += position.quantity;
        else
          securities.set(symbol, {
            symbol,
            assetClass: position.assetClass,
            quantity: position.quantity,
            priceCents: position.priceCents!,
          });
      }
      return {
        source: account,
        cashCents:
          account.cashCents + (account.id === options.contributionAccountId ? contribution : 0),
        securities: [...securities.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      };
    });
  const currentValues = { ...rawValues };
  const trades = new Map<string, Trade>();
  const directions = new Map<string, 'buy' | 'sell'>();
  const canSell = (account: WorkingAccount) =>
    account.source.type === 'retirement' || options.allowTaxableSales;
  const securityKey = (account: WorkingAccount, security: Security) =>
    `${account.source.id}\u0000${security.symbol}`;
  let currentCash = cashBeforeCents;

  function record(
    account: WorkingAccount,
    security: Security,
    side: 'buy' | 'sell',
    quantity: number,
    reserveSale = false,
  ) {
    const valueCents = quantity * security.priceCents;
    const sign = side === 'buy' ? 1 : -1;
    account.cashCents -= sign * valueCents;
    currentCash -= sign * valueCents;
    security.quantity += sign * quantity;
    currentValues[security.assetClass] += sign * valueCents;
    const key = securityKey(account, security);
    directions.set(key, side);
    const previous = trades.get(key);
    if (previous) {
      previous.quantity += quantity;
      previous.valueCents += valueCents;
    } else {
      trades.set(key, {
        accountId: account.source.id,
        accountName: accountDisplayName(account.source),
        symbol: security.symbol,
        assetClass: security.assetClass,
        side,
        quantity,
        priceCents: security.priceCents,
        valueCents,
        reason: reserveSale
          ? 'Restore this account’s cash reserve.'
          : side === 'sell'
            ? 'Reduce overweight exposure and fund purchases in this account.'
            : 'Move this account’s available cash toward its portfolio target.',
      });
    }
  }

  // A reserve is a hard per-account constraint, including accounts whose cash starts below it.
  // Validate feasibility before making any recommendation; blocked plans never expose partial trades.
  for (const account of working) {
    const possibleProceeds = canSell(account)
      ? account.securities.reduce((sum, security) => {
          const quantity = Math.floor(security.quantity);
          return (
            sum +
            (quantity >= minimumQuantity(security.priceCents, options.minimumTradeCents)
              ? quantity * security.priceCents
              : 0)
          );
        }, 0)
      : 0;
    if (account.cashCents + possibleProceeds < reserve) {
      blockers.push(
        `${account.source.name}: the cash reserve cannot be funded with permitted whole-share sales. Lower the reserve${account.source.type === 'taxable' && !options.allowTaxableSales ? ' or allow taxable sales' : ''}.`,
      );
    }
  }
  if (blockers.length > 0) return blockedPlan();
  for (const account of working) {
    while (account.cashCents < reserve) {
      const deficit = reserve - account.cashCents;
      let best:
        { security: Security; quantity: number; error: number; proceeds: number } | undefined;
      for (const security of account.securities) {
        const maximum = Math.floor(security.quantity);
        const minimum = minimumQuantity(security.priceCents, options.minimumTradeCents);
        if (maximum < minimum) continue;
        const quantity = Math.min(
          maximum,
          Math.max(minimum, Math.ceil(deficit / security.priceCents)),
        );
        const proceeds = quantity * security.priceCents;
        const changed = {
          ...currentValues,
          [security.assetClass]: currentValues[security.assetClass] - proceeds,
        };
        const error = classError(changed, targetValues);
        if (
          !best ||
          error < best.error - epsilon ||
          (Math.abs(error - best.error) <= epsilon && proceeds < best.proceeds)
        )
          best = { security, quantity, error, proceeds };
      }
      if (!best) {
        blockers.push(`${account.source.name}: no permitted trade can restore the cash reserve.`);
        return blockedPlan();
      }
      record(account, best.security, 'sell', best.quantity, true);
    }
  }

  let evaluations = 0;
  let limitReached = false;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const errorBefore = classError(currentValues, targetValues);
    const objectiveBefore = errorBefore + currentCash - reserve * accounts.length;
    let best: Action | undefined;

    function consider(
      account: WorkingAccount,
      buy: Security,
      buyQuantity: number,
      sell?: Security,
      sellQuantity = 0,
    ) {
      if (++evaluations > maxEvaluations) {
        limitReached = true;
        return;
      }
      const buyValue = buyQuantity * buy.priceCents;
      const sellValue = sell ? sellQuantity * sell.priceCents : 0;
      if (account.cashCents + sellValue - buyValue < reserve) return;
      const changed = { ...currentValues };
      changed[buy.assetClass] += buyValue;
      if (sell) changed[sell.assetClass] -= sellValue;
      const error = classError(changed, targetValues);
      const objectiveAfter = error + currentCash + sellValue - buyValue - reserve * accounts.length;
      const improvement = objectiveBefore - objectiveAfter;
      if (improvement <= epsilon) return;
      const candidate: Action = {
        account,
        buy,
        buyQuantity,
        sell,
        sellQuantity,
        improvement,
        classError: error,
        turnover: buyValue + sellValue,
        key: `${account.source.id}:${buy.symbol}:${sell?.symbol ?? ''}:${buyQuantity}:${sellQuantity}`,
      };
      if (
        !best ||
        improvement > best.improvement + epsilon ||
        (Math.abs(improvement - best.improvement) <= epsilon &&
          (error < best.classError - epsilon ||
            (Math.abs(error - best.classError) <= epsilon &&
              (candidate.turnover < best.turnover ||
                (candidate.turnover === best.turnover && candidate.key < best.key)))))
      )
        best = candidate;
    }

    search: for (const account of working) {
      const spendable = account.cashCents - reserve;
      for (const buy of account.securities) {
        if (directions.get(securityKey(account, buy)) === 'sell') continue;
        const deficit = targetValues[buy.assetClass] - currentValues[buy.assetClass];
        if (deficit <= epsilon) continue;
        const minimumBuy = minimumQuantity(buy.priceCents, options.minimumTradeCents);
        const maximumBuy = Math.floor(spendable / buy.priceCents);
        for (const quantity of quantitiesNear(
          [minimumBuy, maximumBuy, deficit / buy.priceCents],
          maximumBuy,
          minimumBuy,
        )) {
          consider(account, buy, quantity);
          if (limitReached) break search;
        }
        if (!canSell(account)) continue;
        for (const sell of account.securities) {
          if (
            sell.assetClass === buy.assetClass ||
            directions.get(securityKey(account, sell)) === 'buy'
          )
            continue;
          const excess = currentValues[sell.assetClass] - targetValues[sell.assetClass];
          if (excess <= epsilon) continue;
          const maximumSell = Math.floor(sell.quantity);
          const minimumSell = minimumQuantity(sell.priceCents, options.minimumTradeCents);
          if (maximumSell < minimumSell) continue;
          const budget = spendable + maximumSell * sell.priceCents;
          const buyLimit = Math.floor(budget / buy.priceCents);
          const near = [
            minimumBuy,
            deficit / buy.priceCents,
            buyLimit,
            (spendable + Math.min(excess, maximumSell * sell.priceCents)) / buy.priceCents,
            (spendable + minimumSell * sell.priceCents) / buy.priceCents,
          ];
          for (const buyQuantity of quantitiesNear(near, buyLimit, minimumBuy)) {
            const shortage = buyQuantity * buy.priceCents - spendable;
            if (shortage <= 0) continue;
            const sellQuantity = Math.max(minimumSell, Math.ceil(shortage / sell.priceCents));
            if (sellQuantity > maximumSell) continue;
            consider(account, buy, buyQuantity, sell, sellQuantity);
            if (limitReached) break search;
          }
        }
      }
    }
    if (best) {
      // Execute the sale first: even the proposed intermediate state has no margin borrowing.
      if (best.sell) record(best.account, best.sell, 'sell', best.sellQuantity);
      record(best.account, best.buy, 'buy', best.buyQuantity);
    }
    if (!best || limitReached) break;
    if (iteration === maxIterations - 1) limitReached = true;
  }

  const driftAfter = drift(
    currentValues,
    targetValues,
    currentCash - reserve * accounts.length,
    totalCents,
  );
  if (limitReached)
    warnings.push(
      'The bounded search reached its limit. Review this feasible preview; it may leave additional improvements available.',
    );
  if (!options.allowTaxableSales && accounts.some((account) => account.type === 'taxable'))
    warnings.push(
      'Taxable sales are disabled. Only retirement accounts can sell to fund a rebalance.',
    );
  if (currentCash > reserve * accounts.length)
    warnings.push(
      'Cash remains after reserves because of whole shares, minimum trade sizes, or account-level funding constraints.',
    );
  if (driftAfter > 0.1)
    warnings.push(
      'Targets may remain out of reach under the selected constraints. The planner uses a bounded heuristic and does not guarantee a global optimum.',
    );
  if (trades.size === 0)
    warnings.push('No eligible trade improves allocation under the selected constraints.');
  return {
    status: 'ready',
    trades: [...trades.values()].sort(
      (a, b) =>
        a.accountId.localeCompare(b.accountId) ||
        (a.side === b.side ? a.symbol.localeCompare(b.symbol) : a.side === 'sell' ? -1 : 1),
    ),
    warnings,
    blockers: [],
    before,
    after: allocations(currentValues, options.targets, totalCents),
    cashBeforeCents,
    cashAfterCents: currentCash,
    driftBefore,
    driftAfter,
    totalCents,
  };
}
