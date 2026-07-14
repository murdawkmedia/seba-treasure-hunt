PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaign_rate_limit_buckets (
  scope TEXT NOT NULL,
  identifier_hash TEXT NOT NULL CHECK (
    length(identifier_hash) = 64 AND identifier_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL CHECK (window_expires_at > window_started_at),
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  PRIMARY KEY (scope, identifier_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_campaign_rate_limit_expiry
  ON campaign_rate_limit_buckets(window_expires_at);
