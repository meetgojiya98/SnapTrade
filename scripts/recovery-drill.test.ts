import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import { defaultWorkspacePreferences } from '@/lib/workspace';
import { randomSecret } from '@/lib/server/crypto';
import { PostgresPortfolioCache } from '@/lib/server/portfolio-cache';
import { PostgresSessionStore, type Session } from '@/lib/server/store';
import { PostgresSupportStore } from '@/lib/server/support-store';
import { createSavedPlan } from '@/lib/server/workspace';
import { PostgresWorkspaceStore } from '@/lib/server/workspace-store';

const execute = promisify(execFile);

function localTestDatabase(value: string | undefined): URL {
  if (!value) throw new Error('Set TEST_DATABASE_URL to a disposable local balance_test database.');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\/balance_test[a-z0-9_]*$/i.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Recovery requires a loopback balance_test database URL without query options.',
    );
  }
  return url;
}

function databaseConnection(base: URL, name: string): string {
  if (!/^balance_test_recovery_[a-f0-9]{16}(?:_restored)?$/.test(name))
    throw new Error('Refusing a recovery database name outside the generated namespace.');
  const connection = new URL(base);
  connection.pathname = `/${name}`;
  return connection.toString();
}

function postgresEnvironment(base: URL, database: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  // libpq settings must not redirect a local drill through an inherited service,
  // host override, options, passfile, or production connection string.
  for (const name of Object.keys(environment))
    if (name.startsWith('PG') || ['DATABASE_URL', 'MIGRATION_DATABASE_URL'].includes(name))
      delete environment[name];
  return {
    ...environment,
    PGHOST: base.hostname,
    PGPORT: base.port || '5432',
    ...(base.username ? { PGUSER: decodeURIComponent(base.username) } : {}),
    PGPASSWORD: decodeURIComponent(base.password),
    PGDATABASE: database,
    PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '5',
  };
}

async function command(program: string, args: string[], environment?: NodeJS.ProcessEnv) {
  try {
    return await execute(program, args, {
      env: environment,
      timeout: 60_000,
      maxBuffer: 1_000_000,
    });
  } catch {
    throw new Error(
      `Recovery command ${program.split('/').at(-1)} failed. Check local CLI access and version.`,
    );
  }
}

const connect = (url: string) =>
  postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });

