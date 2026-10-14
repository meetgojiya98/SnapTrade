import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import type { Portfolio } from '@/lib/types';
import { hashSecret, randomSecret } from './crypto';
import { ServiceError } from './errors';
import { getCachedPortfolio, PostgresPortfolioCache } from './portfolio-cache';
import { MemorySessionStore } from './store';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('portfolio cache (Postgres integration)', () => {
  const key = randomBytes(32);
  const users: string[] = [];
  const sessions: string[] = [];
  let firstSql: ReturnType<typeof postgres>;
  let secondSql: ReturnType<typeof postgres>;
  let first: PostgresPortfolioCache;
  let second: PostgresPortfolioCache;
  const portfolio = () => ({ ...makeDemoPortfolio(), mode: 'live' as const });
  const verify = async () => {};
  const owner = (subject: string) => hashSecret(`balance:subject:${subject}`);
  function identity() {
    const id = randomSecret();
    const subject = randomUUID();
    sessions.push(id);
    users.push(subject);
    return { id, subject };
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/balance_test')
    )
      throw new Error(
        'Integration tests require a loopback Postgres database named balance_test*.',
      );
    firstSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    secondSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    for (const migration of ['002_product.sql', '003_portfolio_cache.sql'])
      await firstSql.unsafe(
        await readFile(new URL(`../../../migrations/${migration}`, import.meta.url), 'utf8'),
      );
    first = new PostgresPortfolioCache(firstSql, key);
    second = new PostgresPortfolioCache(secondSql, key);
  });
  afterAll(async () => {
    if (!firstSql) return;
    for (const id of sessions)
      await firstSql`DELETE FROM balance_portfolio_cache WHERE id_hash = ${hashSecret(id)}`;
    for (const subject of users)
      await firstSql`DELETE FROM balance_workspace_generations WHERE owner_hash = ${owner(subject)}`;
    await Promise.all([firstSql.end(), secondSql.end()]);
  });

  it('coalesces upstream reads across independent server connections', async () => {
    const user = identity();
    const load = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return portfolio();
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).readThrough(user.id, user.subject, load, verify),
      ),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.cache === 'miss')).toHaveLength(1);
    expect(results.filter((result) => result.cache === 'hit')).toHaveLength(7);
  });

  it('persists ciphertext bound to the session and owner, rather than financial plaintext', async () => {
    const user = identity();
    const source = portfolio();
    await first.readThrough(user.id, user.subject, async () => source, verify);
    const [row] =
      await firstSql`SELECT id_hash, owner_hash, payload FROM balance_portfolio_cache WHERE id_hash = ${hashSecret(user.id)}`;
    expect(row.id_hash).not.toBe(user.id);
    expect(row.owner_hash).not.toBe(user.subject);
    expect(row.payload).toMatch(/^v1\./);
    expect(row.payload).not.toContain('"broker":"Fidelity"');
    expect(row.payload).not.toContain('"symbol":"VTI"');
    const restored = await second.readThrough(
      user.id,
      user.subject,
      async () => {
        throw new Error('Unexpected fetch');
      },
      verify,
    );
    expect(restored).toEqual({ portfolio: source, cache: 'hit' });
    const another = identity();
    await second.readThrough(another.id, another.subject, async () => portfolio(), verify);
    await firstSql`UPDATE balance_portfolio_cache SET payload = ${row.payload} WHERE id_hash = ${hashSecret(another.id)}`;
    await expect(
      second.readThrough(another.id, another.subject, async () => portfolio(), verify),
    ).rejects.toThrow();
  });

  it('does not share grants for the same owner and invalidates all of that owner’s grants', async () => {
    const user = identity();
    const anotherGrant = identity();
    const stranger = identity();
    const load = vi.fn().mockImplementation(async () => portfolio());
    await first.readThrough(user.id, user.subject, load, verify);
    await second.readThrough(anotherGrant.id, user.subject, load, verify);
    await first.readThrough(stranger.id, stranger.subject, load, verify);
    expect(load).toHaveBeenCalledTimes(3);
    await second.invalidateOwner(user.subject);
    const rows =
      await firstSql`SELECT id_hash FROM balance_portfolio_cache WHERE owner_hash = ${owner(user.subject)}`;
    expect(rows).toHaveLength(0);
    expect((await first.readThrough(stranger.id, stranger.subject, load, verify)).cache).toBe(
      'hit',
    );
  });

  it('propagates upstream errors instead of returning an expired snapshot', async () => {
    const user = identity();
    await first.readThrough(user.id, user.subject, async () => portfolio(), verify);
    await firstSql`UPDATE balance_portfolio_cache SET expires_at = now() - interval '1 second' WHERE id_hash = ${hashSecret(user.id)}`;
    await expect(
      second.readThrough(
        user.id,
        user.subject,
        async () => {
          throw new ServiceError('rate_limited', 429, 'Wait.', '60');
        },
        verify,
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: '60' });
    expect(
      (await first.readThrough(user.id, user.subject, async () => portfolio(), verify)).cache,
    ).toBe('miss');
  });

  it('honors the 45-second TTL on a different server instance', async () => {
    const user = identity();
    let now = Date.now();
    const writer = new PostgresPortfolioCache(firstSql, key, () => now);
    const reader = new PostgresPortfolioCache(secondSql, key, () => now);
    const load = vi.fn().mockImplementation(async () => portfolio());
    expect((await writer.readThrough(user.id, user.subject, load, verify)).cache).toBe('miss');
    now += 44_999;
    expect((await reader.readThrough(user.id, user.subject, load, verify)).cache).toBe('hit');
    now += 1;
    expect((await reader.readThrough(user.id, user.subject, load, verify)).cache).toBe('miss');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('prevents an in-flight source fetch from restoring deleted owner data', async () => {
    const user = identity();
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: (value: Portfolio) => void;
    const delayed = new Promise<Portfolio>((resolve) => {
      release = resolve;
    });
    const pending = first.readThrough(
      user.id,
      user.subject,
      async () => {
        started();
        return delayed;
      },
      verify,
    );
    await fetching;
    await second.invalidateOwner(user.subject);
    release(portfolio());
    await pending;
    const rows =
      await firstSql`SELECT id_hash FROM balance_portfolio_cache WHERE owner_hash = ${owner(user.subject)}`;
    expect(rows).toHaveLength(0);
    expect(
      (await second.readThrough(user.id, user.subject, async () => portfolio(), verify)).cache,
    ).toBe('miss');
  });

  it('waits for a revoked session’s in-flight fetch, then removes its cache across connections', async () => {
    const user = identity();
    const credentials = new MemorySessionStore(key);
    await credentials.createSession(user.id, {
      subject: user.subject,
      scope: 'openid read',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 3600_000,
    });
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: (value: Portfolio) => void;
    const delayed = new Promise<Portfolio>((resolve) => {
      release = resolve;
    });
    const pending = getCachedPortfolio(user.id, {
      cache: first,
      sessions: credentials,
      load: async () => {
        started();
        return delayed;
      },
    });
    await fetching;
    await credentials.deleteSession(user.id);
    const deleting = second.invalidateSession(user.id);
    release(portfolio());
    await expect(pending).rejects.toMatchObject({ code: 'reconnect_required', status: 401 });
    await deleting;
    const rows =
      await firstSql`SELECT id_hash FROM balance_portfolio_cache WHERE id_hash = ${hashSecret(user.id)}`;
    expect(rows).toHaveLength(0);
  });
});
