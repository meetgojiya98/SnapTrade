-- Additive private support storage. Apply with the migration role; runtime uses existing CRUD grants.
-- Subjects are hashed; titles, topics, references, message content and actor details are AES-GCM encrypted.
BEGIN;
CREATE TABLE IF NOT EXISTS balance_support_actors (
  actor_hash text PRIMARY KEY CHECK (length(actor_hash) = 64),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  window_start timestamptz NOT NULL,
  create_count integer NOT NULL DEFAULT 0 CHECK (create_count >= 0),
  write_count integer NOT NULL DEFAULT 0 CHECK (write_count >= 0)
);
CREATE TABLE IF NOT EXISTS balance_support_threads (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL CHECK (length(owner_hash) = 64),
  create_key_hash text NOT NULL CHECK (length(create_key_hash) = 64),
  payload text NOT NULL,
  summary_payload text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (owner_hash, create_key_hash)
);
CREATE INDEX IF NOT EXISTS balance_support_threads_owner_updated ON balance_support_threads (owner_hash, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS balance_support_threads_updated ON balance_support_threads (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS balance_support_threads_expiry ON balance_support_threads (expires_at);
-- No content survives customer deletion. A bounded hash tombstone stops retries resurrecting deleted cases.
CREATE TABLE IF NOT EXISTS balance_support_deleted_requests (
  owner_hash text NOT NULL CHECK (length(owner_hash) = 64),
  create_key_hash text NOT NULL CHECK (length(create_key_hash) = 64),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_hash, create_key_hash)
);
CREATE INDEX IF NOT EXISTS balance_support_deleted_requests_expiry ON balance_support_deleted_requests (expires_at);
COMMIT;
