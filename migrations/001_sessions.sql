-- Apply once with a migration role, preferably through a direct Postgres connection.
-- Runtime queries use a limited role with SELECT/INSERT/UPDATE/DELETE on these tables.
BEGIN;

CREATE TABLE IF NOT EXISTS balance_oauth_attempts (
  state_hash text PRIMARY KEY CHECK (length(state_hash) = 64),
  browser_hash text NOT NULL CHECK (length(browser_hash) = 64),
  payload text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS balance_oauth_attempts_expiry ON balance_oauth_attempts (expires_at);

CREATE TABLE IF NOT EXISTS balance_sessions (
  id_hash text PRIMARY KEY CHECK (length(id_hash) = 64),
  payload text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS balance_sessions_expiry ON balance_sessions (expires_at);

COMMIT;
