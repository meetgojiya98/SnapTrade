import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from './config';
import { pkceChallenge, randomSecret } from './crypto';
import type { Fetcher } from './http';
import { OAuthService } from './oauth';
import { MemorySessionStore, type Session } from './store';

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keyPair = await generateKeyPair('RS256');
  jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'current-key', alg: 'RS256', use: 'sig' };
});
const config: ServerConfig = {
  clientId: 'app-client',
  clientSecret: 'client-secret',
  appUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/api/auth/callback',
  encryptionKey: randomBytes(32),
  memoryStore: true,
  secureCookies: false,
};
const metadata = {
  issuer: 'https://api.snaptrade.com',
  authorization_endpoint: 'https://dashboard.snaptrade.com/oauth/authorize',
  token_endpoint: 'https://api.snaptrade.com/oauth/token/',
  revocation_endpoint: 'https://api.snaptrade.com/oauth/revoke_token/',
  jwks_uri: 'https://api.snaptrade.com/.well-known/jwks.json',
  code_challenge_methods_supported: ['S256'],
  id_token_signing_alg_values_supported: ['RS256'],
};
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const token = {
  access_token: 'access-first',
  refresh_token: 'refresh-first',
  expires_in: 36000,
  token_type: 'Bearer',
  scope: 'openid read',
};
const stored: Session = {
  accessToken: token.access_token,
  refreshToken: token.refresh_token,
  accessExpiresAt: Date.now() + 60_000 * 10,
  subject: 'user-id',
  scope: token.scope,
};

async function signed(
  nonce: string,
  options: { audience?: string; issuedAt?: number; expiresAt?: number } = {},
) {
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'current-key' })
    .setIssuer(metadata.issuer)
    .setAudience(options.audience ?? config.clientId)
    .setSubject('verified-personal-user')
    .setIssuedAt(options.issuedAt ?? Math.floor(Date.now() / 1000))
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300)
    .sign(keyPair.privateKey);
}

function harness(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const store = new MemorySessionStore(config.encryptionKey);
  const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('openid-configuration')) return json(metadata);
    if (url.endsWith('jwks.json')) return json({ keys: [jwk] });
    return handler(url, init);
  });
  return { store, fetcher, service: new OAuthService(config, store, fetcher as Fetcher) };
}

