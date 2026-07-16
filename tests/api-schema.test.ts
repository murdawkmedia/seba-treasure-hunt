import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("the shared waypoint contract separates stable IDs from public route order", async () => {
  const { routeOrder, waypointId } = await import("../src/shared/waypoints");

  assert.equal(waypointId(1), 1);
  assert.equal(waypointId("13"), 13);
  assert.equal(waypointId(0), null);
  assert.equal(waypointId(14), null);
  assert.equal(routeOrder(1), 1);
  assert.equal(routeOrder("13"), 13);
  assert.equal(routeOrder(0), null);
  assert.equal(routeOrder(14), null);
});

test("the shared waypoint contract rejects coercible non-canonical values", async () => {
  const { routeOrder, waypointId } = await import("../src/shared/waypoints");
  const invalidValues: unknown[] = [
    true,
    false,
    [],
    [1],
    {},
    "",
    "   ",
    "01",
    "+1",
    "-1",
    "1.0",
    "1e1",
    "0xA",
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  assert.equal(waypointId(" 13 "), 13);
  assert.equal(routeOrder(" 1 "), 1);
  for (const value of invalidValues) {
    assert.equal(waypointId(value), null, `waypointId rejected ${String(value)}`);
    assert.equal(routeOrder(value), null, `routeOrder rejected ${String(value)}`);
  }
});

test("the Lucky 13 migration rebuilds waypoints without rewriting child records", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(
    names.indexOf("0012_lucky_13_waypoints.sql") >
      names.indexOf("0011_report_publication_and_participation.sql")
  );

  const sql = await readFile(
    path.resolve("migrations", "0012_lucky_13_waypoints.sql"),
    "utf8"
  );
  assert.match(sql, /route_order INTEGER NOT NULL UNIQUE CHECK \(route_order BETWEEN 1 AND 13\)/i);
  assert.match(sql, /id INTEGER PRIMARY KEY CHECK \(id BETWEEN 1 AND 13\)/i);
  assert.match(sql, /SELECT 13, 5, 'Derby''s Lakeview General Store'/i);
  assert.match(sql, /WHERE id = 4/i);
  assert.doesNotMatch(sql, /UPDATE\s+(?:waypoint_progress|field_notes|private_reports|official_updates)/i);
});

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

test("the report publication migration adds participation and public report relationships", async () => {
  const migration = await readFile(
    path.resolve("migrations", "0011_report_publication_and_participation.sql"),
    "utf8"
  );

  assert.match(migration, /ALTER TABLE hunter_profiles ADD COLUMN participation_basis TEXT/i);
  assert.match(
    migration,
    /ALTER TABLE hunter_profiles ADD COLUMN guardian_permission_attested_at TEXT/i
  );
  assert.match(migration, /ALTER TABLE official_updates ADD COLUMN source_report_id TEXT/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS official_update_media/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS waiver_account_participants/i);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_official_updates_source_report/i
  );
  for (const trigger of [
    "trg_hunter_profiles_participation_insert",
    "trg_hunter_profiles_participation_update",
    "trg_waiver_account_participants_integrity_insert",
    "trg_official_update_media_integrity_insert",
    "trg_official_update_media_integrity_update",
    "trg_official_updates_selected_media_integrity",
    "trg_media_uploads_selected_publication_integrity",
    "trg_official_updates_coordinates_insert",
    "trg_official_updates_coordinates_update"
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\b`, "i"),
      trigger
    );
  }
});

test("the operator submission alert migration defines a durable privacy-safe recipient outbox", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(
    names.indexOf("0013_operator_submission_alerts.sql") >
      names.indexOf("0012_lucky_13_waypoints.sql")
  );

  const sql = await readFile(
    path.resolve("migrations", "0013_operator_submission_alerts.sql"),
    "utf8"
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS operator_alert_recipients/i);
  assert.match(
    sql,
    /CHECK\s*\(status IN \('pending', 'processing', 'sent', 'failed', 'cancelled', 'uncertain'\)\)/i
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_alert_job_target[\s\S]*operator_private_report[\s\S]*operator_field_note_moderation/i
  );
  assert.match(
    sql,
    /UNIQUE\s*\(notification_job_id, staff_principal_id\)/i
  );
  assert.match(sql, /recipient_email TEXT NOT NULL/i);
  assert.match(sql, /lease_token TEXT/i);
  assert.match(sql, /lease_expires_at TEXT/i);
  assert.match(sql, /correlation_id TEXT/i);
  assert.match(sql, /provider_reference TEXT/i);
  assert.match(sql, /provider_reference_kind TEXT/i);
  assert.match(
    sql,
    /CREATE TRIGGER IF NOT EXISTS trg_operator_alert_recipient_identity_immutable/i
  );
  assert.match(
    sql,
    /BEFORE UPDATE OF notification_job_id, staff_principal_id, recipient_email/i
  );
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+operator_alert_recipients/i);
  assert.doesNotMatch(sql, /report_received[\s\S]*(?:UPDATE|DELETE|INSERT)/i);
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
