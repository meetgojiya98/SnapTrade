#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
const filenamePattern = /^\d{3,}_[a-z0-9_-]+\.sql$/;

export class MigrationError extends Error {}

// Find statement boundaries without treating quoted values, identifiers, or comments as SQL.
function statements(source) {
  const result = [];
  let raw = '';
  let code = '';
  for (let i = 0; i < source.length;) {
    const remaining = source.slice(i);
    const token = /^(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*")/.exec(
      remaining,
    );
    const dollar = /^(\$(?:[a-z_][a-z0-9_]*)?\$)/i.exec(remaining);
    if (token) {
      raw += token[0];
      code += ' ';
      i += token[0].length;
    } else if (dollar) {
      const end = source.indexOf(dollar[1], i + dollar[1].length);
      if (end < 0) throw new MigrationError('A migration contains an unterminated SQL literal.');
      const literal = source.slice(i, end + dollar[1].length);
      raw += literal;
      code += ' ';
      i += literal.length;
    } else if (source[i] === ';') {
      raw += ';';
      if (code.trim()) result.push({ raw, code: code.trim().replace(/\s+/g, ' ') });
      raw = '';
      code = '';
      i += 1;
    } else {
      raw += source[i];
      code += source[i];
      i += 1;
    }
  }
  if (code.trim()) result.push({ raw, code: code.trim().replace(/\s+/g, ' ') });
  return result;
}

export function transactionalSql(source) {
  const parts = statements(source.replace(/^\uFEFF/, ''));
  if (parts[0]?.code.toUpperCase() === 'BEGIN' && parts.at(-1)?.code.toUpperCase() === 'COMMIT') {
    parts.shift();
    parts.pop();
  }
  if (!parts.length) throw new MigrationError('A migration has no SQL statements.');
  if (
    parts.some(({ code }) =>
      /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i.test(
        code,
      ),
    )
  ) {
    throw new MigrationError(
      'A migration contains transaction control inside the managed transaction.',
    );
  }
  return parts.map(({ raw }) => raw).join('\n');
}

export async function loadMigrations(migrationDirectory = directory) {
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => /\.sql$/i.test(entry.name));
  if (!files.length) throw new MigrationError('No SQL migrations were found.');
  if (files.some((entry) => !entry.isFile() || !filenamePattern.test(entry.name))) {
    throw new MigrationError('Migration filenames must use the format 001_description.sql.');
  }
  return Promise.all(
    files
      .map((entry) => entry.name)
      .sort()
      .map(async (filename) => {
        const source = await readFile(resolve(migrationDirectory, filename));
        return {
          filename,
          checksum: createHash('sha256').update(source).digest('hex'),
          sql: transactionalSql(source.toString('utf8')),
        };
      }),
  );
}

/** Applies only checked-in SQL. There is deliberately no reset, down, or destructive cleanup path. */
export async function applyMigrations(sql, migrations) {
  return sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL lock_timeout = '10s'");
    await transaction.unsafe("SET LOCAL statement_timeout = '60s'");
    // Transaction-scoped: protects the entire batch even through a transaction-mode pooler.
    await transaction`SELECT pg_advisory_xact_lock(1643844720, 1835626049)`;
    await transaction`CREATE TABLE IF NOT EXISTS balance_schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL CHECK (length(checksum) = 64),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = await transaction`SELECT filename, checksum FROM balance_schema_migrations`;
    const local = new Map(migrations.map((migration) => [migration.filename, migration]));
    for (const row of applied) {
      if (!filenamePattern.test(row.filename))
        throw new MigrationError('The migration ledger contains an invalid filename.');
      if (!local.has(row.filename))
        throw new MigrationError(
          `An applied migration is missing: ${row.filename}. Restore the original file.`,
        );
      if (local.get(row.filename).checksum !== row.checksum)
        throw new MigrationError(
          `An applied migration has changed: ${row.filename}. Restore the original file.`,
        );
    }
    const known = new Set(applied.map((row) => row.filename));
    const completed = [];
    for (const migration of migrations) {
      if (known.has(migration.filename)) continue;
      await transaction.unsafe(migration.sql);
      await transaction`INSERT INTO balance_schema_migrations (filename, checksum) VALUES (${migration.filename}, ${migration.checksum})`;
      completed.push(migration.filename);
    }
    return completed;
  });
}

export function migrationDatabaseUrl(env) {
  const connection = env.MIGRATION_DATABASE_URL || env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!connection)
    throw new MigrationError(
      'Set DATABASE_URL or MIGRATION_DATABASE_URL before running migrations.',
    );
  try {
    const parsed = new URL(connection);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname.length <= 1
    )
      throw new Error();
  } catch {
    throw new MigrationError('The migration database connection is invalid.');
  }
  return connection;
}

export async function main(env = process.env) {
  let sql;
  try {
    const connection = migrationDatabaseUrl(env);
    const migrations = await loadMigrations();
    sql = postgres(connection, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 5,
      onnotice: () => {},
    });
    const completed = await applyMigrations(sql, migrations);
    for (const filename of completed) console.log(`Applied ${filename}`);
    console.log(
      completed.length
        ? 'Migrations committed successfully.'
        : 'All migrations are already applied.',
    );
    return 0;
  } catch (error) {
    // Driver messages may contain credentials, hostnames, query values, or financial data.
    console.error(
      error instanceof MigrationError
        ? error.message
        : 'Migrations could not be applied. Verify database access and the checked-in SQL. No pending migrations were committed.',
    );
    return 1;
  } finally {
    if (sql) await sql.end({ timeout: 5 }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
