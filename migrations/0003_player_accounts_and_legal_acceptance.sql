PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS player_accounts (
  subject TEXT PRIMARY KEY,
  verified_email TEXT UNIQUE,
  account_state TEXT NOT NULL DEFAULT 'active' CHECK (account_state IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  profile_completed_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_accounts_updated
  ON player_accounts(updated_at DESC, subject DESC);

CREATE TABLE IF NOT EXISTS legal_acceptance_events (
  id TEXT PRIMARY KEY,
  hunter_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('privacy_media', 'participation_waiver')),
  document_version TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'accepted' CHECK (action IN ('accepted', 'withdrawn')),
  accepted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptance_current
  ON legal_acceptance_events(hunter_subject, document_type, accepted_at DESC, id DESC);

INSERT OR IGNORE INTO player_accounts
  (subject, verified_email, account_state, created_at, updated_at, last_seen_at, profile_completed_at)
SELECT subject, verified_email, 'active', created_at, updated_at, updated_at, updated_at
FROM hunter_profiles;
