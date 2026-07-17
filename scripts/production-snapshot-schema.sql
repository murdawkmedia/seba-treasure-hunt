CREATE TABLE IF NOT EXISTS snapshot_refresh_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kind TEXT NOT NULL CHECK (kind = 'production-snapshot'),
  status TEXT NOT NULL CHECK (status IN ('empty', 'copying', 'verified', 'failed')),
  snapshot_id TEXT,
  source_environment TEXT NOT NULL CHECK (source_environment = 'production'),
  verified_at TEXT,
  source_updated_at TEXT,
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  player_count INTEGER NOT NULL DEFAULT 0 CHECK (player_count >= 0),
  staff_count INTEGER NOT NULL DEFAULT 0 CHECK (staff_count >= 0),
  audit_count INTEGER NOT NULL DEFAULT 0 CHECK (audit_count >= 0),
  media_count INTEGER NOT NULL DEFAULT 0 CHECK (media_count >= 0)
);

INSERT OR IGNORE INTO snapshot_refresh_metadata
  (id, kind, status, snapshot_id, source_environment, verified_at, source_updated_at,
   report_count, player_count, staff_count, audit_count, media_count)
VALUES
  (1, 'production-snapshot', 'empty', NULL, 'production', NULL, NULL, 0, 0, 0, 0, 0);
