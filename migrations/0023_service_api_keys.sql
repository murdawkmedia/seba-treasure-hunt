PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('validation', 'production')),
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  rotated_from_id TEXT REFERENCES service_keys(id) ON DELETE RESTRICT,
  revoked_at TEXT,
  revoked_by TEXT,
  expires_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_keys_environment_status
  ON service_keys(environment, status, created_at DESC);

CREATE TABLE IF NOT EXISTS service_key_events (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES service_keys(id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'rotated', 'revoked')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_key_events_key
  ON service_key_events(key_id, occurred_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_service_key_events_no_update
BEFORE UPDATE ON service_key_events
BEGIN
  SELECT RAISE(ABORT, 'service key events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_service_key_events_no_delete
BEFORE DELETE ON service_key_events
BEGIN
  SELECT RAISE(ABORT, 'service key events are append-only');
END;

CREATE TABLE IF NOT EXISTS service_api_idempotency (
  key_id TEXT NOT NULL REFERENCES service_keys(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_service_api_idempotency_expiry
  ON service_api_idempotency(expires_at);
