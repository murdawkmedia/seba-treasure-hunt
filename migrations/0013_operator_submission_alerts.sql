PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operator_alert_recipients (
  id TEXT PRIMARY KEY,
  notification_job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  staff_principal_id TEXT NOT NULL REFERENCES staff_principals(id) ON DELETE RESTRICT,
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
  UNIQUE (notification_job_id, staff_principal_id),
  CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND correlation_id IS NOT NULL)
    OR
    (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_alert_job_target
  ON notification_jobs(kind, target_record_id)
  WHERE kind IN ('operator_private_report', 'operator_field_note_moderation');

CREATE INDEX IF NOT EXISTS idx_operator_alert_recipients_due
  ON operator_alert_recipients(notification_job_id, status, next_attempt_at, created_at, id);

CREATE INDEX IF NOT EXISTS idx_operator_alert_recipients_staff
  ON operator_alert_recipients(staff_principal_id, status, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_operator_alert_job_target_insert
BEFORE INSERT ON notification_jobs
WHEN (
  (NEW.kind = 'operator_private_report' AND NOT EXISTS (
    SELECT 1 FROM private_reports WHERE id = NEW.target_record_id
  ))
  OR
  (NEW.kind = 'operator_field_note_moderation' AND NOT EXISTS (
    SELECT 1 FROM field_notes WHERE id = NEW.target_record_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'operator alert target does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_alert_job_target_update
BEFORE UPDATE OF kind, target_record_id ON notification_jobs
WHEN (
  (NEW.kind = 'operator_private_report' AND NOT EXISTS (
    SELECT 1 FROM private_reports WHERE id = NEW.target_record_id
  ))
  OR
  (NEW.kind = 'operator_field_note_moderation' AND NOT EXISTS (
    SELECT 1 FROM field_notes WHERE id = NEW.target_record_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'operator alert target does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_alert_recipient_job_insert
BEFORE INSERT ON operator_alert_recipients
WHEN NOT EXISTS (
  SELECT 1 FROM notification_jobs
  WHERE id = NEW.notification_job_id
    AND kind IN ('operator_private_report', 'operator_field_note_moderation')
)
BEGIN
  SELECT RAISE(ABORT, 'operator alert recipient requires an operator alert job');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_alert_recipient_identity_immutable
BEFORE UPDATE OF notification_job_id, staff_principal_id, recipient_email
ON operator_alert_recipients
BEGIN
  SELECT RAISE(ABORT, 'operator alert recipient identity is immutable');
END;
