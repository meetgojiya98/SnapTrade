import { csvCell } from './inputs';
import { accountDisplayName } from './account-label';
import type { Plan } from './types';
import type { SavedPlan } from './workspace';

export interface PlanExportMetadata {
  historical: boolean;
  asOf: string;
  demo: boolean;
  savedPlan?: SavedPlan;
}

const classNames = {
  'us-equity': 'US equities',
  international: 'International equities',
  bonds: 'Bonds',
  unclassified: 'Unclassified',
};
const singleLine = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
const annotation = (label: string, value: string) => `# ${label},${csvCell(singleLine(value))}`;
const amount = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;

function historicalAnnotations(saved: SavedPlan, currency: string): string[] {
  const selected = saved.source.accounts.filter(
    (account) =>
      !saved.preferences.selectedAccountIds.length ||
      saved.preferences.selectedAccountIds.includes(account.id),
  );
  const destination = selected.find((account) => account.id === saved.contributionAccountId);
  const destinationName = destination ? accountDisplayName(destination) : 'None';
  return [
    annotation('Saved plan', saved.name),
    annotation('Saved at', saved.createdAt),
    annotation(
      'Target mix',
      saved.preferences.targets
        .map((target) => `${classNames[target.assetClass]} ${target.percent}%`)
        .join('; '),
    ),
    annotation(
      'Saved policy',
      `Reserve per account ${amount(saved.preferences.reserveCents, currency)}; minimum trade ${amount(saved.preferences.minimumTradeCents, currency)}; taxable sales ${saved.preferences.allowTaxableSales ? 'allowed' : 'protected'}`,
    ),
    annotation(
      'Hypothetical contribution',
      `${amount(saved.contributionCents, currency)}; destination ${destinationName}; no money transferred`,
    ),
    annotation(
      'Saved result',
      `Planning base ${amount(saved.result.totalCents, currency)}; allocation drift ${saved.result.driftBefore} pp to ${saved.result.driftAfter} pp; ${saved.result.trades.length} proposed moves`,
    ),
    annotation(
      'Funding equation',
      'Cash after = reported cash + hypothetical contribution + estimated sells - estimated buys. Cash stays in each account and includes the protected reserve.',
    ),
    ...selected.map((account) => {
      const contribution = account.id === saved.contributionAccountId ? saved.contributionCents : 0;
      const sells = saved.result.trades
        .filter((trade) => trade.accountId === account.id && trade.side === 'sell')
        .reduce((sum, trade) => sum + trade.valueCents, 0);
      const buys = saved.result.trades
        .filter((trade) => trade.accountId === account.id && trade.side === 'buy')
        .reduce((sum, trade) => sum + trade.valueCents, 0);
      return annotation(
        'Account funding',
        `${accountDisplayName(account)}; reported cash ${amount(account.cashCents, account.currency)}; new cash ${amount(contribution, account.currency)}; sells ${amount(sells, account.currency)}; buys ${amount(buys, account.currency)}; cash after ${amount(account.cashCents + contribution + sells - buys, account.currency)}; protected reserve ${amount(saved.preferences.reserveCents, account.currency)}; brokerage snapshot ${account.syncedAt || 'unavailable'}`,
      );
    }),
  ];
}

/** Historical annotations are CSV-safe comments; the seven trade columns stay unchanged. */
export function serializePlanCsv(
  plan: Plan,
  currency: string,
  metadata: PlanExportMetadata,
): string {
  const saved = metadata.historical ? metadata.savedPlan : undefined;
  const result = saved?.result || plan;
  const sourceAccounts = new Map(
    saved?.source.accounts.map((account) => [account.id, accountDisplayName(account)]) || [],
  );
  const asOf = singleLine(saved?.asOf || metadata.asOf).replace(/,/g, ' ');
  const demo = saved ? saved.source.mode === 'demo' : metadata.demo;
  const rows = [
    [
      'Account',
      'Side',
      'Symbol',
      'Shares',
      `Estimated price (${currency})`,
      `Estimated value (${currency})`,
      'Reason',
    ],
    ...[...result.trades]
      .sort((a, b) => (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1))
      .map((trade) => [
        sourceAccounts.get(trade.accountId) || trade.accountName,
        trade.side,
        trade.symbol,
        trade.quantity,
        (trade.priceCents / 100).toFixed(2),
        (trade.valueCents / 100).toFixed(2),
        trade.reason,
      ]),
  ];
  return [
    `# Balance ${demo ? 'SAMPLE ' : ''}${metadata.historical ? 'HISTORICAL snapshot' : 'simulation'}. Read-only; never executable. No orders placed.`,
    `# Snapshot as of ${asOf}. Indicative prices; fees, taxes, FX and settlement are not modeled.`,
    ...(saved ? historicalAnnotations(saved, currency) : []),
    ...rows.map((row) =>
      row
        .map((value) =>
          csvCell(metadata.historical && typeof value === 'string' ? singleLine(value) : value),
        )
        .join(','),
    ),
  ].join('\r\n');
}
