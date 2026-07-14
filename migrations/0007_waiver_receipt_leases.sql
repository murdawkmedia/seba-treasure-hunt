PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notification_job_leases (
  notification_job_id TEXT PRIMARY KEY REFERENCES notification_jobs(id) ON DELETE CASCADE,
  lease_token TEXT NOT NULL,
  attempt_generation INTEGER NOT NULL,
  lease_until TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_job_lease_until
  ON notification_job_leases(lease_until);
