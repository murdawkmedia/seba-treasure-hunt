PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS case_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL CHECK (state IN ('open', 'paused', 'found')),
  hours_open TEXT NOT NULL DEFAULT '09:00',
  hours_close TEXT NOT NULL DEFAULT '20:00',
  timezone TEXT NOT NULL DEFAULT 'America/Edmonton',
  next_clue_title TEXT,
  next_clue_at TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS official_updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  publisher_subject TEXT NOT NULL,
  publisher_name TEXT NOT NULL DEFAULT 'Campaign Ops',
  published_at TEXT NOT NULL,
  scheduled_for TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'scheduled', 'published', 'withdrawn'))
);

CREATE INDEX IF NOT EXISTS idx_updates_public
  ON official_updates(status, published_at DESC);

CREATE TABLE IF NOT EXISTS rules_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
  published_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_one_published
  ON rules_versions(status) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'restricted', 'hazardous', 'temporarily_closed')),
  instruction TEXT NOT NULL,
  geojson TEXT,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  verified_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waypoints (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  zone_id TEXT REFERENCES zones(id),
  member_exact_url TEXT,
  member_content TEXT,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hunter_profiles (
  subject TEXT PRIMARY KEY,
  verified_email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  public_handle TEXT NOT NULL UNIQUE,
  phone TEXT,
  town_area TEXT,
  age_band TEXT,
  interests_json TEXT NOT NULL DEFAULT '[]',
  discovery_source TEXT,
  adult_attested_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_events (
  id TEXT PRIMARY KEY,
  hunter_subject TEXT NOT NULL REFERENCES hunter_profiles(subject) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('hunt_email', 'marketing', 'sms')),
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  policy_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_subject_time
  ON consent_events(hunter_subject, occurred_at DESC);

CREATE TABLE IF NOT EXISTS waypoint_progress (
  hunter_subject TEXT NOT NULL REFERENCES hunter_profiles(subject) ON DELETE CASCADE,
  waypoint_id INTEGER NOT NULL REFERENCES waypoints(id),
  state TEXT NOT NULL CHECK (state IN ('saved', 'visited', 'searched')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (hunter_subject, waypoint_id)
);

CREATE TABLE IF NOT EXISTS field_notes (
  id TEXT PRIMARY KEY,
  author_subject TEXT NOT NULL REFERENCES hunter_profiles(subject),
  waypoint_id INTEGER NOT NULL REFERENCES waypoints(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'hidden')),
  moderation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  moderated_at TEXT,
  moderated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_notes_public
  ON field_notes(status, waypoint_id, published_at DESC);

CREATE TABLE IF NOT EXISTS field_note_revisions (
  id TEXT PRIMARY KEY,
  field_note_id TEXT NOT NULL REFERENCES field_notes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_note_replies (
  id TEXT PRIMARY KEY,
  field_note_id TEXT NOT NULL REFERENCES field_notes(id) ON DELETE CASCADE,
  author_subject TEXT NOT NULL REFERENCES hunter_profiles(subject),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'deleted', 'hidden')),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  moderated_at TEXT,
  moderated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_replies_note
  ON field_note_replies(field_note_id, status, created_at);

CREATE TABLE IF NOT EXISTS content_flags (
  id TEXT PRIMARY KEY,
  reporter_subject TEXT NOT NULL REFERENCES hunter_profiles(subject),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('note', 'reply')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_flags_queue ON content_flags(status, created_at);

CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('field_note', 'report')),
  owner_id TEXT NOT NULL,
  uploader_subject TEXT,
  private_object_key TEXT NOT NULL UNIQUE,
  derivative_object_key TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'quarantined', 'rejected', 'deleted')),
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media_uploads(owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS private_reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL CHECK (report_type IN ('find', 'tip', 'safety')),
  hunter_subject TEXT,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reporter_phone TEXT,
  waypoint_id INTEGER REFERENCES waypoints(id),
  location_description TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'contacted', 'escalated', 'verified', 'rejected', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  assigned_to TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_queue ON private_reports(status, created_at);

CREATE TABLE IF NOT EXISTS report_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES private_reports(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_subject TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_principals (
  id TEXT PRIMARY KEY,
  provider_subject TEXT UNIQUE,
  normalized_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  invited_at TEXT NOT NULL,
  activated_at TEXT,
  last_login_at TEXT,
  authorization_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_record_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error_code TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(occurred_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (provider, event_id)
);
