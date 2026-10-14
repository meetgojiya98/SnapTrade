import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { applyClassifications } from '@/lib/classification';
import { generatePlan } from '@/lib/planner';
import type { Portfolio } from '@/lib/types';
import type { SavePlanInput, SavedPlan } from '@/lib/workspace';
import { configurationRequirements, getServerConfig } from './config';
import { hashSecret } from './crypto';
import { reconnectError, ServiceError } from './errors';
import { loadPortfolio } from './portfolio';
import { sessionId } from './routes';
import { getSessionStore } from './store';
import { getWorkspaceStore, type WorkspaceStore } from './workspace-store';

const maxRequestBytes = 128_000;

/** Origin checking + JSON-only mutations prevent another site from using the HttpOnly session. */
export async function authenticateWorkspace(request: NextRequest, mutation = false) {
  if (configurationRequirements().length)
    throw new ServiceError('configuration', 503, 'SnapTrade is not configured.');
  if (
    mutation &&
    (request.headers.get('origin') !== getServerConfig().appUrl ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  )
    throw new ServiceError('invalid_origin', 403, 'This request must come from this app.');
  const id = sessionId(request);
  const session = id ? await getSessionStore().readSession(id) : null;
  if (!id || !session || !session.subject || !session.scope.split(' ').includes('read'))
    throw reconnectError();
  return { sessionId: id, subject: session.subject };
}

export async function readWorkspaceJson(request: NextRequest): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw new ServiceError('invalid_content_type', 415, 'Send this request as JSON.');
  if (Number(request.headers.get('content-length')) > maxRequestBytes)
    throw new ServiceError('request_too_large', 413, 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError('invalid_input', 400, 'Provide a JSON request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxRequestBytes) {
        await reader.cancel();
        throw new ServiceError('request_too_large', 413, 'This request is too large.');
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('invalid_input', 400, 'Provide a valid JSON request body.');
  } finally {
    reader.releaseLock();
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Retrieval time does not change a source fingerprint; holdings, cash, source sync and issues do. */
export function fingerprintPortfolio(source: Portfolio): string {
  const accounts = source.accounts
    .map((account) => ({
      ...account,
      positions: [...account.positions].sort((a, b) => a.id.localeCompare(b.id)),
      issues: [...account.issues].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return hashSecret(
    canonical({ mode: source.mode, accounts, warnings: [...source.warnings].sort() }),
  );
}

export async function createSavedPlan(
  identity: { sessionId: string; subject: string },
  input: SavePlanInput,
  dependencies: {
    loadPortfolio?: (id: string) => Promise<Portfolio>;
    store?: WorkspaceStore;
    now?: () => number;
  } = {},
): Promise<SavedPlan> {
  const store = dependencies.store ?? getWorkspaceStore();
  const generation = await store.dataGeneration(identity.subject);
  // Fast fail before expensive upstream reads; the transactional insert also enforces this cap.
  if ((await store.listPlans(identity.subject)).length >= 30)
    throw new ServiceError(
      'plan_limit',
      409,
      'You have 30 saved plans. Delete an older plan before saving another.',
    );
  const current = await (dependencies.loadPortfolio ?? loadPortfolio)(identity.sessionId);
  if (current.mode !== 'live')
    throw new ServiceError(
      'invalid_source',
      422,
      'A connected plan requires current brokerage data.',
    );
  const selected = new Set(input.preferences.selectedAccountIds);
  if ([...selected].some((id) => !current.accounts.some((account) => account.id === id)))
    throw new ServiceError(
      'account_unavailable',
      422,
      'A selected account is no longer available. Refresh and select your accounts again.',
    );
  const source: Portfolio = {
    ...current,
    accounts: current.accounts.filter((account) => selected.size === 0 || selected.has(account.id)),
  };
  if (Buffer.byteLength(JSON.stringify(source)) > 2_000_000)
    throw new ServiceError(
      'snapshot_too_large',
      422,
      'Select fewer accounts before saving this plan.',
    );
  const classified = applyClassifications(
    source,
    input.preferences.classifications,
    input.preferences.accountTypes,
  );
  const createdAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  const result = generatePlan(classified.accounts, {
    targets: input.preferences.targets,
    cashBufferCents: input.preferences.reserveCents,
    minimumTradeCents: input.preferences.minimumTradeCents,
    allowTaxableSales: input.preferences.allowTaxableSales,
    contributionCents: input.contributionCents,
    contributionAccountId: input.contributionAccountId,
    now: createdAt,
  });
  if (result.status === 'blocked')
    throw new ServiceError(
      'plan_blocked',
      422,
      result.blockers[0] ?? 'Resolve the portfolio issues before saving a plan.',
    );
  const plan: SavedPlan = {
    id: randomUUID(),
    name: input.name,
    createdAt,
    asOf: new Date(
      Math.min(...source.accounts.map((account) => Date.parse(account.syncedAt!))),
    ).toISOString(),
    sourceFingerprint: fingerprintPortfolio(source),
    status: result.status,
    driftBefore: result.driftBefore,
    driftAfter: result.driftAfter,
    tradeCount: result.trades.length,
    totalCents: result.totalCents,
    historical: true,
    executable: false,
    preferences: structuredClone(input.preferences),
    contributionCents: input.contributionCents,
    contributionAccountId: input.contributionAccountId,
    source,
    result,
  };
  await store.createPlan(identity.subject, plan, generation);
  return plan;
}
