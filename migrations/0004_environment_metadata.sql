PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS environment_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  environment TEXT NOT NULL CHECK (environment IN ('validation', 'production')),
  initialized_at TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
