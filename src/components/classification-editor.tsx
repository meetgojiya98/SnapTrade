'use client';

import { useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import type { Account, AssetClass, Portfolio } from '@/lib/types';

export default function ClassificationEditor({
  portfolio,
  initialClasses,
  initialTypes,
  onApply,
}: {
  portfolio: Portfolio;
  initialClasses: Record<string, AssetClass>;
  initialTypes: Record<string, Account['type']>;
  onApply: (classes: Record<string, AssetClass>, types: Record<string, Account['type']>) => void;
}) {
  const [classes, setClasses] = useState(initialClasses);
  const [types, setTypes] = useState(initialTypes);
  const [confirmed, setConfirmed] = useState(false);
  const unknown = portfolio.accounts.flatMap((account) =>
    account.positions
      .filter((p) => p.assetClass === 'unclassified')
      .map((position) => ({ account, position })),
  );
  const unknownTypes = portfolio.accounts.filter((a) =>
    a.issues.includes(
      'The account tax treatment is unknown. Verify the account type before using a plan.',
    ),
  );
  return (
    <>
      <p className="dialog-lede">
        Brokerage symbols don’t always tell the whole story. Confirm these classifications using the
        fund’s factsheet or your account details.
      </p>
      <div className="classification-fields">
        {unknown.map(({ account, position }) => {
          const key = `${account.id}:${position.id}`;
          return (
            <label key={key}>
              <span>
                <strong>{position.symbol}</strong>
                <small>
                  {position.name} · {account.broker}
                </small>
              </span>
              <select
                aria-label={`${position.symbol} classification in ${account.name}`}
                value={classes[key] || ''}
                onChange={(e) =>
                  setClasses((prev) => ({ ...prev, [key]: e.target.value as AssetClass }))
                }
              >
                <option value="">Unverified</option>
                <option value="us-equity">US equities</option>
                <option value="international">International equities</option>
                <option value="bonds">Bonds</option>
              </select>
            </label>
          );
        })}
        {unknownTypes.map((account) => (
          <label key={account.id}>
            <span>
              <strong>{account.broker}</strong>
              <small>{account.name} · account tax treatment</small>
            </span>
            <select
              aria-label={`Tax treatment for ${account.name}`}
              value={types[account.id] || ''}
              onChange={(e) =>
                setTypes((prev) => ({ ...prev, [account.id]: e.target.value as Account['type'] }))
              }
            >
              <option value="">Unverified</option>
              <option value="taxable">Taxable account</option>
              <option value="retirement">Retirement account</option>
            </select>
          </label>
        ))}
      </div>
      <p className="classification-note">
        <ShieldCheck size={16} />
        Classification cannot override stale prices, currency mismatches, unavailable cash, or
        unsupported instruments.
      </p>
      <label className="classification-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          I checked these choices against the underlying assets and account details. An incorrect
          classification can create an unsuitable plan.
        </span>
      </label>
      <button
        className="button primary full-width"
        disabled={!confirmed}
        onClick={() => onApply(classes, types)}
      >
        Use my classifications <Check size={16} />
      </button>
      <p className="inline-note">
        Save workspace preferences after applying these choices to keep them. Leave an asset
        unverified if it does not fit these categories; you can still inspect it in your portfolio.
      </p>
    </>
  );
}
