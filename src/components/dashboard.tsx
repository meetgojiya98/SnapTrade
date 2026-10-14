'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  Eye,
  GitCompareArrows,
  Landmark,
  LayoutGrid,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { makeDemoPortfolio } from '@/lib/demo';
import { applyClassifications } from '@/lib/classification';
import { csvCell, inputCents } from '@/lib/inputs';
import ClassificationEditor from './classification-editor';
import CashProof from './cash-proof';
import { accountValueCents, defaultTargets, generatePlan } from '@/lib/planner';
import type { Account, AssetClass, Portfolio, Target, Trade } from '@/lib/types';

type View = 'portfolio' | 'rebalance' | 'connections';
type Modal = 'connect' | 'targets' | 'method' | 'classify' | null;
type Status = { configured: boolean; connected: boolean; requirements: string[] };
const classes: Record<AssetClass, { name: string; short: string; color: string; tint: string }> = {
  'us-equity': { name: 'US equities', short: 'US', color: '#176c50', tint: '#eaf2ee' },
  international: {
    name: 'International equities',
    short: 'INTL',
    color: '#94b39b',
    tint: '#eff3ec',
  },
  bonds: { name: 'Bonds', short: 'BOND', color: '#d5b77b', tint: '#f6f0e4' },
  unclassified: { name: 'Unclassified', short: 'OTHER', color: '#989da3', tint: '#f0f1f3' },
};
const money = (cents: number, currency = 'USD', digits = 0) =>
  Number.isFinite(cents) && /^[A-Z]{3}$/.test(currency)
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(cents / 100)
    : '—';
const pct = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '—');
const hasPositionValue = (p: Account['positions'][number]) =>
  p.priceCents !== null &&
  Number.isSafeInteger(p.priceCents) &&
  p.priceCents > 0 &&
  Number.isFinite(p.quantity) &&
  p.quantity >= 0;
const positionValue = (p: Account['positions'][number]) =>
  p.cashEquivalent || !hasPositionValue(p) ? 0 : Math.round(p.quantity * p.priceCents!);
const needsValueReview = (a: Account) =>
  a.issues.length > 0 ||
  !Number.isSafeInteger(a.cashCents) ||
  a.positions.some((p) => !p.cashEquivalent && (!hasPositionValue(p) || p.currency !== a.currency));
