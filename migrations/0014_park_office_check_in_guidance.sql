PRAGMA foreign_keys = ON;

INSERT INTO zones (
  id,
  slug,
  label,
  state,
  instruction,
  geojson,
  is_published,
  version,
  verified_at,
  updated_at,
  updated_by
)
VALUES (
  'zone-rv-horseshoe-restricted',
  'rv-horseshoe-restricted',
  'RV guest and horseshoe-pit area',
  'restricted',
  'The RV guest and trailer area near the horseshoe pit remains restricted. If you plan to go beyond the public approach and enter the park, first check in with office staff and follow their directions.',
  NULL,
  1,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'migration:park-office-check-in-guidance'
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  label = excluded.label,
  state = 'restricted',
  instruction = excluded.instruction,
  is_published = 1,
  version = zones.version + 1,
  verified_at = excluded.verified_at,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
