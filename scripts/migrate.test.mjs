import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import postgres from 'postgres';
import {
  applyMigrations,
  loadMigrations,
  migrationDatabaseUrl,
  transactionalSql,
} from './migrate.mjs';

const migration = (filename, source) => ({
  filename,
  checksum: createHash('sha256').update(source).digest('hex'),
  sql: transactionalSql(source),
});

describe('migration runner preflight', () => {
  it('sorts files and hashes the original bytes while removing outer transaction wrappers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'balance-migration-files-'));
    try {
      const source =
        '-- Preserve this checksum.\nBEGIN;\nCREATE TABLE sample (id integer);\nCOMMIT;\n';
      await writeFile(join(directory, '002_second.sql'), 'CREATE INDEX sample_id ON sample(id);');
      await writeFile(join(directory, '001_first.sql'), source);
      const files = await loadMigrations(directory);
      assert.deepEqual(
        files.map((file) => file.filename),
        ['001_first.sql', '002_second.sql'],
      );
      assert.equal(files[0].checksum, createHash('sha256').update(source).digest('hex'));
      assert.doesNotMatch(files[0].sql, /BEGIN|COMMIT/);
      assert.match(files[0].sql, /CREATE TABLE sample/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects unsafe filenames and empty migration directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'balance-migration-files-'));
    try {
      await assert.rejects(loadMigrations(directory), /No SQL migrations/);
      await writeFile(join(directory, 'unversioned.sql'), 'SELECT 1;');
      await assert.rejects(loadMigrations(directory), /001_description.sql/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects nested transaction control without confusing quoted values or comments with SQL', () => {
    assert.throws(
      () => transactionalSql('BEGIN; CREATE TABLE sample(id int); COMMIT; COMMIT;'),
      /transaction control/,
    );
    assert.throws(() => transactionalSql('SELECT 1; ROLLBACK;'), /transaction control/);
    assert.throws(() => transactionalSql('BEGIN; COMMIT;'), /no SQL statements/);
    assert.match(
      transactionalSql("-- COMMIT;\nSELECT 'BEGIN; COMMIT;' AS value, $$ROLLBACK;$$ AS example;"),
      /SELECT/,
    );
  });
  it('prefers an explicit migration URL, then unpooled, while accepting provider-independent pooler URLs', () => {
    const direct = 'postgres://user:private@localhost/balance_test';
    const pooled = 'postgresql://user:private@ep-example-pooler.example.com/balance';
    assert.equal(migrationDatabaseUrl({ DATABASE_URL: pooled }), pooled);
    assert.equal(
      migrationDatabaseUrl({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct }),
      direct,
    );
    assert.equal(
      migrationDatabaseUrl({
        DATABASE_URL: pooled,
        DATABASE_URL_UNPOOLED: direct,
        MIGRATION_DATABASE_URL: direct + '_migration',
      }),
      direct + '_migration',
    );
    assert.throws(() => migrationDatabaseUrl({}), /Set DATABASE_URL/);
    assert.throws(
      () => migrationDatabaseUrl({ DATABASE_URL: 'invalid_PRIVATE_CREDENTIAL' }),
      /connection is invalid/,
    );
  });
  it('redacts database connection failures rather than printing driver errors or credentials', () => {
    const secret = 'PASSWORD_MUST_NOT_APPEAR';
    const result = spawnSync(process.execPath, ['scripts/migrate.mjs'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: `postgres://connection_private:${secret}@127.0.0.1:1/balance_test_private`,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Migrations could not be applied/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      new RegExp(`${secret}|connection_private|balance_test_private|127.0.0.1`),
    );
    assert.equal(result.stdout, '');
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe('migration runner on disposable Postgres', { skip: !databaseUrl }, () => {
  async function isolated(run) {
    const parsed = new URL(databaseUrl);
    if (
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      !parsed.pathname.startsWith('/balance_test')
    )
      throw new Error(
        'Migration integration tests require a loopback database named balance_test*.',
      );
    const schema = `balance_migration_test_${randomBytes(8).toString('hex')}`;
    const admin = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
    const clients = [];
    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      for (let i = 0; i < 2; i++)
        clients.push(
          postgres(databaseUrl, {
            max: 1,
            prepare: false,
            onnotice: () => {},
            connection: { search_path: schema },
          }),
        );
      await run(clients[0], clients[1]);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  }
  it('applies all repository migrations and repeats without changes', async () => {
    await isolated(async (sql) => {
      const files = await loadMigrations();
      assert.deepEqual(await applyMigrations(sql, files), [
        '001_sessions.sql',
        '002_product.sql',
        '003_portfolio_cache.sql',
        '004_support.sql',
      ]);
      assert.deepEqual(await applyMigrations(sql, files), []);
      const [row] = await sql`SELECT count(*)::int AS count FROM balance_schema_migrations`;
      assert.equal(row.count, 4);
      const [tables] =
        await sql`SELECT to_regclass('balance_sessions') AS sessions, to_regclass('balance_workspaces') AS workspaces, to_regclass('balance_portfolio_cache') AS cache, to_regclass('balance_support_threads') AS support, to_regclass('balance_support_actors') AS support_actors, to_regclass('balance_support_deleted_requests') AS support_deleted`;
      assert.ok(
        tables.sessions &&
          tables.workspaces &&
          tables.cache &&
          tables.support &&
          tables.support_actors &&
          tables.support_deleted,
      );
    });
  });
  it('rolls back the whole pending batch and ledger when any migration fails', async () => {
    await isolated(async (sql) => {
      await assert.rejects(
        applyMigrations(sql, [
          migration('001_first.sql', 'CREATE TABLE first_table (id int);'),
          migration('002_failure.sql', 'THIS IS NOT SQL;'),
        ]),
      );
      const [row] =
        await sql`SELECT to_regclass('first_table') AS first, to_regclass('balance_schema_migrations') AS ledger`;
      assert.equal(row.first, null);
      assert.equal(row.ledger, null);
    });
  });
  it('rejects a modified applied checksum before applying pending SQL', async () => {
    await isolated(async (sql) => {
      await applyMigrations(sql, [
        migration('001_first.sql', 'CREATE TABLE first_table (id int);'),
      ]);
      await assert.rejects(
        applyMigrations(sql, [
          migration('001_first.sql', 'CREATE TABLE first_table (id bigint);'),
          migration('002_pending.sql', 'CREATE TABLE pending_table(id int);'),
        ]),
        /applied migration has changed: 001_first.sql/,
      );
      const [row] =
        await sql`SELECT to_regclass('pending_table') AS pending, (SELECT count(*)::int FROM balance_schema_migrations) AS count`;
      assert.equal(row.pending, null);
      assert.equal(row.count, 1);
    });
  });
  it('serializes independent concurrent runners and applies each migration only once', async () => {
    await isolated(async (first, second) => {
      const files = [
        migration(
          '001_once.sql',
          'SELECT pg_sleep(0.1); CREATE TABLE once_table(id int); INSERT INTO once_table VALUES (1);',
        ),
      ];
      const results = await Promise.all([
        applyMigrations(first, files),
        applyMigrations(second, files),
      ]);
      assert.deepEqual(results.map((result) => result.length).sort(), [0, 1]);
      const [row] = await first`SELECT count(*)::int AS count FROM once_table`;
      assert.equal(row.count, 1);
    });
  });
  it('refuses an applied migration missing from the checked-in set', async () => {
    await isolated(async (sql) => {
      await applyMigrations(sql, [migration('001_first.sql', 'CREATE TABLE first_table(id int);')]);
      await assert.rejects(
        applyMigrations(sql, [migration('002_second.sql', 'CREATE TABLE second_table(id int);')]),
        /applied migration is missing: 001_first.sql/,
      );
      const [row] = await sql`SELECT to_regclass('second_table') AS second`;
      assert.equal(row.second, null);
    });
  });
});
