import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import type { Portfolio } from '@/lib/types';
import { hashSecret, randomSecret } from './crypto';
import { ServiceError } from './errors';
import {
  getCachedPortfolio,
  MemoryPortfolioCache,
  PORTFOLIO_CACHE_TTL_MS,
} from './portfolio-cache';
import { getSessionStore, MemorySessionStore } from './store';
import { GET as portfolioRoute } from '@/app/api/portfolio/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { getOAuthService } from './oauth';
import { getPortfolioCache } from './portfolio-cache';

const { apiPortfolioLoader } = vi.hoisted(() => ({ apiPortfolioLoader: vi.fn() }));
vi.mock('@/lib/server/portfolio', () => ({ loadPortfolio: apiPortfolioLoader }));

async function fixture() {
  const key = randomBytes(32);
  let now = Date.now();
  let generation = 0;
  const sessions = new MemorySessionStore(key, () => now);
  const cache = new MemoryPortfolioCache(
    key,
    async () => generation,
    () => now,
  );
  const id = randomSecret();
  const credentials = {
    subject: 'verified-person',
    accessToken: 'access',
    refreshToken: 'refresh',
    accessExpiresAt: now + 3600_000,
    scope: 'openid read',
  };
  await sessions.createSession(id, credentials);
  const portfolio = { ...makeDemoPortfolio(), mode: 'live' as const };
  const load = vi.fn().mockImplementation(async () => structuredClone(portfolio));
  const read = (sessionId = id) => getCachedPortfolio(sessionId, { sessions, cache, load });
  return {
    cache,
    sessions,
    id,
    credentials,
    portfolio,
    load,
    read,
    advance: (ms: number) => {
      now += ms;
    },
    deleteGeneration: () => {
      generation++;
    },
  };
}

