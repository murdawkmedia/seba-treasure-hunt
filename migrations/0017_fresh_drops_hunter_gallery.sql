PRAGMA foreign_keys = ON;

ALTER TABLE case_items ADD COLUMN collection TEXT NOT NULL DEFAULT 'case'
  CHECK (collection IN ('case', 'fresh_drops'));
ALTER TABLE case_items ADD COLUMN collection_order INTEGER
  CHECK (collection_order IS NULL OR collection_order BETWEEN 0 AND 999);
ALTER TABLE case_items ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK (audience IN ('public', 'hunter_only'));
ALTER TABLE case_items ADD COLUMN show_on_board INTEGER NOT NULL DEFAULT 1
  CHECK (show_on_board IN (0, 1));
ALTER TABLE case_items ADD COLUMN teaser_order INTEGER
  CHECK (teaser_order IS NULL OR teaser_order IN (1, 2));
ALTER TABLE case_items ADD COLUMN reportable INTEGER NOT NULL DEFAULT 1
  CHECK (reportable IN (0, 1));

ALTER TABLE case_item_media ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK (audience IN ('public', 'hunter_only'));
ALTER TABLE case_item_uploads ADD COLUMN source_sha256 TEXT
  CHECK (source_sha256 IS NULL OR length(source_sha256) = 64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_item_upload_source
  ON case_item_uploads(item_id, source_sha256)
  WHERE source_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_item_teaser_order
  ON case_items(teaser_order)
  WHERE teaser_order IS NOT NULL;

ALTER TABLE private_reports ADD COLUMN case_item_id TEXT
  REFERENCES case_items(id) ON DELETE RESTRICT;
ALTER TABLE private_reports ADD COLUMN case_item_title_snapshot TEXT;

CREATE TRIGGER IF NOT EXISTS trg_case_item_private_placement_insert
BEFORE INSERT ON case_items
WHEN NEW.audience != 'public'
  AND (NEW.show_on_board = 1 OR NEW.teaser_order IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'hunter-only items cannot have public placement');
END;

CREATE TRIGGER IF NOT EXISTS trg_case_item_private_placement_update
BEFORE UPDATE OF audience, show_on_board, teaser_order ON case_items
WHEN NEW.audience != 'public'
  AND (NEW.show_on_board = 1 OR NEW.teaser_order IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'hunter-only items cannot have public placement');
END;

UPDATE case_items
SET collection = 'fresh_drops',
    collection_order = 1,
    audience = 'public',
    show_on_board = 1,
    teaser_order = 1
WHERE id = 'case-item-camera';

UPDATE case_items
SET collection = 'fresh_drops',
    collection_order = 2,
    audience = 'public',
    show_on_board = 1,
    teaser_order = NULL
WHERE id = 'case-item-watch';