const brokerInitial = (broker: string) =>
  broker.toLowerCase().includes('fidelity')
    ? 'F'
    : broker.toLowerCase().includes('interactive')
      ? 'ib'
      : broker.toLowerCase().includes('wealth')
        ? 'W'
        : broker.slice(0, 2).toUpperCase();

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact && (
        <span>
          balance<span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
function BrokerIcon({ broker, small = false }: { broker: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`broker-icon ${small ? 'small' : ''} ${brokerInitial(broker) === 'F' ? 'fidelity' : brokerInitial(broker) === 'ib' ? 'interactive' : 'wealthsimple'}`}
    >
      {brokerInitial(broker)}
    </span>
  );
}
function Dialog({
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
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
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

export default function Dashboard() {
  const [sourcePortfolio, setPortfolio] = useState<Portfolio>(() => makeDemoPortfolio());
  const [classifications, setClassifications] = useState<Record<string, AssetClass>>({});
  const [accountTypes, setAccountTypes] = useState<Record<string, Account['type']>>({});
  const portfolio = useMemo(
    () => applyClassifications(sourcePortfolio, classifications, accountTypes),
    [sourcePortfolio, classifications, accountTypes],
  );
  const canClassify =
    sourcePortfolio.mode === 'live' &&
    sourcePortfolio.accounts.some(
      (a) =>
        a.positions.some((p) => p.assetClass === 'unclassified') ||
        a.issues.includes(
          'The account tax treatment is unknown. Verify the account type before using a plan.',
        ),
    );
  const [view, setView] = useState<View>('portfolio');
  const [modal, setModal] = useState<Modal>(null);
  const [status, setStatus] = useState<Status>({
    configured: false,
    connected: false,
    requirements: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Target[]>(defaultTargets.map((t) => ({ ...t })));
  const [draftTargets, setDraftTargets] = useState<Target[]>(targets);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'value' | 'symbol'>('value');
  const [allowTaxableSales, setAllowTaxableSales] = useState(false);
  const [reserve, setReserve] = useState('250');
  const [contribution, setContribution] = useState('0');
  const [contributionAccount, setContributionAccount] = useState('');
  const [minimum, setMinimum] = useState('100');
  const [scenario, setScenario] = useState('normal');
  const [notice, setNotice] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [comparison, setComparison] = useState<'current' | 'planned'>('current');
  const [valuationTime, setValuationTime] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setValuationTime(Date.now());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  async function loadLive() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portfolio', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error || 'Your accounts could not be loaded. Please try again.');
      setPortfolio(body);
      setSelected([]);
      setContribution('0');
      setScenario('normal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your accounts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetch('/api/status', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((body: Status) => {
        if (!active) return;
        setStatus(body);
        if (body.connected) void loadLive();
      })
      .catch(() => {
        if (active) setError('Connection status is unavailable. The demo remains available.');
      });
    const params = new URLSearchParams(window.location.search);
    if (params.has('error')) {
      const code = params.get('error');
      setError(
        code === 'access_denied'
          ? 'You cancelled the connection. You can try again anytime.'
          : code === 'configuration'
            ? 'SnapTrade needs to be configured before connecting. Open Connections for setup.'
            : 'The sign-in could not be completed. Please reconnect and try again.',
      );
      window.history.replaceState({}, '', '/');
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const accounts = useMemo(
    () => portfolio.accounts.filter((a) => !selected.length || selected.includes(a.id)),
    [portfolio, selected],
  );
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const currency = currencies.length === 1 ? currencies[0] : 'USD';
  const mixed = currencies.length > 1;
  const valuesNeedReview = accounts.some(needsValueReview);
  const positionCurrencyMismatch = accounts.some((a) =>
    a.positions.some((p) => !p.cashEquivalent && p.currency !== a.currency),
  );
  const cannotCombineValues = mixed || positionCurrencyMismatch;
  const total = accounts.reduce((sum, a) => sum + accountValueCents(a), 0);
  const cash = accounts.reduce((sum, a) => sum + a.cashCents, 0);
  const selectedContributionAccount = accounts.some((a) => a.id === contributionAccount)
    ? contributionAccount
    : accounts[0]?.id || '';
  const options = {
    targets,
    allowTaxableSales,
    cashBufferCents: inputCents(reserve),
    contributionCents: inputCents(contribution),
    contributionAccountId: selectedContributionAccount || null,
    minimumTradeCents: inputCents(minimum),
  };
  const currentPlan = useMemo(
    () =>
      generatePlan(accounts, {
        targets,
        allowTaxableSales,
        cashBufferCents: inputCents(reserve),
        contributionCents: inputCents(contribution),
        contributionAccountId: selectedContributionAccount || null,
        minimumTradeCents: inputCents(minimum),
        now: new Date(valuationTime).toISOString(),
      }),
    [
      accounts,
      targets,
      allowTaxableSales,
      reserve,
      contribution,
      selectedContributionAccount,
      minimum,
      valuationTime,
    ],
  );
  const holdings = accounts
    .flatMap((a) =>
      a.positions
        .filter((p) => !p.cashEquivalent)
        .map((p) => ({ ...p, account: a, value: positionValue(p) })),
    )
    .filter((p) =>
      `${p.symbol} ${p.name} ${p.account.broker}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sort === 'symbol' ? a.symbol.localeCompare(b.symbol) : b.value - a.value));
  const distinct = new Set(
    accounts.flatMap((a) => a.positions.filter((p) => !p.cashEquivalent).map((p) => p.symbol)),
  ).size;
  const showingPlanned = comparison === 'planned' && currentPlan.status === 'ready';
  const chartAllocation = showingPlanned ? currentPlan.after : currentPlan.before;
  const protectedCash = options.cashBufferCents * accounts.length;
  const chartCash =
    (showingPlanned ? currentPlan.cashAfterCents : currentPlan.cashBeforeCents) - protectedCash;
  const chartCashPercent =
    currentPlan.totalCents > 0 ? (chartCash / currentPlan.totalCents) * 100 : 0;
  const usPercent =
    currentPlan.status === 'ready'
      ? currentPlan.before.find((a) => a.assetClass === 'us-equity')?.percent || 0
      : 0;
  const targetUs = targets.find((t) => t.assetClass === 'us-equity')?.percent || 0;
  const plannedBuys = currentPlan.trades
    .filter((t) => t.side === 'buy')
    .reduce((s, t) => s + t.valueCents, 0);
  const plannedSells = currentPlan.trades
    .filter((t) => t.side === 'sell')
    .reduce((s, t) => s + t.valueCents, 0);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
    setQuery('');
    setComparison('current');
  }
  function toggleAccount(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }
  function changeScenario(next: string) {
    const data = makeDemoPortfolio();
    if (next === 'stale')
      data.accounts[0].syncedAt = new Date(Date.now() - 48 * 3600000).toISOString();
    if (next === 'currency') {
      data.accounts[2].currency = 'CAD';
      data.accounts[2].positions.forEach((p) => {
        p.currency = 'CAD';
      });
    }
    if (next === 'missing') data.accounts[0].positions[0].priceCents = null;
    setScenario(next);
    setPortfolio(data);
    setSelected([]);
    setClassifications({});
    setAccountTypes({});
  }
  function exportPlan() {
    const freshPlan = generatePlan(accounts, { ...options, now: new Date().toISOString() });
    if (freshPlan.status === 'blocked') {
      setValuationTime(Date.now());
      setError(
        `This plan needs review before export. ${freshPlan.blockers[0] || 'Reload the latest account snapshots.'}`,
      );
      return;
    }
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
      ...[...freshPlan.trades]
        .sort((a, b) => (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1))
        .map((t) => [
          t.accountName,
          t.side,
          t.symbol,
          t.quantity,
          (t.priceCents / 100).toFixed(2),
          (t.valueCents / 100).toFixed(2),
          t.reason,
        ]),
    ];
    const csv = [
      '# Balance simulation — indicative prices; no orders placed. Fees, taxes, FX and settlement are not modeled.',
      ...rows.map((row) => row.map(csvCell).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'balance-rebalance-plan.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Your plan was exported. No orders were placed.');
  }
  async function disconnect() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not disconnect. Please try again.');
      setPortfolio(makeDemoPortfolio());
      setStatus((prev) => ({ ...prev, connected: false }));
      setSelected([]);
      setClassifications({});
      setAccountTypes({});
      if (body.revoked === false) {
        setError(
          body.warning ||
            'Local credentials were deleted, but revocation could not be confirmed. Remove Balance in your SnapTrade dashboard.',
        );
      } else {
        setNotice('Disconnected. You are back in the demo workspace.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setLoading(false);
    }
  }
  function freshness(account: Account) {
    if (!account.syncedAt) return 'Freshness unavailable';
    return Date.now() - new Date(account.syncedAt).getTime() > 24 * 3600000
      ? 'Data needs updating'
      : portfolio.mode === 'demo'
        ? 'Sample data'
        : 'Snapshot available';
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to portfolio
      </a>
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <a className="brand-link" href="/" aria-label="Balance home">
          <Brand />
        </a>
        <div className="workspace">
          <span className="workspace-avatar">{portfolio.mode === 'demo' ? 'A' : 'P'}</span>
          <div>
            <strong>{portfolio.mode === 'demo' ? 'Alex’s workspace' : 'My workspace'}</strong>
            <span>Personal portfolio</span>
          </div>
          <LockKeyhole size={13} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={view === 'portfolio' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('portfolio')}
            aria-current={view === 'portfolio' ? 'page' : undefined}
          >
            <LayoutGrid size={19} />
            Portfolio
            <span className="nav-active-dot" />
          </button>
          <button
            className={view === 'rebalance' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('rebalance')}
            aria-current={view === 'rebalance' ? 'page' : undefined}
          >
            <GitCompareArrows size={19} />
            Rebalance
            <span className="nav-active-dot" />
          </button>
          <button
            className={view === 'connections' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('connections')}
            aria-current={view === 'connections' ? 'page' : undefined}
          >
            <Link2 size={19} />
            Connections
            <span className="nav-count">
              {portfolio.mode === 'live' ? portfolio.accounts.length : 0}
            </span>
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-orbit">
            <Sparkles size={17} />
          </span>
          <h3>
            A little clarity.
            <br />A better balance.
          </h3>
          <p>
            Your whole portfolio.
            <br />
            One thoughtful plan.
          </p>
          <button onClick={() => setModal('method')}>
            How Balance works <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('method')}>
            <CircleHelp size={18} />
            Methodology & help
          </button>
          <div className="powered">
            <span className="snaptrade-mark">↗</span>
            <span>
              Powered by <strong>SnapTrade</strong>
            </span>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />{' '}
              <strong>
                {view === 'portfolio'
                  ? 'Portfolio'
                  : view === 'rebalance'
                    ? 'Rebalance'
                    : 'Connections'}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className={`mode-badge ${portfolio.mode === 'live' ? 'live' : ''}`}>
              <span />
              {portfolio.mode === 'demo' ? 'Demo workspace' : 'Connected workspace'}
            </span>
            <button
              className="help-button"
              aria-label="Open methodology"
              onClick={() => setModal('method')}
            >
              <CircleHelp size={18} />
            </button>
            <span
              className="profile-avatar"
              aria-label={portfolio.mode === 'demo' ? 'Alex demo profile' : 'Your profile'}
            >
              {portfolio.mode === 'demo' ? 'AC' : 'ME'}
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="banner error-banner" role="alert">
              <CircleHelp size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === 'portfolio'
                  ? 'THE BIG PICTURE'
                  : view === 'rebalance'
                    ? 'MAKE YOUR NEXT MOVE INTENTIONAL'
                    : 'YOUR ACCOUNTS, TOGETHER'}
              </div>
              <h1>
                {view === 'portfolio'
                  ? 'Your portfolio, in perspective.'
                  : view === 'rebalance'
                    ? 'Find your balance.'
                    : 'A more connected portfolio.'}
              </h1>
              <p>
                {view === 'portfolio'
                  ? 'See what you own. Understand the mix. Move forward with a plan.'
                  : view === 'rebalance'
                    ? 'Turn your target allocation into a practical plan, one account at a time.'
                    : 'Connect once through SnapTrade. Get a clearer view across brokerages.'}
              </p>
            </div>
            <button className="button secondary connect-button" onClick={() => setModal('connect')}>
              <Plus size={16} />
              Connect account
            </button>
          </div>

          {canClassify && (
            <div className="banner classification-banner">
              <ShieldCheck size={17} />
              <span>
                Some holdings or account types need your classification. Only you can confirm how
                they fit your plan.
              </span>
              <button onClick={() => setModal('classify')}>
                Review classifications <ArrowRight size={13} />
              </button>
            </div>
          )}
          {view !== 'connections' && (
            <>
              <div className="account-filter" aria-label="Filter accounts">
                <button
                  className={!selected.length ? 'filter-chip selected' : 'filter-chip'}
                  onClick={() => setSelected([])}
                >
                  <Landmark size={14} />
                  All accounts <span>{portfolio.accounts.length}</span>
                </button>
                {portfolio.accounts.map((a) => (
                  <button
                    key={a.id}
                    aria-pressed={selected.includes(a.id)}
                    className={selected.includes(a.id) ? 'filter-chip selected' : 'filter-chip'}
                    onClick={() => toggleAccount(a.id)}
                  >
                    <span
                      className={`broker-dot ${brokerInitial(a.broker) === 'ib' ? 'red' : brokerInitial(a.broker) === 'W' ? 'gold' : ''}`}
                    />
                    {a.broker}
                  </button>
                ))}
                <span className="filter-caption">
                  <LockKeyhole size={12} />
                  Read-only access
                </span>
              </div>
              {portfolio.mode === 'demo' && scenario !== 'normal' && (
                <div className="banner scenario-banner">
                  <Eye size={16} />
                  <span>
                    Edge case:{' '}
                    {scenario === 'stale'
                      ? 'one snapshot is 48 hours old'
                      : scenario === 'currency'
                        ? 'one account is denominated in CAD'
                        : 'one holding has no price'}
                    . Open Rebalance to inspect the guardrails.
                  </span>
                  <button onClick={() => changeScenario('normal')}>Reset demo</button>
                </div>
              )}
              {portfolio.warnings.length > 0 && (
                <div className="banner warning-banner" role="status">
                  <CircleHelp size={16} />
                  <span>{portfolio.warnings.join(' ')}</span>
                </div>
              )}
            </>
          )}

          {view === 'portfolio' && (
            <>
              <div className="overview-top">
                <section className="portfolio-hero" aria-label="Portfolio value">
                  <div className="hero-top">
                    <span className="hero-label">
                      {valuesNeedReview ? 'KNOWN VALUE · NEEDS REVIEW' : 'TOTAL PORTFOLIO VALUE'}
                    </span>
                    <span className="currency-badge">
                      {cannotCombineValues ? 'Multiple currencies' : currency}
                      <ChevronDown size={11} />
                    </span>
                  </div>
                  <div className="hero-value">
                    {cannotCombineValues ? 'Separate by currency' : money(total, currency, 2)}
                  </div>
                  <div className="hero-sub">
                    <span className="hero-line" />
                    {cannotCombineValues
                      ? 'Values in different currencies cannot be combined.'
                      : valuesNeedReview
                        ? 'Partial valuation: incomplete or unverified account data may be excluded.'
                        : `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} working toward one bigger picture.`}
                  </div>
                  <div className="hero-bottom">
                    <div>
                      <span>{valuesNeedReview ? 'Priced holdings' : 'Invested'}</span>
                      <strong>{cannotCombineValues ? '—' : money(total - cash, currency)}</strong>
                    </div>
                    <span className="hero-divider" />
                    <div>
                      <span>Reported cash</span>
                      <strong>{mixed || valuesNeedReview ? '—' : money(cash, currency)}</strong>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </section>
                <section className="metric-card">
                  <span className="metric-icon">
                    <GitCompareArrows size={20} />
                  </span>
                  <div className="metric-label">
                    Allocation drift
                    <button
                      aria-label="How allocation drift is calculated"
                      onClick={() => setModal('method')}
                    >
                      <CircleHelp size={13} />
                    </button>
                  </div>
                  <div className="metric-value">
                    {mixed || currentPlan.status === 'blocked' ? (
                      '—'
                    ) : (
                      <>
                        {currentPlan.driftBefore.toFixed(1)}
                        <span>pp</span>
                      </>
                    )}
                  </div>
                  <span className="metric-tag">
                    {currentPlan.status === 'blocked'
                      ? 'Review data first'
                      : currentPlan.driftBefore > 5
                        ? 'Room to rebalance'
                        : 'Close to your target'}
                  </span>
                  <p>Distance from your target mix</p>
                </section>
                <section className="metric-card">
                  <span className="metric-icon gold">
                    <LayersIcon />
                  </span>
                  <div className="metric-label">Portfolio holdings</div>
                  <div className="metric-value">
                    {distinct}
                    <span>assets</span>
                  </div>
                  <div className="asset-mini">
                    <span>US</span>
                    <span>INTL</span>
                    <span>BOND</span>
                  </div>
                  <p>
                    Across {accounts.length}{' '}
                    {accounts.length === 1 ? 'brokerage account' : 'brokerage accounts'}
                  </p>
                </section>
              </div>
              <div className="overview-middle">
                <section className="card allocation-card">
                  <div className="section-heading">
                    <div>
                      <h2>Your allocation</h2>
                      <p>A clearer picture of where your money lives.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setDraftTargets(targets.map((t) => ({ ...t })));
                        setModal('targets');
                      }}
                    >
                      Edit targets <SlidersHorizontal size={14} />
                    </button>
                  </div>
                  {cannotCombineValues ? (
                    <div className="empty-state">
                      <Landmark size={28} />
                      <h3>Keep currencies in their own lane.</h3>
                      <p>
                        Select accounts and holdings in one currency. Balance does not invent an
                        exchange rate.
                      </p>
                    </div>
                  ) : currentPlan.status === 'blocked' || valuesNeedReview || chartCash < 0 ? (
                    <div className="empty-state">
                      <ShieldCheck size={28} />
                      <h3>Complete inputs. Clearer allocation.</h3>
                      <p>
                        {currentPlan.blockers[0] ||
                          (chartCash < 0
                            ? 'The requested reserves exceed current cash. Review the required sales in Rebalance before comparing weights.'
                            : 'Resolve incomplete account values before comparing allocation percentages.')}
                      </p>
                      <button className="text-button" onClick={() => navigate('rebalance')}>
                        Review planning inputs <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="allocation-body">
                      <AllocationRing
                        allocations={chartAllocation}
                        cashPercent={chartCashPercent}
                        planned={showingPlanned}
                      />
                      <div className="allocation-legend">
                        <div className="segmented" aria-label="Allocation comparison">
                          <button
                            className={!showingPlanned ? 'selected' : ''}
                            onClick={() => setComparison('current')}
                          >
                            Before plan
                          </button>
                          <button
                            className={showingPlanned ? 'selected' : ''}
                            onClick={() => setComparison('planned')}
                          >
                            After plan
                          </button>
                        </div>
                        {chartAllocation
                          .filter((a) => a.valueCents > 0 || a.targetPercent > 0)
                          .map((a) => (
                            <div className="legend-row" key={a.assetClass}>
                              <span
                                className="color-dot"
                                style={{ background: classes[a.assetClass].color }}
                              />
                              <div>
                                <strong>{classes[a.assetClass].name}</strong>
                                <span>Target {a.targetPercent}%</span>
                              </div>
                              <b>{pct(a.percent)}</b>
                            </div>
                          ))}
                        <div className="legend-row cash-row">
                          <span className="color-dot" style={{ background: '#e7e8e1' }} />
                          <div>
                            <strong>Investable cash</strong>
                            <span>{money(protectedCash, currency, 2)} reserve excluded</span>
                          </div>
                          <b>{pct(chartCashPercent)}</b>
                        </div>
                      </div>
                    </div>
                  )}
                  {currentPlan.status === 'ready' && (
                    <p className="inline-note">
                      Both views use a {money(currentPlan.totalCents, currency, 2)} planning base
                      after reserves
                      {options.contributionCents > 0
                        ? `, including ${money(options.contributionCents, currency, 2)} hypothetical cash`
                        : ''}
                      .
                    </p>
                  )}
                  <div className="card-footnote">
                    <span className="status-dot" />
                    {portfolio.mode === 'demo'
                      ? 'Illustrative holdings · no market feed'
                      : 'Brokerage snapshots · prices may be delayed'}
                    <button onClick={() => setModal('method')}>
                      How we calculate <ArrowUpRight size={12} />
                    </button>
                  </div>
                </section>
                <section className="insight-card">
                  <span className="eyebrow">
                    <Sparkles size={14} />A MOMENT OF CLARITY
                  </span>
                  <h2>
                    {mixed ? (
                      'Different currencies.<br />Different plans.'
                    ) : usPercent > targetUs + 5 ? (
                      <>
                        A little heavy
                        <br />
                        on home turf.
                      </>
                    ) : (
                      <>
                        Your next move,
                        <br />
                        with perspective.
                      </>
                    )}
                  </h2>
                  <p>
                    {mixed ? (
                      'Review accounts in the same currency to create a plan with honest cash constraints.'
                    ) : usPercent > targetUs + 5 ? (
                      <>
                        US equities make up <strong>{pct(usPercent)}</strong> of your planning base.
                        Your target is {targetUs}%. A few considered moves can bring things closer.
                      </>
                    ) : (
                      'See how your existing cash and holdings can work together to get closer to your targets.'
                    )}
                  </p>
                  <div className="insight-rule">
                    <ShieldCheck size={17} />
                    <span>
                      Cash-aware. Whole shares.
                      <br />
                      You stay in control.
                    </span>
                  </div>
                  <button className="button primary" onClick={() => navigate('rebalance')}>
                    Build a rebalance plan <ArrowRight size={17} />
                  </button>
                  <span className="insight-caption">Simulate first. No orders placed.</span>
                </section>
              </div>
              <section className="card holdings-card">
                <div className="section-heading">
                  <div>
                    <h2>
                      Your holdings <span className="count-badge">{holdings.length}</span>
                    </h2>
                    <p>Every position, without the tab switching.</p>
                  </div>
                  <div className="table-tools">
                    <label className="search-box">
                      <Search size={15} />
                      <input
                        aria-label="Search holdings"
                        placeholder="Search holdings"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button aria-label="Clear search" onClick={() => setQuery('')}>
                          <X size={13} />
                        </button>
                      )}
                    </label>
                    <button
                      className="icon-button bordered"
                      aria-label={
                        sort === 'value' ? 'Sort holdings alphabetically' : 'Sort holdings by value'
                      }
                      onClick={() => setSort(sort === 'value' ? 'symbol' : 'value')}
                    >
                      <SlidersHorizontal size={16} />
                    </button>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">ASSET</th>
                        <th scope="col">ACCOUNT</th>
                        <th scope="col" className="numeric">
                          SHARES
                        </th>
                        <th scope="col" className="numeric">
                          PRICE
                        </th>
                        <th scope="col" className="numeric">
                          VALUE <ArrowDown size={10} />
                        </th>
                        <th scope="col" className="numeric">
                          WEIGHT
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((p) => (
                        <tr key={`${p.account.id}-${p.id}`}>
                          <td>
                            <div className="asset-cell">
                              <span
                                className={`asset-icon ${p.symbol === 'AAPL' ? 'apple' : ''}`}
                                style={{
                                  background: classes[p.assetClass].tint,
                                  color: classes[p.assetClass].color,
                                }}
                              >
                                {p.symbol === 'AAPL' ? (
                                  'a'
                                ) : p.symbol === 'MSFT' ? (
                                  'm'
                                ) : p.symbol === 'NVDA' ? (
                                  'n'
                                ) : (
                                  <span>{classes[p.assetClass].short.slice(0, 2)}</span>
                                )}
                              </span>
                              <div>
                                <strong>{p.symbol}</strong>
                                <span>{p.name}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="account-cell">
                              <span
                                className={`broker-dot ${brokerInitial(p.account.broker) === 'ib' ? 'red' : brokerInitial(p.account.broker) === 'W' ? 'gold' : ''}`}
                              />
                              <span>
                                {p.account.broker}
                                <small>{p.account.name}</small>
                              </span>
                            </div>
                          </td>
                          <td className="numeric">
                            {p.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                          </td>
                          <td className="numeric">
                            {!hasPositionValue(p) ? (
                              <span className="missing-price">Unavailable</span>
                            ) : (
                              money(p.priceCents!, p.currency, 2)
                            )}
                          </td>
                          <td className="numeric value-cell">
                            {!hasPositionValue(p) ? '—' : money(p.value, p.currency, 2)}
                          </td>
                          <td className="numeric">
                            <div className="weight-cell">
                              <span>
                                {cannotCombineValues ||
                                valuesNeedReview ||
                                total <= 0 ||
                                !hasPositionValue(p)
                                  ? '—'
                                  : pct((p.value / total) * 100)}
                              </span>
                              <i>
                                <b
                                  style={{
                                    width: `${Math.min(100, !cannotCombineValues && !valuesNeedReview && total > 0 ? (p.value / total) * 100 : 0)}%`,
                                    background: classes[p.assetClass].color,
                                  }}
                                />
                              </i>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {holdings.length === 0 && (
                  <div className="empty-state">
                    <Search size={24} />
                    <h3>No holdings found</h3>
                    <p>Try another symbol, fund name, or brokerage.</p>
                  </div>
                )}
                <div className="table-footer">
                  <span>Showing {holdings.length} positions · cash shown separately</span>
                  <span>
                    <LockKeyhole size={12} />
                    Your data stays yours
                  </span>
                </div>
              </section>
            </>
          )}

          {view === 'rebalance' && (
            <div className="rebalance-layout">
              <div className="rebalance-main">
                <section className="card target-card">
                  <div className="section-heading">
                    <div>
                      <span className="step-label">01 / SET YOUR DIRECTION</span>
                      <h2>The mix you’re working toward.</h2>
                      <p>Choose your targets. Balance will work within your account constraints.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setDraftTargets(targets.map((t) => ({ ...t })));
                        setModal('targets');
                      }}
                    >
                      Edit targets <SlidersHorizontal size={14} />
                    </button>
                  </div>
                  <div className="target-bar">
                    {targets.map((t) => (
                      <span
                        key={t.assetClass}
                        style={{ width: `${t.percent}%`, background: classes[t.assetClass].color }}
                      />
                    ))}
                  </div>
                  <div className="target-values">
                    {targets.map((t) => (
                      <div key={t.assetClass}>
                        <span
                          className="color-dot"
                          style={{ background: classes[t.assetClass].color }}
                        />
                        <span>{classes[t.assetClass].name}</span>
                        <strong>{t.percent}%</strong>
                      </div>
                    ))}
                  </div>
                  <p className="inline-note">
                    Targets apply to assets plus cash, less your protected cash reserve. Unspent
                    cash can leave the mix below 100%.
                  </p>
                </section>
                <section className="card constraints-card">
                  <div className="section-heading">
                    <div>
                      <span className="step-label">02 / MAKE IT PRACTICAL</span>
                      <h2>Your money. Your boundaries.</h2>
                    </div>
                    <ShieldCheck size={22} className="muted-icon" />
                  </div>
                  <div className="form-grid">
                    <label className="field-label">
                      Keep cash per account
                      <div className="money-input">
                        <span>{currency}</span>
                        <input
                          aria-label="Cash reserve per account"
                          type="number"
                          min="0"
                          max="100000000"
                          step="50"
                          value={reserve}
                          onChange={(e) => setReserve(e.target.value)}
                        />
                      </div>
                      <small>Protected from buying recommendations.</small>
                    </label>
                    <label className="field-label">
                      Minimum trade value
                      <div className="money-input">
                        <span>{currency}</span>
                        <input
                          aria-label="Minimum trade value"
                          type="number"
                          min="1"
                          max="10000000"
                          step="25"
                          value={minimum}
                          onChange={(e) => setMinimum(e.target.value)}
                        />
                      </div>
                      <small>Skip tiny, low-impact moves.</small>
                    </label>
                    <label className="field-label">
                      Hypothetical new cash
                      <div className="money-input">
                        <span>{currency}</span>
                        <input
                          aria-label="Hypothetical contribution"
                          type="number"
                          min="0"
                          max="100000000"
                          step="100"
                          value={contribution}
                          onChange={(e) => setContribution(e.target.value)}
                        />
                      </div>
                      <small>A simulation. No money is transferred.</small>
                    </label>
                    <label className="field-label">
                      Add new cash to
                      <select
                        aria-label="Contribution account"
                        value={selectedContributionAccount}
                        onChange={(e) => setContributionAccount(e.target.value)}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.broker} · {a.name}
                          </option>
                        ))}
                      </select>
                      <small>Cash stays inside the chosen account.</small>
                    </label>
                  </div>
                  <label className="toggle-row">
                    <div>
                      <strong>Allow sales in taxable accounts</strong>
                      <span>Sales may create taxable gains. Tax impact is not estimated.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowTaxableSales}
                      onChange={(e) => setAllowTaxableSales(e.target.checked)}
                    />
                    <span className="switch" aria-hidden="true" />
                  </label>
                  <div className="constraint-pills">
                    <span>
                      <Check size={13} />
                      Whole shares only
                    </span>
                    <span>
                      <Check size={13} />
                      No account transfers
                    </span>
                    <span>
                      <Check size={13} />
                      No borrowing
                    </span>
                  </div>
                </section>
                <CashProof
                  accounts={accounts}
                  plan={currentPlan}
                  contributionCents={options.contributionCents}
                  contributionAccountId={options.contributionAccountId}
                  currency={currency}
                />
                <section className="card plan-trades">
                  <div className="section-heading">
                    <div>
                      <span className="step-label">03 / REVIEW EVERY MOVE</span>
                      <h2>
                        {currentPlan.status === 'blocked'
                          ? 'Let’s resolve the data first.'
                          : 'A plan you can understand.'}
                      </h2>
                      <p>
                        {currentPlan.status === 'blocked'
                          ? 'Balance pauses recommendations when the inputs can’t support them.'
                          : `${currentPlan.trades.length} proposed moves. Indicative prices. No orders placed.`}
                      </p>
                    </div>
                    {currentPlan.status === 'ready' && currentPlan.trades.length > 0 && (
                      <button className="button secondary small-button" onClick={exportPlan}>
                        <Download size={14} />
                        Export CSV
                      </button>
                    )}
                  </div>
                  {currentPlan.status === 'blocked' ? (
                    <div className="blocker-list" role="status">
                      {currentPlan.blockers.map((b, i) => (
                        <div key={i}>
                          <ShieldCheck size={19} />
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  ) : currentPlan.trades.length === 0 ? (
                    <div className="empty-state">
                      <CheckCheck size={30} />
                      <h3>No practical moves within these boundaries.</h3>
                      <p>
                        You may already be close to target, or account cash and whole shares limit
                        further progress. Try a contribution or adjust your constraints.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="trade-sequence">
                        <span>1. Review sells</span>
                        <ChevronRight size={13} />
                        <span>2. Wait for settlement</span>
                        <ChevronRight size={13} />
                        <span>3. Review buys</span>
                      </div>
                      {[...currentPlan.trades]
                        .sort((a, b) => (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1))
                        .map((t, i) => (
                          <TradeRow
                            key={`${t.accountId}-${t.symbol}-${t.side}-${i}`}
                            trade={t}
                            currency={currency}
                          />
                        ))}
                    </>
                  )}
                </section>
              </div>
              <aside className="plan-sidebar">
                <section className="plan-summary">
                  <span className="eyebrow">THE POTENTIAL PICTURE</span>
                  <h2>
                    Closer to your
                    <br />
                    kind of balance.
                  </h2>
                  <div className="drift-comparison">
                    <div>
                      <span>Current drift</span>
                      <strong>
                        {currentPlan.status === 'blocked'
                          ? '—'
                          : `${currentPlan.driftBefore.toFixed(1)}`}
                        <small> pp</small>
                      </strong>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <span>After plan</span>
                      <strong>
                        {currentPlan.status === 'blocked'
                          ? '—'
                          : `${currentPlan.driftAfter.toFixed(1)}`}
                        <small> pp</small>
                      </strong>
                    </div>
                  </div>
                  {currentPlan.status === 'ready' &&
                    currentPlan.driftBefore > 0 &&
                    currentPlan.driftAfter < currentPlan.driftBefore && (
                      <div className="improvement">
                        <Check size={14} />
                        {((1 - currentPlan.driftAfter / currentPlan.driftBefore) * 100).toFixed(1)}%
                        less allocation drift
                      </div>
                    )}
                  {currentPlan.status === 'ready' &&
                    currentPlan.driftAfter > currentPlan.driftBefore && (
                      <p className="plan-warning">
                        Funding cash reserves increases drift by{' '}
                        {(currentPlan.driftAfter - currentPlan.driftBefore).toFixed(1)} pp.
                      </p>
                    )}
                  <dl className="plan-numbers">
                    <div>
                      <dt>Estimated sells</dt>
                      <dd>
                        {currentPlan.status === 'blocked' ? '—' : money(plannedSells, currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>Estimated buys</dt>
                      <dd>
                        {currentPlan.status === 'blocked' ? '—' : money(plannedBuys, currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>New cash (hypothetical)</dt>
                      <dd>
                        {cannotCombineValues ? '—' : money(options.contributionCents, currency, 2)}
                      </dd>
                    </div>
                    <div className="total">
                      <dt>Cash remaining</dt>
                      <dd>
                        {currentPlan.status === 'blocked'
                          ? '—'
                          : money(currentPlan.cashAfterCents, currency, 2)}
                      </dd>
                    </div>
                  </dl>
                  <p className="summary-note">
                    <LockKeyhole size={15} />
                    This is a simulation. You review and place any trades with your brokerage.
                  </p>
                </section>
                <section className="plan-caveats">
                  <div>
                    <CircleHelp size={16} />
                    <h3>The details matter.</h3>
                  </div>
                  <p>
                    Whole shares and account-level cash can prevent a perfect match. Prices may
                    change; fees, taxes, settlement time, and FX are not modeled.
                  </p>
                  {currentPlan.warnings.map((w, i) => (
                    <p key={i} className="plan-warning">
                      {w}
                    </p>
                  ))}
                  <button className="text-button" onClick={() => setModal('method')}>
                    Read the methodology <ArrowUpRight size={13} />
                  </button>
                </section>
              </aside>
            </div>
          )}

          {view === 'connections' && (
            <>
              <section className="connection-intro">
                <div className="connection-intro-icon">
                  <Link2 size={28} />
                </div>
                <div>
                  <span className="eyebrow">BUILT ON SNAPTRADE</span>
                  <h2>Your accounts. A single point of view.</h2>
                  <p>
                    Sign in with SnapTrade to share your connected brokerage accounts. Balance
                    requests read-only portfolio access.
                  </p>
                </div>
                <button className="button primary" onClick={() => setModal('connect')}>
                  Connect with SnapTrade <ArrowUpRight size={16} />
                </button>
              </section>
              <div className="section-heading standalone">
                <div>
                  <h2>
                    {portfolio.mode === 'demo'
                      ? 'Explore with sample accounts'
                      : 'Your connected accounts'}
                  </h2>
                  <p>
                    {portfolio.mode === 'demo'
                      ? 'These are illustrative accounts, ready for a test drive.'
                      : 'Balances and holdings are retrieved securely from SnapTrade.'}
                  </p>
                </div>
                {portfolio.mode === 'live' && (
                  <button className="button secondary" disabled={loading} onClick={loadLive}>
                    <RefreshCw size={15} className={loading ? 'spin' : ''} />
                    Reload snapshots
                  </button>
                )}
              </div>
              <div className="connection-grid">
                {portfolio.accounts.map((a) => (
                  <section className="card connection-card" key={a.id}>
                    <div className="connection-card-top">
                      <BrokerIcon broker={a.broker} />
                      <span className={`connection-tag ${a.issues.length ? 'issue' : ''}`}>
                        <span />
                        {a.issues.length
                          ? 'Needs review'
                          : portfolio.mode === 'demo'
                            ? 'Demo'
                            : 'Connected'}
                      </span>
                    </div>
                    <h3>{a.broker}</h3>
                    <p>
                      {a.name} <span>· {a.number}</span>
                    </p>
                    <strong className="connection-value">
                      {money(accountValueCents(a), a.currency, 2)}
                      <small>
                        {needsValueReview(a) ? `Known subtotal · ${a.currency}` : a.currency}
                      </small>
                    </strong>
                    <div className="connection-details">
                      <span>{a.type === 'retirement' ? 'Retirement' : 'Taxable'}</span>
                      <span>{a.positions.filter((p) => !p.cashEquivalent).length} holdings</span>
                    </div>
                    <div className="connection-freshness">
                      <span className="status-dot" />
                      {freshness(a)}
                    </div>
                    {a.issues.map((issue, i) => (
                      <p className="account-issue" key={i}>
                        {issue}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
              <div className="connection-bottom">
                <div>
                  <ShieldCheck size={20} />
                  <div>
                    <h3>Designed around your privacy.</h3>
                    <p>
                      Tokens are encrypted on the server. Balance never asks for your brokerage
                      password.
                    </p>
                  </div>
                </div>
                {status.connected && (
                  <button className="text-button danger" disabled={loading} onClick={disconnect}>
                    {loading ? 'Disconnecting…' : 'Disconnect SnapTrade'}
                  </button>
                )}
              </div>
              {!status.configured && (
                <section className="card setup-card">
                  <span className="step-label">READY TO MAKE IT YOURS?</span>
                  <h2>Connect real accounts in three steps.</h2>
                  <ol>
                    <li>
                      <span>1</span>
                      <div>
                        <strong>Create a Commercial workspace</strong>
                        <p>Register your OAuth app in the SnapTrade dashboard.</p>
                      </div>
                      <a
                        href="https://dashboard.snaptrade.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open SnapTrade dashboard"
                      >
                        <ArrowUpRight size={16} />
                      </a>
                    </li>
                    <li>
                      <span>2</span>
                      <div>
                        <strong>Configure your backend</strong>
                        <p>
                          Set the OAuth credentials, callback URL, encryption key, and production
                          database using the repository guide.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>Try the SnapTrade sandbox</strong>
                        <p>
                          Use a Personal workspace with a sandbox connection to verify sign-in and
                          real API responses.
                        </p>
                      </div>
                      <a
                        href="https://docs.snaptrade.com/docs/oauth-apps"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Read the SnapTrade OAuth guide"
                      >
                        <ArrowUpRight size={16} />
                      </a>
                    </li>
                  </ol>
                  <p className="inline-note">
                    OAuth is not configured on this instance. The sample workspace is fully
                    interactive.
                  </p>
                </section>
              )}
            </>
          )}

          <footer className="page-footer">
            <span>
              <Brand compact />A clear head for your whole portfolio.
            </span>
            <div>
              {portfolio.mode === 'demo' && (
                <label className="scenario-picker">
                  Demo scenario
                  <select
                    aria-label="Demo scenario"
                    value={scenario}
                    onChange={(e) => changeScenario(e.target.value)}
                  >
                    <option value="normal">Normal portfolio</option>
                    <option value="stale">Stale snapshot</option>
                    <option value="currency">Mixed currencies</option>
                    <option value="missing">Missing price</option>
                  </select>
                </label>
              )}
              <button onClick={() => setModal('method')}>
                Methodology <ArrowUpRight size={12} />
              </button>
            </div>
          </footer>
        </main>
      </div>
      {loading && (
        <div className="loading-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          Loading your brokerage snapshots…
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal === 'classify' && (
        <Dialog title="Make the assumptions yours." onClose={() => setModal(null)}>
          <ClassificationEditor
            portfolio={sourcePortfolio}
            initialClasses={classifications}
            initialTypes={accountTypes}
            onApply={(classes, types) => {
              setClassifications(classes);
              setAccountTypes(types);
              setModal(null);
              setNotice('Classifications updated. All other data checks still apply.');
            }}
          />
        </Dialog>
      )}
      {modal === 'connect' && (
        <Dialog title="Your whole portfolio starts here." onClose={() => setModal(null)}>
          <div className="connect-visual" aria-hidden="true">
            <span>
              <Landmark size={26} />
            </span>
            <i />
            <Brand compact />
            <i />
            <span>
              <ShieldCheck size={26} />
            </span>
          </div>
          <p className="dialog-lede">
            Connect through SnapTrade to bring your brokerage accounts into one thoughtful
            workspace.
          </p>
          <ul className="check-list">
            <li>
              <ShieldCheck size={18} />
              <div>
                <strong>Read-only by design</strong>
                <span>Holdings and cash, with no permission to trade.</span>
              </div>
            </li>
            <li>
              <LockKeyhole size={18} />
              <div>
                <strong>Your credentials stay private</strong>
                <span>You sign in with SnapTrade. Secrets stay on the server.</span>
              </div>
            </li>
            <li>
              <Link2 size={18} />
              <div>
                <strong>You’re always in control</strong>
                <span>Disconnect and revoke access whenever you choose.</span>
              </div>
            </li>
          </ul>
          {status.configured ? (
            <a className="button primary full-width" href="/api/auth/login">
              Continue with SnapTrade <ArrowUpRight size={17} />
            </a>
          ) : (
            <>
              <div className="configuration-note">
                <strong>Real accounts need a little setup.</strong>
                <p>
                  This instance is running in demo mode. Configure your SnapTrade OAuth app to
                  enable sign-in.
                </p>
              </div>
              <button
                className="button primary full-width"
                onClick={() => {
                  setModal(null);
                  navigate('connections');
                }}
              >
                View connection setup <ArrowRight size={17} />
              </button>
            </>
          )}
          <button className="dialog-secondary" onClick={() => setModal(null)}>
            Keep exploring the demo
          </button>
        </Dialog>
      )}
      {modal === 'targets' && (
        <Dialog title="Give your portfolio a direction." onClose={() => setModal(null)}>
          <p className="dialog-lede">
            These are your goals, not investment recommendations. Set a mix that adds up to 100%.
          </p>
          <div className="target-inputs">
            {draftTargets.map((t, i) => (
              <label key={t.assetClass}>
                <span className="color-dot" style={{ background: classes[t.assetClass].color }} />
                <span>{classes[t.assetClass].name}</span>
                <div>
                  <input
                    aria-label={`${classes[t.assetClass].name} target`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={t.percent}
                    onChange={(e) =>
                      setDraftTargets((prev) =>
                        prev.map((item, index) =>
                          index === i ? { ...item, percent: Number(e.target.value) } : item,
                        ),
                      )
                    }
                  />
                  <span>%</span>
                </div>
              </label>
            ))}
          </div>
          <div
            className={`target-total ${Math.abs(draftTargets.reduce((s, t) => s + t.percent, 0) - 100) > 0.0001 ? 'invalid' : ''}`}
          >
            <span>Total allocation</span>
            <strong>{draftTargets.reduce((s, t) => s + t.percent, 0)}%</strong>
          </div>
          <p className="inline-note">The protected cash reserve is kept outside your target mix.</p>
          <button
            className="button primary full-width"
            disabled={
              draftTargets.some(
                (t) => !Number.isFinite(t.percent) || t.percent < 0 || t.percent > 100,
              ) || Math.abs(draftTargets.reduce((s, t) => s + t.percent, 0) - 100) > 0.0001
            }
            onClick={() => {
              setTargets(draftTargets.map((t) => ({ ...t })));
              setModal(null);
              setNotice('Targets updated. Your plan has been recalculated.');
            }}
          >
            Save targets <Check size={17} />
          </button>
          <button
            className="dialog-secondary"
            onClick={() => setDraftTargets(defaultTargets.map((t) => ({ ...t })))}
          >
            Reset to illustrative 50 / 30 / 20 mix
          </button>
        </Dialog>
      )}
      {modal === 'method' && (
        <Dialog title="A plan with nothing to hide." onClose={() => setModal(null)}>
          <p className="dialog-lede">
            Balance makes portfolio drift easier to understand, then simulates practical moves
            within your boundaries.
          </p>
          <div className="method-sections">
            <section>
              <h3>One currency. Honest values.</h3>
              <p>
                Position value is shares × snapshot price. Cash-equivalent positions are excluded to
                avoid counting cash twice. Mixed currencies, missing prices, unsupported
                instruments, and snapshots over 24 hours old pause planning.
              </p>
            </section>
            <section>
              <h3>Targets and drift</h3>
              <p>
                The planning base is priced holdings + cash + hypothetical contributions − the cash
                reserve per account. Drift is half the sum of absolute differences between current
                and target class weights, plus the weight of unspent investable cash (whose target
                is zero), in percentage points. Unspent investable cash can leave weights below
                100%.
              </p>
            </section>
            <section>
              <h3>Practical, explainable moves</h3>
              <p>
                A deterministic heuristic sells eligible overweight assets and buys existing
                underweight assets in whole shares. It seeks to reduce drift while preserving cash
                per account. Restoring an underfunded cash reserve takes priority and can increase
                drift. It does not guarantee the mathematically optimal plan. Taxable sales require
                your opt-in.
              </p>
            </section>
            <section>
              <h3>Know the boundaries</h3>
              <p>
                Quotes are indicative, and proceeds may need to settle before buys. Fees, taxes,
                bid–ask spreads, FX, and brokerage restrictions are not estimated. This planning
                tool never submits an order and is not personalized financial advice.
              </p>
            </section>
            <section>
              <h3>Demo vs. connected data</h3>
              <p>
                Demo accounts are fictional fixtures. Connected accounts use SnapTrade snapshots.
                Reloading a snapshot does not force a brokerage sync. Unknown assets need your
                explicit classification. Unsupported instruments continue to block planning even
                after classification.
              </p>
            </section>
          </div>
          <a
            className="text-button"
            href="https://docs.snaptrade.com/docs/oauth-apps"
            target="_blank"
            rel="noreferrer"
          >
            Built with the SnapTrade OAuth API <ExternalLink size={14} />
          </a>
        </Dialog>
      )}
    </div>
  );
}

function LayersIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AllocationRing({
  allocations,
  cashPercent,
  planned,
}: {
  allocations: { assetClass: AssetClass; percent: number }[];
  cashPercent: number;
  planned: boolean;
}) {
  const circumference = 2 * Math.PI * 79;
  let offset = 0;
  const slices = allocations
    .filter((a) => a.percent > 0)
    .map((a) => {
      const length = (Math.max(0, Math.min(100, a.percent)) / 100) * circumference;
      const slice = { ...a, length, offset };
      offset += length;
      return slice;
    });
  const cashLength = Math.max(0, (Math.min(100, cashPercent) / 100) * circumference);
  return (
    <div className="allocation-ring">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={`${planned ? 'Planned' : 'Current'} asset allocation. Details listed alongside.`}
      >
        <circle cx="100" cy="100" r="79" stroke="#eeeFE8" strokeWidth="22" fill="none" />
        {slices.map((s) => (
          <circle
            key={s.assetClass}
            cx="100"
            cy="100"
            r="79"
            fill="none"
            stroke={classes[s.assetClass].color}
            strokeWidth="22"
            strokeDasharray={`${Math.max(0, s.length - 5)} ${circumference - Math.max(0, s.length - 5)}`}
            strokeDashoffset={-s.offset + circumference / 4}
          />
        ))}
        {cashLength > 0 && (
          <circle
            cx="100"
            cy="100"
            r="79"
            fill="none"
            stroke="#e3e5dc"
            strokeWidth="22"
            strokeDasharray={`${Math.max(0, cashLength - 5)} ${circumference - Math.max(0, cashLength - 5)}`}
            strokeDashoffset={-offset + circumference / 4}
          />
        )}
      </svg>
      <div className="ring-label">
        <span>{planned ? 'AFTER PLAN' : 'ASSET MIX'}</span>
        <strong>
          {allocations.filter((a) => a.percent > 0).length}
          <small>asset classes</small>
        </strong>
        <span className="ring-dot-line">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
function TradeRow({ trade, currency }: { trade: Trade; currency: string }) {
  return (
    <div className="trade-row">
      <span className={`trade-side ${trade.side}`}>
        {trade.side === 'buy' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
      </span>
      <div className="trade-detail">
        <strong>
          <span>{trade.side === 'buy' ? 'Buy' : 'Sell'}</span> {trade.quantity} {trade.symbol}
        </strong>
        <span>{trade.accountName}</span>
        <p>{trade.reason}</p>
      </div>
      <div className="trade-value">
        <strong>{money(trade.valueCents, currency, 2)}</strong>
        <span>@ {money(trade.priceCents, currency, 2)}</span>
      </div>
    </div>
  );
}
