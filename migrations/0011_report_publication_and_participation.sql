PRAGMA foreign_keys = ON;

ALTER TABLE hunter_profiles ADD COLUMN participation_basis TEXT NOT NULL DEFAULT 'adult'
  CHECK (participation_basis IN ('adult', 'minor_guardian_permission'));
ALTER TABLE hunter_profiles ADD COLUMN guardian_permission_attested_at TEXT;

CREATE TRIGGER IF NOT EXISTS trg_hunter_profiles_participation_insert
BEFORE INSERT ON hunter_profiles
WHEN NEW.participation_basis IN ('adult', 'minor_guardian_permission')
  AND NOT (
  (NEW.participation_basis = 'adult' AND NEW.guardian_permission_attested_at IS NULL)
  OR (NEW.participation_basis = 'minor_guardian_permission'
      AND NEW.guardian_permission_attested_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'hunter profile participation and guardian permission are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_hunter_profiles_participation_update
BEFORE UPDATE OF participation_basis, guardian_permission_attested_at ON hunter_profiles
WHEN NEW.participation_basis IN ('adult', 'minor_guardian_permission')
  AND NOT (
  (NEW.participation_basis = 'adult' AND NEW.guardian_permission_attested_at IS NULL)
  OR (NEW.participation_basis = 'minor_guardian_permission'
      AND NEW.guardian_permission_attested_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'hunter profile participation and guardian permission are inconsistent');
END;

ALTER TABLE official_updates ADD COLUMN source_report_id TEXT REFERENCES private_reports(id);
ALTER TABLE official_updates ADD COLUMN public_attribution TEXT;
ALTER TABLE official_updates ADD COLUMN waypoint_id INTEGER REFERENCES waypoints(id);
ALTER TABLE official_updates ADD COLUMN latitude REAL;
ALTER TABLE official_updates ADD COLUMN longitude REAL;

CREATE TRIGGER IF NOT EXISTS trg_official_updates_coordinates_insert
BEFORE INSERT ON official_updates
WHEN NOT (
  (NEW.latitude IS NULL AND NEW.longitude IS NULL)
  OR (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
      AND typeof(NEW.latitude) IN ('integer', 'real')
      AND typeof(NEW.longitude) IN ('integer', 'real')
      AND NEW.latitude BETWEEN -90.0 AND 90.0
      AND NEW.longitude BETWEEN -180.0 AND 180.0)
)
BEGIN
  SELECT RAISE(ABORT, 'official update coordinates are invalid');
END;

CREATE TRIGGER IF NOT EXISTS trg_official_updates_coordinates_update
BEFORE UPDATE OF latitude, longitude ON official_updates
WHEN NOT (
  (NEW.latitude IS NULL AND NEW.longitude IS NULL)
  OR (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
      AND typeof(NEW.latitude) IN ('integer', 'real')
      AND typeof(NEW.longitude) IN ('integer', 'real')
      AND NEW.latitude BETWEEN -90.0 AND 90.0
      AND NEW.longitude BETWEEN -180.0 AND 180.0)
)
BEGIN
  SELECT RAISE(ABORT, 'official update coordinates are invalid');
END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_official_updates_source_report
  ON official_updates(source_report_id)
  WHERE source_report_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS official_update_media (
  update_id TEXT NOT NULL REFERENCES official_updates(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (update_id, media_id)
);

CREATE TRIGGER IF NOT EXISTS trg_official_update_media_integrity_insert
BEFORE INSERT ON official_update_media
WHEN NOT EXISTS (
  SELECT 1
  FROM official_updates AS published_update
  JOIN media_uploads AS media ON media.id = NEW.media_id
  WHERE published_update.id = NEW.update_id
    AND published_update.source_report_id IS NOT NULL
    AND media.owner_kind = 'report'
    AND media.owner_id = published_update.source_report_id
    AND media.status = 'ready'
    AND media.derivative_object_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'official update media must select a ready report derivative');
END;

CREATE TRIGGER IF NOT EXISTS trg_official_update_media_integrity_update
BEFORE UPDATE OF update_id, media_id ON official_update_media
WHEN NOT EXISTS (
  SELECT 1
  FROM official_updates AS published_update
  JOIN media_uploads AS media ON media.id = NEW.media_id
  WHERE published_update.id = NEW.update_id
    AND published_update.source_report_id IS NOT NULL
    AND media.owner_kind = 'report'
    AND media.owner_id = published_update.source_report_id
    AND media.status = 'ready'
    AND media.derivative_object_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'official update media must select a ready report derivative');
END;

CREATE TRIGGER IF NOT EXISTS trg_official_updates_selected_media_integrity
BEFORE UPDATE OF source_report_id ON official_updates
WHEN EXISTS (
  SELECT 1
  FROM official_update_media AS selected
  JOIN media_uploads AS media ON media.id = selected.media_id
  WHERE selected.update_id = OLD.id
    AND (NEW.source_report_id IS NULL
      OR media.owner_kind <> 'report'
      OR media.owner_id <> NEW.source_report_id
      OR media.status <> 'ready'
      OR media.derivative_object_key IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'selected official update media must remain valid');
END;

CREATE TRIGGER IF NOT EXISTS trg_media_uploads_selected_publication_integrity
BEFORE UPDATE OF owner_kind, owner_id, status, derivative_object_key ON media_uploads
WHEN EXISTS (
  SELECT 1
  FROM official_update_media AS selected
  JOIN official_updates AS published_update ON published_update.id = selected.update_id
  WHERE selected.media_id = OLD.id
    AND (published_update.source_report_id IS NULL
      OR NEW.owner_kind <> 'report'
      OR NEW.owner_id <> published_update.source_report_id
      OR NEW.status <> 'ready'
      OR NEW.derivative_object_key IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'selected publication media must remain valid');
END;

CREATE TABLE IF NOT EXISTS waiver_account_participants (
  acceptance_event_id TEXT PRIMARY KEY REFERENCES legal_acceptance_events(id) ON DELETE CASCADE,
  participation_basis TEXT NOT NULL
    CHECK (participation_basis IN ('adult', 'minor_guardian_permission')),
  full_name TEXT NOT NULL,
  guardian_permission_attested INTEGER NOT NULL
    CHECK (guardian_permission_attested IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK ((participation_basis = 'adult' AND guardian_permission_attested = 0)
      OR (participation_basis = 'minor_guardian_permission' AND guardian_permission_attested = 1))
);

CREATE TRIGGER IF NOT EXISTS trg_waiver_account_participants_integrity_insert
BEFORE INSERT ON waiver_account_participants
WHEN NOT EXISTS (
  SELECT 1
  FROM legal_acceptance_events AS acceptance
  JOIN hunter_profiles AS profile ON profile.subject = acceptance.hunter_subject
  WHERE acceptance.id = NEW.acceptance_event_id
    AND acceptance.document_type = 'participation_waiver'
    AND acceptance.action = 'accepted'
    AND profile.participation_basis = NEW.participation_basis
    AND profile.full_name = NEW.full_name
)
BEGIN
  SELECT RAISE(ABORT, 'waiver account participant must match an accepted waiver profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_account_participants_immutable
BEFORE UPDATE ON waiver_account_participants
BEGIN
  SELECT RAISE(ABORT, 'waiver account participants are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_account_participants_immutable_delete
BEFORE DELETE ON waiver_account_participants
BEGIN
  SELECT RAISE(ABORT, 'waiver account participants are immutable');
END;
