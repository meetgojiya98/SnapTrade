import type { AssetClass, Plan, Portfolio, Target } from './types';

/** Shared API contract. Contributions belong to a scenario, not the recurring policy. */
export interface WorkspacePreferences {
  targets: Target[];
  reserveCents: number;
  minimumTradeCents: number;
  allowTaxableSales: boolean;
  selectedAccountIds: string[];
  classifications: Record<string, AssetClass>;
  accountTypes: Record<string, 'taxable' | 'retirement'>;
}

export const defaultWorkspacePreferences: WorkspacePreferences = {
  targets: [
    { assetClass: 'us-equity', percent: 50 },
    { assetClass: 'international', percent: 30 },
    { assetClass: 'bonds', percent: 20 },
  ],
  reserveCents: 25_000,
  minimumTradeCents: 10_000,
  allowTaxableSales: false,
  selectedAccountIds: [],
  classifications: {},
  accountTypes: {},
};

export interface Workspace {
  version: 1;
  preferences: WorkspacePreferences;
  updatedAt: string | null;
}

export interface SavedPlanSummary {
  id: string;
  name: string;
  createdAt: string;
  /** Oldest selected brokerage sync, rather than the time Balance retrieved the data. */
  asOf: string;
  sourceFingerprint: string;
  status: Plan['status'];
  driftBefore: number;
  driftAfter: number;
  tradeCount: number;
  totalCents: number;
  historical: true;
  executable: false;
}

/** Immutable record of a simulation. Prices and eligibility are never refreshed in place. */
export interface SavedPlan extends SavedPlanSummary {
  preferences: WorkspacePreferences;
  contributionCents: number;
  contributionAccountId: string | null;
  source: Portfolio;
  result: Plan;
}

export interface SavePlanInput {
  name: string;
  preferences: WorkspacePreferences;
  contributionCents: number;
  contributionAccountId: string | null;
}

export function summarizePlan(plan: SavedPlan): SavedPlanSummary {
  const {
    id,
    name,
    createdAt,
    asOf,
    sourceFingerprint,
    status,
    driftBefore,
    driftAfter,
    tradeCount,
    totalCents,
    historical,
    executable,
  } = plan;
  return {
    id,
    name,
    createdAt,
    asOf,
    sourceFingerprint,
    status,
    driftBefore,
    driftAfter,
    tradeCount,
    totalCents,
    historical,
    executable,
  };
}
