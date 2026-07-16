PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE waypoints_0012 (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 13),
  route_order INTEGER NOT NULL UNIQUE CHECK (route_order BETWEEN 1 AND 13),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  zone_id TEXT REFERENCES zones(id),
  member_exact_url TEXT,
  member_content TEXT,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO waypoints_0012
  (id, route_order, name, description, zone_id, member_exact_url, member_content,
   is_published, updated_at, updated_by)
SELECT id,
       CASE WHEN id <= 4 THEN id ELSE id + 1 END,
       CASE WHEN id = 4 THEN 'Seba Beach Seniors Centre' ELSE name END,
       CASE WHEN id = 4 THEN 'The Seniors Centre portion of Tim''s in-town route.' ELSE description END,
       zone_id,
       CASE WHEN id = 4 THEN 'https://www.google.com/maps/search/?api=1&query=53.5593028,-114.7359167' ELSE member_exact_url END,
       CASE WHEN id = 4 THEN 'Remain on public sidewalks and paths. Do not block doors, parking, the thrift shop, or accessible routes.' ELSE member_content END,
       is_published, updated_at, updated_by
FROM waypoints;

INSERT INTO waypoints_0012
  (id, route_order, name, description, zone_id, member_exact_url, member_content,
   is_published, updated_at, updated_by)
SELECT 13, 5, 'Derby''s Lakeview General Store',
       'Derby''s portion of Tim''s in-town route.', zone_id,
       'https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167',
       'Remain on public sidewalks and paths. Do not block the business, doors, parking, deliveries, or accessible routes.',
       is_published, updated_at, updated_by
FROM waypoints WHERE id = 4;

DROP TABLE waypoints;
ALTER TABLE waypoints_0012 RENAME TO waypoints;

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = OFF;
