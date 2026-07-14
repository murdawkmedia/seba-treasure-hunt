PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legal_document_review_events (
  id TEXT PRIMARY KEY,
  hunter_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type = 'participation_waiver'),
  document_version TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_review_subject
  ON legal_document_review_events(hunter_subject, document_version, reviewed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS waiver_acceptance_participants (
  id TEXT PRIMARY KEY,
  acceptance_event_id TEXT NOT NULL REFERENCES legal_acceptance_events(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('adult', 'minor')),
  full_name TEXT NOT NULL,
  birth_year INTEGER,
  guardian_attested INTEGER NOT NULL DEFAULT 0 CHECK (guardian_attested IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK ((participant_role = 'adult' AND birth_year IS NULL AND guardian_attested = 0)
      OR (participant_role = 'minor' AND birth_year IS NOT NULL AND guardian_attested = 1))
);

CREATE INDEX IF NOT EXISTS idx_waiver_participants_acceptance
  ON waiver_acceptance_participants(acceptance_event_id, participant_role, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target
  ON notification_jobs(kind, target_record_id);

CREATE TABLE IF NOT EXISTS notification_delivery_events (
  id TEXT PRIMARY KEY,
  notification_job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('queued', 'attempted', 'sent', 'failed', 'requeued')),
  provider TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_job
  ON notification_delivery_events(notification_job_id, occurred_at DESC, id DESC);
