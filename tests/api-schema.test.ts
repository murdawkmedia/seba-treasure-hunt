import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("the publication refinement migration is additive and supports anonymous reviewed reports", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(
    names.indexOf("0015_submission_ops_publication_refinement.sql") >
      names.indexOf("0014_park_office_check_in_guidance.sql")
  );
  const sql = await readFile(
    path.resolve("migrations", "0015_submission_ops_publication_refinement.sql"),
    "utf8"
  );
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN public_attribution TEXT/i);
  assert.match(sql, /ALTER TABLE hunter_profiles ADD COLUMN public_display_name TEXT/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? operator_reviewed_case_notes/i);
  assert.match(sql, /source_report_id TEXT NOT NULL UNIQUE REFERENCES private_reports/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? operator_reviewed_case_note_media/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? official_update_uploads/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? official_update_uploaded_media/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE\s+(?:private_reports|field_notes|official_updates)/i);
});

test("shared publication contracts reject invented destinations and states", async () => {
  const publication = await import("../src/shared/publication");
  assert.equal(publication.isPublicationDestination("private"), true);
  assert.equal(publication.isPublicationDestination("case_note"), true);
  assert.equal(publication.isPublicationDestination("official_update"), true);
  assert.equal(publication.isPublicationDestination("social_media"), false);
  assert.equal(publication.isPublicAttributionKind("young_hunter"), true);
  assert.equal(publication.isOfficialUpdateState("scheduled"), true);
  assert.equal(publication.isOfficialUpdateState("queued"), false);
});

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

test("the park guidance migration keeps the horseshoe area restricted and requires office check-in", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(
    names.indexOf("0014_park_office_check_in_guidance.sql") >
      names.indexOf("0013_operator_submission_alerts.sql")
  );

  const sql = await readFile(
    path.resolve("migrations", "0014_park_office_check_in_guidance.sql"),
    "utf8"
  );
  assert.match(sql, /zone-rv-horseshoe-restricted/i);
  assert.match(sql, /'restricted'/i);
  assert.match(sql, /remains restricted/i);
  assert.match(sql, /check in with office staff/i);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/i);
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

test("the paid clue decoder migration adds constrained clue, order, and audit ledgers without seeding copy", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(
    names.indexOf("0024_paid_clue_decoder.sql") > names.indexOf("0023_service_api_keys.sql")
  );

  const sql = await readFile(
    path.resolve("migrations", "0024_paid_clue_decoder.sql"),
    "utf8"
  );

  for (const table of ["clues", "clue_orders", "clue_events", "clue_order_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"), table);
  }

  assert.match(sql, /sequence INTEGER NOT NULL UNIQUE CHECK \(sequence BETWEEN 1 AND 30\)/i);
  assert.match(sql, /state TEXT NOT NULL DEFAULT 'draft'\s+CHECK \(state IN \('draft', 'ready', 'released', 'retired'\)\)/i);
  assert.match(sql, /decoder_mode TEXT NOT NULL DEFAULT 'paid'\s+CHECK \(decoder_mode IN \('paid', 'free'\)\)/i);
  assert.match(sql, /version INTEGER NOT NULL DEFAULT 1 CHECK \(version >= 1\)/i);
  assert.match(sql, /retired_at IS NULL OR released_at IS NOT NULL/i);

  assert.match(sql, /clue_id TEXT NOT NULL REFERENCES clues\(id\) ON DELETE RESTRICT/i);
  assert.match(sql, /player_subject TEXT NOT NULL REFERENCES player_accounts\(subject\) ON DELETE RESTRICT/i);
  assert.match(sql, /reference TEXT NOT NULL UNIQUE CHECK \(reference GLOB 'TLS-C\[0-9\]\[0-9\]-\[A-Z0-9\]\[A-Z0-9\]\[A-Z0-9\]\[A-Z0-9\]'\)/i);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'created'\s+CHECK \(status IN \('created', 'waiting_verification', 'approved', 'rejected', 'cancelled'\)\)/i);
  assert.match(sql, /sender_name TEXT CHECK \(sender_name IS NULL OR length\(trim\(sender_name\)\) > 0\)/i);
  assert.doesNotMatch(sql, /sender_name TEXT NOT NULL/i);
  assert.match(
    sql,
    /CHECK \(\s*status IN \('created', 'cancelled'\)\s+OR \(sender_name IS NOT NULL AND length\(trim\(sender_name\)\) > 0\)\s*\)/i
  );
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_orders_one_active_per_player_clue\s+ON clue_orders\(player_subject, clue_id\)\s+WHERE status IN \('created', 'waiting_verification', 'approved'\)/i);
  assert.match(sql, /decision_note TEXT/i);
  assert.match(sql, /decided_by TEXT/i);
  assert.match(sql, /decided_at TEXT/i);

  assert.match(sql, /action TEXT NOT NULL CHECK\s*\(\s*action IN \('created', 'edited', 'state_changed', 'released', 'retracted', 'decoder_mode_changed', 'notified'\)\s*\)/i);
  assert.match(sql, /action TEXT NOT NULL CHECK\s*\(\s*action IN \('created', 'claimed', 'approved', 'rejected', 'cancelled', 'reopened', 'email_notice_sent', 'email_retry'\)\s*\)/i);
  assert.match(sql, /actor_type TEXT NOT NULL CHECK \(actor_type IN \('player', 'staff', 'system'\)\)/i);
  assert.match(sql, /details_json TEXT NOT NULL DEFAULT '\{\}' CHECK \(json_valid\(details_json\)\)/i);
  assert.match(sql, /clue_version INTEGER NOT NULL CHECK \(clue_version >= 1\)/i);
  assert.match(sql, /order_version INTEGER NOT NULL CHECK \(order_version >= 1\)/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_clue_events_notification_idempotency[\s\S]*WHERE action = 'notified' AND notification_key IS NOT NULL/i);

  for (const [trigger, table, operation] of [
    ["trg_clue_events_no_update", "clue_events", "UPDATE"],
    ["trg_clue_events_no_delete", "clue_events", "DELETE"],
    ["trg_clue_order_events_no_update", "clue_order_events", "UPDATE"],
    ["trg_clue_order_events_no_delete", "clue_order_events", "DELETE"]
  ]) {
    assert.match(
      sql,
      new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\s+BEFORE ${operation} ON ${table}`, "i"),
      trigger
    );
  }
  assert.match(sql, /RAISE\(ABORT, 'clue events are append-only'\)/i);
  assert.match(sql, /RAISE\(ABORT, 'clue order events are append-only'\)/i);

  for (const index of [
    "idx_clues_catalogue",
    "idx_clues_ops_state",
    "idx_clue_orders_player",
    "idx_clue_orders_queue",
    "idx_clue_events_history",
    "idx_clue_order_events_history"
  ]) {
    assert.match(sql, new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${index}\\b`, "i"), index);
  }

  assert.match(sql, /No clue rows are seeded in this migration/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+clues\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE|DROP TABLE|DELETE FROM/i);
  assert.doesNotMatch(sql, /bank(?:ing)?|routing_number|account_number|iban|swift|card_number|cvv/i);
});
