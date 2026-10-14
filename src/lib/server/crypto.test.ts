import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, pkceChallenge, randomSecret, validSecret } from './crypto';
import { LOGIN_TTL_MS, MemorySessionStore, SESSION_TTL_MS, type Session } from './store';

const session: Session = {
  accessToken: 'secret-access',
  refreshToken: 'secret-refresh',
  accessExpiresAt: Date.now() + 60_000,
  subject: 'personal-user',
  scope: 'openid read',
};

describe('session encryption and PKCE', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('encrypts with a unique nonce and authenticates the row context', () => {
    const key = randomBytes(32);
    const encrypted = encryptJson(session, key, 'session:first');
    expect(encrypted).not.toContain('"accessToken":"secret-access"');
    expect(encryptJson(session, key, 'session:first')).not.toBe(encrypted);
    expect(decryptJson(encrypted, key, 'session:first')).toEqual(session);
    expect(() => decryptJson(encrypted, key, 'session:second')).toThrow();
    expect(() => decryptJson(encrypted, randomBytes(32), 'session:first')).toThrow();
    const fields = encrypted.split('.');
    const tampered = Buffer.from(fields[3], 'base64url');
    tampered[0] ^= 1;
    fields[3] = tampered.toString('base64url');
    expect(() => decryptJson(fields.join('.'), key, 'session:first')).toThrow();
  });
  it('only accepts opaque 256-bit browser secrets', () => {
    expect(validSecret(randomSecret())).toBe(true);
    expect(validSecret('session-from-user')).toBe(false);
    expect(validSecret(null)).toBe(false);
  });
});

describe('one-time state and local session adapter', () => {
  it('binds login state to its browser and consumes it once', async () => {
    const store = new MemorySessionStore(randomBytes(32));
    const attempt = { verifier: randomSecret(), nonce: randomSecret() };
    await store.putLogin('state', 'browser', attempt);
    expect(await store.consumeLogin('state', 'another-browser')).toBeNull();
    const results = await Promise.all([
      store.consumeLogin('state', 'browser'),
      store.consumeLogin('state', 'browser'),
    ]);
    expect(results.filter(Boolean)).toEqual([attempt]);
  });
  it('expires attempts and sessions without extending the absolute session lifetime', async () => {
    let now = 1000;
    const store = new MemorySessionStore(randomBytes(32), () => now);
    await store.putLogin('state', 'browser', { verifier: 'verifier', nonce: 'nonce' });
    await store.createSession('session', session);
    now += LOGIN_TTL_MS;
    expect(await store.consumeLogin('state', 'browser')).toBeNull();
    await store.withSession('session', async (current) => ({ session: current, value: undefined }));
    now = 1000 + SESSION_TTL_MS;
    expect(await store.readSession('session')).toBeNull();
  });
  it('serializes refresh-token rotation and deletion', async () => {
    const store = new MemorySessionStore(randomBytes(32));
    await store.createSession('session', session);
    const seen: string[] = [];
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        store.withSession('session', async (current) => {
          seen.push(current!.refreshToken);
          await Promise.resolve();
          return { session: { ...current!, refreshToken: `rotated-${index}` }, value: undefined };
        }),
      ),
    );
    expect(seen).toEqual(['secret-refresh', 'rotated-0', 'rotated-1', 'rotated-2', 'rotated-3']);
    await store.deleteSession('session');
    expect(await store.readSession('session')).toBeNull();
  });
});
