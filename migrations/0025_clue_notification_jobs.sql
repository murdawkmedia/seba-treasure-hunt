PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clue_notification_recipients (
  id TEXT PRIMARY KEY,
  notification_job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  hunter_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  correlation_id TEXT,
  provider TEXT,
  provider_reference TEXT,
  provider_reference_kind TEXT,
  accepted_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (notification_job_id, hunter_subject),
  CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND correlation_id IS NOT NULL)
    OR
    (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_notification_job_target
  ON notification_jobs(kind, target_record_id)
  WHERE kind IN ('clue_order_approved', 'clue_released');

CREATE INDEX IF NOT EXISTS idx_clue_notification_recipients_due
  ON clue_notification_recipients(notification_job_id, status, next_attempt_at, created_at, id);

CREATE TRIGGER IF NOT EXISTS trg_clue_notification_job_target_insert
BEFORE INSERT ON notification_jobs
WHEN (
  (NEW.kind = 'clue_order_approved' AND NOT EXISTS (
    SELECT 1 FROM clue_orders WHERE id = NEW.target_record_id AND status = 'approved'
  ))
  OR
  (NEW.kind = 'clue_released' AND NOT EXISTS (
    SELECT 1 FROM clue_events WHERE id = NEW.target_record_id AND action = 'notified'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'clue notification target does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_notification_recipient_job_insert
BEFORE INSERT ON clue_notification_recipients
WHEN NOT EXISTS (
  SELECT 1 FROM notification_jobs
  WHERE id = NEW.notification_job_id
    AND kind IN ('clue_order_approved', 'clue_released')
)
BEGIN
  SELECT RAISE(ABORT, 'clue notification recipient requires a clue notification job');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_notification_recipient_identity_immutable
BEFORE UPDATE OF notification_job_id, hunter_subject, recipient_email
ON clue_notification_recipients
BEGIN
  SELECT RAISE(ABORT, 'clue notification recipient identity is immutable');
END;
