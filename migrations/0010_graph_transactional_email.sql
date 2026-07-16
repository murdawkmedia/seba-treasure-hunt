ALTER TABLE notification_delivery_events ADD COLUMN provider_reference TEXT;
ALTER TABLE notification_delivery_events ADD COLUMN provider_reference_kind TEXT;

CREATE TABLE oauth_provider_state (
  provider TEXT PRIMARY KEY CHECK (provider = 'microsoft_graph'),
  encrypted_refresh_token TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
