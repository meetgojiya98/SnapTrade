'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Bookmark,
  Save,
  Trash2,
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
import { applyClassifications } from '@/lib/classification';
import { accountDisplayName } from '@/lib/account-label';
import { inputCents } from '@/lib/inputs';
import { defaultWorkspacePreferences, summarizePlan } from '@/lib/workspace';
import type { SavedPlan, SavedPlanSummary, Workspace, WorkspacePreferences } from '@/lib/workspace';
import { parsePreferences } from '@/lib/workspace-validation';
import {
  samplePortfolio,
  demoTime,
  readDemoWorkspace,
  writeDemoWorkspace,
  demoStorageKey,
} from './demo-workspace';
import {
  AccountRecovery,
  ConnectionChecklist,
  Dialog,
  PlanningRecovery,
  WorkspaceGate,
  WorkspaceHelpLinks,
  WorkspaceLoading,
} from './workspace-ui';
import { SavedPlans, SavedPlanDetail, downloadPlan } from './saved-plans';
import ClassificationEditor from './classification-editor';
import CashProof from './cash-proof';
import { accountValueCents, defaultTargets, generatePlan } from '@/lib/planner';
import type { Account, AssetClass, Portfolio, Target, Trade } from '@/lib/types';

type View = 'portfolio' | 'rebalance' | 'connections' | 'plans';
type Modal =
  'connect' | 'targets' | 'method' | 'classify' | 'save' | 'delete-plan' | 'delete-data' | null;
type Status = { configured: boolean; connected: boolean; requirements: string[] };
const classes: Record<AssetClass, { name: string; short: string; color: string; tint: string }> = {
  'us-equity': { name: 'US equities', short: 'US', color: '#214c38', tint: '#eaf1e6' },
  international: {
    name: 'International equities',
    short: 'INTL',
    color: '#9fc97d',
    tint: '#eff5e8',
  },
  bonds: { name: 'Bonds', short: 'BOND', color: '#c4d6ae', tint: '#f0f4eb' },
  unclassified: { name: 'Unclassified', short: 'OTHER', color: '#89958b', tint: '#f0f2ef' },
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
class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = '',
  ) {
    super(message);
  }
}
async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const parsed: unknown = await response.json().catch(() => null);
  const body =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (!response.ok) {
    const requestId =
      typeof body.requestId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
        ? body.requestId
        : '';
    throw new WorkspaceRequestError(
      `${typeof body.error === 'string' ? body.error : 'The request could not be completed. Please try again.'}${requestId ? ` Reference: ${requestId}` : ''}`,
      response.status,
      typeof body.code === 'string' ? body.code : '',
    );
  }
  return parsed as T;
}
const blankPortfolio = (): Portfolio => ({ mode: 'live', asOf: '', accounts: [], warnings: [] });

