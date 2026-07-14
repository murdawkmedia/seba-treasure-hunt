import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("the first D1 migration covers public, hunter, moderation, report, and staff data", async () => {
  const sql = await readFile(path.resolve("migrations", "0001_hunter_platform.sql"), "utf8");
  const requiredTables = [
    "case_status",
    "official_updates",
    "rules_versions",
    "zones",
    "waypoints",
    "hunter_profiles",
    "consent_events",
    "waypoint_progress",
    "field_notes",
    "field_note_replies",
    "content_flags",
    "media_uploads",
    "private_reports",
    "report_events",
    "staff_principals",
    "feature_flags",
    "notification_jobs",
    "audit_events",
    "idempotency_keys"
  ];

  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}\\b`, "i"), table);
  }
  assert.doesNotMatch(sql, /@sebahub\.com|@businessasaforceforgood\.ca/i);
  assert.doesNotMatch(sql, /(?:latitude|longitude)\s+REAL\s+DEFAULT/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+case_status/i, "status must be operator seeded");
});

test("the environment metadata migration defines one constrained deployment sentinel", async () => {
  const sql = await readFile(path.resolve("migrations", "0004_environment_metadata.sql"), "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS environment_metadata/i);
  assert.match(sql, /CHECK\s*\(environment IN \('validation', 'production'\)\)/i);
  assert.match(sql, /CHECK\s*\(id = 1\)/i);
});

test("the atomic rate-limit migration follows the immutable waiver ledgers and stores no raw identifiers", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.indexOf("0009_atomic_rate_limits.sql") > names.indexOf("0008_immutable_waiver_ledgers.sql"));

  const sql = await readFile(path.resolve("migrations", "0009_atomic_rate_limits.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS campaign_rate_limit_buckets/i);
  assert.match(sql, /PRIMARY KEY\s*\(scope, identifier_hash, window_started_at\)/i);
  assert.match(sql, /CHECK\s*\(\s*length\(identifier_hash\) = 64\s+AND/i);
  assert.match(sql, /CHECK\s*\(request_count >= 1\)/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_campaign_rate_limit_expiry/i);
  assert.doesNotMatch(sql, /ip_address|hunter_subject|email|raw_identifier/i);
});

test("the Graph transactional-email migration adds private encrypted state and delivery evidence", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.indexOf("0010_graph_transactional_email.sql") > names.indexOf("0009_atomic_rate_limits.sql"));

  const sql = await readFile(
    path.resolve("migrations", "0010_graph_transactional_email.sql"),
    "utf8"
  );
  assert.match(
    sql,
    /ALTER TABLE notification_delivery_events ADD COLUMN provider_reference TEXT/i
  );
  assert.match(
    sql,
    /ALTER TABLE notification_delivery_events ADD COLUMN provider_reference_kind TEXT/i
  );
  assert.match(sql, /CREATE TABLE oauth_provider_state/i);
  assert.match(sql, /provider TEXT PRIMARY KEY CHECK \(provider = 'microsoft_graph'\)/i);
  assert.match(sql, /encrypted_refresh_token TEXT NOT NULL/i);
  assert.match(sql, /nonce TEXT NOT NULL/i);
  assert.match(sql, /key_version TEXT NOT NULL/i);
  assert.match(sql, /state_version INTEGER NOT NULL CHECK \(state_version >= 1\)/i);
  assert.match(sql, /created_at TEXT NOT NULL/i);
  assert.match(sql, /updated_at TEXT NOT NULL/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*oauth_provider_state/i);
});

test("the second D1 migration adds the current-consent projection index", async () => {
  const sql = await readFile(path.resolve("migrations", "0002_consent_ledger_index.sql"), "utf8");
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_consent_current\s+ON consent_events\(hunter_subject, consent_type, occurred_at DESC, id DESC\)/i
  );
});

test("the sponsor migration keeps inquiries private and events append-only", async () => {
  const sql = await readFile(path.resolve("migrations", "0005_sponsor_inquiries.sql"), "utf8");
  for (const table of ["sponsor_inquiries", "sponsor_inquiry_events"]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table + "\\b", "i"));
  }
  assert.match(sql, /UNIQUE\s*\(reference_code\)/i);
  assert.match(sql, /UNIQUE\s*\(idempotency_key\)/i);
  assert.match(sql, /CHECK\s*\(support_type IN \('community', 'lead', 'prize_in_kind', 'other'\)\)/i);
  assert.match(
    sql,
    /CHECK\s*\(\s*contribution_range IS NULL OR contribution_range IN \(\s*'not_sure', 'under_1000', '1000_2499', '2500_4999', '5000_plus', 'prefer_to_discuss'\s*\)\s*\)/i
  );
  assert.match(sql, /CHECK\s*\(state IN \('new', 'contacted', 'qualified', 'accepted', 'closed'\)\)/i);
  assert.match(sql, /CHECK\s*\(event_type IN \('submitted', 'state_changed', 'note_added'\)\)/i);
  assert.match(
    sql,
    /from_state\s+TEXT\s+CHECK\s*\(from_state IS NULL OR from_state IN \('new', 'contacted', 'qualified', 'accepted', 'closed'\)\)/i
  );
  assert.match(
    sql,
    /to_state\s+TEXT\s+CHECK\s*\(to_state IS NULL OR to_state IN \('new', 'contacted', 'qualified', 'accepted', 'closed'\)\)/i
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_queue\s+ON sponsor_inquiries\(state, created_at DESC, id DESC\)/i
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_organization\s+ON sponsor_inquiries\(organization COLLATE NOCASE, created_at DESC\)/i
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_sponsor_inquiry_events_ledger\s+ON sponsor_inquiry_events\(inquiry_id, created_at DESC, id DESC\)/i
  );
  assert.match(sql, /FOREIGN KEY\s*\(inquiry_id\).*ON DELETE CASCADE/is);
  assert.doesNotMatch(sql, /ip_address|fingerprint|turnstile_token/i);
});

test("the waiver ledger schema records review, participants, and receipt delivery", async () => {
  const sql = await readFile(
    path.resolve("migrations", "0006_participation_waiver_and_receipts.sql"),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS legal_document_review_events/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS waiver_acceptance_participants/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_delivery_events/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target\s+ON notification_jobs\(kind, target_record_id\)\s+WHERE kind = 'waiver_receipt'/i
  );
  assert.match(
    sql,
    /participant_role TEXT NOT NULL CHECK \(participant_role IN \('adult', 'minor'\)\)/i
  );
  assert.match(sql, /document_type TEXT NOT NULL CHECK \(document_type = 'participation_waiver'\)/i);
  assert.match(sql, /event_type TEXT NOT NULL CHECK \(event_type IN \('queued', 'attempted', 'sent', 'failed', 'requeued'\)\)/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_waiver_participant_acceptance_insert/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_waiver_participant_acceptance_update/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_waiver_receipt_target_insert/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_waiver_receipt_target_update/i);
  assert.match(
    sql,
    /CREATE TRIGGER IF NOT EXISTS trg_legal_acceptance_events_immutable\s+BEFORE UPDATE ON legal_acceptance_events/i
  );
  assert.match(
    sql,
    /CREATE TRIGGER IF NOT EXISTS trg_legal_acceptance_events_immutable_delete\s+BEFORE DELETE ON legal_acceptance_events/i
  );
  assert.match(sql, /CASE WHEN status = 'sent' THEN 0 ELSE 1 END/i);
  assert.match(sql, /attempts DESC/i);
  assert.match(
    sql,
    /UPDATE notification_jobs\s+SET status = 'sent',\s+next_attempt_at = NULL,\s+last_error_code = NULL[\s\S]*event_type = 'sent'/i
  );

  const sentEvidenceAt = sql.search(
    /EXISTS\s*\(\s*SELECT 1\s+FROM notification_delivery_events[\s\S]*event_type = 'sent'/i
  );
  const mutableStatusAt = sql.search(/CASE WHEN status = 'sent' THEN 0 ELSE 1 END/i);
  const reparentAt = sql.search(/UPDATE notification_delivery_events[\s\S]*notification_job_id/i);
  const reconcileAt = sql.search(/DELETE FROM notification_jobs[\s\S]*kind = 'waiver_receipt'/i);
  const uniqueIndexAt = sql.search(/CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target/i);
  assert.ok(sentEvidenceAt >= 0 && sentEvidenceAt < mutableStatusAt, "sent evidence ranks first");
  assert.ok(reparentAt >= 0 && reparentAt < reconcileAt, "delivery history reparents first");
  assert.ok(reconcileAt >= 0 && reconcileAt < uniqueIndexAt, "receipt duplicates reconcile first");
});
