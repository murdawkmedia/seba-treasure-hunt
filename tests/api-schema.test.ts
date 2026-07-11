import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("the second D1 migration adds the current-consent projection index", async () => {
  const sql = await readFile(path.resolve("migrations", "0002_consent_ledger_index.sql"), "utf8");
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_consent_current\s+ON consent_events\(hunter_subject, consent_type, occurred_at DESC, id DESC\)/i
  );
});
