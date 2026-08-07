PRAGMA foreign_keys = ON;

-- No clue rows are seeded in this migration. Approved private clue copy belongs in
-- the controller-owned seed module so this schema change never invents hunt content.

CREATE TABLE IF NOT EXISTS clues (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence BETWEEN 1 AND 30),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  riddle TEXT NOT NULL CHECK (length(trim(riddle)) > 0),
  decoder_explanation TEXT NOT NULL CHECK (length(trim(decoder_explanation)) > 0),
  narrowing_summary TEXT NOT NULL CHECK (length(trim(narrowing_summary)) > 0),
  internal_napkin_note TEXT NOT NULL DEFAULT '',
  internal_numeric_score INTEGER NOT NULL CHECK (internal_numeric_score >= 0),
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'ready', 'released', 'retired')),
  decoder_mode TEXT NOT NULL DEFAULT 'paid'
    CHECK (decoder_mode IN ('paid', 'free')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  released_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state != 'released' OR released_at IS NOT NULL),
  CHECK (state != 'retired' OR retired_at IS NOT NULL),
  CHECK (retired_at IS NULL OR released_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_clues_catalogue
  ON clues(state, sequence ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_clues_ops_state
  ON clues(state, decoder_mode, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS clue_orders (
  id TEXT PRIMARY KEY,
  clue_id TEXT NOT NULL REFERENCES clues(id) ON DELETE RESTRICT,
  player_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE CHECK (reference GLOB 'TLS-C[0-9][0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'),
  sender_name TEXT NOT NULL CHECK (length(trim(sender_name)) > 0),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'waiting_verification', 'approved', 'rejected', 'cancelled')),
  decision_note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    status NOT IN ('approved', 'rejected', 'cancelled')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

-- Approved orders remain reusable decoder entitlements. Rejected and cancelled
-- rows stay as history, but do not prevent a later reopen from creating one new
-- active order for the same hunter and clue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_orders_one_active_per_player_clue
  ON clue_orders(player_subject, clue_id)
  WHERE status IN ('created', 'waiting_verification', 'approved');

CREATE INDEX IF NOT EXISTS idx_clue_orders_player
  ON clue_orders(player_subject, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_clue_orders_queue
  ON clue_orders(status, updated_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS clue_events (
  id TEXT PRIMARY KEY,
  clue_id TEXT NOT NULL REFERENCES clues(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('player', 'staff', 'system')),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'edited', 'state_changed', 'released', 'retracted', 'decoder_mode_changed', 'notified')
  ),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  notification_key TEXT,
  clue_version INTEGER NOT NULL CHECK (clue_version >= 1),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clue_events_history
  ON clue_events(clue_id, occurred_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_events_notification_idempotency
  ON clue_events(clue_id, notification_key)
  WHERE action = 'notified' AND notification_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS clue_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES clue_orders(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('player', 'staff', 'system')),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'claimed', 'approved', 'rejected', 'cancelled', 'reopened', 'email_notice_sent', 'email_retry')
  ),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  order_version INTEGER NOT NULL CHECK (order_version >= 1),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clue_order_events_history
  ON clue_order_events(order_id, occurred_at DESC, id DESC);
