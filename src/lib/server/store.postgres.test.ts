import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret, randomSecret } from './crypto';
import { PostgresSessionStore, type Session } from './store';

// Opt-in integration suite. The guard prevents a test command from touching a production DB.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Postgres encrypted session store (integration)', () => {
  const key = randomBytes(32);
  let firstSql: ReturnType<typeof postgres>;
  let secondSql: ReturnType<typeof postgres>;
  let first: PostgresSessionStore;
  let second: PostgresSessionStore;
  const sessions: string[] = [];
  const attempts: string[] = [];
  const credentials: Session = {
    accessToken: 'private-access-credential',
    refreshToken: 'private-refresh-credential',
    accessExpiresAt: Date.now() + 36000_000,
    subject: 'private-personal-user',
    scope: 'openid read',
  };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/balance_test')
    ) {
      throw new Error(
        'Integration tests require a loopback Postgres database named balance_test*.',
      );
    }
    firstSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    secondSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    await firstSql.unsafe(
      await readFile(new URL('../../../migrations/001_sessions.sql', import.meta.url), 'utf8'),
    );
    first = new PostgresSessionStore(firstSql, key);
    second = new PostgresSessionStore(secondSql, key);
  });
  afterAll(async () => {
    if (!firstSql) return;
    for (const id of sessions)
      await firstSql`DELETE FROM balance_sessions WHERE id_hash = ${hashSecret(id)}`;
    for (const state of attempts)
      await firstSql`DELETE FROM balance_oauth_attempts WHERE state_hash = ${hashSecret(state)}`;
    await Promise.all([firstSql.end(), secondSql.end()]);
  });
  async function create() {
    const id = randomSecret();
    sessions.push(id);
    await first.createSession(id, credentials);
    return id;
  }

  it('stores encrypted credentials under the hash of the opaque session identifier', async () => {
    const id = await create();
    const [row] =
      await firstSql`SELECT id_hash, payload FROM balance_sessions WHERE id_hash = ${hashSecret(id)}`;
    expect(row.id_hash).not.toBe(id);
    expect(row.payload).not.toContain('"accessToken":"private-access-credential"');
    expect(await second.readSession(id)).toEqual(credentials);
  });
  it('consumes browser-bound login state once across independent connections', async () => {
    const state = randomSecret();
    attempts.push(state);
    const browser = randomSecret();
    const attempt = { verifier: randomSecret(), nonce: randomSecret() };
    await first.putLogin(state, browser, attempt);
    expect(await second.consumeLogin(state, randomSecret())).toBeNull();
    const consumed = await Promise.all([
      first.consumeLogin(state, browser),
      second.consumeLogin(state, browser),
    ]);
    expect(consumed.filter(Boolean)).toEqual([attempt]);
  });
  it('serializes token rotation across two server instances using a row lock', async () => {
    const id = await create();
    const seen: string[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).withSession(id, async (session) => {
          seen.push(session!.refreshToken);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            session: { ...session!, refreshToken: `${session!.refreshToken}.rotated` },
            value: undefined,
          };
        }),
      ),
    );
    expect(new Set(seen).size).toBe(8);
    expect((await first.readSession(id))?.refreshToken).toBe(
      credentials.refreshToken + '.rotated'.repeat(8),
    );
  });
  it('waits for an in-flight refresh before deleting a session', async () => {
    const id = await create();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = first.withSession(id, async (session) => {
      ready();
      await held;
      return { session: { ...session!, refreshToken: 'latest-rotation' }, value: undefined };
    });
    await started;
    const deletion = second.deleteSession(id);
    release();
    await Promise.all([refresh, deletion]);
    expect(await first.readSession(id)).toBeNull();
  });
  it('does not revive an expired session', async () => {
    const id = await create();
    await firstSql`UPDATE balance_sessions SET expires_at = now() - interval '1 second' WHERE id_hash = ${hashSecret(id)}`;
    expect(await second.readSession(id)).toBeNull();
    await second.withSession(id, async (session) => {
      expect(session).toBeNull();
      return { session: credentials, value: undefined };
    });
    const rows =
      await firstSql`SELECT id_hash FROM balance_sessions WHERE id_hash = ${hashSecret(id)}`;
    expect(rows).toHaveLength(0);
  });
});
