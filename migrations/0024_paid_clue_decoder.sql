PRAGMA foreign_keys = ON;

-- No clue rows are seeded in this migration. Approved private clue copy belongs in
-- the controller-owned seed module so this schema change never invents hunt content.

CREATE TABLE IF NOT EXISTS clues (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE CHECK (typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 30),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  riddle TEXT NOT NULL CHECK (length(trim(riddle)) > 0),
  decoder_explanation TEXT NOT NULL CHECK (length(trim(decoder_explanation)) > 0),
  narrowing_summary TEXT NOT NULL CHECK (length(trim(narrowing_summary)) > 0),
  internal_napkin_note TEXT NOT NULL DEFAULT '',
  internal_numeric_score INTEGER NOT NULL CHECK (
    typeof(internal_numeric_score) = 'integer' AND internal_numeric_score BETWEEN 0 AND 100
  ),
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'ready', 'released', 'retired')),
  decoder_mode TEXT NOT NULL DEFAULT 'paid'
    CHECK (decoder_mode IN ('paid', 'free')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  released_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state != 'released' OR released_at IS NOT NULL),
  CHECK (state != 'retired' OR retired_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_clues_catalogue
  ON clues(state, sequence ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_clues_ops_state
  ON clues(state, decoder_mode, updated_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_clues_sequence_referenced_immutable
BEFORE UPDATE OF sequence ON clues
WHEN NEW.sequence != OLD.sequence
  AND EXISTS (SELECT 1 FROM clue_orders WHERE clue_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'clue sequence is immutable after orders exist');
END;

CREATE TABLE IF NOT EXISTS clue_orders (
  id TEXT PRIMARY KEY,
  clue_id TEXT NOT NULL REFERENCES clues(id) ON DELETE RESTRICT,
  player_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE CHECK (reference GLOB 'TLS-C[0-9][0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'),
  sender_name TEXT CHECK (sender_name IS NULL OR length(trim(sender_name)) > 0),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'waiting_verification', 'approved', 'rejected', 'cancelled')),
  decision_note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  CHECK (
    (status = 'created'
      AND decision_note IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (status = 'waiting_verification'
      AND sender_name IS NOT NULL AND length(trim(sender_name)) > 0
      AND decision_note IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (status IN ('approved', 'rejected')
      AND sender_name IS NOT NULL AND length(trim(sender_name)) > 0
      AND decided_by IS NOT NULL AND length(trim(decided_by)) > 0
      AND decided_at IS NOT NULL AND length(trim(decided_at)) > 0
      AND (status != 'rejected' OR (decision_note IS NOT NULL AND length(trim(decision_note)) > 0)))
    OR
    (status = 'cancelled'
      AND decided_by IS NOT NULL AND length(trim(decided_by)) > 0
      AND decided_at IS NOT NULL AND length(trim(decided_at)) > 0)
  )
);

CREATE TRIGGER IF NOT EXISTS trg_clue_orders_reference_matches_clue_insert
BEFORE INSERT ON clue_orders
WHEN CAST(substr(NEW.reference, 6, 2) AS INTEGER) != (
  SELECT sequence FROM clues WHERE id = NEW.clue_id
)
BEGIN
  SELECT RAISE(ABORT, 'clue order reference must match the clue sequence');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_orders_reference_matches_clue_update
BEFORE UPDATE OF clue_id, reference ON clue_orders
WHEN CAST(substr(NEW.reference, 6, 2) AS INTEGER) != (
  SELECT sequence FROM clues WHERE id = NEW.clue_id
)
BEGIN
  SELECT RAISE(ABORT, 'clue order reference must match the clue sequence');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_orders_state_transition
BEFORE UPDATE OF status ON clue_orders
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'created' AND NEW.status IN ('waiting_verification', 'cancelled'))
  OR (OLD.status = 'waiting_verification' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
  OR (OLD.status IN ('rejected', 'cancelled') AND NEW.status = 'created')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid clue order status transition');
END;

-- Approved orders remain reusable decoder entitlements. Rejected and cancelled
-- order rows can reopen in place; clue_order_events preserves their transition history.
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
  clue_version INTEGER NOT NULL CHECK (typeof(clue_version) = 'integer' AND clue_version >= 1),
  occurred_at TEXT NOT NULL,
  CHECK (
    (action = 'notified' AND notification_key IS NOT NULL AND length(trim(notification_key)) > 0)
    OR (action != 'notified' AND notification_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_clue_events_history
  ON clue_events(clue_id, occurred_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_events_notification_idempotency
  ON clue_events(clue_id, notification_key)
  WHERE action = 'notified' AND notification_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_clue_events_no_update
BEFORE UPDATE ON clue_events
BEGIN
  SELECT RAISE(ABORT, 'clue events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_events_no_replace
BEFORE INSERT ON clue_events
WHEN EXISTS (SELECT 1 FROM clue_events WHERE id = NEW.id)
  OR (NEW.action = 'notified' AND EXISTS (
    SELECT 1 FROM clue_events
    WHERE clue_id = NEW.clue_id AND notification_key = NEW.notification_key
  ))
BEGIN
  SELECT RAISE(ABORT, 'clue event IDs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_events_no_delete
BEFORE DELETE ON clue_events
BEGIN
  SELECT RAISE(ABORT, 'clue events are append-only');
END;

CREATE TABLE IF NOT EXISTS clue_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES clue_orders(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('player', 'staff', 'system')),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'claimed', 'approved', 'rejected', 'cancelled', 'reopened', 'email_notice_sent', 'email_retry')
  ),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  order_version INTEGER NOT NULL CHECK (typeof(order_version) = 'integer' AND order_version >= 1),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clue_order_events_history
  ON clue_order_events(order_id, occurred_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_clue_order_events_no_update
BEFORE UPDATE ON clue_order_events
BEGIN
  SELECT RAISE(ABORT, 'clue order events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_order_events_no_replace
BEFORE INSERT ON clue_order_events
WHEN EXISTS (SELECT 1 FROM clue_order_events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'clue order event IDs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_order_events_no_delete
BEFORE DELETE ON clue_order_events
BEGIN
  SELECT RAISE(ABORT, 'clue order events are append-only');
END;
