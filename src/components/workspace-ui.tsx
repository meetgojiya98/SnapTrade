'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, ExternalLink, Landmark, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Account } from '@/lib/types';
import { accountDisplayName } from '@/lib/account-label';

export function WorkspaceHelpLinks({ section = 'connect' }: { section?: string }) {
  return (
    <div className="workspace-help-links">
      <a
        href={`/guide#${section}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Open the getting started guide in a new tab"
      >
        Getting started guide <ExternalLink size={13} aria-hidden="true" />
      </a>
      <a
        href="/support"
        target="_blank"
        rel="noreferrer"
        aria-label="Open help and support in a new tab"
      >
        Help & support <ExternalLink size={13} aria-hidden="true" />
      </a>
    </div>
  );
}

export function ConnectionChecklist() {
  return (
    <div className="connection-checklist">
      <ol aria-label="Before you connect">
        <li>
          <span>1</span>
          <div>
            <strong>Start in SnapTrade Personal</strong>
            <p>
              <a
                href="https://dashboard.snaptrade.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Open SnapTrade Personal in a new tab"
              >
                Create or open your Personal workspace <ExternalLink size={12} aria-hidden="true" />
              </a>
              . Connect your brokerages there and let their first sync complete.
            </p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>Authorize this beta</strong>
            <p>
              Return here and continue with SnapTrade. The consent screen currently shows{' '}
              <b>“CIBC”</b>, this project’s SnapTrade workspace name. Balance is an independent
              beta.
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>Choose your own planning policy</strong>
            <p>
              Review your holdings, target mix, and account cash reserve. This preview supports USD
              stocks and ETFs and never submits trades.
            </p>
          </div>
        </li>
      </ol>
      <p className="connected-beta-note">
        <strong>Connected beta:</strong> up to 5 connected users while SnapTrade approval is
        pending. If access is unavailable, explore the sample workspace or contact support.
      </p>
    </div>
  );
}

function accountReview(account: Account, now: number) {
  const unsupported =
    account.currency !== 'USD' ||
    account.cashCents < 0 ||
    account.positions.some(
      (position) =>
        !position.cashEquivalent &&
        (position.quantity < 0 || position.currency !== account.currency),
    ) ||
    account.issues.some((issue) =>
      /unsupported|short positions|negative cash|margin borrowing|currency conversion/i.test(issue),
    );
  const manual = (issue: string) =>
    /asset class is unverified|account tax treatment is unknown/i.test(issue);
  const classification =
    !unsupported &&
    (account.positions.some(
      (position) => !position.cashEquivalent && position.assetClass === 'unclassified',
    ) ||
      account.issues.some((issue) => /account tax treatment is unknown/i.test(issue)));
  const synced = account.syncedAt ? Date.parse(account.syncedAt) : NaN;
  const data =
    !unsupported &&
    (!Number.isFinite(synced) ||
      now - synced > 24 * 3600_000 ||
      synced - now > 5 * 60_000 ||
      account.issues.some((issue) => !manual(issue)) ||
      account.positions.some(
        (position) =>
          !position.cashEquivalent &&
          (position.priceCents === null ||
            !Number.isSafeInteger(position.priceCents) ||
            position.priceCents <= 0),
      ));
  return { unsupported, classification, data };
}

export function AccountRecovery({
  account,
  now,
  mode,
  loading,
  canUseOthers,
  onClassify,
  onReload,
  onUseOthers,
}: {
  account: Account;
  now: number;
  mode: 'demo' | 'live';
  loading: boolean;
  canUseOthers: boolean;
  onClassify: () => void;
  onReload: () => void;
  onUseOthers: () => void;
}) {
  const review = accountReview(account, now);
  if (!review.unsupported && !review.classification && !review.data) return null;
  return (
    <div className="account-recovery">
      <strong>
        {review.unsupported
          ? 'Outside this planner’s current scope'
          : review.data
            ? 'Update the source data'
            : 'Your confirmation is needed'}
      </strong>
      <p>
        {review.unsupported
          ? 'Planning supports USD stocks and ETFs without short positions or borrowing. A classification cannot remove these limits.'
          : review.data
            ? mode === 'live'
              ? 'Check this account’s connection and sync in SnapTrade Personal, then reload here. Balance may reuse a snapshot for up to 45 seconds; reloading does not force a brokerage sync.'
              : 'This sample has incomplete or stale data. Try another account or reset the demo scenario.'
            : 'Confirm unknown asset classes and account tax treatment before using this account in a plan.'}
      </p>
      {(review.unsupported || (review.data && mode === 'demo')) && canUseOthers && (
        <button className="text-button" onClick={onUseOthers}>
          Plan with other accounts <ArrowRight size={13} />
        </button>
      )}
      {review.classification && (
        <button className="text-button" onClick={onClassify}>
          Review classifications <ArrowRight size={13} />
        </button>
      )}
      {review.data && mode === 'live' && (
        <button className="text-button" disabled={loading} onClick={onReload}>
          Reload account snapshot <RefreshCw size={13} />
        </button>
      )}
      {review.unsupported && !canUseOthers && (
        <a
          className="text-button"
          href="/guide#review"
          target="_blank"
          rel="noreferrer"
          aria-label="Review supported planning inputs in a new tab"
        >
          Review supported planning inputs <ExternalLink size={13} aria-hidden="true" />
        </a>
      )}
      {review.data && mode === 'live' && (
        <a
          className="text-button"
          href="https://dashboard.snaptrade.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Check this account in SnapTrade Personal in a new tab"
        >
          Check in SnapTrade Personal <ExternalLink size={13} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

export function PlanningRecovery({
  accounts,
  now,
  mode,
  policyNeedsReview,
  onClassify,
  onReviewAccounts,
  onReviewSettings,
}: {
  accounts: Account[];
  now: number;
  mode: 'demo' | 'live';
  policyNeedsReview: boolean;
  onClassify: () => void;
  onReviewAccounts: () => void;
  onReviewSettings: () => void;
}) {
  const reviews = accounts.map((account) => ({ account, ...accountReview(account, now) }));
  const pending = reviews.filter((review) => review.classification);
  const source = reviews.filter((review) => review.data);
  const unsupported = reviews.filter((review) => review.unsupported);
  const names = (items: typeof reviews) =>
    items.map(({ account }) => accountDisplayName(account)).join('; ');
  return (
    <section className="planning-recovery" aria-label="How to get your plan ready">
      <h3>Your next steps</h3>
      <div className="recovery-grid">
        {pending.length > 0 && (
          <article>
            <ShieldCheck size={20} />
            <h4>Confirm the unknowns</h4>
            <p>
              Verify asset classes or tax treatment for {names(pending)}. Confirmations apply only
              to unknown source data.
            </p>
            <button className="text-button" onClick={onClassify}>
              Review classifications <ArrowRight size={13} />
            </button>
          </article>
        )}
        {source.length > 0 && (
          <article>
            <RefreshCw size={20} />
            <h4>Refresh the account data</h4>
            <p>
              {mode === 'live'
                ? `Check the connection and sync for ${names(source)} in SnapTrade Personal, then reload its latest snapshot here.`
                : 'This sample intentionally has missing or stale data. Reset the demo scenario or choose another account.'}
            </p>
            <button className="text-button" onClick={onReviewAccounts}>
              Review account data <ArrowRight size={13} />
            </button>
          </article>
        )}
        {unsupported.length > 0 && (
          <article>
            <Landmark size={20} />
            <h4>Choose supported accounts</h4>
            <p>
              {names(unsupported)} falls outside this preview’s USD stock and ETF scope, or contains
              borrowing or short positions. Keep it visible and plan with your other accounts.
            </p>
            <button className="text-button" onClick={onReviewAccounts}>
              Review selected accounts <ArrowRight size={13} />
            </button>
          </article>
        )}
        {policyNeedsReview && (
          <article>
            <ShieldCheck size={20} />
            <h4>Review your planning settings</h4>
            <p>
              Check the target mix, cash reserve in each account, minimum trade, and contribution
              account. Save your reviewed workspace preferences.
            </p>
            <button className="text-button" onClick={onReviewSettings}>
              Review planning settings <ArrowRight size={13} />
            </button>
          </article>
        )}
      </div>
      <WorkspaceHelpLinks section="troubleshooting" />
    </section>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function WorkspaceLoading() {
  return (
    <section
      className="workspace-loading"
      role="status"
      aria-label="Loading workspace"
      data-testid="workspace-loading"
    >
      <div className="loading-heading">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="loading-grid">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="skeleton loading-table" />
      <p>Opening your private workspace…</p>
    </section>
  );
}

export function WorkspaceGate({
  state,
  error,
  configured,
  onRetry,
}: {
  state: 'signed-out' | 'error' | 'empty';
  error: string;
  configured: boolean;
  onRetry: () => void;
}) {
  const empty = state === 'empty';
  const failed = state === 'error';
  return (
    <section className="workspace-gate card">
      <span className="gate-icon">{failed ? <RefreshCw size={28} /> : <Landmark size={28} />}</span>
      <span className="eyebrow">
        {failed ? 'LET’S GET YOU BACK ON TRACK' : 'YOUR PRIVATE WORKSPACE'}
      </span>
      <h1>
        {failed
          ? 'Your portfolio couldn’t be loaded.'
          : empty
            ? 'Add your first brokerage account.'
            : 'Bring your accounts into focus.'}
      </h1>
      <p>
        {failed
          ? error || 'The brokerage service did not respond. Try loading your accounts again.'
          : empty
            ? 'Your SnapTrade account is connected. Add a brokerage in your Personal dashboard, then return here to load your holdings.'
            : 'Sign in with SnapTrade to see your holdings, set your own target mix, and save a cash-aware rebalance simulation.'}
      </p>
      {!failed && !empty && <ConnectionChecklist />}
      {failed ? (
        <button className="button primary" onClick={onRetry}>
          <RefreshCw size={16} />
          Try again
        </button>
      ) : empty ? (
        <div className="gate-actions">
          <a
            className="button primary"
            href="https://dashboard.snaptrade.com"
            target="_blank"
            rel="noreferrer"
          >
            Open SnapTrade dashboard <ExternalLink size={16} />
          </a>
          <button className="button secondary" onClick={onRetry}>
            <RefreshCw size={16} />I connected an account, reload
          </button>
          <p className="gate-sync-note">
            Your brokerage’s first sync can take time. Balance may reuse its latest snapshot for up
            to 45 seconds; wait briefly before reloading again.
          </p>
        </div>
      ) : configured ? (
        <a className="button primary" href="/api/auth/login">
          Continue with SnapTrade <ArrowRight size={16} />
        </a>
      ) : (
        <div className="gate-service-note">
          <strong>Connections are temporarily unavailable.</strong>
          <p>
            This workspace cannot accept sign-ins yet. You can explore the complete planning flow
            with sample data.
          </p>
          <button className="text-button" onClick={onRetry}>
            Check availability <RefreshCw size={14} />
          </button>
        </div>
      )}
      <div className="gate-security">
        <ShieldCheck size={17} />
        <span>
          Read-only access. No orders or transfers. Balance never receives your brokerage password.
        </span>
      </div>
      <a className="text-button" href="/demo">
        Explore the sample workspace <ArrowRight size={15} />
      </a>
      <WorkspaceHelpLinks section={failed ? 'troubleshooting' : 'connect'} />
    </section>
  );
}
