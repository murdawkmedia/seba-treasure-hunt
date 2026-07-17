import assert from "node:assert/strict";
import test from "node:test";
import {
  SNAPSHOT_TABLES,
  SNAPSHOT_RESET_ONLY_TABLES,
  buildSnapshotSql,
  defaults,
  redactSnapshotReport,
  orderSnapshotInsertStatements,
  safeWranglerDiagnostic,
  reverseDeleteStatements,
  shouldCleanupUploadedObjects,
  snapshotMediaKey,
  validateResources,
  verifyDestinationSentinel,
  verifySourceSentinel,
} from "../scripts/refresh-production-snapshot.mjs";

test("provider diagnostics retain only safe error classes", () => {
  const error = {
    stdout: "private@example.test secret-token",
    stderr: "Import failed: SQLITE_CONSTRAINT private@example.test",
  };
  assert.equal(safeWranglerDiagnostic(error), "SQLITE_CONSTRAINT");
  assert.equal(safeWranglerDiagnostic({ stderr: "private@example.test secret-token" }), "");
});

test("snapshot inserts are ordered by the dependency-safe allowlist", () => {
  const statements = [
    'INSERT INTO "official_updates" VALUES(\'update-1\');',
    'INSERT INTO "private_reports" VALUES(\'report-1\');',
    'INSERT INTO "waypoints" VALUES(1);',
    'INSERT INTO "zones" VALUES(\'zone-1\');',
    'INSERT INTO "private_reports" VALUES(\'report-2\');',
  ];

  assert.deepEqual(orderSnapshotInsertStatements(statements), [
    statements[3],
    statements[2],
    statements[1],
    statements[4],
    statements[0],
  ]);
});

test("snapshot defaults and allowlists are immutable and exclude operational secrets", () => {
  assert.equal(Object.isFrozen(defaults), true);
  assert.equal(Object.isFrozen(SNAPSHOT_TABLES), true);
  assert.equal(defaults.sourceDatabase, "tim-lost-hunter-platform");
  assert.equal(defaults.destinationDatabase, "tim-lost-hunter-platform-production-snapshot");
  for (const excluded of [
    "oauth_provider_state",
    "notification_jobs",
    "notification_delivery_events",
    "notification_job_leases",
    "operator_alert_recipients",
    "campaign_rate_limit_buckets",
    "idempotency_keys",
    "webhook_events",
  ]) assert.equal(SNAPSHOT_TABLES.includes(excluded), false, excluded);
  assert.equal(SNAPSHOT_RESET_ONLY_TABLES.includes("operator_alert_recipients"), true);
  assert.equal(SNAPSHOT_RESET_ONLY_TABLES.includes("notification_jobs"), true);
  for (const required of [
    "private_reports",
    "media_uploads",
    "player_accounts",
    "hunter_profiles",
    "legal_acceptance_events",
    "waiver_acceptance_participants",
    "waiver_account_participants",
    "staff_principals",
    "audit_events",
  ]) assert.equal(SNAPSHOT_TABLES.includes(required), true, required);
});

test("resource validation refuses unsafe names and database identifier collisions", () => {
  const safe = {
    ...defaults,
    sourceDatabaseId: "source-id",
    destinationDatabaseId: "destination-id",
  };
  assert.deepEqual(validateResources(safe), safe);
  assert.throws(() => validateResources({ ...safe, destinationDatabase: "other" }), /production-snapshot/);
  assert.throws(() => validateResources({ ...safe, destinationBucket: safe.sourceBucket }), /different/);
  assert.throws(() => validateResources({ ...safe, destinationDatabaseId: safe.sourceDatabaseId }), /identifier/);
  assert.throws(() => validateResources({ ...safe, sourceDatabase: "tim-lost-hunter-platform-validation" }), /production source/);
});

test("sentinel guards require production source and production-snapshot destination", () => {
  assert.doesNotThrow(() => verifySourceSentinel({ environment: "production" }));
  assert.throws(() => verifySourceSentinel({ environment: "validation" }), /production/);
  assert.doesNotThrow(() => verifyDestinationSentinel({ kind: "production-snapshot" }));
  assert.throws(() => verifyDestinationSentinel({ kind: "production" }), /production-snapshot/);
});

