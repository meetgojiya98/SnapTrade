import type { AssetClass, Portfolio } from './types';

const supported = new Set<AssetClass>(['us-equity', 'international', 'bonds']);
const unknownTaxTreatment =
  'The account tax treatment is unknown. Verify the account type before using a plan.';
const classificationIssue = (symbol: string) =>
  `${symbol}: asset class is unverified. This holding cannot be included in a plan.`;

/** Apply explicit user confirmations to a fresh copy; unrelated safety issues always survive. */
export function applyClassifications(
  portfolio: Portfolio,
  overrides: Record<string, AssetClass>,
  accountTypes: Record<string, 'taxable' | 'retirement'>,
): Portfolio {
  return {
    ...portfolio,
    warnings: [...portfolio.warnings],
    accounts: portfolio.accounts.map((account) => {
      const confirmedSymbols = new Set<string>();
      const positions = account.positions.map((position) => {
        const key = `${account.id}:${position.id}`;
        const requested = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
        if (position.assetClass === 'unclassified' && requested && supported.has(requested)) {
          confirmedSymbols.add(position.symbol);
          return { ...position, assetClass: requested };
        }
        return { ...position };
      });
      // Identical display symbols can refer to separate instruments. A confirmation for one
      // must not clear the shared issue if another instrument is still unclassified.
      for (const position of positions) {
        if (position.assetClass === 'unclassified') confirmedSymbols.delete(position.symbol);
      }
      const resolved = new Set([...confirmedSymbols].map(classificationIssue));
      const requestedType = Object.hasOwn(accountTypes, account.id)
        ? accountTypes[account.id]
        : undefined;
      const confirmedType =
        account.issues.includes(unknownTaxTreatment) &&
        (requestedType === 'taxable' || requestedType === 'retirement');
      return {
        ...account,
        type: confirmedType ? requestedType : account.type,
        positions,
        issues: account.issues.filter(
          (issue) => !resolved.has(issue) && !(confirmedType && issue === unknownTaxTreatment),
        ),
      };
    }),
  };
}
