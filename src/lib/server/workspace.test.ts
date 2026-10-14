import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import type { Portfolio } from '@/lib/types';
import { defaultWorkspacePreferences, type SavedPlan, type SavePlanInput } from '@/lib/workspace';
import { hashSecret, randomSecret } from './crypto';
import { getSessionStore } from './store';
import { createSavedPlan, fingerprintPortfolio } from './workspace';
import { getWorkspaceStore, MemoryWorkspaceStore } from './workspace-store';
import { getCachedPortfolio, getPortfolioCache } from './portfolio-cache';
import {
  GET as readWorkspace,
  PUT as writeWorkspace,
  DELETE as deleteWorkspace,
} from '@/app/api/workspace/route';
import { GET as readPlans, POST as savePlan } from '@/app/api/plans/route';
import { DELETE as deletePlan } from '@/app/api/plans/[id]/route';

const { portfolioLoader } = vi.hoisted(() => ({ portfolioLoader: vi.fn() }));
vi.mock('@/lib/server/portfolio', () => ({ loadPortfolio: portfolioLoader }));

const now = new Date('2026-10-14T12:00:00Z').getTime();
function source(): Portfolio {
  const portfolio = makeDemoPortfolio();
  return {
    ...portfolio,
    mode: 'live',
    asOf: new Date(now).toISOString(),
    warnings: [],
    accounts: portfolio.accounts.map((account) => ({
      ...account,
      syncedAt: new Date(now).toISOString(),
    })),
  };
}
function input(): SavePlanInput {
  return {
    name: 'October rebalance',
    preferences: {
      ...structuredClone(defaultWorkspacePreferences),
      selectedAccountIds: source().accounts.map((account) => account.id),
    },
    contributionCents: 0,
    contributionAccountId: null,
  };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
  vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'private-client-secret');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SESSION_STORE', 'memory');
  portfolioLoader.mockReset();
  portfolioLoader.mockResolvedValue(source());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function session(subject = randomUUID()) {
  const id = randomSecret();
  await getSessionStore().createSession(id, {
    subject,
    scope: 'openid read',
    accessToken: 'private-access',
    refreshToken: 'private-refresh',
    accessExpiresAt: Date.now() + 3600_000,
  });
  return { sessionId: id, subject };
}
function request(
  path: string,
  id?: string,
  method = 'GET',
  body?: unknown,
  origin: string | null = 'http://localhost:3000',
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      ...(id ? { cookie: `balance_session=${id}` } : {}),
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('durable product data boundaries', () => {
  it('binds policy ownership to the verified subject across new login sessions', async () => {
    const identity = await session();
    const preferences = input().preferences;
    const saved = await writeWorkspace(
      request('/api/workspace', identity.sessionId, 'PUT', { preferences }),
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toContain('no-store');
    const nextLogin = await session(identity.subject);
    const restored = await readWorkspace(request('/api/workspace', nextLogin.sessionId));
    expect(await restored.json()).toMatchObject({ version: 1, preferences });
    const stranger = await session();
    const other = await readWorkspace(request('/api/workspace', stranger.sessionId));
    expect((await other.json()).updatedAt).toBeNull();
  });

  it('generates the saved immutable simulation only from server-loaded brokerage data', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const load = vi.fn().mockResolvedValue(source());
    const plan = await createSavedPlan(identity, input(), {
      store,
      loadPortfolio: load,
      now: () => now,
    });
    expect(load).toHaveBeenCalledWith(identity.sessionId);
    expect(plan).toMatchObject({
      name: 'October rebalance',
      historical: true,
      executable: false,
      status: 'ready',
    });
    expect(plan.result.trades.length).toBeGreaterThan(0);
    expect(plan.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const original = structuredClone(plan);
    plan.result.trades[0].quantity = 99999;
    plan.preferences.targets[0].percent = 0;
    expect(await store.readPlan(identity.subject, plan.id)).toEqual(original);
    const summaries = await store.listPlans(identity.subject);
    expect(summaries[0]).not.toHaveProperty('source');
    expect(summaries[0]).not.toHaveProperty('result');
    expect(summaries[0]).not.toHaveProperty('preferences');
    expect(await store.readPlan('another-user', plan.id)).toBeNull();
    expect(await store.deletePlan('another-user', plan.id)).toBe(false);
    expect(await store.readPlan(identity.subject, plan.id)).not.toBeNull();
  });

  it('uses all current accounts when selection is empty, including a contribution to a real account', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const scenario = input();
    scenario.preferences.selectedAccountIds = [];
    scenario.contributionCents = 50_000;
    scenario.contributionAccountId = source().accounts[0].id;
    const plan = await createSavedPlan(identity, scenario, {
      store,
      loadPortfolio: async () => source(),
      now: () => now,
    });
    expect(plan.source.accounts).toHaveLength(source().accounts.length);
    expect(plan.result.status).toBe('ready');
    expect(plan.contributionAccountId).toBe(scenario.contributionAccountId);
    expect(plan.result.cashBeforeCents).toBe(
      source().accounts.reduce((sum, account) => sum + account.cashCents, 0) + 50_000,
    );
  });

  it('encrypts private policy and plan content with owner-bound authenticated encryption', async () => {
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const first = await session();
    const second = await session();
    const plan = await createSavedPlan(first, input(), {
      store,
      loadPortfolio: async () => source(),
      now: () => now,
    });
    await store.writeWorkspace(first.subject, input().preferences);
    const internals = store as unknown as {
      workspaces: Map<string, string>;
      plans: Map<string, Map<string, string>>;
    };
    const ciphertext = [...internals.plans.values()][0].get(plan.id)!;
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain('"name":"October rebalance"');
    expect(ciphertext).not.toContain('"broker":"Fidelity"');
    await createSavedPlan(second, input(), {
      store,
      loadPortfolio: async () => source(),
      now: () => now,
    });
    const secondOwner = [...internals.plans.keys()][1];
    internals.plans.get(secondOwner)!.set(plan.id, ciphertext);
    await expect(store.readPlan(second.subject, plan.id)).rejects.toThrow();
  });

  it('fingerprints source values and sync times, independently of retrieval order and time', () => {
    const first = source();
    const second = structuredClone(first);
    second.asOf = new Date(now + 60_000).toISOString();
    second.accounts.reverse();
    second.accounts.forEach((account) => account.positions.reverse());
    expect(fingerprintPortfolio(second)).toBe(fingerprintPortfolio(first));
    second.accounts[0].cashCents += 1;
    expect(fingerprintPortfolio(second)).not.toBe(fingerprintPortfolio(first));
  });

  it('labels the saved data with the oldest selected brokerage sync, rather than retrieval time', async () => {
    const portfolio = source();
    portfolio.accounts[0].syncedAt = new Date(now - 3600_000).toISOString();
    const identity = await session();
    const plan = await createSavedPlan(identity, input(), {
      store: new MemoryWorkspaceStore(randomBytes(32)),
      loadPortfolio: async () => portfolio,
      now: () => now,
    });
    expect(plan.asOf).toBe(portfolio.accounts[0].syncedAt);
    expect(plan.source.asOf).toBe(new Date(now).toISOString());
  });

  it('preserves brokerage-verified classifications and tax treatment over stale manual confirmations', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const policy = input();
    policy.preferences.classifications['demo-fidelity:VTI'] = 'bonds';
    policy.preferences.accountTypes['demo-fidelity'] = 'retirement';
    const plan = await createSavedPlan(identity, policy, {
      store,
      loadPortfolio: async () => source(),
      now: () => now,
    });
    expect(
      plan.result.trades.filter(
        (trade) => trade.accountId === 'demo-fidelity' && trade.side === 'sell',
      ),
    ).toHaveLength(0);
    expect(
      plan.result.trades
        .filter((trade) => trade.symbol === 'VTI')
        .every((trade) => trade.assetClass === 'us-equity'),
    ).toBe(true);
  });

  it('rejects stale data and removed account selections without persisting a plan', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const stale = source();
    stale.accounts[0].syncedAt = new Date(now - 25 * 3600_000).toISOString();
    await expect(
      createSavedPlan(identity, input(), {
        store,
        loadPortfolio: async () => stale,
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: 'plan_blocked', status: 422 });
    const missing = input();
    missing.preferences.selectedAccountIds.push('gone');
    await expect(
      createSavedPlan(identity, missing, {
        store,
        loadPortfolio: async () => source(),
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: 'account_unavailable', status: 422 });
    expect(await store.listPlans(identity.subject)).toHaveLength(0);
  });

  it('caps retention at 30 plans without spending further upstream requests', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    const plan = await createSavedPlan(identity, input(), {
      store,
      loadPortfolio: async () => source(),
      now: () => now,
    });
    await Promise.all(
      Array.from({ length: 29 }, () =>
        store.createPlan(identity.subject, { ...plan, id: randomUUID() }),
      ),
    );
    const load = vi.fn().mockResolvedValue(source());
    await expect(
      createSavedPlan(identity, input(), { store, loadPortfolio: load, now: () => now }),
    ).rejects.toMatchObject({ code: 'plan_limit', status: 409 });
    expect(load).not.toHaveBeenCalled();
    expect(await store.listPlans(identity.subject)).toHaveLength(30);
  });

  it('prevents an in-flight plan save from bringing back financial data after deletion', async () => {
    const identity = await session();
    const store = new MemoryWorkspaceStore(randomBytes(32));
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: (portfolio: Portfolio) => void;
    const delayed = new Promise<Portfolio>((resolve) => {
      release = resolve;
    });
    const pending = createSavedPlan(identity, input(), {
      store,
      now: () => now,
      loadPortfolio: async () => {
        started();
        return delayed;
      },
    });
    await fetching;
    await store.deleteWorkspace(identity.subject);
    release(source());
    await expect(pending).rejects.toMatchObject({ code: 'workspace_changed', status: 409 });
    expect(await store.listPlans(identity.subject)).toHaveLength(0);
    await createSavedPlan(identity, input(), {
      store,
      now: () => now,
      loadPortfolio: async () => source(),
    });
    expect(await store.listPlans(identity.subject)).toHaveLength(1);
  });

  it('deletes only the user’s policy and saved financial snapshots, retaining their login session', async () => {
    const identity = await session();
    const other = await session();
    await getWorkspaceStore().writeWorkspace(identity.subject, input().preferences);
    const plan = await createSavedPlan(identity, input(), { now: () => now });
    const otherPlan = await createSavedPlan(other, input(), { now: () => now });
    await getCachedPortfolio(identity.sessionId);
    await getCachedPortfolio(other.sessionId);
    const cache = getPortfolioCache();
    const invalidate = vi.spyOn(cache, 'invalidateOwner');
    const response = await deleteWorkspace(request('/api/workspace', identity.sessionId, 'DELETE'));
    expect(await response.json()).toEqual({ deleted: true });
    expect(invalidate).toHaveBeenCalledWith(identity.subject);
    const entries = (cache as unknown as { entries: Map<string, unknown> }).entries;
    expect(entries.has(hashSecret(identity.sessionId))).toBe(false);
    expect(entries.has(hashSecret(other.sessionId))).toBe(true);
    expect((await getWorkspaceStore().readWorkspace(identity.subject)).updatedAt).toBeNull();
    expect(await getWorkspaceStore().readPlan(identity.subject, plan.id)).toBeNull();
    expect(await getWorkspaceStore().readPlan(other.subject, otherPlan.id)).not.toBeNull();
    expect(await getSessionStore().readSession(identity.sessionId)).not.toBeNull();
    invalidate.mockRestore();
  });

  it('rejects a pending PUT body after workspace deletion instead of restoring preferences', async () => {
    const identity = await session();
    const store = getWorkspaceStore();
    await store.writeWorkspace(identity.subject, input().preferences);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    let ready!: () => void;
    const captured = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const originalGeneration = store.dataGeneration.bind(store);
    const generation = vi.spyOn(store, 'dataGeneration').mockImplementationOnce(async (subject) => {
      const value = await originalGeneration(subject);
      ready();
      return value;
    });
    try {
      const pending = writeWorkspace(
        new NextRequest('http://localhost:3000/api/workspace', {
          method: 'PUT',
          body,
          headers: {
            cookie: `balance_session=${identity.sessionId}`,
            origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
        }),
      );
      await captured;
      const deleted = await deleteWorkspace(
        request('/api/workspace', identity.sessionId, 'DELETE'),
      );
      expect(deleted.status).toBe(200);
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify({ preferences: input().preferences })),
      );
      controller.close();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'workspace_changed' });
      expect((await store.readWorkspace(identity.subject)).updatedAt).toBeNull();
    } finally {
      generation.mockRestore();
    }
  });

  it('reports completed product deletion when cache cleanup fails and cannot reuse the old snapshot', async () => {
    const identity = await session();
    const store = getWorkspaceStore();
    await store.writeWorkspace(identity.subject, input().preferences);
    const plan = await createSavedPlan(identity, input(), { now: () => now });
    await getCachedPortfolio(identity.sessionId);
    const invalidate = vi
      .spyOn(getPortfolioCache(), 'invalidateOwner')
      .mockRejectedValue(new Error('private-database-credentials'));
    try {
      const response = await deleteWorkspace(
        request('/api/workspace', identity.sessionId, 'DELETE'),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deleted).toBe(true);
      expect(body.warning).toContain('Older snapshots are invalidated and cannot be reused');
      expect(body.warning).not.toContain('private-database-credentials');
      expect((await store.readWorkspace(identity.subject)).updatedAt).toBeNull();
      expect(await store.readPlan(identity.subject, plan.id)).toBeNull();
      const changed = source();
      changed.accounts[0].cashCents += 333;
      portfolioLoader.mockResolvedValue(changed);
      const current = await getCachedPortfolio(identity.sessionId);
      expect(current.cache).toBe('miss');
      expect(current.portfolio.accounts[0].cashCents).toBe(changed.accounts[0].cashCents);
    } finally {
      invalidate.mockRestore();
    }
  });

  it('fails closed and retains saved data when product deletion itself fails', async () => {
    const identity = await session();
    const store = getWorkspaceStore();
    await store.writeWorkspace(identity.subject, input().preferences);
    const deletion = vi
      .spyOn(store, 'deleteWorkspace')
      .mockRejectedValue(new Error('Database unavailable'));
    const invalidate = vi.spyOn(getPortfolioCache(), 'invalidateOwner');
    try {
      const response = await deleteWorkspace(
        request('/api/workspace', identity.sessionId, 'DELETE'),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).not.toHaveProperty('deleted');
      expect((await store.readWorkspace(identity.subject)).updatedAt).not.toBeNull();
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      deletion.mockRestore();
      invalidate.mockRestore();
    }
  });
});

