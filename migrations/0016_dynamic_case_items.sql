PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS case_items (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL CHECK (owner IN ('tim', 'casey')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  finder_keeps INTEGER NOT NULL DEFAULT 0 CHECK (finder_keeps IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'out_there', 'found', 'paused', 'archived')),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 999),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_items_public
  ON case_items(status, display_order, id);

CREATE TABLE IF NOT EXISTS case_item_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES case_items(id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  item_version INTEGER NOT NULL CHECK (item_version >= 1),
  details_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_item_events_item
  ON case_item_events(item_id, occurred_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_case_item_events_no_update
BEFORE UPDATE ON case_item_events
BEGIN
  SELECT RAISE(ABORT, 'case item events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_case_item_events_no_delete
BEFORE DELETE ON case_item_events
BEGIN
  SELECT RAISE(ABORT, 'case item events are append-only');
END;

CREATE TABLE IF NOT EXISTS case_item_uploads (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES case_items(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_case_item_uploads_owner
  ON case_item_uploads(item_id, created_at, id);

CREATE TABLE IF NOT EXISTS case_item_media (
  item_id TEXT NOT NULL REFERENCES case_items(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL REFERENCES case_item_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
  alt_text TEXT NOT NULL,
  caption TEXT,
  PRIMARY KEY (item_id, upload_id),
  UNIQUE (item_id, position)
);

CREATE TRIGGER IF NOT EXISTS trg_case_item_media_integrity_insert
BEFORE INSERT ON case_item_media
WHEN NOT EXISTS (
  SELECT 1 FROM case_item_uploads upload
  WHERE upload.id = NEW.upload_id
    AND upload.item_id = NEW.item_id
    AND upload.status = 'ready'
    AND upload.derivative_object_key IS NOT NULL
    AND upload.content_type IN ('image/jpeg', 'image/png', 'image/webp')
)
BEGIN
  SELECT RAISE(ABORT, 'case item media must select a ready item derivative');
END;

CREATE TRIGGER IF NOT EXISTS trg_case_item_media_integrity_update
BEFORE UPDATE OF item_id, upload_id ON case_item_media
WHEN NOT EXISTS (
  SELECT 1 FROM case_item_uploads upload
  WHERE upload.id = NEW.upload_id
    AND upload.item_id = NEW.item_id
    AND upload.status = 'ready'
    AND upload.derivative_object_key IS NOT NULL
    AND upload.content_type IN ('image/jpeg', 'image/png', 'image/webp')
)
BEGIN
  SELECT RAISE(ABORT, 'case item media must select a ready item derivative');
END;

INSERT OR IGNORE INTO case_items
  (id, slug, owner, category, title, description, finder_keeps, status,
   display_order, version, created_at, updated_at, updated_by)
VALUES
  ('case-item-id', 'tims-id', 'tim', 'identity', 'Tim''s ID',
   'Found. Tim has the ID back.', 0, 'found', 1, 1,
   '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-cash', 'cash', 'tim', 'cash', 'Cash keeps appearing',
   'The original amount was roughly $5,000. The amount now believed to be out there is approaching $10,000, but it is not an exact guarantee.',
   1, 'out_there', 2, 1, '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-rings', 'diamond-rings', 'tim', 'jewellery', 'Two diamond rings',
   'Both rings remain out there in separate baggies.', 1, 'out_there', 3, 1,
   '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-camera', 'camera', 'tim', 'prize', 'A camera',
   'A camera is now somewhere in the search area. The finder keeps it.', 1, 'out_there', 4, 1,
   '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-watch', 'apple-watch', 'tim', 'prize', 'An Apple Watch',
   'An Apple Watch is now somewhere in the search area. The finder keeps it.', 1, 'out_there', 5, 1,
   '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-purse', 'purse', 'tim', 'prize', 'A fancy purse',
   'A fancy purse is now somewhere in the search area. The finder keeps it.', 1, 'out_there', 6, 1,
   '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016'),
  ('case-item-golf-balls', 'golf-balls', 'casey', 'festival', 'Casey''s marked golf balls',
   'Only golf balls displaying the orange In the Woods logo qualify. Return a qualifying ball to Casey to redeem the current ticket offer.',
   0, 'out_there', 7, 1, '2026-07-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z', 'system:migration:0016');

INSERT OR IGNORE INTO case_item_events
  (id, item_id, actor_subject, action, from_status, to_status, item_version, details_json, occurred_at)
SELECT
  'case-item-seed-' || id,
  id,
  'system:migration:0016',
  'case_item.seeded',
  NULL,
  status,
  version,
  '{"source":"approved-plan"}',
  created_at
FROM case_items
WHERE updated_by = 'system:migration:0016';
