import 'server-only';
import postgres, { type Sql } from 'postgres';
import { getServerConfig } from './config';
import { decryptJson, encryptJson, hashSecret } from './crypto';

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LoginAttempt {
  verifier: string;
  nonce: string;
}
export interface Session {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  subject: string;
  scope: string;
}
type Update<T> = { session: Session | null; value: T };

export interface SessionStore {
  putLogin(state: string, browser: string, attempt: LoginAttempt): Promise<void>;
  consumeLogin(state: string, browser: string): Promise<LoginAttempt | null>;
  createSession(id: string, session: Session): Promise<void>;
  readSession(id: string): Promise<Session | null>;
  /** The lock spans the refresh request and rotated-token write, including across server instances. */
  withSession<T>(id: string, update: (session: Session | null) => Promise<Update<T>>): Promise<T>;
  deleteSession(id: string): Promise<void>;
}

type Stored = { payload: string; expiresAt: number };
type LoginStored = Stored & { browserHash: string };

/** Explicit local development adapter. It is never selected in production. */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Stored>();
  private attempts = new Map<string, LoginStored>();
  private locks = new Map<string, Promise<void>>();
  constructor(
    private key: Buffer,
    private now = Date.now,
  ) {}

  private sweep() {
    for (const [id, row] of this.sessions)
      if (row.expiresAt <= this.now()) this.sessions.delete(id);
    for (const [id, row] of this.attempts)
      if (row.expiresAt <= this.now()) this.attempts.delete(id);
  }

  async putLogin(state: string, browser: string, attempt: LoginAttempt) {
    this.sweep();
    const id = hashSecret(state);
    this.attempts.set(id, {
      browserHash: hashSecret(browser),
      payload: encryptJson(attempt, this.key, `login:${id}`),
      expiresAt: this.now() + LOGIN_TTL_MS,
    });
  }

  async consumeLogin(state: string, browser: string) {
    const id = hashSecret(state);
    const row = this.attempts.get(id);
    if (!row || row.expiresAt <= this.now() || row.browserHash !== hashSecret(browser)) return null;
    this.attempts.delete(id);
    return decryptJson<LoginAttempt>(row.payload, this.key, `login:${id}`);
  }

  async createSession(id: string, session: Session) {
    this.sweep();
    const hash = hashSecret(id);
    this.sessions.set(hash, {
      payload: encryptJson(session, this.key, `session:${hash}`),
      expiresAt: this.now() + SESSION_TTL_MS,
    });
  }

  async readSession(id: string): Promise<Session | null> {
    const hash = hashSecret(id);
    const row = this.sessions.get(hash);
    if (!row || row.expiresAt <= this.now()) {
      this.sessions.delete(hash);
      return null;
    }
    return decryptJson<Session>(row.payload, this.key, `session:${hash}`);
  }

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

  async withSession<T>(
    id: string,
    update: (session: Session | null) => Promise<Update<T>>,
  ): Promise<T> {
    const hash = hashSecret(id);
    return this.locked(hash, async () => {
      const existing = this.sessions.get(hash);
      const result = await update(await this.readSession(id));
      if (!result.session || !existing || existing.expiresAt <= this.now())
        this.sessions.delete(hash);
      else
        this.sessions.set(hash, {
          ...existing,
          payload: encryptJson(result.session, this.key, `session:${hash}`),
        });
      return result.value;
    });
  }

  async deleteSession(id: string) {
    await this.withSession(id, async () => ({ session: null, value: undefined }));
  }
}

type DatabaseRow = { payload: string; expires_at: Date };

export class PostgresSessionStore implements SessionStore {
  constructor(
    private sql: Sql,
    private key: Buffer,
  ) {}

  async putLogin(state: string, browser: string, attempt: LoginAttempt) {
    const id = hashSecret(state);
    const payload = encryptJson(attempt, this.key, `login:${id}`);
    await this.sql`DELETE FROM balance_oauth_attempts WHERE expires_at <= now()`;
    await this
      .sql`INSERT INTO balance_oauth_attempts (state_hash, browser_hash, payload, expires_at)
      VALUES (${id}, ${hashSecret(browser)}, ${payload}, ${new Date(Date.now() + LOGIN_TTL_MS)})`;
  }

  async consumeLogin(state: string, browser: string) {
    const id = hashSecret(state);
    // DELETE ... RETURNING makes consumption one-time even when callbacks race across instances.
    const rows = await this.sql<DatabaseRow[]>`DELETE FROM balance_oauth_attempts
      WHERE state_hash = ${id} AND browser_hash = ${hashSecret(browser)} AND expires_at > now()
      RETURNING payload, expires_at`;
    return rows[0] ? decryptJson<LoginAttempt>(rows[0].payload, this.key, `login:${id}`) : null;
  }

  async createSession(id: string, session: Session) {
    const hash = hashSecret(id);
    const payload = encryptJson(session, this.key, `session:${hash}`);
    await this.sql`DELETE FROM balance_sessions WHERE expires_at <= now()`;
    await this.sql`INSERT INTO balance_sessions (id_hash, payload, expires_at)
      VALUES (${hash}, ${payload}, ${new Date(Date.now() + SESSION_TTL_MS)})`;
  }

  async readSession(id: string) {
    const hash = hashSecret(id);
    const rows = await this.sql<DatabaseRow[]>`SELECT payload, expires_at FROM balance_sessions
      WHERE id_hash = ${hash} AND expires_at > now()`;
    return rows[0] ? decryptJson<Session>(rows[0].payload, this.key, `session:${hash}`) : null;
  }

  async withSession<T>(
    id: string,
    update: (session: Session | null) => Promise<Update<T>>,
  ): Promise<T> {
    const hash = hashSecret(id);
    const result = await this.sql.begin(async (transaction) => {
      // A row lock serializes refreshes and disconnects for this session without a global lock.
      const rows = await transaction.unsafe<DatabaseRow[]>(
        'SELECT payload, expires_at FROM balance_sessions WHERE id_hash = $1 FOR UPDATE',
        [hash],
      );
      const row = rows[0];
      const session =
        row && row.expires_at.getTime() > Date.now()
          ? decryptJson<Session>(row.payload, this.key, `session:${hash}`)
          : null;
      const changed = await update(session);
      if (!changed.session || !session) {
        await transaction.unsafe('DELETE FROM balance_sessions WHERE id_hash = $1', [hash]);
      } else {
        const payload = encryptJson(changed.session, this.key, `session:${hash}`);
        await transaction.unsafe('UPDATE balance_sessions SET payload = $1 WHERE id_hash = $2', [
          payload,
          hash,
        ]);
      }
      return { value: changed.value };
    });
    return result.value as T;
  }

  async deleteSession(id: string) {
    await this.sql`DELETE FROM balance_sessions WHERE id_hash = ${hashSecret(id)}`;
  }
}

let cached: { fingerprint: string; store: SessionStore } | undefined;

export function getSessionStore(): SessionStore {
  const config = getServerConfig();
  const fingerprint = hashSecret(
    `${config.databaseUrl ?? 'memory'}:${config.encryptionKey.toString('base64')}`,
  );
  if (cached?.fingerprint === fingerprint) return cached.store;
  const store = config.memoryStore
    ? new MemorySessionStore(config.encryptionKey)
    : new PostgresSessionStore(
        postgres(config.databaseUrl!, {
          max: 5,
          idle_timeout: 20,
          connect_timeout: 10,
          prepare: false,
          onnotice: () => {},
        }),
        config.encryptionKey,
      );
  cached = { fingerprint, store };
  return store;
}
