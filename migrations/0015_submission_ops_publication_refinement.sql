PRAGMA foreign_keys = ON;

ALTER TABLE private_reports ADD COLUMN public_attribution TEXT;
ALTER TABLE private_reports ADD COLUMN attribution_kind TEXT
  CHECK (attribution_kind IN ('display_name', 'hunter_handle', 'community', 'young_hunter'));
ALTER TABLE hunter_profiles ADD COLUMN public_display_name TEXT;

ALTER TABLE field_notes ADD COLUMN source_report_id TEXT REFERENCES private_reports(id);
ALTER TABLE field_notes ADD COLUMN note_kind TEXT NOT NULL DEFAULT 'community'
  CHECK (note_kind IN ('community', 'operator_reviewed'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_notes_source_report
  ON field_notes(source_report_id) WHERE source_report_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS field_note_selected_media (
  note_id TEXT NOT NULL REFERENCES field_notes(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  alt_text TEXT,
  caption TEXT,
  PRIMARY KEY (note_id, media_id),
  UNIQUE (note_id, position)
);

-- Community Case Notes require a hunter author in the legacy table. This
-- additive record keeps operator-reviewed anonymous reports possible without
-- rebuilding that live table or fabricating a hunter identity.
CREATE TABLE IF NOT EXISTS operator_reviewed_case_notes (
  id TEXT PRIMARY KEY,
  source_report_id TEXT NOT NULL UNIQUE REFERENCES private_reports(id) ON DELETE RESTRICT,
  public_attribution TEXT NOT NULL,
  attribution_kind TEXT NOT NULL
    CHECK (attribution_kind IN ('display_name', 'hunter_handle', 'community', 'young_hunter')),
  waypoint_id INTEGER REFERENCES waypoints(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'withdrawn', 'hidden')),
  created_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  moderated_by TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_reviewed_case_notes_public
  ON operator_reviewed_case_notes(status, published_at DESC);

CREATE TABLE IF NOT EXISTS operator_reviewed_case_note_media (
  note_id TEXT NOT NULL REFERENCES operator_reviewed_case_notes(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  alt_text TEXT,
  caption TEXT,
  PRIMARY KEY (note_id, media_id),
  UNIQUE (note_id, position)
);

ALTER TABLE official_update_media ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_update_media ADD COLUMN alt_text TEXT;
ALTER TABLE official_update_media ADD COLUMN caption TEXT;
ALTER TABLE official_updates ADD COLUMN created_at TEXT;
ALTER TABLE official_updates ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS official_update_uploads (
  id TEXT PRIMARY KEY,
  update_id TEXT NOT NULL REFERENCES official_updates(id) ON DELETE CASCADE,
  uploader_subject TEXT NOT NULL,
  private_object_key TEXT NOT NULL UNIQUE,
  derivative_object_key TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'quarantined', 'rejected', 'deleted')),
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_official_update_uploads_owner
  ON official_update_uploads(update_id, created_at);

CREATE TABLE IF NOT EXISTS official_update_uploaded_media (
  update_id TEXT NOT NULL REFERENCES official_updates(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL REFERENCES official_update_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  alt_text TEXT,
  caption TEXT,
  PRIMARY KEY (update_id, upload_id),
  UNIQUE (update_id, position)
);

CREATE TRIGGER IF NOT EXISTS trg_operator_case_note_media_insert
BEFORE INSERT ON operator_reviewed_case_note_media
WHEN NOT EXISTS (
  SELECT 1
  FROM operator_reviewed_case_notes note
  JOIN media_uploads media ON media.id = NEW.media_id
  WHERE note.id = NEW.note_id
    AND media.owner_kind = 'report'
    AND media.owner_id = note.source_report_id
    AND media.status = 'ready'
    AND media.derivative_object_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'reviewed Case Note media must select a ready source-report derivative');
END;

CREATE TRIGGER IF NOT EXISTS trg_official_update_uploaded_media_insert
BEFORE INSERT ON official_update_uploaded_media
WHEN NOT EXISTS (
  SELECT 1 FROM official_update_uploads upload
  WHERE upload.id = NEW.upload_id
    AND upload.update_id = NEW.update_id
    AND upload.status = 'ready'
    AND upload.derivative_object_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'official Update media must select a ready owned derivative');
END;
