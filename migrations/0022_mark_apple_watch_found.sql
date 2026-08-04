INSERT OR IGNORE INTO case_item_events
  (id, item_id, actor_subject, action, from_status, to_status,
   item_version, details_json, occurred_at)
SELECT
  'case-item-watch-found-0022',
  id,
  'system:migration:0022',
  'case_item.marked_found_release',
  status,
  'found',
  version + 1,
  '{"source":"confirmed-find"}',
  '2026-08-04T16:00:00.000Z'
FROM case_items
WHERE id = 'case-item-watch'
  AND status <> 'found';

UPDATE case_items
SET status = 'found',
    description = 'Found. Its finder has it.',
    version = version + 1,
    updated_at = '2026-08-04T16:00:00.000Z',
    updated_by = 'system:migration:0022'
WHERE id = 'case-item-watch'
  AND status <> 'found';

UPDATE case_items
SET description = 'Found. Its finder has it.'
WHERE id = 'case-item-watch'
  AND status = 'found'
  AND description = 'An Apple Watch is now somewhere in the search area. The finder keeps it.';

INSERT OR IGNORE INTO audit_events
  (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
SELECT
  'audit-case-item-watch-found-0022',
  'system:migration:0022',
  'case_item.marked_found_release',
  'case_item',
  'case-item-watch',
  '{"source":"confirmed-find"}',
  '2026-08-04T16:00:00.000Z'
FROM case_items
WHERE id = 'case-item-watch'
  AND status = 'found'
  AND updated_by = 'system:migration:0022'
  AND updated_at = '2026-08-04T16:00:00.000Z';