async function databaseRows(sql: Sql) {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename LIKE 'balance_%' ORDER BY tablename`;
  const result: Record<string, unknown[]> = {};
  for (const { tablename } of tables) {
    if (!/^balance_[a-z0-9_]+$/.test(tablename)) throw new Error('Unexpected recovery table name.');
    const rows = await sql.unsafe<{ data: unknown }[]>(
      `SELECT to_jsonb(row) AS data FROM public."${tablename}" AS row ORDER BY to_jsonb(row)::text`,
    );
    result[tablename] = rows.map((row) => row.data);
  }
  return result;
}

describe('isolated logical backup and restore drill', () => {
  it('rejects remote databases, non-test names, and connection option overrides before connecting', () => {
    for (const value of [
      undefined,
      'postgresql://database.example/balance_test',
      'postgresql://127.0.0.1/production',
      'postgresql://127.0.0.1/balance_test?host=database.example',
      'postgresql://127.0.0.1/balance_test#remote',
    ])
      expect(() => localTestDatabase(value)).toThrow();
    expect(localTestDatabase('postgresql://127.0.0.1:5432/balance_test_product').hostname).toBe(
      '127.0.0.1',
    );
    expect(() =>
      databaseConnection(localTestDatabase('postgresql://localhost/balance_test'), 'production'),
    ).toThrow();
  });

  it('restores synthetic encrypted records into a fresh database with their matching key', async () => {
    const started = performance.now();
    const base = localTestDatabase(process.env.TEST_DATABASE_URL);
    const nonce = randomUUID().replaceAll('-', '').slice(0, 16);
    const sourceName = `balance_test_recovery_${nonce}`;
    const restoredName = `${sourceName}_restored`;
    const sourceUrl = databaseConnection(base, sourceName);
    const restoredUrl = databaseConnection(base, restoredName);
    const adminUrl = new URL(base);
    adminUrl.pathname = '/postgres';
    const admin = connect(adminUrl.toString());
    const directory = await mkdtemp(join(tmpdir(), 'balance-recovery-'));
    const archive = join(directory, 'synthetic.dump');
    const created = new Set<string>();
    const connections: Sql[] = [];
    const key = randomBytes(32); // Synthetic and memory-only; never read the production key.
    try {
      await chmod(directory, 0o700);
      const version = await command('pg_dump', ['--version']);
      const clientMajor = Number(/PostgreSQL\)\s+(\d+)/.exec(version.stdout)?.[1]);
      const [server] = await admin<{ server_version_num: string }[]>`SHOW server_version_num`;
      if (!clientMajor || clientMajor < Math.floor(Number(server.server_version_num) / 10_000))
        throw new Error('Use pg_dump/pg_restore compatible with the local PostgreSQL server.');
      for (const name of [sourceName, restoredName]) {
        await admin`CREATE DATABASE ${admin(name)}`;
        created.add(name);
      }
      await command(process.execPath, [fileURLToPath(new URL('./migrate.mjs', import.meta.url))], {
        ...postgresEnvironment(base, sourceName),
        MIGRATION_DATABASE_URL: sourceUrl,
      });
      const sourceSql = connect(sourceUrl);
      connections.push(sourceSql);
      const sessions = new PostgresSessionStore(sourceSql, key);
      const workspace = new PostgresWorkspaceStore(sourceSql, key);
      const cacheClock = Date.now();
      const cache = new PostgresPortfolioCache(sourceSql, key, () => cacheClock);
      const identity = { subject: `synthetic-${randomUUID()}`, sessionId: randomSecret() };
      const credentials: Session = {
        subject: identity.subject,
        accessToken: 'synthetic-recovery-access-token',
        refreshToken: 'synthetic-recovery-refresh-token',
        accessExpiresAt: Date.now() + 3600_000,
        scope: 'openid read',
      };
      const state = randomSecret();
      const browser = randomSecret();
      const attempt = { verifier: randomSecret(), nonce: randomSecret() };
      await sessions.createSession(identity.sessionId, credentials);
      await sessions.putLogin(state, browser, attempt);
      const portfolio = { ...makeDemoPortfolio(), mode: 'live' as const, warnings: [] };
      const preferences = structuredClone(defaultWorkspacePreferences);
      preferences.selectedAccountIds = portfolio.accounts.map((account) => account.id);
      const expectedWorkspace = await workspace.writeWorkspace(identity.subject, preferences);
      const expectedPlan = await createSavedPlan(
        identity,
        {
          name: 'Synthetic recovery snapshot',
          preferences,
          contributionCents: 0,
          contributionAccountId: null,
        },
        {
          store: workspace,
          loadPortfolio: async () => portfolio,
          now: () => Date.parse(portfolio.asOf),
        },
      );
      await cache.readThrough(
        identity.sessionId,
        identity.subject,
        async () => portfolio,
        async () => {},
      );
      const support = new PostgresSupportStore(sourceSql, key);
      const customer = { subject: identity.subject, operator: false };
      const otherCustomer = { subject: `synthetic-${randomUUID()}`, operator: false };
      const operator = { subject: `synthetic-${randomUUID()}`, operator: true };
      const supportInput = {
        clientRequestId: randomUUID(),
        topic: 'planning' as const,
        title: 'Synthetic recovery support question',
        message: 'Synthetic encrypted support message.',
        requestReference: randomUUID(),
      };
      const createdSupport = await support.createThread(
        customer,
        supportInput,
        await support.dataGeneration(customer.subject),
      );
      await support.reply(operator, createdSupport.thread.id, {
        clientRequestId: randomUUID(),
        message: 'Synthetic encrypted operator reply.',
      });
      const expectedSupport = await support.setStatus(
        customer,
        createdSupport.thread.id,
        'resolved',
      );
      const deletedInput = {
        ...supportInput,
        clientRequestId: randomUUID(),
        title: 'Synthetic deleted support question',
      };
      const deletedSupport = await support.createThread(
        customer,
        deletedInput,
        await support.dataGeneration(customer.subject),
      );
      await support.deleteThread(customer, deletedSupport.thread.id);
      await support.deleteAll(otherCustomer);
      const otherSupport = await support.createThread(
        otherCustomer,
        {
          ...supportInput,
          clientRequestId: randomUUID(),
          title: 'Synthetic second customer question',
        },
        await support.dataGeneration(otherCustomer.subject),
      );
      const originalRows = await databaseRows(sourceSql);
      const rowText = JSON.stringify(originalRows);
      expect(rowText).not.toContain(credentials.accessToken);
      expect(rowText).not.toContain(expectedPlan.name);
      expect(rowText).not.toContain(supportInput.title);
      expect(rowText).not.toContain(supportInput.message);
      expect(rowText).not.toContain('Synthetic encrypted operator reply.');
      expect(rowText).not.toContain('"symbol":"VTI"');
      expect(rowText).toContain('v1.');
      await sourceSql.end();
      connections.splice(connections.indexOf(sourceSql), 1);
      await command(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-privileges', '--file', archive],
        postgresEnvironment(base, sourceName),
      );
      await chmod(archive, 0o600);
      await command(
        'pg_restore',
        ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', restoredName, archive],
        postgresEnvironment(base, restoredName),
      );
      const restoredSql = connect(restoredUrl);
      connections.push(restoredSql);
      expect(await databaseRows(restoredSql)).toEqual(originalRows);
      const restoredSessions = new PostgresSessionStore(restoredSql, key);
      const restoredWorkspace = new PostgresWorkspaceStore(restoredSql, key);
      const restoredSupport = new PostgresSupportStore(restoredSql, key);
      expect(await restoredSessions.readSession(identity.sessionId)).toEqual(credentials);
      expect(await restoredWorkspace.readWorkspace(identity.subject)).toEqual(expectedWorkspace);
      expect(await restoredWorkspace.readPlan(identity.subject, expectedPlan.id)).toEqual(
        expectedPlan,
      );
      const stranger = `synthetic-${randomUUID()}`;
      expect(await restoredWorkspace.readPlan(stranger, expectedPlan.id)).toBeNull();
      expect((await restoredWorkspace.readWorkspace(stranger)).updatedAt).toBeNull();
      expect(await restoredSupport.readThread(customer, expectedSupport.id)).toEqual(
        expectedSupport,
      );
      expect(
        (await restoredSupport.listThreads(customer, 'mine')).threads.map((thread) => thread.id),
      ).toEqual([expectedSupport.id]);
      expect((await restoredSupport.listThreads(operator, 'all')).threads).toHaveLength(2);
      await expect(
        restoredSupport.readThread(otherCustomer, expectedSupport.id),
      ).rejects.toMatchObject({ status: 404 });
      expect((await restoredSupport.readThread(otherCustomer, otherSupport.thread.id)).title).toBe(
        'Synthetic second customer question',
      );
      await expect(
        restoredSupport.createThread(
          customer,
          deletedInput,
          await restoredSupport.dataGeneration(customer.subject),
        ),
      ).rejects.toMatchObject({ code: 'request_deleted', status: 410 });
      await expect(
        restoredSupport.createThread(
          otherCustomer,
          { ...supportInput, clientRequestId: randomUUID() },
          0,
        ),
      ).rejects.toMatchObject({ code: 'support_changed', status: 409 });
      const wrongKey = randomBytes(32);
      await expect(
        new PostgresSessionStore(restoredSql, wrongKey).readSession(identity.sessionId),
      ).rejects.toThrow();
      await expect(
        new PostgresWorkspaceStore(restoredSql, wrongKey).readWorkspace(identity.subject),
      ).rejects.toThrow();
      await expect(
        new PostgresWorkspaceStore(restoredSql, wrongKey).readPlan(
          identity.subject,
          expectedPlan.id,
        ),
      ).rejects.toThrow();
      expect(await restoredSessions.consumeLogin(state, browser)).toEqual(attempt);
      await expect(
        new PostgresSupportStore(restoredSql, wrongKey).readThread(customer, expectedSupport.id),
      ).rejects.toThrow();
      await expect(
        new PostgresSupportStore(restoredSql, wrongKey).listThreads(customer, 'mine'),
      ).rejects.toThrow();
      expect(await restoredSessions.consumeLogin(state, browser)).toBeNull();
      expect(
        await new PostgresPortfolioCache(restoredSql, key, () => cacheClock).readThrough(
          identity.sessionId,
          identity.subject,
          async () => {
            throw new Error('Unexpected brokerage access during restore.');
          },
          async () => {},
        ),
      ).toEqual({ portfolio, cache: 'hit' });
      console.info(
        JSON.stringify({
          event: 'balance.recovery.drill',
          status: 'verified',
          tables: Object.keys(originalRows).length,
          elapsedMs: Math.round(performance.now() - started),
          scope: 'synthetic local logical restore; not provider PITR or key escrow',
        }),
      );
    } finally {
      const failures: string[] = [];
      for (const sql of connections) {
        try {
          await sql.end({ timeout: 5 });
        } catch {
          failures.push('connection cleanup');
        }
      }
      for (const name of [...created].reverse()) {
        try {
          await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
        } catch {
          failures.push(`database ${name}`);
        }
      }
      try {
        await admin.end({ timeout: 5 });
      } catch {
        failures.push('admin connection');
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        failures.push('temporary archive');
      }
      key.fill(0);
      if (failures.length) throw new Error(`Recovery cleanup incomplete: ${failures.join(', ')}.`);
    }
  });
});
