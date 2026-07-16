PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sponsor_inquiries (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  organization TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  support_type TEXT NOT NULL CHECK (support_type IN ('community', 'lead', 'prize_in_kind', 'other')),
  contribution_range TEXT CHECK (
    contribution_range IS NULL OR contribution_range IN (
      'not_sure', 'under_1000', '1000_2499', '2500_4999', '5000_plus', 'prefer_to_discuss'
    )
  ),
  desired_outcome TEXT NOT NULL,
  acknowledgement_version TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new'
    CHECK (state IN ('new', 'contacted', 'qualified', 'accepted', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reference_code),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_queue
  ON sponsor_inquiries(state, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_organization
  ON sponsor_inquiries(organization COLLATE NOCASE, created_at DESC);

CREATE TABLE IF NOT EXISTS sponsor_inquiry_events (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL,
  actor_subject TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'state_changed', 'note_added')),
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('new', 'contacted', 'qualified', 'accepted', 'closed')),
  to_state TEXT CHECK (to_state IS NULL OR to_state IN ('new', 'contacted', 'qualified', 'accepted', 'closed')),
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inquiry_id) REFERENCES sponsor_inquiries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiry_events_ledger
  ON sponsor_inquiry_events(inquiry_id, created_at DESC, id DESC);
