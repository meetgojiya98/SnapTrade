-- Apply with the same migration role as 001_sessions.sql.
-- Runtime needs SELECT/INSERT/UPDATE/DELETE. All financial and policy content is AES-GCM encrypted.
BEGIN;

CREATE TABLE IF NOT EXISTS balance_workspaces (
  owner_hash text PRIMARY KEY CHECK (length(owner_hash) = 64),
  payload text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_plans (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL CHECK (length(owner_hash) = 64),
  payload text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS balance_plans_owner_created ON balance_plans (owner_hash, created_at DESC);

-- A non-financial deletion marker prevents an in-flight save from restoring deleted snapshots.
CREATE TABLE IF NOT EXISTS balance_workspace_generations (
  owner_hash text PRIMARY KEY CHECK (length(owner_hash) = 64),
  generation integer NOT NULL CHECK (generation >= 0)
);

COMMIT;
