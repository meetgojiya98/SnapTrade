'use client';

import {
  ArrowRight,
  Bookmark,
  Download,
  Eye,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { SavedPlan, SavedPlanSummary } from '@/lib/workspace';
import type { Plan } from '@/lib/types';
import { accountDisplayName } from '@/lib/account-label';
import { serializePlanCsv, type PlanExportMetadata } from '@/lib/plan-export';
import { Dialog } from './workspace-ui';
import CashProof from './cash-proof';

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
export const planDate = (value: string) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
export function downloadPlan(
  plan: Plan,
  currency: string,
  name: string,
  metadata: PlanExportMetadata,
) {
  const csv = serializePlanCsv(plan, currency, metadata);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${metadata.historical ? 'historical-' : ''}${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 60) || 'balance-plan'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SavedPlans({
  plans,
  mode,
  loading,
  error,
  onReload,
  busy,
  onInspect,
  onRemove,
  onBuild,
}: {
  plans: SavedPlanSummary[];
  mode: 'demo' | 'live';
  loading: boolean;
  error: string;
  onReload: () => void;
  busy: boolean;
  onInspect: (id: string) => void;
  onRemove: (plan: SavedPlanSummary) => void;
  onBuild: () => void;
}) {
  return (
    <section className="card saved-plans-card">
      <div className="section-heading">
        <div>
          <h2>
            Your planning history <span className="count-badge">{plans.length}</span>
          </h2>
          <p>
            {mode === 'demo'
              ? 'Sample snapshots saved in this browser. Your real workspace stays separate.'
              : 'Saved simulations preserve the data and preferences used at that moment.'}
          </p>
        </div>
        {mode === 'live' ? (
          <button
            className="button secondary small-button"
            disabled={busy || loading}
            onClick={onReload}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Reload history
          </button>
        ) : (
          <ShieldCheck size={21} className="muted-icon" />
        )}
      </div>
      {error && (
        <div className="banner warning-banner" role="alert">
          <ShieldCheck size={17} />
          <span>{error}</span>
          <button disabled={busy || loading} onClick={onReload}>
            Try again <RefreshCw size={13} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="empty-state" role="status">
          <LoaderCircle className="spin" size={25} />
          <p>Loading your saved plans…</p>
        </div>
      ) : error && plans.length === 0 ? (
        <div className="empty-state">
          <Bookmark size={30} />
          <h3>Saved history is unavailable.</h3>
          <p>
            Retry to retrieve your past snapshots. Your current planning workspace is still
            available.
          </p>
        </div>
      ) : plans.length === 0 ? (
        <div className="empty-state saved-empty">
          <Bookmark size={30} />
          <h3>Your first plan belongs here.</h3>
          <p>
            Set your targets, review the proposed moves, then save a named snapshot to revisit the
            reasoning later.
          </p>
          <button className="button primary" onClick={onBuild}>
            Build a plan <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="saved-plan-list">
          {plans.map((plan) => (
            <article className="saved-plan-row" key={plan.id}>
              <span className="saved-plan-icon">
                <Bookmark size={19} />
              </span>
              <div className="saved-plan-description">
                <h3>{plan.name}</h3>
                <p>
                  Saved {planDate(plan.createdAt)} · {plan.tradeCount} proposed{' '}
                  {plan.tradeCount === 1 ? 'move' : 'moves'}
                </p>
                <span className="historical-badge">
                  {mode === 'demo' ? 'Sample · historical' : 'Historical snapshot'} · no execution
                </span>
              </div>
              <div className="saved-plan-drift">
                <span>Allocation drift</span>
                <strong>
                  {plan.driftBefore.toFixed(1)} <ArrowRight size={13} />{' '}
                  {plan.driftAfter.toFixed(1)} <small>pp</small>
                </strong>
              </div>
              <div className="saved-plan-actions">
                <button
                  className="button secondary small-button"
                  disabled={busy}
                  onClick={() => onInspect(plan.id)}
                >
                  <Eye size={14} />
                  View snapshot
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={`Delete ${plan.name}`}
                  onClick={() => onRemove(plan)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="card-footnote">
        <ShieldCheck size={15} />
        Historical prices and account balances are kept as saved. Create a new plan for a current
        view.
      </div>
    </section>
  );
}

export function SavedPlanDetail({ plan, onClose }: { plan: SavedPlan; onClose: () => void }) {
  const accounts = plan.source.accounts.filter(
    (account) =>
      !plan.preferences.selectedAccountIds.length ||
      plan.preferences.selectedAccountIds.includes(account.id),
  );
  const accountNames = new Map(
    plan.source.accounts.map((account) => [account.id, accountDisplayName(account)]),
  );
  const currency = accounts[0]?.currency || 'USD';
  return (
    <Dialog title={plan.name} onClose={onClose}>
      <div className="historical-notice">
        <ShieldCheck size={18} />
        <div>
          <strong>
            {plan.source.mode === 'demo' ? 'Sample historical snapshot' : 'Historical snapshot'} ·
            read-only
          </strong>
          <p>
            This preserves a past simulation. It cannot place orders and does not reflect current
            prices or balances.
          </p>
        </div>
      </div>
      <dl className="snapshot-meta">
        <div>
          <dt>Saved</dt>
          <dd>{planDate(plan.createdAt)}</dd>
        </div>
        <div>
          <dt>Source snapshot</dt>
          <dd>{planDate(plan.asOf)}</dd>
        </div>
        <div>
          <dt>Planning base</dt>
          <dd>{money(plan.totalCents, currency)}</dd>
        </div>
        <div>
          <dt>Drift</dt>
          <dd>
            {plan.driftBefore.toFixed(1)} → {plan.driftAfter.toFixed(1)} pp
          </dd>
        </div>
      </dl>
      <div className="snapshot-policy">
        <h3>Preferences used</h3>
        <p>
          {plan.preferences.targets
            .map(
              (target) =>
                `${target.assetClass === 'us-equity' ? 'US equities' : target.assetClass === 'international' ? 'International' : 'Bonds'} ${target.percent}%`,
            )
            .join(' · ')}
        </p>
        <p>
          {money(plan.preferences.reserveCents, currency)} reserve per account ·{' '}
          {money(plan.preferences.minimumTradeCents, currency)} minimum trade · taxable sales{' '}
          {plan.preferences.allowTaxableSales ? 'allowed' : 'protected'}
        </p>
        <p>Hypothetical contribution: {money(plan.contributionCents, currency)}</p>
      </div>
      <div className="snapshot-moves">
        <h3>Proposed moves at the time</h3>
        {plan.result.trades.length ? (
          plan.result.trades.map((trade, index) => (
            <div key={`${trade.accountId}-${trade.symbol}-${index}`}>
              <span className={`trade-side ${trade.side}`}>{trade.side}</span>
              <strong>
                {trade.quantity} {trade.symbol}
              </strong>
              <span>{accountNames.get(trade.accountId) || trade.accountName}</span>
              <b>{money(trade.valueCents, currency)}</b>
            </div>
          ))
        ) : (
          <p>No proposed moves within the saved boundaries.</p>
        )}
      </div>
      <CashProof
        accounts={accounts}
        plan={plan.result}
        contributionCents={plan.contributionCents}
        contributionAccountId={plan.contributionAccountId}
        currency={currency}
      />
      {plan.result.warnings.length > 0 && (
        <div className="snapshot-warnings">
          {plan.result.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      <div className="snapshot-provenance">
        <h3>Source accounts</h3>
        {accounts.map((account) => (
          <p key={account.id}>
            {accountDisplayName(account)} ·{' '}
            {account.syncedAt ? planDate(account.syncedAt) : 'Freshness unavailable'}
          </p>
        ))}
      </div>
      <details className="snapshot-holdings">
        <summary>Original holdings and prices</summary>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Historical holdings, scroll horizontally to see all columns"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">ASSET</th>
                <th scope="col">ACCOUNT</th>
                <th scope="col" className="numeric">
                  SHARES
                </th>
                <th scope="col" className="numeric">
                  SNAPSHOT PRICE
                </th>
                <th scope="col" className="numeric">
                  VALUE
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.flatMap((account) =>
                account.positions
                  .filter((position) => !position.cashEquivalent)
                  .map((position) => (
                    <tr key={`${account.id}-${position.id}`}>
                      <td>
                        <strong>{position.symbol}</strong>
                        <small>{position.name}</small>
                      </td>
                      <td>{accountDisplayName(account)}</td>
                      <td className="numeric">
                        {position.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                      </td>
                      <td className="numeric">
                        {position.priceCents === null
                          ? 'Unavailable'
                          : money(position.priceCents, position.currency)}
                      </td>
                      <td className="numeric">
                        {position.priceCents === null
                          ? '—'
                          : money(
                              Math.round(position.priceCents * position.quantity),
                              position.currency,
                            )}
                      </td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
        <p>
          Values are preserved exactly as saved. Reported cash appears in the funding ledger above.
        </p>
      </details>
      <button
        className="button secondary full-width"
        onClick={() =>
          downloadPlan(plan.result, currency, plan.name, {
            historical: true,
            asOf: plan.asOf,
            demo: plan.source.mode === 'demo',
            savedPlan: plan,
          })
        }
      >
        <Download size={16} />
        Download historical CSV
      </button>
    </Dialog>
  );
}
