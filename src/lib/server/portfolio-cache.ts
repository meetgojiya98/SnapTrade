import 'server-only';
import postgres, { type Sql } from 'postgres';
import type { Portfolio } from '@/lib/types';
import { getServerConfig } from './config';
import { decryptJson, encryptJson, hashSecret, validSecret } from './crypto';
import { reconnectError } from './errors';
import { loadPortfolio } from './portfolio';
import { getSessionStore, type SessionStore } from './store';
import { getWorkspaceStore } from './workspace-store';

export const PORTFOLIO_CACHE_TTL_MS = 45_000;
export interface CachedPortfolio {
  portfolio: Portfolio;
  cache: 'hit' | 'miss';
}
type VerifySession = () => Promise<void>;
type Loader = () => Promise<Portfolio>;
const ownerHash = (subject: string) => hashSecret(`balance:subject:${subject}`);
const cacheContext = (id: string, owner: string) => `portfolio:${id}:${owner}`;

export interface PortfolioCacheStore {
  readThrough(
    sessionId: string,
    subject: string,
    load: Loader,
    verify: VerifySession,
  ): Promise<CachedPortfolio>;
  invalidateSession(sessionId: string): Promise<void>;
  invalidateOwner(subject: string): Promise<void>;
}

type MemoryEntry = {
  owner: string;
  payload: string;
  expiresAt: number;
  generation: number;
  epoch: number;
};

/** Explicit development adapter. Production requires shared, encrypted Postgres storage. */
export class MemoryPortfolioCache implements PortfolioCacheStore {
  private entries = new Map<string, MemoryEntry>();
  private locks = new Map<string, Promise<void>>();
  private ownerEpochs = new Map<string, number>();
  constructor(
    private key: Buffer,
    private generation: (subject: string) => Promise<number> = (subject) =>
      getWorkspaceStore().dataGeneration(subject),
    private now = Date.now,
  ) {}

  private async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.locks.set(id, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  async readThrough(
    sessionId: string,
    subject: string,
    load: Loader,
    verify: VerifySession,
  ): Promise<CachedPortfolio> {
    const id = hashSecret(sessionId);
    const owner = ownerHash(subject);
    return this.locked(id, async () => {
      await verify();
      const generation = await this.generation(subject);
      const epoch = this.ownerEpochs.get(owner) ?? 0;
      const entry = this.entries.get(id);
      if (
        entry &&
        entry.owner === owner &&
        entry.expiresAt > this.now() &&
        entry.generation === generation &&
        entry.epoch === epoch
      ) {
        const portfolio = decryptJson<Portfolio>(entry.payload, this.key, cacheContext(id, owner));
        await verify();
        return { portfolio, cache: 'hit' };
      }
      this.entries.delete(id);
      const portfolio = await load();
      await verify();
      // Deleting a workspace while the upstream call is pending must not restore its cached data.
      if (
        generation === (await this.generation(subject)) &&
        epoch === (this.ownerEpochs.get(owner) ?? 0)
      )
        this.entries.set(id, {
          owner,
          payload: encryptJson(portfolio, this.key, cacheContext(id, owner)),
          expiresAt: this.now() + PORTFOLIO_CACHE_TTL_MS,
          generation,
          epoch,
        });
      for (const [key, value] of this.entries)
        if (value.expiresAt <= this.now()) this.entries.delete(key);
      return { portfolio, cache: 'miss' };
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const id = hashSecret(sessionId);
    await this.locked(id, async () => {
      this.entries.delete(id);
    });
  }

  async invalidateOwner(subject: string): Promise<void> {
    const owner = ownerHash(subject);
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) ?? 0) + 1);
    for (const [id, value] of this.entries) if (value.owner === owner) this.entries.delete(id);
  }
}

type CacheRow = { payload: string; expires_at: Date; generation: number; owner_hash: string };

export class PostgresPortfolioCache implements PortfolioCacheStore {
  constructor(
    private sql: Sql,
    private key: Buffer,
    private now = Date.now,
  ) {}