test("delete order reverses the allowlisted insert order and snapshot keys stay versioned", () => {
  const deletes = reverseDeleteStatements(["parent", "child"]);
  assert.deepEqual(deletes, ["DELETE FROM \"child\";", "DELETE FROM \"parent\";"]);
  assert.equal(
    snapshotMediaKey("snapshot-20260716", "derivatives/report.webp"),
    "snapshots/snapshot-20260716/derivatives/report.webp"
  );
  assert.throws(() => snapshotMediaKey("../bad", "derivatives/report.webp"), /snapshot ID/);
  assert.throws(() => snapshotMediaKey("snapshot-1", "../secret"), /object key/);
});

test("generated replacement SQL is atomic, allowlisted and marks only a verified snapshot", () => {
  const sql = buildSnapshotSql({
    snapshotId: "snapshot-20260716",
    verifiedAt: "2026-07-16T22:00:00.000Z",
    sourceUpdatedAt: "2026-07-16T21:59:00.000Z",
    insertStatements: [
      'INSERT INTO "player_accounts" VALUES(\'hunter-1\',\'private@example.test\');',
      'INSERT INTO "private_reports" VALUES(\'report-1\');',
    ],
    counts: { reports: 1, players: 1, staff: 1, audit: 2, media: 3 },
  });
  assert.match(sql, /^PRAGMA defer_foreign_keys = true;/);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION|COMMIT;/);
  assert.ok(sql.indexOf('INSERT INTO "player_accounts"') < sql.indexOf('INSERT INTO "private_reports"'));
  assert.match(sql, /DROP TRIGGER IF EXISTS "trg_legal_acceptance_events_immutable"/);
  assert.match(sql, /DROP TRIGGER IF EXISTS "trg_legal_document_review_events_immutable_delete"/);
  assert.match(sql, /DROP TRIGGER IF EXISTS "trg_waiver_acceptance_participants_immutable_delete"/);
  assert.match(sql, /DROP TRIGGER IF EXISTS "trg_notification_delivery_events_immutable_delete"/);
  assert.match(sql, /UPDATE media_uploads SET private_object_key = 'snapshots\/snapshot-20260716\/'/);
  assert.match(sql, /'production-snapshot', 'verified'/);
  assert.match(sql, /DELETE FROM "notification_jobs"/);
  assert.match(sql, /DELETE FROM "oauth_provider_state"/);
  assert.doesNotMatch(sql, /INSERT INTO ["`]?notification_jobs|INSERT INTO ["`]?oauth_provider_state/i);
  assert.throws(() => buildSnapshotSql({
    snapshotId: "snapshot-1",
    verifiedAt: "2026-07-16T22:00:00.000Z",
    sourceUpdatedAt: "2026-07-16T21:59:00.000Z",
    insertStatements: ["INSERT INTO oauth_provider_state VALUES ('secret');"],
    counts: { reports: 0, players: 0, staff: 0, audit: 0, media: 0 },
  }), /allowlist/);
});

test("refresh reports expose counts and hashes but redact paths and personal data", () => {
  const report = redactSnapshotReport({
    snapshotId: "snapshot-1",
    status: "verified",
    counts: { reports: 2 },
    objects: [{ key: "private/person.webp", sha256: "abc", bytes: 10 }],
    email: "private@example.test",
  });
  assert.deepEqual(report, {
    snapshotId: "snapshot-1",
    status: "verified",
    counts: { reports: 2 },
    objectCount: 1,
    totalObjectBytes: 10,
  });
  assert.doesNotMatch(JSON.stringify(report), /private@example|person\.webp|sha256/i);
});

test("ambiguous D1 import outcomes never delete media a committed snapshot may reference", () => {
  assert.equal(shouldCleanupUploadedObjects({ importStarted: false, destinationSnapshotId: null }), true);
  assert.equal(shouldCleanupUploadedObjects({ importStarted: true, destinationSnapshotId: "old-snapshot" }), true);
  assert.equal(shouldCleanupUploadedObjects({ importStarted: true, destinationSnapshotId: "snapshot-1", attemptedSnapshotId: "snapshot-1" }), false);
  assert.equal(shouldCleanupUploadedObjects({ importStarted: true, destinationSnapshotId: null, attemptedSnapshotId: "snapshot-1" }), false);
});