describe('workspace and saved-plan HTTP security', () => {
  it('requires authentication for every product read', async () => {
    for (const handler of [readWorkspace, readPlans]) {
      const response = await handler(request('/api/workspace'));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.json()).toMatchObject({ code: 'reconnect_required' });
    }
  });

  it.each([null, 'https://evil.example'])(
    'rejects writes and deletes from origin %s',
    async (origin) => {
      const identity = await session();
      const mutations = [
        writeWorkspace(
          request(
            '/api/workspace',
            identity.sessionId,
            'PUT',
            { preferences: input().preferences },
            origin,
          ),
        ),
        savePlan(request('/api/plans', identity.sessionId, 'POST', input(), origin)),
        deleteWorkspace(request('/api/workspace', identity.sessionId, 'DELETE', undefined, origin)),
        deletePlan(
          request(`/api/plans/${randomUUID()}`, identity.sessionId, 'DELETE', undefined, origin),
          { params: Promise.resolve({ id: randomUUID() }) },
        ),
      ];
      for (const response of await Promise.all(mutations)) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'invalid_origin' });
      }
    },
  );

  it('rejects client-supplied orders before any brokerage request', async () => {
    const identity = await session();
    const response = await savePlan(
      request('/api/plans', identity.sessionId, 'POST', {
        ...input(),
        trades: [{ side: 'buy', quantity: 100 }],
      }),
    );
    expect(response.status).toBe(400);
    expect(portfolioLoader).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies even if the caller omitted Content-Length', async () => {
    const identity = await session();
    const response = await writeWorkspace(
      request('/api/workspace', identity.sessionId, 'PUT', {
        preferences: input().preferences,
        padding: 'x'.repeat(128_000),
      }),
    );
    expect(response.status).toBe(413);
  });

  it('returns generic not-found for another user’s saved plan and blocks deletion', async () => {
    const owner = await session();
    const other = await session();
    const plan = await createSavedPlan(owner, input(), { now: () => now });
    const response = await readPlans(request(`/api/plans?id=${plan.id}`, other.sessionId));
    expect(response.status).toBe(404);
    const deleted = await deletePlan(request(`/api/plans/${plan.id}`, other.sessionId, 'DELETE'), {
      params: Promise.resolve({ id: plan.id }),
    });
    expect(deleted.status).toBe(404);
    expect(await getWorkspaceStore().readPlan(owner.subject, plan.id)).not.toBeNull();
  });

  it('saves and returns a server-generated plan, then lists only metadata and deletes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const identity = await session();
    const scenario = input();
    scenario.preferences.selectedAccountIds = [];
    scenario.contributionCents = 50_000;
    scenario.contributionAccountId = source().accounts[0].id;
    const response = await savePlan(request('/api/plans', identity.sessionId, 'POST', scenario));
    expect(response.status).toBe(201);
    const { plan } = (await response.json()) as { plan: SavedPlan };
    expect(plan).toMatchObject({ historical: true, executable: false });
    expect(plan.source.accounts).toHaveLength(source().accounts.length);
    const list = await readPlans(request('/api/plans', identity.sessionId));
    expect((await list.json()).plans[0]).not.toHaveProperty('result');
    const detail = await readPlans(request(`/api/plans?id=${plan.id}`, identity.sessionId));
    expect((await detail.json()).plan).toEqual(plan);
    const deletion = await deletePlan(
      request(`/api/plans/${plan.id}`, identity.sessionId, 'DELETE'),
      { params: Promise.resolve({ id: plan.id }) },
    );
    expect(deletion.status).toBe(200);
    expect(await getWorkspaceStore().readPlan(identity.subject, plan.id)).toBeNull();
  });
});