  async readThrough(
    sessionId: string,
    subject: string,
    load: Loader,
    verify: VerifySession,
  ): Promise<CachedPortfolio> {
    const id = hashSecret(sessionId);
    const owner = ownerHash(subject);
    const result = await this.sql.begin(async (transaction) => {
      // Different server instances serialize the complete fetch, not merely the ciphertext write.
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `portfolio:${id}`,
      ]);
      await verify();
      const generations = await transaction.unsafe<{ generation: number }[]>(
        'SELECT generation FROM balance_workspace_generations WHERE owner_hash = $1',
        [owner],
      );
      const generation = generations[0]?.generation ?? 0;
      const rows = await transaction.unsafe<CacheRow[]>(
        'SELECT payload, expires_at, generation, owner_hash FROM balance_portfolio_cache WHERE id_hash = $1',
        [id],
      );
      const row = rows[0];
      if (
        row &&
        row.owner_hash === owner &&
        row.generation === generation &&
        row.expires_at.getTime() > this.now()
      ) {
        const portfolio = decryptJson<Portfolio>(row.payload, this.key, cacheContext(id, owner));
        await verify();
        return { value: { portfolio, cache: 'hit' as const } };
      }
      const portfolio = await load();
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [owner]);
      await verify();
      const latest = await transaction.unsafe<{ generation: number }[]>(
        'SELECT generation FROM balance_workspace_generations WHERE owner_hash = $1',
        [owner],
      );
      if ((latest[0]?.generation ?? 0) === generation) {
        const payload = encryptJson(portfolio, this.key, cacheContext(id, owner));
        await transaction.unsafe(
          `INSERT INTO balance_portfolio_cache (id_hash, owner_hash, payload, expires_at, generation)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id_hash) DO UPDATE SET
          owner_hash = EXCLUDED.owner_hash, payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at, generation = EXCLUDED.generation`,
          [id, owner, payload, new Date(this.now() + PORTFOLIO_CACHE_TTL_MS), generation],
        );
      }
      return { value: { portfolio, cache: 'miss' as const } };
    });
    // Cleanup runs after commit, without advisory locks, so unrelated expired rows cannot deadlock fetches.
    await this.sql`DELETE FROM balance_portfolio_cache WHERE expires_at <= now() AND id_hash IN
      (SELECT id_hash FROM balance_portfolio_cache WHERE expires_at <= now() ORDER BY expires_at LIMIT 100)`.catch(
      () => undefined,
    );
    return result.value as CachedPortfolio;
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const id = hashSecret(sessionId);
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `portfolio:${id}`,
      ]);
      await transaction.unsafe('DELETE FROM balance_portfolio_cache WHERE id_hash = $1', [id]);
    });
  }

  async invalidateOwner(subject: string): Promise<void> {
    const owner = ownerHash(subject);
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [owner]);
      // Shares the product deletion generation. Pending portfolio reads cannot repopulate this owner.
      await transaction.unsafe(
        `INSERT INTO balance_workspace_generations (owner_hash, generation)
        VALUES ($1, 1) ON CONFLICT (owner_hash) DO UPDATE
        SET generation = balance_workspace_generations.generation + 1`,
        [owner],
      );
      await transaction.unsafe('DELETE FROM balance_portfolio_cache WHERE owner_hash = $1', [
        owner,
      ]);
    });
  }
}

let cached: { fingerprint: string; cache: PortfolioCacheStore } | undefined;
export function getPortfolioCache(): PortfolioCacheStore {
  const config = getServerConfig();
  const fingerprint = hashSecret(
    `${config.databaseUrl ?? 'memory'}:${config.encryptionKey.toString('base64')}`,
  );
  if (cached?.fingerprint === fingerprint) return cached.cache;
  const cache = config.memoryStore
    ? new MemoryPortfolioCache(config.encryptionKey)
    : new PostgresPortfolioCache(
        postgres(config.databaseUrl!, {
          max: 3,
          idle_timeout: 20,
          connect_timeout: 10,
          prepare: false,
          onnotice: () => {},
        }),
        config.encryptionKey,
      );
  cached = { fingerprint, cache };
  return cache;
}

/** Session authentication is mandatory on every read, including valid cache hits. */
export async function getCachedPortfolio(
  sessionId: string,
  dependencies: {
    cache?: PortfolioCacheStore;
    sessions?: Pick<SessionStore, 'readSession'>;
    load?: (sessionId: string) => Promise<Portfolio>;
  } = {},
): Promise<CachedPortfolio> {
  if (!validSecret(sessionId)) throw reconnectError();
  const sessions = dependencies.sessions ?? getSessionStore();
  const session = await sessions.readSession(sessionId);
  if (!session || !session.subject || !session.scope.split(' ').includes('read'))
    throw reconnectError();
  const verify = async () => {
    const current = await sessions.readSession(sessionId);
    if (
      !current ||
      current.subject !== session.subject ||
      !current.scope.split(' ').includes('read')
    )
      throw reconnectError();
  };
  return (dependencies.cache ?? getPortfolioCache()).readThrough(
    sessionId,
    session.subject,
    () => (dependencies.load ?? loadPortfolio)(sessionId),
    verify,
  );
}

export const invalidatePortfolioSession = (sessionId: string) =>
  getPortfolioCache().invalidateSession(sessionId);
export const invalidatePortfolioOwner = (subject: string) =>
  getPortfolioCache().invalidateOwner(subject);
