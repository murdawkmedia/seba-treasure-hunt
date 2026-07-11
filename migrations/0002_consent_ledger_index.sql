CREATE INDEX IF NOT EXISTS idx_consent_current
  ON consent_events(hunter_subject, consent_type, occurred_at DESC, id DESC);
