PRAGMA foreign_keys = ON;

ALTER TABLE clues ADD COLUMN dig_permit_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (dig_permit_enabled IN (0, 1));
ALTER TABLE clues ADD COLUMN dig_zone_id TEXT REFERENCES zones(id) ON DELETE RESTRICT;
ALTER TABLE clues ADD COLUMN dig_instruction TEXT;
ALTER TABLE clues ADD COLUMN dig_max_depth_mm INTEGER
  CHECK (dig_max_depth_mm IS NULL OR (typeof(dig_max_depth_mm) = 'integer' AND dig_max_depth_mm BETWEEN 1 AND 300));
ALTER TABLE clues ADD COLUMN dig_allowed_tools_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dig_allowed_tools_json) AND json_type(dig_allowed_tools_json) = 'array');

ALTER TABLE clue_orders ADD COLUMN tim_payment_confirmed_at TEXT;

-- Existing validation approvals predate the explicit Tim-confirmation control.
-- Preserve them as historical approvals while making every future approval explicit.
UPDATE clue_orders
SET tim_payment_confirmed_at = decided_at
WHERE status = 'approved' AND tim_payment_confirmed_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_clue_orders_tim_confirmation_insert
BEFORE INSERT ON clue_orders
WHEN (NEW.status = 'approved' AND NEW.tim_payment_confirmed_at IS NULL)
  OR (NEW.status != 'approved' AND NEW.tim_payment_confirmed_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'approved clue orders require Tim payment confirmation');
END;

CREATE TRIGGER IF NOT EXISTS trg_clue_orders_tim_confirmation_update
BEFORE UPDATE OF status, tim_payment_confirmed_at ON clue_orders
WHEN (NEW.status = 'approved' AND NEW.tim_payment_confirmed_at IS NULL)
  OR (NEW.status != 'approved' AND NEW.tim_payment_confirmed_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'approved clue orders require Tim payment confirmation');
END;

CREATE TRIGGER IF NOT EXISTS trg_clues_dig_permit_insert
BEFORE INSERT ON clues
WHEN (NEW.dig_permit_enabled = 1 AND (
  NEW.dig_zone_id IS NULL OR length(trim(NEW.dig_zone_id)) = 0
  OR NEW.dig_instruction IS NULL OR length(trim(NEW.dig_instruction)) = 0
  OR NEW.dig_max_depth_mm IS NULL
  OR json_array_length(NEW.dig_allowed_tools_json) = 0
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.dig_allowed_tools_json)
    WHERE type != 'text' OR value NOT IN ('hands', 'hand trowel', 'short beach shovel')
  )
)) OR (NEW.dig_permit_enabled = 0 AND (
  NEW.dig_zone_id IS NOT NULL OR NEW.dig_instruction IS NOT NULL OR NEW.dig_max_depth_mm IS NOT NULL
  OR NEW.dig_allowed_tools_json != '[]'
))
BEGIN
  SELECT RAISE(ABORT, 'controlled digging permit fields are incomplete');
END;

CREATE TRIGGER IF NOT EXISTS trg_clues_dig_permit_update
BEFORE UPDATE OF dig_permit_enabled, dig_zone_id, dig_instruction, dig_max_depth_mm, dig_allowed_tools_json ON clues
WHEN (NEW.dig_permit_enabled = 1 AND (
  NEW.dig_zone_id IS NULL OR length(trim(NEW.dig_zone_id)) = 0
  OR NEW.dig_instruction IS NULL OR length(trim(NEW.dig_instruction)) = 0
  OR NEW.dig_max_depth_mm IS NULL
  OR json_array_length(NEW.dig_allowed_tools_json) = 0
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.dig_allowed_tools_json)
    WHERE type != 'text' OR value NOT IN ('hands', 'hand trowel', 'short beach shovel')
  )
)) OR (NEW.dig_permit_enabled = 0 AND (
  NEW.dig_zone_id IS NOT NULL OR NEW.dig_instruction IS NOT NULL OR NEW.dig_max_depth_mm IS NOT NULL
  OR NEW.dig_allowed_tools_json != '[]'
))
BEGIN
  SELECT RAISE(ABORT, 'controlled digging permit fields are incomplete');
END;
