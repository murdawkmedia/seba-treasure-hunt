import assert from "node:assert/strict";
import test from "node:test";
import { D1ProductionSnapshotStore } from "../src/server/production-snapshot";

type Row = Record<string, unknown>;

class SnapshotStatement {
  bindings: unknown[] = [];

  constructor(
    private readonly database: SnapshotD1,
    readonly sql: string
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    return this.database.first(this.sql, this.bindings) as T | null;
  }

  async all<T>() {
    return { results: this.database.all(this.sql, this.bindings) as T[] };
  }
}

class SnapshotD1 {
  statements: SnapshotStatement[] = [];
  metadata: Row | null = {
    kind: "production-snapshot",
    status: "verified",
    snapshot_id: "snapshot-20260716",
    source_environment: "production",
    verified_at: "2026-07-16T22:00:00.000Z",
    source_updated_at: "2026-07-16T21:59:00.000Z",
    report_count: 1,
    player_count: 1,
    staff_count: 1,
    audit_count: 1,
    media_count: 1
  };

  prepare(sql: string) {
    const statement = new SnapshotStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  first(sql: string, bindings: unknown[]): Row | null {
    if (sql.includes("snapshot_refresh_metadata")) return this.metadata;
    if (sql.includes("FROM private_reports") && bindings[0] === "report-1") {
      return {
        id: "report-1",
        report_type: "tip",
        reporter_name: "Private Hunter",
        reporter_email: "hunter@example.test",
        reporter_phone: "7805550100",
        location_description: "Near the signed trail",
        details: "Private evidence detail",
        participation_basis: "adult"
      };
    }
    if (sql.includes("FROM media_uploads")) {
      return {
        derivative_object_key: "snapshots/snapshot-20260716/derivatives/report-1.webp",
        content_type: "image/webp"
      };
    }
    if (sql.includes("FROM legal_acceptance_events")) {
      return {
        id: "waiver-1",
        hunter_subject: "hunter-1",
        document_version: "2026.1",
        document_hash: "hash",
        action: "accepted",
        accepted_at: "2026-07-16T20:00:00.000Z"
      };
    }
    return null;
  }

  all(sql: string, _bindings: unknown[]): Row[] {
    if (sql.includes("FROM private_reports")) return [{ id: "report-1", reporter_email: "hunter@example.test" }];
    if (sql.includes("FROM player_accounts")) return [{ subject: "hunter-1", verified_email: "hunter@example.test" }];
    if (sql.includes("FROM staff_principals")) return [{ id: "staff-1", normalized_email: "tech@sebahub.com" }];
    if (sql.includes("FROM audit_events")) return [{ id: "audit-1", action: "report.created" }];
    return [];
  }
}

const storeFor = (database = new SnapshotD1()) => ({
  database,
  store: new D1ProductionSnapshotStore(database as unknown as D1Database)
});

test("the production snapshot repository exposes only the approved read-only surface", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(D1ProductionSnapshotStore.prototype).filter((name) => name !== "constructor").sort(),
    ["getReport", "getReportMedia", "getWaiver", "listAudit", "listPlayers", "listReports", "listStaff", "summary"].sort()
  );
});

test("the repository returns full-fidelity snapshot data using SELECT statements only", async () => {
  const { database, store } = storeFor();

  assert.equal((await store.summary())?.snapshotId, "snapshot-20260716");
  assert.equal((await store.listReports()).items[0]?.reporterEmail, "hunter@example.test");
  assert.equal((await store.getReport("report-1"))?.reporterPhone, "7805550100");
  assert.equal((await store.getReportMedia("report-1", "media-1"))?.key.startsWith("snapshots/"), true);
  assert.equal((await store.listPlayers()).items[0]?.verifiedEmail, "hunter@example.test");
  assert.equal((await store.listStaff())[0]?.email, "tech@sebahub.com");
  assert.equal((await store.listAudit()).items[0]?.action, "report.created");
  assert.equal((await store.getWaiver("hunter-1"))?.documentVersion, "2026.1");

  assert.ok(database.statements.length >= 8);
  for (const statement of database.statements) {
    assert.match(statement.sql.trim(), /^(SELECT|WITH)\b/i, statement.sql);
  }
});

test("the repository fails closed for an unverified or wrongly identified snapshot", async () => {
  const wrongKind = new SnapshotD1();
  wrongKind.metadata = { ...wrongKind.metadata, kind: "validation" };
  assert.equal(await storeFor(wrongKind).store.summary(), null);

  const stale = new SnapshotD1();
  stale.metadata = { ...stale.metadata, status: "copying" };
  assert.equal(await storeFor(stale).store.summary(), null);

  const missing = new SnapshotD1();
  missing.metadata = null;
  assert.equal(await storeFor(missing).store.summary(), null);
});

test("report media must be ready, report-owned, and snapshot-prefixed", async () => {
  const database = new SnapshotD1();
  const originalFirst = database.first.bind(database);
  database.first = (sql, bindings) =>
    sql.includes("FROM media_uploads")
      ? { derivative_object_key: "derivatives/report-1.webp", content_type: "image/webp" }
      : originalFirst(sql, bindings);
  assert.equal(await storeFor(database).store.getReportMedia("report-1", "media-1"), null);

  const mediaSql = database.statements.find((statement) => statement.sql.includes("FROM media_uploads"))?.sql ?? "";
  assert.match(mediaSql, /owner_kind\s*=\s*'report'/i);
  assert.match(mediaSql, /owner_id\s*=\s*\?/i);
  assert.match(mediaSql, /status\s*=\s*'ready'/i);
});