describe('SnapTrade OAuth integration', () => {
  it('uses read-only scope, PKCE, verified OIDC identity, and single-use browser-bound state', async () => {
    let authorization: URL;
    const { service, store, fetcher } = harness(async (url, init) => {
      expect(url).toBe(metadata.token_endpoint);
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Basic ${Buffer.from('app-client:client-secret').toString('base64')}`,
      );
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('redirect_uri')).toBe(config.redirectUri);
      expect(pkceChallenge(body.get('code_verifier')!)).toBe(
        authorization.searchParams.get('code_challenge'),
      );
      return json({ ...token, id_token: await signed(authorization.searchParams.get('nonce')!) });
    });
    const login = await service.beginLogin();
    authorization = new URL(login.url);
    expect(authorization.searchParams.get('scope')).toBe('openid read');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = {
      state: authorization.searchParams.get('state'),
      browser: login.browser,
      code: 'one-time-code',
      issuer: metadata.issuer,
      error: null,
    };
    const id = await service.finishLogin(callback);
    const session = await store.readSession(id);
    expect(session?.subject).toBe('verified-personal-user');
    expect(session).not.toHaveProperty('id_token');
    await expect(service.finishLogin(callback)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(
      fetcher.mock.calls.filter(([url]) => String(url) === metadata.token_endpoint),
    ).toHaveLength(1);
  });
  it('rejects browser mismatch before exchanging a code', async () => {
    const { service, fetcher } = harness(async () => {
      throw new Error('Should not exchange');
    });
    const login = await service.beginLogin();
    await expect(
      service.finishLogin({
        state: new URL(login.url).searchParams.get('state'),
        browser: randomSecret(),
        code: 'code',
        issuer: null,
        error: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('consumes denied authorization attempts without exchanging a code', async () => {
    const { service, fetcher } = harness(async () => {
      throw new Error('Should not exchange');
    });
    const login = await service.beginLogin();
    const callback = {
      state: new URL(login.url).searchParams.get('state'),
      browser: login.browser,
      code: null,
      issuer: null,
      error: 'access_denied',
    };
    await expect(service.finishLogin(callback)).rejects.toMatchObject({ code: 'access_denied' });
    await expect(
      service.finishLogin({ ...callback, code: 'code', error: null }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['nonce', 'audience', 'old-issued-at', 'expired', 'signature'] as const)(
    'rejects an ID token with invalid %s',
    async (failure) => {
      let nonce = '';
      const { service, store } = harness(async () => {
        let idToken = await signed(failure === 'nonce' ? 'different-nonce' : nonce, {
          audience: failure === 'audience' ? 'another-client' : undefined,
          issuedAt: failure === 'old-issued-at' ? Math.floor(Date.now() / 1000) - 3600 : undefined,
          expiresAt: failure === 'expired' ? Math.floor(Date.now() / 1000) - 60 : undefined,
        });
        if (failure === 'signature') {
          const fields = idToken.split('.');
          const bytes = Buffer.from(fields[2], 'base64url');
          bytes[0] ^= 1;
          fields[2] = bytes.toString('base64url');
          idToken = fields.join('.');
        }
        return json({ ...token, id_token: idToken });
      });
      const login = await service.beginLogin();
      const query = new URL(login.url).searchParams;
      nonce = query.get('nonce')!;
      await expect(
        service.finishLogin({
          state: query.get('state'),
          browser: login.browser,
          code: 'code',
          issuer: null,
          error: null,
        }),
      ).rejects.toMatchObject({ code: 'invalid_id_token' });
      expect(await store.readSession('not-created')).toBeNull();
    },
  );
  it('serializes concurrent refreshes and persists the rotated token atomically', async () => {
    let refreshes = 0;
    const { service, store } = harness(async (url, init) => {
      expect(url).toBe(metadata.token_endpoint);
      expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('refresh-first');
      refreshes++;
      await Promise.resolve();
      return json({ ...token, access_token: 'access-rotated', refresh_token: 'refresh-rotated' });
    });
    const id = randomSecret();
    await store.createSession(id, { ...stored, accessExpiresAt: Date.now() - 1 });
    expect(await Promise.all(Array.from({ length: 8 }, () => service.getAccessToken(id)))).toEqual(
      Array(8).fill('access-rotated'),
    );
    expect(refreshes).toBe(1);
    expect((await store.readSession(id))?.refreshToken).toBe('refresh-rotated');
  });
  it('refreshes once after a 401 and clears the session if the retry is rejected', async () => {
    let calls = 0;
    let refreshes = 0;
    const { service, store } = harness(async (url) => {
      if (url === metadata.token_endpoint) {
        refreshes++;
        return json({ ...token, access_token: 'access-rotated', refresh_token: 'refresh-rotated' });
      }
      calls++;
      return json({}, 401);
    });
    const id = randomSecret();
    await store.createSession(id, stored);
    await expect(service.api(id, '/accounts/all')).rejects.toMatchObject({
      code: 'reconnect_required',
    });
    expect(calls).toBe(2);
    expect(refreshes).toBe(1);
    expect(await store.readSession(id)).toBeNull();
  });
  it('does not retry a 429 or destroy a usable refresh token', async () => {
    const { service, store, fetcher } = harness(async () => json({}, 429, { 'Retry-After': '60' }));
    const id = randomSecret();
    await store.createSession(id, { ...stored, accessExpiresAt: Date.now() - 1 });
    await expect(service.getAccessToken(id)).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: '60',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await store.readSession(id))?.refreshToken).toBe('refresh-first');
  });
  it('deletes local credentials even when remote revocation is unavailable', async () => {
    const { service, store } = harness(async () => json({}, 503));
    const id = randomSecret();
    await store.createSession(id, stored);
    expect(await service.disconnect(id)).toEqual({ revoked: false });
    expect(await store.readSession(id)).toBeNull();
  });
});
