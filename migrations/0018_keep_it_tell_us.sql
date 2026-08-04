PRAGMA foreign_keys = ON;

ALTER TABLE case_items ADD COLUMN close_on_find INTEGER NOT NULL DEFAULT 0
  CHECK (close_on_find IN (0, 1));

ALTER TABLE private_reports ADD COLUMN custom_item_name TEXT;
ALTER TABLE private_reports ADD COLUMN publication_preference TEXT NOT NULL DEFAULT 'private'
  CHECK (publication_preference IN ('share_after_review', 'private'));
ALTER TABLE private_reports ADD COLUMN sharing_notice_version TEXT;
ALTER TABLE private_reports ADD COLUMN sharing_notice_accepted_at TEXT;

UPDATE case_items SET close_on_find = 1
WHERE id IN (
  'case-item-rings',
  'case-item-camera',
  'case-item-watch',
  'case-item-purse',
  'case-item-toy-car',
  'case-item-jewellery-assortment',
  'case-item-packaged-miniatures',
  'case-item-boxed-collectible',
  'case-item-wallet',
  'case-item-beaded-mystery',
  'case-item-gold-tone-jewellery',
  'case-item-spider-brooch',
  'case-item-analog-watch',
  'case-item-sunglasses',
  'case-item-mystery-box',
  'case-item-games-media',
  'case-item-assorted-mystery'
);

UPDATE case_items SET close_on_find = 0 WHERE id = 'case-item-cash';
UPDATE case_items SET close_on_find = 0 WHERE id = 'case-item-golf-balls';

UPDATE waypoints
SET name = 'The Driving Range & Brewing at Seba',
    description = 'The driving range and Brewing at Seba portion of Tim''s route.',
    updated_at = '2026-08-02T12:00:00.000Z',
    updated_by = 'system:migration:0018'
WHERE id = 10 AND route_order = 11;

CREATE TRIGGER IF NOT EXISTS trg_case_item_case_note_close_guard
BEFORE INSERT ON case_item_events
WHEN NEW.action = 'case_item.found_from_case_note'
  AND NOT EXISTS (
    SELECT 1 FROM case_items item
    WHERE item.id = NEW.item_id
      AND item.close_on_find = 1
      AND item.status = 'found'
      AND item.version = NEW.item_version
  )
BEGIN
  SELECT RAISE(ABORT, 'case item close-on-find version conflict');
END;