describe('authenticated encrypted portfolio cache', () => {
  it('serves the unchanged portfolio contract with private cache headers and authenticates hits', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
    vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'secret');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_STORE', 'memory');
    try {
      const id = randomSecret();
      await getSessionStore().createSession(id, {
        subject: 'verified-person',
        accessToken: 'access',
        refreshToken: 'refresh',
        scope: 'openid read',
        accessExpiresAt: Date.now() + 3600_000,
      });
      const portfolio = { ...makeDemoPortfolio(), mode: 'live' as const };
      apiPortfolioLoader.mockReset();
      apiPortfolioLoader.mockResolvedValue(portfolio);
      const request = () =>
        new NextRequest('http://localhost:3000/api/portfolio', {
          headers: { cookie: `balance_session=${id}` },
        });
      const first = await portfolioRoute(request());
      expect(first.status).toBe(200);
      expect(first.headers.get('x-snapshot-cache')).toBe('miss');
      expect(first.headers.get('cache-control')).toContain('no-store');
      expect(await first.json()).toEqual(portfolio);
      const second = await portfolioRoute(request());
      expect(second.headers.get('x-snapshot-cache')).toBe('hit');
      expect(apiPortfolioLoader).toHaveBeenCalledTimes(1);
      await getSessionStore().deleteSession(id);
      const revoked = await portfolioRoute(request());
      expect(revoked.status).toBe(401);
      expect((await revoked.json()).code).toBe('reconnect_required');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('purges the session snapshot through logout after local credentials have been revoked', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
    vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'secret');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_STORE', 'memory');
    try {
      const id = randomSecret();
      const sessions = getSessionStore();
      await sessions.createSession(id, {
        subject: 'verified-person',
        accessToken: 'access',
        refreshToken: 'refresh',
        scope: 'openid read',
        accessExpiresAt: Date.now() + 3600_000,
      });
      apiPortfolioLoader.mockReset();
      apiPortfolioLoader.mockResolvedValue({ ...makeDemoPortfolio(), mode: 'live' });
      await getCachedPortfolio(id);
      const cache = getPortfolioCache();
      const originalInvalidate = cache.invalidateSession.bind(cache);
      const invalidate = vi
        .spyOn(cache, 'invalidateSession')
        .mockImplementation(async (sessionId) => {
          expect(await sessions.readSession(sessionId)).toBeNull();
          return originalInvalidate(sessionId);
        });
      vi.spyOn(getOAuthService(), 'disconnect').mockImplementation(async (sessionId) => {
        await sessions.deleteSession(sessionId);
        return { revoked: false };
      });
      const response = await logoutRoute(
        new NextRequest('http://localhost:3000/api/auth/logout', {
          method: 'POST',
          headers: { cookie: `balance_session=${id}`, origin: 'http://localhost:3000' },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ disconnected: true, revoked: false });
      expect(invalidate).toHaveBeenCalledWith(id);
      expect(
        (cache as unknown as { entries: Map<string, unknown> }).entries.has(hashSecret(id)),
      ).toBe(false);
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
  it('coalesces concurrent reads and returns independent copies for cache hits', async () => {
    const test = await fixture();
    const responses = await Promise.all(Array.from({ length: 8 }, () => test.read()));
    expect(test.load).toHaveBeenCalledTimes(1);
    expect(responses.filter((result) => result.cache === 'miss')).toHaveLength(1);
    expect(responses.filter((result) => result.cache === 'hit')).toHaveLength(7);
    responses[0].portfolio.accounts[0].cashCents = 999999;
    expect((await test.read()).portfolio).toEqual(test.portfolio);
  });

  it.each([false, true])(
    'clears cookies and reports disconnection when snapshot cleanup fails (revoked=%s)',
    async (revoked) => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
      vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'secret');
      vi.stubEnv('APP_URL', 'http://localhost:3000');
      vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('SESSION_STORE', 'memory');
      try {
        const id = randomSecret();
        const sessions = getSessionStore();
        await sessions.createSession(id, {
          subject: 'verified-person',
          accessToken: 'access',
          refreshToken: 'refresh',
          scope: 'openid read',
          accessExpiresAt: Date.now() + 3600_000,
        });
        apiPortfolioLoader.mockResolvedValue({ ...makeDemoPortfolio(), mode: 'live' });
        await getCachedPortfolio(id);
        vi.spyOn(getPortfolioCache(), 'invalidateSession').mockRejectedValue(
          new Error('private-database-credentials'),
        );
        vi.spyOn(getOAuthService(), 'disconnect').mockImplementation(async (sessionId) => {
          await sessions.deleteSession(sessionId);
          return { revoked };
        });
        const response = await logoutRoute(
          new NextRequest('http://localhost:3000/api/auth/logout', {
            method: 'POST',
            headers: { cookie: `balance_session=${id}`, origin: 'http://localhost:3000' },
          }),
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ disconnected: true, revoked });
        expect(body.warning).toContain(
          'Cleanup of the encrypted temporary snapshot could not be confirmed',
        );
        expect(body.warning).not.toContain('private-database-credentials');
        if (!revoked) expect(body.warning).toContain('Remove this app in your SnapTrade dashboard');
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
        expect(response.headers.get('set-cookie')).toContain('HttpOnly');
        await expect(getCachedPortfolio(id)).rejects.toMatchObject({
          code: 'reconnect_required',
          status: 401,
        });
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    },
  );

  it('expires at exactly 45 seconds and fetches new brokerage data', async () => {
    const test = await fixture();
    await test.read();
    test.advance(PORTFOLIO_CACHE_TTL_MS - 1);
    expect((await test.read()).cache).toBe('hit');
    test.advance(1);
    test.portfolio.accounts[0].cashCents += 10;
    const result = await test.read();
    expect(result.cache).toBe('miss');
    expect(result.portfolio).toEqual(test.portfolio);
    expect(test.load).toHaveBeenCalledTimes(2);
  });

  it('keys snapshots by the opaque session, even for the same verified subject', async () => {
    const test = await fixture();
    await test.read();
    const otherGrant = randomSecret();
    await test.sessions.createSession(otherGrant, test.credentials);
    expect((await test.read(otherGrant)).cache).toBe('miss');
    expect(test.load).toHaveBeenCalledTimes(2);
  });

  it('authenticates every cache hit and rejects revoked, expired, or malformed sessions', async () => {
    const test = await fixture();
    await test.read();
    await test.sessions.deleteSession(test.id);
    await expect(test.read()).rejects.toMatchObject({ code: 'reconnect_required', status: 401 });
    await expect(test.read('fabricated-session')).rejects.toMatchObject({
      code: 'reconnect_required',
    });
    await test.sessions.createSession(test.id, test.credentials);
    test.advance(8 * 24 * 3600_000);
    await expect(test.read()).rejects.toMatchObject({ code: 'reconnect_required' });
    expect(test.load).toHaveBeenCalledTimes(1);
  });

  it('never falls back to an expired snapshot on upstream rate limits or errors', async () => {
    const test = await fixture();
    await test.read();
    test.advance(PORTFOLIO_CACHE_TTL_MS);
    test.load.mockRejectedValueOnce(new ServiceError('rate_limited', 429, 'Try again.', '60'));
    await expect(test.read()).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfter: '60',
    });
    test.load.mockRejectedValueOnce(new ServiceError('reconnect_required', 401));
    await expect(test.read()).rejects.toMatchObject({ code: 'reconnect_required', status: 401 });
    expect((await test.read()).cache).toBe('miss');
  });

  it('uses authenticated encryption bound to both session and owner hashes', async () => {
    const test = await fixture();
    await test.read();
    const internals = test.cache as unknown as {
      entries: Map<
        string,
        { owner: string; payload: string; expiresAt: number; generation: number; epoch: number }
      >;
    };
    const entry = internals.entries.get(hashSecret(test.id))!;
    expect(entry.payload).toMatch(/^v1\./);
    expect(entry.payload).not.toContain('"broker":"Fidelity"');
    expect(entry.payload).not.toContain('"symbol":"VTI"');
    const another = randomSecret();
    await test.sessions.createSession(another, test.credentials);
    internals.entries.set(hashSecret(another), entry);
    await expect(test.read(another)).rejects.toThrow();
  });

  it('does not reuse cached data when a session has a different verified subject', async () => {
    const test = await fixture();
    await test.read();
    await test.sessions.createSession(test.id, {
      ...test.credentials,
      subject: 'different-person',
    });
    expect((await test.read()).cache).toBe('miss');
    expect(test.load).toHaveBeenCalledTimes(2);
  });

  it('prevents a pending fetch from writing a cache after session revocation', async () => {
    const test = await fixture();
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: (value: Portfolio) => void;
    const delayed = new Promise<Portfolio>((resolve) => {
      release = resolve;
    });
    test.load.mockImplementationOnce(async () => {
      started();
      return delayed;
    });
    const pending = test.read();
    await fetching;
    await test.sessions.deleteSession(test.id);
    const invalidating = test.cache.invalidateSession(test.id);
    release(test.portfolio);
    await expect(pending).rejects.toMatchObject({ code: 'reconnect_required' });
    await invalidating;
    const internals = test.cache as unknown as { entries: Map<string, unknown> };
    expect(internals.entries.size).toBe(0);
  });

  it('waits for a pending session fetch before invalidating its result', async () => {
    const test = await fixture();
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: (value: Portfolio) => void;
    const delayed = new Promise<Portfolio>((resolve) => {
      release = resolve;
    });
    test.load.mockImplementationOnce(async () => {
      started();
      return delayed;
    });
    const pending = test.read();
    await fetching;
    const invalidating = test.cache.invalidateSession(test.id);
    release(test.portfolio);
    await pending;
    await invalidating;
    expect((await test.read()).cache).toBe('miss');
  });

  it('invalidates all grants for an owner without affecting another user', async () => {
    const test = await fixture();
    const samePerson = randomSecret();
    const otherPerson = randomSecret();
    await test.sessions.createSession(samePerson, test.credentials);
    await test.sessions.createSession(otherPerson, {
      ...test.credentials,
      subject: 'someone-else',
    });
    await Promise.all([test.read(), test.read(samePerson), test.read(otherPerson)]);
    await test.cache.invalidateOwner(test.credentials.subject);
    expect((await test.read()).cache).toBe('miss');
    expect((await test.read(samePerson)).cache).toBe('miss');
    expect((await test.read(otherPerson)).cache).toBe('hit');
  });

  it.each(['owner invalidation', 'workspace generation'])(
    'does not restore cache data after %s during a fetch',
    async (kind) => {
      const test = await fixture();
      let started!: () => void;
      const fetching = new Promise<void>((resolve) => {
        started = resolve;
      });
      let release!: (value: Portfolio) => void;
      const delayed = new Promise<Portfolio>((resolve) => {
        release = resolve;
      });
      test.load.mockImplementationOnce(async () => {
        started();
        return delayed;
      });
      const pending = test.read();
      await fetching;
      if (kind === 'owner invalidation') await test.cache.invalidateOwner(test.credentials.subject);
      else test.deleteGeneration();
      release(test.portfolio);
      expect((await pending).cache).toBe('miss');
      expect((await test.read()).cache).toBe('miss');
    },
  );
});