export default function Dashboard({ mode }: { mode: 'demo' | 'live' }) {
  const [sourcePortfolio, setPortfolio] = useState<Portfolio>(() =>
    mode === 'demo' ? samplePortfolio() : blankPortfolio(),
  );
  const [classifications, setClassifications] = useState<Record<string, AssetClass>>({});
  const [accountTypes, setAccountTypes] = useState<Record<string, Account['type']>>({});
  const portfolio = useMemo(
    () => applyClassifications(sourcePortfolio, classifications, accountTypes),
    [sourcePortfolio, classifications, accountTypes],
  );
  const canClassify = sourcePortfolio.accounts.some(
    (account) =>
      account.positions.some((position) => position.assetClass === 'unclassified') ||
      account.issues.includes(
        'The account tax treatment is unknown. Verify the account type before using a plan.',
      ),
  );
  const hasUnverified = portfolio.accounts.some(
    (account) =>
      account.positions.some((position) => position.assetClass === 'unclassified') ||
      account.issues.includes(
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
  const [gate, setGate] = useState<'loading' | 'signed-out' | 'error' | 'ready'>(
    mode === 'demo' ? 'ready' : 'loading',
  );
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Target[]>(defaultTargets.map((target) => ({ ...target })));
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
  const [valuationTime, setValuationTime] = useState(() =>
    mode === 'demo' ? Date.parse(demoTime) : Date.now(),
  );
  const [onboarded, setOnboarded] = useState(false);
  const [reviewed, setReviewed] = useState({
    targets: false,
    reserve: false,
    classifications: false,
  });
  const [savedPreferences, setSavedPreferences] = useState(
    JSON.stringify(defaultWorkspacePreferences),
  );
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [plans, setPlans] = useState<SavedPlanSummary[]>([]);
  const [demoPlans, setDemoPlans] = useState<SavedPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [planName, setPlanName] = useState('');
  const [inspectedPlan, setInspectedPlan] = useState<SavedPlan | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedPlanSummary | null>(null);
  const [undoPlan, setUndoPlan] = useState<SavedPlan | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const privateEpoch = useRef(0);

  const preferences = useMemo<WorkspacePreferences>(
    () => ({
      targets,
      reserveCents: inputCents(reserve),
      minimumTradeCents: inputCents(minimum),
      allowTaxableSales,
      selectedAccountIds: selected,
      classifications,
      accountTypes,
    }),
    [targets, reserve, minimum, allowTaxableSales, selected, classifications, accountTypes],
  );
  const preferencesDirty = JSON.stringify(preferences) !== savedPreferences;
  const validPreferences =
    Number.isSafeInteger(preferences.reserveCents) &&
    Number.isSafeInteger(preferences.minimumTradeCents) &&
    preferences.reserveCents >= 0 &&
    preferences.minimumTradeCents >= 0;
  const privateReady = gate === 'ready';
  function applyPreferences(next: WorkspacePreferences) {
    setTargets(next.targets.map((target) => ({ ...target })));
    setReserve(String(next.reserveCents / 100));
    setMinimum(String(next.minimumTradeCents / 100));
    setAllowTaxableSales(next.allowTaxableSales);
    setSelected(next.selectedAccountIds);
    setClassifications(next.classifications);
    setAccountTypes(next.accountTypes);
    setSavedPreferences(JSON.stringify(next));
  }
  function clearPrivate() {
    privateEpoch.current += 1;
    setPortfolio(blankPortfolio());
    applyPreferences(defaultWorkspacePreferences);
    setPlans([]);
    setPlansError('');
    setInspectedPlan(null);
    setContribution('0');
    setContributionAccount('');
    setOnboarded(false);
    setReviewed({ targets: false, reserve: false, classifications: false });
    setStatus((previous) => ({ ...previous, connected: false }));
    setGate('signed-out');
  }
  function handleRequestError(cause: unknown, fallback: string) {
    if (cause instanceof Error && cause.name === 'AbortError') return;
    if (cause instanceof WorkspaceRequestError && cause.status === 401) {
      clearPrivate();
      setModal(null);
      setError('Your SnapTrade session has expired. Reconnect to open your private workspace.');
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  }
  async function loadLive(hydrate = false) {
    if (mode === 'demo') return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError('');
    if (hydrate) setGate('loading');
    try {
      const nextStatus = await requestJson<Status>('/api/status', { signal: controller.signal });
      setStatus(nextStatus);
      if (!nextStatus.connected) {
        clearPrivate();
        return;
      }
      if (hydrate) {
        const [portfolioResult, workspaceResult, historyResult] = await Promise.allSettled([
          requestJson<Portfolio>('/api/portfolio', { signal: controller.signal }),
          requestJson<Workspace>('/api/workspace', { signal: controller.signal }),
          requestJson<{ plans: SavedPlanSummary[] }>('/api/plans', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        for (const result of [portfolioResult, workspaceResult, historyResult]) {
          if (
            result.status === 'rejected' &&
            result.reason instanceof WorkspaceRequestError &&
            result.reason.status === 401
          )
            throw result.reason;
        }
        if (portfolioResult.status === 'rejected') throw portfolioResult.reason;
        if (workspaceResult.status === 'rejected') throw workspaceResult.reason;
        const nextPortfolio = portfolioResult.value;
        const workspace = workspaceResult.value;
        if (nextPortfolio.mode !== 'live')
          throw new Error(
            'The brokerage service returned an unexpected portfolio. Please reconnect.',
          );
        setPortfolio(nextPortfolio);
        applyPreferences(parsePreferences(workspace.preferences));
        setOnboarded(!!workspace.updatedAt);
        if (historyResult.status === 'fulfilled') {
          setPlans(historyResult.value.plans);
          setPlansError('');
        } else
          setPlansError(
            'Your saved plan history is temporarily unavailable. Your current portfolio and preferences are ready.',
          );
      } else {
        const nextPortfolio = await requestJson<Portfolio>('/api/portfolio', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (nextPortfolio.mode !== 'live')
          throw new Error(
            'The brokerage service returned an unexpected portfolio. Please reconnect.',
          );
        setPortfolio(nextPortfolio);
        setNotice('Latest available brokerage snapshots loaded.');
      }
      setGate('ready');
      setValuationTime(Date.now());
    } catch (cause) {
      if (controller.signal.aborted) return;
      handleRequestError(cause, 'Your portfolio could not be loaded.');
      if (
        !(cause instanceof WorkspaceRequestError && cause.status === 401) &&
        (hydrate || !sourcePortfolio.accounts.length)
      )
        setGate('error');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialView = params.get('view');
    if (
      initialView === 'portfolio' ||
      initialView === 'rebalance' ||
      initialView === 'connections' ||
      initialView === 'plans'
    )
      setView(initialView);
    const pop = () => {
      const next = new URLSearchParams(window.location.search).get('view');
      setView(
        next === 'rebalance' || next === 'connections' || next === 'plans' ? next : 'portfolio',
      );
    };
    window.addEventListener('popstate', pop);
    if (mode === 'demo') {
      const saved = readDemoWorkspace();
      if (saved) {
        applyPreferences(saved.preferences);
        setOnboarded(saved.onboarded);
        setDemoPlans(saved.plans);
        setPlans(saved.plans.map(summarizePlan));
      }
    } else {
      void loadLive(true);
    }
    if (params.has('error')) {
      const code = params.get('error');
      setError(
        code === 'access_denied'
          ? 'You cancelled sign-in. You can reconnect whenever you are ready.'
          : 'Sign-in could not be completed. Please reconnect and try again.',
      );
      params.delete('error');
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${params.size ? `?${params}` : ''}`,
      );
    }
    return () => {
      requestController.current?.abort();
      window.removeEventListener('popstate', pop);
    };
  }, [mode]);
  useEffect(() => {
    if (mode === 'demo') return;
    const update = () => setValuationTime(Date.now());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [mode]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice('');
      setUndoPlan(null);
    }, 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (mode !== 'live' || !onboarded || !preferencesDirty) return;
    const protectPreferences = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPreferences);
    return () => window.removeEventListener('beforeunload', protectPreferences);
  }, [mode, onboarded, preferencesDirty]);

  const accounts = useMemo(
    () => portfolio.accounts.filter((a) => !selected.length || selected.includes(a.id)),
    [portfolio, selected],
  );
  const brokerCounts = new Map<string, number>();
  for (const account of portfolio.accounts) {
    const broker = account.broker.trim().toLowerCase();
    brokerCounts.set(broker, (brokerCounts.get(broker) || 0) + 1);
  }
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
  const calculatedPlan = useMemo(
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
  const currentPlan =
    mode === 'live' && !onboarded
      ? {
          ...calculatedPlan,
          status: 'blocked' as const,
          trades: [],
          blockers: [
            'Review your target mix, cash reserve, and classifications, then save your workspace preferences before creating your first plan.',
          ],
        }
      : calculatedPlan;
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
  const observedAllocation = (Object.keys(classes) as AssetClass[]).map((assetClass) => {
    const valueCents = accounts.reduce(
      (sum, account) =>
        sum +
        account.positions
          .filter((position) => position.assetClass === assetClass)
          .reduce((subtotal, position) => subtotal + positionValue(position), 0),
      0,
    );
    return {
      assetClass,
      valueCents,
      percent: total > 0 ? (valueCents / total) * 100 : 0,
      targetPercent: targets.find((target) => target.assetClass === assetClass)?.percent || 0,
    };
  });
  const chartAllocation = showingPlanned ? currentPlan.after : observedAllocation;
  const protectedCash = options.cashBufferCents * accounts.length;
  const chartCash = showingPlanned ? currentPlan.cashAfterCents - protectedCash : cash;
  const chartCashPercent =
    (showingPlanned ? currentPlan.totalCents : total) > 0
      ? (chartCash / (showingPlanned ? currentPlan.totalCents : total)) * 100
      : 0;
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
    const url = new URL(window.location.href);
    if (next === 'portfolio') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
  }
  function toggleAccount(id: string) {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((account) => account !== id) : [...previous, id],
    );
  }
  function changeScenario(next: string) {
    if (mode !== 'demo') return;
    setScenario(next);
    setPortfolio(samplePortfolio(next));
    setSelected([]);
    setClassifications({});
    setAccountTypes({});
    setComparison('current');
  }
  function persistDemo(
    nextPreferences = preferences,
    nextPlans = demoPlans,
    completed = onboarded,
  ) {
    writeDemoWorkspace({
      version: 1,
      preferences: parsePreferences(nextPreferences),
      plans: nextPlans,
      onboarded: completed,
    });
  }
  async function savePreferences() {
    const epoch = privateEpoch.current;
    setSavingPreferences(true);
    setError('');
    try {
      const validated = parsePreferences(preferences);
      if (mode === 'demo') persistDemo(validated, demoPlans, true);
      else
        await requestJson<Workspace>('/api/workspace', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: validated }),
        });
      if (epoch !== privateEpoch.current) return;
      setSavedPreferences(JSON.stringify(validated));
      setOnboarded(true);
      setNotice(
        mode === 'demo'
          ? 'Sample preferences saved in this browser.'
          : 'Workspace preferences saved securely.',
      );
    } catch (cause) {
      handleRequestError(cause, 'Your preferences could not be saved.');
    } finally {
      setSavingPreferences(false);
    }
  }
  function exportPlan() {
    const freshPlan = generatePlan(accounts, {
      ...options,
      now: mode === 'demo' ? demoTime : new Date().toISOString(),
    });
    if (freshPlan.status === 'blocked' || (mode === 'live' && !onboarded)) {
      setError(
        `This plan needs review before export. ${freshPlan.blockers[0] || 'Save your workspace preferences first.'}`,
      );
      return;
    }
    downloadPlan(freshPlan, currency, 'balance-rebalance-plan', {
      historical: false,
      asOf: sourcePortfolio.asOf,
      demo: mode === 'demo',
    });
    setNotice('Simulation exported. No orders were placed.');
  }
  async function savePlan() {
    const epoch = privateEpoch.current;
    if (planBusy || !planName.trim() || currentPlan.status !== 'ready' || !onboarded) return;
    setPlanBusy(true);
    setError('');
    try {
      let saved: SavedPlan;
      if (mode === 'demo') {
        if (demoPlans.length >= 25)
          throw new Error('You can keep up to 25 sample plans. Remove one before saving another.');
        const result = generatePlan(accounts, { ...options, now: demoTime });
        if (result.status !== 'ready')
          throw new Error(result.blockers[0] || 'Review the plan inputs first.');
        saved = {
          id: crypto.randomUUID(),
          name: planName.trim(),
          createdAt: new Date().toISOString(),
          asOf: sourcePortfolio.asOf,
          sourceFingerprint: `sample-fixture-v1:${scenario}`,
          status: result.status,
          driftBefore: result.driftBefore,
          driftAfter: result.driftAfter,
          tradeCount: result.trades.length,
          totalCents: result.totalCents,
          historical: true,
          executable: false,
          preferences: parsePreferences(preferences),
          contributionCents: options.contributionCents,
          contributionAccountId: options.contributionAccountId,
          source: structuredClone(portfolio),
          result,
        };
        const nextPlans = [saved, ...demoPlans];
        persistDemo(preferences, nextPlans);
        setDemoPlans(nextPlans);
      } else {
        const response = await requestJson<{ plan: SavedPlan }>('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: planName.trim(),
            preferences: parsePreferences(preferences),
            contributionCents: options.contributionCents,
            contributionAccountId: options.contributionAccountId,
          }),
        });
        saved = response.plan;
      }
      if (epoch !== privateEpoch.current) return;
      setPlans((previous) => [summarizePlan(saved), ...previous]);
      setModal(null);
      setNotice('Plan snapshot saved. You can find it in Saved plans.');
      navigate('plans');
    } catch (cause) {
      handleRequestError(cause, 'Your plan could not be saved.');
    } finally {
      setPlanBusy(false);
    }
  }
  async function reloadPlans() {
    if (mode === 'demo' || !privateReady) return;
    const epoch = privateEpoch.current;
    setPlansLoading(true);
    setPlansError('');
    try {
      const response = await requestJson<{ plans: SavedPlanSummary[] }>('/api/plans');
      if (epoch !== privateEpoch.current) return;
      setPlans(response.plans);
    } catch (cause) {
      if (cause instanceof WorkspaceRequestError && cause.status === 401)
        handleRequestError(cause, 'Please reconnect.');
      else
        setPlansError(
          cause instanceof Error ? cause.message : 'Your saved history could not be loaded.',
        );
    } finally {
      setPlansLoading(false);
    }
  }
  async function inspectPlan(id: string) {
    const epoch = privateEpoch.current;
    setPlanBusy(true);
    setError('');
    try {
      const plan =
        mode === 'demo'
          ? demoPlans.find((saved) => saved.id === id)
          : (await requestJson<{ plan: SavedPlan }>(`/api/plans?id=${encodeURIComponent(id)}`))
              .plan;
      if (epoch !== privateEpoch.current) return;
      if (!plan) throw new Error('This plan is no longer available. Reload Saved plans.');
      setInspectedPlan(plan);
    } catch (cause) {
      handleRequestError(cause, 'This saved plan could not be opened.');
    } finally {
      setPlanBusy(false);
    }
  }
  async function removePlan(plan: SavedPlanSummary) {
    const epoch = privateEpoch.current;
    setPlanBusy(true);
    setError('');
    try {
      if (mode === 'demo') {
        const removed = demoPlans.find((saved) => saved.id === plan.id) || null;
        const nextPlans = demoPlans.filter((saved) => saved.id !== plan.id);
        persistDemo(preferences, nextPlans);
        setDemoPlans(nextPlans);
        setUndoPlan(removed);
      } else await requestJson(`/api/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
      if (epoch !== privateEpoch.current) return;
      setPlans((previous) => previous.filter((saved) => saved.id !== plan.id));
      setPendingDelete(null);
      setModal(null);
      setNotice('Saved plan deleted.');
    } catch (cause) {
      handleRequestError(cause, 'The plan could not be deleted.');
    } finally {
      setPlanBusy(false);
    }
  }
  function undoDelete() {
    if (!undoPlan) return;
    try {
      const next = [undoPlan, ...demoPlans];
      persistDemo(preferences, next);
      setDemoPlans(next);
      setPlans(next.map(summarizePlan));
      setUndoPlan(null);
      setNotice('Sample plan restored.');
    } catch {
      setError('This browser could not restore the saved plan.');
    }
  }
  async function deleteWorkspaceData() {
    const epoch = privateEpoch.current;
    setPlanBusy(true);
    setError('');
    try {
      let warning: string | undefined;
      if (mode === 'demo') localStorage.removeItem(demoStorageKey);
      else {
        const response = await requestJson<{ deleted: boolean; warning?: string }>(
          '/api/workspace',
          {
            method: 'DELETE',
          },
        );
        warning = response.warning;
      }
      if (epoch !== privateEpoch.current) return;
      applyPreferences(defaultWorkspacePreferences);
      setDemoPlans([]);
      setPlans([]);
      setPlansError('');
      setOnboarded(false);
      setUndoPlan(null);
      setInspectedPlan(null);
      setReviewed({ targets: false, reserve: false, classifications: false });
      setModal(null);
      setNotice('Saved preferences and plan history deleted.');
      if (warning) setError(warning);
    } catch (cause) {
      handleRequestError(cause, 'Your saved workspace data could not be deleted.');
    } finally {
      setPlanBusy(false);
    }
  }
  async function disconnect() {
    setDisconnecting(true);
    setLoading(true);
    setError('');
    requestController.current?.abort();
    try {
      const body = await requestJson<{ revoked?: boolean; warning?: string }>('/api/auth/logout', {
        method: 'POST',
      });
      clearPrivate();
      if (body.warning) setError(body.warning);
      else if (body.revoked === false)
        setError(
          'You are signed out. Remove Balance in your SnapTrade dashboard to confirm access has been revoked.',
        );
      else
        setNotice('Disconnected from SnapTrade. Saved plans are retained for your next sign-in.');
    } catch (cause) {
      handleRequestError(cause, 'Could not disconnect.');
    } finally {
      setDisconnecting(false);
      setLoading(false);
    }
  }
  function freshness(account: Account) {
    if (mode === 'demo') return 'Sample snapshot · Oct 14, 2026';
    if (!account.syncedAt) return 'Freshness unavailable';
    const age = Math.max(0, valuationTime - Date.parse(account.syncedAt));
    if (!Number.isFinite(age)) return 'Freshness unavailable';
    const relative =
      age < 60000
        ? 'less than a minute ago'
        : age < 3600000
          ? `${Math.floor(age / 60000)} min ago`
          : age < 86400000
            ? `${Math.floor(age / 3600000)} hr ago`
            : `${Math.floor(age / 86400000)} days ago`;
    return `${age > 86400000 ? 'Needs updating · ' : 'Synced '}${relative}`;
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
            <strong>{mode === 'demo' ? 'Sample workspace' : 'My workspace'}</strong>
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
            className={view === 'plans' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('plans')}
            aria-current={view === 'plans' ? 'page' : undefined}
          >
            <Bookmark size={19} />
            Saved plans<span className="nav-count">{plans.length}</span>
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
          <WorkspaceHelpLinks section="review" />
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
                    : view === 'plans'
                      ? 'Saved plans'
                      : 'Connections'}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className={`mode-badge ${portfolio.mode === 'live' ? 'live' : ''}`}>
              <span />
              {mode === 'demo'
                ? 'Sample workspace'
                : status.connected
                  ? 'Connected workspace'
                  : 'Private workspace'}
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
              aria-label={mode === 'demo' ? 'Sample profile' : 'Your profile'}
            >
              {mode === 'demo' ? 'S' : 'ME'}
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="banner error-banner" role="alert">
              <CircleHelp size={17} />
              <span>{error}</span>
              <a
                href="/support"
                target="_blank"
                rel="noreferrer"
                aria-label="Open support for this error in a new tab"
              >
                Get help <ExternalLink size={13} aria-hidden="true" />
              </a>
              {mode === 'live' && gate === 'ready' && (
                <button onClick={() => void loadLive()}>
                  Retry <RefreshCw size={13} />
                </button>
              )}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {!privateReady &&
            (gate === 'loading' ? (
              <WorkspaceLoading />
            ) : (
              <WorkspaceGate
                state={gate === 'signed-out' ? 'signed-out' : 'error'}
                error={error}
                configured={status.configured}
                onRetry={() => void loadLive(true)}
              />
            ))}
          {privateReady && sourcePortfolio.accounts.length === 0 && (
            <WorkspaceGate
              state="empty"
              error=""
              configured={status.configured}
              onRetry={() => void loadLive()}
            />
          )}
          {privateReady && sourcePortfolio.accounts.length > 0 && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === 'portfolio'
                      ? '01 / THE BIG PICTURE'
                      : view === 'rebalance'
                        ? '02 / MAKE YOUR NEXT MOVE INTENTIONAL'
                        : view === 'plans'
                          ? '03 / DECISIONS WORTH KEEPING'
                          : '04 / YOUR ACCOUNTS, TOGETHER'}
                  </div>
                  <h1>
                    {view === 'portfolio'
                      ? 'Your portfolio, in perspective.'
                      : view === 'rebalance'
                        ? 'Find your balance.'
                        : view === 'plans'
                          ? 'A record of your reasoning.'
                          : 'A more connected portfolio.'}
                  </h1>
                  <p>
                    {view === 'portfolio'
                      ? 'See what you own. Understand the mix. Move forward with a plan.'
                      : view === 'rebalance'
                        ? 'Turn your target allocation into a practical plan, one account at a time.'
                        : view === 'plans'
                          ? 'Revisit your saved simulations, with the original data and boundaries intact.'
                          : 'Manage your shared accounts through SnapTrade. See the latest available brokerage snapshots.'}
                  </p>
                </div>
                <button
                  className="button secondary connect-button"
                  onClick={() => setModal('connect')}
                >
                  <Plus size={16} />
                  {mode === 'demo' ? 'Connect real accounts' : 'Manage connections'}
                </button>
              </div>

              {!onboarded && (
                <section className="workspace-onboarding card" aria-label="Workspace setup">
                  <div className="onboarding-title">
                    <span className="onboarding-icon">
                      <SlidersHorizontal size={21} />
                    </span>
                    <div>
                      <h2>Make this workspace yours.</h2>
                      <p>
                        Choose your policy before saving your first plan. The starting mix is
                        illustrative.
                      </p>
                    </div>
                    <span className="onboarding-progress">
                      {Object.values(reviewed).filter(Boolean).length} of 3 reviewed
                    </span>
                  </div>
                  <div className="onboarding-steps">
                    <button
                      onClick={() => {
                        setDraftTargets(targets.map((target) => ({ ...target })));
                        setModal('targets');
                      }}
                    >
                      {reviewed.targets ? <Check size={17} /> : <span>1</span>}
                      <div>
                        <strong>Review targets</strong>
                        <small>Choose a mix that adds up to 100%.</small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setReviewed((previous) => ({ ...previous, reserve: true }));
                        navigate('rebalance');
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLInputElement>(
                              '[aria-label="Cash reserve per account"]',
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      {reviewed.reserve ? <Check size={17} /> : <span>2</span>}
                      <div>
                        <strong>Review cash reserve</strong>
                        <small>Protect cash in every account.</small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (canClassify) setModal('classify');
                        else {
                          setReviewed((previous) => ({ ...previous, classifications: true }));
                          setNotice(
                            'Holdings use supported asset classes. Review individual positions below.',
                          );
                        }
                      }}
                    >
                      {reviewed.classifications ? <Check size={17} /> : <span>3</span>}
                      <div>
                        <strong>Review classifications</strong>
                        <small>
                          {canClassify
                            ? 'Confirm unknown holdings and tax types.'
                            : 'Check the assets behind your allocation.'}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="onboarding-bottom">
                    <p>
                      {mode === 'demo'
                        ? 'Sample preferences stay in this browser. You can explore the simulation before saving.'
                        : 'Your preferences are saved privately to your connected workspace.'}
                    </p>
                    <button
                      className="button primary small-button"
                      disabled={
                        savingPreferences ||
                        !validPreferences ||
                        !Object.values(reviewed).every(Boolean)
                      }
                      onClick={() => void savePreferences()}
                    >
                      {savingPreferences ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <Save size={15} />
                      )}
                      {savingPreferences ? 'Saving preferences…' : 'Save workspace preferences'}
                    </button>
                  </div>
                </section>
              )}
              {onboarded && (
                <div className={`preference-status ${preferencesDirty ? 'has-changes' : ''}`}>
                  <span>
                    <ShieldCheck size={15} />
                    {preferencesDirty
                      ? 'You have unsaved workspace preferences.'
                      : mode === 'demo'
                        ? 'Sample preferences saved in this browser.'
                        : 'Workspace preferences saved securely.'}
                  </span>
                  {preferencesDirty && (
                    <button
                      className="button secondary small-button"
                      disabled={savingPreferences || planBusy || loading || !validPreferences}
                      onClick={() => void savePreferences()}
                    >
                      {savingPreferences ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      {savingPreferences ? 'Saving preferences…' : 'Save workspace preferences'}
                    </button>
                  )}
                </div>
              )}
              {hasUnverified && (
                <div className="banner classification-banner">
                  <ShieldCheck size={17} />
                  <span>
                    Some holdings or account types need your classification. Only you can confirm
                    how they fit your plan.
                  </span>
                  <button onClick={() => setModal('classify')}>
                    Review classifications <ArrowRight size={13} />
                  </button>
                </div>
              )}
              {view !== 'connections' && view !== 'plans' && (
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
                        aria-label={
                          (brokerCounts.get(a.broker.trim().toLowerCase()) || 0) > 1
                            ? accountDisplayName(a)
                            : undefined
                        }
                        className={selected.includes(a.id) ? 'filter-chip selected' : 'filter-chip'}
                        onClick={() => toggleAccount(a.id)}
                      >
                        <span
                          className={`broker-dot ${brokerInitial(a.broker) === 'ib' ? 'red' : brokerInitial(a.broker) === 'W' ? 'gold' : ''}`}
                        />
                        {(brokerCounts.get(a.broker.trim().toLowerCase()) || 0) > 1 ? (
                          <span className="account-filter-label">
                            <span>{a.broker}</span>
                            <small>
                              {a.name} · {a.number}
                            </small>
                          </span>
                        ) : (
                          a.broker
                        )}
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
                          {valuesNeedReview
                            ? 'KNOWN VALUE · NEEDS REVIEW'
                            : 'TOTAL PORTFOLIO VALUE'}
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
                          <strong>
                            {cannotCombineValues ? '—' : money(total - cash, currency)}
                          </strong>
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
                      ) : accounts.some((account) =>
                          account.positions.some(
                            (position) => !position.cashEquivalent && !hasPositionValue(position),
                          ),
                        ) || chartCash < 0 ? (
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
                                Current holdings
                              </button>
                              <button
                                className={showingPlanned ? 'selected' : ''}
                                disabled={currentPlan.status !== 'ready'}
                                onClick={() => setComparison('planned')}
                              >
                                After simulation
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
                                <strong>
                                  {showingPlanned ? 'Investable cash' : 'Reported cash'}
                                </strong>
                                <span>
                                  {showingPlanned
                                    ? `${money(protectedCash, currency, 2)} reserve excluded`
                                    : 'Included in current holdings'}
                                </span>
                              </div>
                              <b>{pct(chartCashPercent)}</b>
                            </div>
                          </div>
                        </div>
                      )}
                      {showingPlanned && currentPlan.status === 'ready' && (
                        <p className="inline-note">
                          The simulation uses a {money(currentPlan.totalCents, currency, 2)}{' '}
                          planning base after reserves
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
                            US equities make up <strong>{pct(usPercent)}</strong> of your planning
                            base. Your target is {targetUs}%. A few considered moves can bring
                            things closer.
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
                            sort === 'value'
                              ? 'Sort holdings alphabetically'
                              : 'Sort holdings by value'
                          }
                          onClick={() => setSort(sort === 'value' ? 'symbol' : 'value')}
                        >
                          <SlidersHorizontal size={16} />
                        </button>
                      </div>
                    </div>
                    <div
                      className="table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Holdings table, scroll horizontally to see all columns"
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
                                    className={`asset-icon asset-${p.assetClass} ${p.symbol === 'AAPL' ? 'apple' : ''}`}
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
                                    <small className="holding-class">
                                      {classes[p.assetClass].name}
                                      {p.assetClass === 'unclassified'
                                        ? ' · review before planning'
                                        : ''}
                                    </small>
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
                          <p>
                            Choose your targets. Balance will work within your account constraints.
                          </p>
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
                            style={{
                              width: `${t.percent}%`,
                              background: classes[t.assetClass].color,
                            }}
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
                                {accountDisplayName(a)}
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
                        <div className="plan-header-actions">
                          <button
                            className="button primary small-button"
                            disabled={
                              currentPlan.status !== 'ready' ||
                              !onboarded ||
                              planBusy ||
                              loading ||
                              savingPreferences
                            }
                            onClick={() => {
                              setPlanName(
                                `My rebalance · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                              );
                              setModal('save');
                            }}
                          >
                            <Bookmark size={14} />
                            Save plan
                          </button>
                          {currentPlan.status === 'ready' && currentPlan.trades.length > 0 && (
                            <button
                              className="button secondary small-button"
                              disabled={loading || planBusy || savingPreferences}
                              onClick={exportPlan}
                            >
                              <Download size={14} />
                              Export CSV
                            </button>
                          )}
                        </div>
                      </div>
                      {currentPlan.status === 'blocked' ? (
                        <>
                          <PlanningRecovery
                            accounts={accounts}
                            now={valuationTime}
                            mode={mode}
                            policyNeedsReview={
                              (mode === 'live' && !onboarded) ||
                              currentPlan.blockers.some((blocker) =>
                                /targets|cash reserve|contribution|minimum trade/i.test(blocker),
                              )
                            }
                            onClassify={() => setModal('classify')}
                            onReviewAccounts={() => navigate('connections')}
                            onReviewSettings={() => {
                              document
                                .querySelector<HTMLInputElement>(
                                  '[aria-label="Cash reserve per account"]',
                                )
                                ?.focus();
                            }}
                          />
                          <div className="blocker-list" role="status">
                            {currentPlan.blockers.map((b, i) => (
                              <div key={i}>
                                <ShieldCheck size={19} />
                                <span>{b}</span>
                              </div>
                            ))}
                            <div className="blocker-actions">
                              {canClassify && (
                                <button
                                  className="button secondary small-button"
                                  onClick={() => setModal('classify')}
                                >
                                  Review classifications
                                </button>
                              )}
                              {mode === 'live' && (
                                <>
                                  <button
                                    className="button secondary small-button"
                                    disabled={loading}
                                    onClick={() => void loadLive()}
                                  >
                                    <RefreshCw size={14} />
                                    Reload snapshots
                                  </button>
                                  <a
                                    className="text-button"
                                    href="https://dashboard.snaptrade.com"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Manage brokerage connection <ArrowUpRight size={14} />
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                        </>
                      ) : currentPlan.trades.length === 0 ? (
                        <div className="empty-state">
                          <CheckCheck size={30} />
                          <h3>
                            {distinct === 0
                              ? 'No holdings available to rebalance.'
                              : 'No practical moves within these boundaries.'}
                          </h3>
                          <p>
                            {distinct === 0
                              ? 'Balance only buys securities already held in each account. Select an account with supported holdings, or save this cash snapshot as a record of your current position.'
                              : 'You may already be close to target, or account cash and whole shares limit further progress. Try a contribution or adjust your constraints.'}
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
                            .sort(
                              (a, b) => (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1),
                            )
                            .map((t, i) => (
                              <TradeRow
                                key={`${t.accountId}-${t.symbol}-${t.side}-${i}`}
                                trade={t}
                                currency={currency}
                                account={accounts.find((account) => account.id === t.accountId)}
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
                            {((1 - currentPlan.driftAfter / currentPlan.driftBefore) * 100).toFixed(
                              1,
                            )}
                            % less allocation drift
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
                            {cannotCombineValues
                              ? '—'
                              : money(options.contributionCents, currency, 2)}
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

              {view === 'plans' && (
                <SavedPlans
                  plans={plans}
                  mode={mode}
                  loading={plansLoading}
                  error={plansError}
                  onReload={() => void reloadPlans()}
                  busy={planBusy}
                  onInspect={(id) => void inspectPlan(id)}
                  onRemove={(plan) => {
                    if (mode === 'demo') void removePlan(plan);
                    else {
                      setPendingDelete(plan);
                      setModal('delete-plan');
                    }
                  }}
                  onBuild={() => navigate('rebalance')}
                />
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
                        Add or reconnect brokerages in your SnapTrade Personal dashboard. Return
                        here to load the latest available account snapshots.
                      </p>
                    </div>
                    <a
                      className="button primary"
                      href={mode === 'demo' ? '/app' : 'https://dashboard.snaptrade.com'}
                      target={mode === 'live' ? '_blank' : undefined}
                      rel={mode === 'live' ? 'noreferrer' : undefined}
                    >
                      {mode === 'demo' ? 'Connect real accounts' : 'Manage brokerage accounts'}
                      <ArrowUpRight size={16} />
                    </a>
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
                      <button
                        className="button secondary"
                        disabled={loading}
                        onClick={() => void loadLive()}
                      >
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
                          <span>
                            {a.positions.filter((p) => !p.cashEquivalent).length} holdings
                          </span>
                        </div>
                        <div className="connection-freshness">
                          <span className="status-dot" />
                          {freshness(a)}
                        </div>
                        <p className="account-asof">
                          {a.syncedAt
                            ? `As of ${new Date(a.syncedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
                            : 'Snapshot time unavailable'}
                        </p>
                        {a.issues.map((issue, i) => (
                          <p className="account-issue" key={i}>
                            {issue}
                          </p>
                        ))}
                        <AccountRecovery
                          account={a}
                          now={valuationTime}
                          mode={mode}
                          loading={loading}
                          canUseOthers={portfolio.accounts.length > 1}
                          onClassify={() => setModal('classify')}
                          onReload={() => void loadLive()}
                          onUseOthers={() => {
                            setSelected(
                              portfolio.accounts
                                .filter((account) => account.id !== a.id)
                                .map((account) => account.id),
                            );
                            navigate('rebalance');
                            setNotice('This simulation now uses your other accounts.');
                          }}
                        />
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
                          password. Disconnecting ends your Balance session and attempts to revoke
                          the grant. Saved plans remain until you delete them.
                        </p>
                      </div>
                    </div>
                    {status.connected && (
                      <button
                        className="text-button danger"
                        disabled={loading}
                        onClick={disconnect}
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect SnapTrade'}
                      </button>
                    )}
                  </div>
                  <section className="card connection-data-card">
                    <div>
                      <h3>Your saved workspace data</h3>
                      <p>
                        {mode === 'demo'
                          ? 'Clear sample preferences and saved plans from this browser.'
                          : 'Permanently delete your preferences and plan history. Your SnapTrade connection stays active.'}
                      </p>
                    </div>
                    <button
                      className="text-button danger"
                      disabled={planBusy || savingPreferences || loading}
                      onClick={() => setModal('delete-data')}
                    >
                      <Trash2 size={15} />
                      Delete saved workspace data
                    </button>
                  </section>
                </>
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
              <a href="/privacy">Privacy</a>
              <a
                href="/guide#methodology"
                target="_blank"
                rel="noreferrer"
                aria-label="Open the guide in a new tab"
              >
                Guide <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a
                href="/support"
                target="_blank"
                rel="noreferrer"
                aria-label="Open support in a new tab"
              >
                Support <ExternalLink size={12} aria-hidden="true" />
              </a>
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
          {disconnecting ? 'Disconnecting from SnapTrade…' : 'Loading your brokerage snapshots…'}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          {undoPlan && <button onClick={undoDelete}>Undo</button>}
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
              setReviewed((previous) => ({ ...previous, classifications: true }));
              setModal(null);
              setNotice(
                'Classifications updated. Save workspace preferences to keep your choices.',
              );
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
          {(mode === 'demo' || !status.connected) && <ConnectionChecklist />}
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
          {mode === 'demo' ? (
            <a className="button primary full-width" href="/app">
              Open my private workspace <ArrowRight size={17} />
            </a>
          ) : status.connected ? (
            <>
              <a
                className="button primary full-width"
                href="https://dashboard.snaptrade.com"
                target="_blank"
                rel="noreferrer"
              >
                Open SnapTrade Personal dashboard <ArrowUpRight size={17} />
              </a>
              <button
                className="button secondary full-width"
                disabled={loading}
                onClick={() => {
                  setModal(null);
                  void loadLive();
                }}
              >
                I connected an account, reload <RefreshCw size={16} />
              </button>
              <p className="inline-note">
                Choose your Personal workspace in SnapTrade, add a brokerage, then return to
                Balance. Reloading reads the latest available snapshot; it does not force a
                brokerage sync.
              </p>
            </>
          ) : status.configured ? (
            <a className="button primary full-width" href="/api/auth/login">
              Continue with SnapTrade <ArrowUpRight size={17} />
            </a>
          ) : (
            <div className="configuration-note">
              <strong>Connections are temporarily unavailable.</strong>
              <p>Please try again later. The sample workspace is available at any time.</p>
            </div>
          )}
          <button className="dialog-secondary" onClick={() => setModal(null)}>
            Back to workspace
          </button>
          <WorkspaceHelpLinks />
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
              setReviewed((previous) => ({ ...previous, targets: true }));
              setModal(null);
              setNotice('Targets updated. Save workspace preferences to keep your mix.');
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
      {inspectedPlan && (
        <SavedPlanDetail plan={inspectedPlan} onClose={() => setInspectedPlan(null)} />
      )}
      {modal === 'save' && (
        <Dialog
          title="Save this plan"
          onClose={() => {
            if (!planBusy) setModal(null);
          }}
        >
          <p className="dialog-lede">
            {mode === 'demo'
              ? 'Keep a sample snapshot in this browser, including your targets, constraints, holdings, and proposed moves.'
              : 'Balance will reload your brokerage snapshots and recalculate the plan on the server before saving. Updated data may produce different moves.'}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void savePlan();
            }}
          >
            <label className="save-name-label">
              Plan name
              <input
                aria-label="Plan name"
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
                autoFocus
                maxLength={80}
                required
                disabled={planBusy}
                placeholder="e.g. October contribution"
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="historical-notice">
              <ShieldCheck size={18} />
              <p>A saved plan is a historical simulation. It cannot execute trades.</p>
            </div>
            <button
              className="button primary full-width"
              disabled={planBusy || !planName.trim() || planName.trim().length > 80}
              type="submit"
            >
              {planBusy ? <LoaderCircle className="spin" size={16} /> : <Bookmark size={16} />}
              {planBusy ? 'Saving snapshot…' : 'Save plan snapshot'}
            </button>
          </form>
        </Dialog>
      )}
      {modal === 'delete-plan' && pendingDelete && (
        <Dialog
          title="Delete this saved plan?"
          onClose={() => {
            if (!planBusy) setModal(null);
          }}
        >
          <p className="dialog-lede">
            “{pendingDelete.name}” and its historical snapshot will be permanently removed from your
            workspace.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="button danger-button full-width"
            disabled={planBusy}
            onClick={() => void removePlan(pendingDelete)}
          >
            {planBusy ? 'Deleting plan…' : 'Delete saved plan'}
          </button>
          <button className="dialog-secondary" disabled={planBusy} onClick={() => setModal(null)}>
            Keep plan
          </button>
        </Dialog>
      )}
      {modal === 'delete-data' && (
        <Dialog
          title="Delete saved workspace data?"
          onClose={() => {
            if (!planBusy) setModal(null);
          }}
        >
          <p className="dialog-lede">
            This permanently deletes your saved preferences and every plan snapshot
            {mode === 'demo' ? ' from this browser' : ''}. Your brokerage accounts and SnapTrade
            connection are unaffected.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="button danger-button full-width"
            disabled={planBusy}
            onClick={() => void deleteWorkspaceData()}
          >
            {planBusy ? 'Deleting workspace data…' : 'Delete all saved data'}
          </button>
          <button className="dialog-secondary" disabled={planBusy} onClick={() => setModal(null)}>
            Keep my data
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
function TradeRow({
  trade,
  currency,
  account,
}: {
  trade: Trade;
  currency: string;
  account?: Account;
}) {
  return (
    <div className="trade-row">
      <span className={`trade-side ${trade.side}`}>
        {trade.side === 'buy' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
      </span>
      <div className="trade-detail">
        <strong>
          <span>{trade.side === 'buy' ? 'Buy' : 'Sell'}</span> {trade.quantity} {trade.symbol}
        </strong>
        <span>{account ? accountDisplayName(account) : trade.accountName}</span>
        <p>{trade.reason}</p>
      </div>
      <div className="trade-value">
        <strong>{money(trade.valueCents, currency, 2)}</strong>
        <span>@ {money(trade.priceCents, currency, 2)}</span>
      </div>
    </div>
  );
}
