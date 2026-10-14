'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, ExternalLink, Landmark, RefreshCw, ShieldCheck, X } from 'lucide-react';

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
          Read-only access. No orders or transfers. Your brokerage password stays with your
          brokerage.
        </span>
      </div>
      <a className="text-button" href="/demo">
        Explore the sample workspace <ArrowRight size={15} />
      </a>
    </section>
  );
}
