PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_notification_job_target;

-- Preserve the oldest job by created_at, then by id, for each duplicate waiver receipt target
DELETE FROM notification_jobs AS duplicate
WHERE duplicate.kind = 'waiver_receipt'
  AND EXISTS (
    SELECT 1
    FROM notification_jobs AS keeper
    WHERE keeper.kind = 'waiver_receipt'
      AND keeper.target_record_id = duplicate.target_record_id
      AND (
        keeper.created_at < duplicate.created_at
        OR (keeper.created_at = duplicate.created_at AND keeper.id < duplicate.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target
  ON notification_jobs(kind, target_record_id)
  WHERE kind = 'waiver_receipt';

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

CREATE TRIGGER IF NOT EXISTS trg_waiver_participant_acceptance_insert
BEFORE INSERT ON waiver_acceptance_participants
WHEN NOT EXISTS (
  SELECT 1
  FROM legal_acceptance_events
  WHERE id = NEW.acceptance_event_id
    AND document_type = 'participation_waiver'
    AND action = 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'waiver participant requires an accepted participation waiver');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_participant_acceptance_update
BEFORE UPDATE OF acceptance_event_id ON waiver_acceptance_participants
WHEN NOT EXISTS (
  SELECT 1
  FROM legal_acceptance_events
  WHERE id = NEW.acceptance_event_id
    AND document_type = 'participation_waiver'
    AND action = 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'waiver participant requires an accepted participation waiver');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_receipt_target_insert
BEFORE INSERT ON notification_jobs
WHEN NEW.kind = 'waiver_receipt'
  AND NOT EXISTS (
    SELECT 1
    FROM legal_acceptance_events
    WHERE id = NEW.target_record_id
      AND document_type = 'participation_waiver'
      AND action = 'accepted'
  )
BEGIN
  SELECT RAISE(ABORT, 'waiver receipt requires an accepted participation waiver');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_receipt_target_update
BEFORE UPDATE OF kind, target_record_id ON notification_jobs
WHEN NEW.kind = 'waiver_receipt'
  AND NOT EXISTS (
    SELECT 1
    FROM legal_acceptance_events
    WHERE id = NEW.target_record_id
      AND document_type = 'participation_waiver'
      AND action = 'accepted'
  )
BEGIN
  SELECT RAISE(ABORT, 'waiver receipt requires an accepted participation waiver');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_acceptance_integrity_update
BEFORE UPDATE OF id, document_type, action ON legal_acceptance_events
WHEN (
    NEW.id <> OLD.id
    OR NEW.document_type <> 'participation_waiver'
    OR NEW.action <> 'accepted'
  )
  AND (
    EXISTS (
      SELECT 1
      FROM waiver_acceptance_participants
      WHERE acceptance_event_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
      FROM notification_jobs
      WHERE kind = 'waiver_receipt' AND target_record_id = OLD.id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'linked records require an accepted participation waiver');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_acceptance_integrity_delete
BEFORE DELETE ON legal_acceptance_events
WHEN EXISTS (
  SELECT 1
  FROM notification_jobs
  WHERE kind = 'waiver_receipt' AND target_record_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'waiver receipt requires an accepted participation waiver');
END;

-- Revalidate any rows created by a prior version of this migration
UPDATE waiver_acceptance_participants
SET acceptance_event_id = acceptance_event_id;

UPDATE notification_jobs
SET target_record_id = target_record_id
WHERE kind = 'waiver_receipt';
