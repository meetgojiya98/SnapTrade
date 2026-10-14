-- Requires 002_product.sql. Cache data has the same AES-GCM financial payload encryption.
BEGIN;
CREATE TABLE IF NOT EXISTS balance_portfolio_cache (
  id_hash text PRIMARY KEY CHECK (length(id_hash) = 64),
  owner_hash text NOT NULL CHECK (length(owner_hash) = 64),
  payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  generation integer NOT NULL CHECK (generation >= 0)
);
CREATE INDEX IF NOT EXISTS balance_portfolio_cache_owner ON balance_portfolio_cache (owner_hash);
CREATE INDEX IF NOT EXISTS balance_portfolio_cache_expiry ON balance_portfolio_cache (expires_at);
COMMIT;
