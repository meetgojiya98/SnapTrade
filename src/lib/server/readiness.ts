import 'server-only';
import postgres, { type Sql } from 'postgres';
import { getServerConfig } from './config';
import { hashSecret } from './crypto';

let connection: { fingerprint: string; sql: Sql } | undefined;

/** Check the complete runtime schema without reading any customer's records. */
export async function assertDatabaseReady() {
  const config = getServerConfig();
  if (config.memoryStore) return;
  const fingerprint = hashSecret(config.databaseUrl!);
  if (connection?.fingerprint !== fingerprint) {
    connection = {
      fingerprint,
      sql: postgres(config.databaseUrl!, {
        max: 1,
        prepare: false,
        idle_timeout: 20,
        connect_timeout: 5,
        onnotice: () => {},
      }),
    };
  }
  await assertRuntimeSchema(connection.sql);
}

export async function assertRuntimeSchema(sql: Sql) {
  await sql`
    SELECT a.state_hash, a.browser_hash, a.payload, a.expires_at,
      s.id_hash, s.payload, s.expires_at,
      w.owner_hash, w.payload, w.updated_at,
      p.id, p.owner_hash, p.payload, p.created_at,
      g.owner_hash, g.generation,
      c.id_hash, c.owner_hash, c.payload, c.expires_at, c.generation
    FROM balance_oauth_attempts a, balance_sessions s, balance_workspaces w,
      balance_plans p, balance_workspace_generations g, balance_portfolio_cache c
    LIMIT 0
  `;
}
