import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeSchema } from './readiness';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('complete database readiness (Postgres integration)', () => {
  const schema = `readiness_${randomUUID().replaceAll('-', '')}`;
  let admin: ReturnType<typeof postgres>;
  let isolated: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/balance_test')
    )
      throw new Error('Readiness tests require a loopback balance_test* database.');
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    isolated = postgres(databaseUrl!, {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => {},
    });
  });
  afterAll(async () => {
    if (!admin) return;
    await isolated.end();
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
  });
  it('rejects absent product/cache migrations and accepts the complete schema', async () => {
    await expect(assertRuntimeSchema(isolated)).rejects.toThrow();
    for (const file of ['001_sessions.sql', '002_product.sql'])
      await isolated.unsafe(
        await readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'),
      );
    await expect(assertRuntimeSchema(isolated)).rejects.toThrow();
    await isolated.unsafe(
      await readFile(
        new URL('../../../migrations/003_portfolio_cache.sql', import.meta.url),
        'utf8',
      ),
    );
    await expect(assertRuntimeSchema(isolated)).resolves.toBeUndefined();
    await isolated`ALTER TABLE balance_portfolio_cache DROP COLUMN generation`;
    await expect(assertRuntimeSchema(isolated)).rejects.toThrow();
  });
});
