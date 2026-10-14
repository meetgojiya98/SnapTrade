import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import { defaultWorkspacePreferences } from '@/lib/workspace';
import { POST as signOut } from '@/app/api/auth/signout/route';
import { GET as readWorkspace } from '@/app/api/workspace/route';
import { randomSecret } from './crypto';
import { getOAuthService } from './oauth';
import { getCachedPortfolio, getPortfolioCache } from './portfolio-cache';
import { cookieNames } from './routes';
import { getSessionStore } from './store';
import { createSavedPlan } from './workspace';
import { getWorkspaceStore } from './workspace-store';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
  vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'private-client-secret');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SESSION_STORE', 'memory');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const credentials = () => ({
  subject: 'verified-person',
  scope: 'openid read',
  accessToken: 'private-access-token',
  refreshToken: 'private-refresh-token',
  accessExpiresAt: Date.now() + 3600_000,
});
function request(id?: string, origin: string | null = 'http://localhost:3000') {
  const appUrl = process.env.APP_URL!;
  const names = cookieNames();
  return new NextRequest(`${appUrl}/api/auth/signout`, {
    method: 'POST',
    headers: {
      ...(id ? { cookie: `${names.session}=${id}; ${names.login}=${randomSecret()}` } : {}),
      ...(origin ? { origin } : {}),
    },
  });
}

describe('ordinary sign out', () => {
  it('deletes only the current session and snapshot, preserving provider access and saved work', async () => {
    const id = randomSecret();
    const anotherId = randomSecret();
    const session = credentials();
    const sessions = getSessionStore();
    await sessions.createSession(id, session);
    await sessions.createSession(anotherId, session);
    const portfolio = { ...makeDemoPortfolio(), mode: 'live' as const };
    const load = vi.fn().mockResolvedValue(portfolio);
    const store = getWorkspaceStore();
    const preferences = structuredClone(defaultWorkspacePreferences);
    const workspace = await store.writeWorkspace(session.subject, preferences);
    const plan = await createSavedPlan(
      { sessionId: id, subject: session.subject },
      { name: 'Preserved plan', preferences, contributionCents: 0, contributionAccountId: null },
      { loadPortfolio: load },
    );
    await getCachedPortfolio(id, { load });
    await getCachedPortfolio(anotherId, { load });
    expect((await getCachedPortfolio(id, { load })).cache).toBe('hit');
    const disconnect = vi.spyOn(getOAuthService(), 'disconnect');
    const fetcher = vi.fn().mockRejectedValue(new Error('Provider access is not needed'));
    vi.stubGlobal('fetch', fetcher);

    const response = await signOut(request(id));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await sessions.readSession(id)).toBeNull();
    expect(await sessions.readSession(anotherId)).toEqual(session);
    await expect(getCachedPortfolio(id, { load })).rejects.toMatchObject({
      code: 'reconnect_required',
      status: 401,
    });
    expect(
      (
        await readWorkspace(
          new NextRequest('http://localhost:3000/api/workspace', {
            headers: { cookie: `balance_session=${id}` },
          }),
        )
      ).status,
    ).toBe(401);
    expect(await store.readWorkspace(session.subject)).toEqual(workspace);
    expect(await store.readPlan(session.subject, plan.id)).toEqual(plan);
    expect((await getCachedPortfolio(anotherId, { load })).cache).toBe('hit');
    // Reusing the old ID here only inspects whether its encrypted snapshot was removed.
    await sessions.createSession(id, session);
    expect((await getCachedPortfolio(id, { load })).cache).toBe('miss');
    expect(disconnect).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:3000', 'https://balance.example'])(
    'expires both app authentication cookies with their original security attributes on %s',
    async (appUrl) => {
      vi.stubEnv('APP_URL', appUrl);
      const response = await signOut(request(undefined, appUrl));
      expect(response.status).toBe(200);
      const names = cookieNames();
      for (const name of [names.session, names.login]) {
        expect(response.cookies.get(name)).toMatchObject({
          name,
          value: '',
          maxAge: 0,
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: appUrl.startsWith('https:'),
        });
      }
    },
  );

  it.each([undefined, 'malformed-cookie', 'stale-session'])(
    'is idempotent without an active session (%s)',
    async (state) => {
      const id = state === 'stale-session' ? randomSecret() : state;
      const disconnect = vi.spyOn(getOAuthService(), 'disconnect');
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await signOut(request(id));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ signedOut: true });
        expect(response.cookies.get(cookieNames().session)?.maxAge).toBe(0);
        expect(response.cookies.get(cookieNames().login)?.maxAge).toBe(0);
      }
      expect(disconnect).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'null', 'https://evil.example', 'http://localhost:3000.evil.example'])(
    'rejects an invalid Origin %s before changing credentials or cookies',
    async (origin) => {
      const id = randomSecret();
      const sessions = getSessionStore();
      const session = credentials();
      await sessions.createSession(id, session);
      const deleting = vi.spyOn(sessions, 'deleteSession');
      const invalidating = vi.spyOn(getPortfolioCache(), 'invalidateSession');
      const response = await signOut(request(id, origin));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'invalid_origin' });
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(await sessions.readSession(id)).toEqual(session);
      expect(deleting).not.toHaveBeenCalled();
      expect(invalidating).not.toHaveBeenCalled();
    },
  );

  it('returns a safe retryable failure and retains cookies when session deletion fails', async () => {
    const id = randomSecret();
    const sessions = getSessionStore();
    const session = credentials();
    await sessions.createSession(id, session);
    vi.spyOn(sessions, 'deleteSession').mockRejectedValue(
      new Error('private-database-credentials private-access-token'),
    );
    const invalidating = vi.spyOn(getPortfolioCache(), 'invalidateSession');
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await signOut(request(id));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'service_unavailable' });
    expect(body).not.toHaveProperty('signedOut');
    expect(JSON.stringify(body)).not.toContain('private-');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await sessions.readSession(id)).toEqual(session);
    expect(invalidating).not.toHaveBeenCalled();
  });

  it('confirms sign out with a safe warning if snapshot cleanup fails after session deletion', async () => {
    const id = randomSecret();
    const sessions = getSessionStore();
    await sessions.createSession(id, credentials());
    vi.spyOn(getPortfolioCache(), 'invalidateSession').mockImplementation(async () => {
      expect(await sessions.readSession(id)).toBeNull();
      throw new Error('private-database-credentials private-refresh-token');
    });
    const response = await signOut(request(id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ signedOut: true });
    expect(body.warning).toContain('Your ended session cannot access it.');
    expect(JSON.stringify(body)).not.toContain('private-');
    expect(response.cookies.get(cookieNames().session)?.maxAge).toBe(0);
    expect(response.cookies.get(cookieNames().login)?.maxAge).toBe(0);
    await expect(getCachedPortfolio(id)).rejects.toMatchObject({
      code: 'reconnect_required',
      status: 401,
    });
  });
});
