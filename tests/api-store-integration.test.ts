import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { D1DataStore } from "../src/server/d1-store";
import { ApiError } from "../src/server/errors";
import type { SponsorInquiryInput } from "../src/server/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(
  path.join(root, "migrations", "0005_sponsor_inquiries.sql"),
  "utf8"
);

const applySql = async (db: D1Database, sql: string) => {
  const statements: string[] = [];
  let statement = "";
  let inTrigger = false;

  for (const line of sql.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!statement && !trimmed) continue;
    statement += `${line}\n`;
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) inTrigger = true;
    if ((inTrigger && /^END;$/i.test(trimmed)) || (!inTrigger && /;$/i.test(trimmed))) {
      statements.push(statement.trim());
      statement = "";
      inTrigger = false;
    }
  }

  assert.equal(statement.trim(), "", "migration script ends with a complete SQL statement");
  for (const sqlStatement of statements) {
    await db.prepare(sqlStatement).run();
  }
};

const playerInsert = (db: D1Database, subject: string) =>
  db
    .prepare(
      `INSERT INTO player_accounts
       (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
       VALUES (?, ?, 'active', ?, ?, ?)`
    )
    .bind(
      subject,
      `${subject}@example.test`,
      "2026-07-13T20:00:00.000Z",
      "2026-07-13T20:00:00.000Z",
      "2026-07-13T20:00:00.000Z"
    );

const acceptanceInsert = (
  db: D1Database,
  id: string,
  documentType: "privacy_media" | "participation_waiver",
  action: "accepted" | "withdrawn" = "accepted"
) =>
  db
    .prepare(
      `INSERT INTO legal_acceptance_events
       (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
       VALUES (?, 'hunter-waiver-1', ?, '2026.1', 'waiver-hash', ?, ?)`
    )
    .bind(id, documentType, action, "2026-07-13T20:02:00.000Z");

const participantInsert = (db: D1Database, id: string, acceptanceEventId: string) =>
  db
    .prepare(
      `INSERT INTO waiver_acceptance_participants
       (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
       VALUES (?, ?, 'adult', 'Alex Adult', NULL, 0, ?)`
    )
    .bind(id, acceptanceEventId, "2026-07-13T20:02:00.000Z");

const notificationJobInsert = (
  db: D1Database,
  id: string,
  kind: string,
  targetRecordId: string,
  createdAt = "2026-07-13T20:02:00.000Z"
) =>
  db
    .prepare(
      `INSERT INTO notification_jobs
       (id, kind, target_record_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)`
    )
    .bind(id, kind, targetRecordId, createdAt, createdAt);

const waiverReceiptJobInsert = (
  db: D1Database,
  id: string,
  targetRecordId: string,
  status: "pending" | "sent" | "failed" | "cancelled",
  attempts: number,
  createdAt: string
) =>
  db
    .prepare(
      `INSERT INTO notification_jobs
       (id, kind, target_record_id, status, attempts, created_at, updated_at)
       VALUES (?, 'waiver_receipt', ?, ?, ?, ?, ?)`
    )
    .bind(id, targetRecordId, status, attempts, createdAt, createdAt);

const deliveryEventInsert = (
  db: D1Database,
  id: string,
  notificationJobId: string,
  eventType: "queued" | "attempted" | "sent" | "failed" | "requeued",
  occurredAt: string
) =>
  db
    .prepare(
      `INSERT INTO notification_delivery_events
       (id, notification_job_id, event_type, occurred_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, notificationJobId, eventType, occurredAt);

const sponsorInput = (
  overrides: Partial<SponsorInquiryInput> = {}
): SponsorInquiryInput => ({
  contactName: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: null,
  supportType: "lead",
  contributionRange: "prefer_to_discuss",
  desiredOutcome: "Discuss a useful local activation.",
  acknowledgementVersion: "2026.1",
  ...overrides
});

const inquiryInsert = (
  db: D1Database,
  id: string,
  createdAt = "2026-07-13T20:00:00.000Z",
  state = "new"
) =>
  db
    .prepare(
      `INSERT INTO sponsor_inquiries
       (id, reference_code, idempotency_key, contact_name, organization, email, phone,
        support_type, contribution_range, desired_outcome, acknowledgement_version,
        acknowledged_at, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'lead', 'prefer_to_discuss', ?, '2026.1', ?, ?, ?, ?)`
    )
    .bind(
      id,
      `SP-${id.replace(/[^A-Z0-9]/gi, "").padEnd(8, "0").slice(0, 8).toUpperCase()}`,
      `key-${id}`,
      `Contact ${id}`,
      `Organization ${id}`,
      `${id}@example.test`,
      "Discuss a useful local activation.",
      createdAt,
      state,
      createdAt,
      createdAt
    );

test("real D1 preserves sponsor inquiry atomicity, search, pagination, and history", async (t) => {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "sponsor-test" }
  });
  t.after(() => miniflare.dispose());
  const miniflareDb = await miniflare.getD1Database("DB");
  const db = miniflareDb as unknown as D1Database;
  await applySql(db, migration);
  const store = new D1DataStore(db);
  const reset = async () => {
    await db.batch([
      db.prepare("DELETE FROM sponsor_inquiry_events"),
      db.prepare("DELETE FROM sponsor_inquiries")
    ]);
  };

  await t.test("a failing event rolls back its inquiry in the same raw D1 batch", async () => {
    await reset();
    await assert.rejects(
      db.batch([
        inquiryInsert(db, "rollback-1"),
        db
          .prepare(
            `INSERT INTO sponsor_inquiry_events
             (id, inquiry_id, event_type, created_at) VALUES (?, ?, ?, ?)`
          )
          .bind("bad-event", "rollback-1", "invalid", "2026-07-13T20:00:00.000Z")
      ]),
      /CHECK constraint failed/i
    );
    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM sponsor_inquiries WHERE id = ?")
      .bind("rollback-1")
      .first<{ count: number }>();
    assert.equal(row?.count, 0);
  });

  await t.test("literal wildcard search matches each private contact field without decoys", async () => {
    await reset();
    const literal = "%_\\";
    const captures = await Promise.all([
      store.createSponsorInquiry(sponsorInput({ contactName: `Contact ${literal}` }), "literal-contact"),
      store.createSponsorInquiry(sponsorInput({ organization: `Org ${literal}` }), "literal-org"),
      store.createSponsorInquiry(sponsorInput({ email: `mail${literal}@example.test` }), "literal-email"),
      store.createSponsorInquiry(
        sponsorInput({ contactName: "Contact AXZ", organization: "Org AXZ" }),
        "wildcard-decoy"
      )
    ]);

    const page = await store.listSponsorInquiries({ query: literal, limit: 10 });
    const expected = captures.slice(0, 3).map((capture) => capture.value.id).sort();
    assert.deepEqual(page.items.map((item) => item.id).sort(), expected);
  });

  await t.test("tuple cursors paginate equal timestamps without duplicates or omissions", async () => {
    await reset();
    await db.batch(
      ["page-1", "page-2", "page-3", "page-4", "page-5"].map((id) => inquiryInsert(db, id))
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await store.listSponsorInquiries({ limit: 2, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ["page-5", "page-4", "page-3", "page-2", "page-1"]);
    assert.equal(new Set(seen).size, 5);
  });

  await t.test("the aggregate maps grouped workflow totals and zero-fills absent states", async () => {
    await reset();
    await db.batch([
      inquiryInsert(db, "new00001"),
      inquiryInsert(db, "new00002"),
      inquiryInsert(db, "qual0001", undefined, "qualified"),
      inquiryInsert(db, "close001", undefined, "closed")
    ]);

    assert.deepEqual(await store.countSponsorInquiriesByState(), {
      new: 2,
      contacted: 0,
      qualified: 1,
      accepted: 0,
      closed: 1
    });
  });

  await t.test("a real update persists its matching actor and state transition event", async () => {
    await reset();
    const created = await store.createSponsorInquiry(sponsorInput(), "update-key");
    const updated = await store.updateSponsorInquiry(
      created.value.id,
      { state: "qualified", note: "Call scheduled." },
      "staff-1"
    );
    assert.equal(updated?.state, "qualified");

    const event = await db
      .prepare(
        `SELECT actor_subject, from_state, to_state, note
         FROM sponsor_inquiry_events
         WHERE inquiry_id = ? AND event_type = 'state_changed'`
      )
      .bind(created.value.id)
      .first<Record<string, unknown>>();
    assert.deepEqual(event, {
      actor_subject: "staff-1",
      from_state: "new",
      to_state: "qualified",
      note: "Call scheduled."
    });
  });

  await t.test("concurrent updates cannot revert state or break the event chain", async () => {
    await reset();
    const created = await store.createSponsorInquiry(sponsorInput(), "concurrent-key");
    const settled = await Promise.allSettled([
      store.updateSponsorInquiry(
        created.value.id,
        { state: "contacted", note: "Initial outreach." },
        "staff-a"
      ),
      store.updateSponsorInquiry(
        created.value.id,
        { state: "qualified", note: "Qualification call." },
        "staff-b"
      )
    ]);
    assert.ok(settled.some((result) => result.status === "fulfilled"));
    for (const result of settled) {
      if (result.status === "rejected") {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.code, "version_conflict");
      }
    }

    const events = await db
      .prepare(
        `SELECT from_state, to_state FROM sponsor_inquiry_events
         WHERE inquiry_id = ? AND event_type = 'state_changed' ORDER BY rowid`
      )
      .bind(created.value.id)
      .all<{ from_state: string; to_state: string }>();
    let expectedState = "new";
    for (const event of events.results) {
      assert.equal(event.from_state, expectedState);
      expectedState = event.to_state;
    }
    const persisted = await db
      .prepare("SELECT state FROM sponsor_inquiries WHERE id = ?")
      .bind(created.value.id)
      .first<{ state: string }>();
    assert.equal(persisted?.state, expectedState);
    assert.notEqual(persisted?.state, "new");
  });
});

test("the real D1 waiver migration is replayable and enforces one receipt job", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql"
  ];
  const migrations = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(root, "migrations", file), "utf8"))
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "waiver-migration-test" }
  });
  t.after(() => miniflare.dispose());
  const miniflareDb = await miniflare.getD1Database("DB");
  const db = miniflareDb as unknown as D1Database;

  for (let replay = 0; replay < 2; replay += 1) {
    for (const sql of migrations) {
      await applySql(db, sql);
    }
  }

  await db.batch([
    playerInsert(db, "hunter-waiver-1"),
    db
      .prepare(
        `INSERT INTO legal_document_review_events
         (id, hunter_subject, document_type, document_version, document_hash, reviewed_at)
         VALUES (?, ?, 'participation_waiver', ?, ?, ?)`
      )
      .bind(
        "review-1",
        "hunter-waiver-1",
        "2026.1",
        "waiver-hash",
        "2026-07-13T20:01:00.000Z"
      ),
    acceptanceInsert(db, "acceptance-1", "participation_waiver"),
    participantInsert(db, "participant-adult", "acceptance-1"),
    db
      .prepare(
        `INSERT INTO waiver_acceptance_participants
         (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
         VALUES (?, ?, 'minor', ?, ?, 1, ?)`
      )
      .bind(
        "participant-minor-1",
        "acceptance-1",
        "Taylor Minor",
        2013,
        "2026-07-13T20:02:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO waiver_acceptance_participants
         (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
         VALUES (?, ?, 'minor', ?, ?, 1, ?)`
      )
      .bind(
        "participant-minor-2",
        "acceptance-1",
        "Morgan Minor",
        2015,
        "2026-07-13T20:02:00.000Z"
      ),
    notificationJobInsert(db, "receipt-job-1", "waiver_receipt", "acceptance-1"),
    db
      .prepare(
        `INSERT INTO notification_delivery_events
         (id, notification_job_id, event_type, occurred_at)
         VALUES (?, ?, 'queued', ?)`
      )
      .bind("delivery-1", "receipt-job-1", "2026-07-13T20:02:00.000Z")
  ]);

  const counts = await Promise.all(
    [
      "legal_document_review_events",
      "legal_acceptance_events",
      "waiver_acceptance_participants",
      "notification_jobs",
      "notification_delivery_events"
    ].map(async (table) => {
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
      return row?.count;
    })
  );
  assert.deepEqual(counts, [1, 1, 3, 1, 1]);

  await db.batch([
    acceptanceInsert(db, "acceptance-privacy", "privacy_media"),
    acceptanceInsert(db, "acceptance-withdrawn", "participation_waiver", "withdrawn")
  ]);

  const invalidAcceptanceIds = [
    ["privacy", "acceptance-privacy"],
    ["withdrawn", "acceptance-withdrawn"],
    ["missing", "acceptance-missing"]
  ] as const;
  for (const [suffix, acceptanceEventId] of invalidAcceptanceIds) {
    await assert.rejects(
      participantInsert(db, `participant-${suffix}`, acceptanceEventId).run(),
      /accepted participation waiver/i
    );
    await assert.rejects(
      db
        .prepare(
          "UPDATE waiver_acceptance_participants SET acceptance_event_id = ? WHERE id = 'participant-adult'"
        )
        .bind(acceptanceEventId)
        .run(),
      /accepted participation waiver/i
    );
    await assert.rejects(
      notificationJobInsert(db, `receipt-${suffix}`, "waiver_receipt", acceptanceEventId).run(),
      /accepted participation waiver/i
    );
    await assert.rejects(
      db
        .prepare("UPDATE notification_jobs SET target_record_id = ? WHERE id = 'receipt-job-1'")
        .bind(acceptanceEventId)
        .run(),
      /accepted participation waiver/i
    );
  }

  await notificationJobInsert(db, "generic-job", "account_notice", "acceptance-privacy").run();
  await assert.rejects(
    db.prepare("UPDATE notification_jobs SET kind = 'waiver_receipt' WHERE id = 'generic-job'").run(),
    /accepted participation waiver/i
  );
  await assert.rejects(
    db.prepare("UPDATE legal_acceptance_events SET action = 'withdrawn' WHERE id = 'acceptance-1'").run(),
    /legal acceptance events are immutable/i
  );

  await playerInsert(db, "hunter-waiver-2").run();
  const materialMutations = [
    ["hunter_subject", "hunter-waiver-2"],
    ["document_version", "2026.2"],
    ["document_hash", "changed-waiver-hash"],
    ["accepted_at", "2026-07-13T21:00:00.000Z"]
  ] as const;
  for (const [column, value] of materialMutations) {
    await assert.rejects(
      db
        .prepare(`UPDATE legal_acceptance_events SET ${column} = ? WHERE id = 'acceptance-1'`)
        .bind(value)
        .run(),
      /legal acceptance events are immutable/i
    );
  }
  await assert.rejects(
    db.prepare("DELETE FROM legal_acceptance_events WHERE id = 'acceptance-privacy'").run(),
    /legal acceptance events are immutable/i
  );

  await assert.rejects(
    notificationJobInsert(
      db,
      "receipt-job-2",
      "waiver_receipt",
      "acceptance-1",
      "2026-07-13T20:03:00.000Z"
    ).run(),
    /UNIQUE constraint failed/i
  );
});

test("a populated D1 waiver upgrade reconciles receipt duplicates only", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql"
  ];
  const migrations = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(root, "migrations", file), "utf8"))
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "waiver-upgrade-test" }
  });
  t.after(() => miniflare.dispose());
  const miniflareDb = await miniflare.getD1Database("DB");
  const db = miniflareDb as unknown as D1Database;

  for (const sql of migrations.slice(0, 5)) {
    await applySql(db, sql);
  }
  await applySql(
    db,
    `CREATE TABLE IF NOT EXISTS notification_delivery_events (
      id TEXT PRIMARY KEY,
      notification_job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('queued', 'attempted', 'sent', 'failed', 'requeued')),
      provider TEXT,
      provider_message_id TEXT,
      error_code TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_delivery_job
      ON notification_delivery_events(notification_job_id, occurred_at DESC, id DESC);`
  );
  await db.batch([
    playerInsert(db, "hunter-waiver-1"),
    acceptanceInsert(db, "acceptance-1", "participation_waiver"),
    acceptanceInsert(db, "acceptance-2", "participation_waiver"),
    acceptanceInsert(db, "acceptance-3", "participation_waiver"),
    waiverReceiptJobInsert(
      db,
      "pending-old",
      "acceptance-1",
      "pending",
      0,
      "2026-07-13T20:02:00.000Z"
    ),
    waiverReceiptJobInsert(
      db,
      "sent-new",
      "acceptance-1",
      "sent",
      1,
      "2026-07-13T20:03:00.000Z"
    ),
    waiverReceiptJobInsert(
      db,
      "failed-old",
      "acceptance-2",
      "failed",
      5,
      "2026-07-13T20:02:00.000Z"
    ),
    waiverReceiptJobInsert(
      db,
      "sent-new-2",
      "acceptance-2",
      "sent",
      1,
      "2026-07-13T20:04:00.000Z"
    ),
    waiverReceiptJobInsert(
      db,
      "pending-ten",
      "acceptance-3",
      "pending",
      10,
      "2026-07-13T20:02:00.000Z"
    ),
    waiverReceiptJobInsert(
      db,
      "failed-evidential",
      "acceptance-3",
      "failed",
      1,
      "2026-07-13T20:05:00.000Z"
    ),
    notificationJobInsert(db, "generic-a", "account_notice", "same-target"),
    notificationJobInsert(db, "generic-b", "account_notice", "same-target"),
    deliveryEventInsert(db, "delivery-pending-queued", "pending-old", "queued", "2026-07-13T20:02:00.000Z"),
    deliveryEventInsert(db, "delivery-sent", "sent-new", "sent", "2026-07-13T20:03:00.000Z"),
    deliveryEventInsert(db, "delivery-failed-attempt", "failed-old", "attempted", "2026-07-13T20:02:00.000Z"),
    deliveryEventInsert(db, "delivery-failed", "failed-old", "failed", "2026-07-13T20:03:00.000Z"),
    deliveryEventInsert(db, "delivery-sent-2", "sent-new-2", "sent", "2026-07-13T20:04:00.000Z"),
    deliveryEventInsert(db, "delivery-evidence-pending", "pending-ten", "requeued", "2026-07-13T20:04:00.000Z"),
    deliveryEventInsert(db, "delivery-evidence-sent", "failed-evidential", "sent", "2026-07-13T20:05:00.000Z")
  ]);
  await db
    .prepare(
      `UPDATE notification_jobs
       SET next_attempt_at = '2026-07-13T21:00:00.000Z', last_error_code = 'provider_timeout'
       WHERE id = 'failed-evidential'`
    )
    .run();

  const waiverMigration = migrations[5];
  assert.ok(waiverMigration, "waiver migration is loaded");
  await applySql(db, waiverMigration);
  await applySql(db, waiverMigration);

  const jobs = await db
    .prepare("SELECT id, kind, status, attempts FROM notification_jobs ORDER BY id")
    .all<{ id: string; kind: string; status: string; attempts: number }>();
  assert.deepEqual(jobs.results, [
    { id: "failed-evidential", kind: "waiver_receipt", status: "sent", attempts: 1 },
    { id: "generic-a", kind: "account_notice", status: "pending", attempts: 0 },
    { id: "generic-b", kind: "account_notice", status: "pending", attempts: 0 },
    { id: "sent-new", kind: "waiver_receipt", status: "sent", attempts: 1 },
    { id: "sent-new-2", kind: "waiver_receipt", status: "sent", attempts: 1 }
  ]);

  const deliveryEvents = await db
    .prepare("SELECT id, notification_job_id FROM notification_delivery_events ORDER BY id")
    .all<{ id: string; notification_job_id: string }>();
  assert.deepEqual(deliveryEvents.results, [
    { id: "delivery-evidence-pending", notification_job_id: "failed-evidential" },
    { id: "delivery-evidence-sent", notification_job_id: "failed-evidential" },
    { id: "delivery-failed", notification_job_id: "sent-new-2" },
    { id: "delivery-failed-attempt", notification_job_id: "sent-new-2" },
    { id: "delivery-pending-queued", notification_job_id: "sent-new" },
    { id: "delivery-sent", notification_job_id: "sent-new" },
    { id: "delivery-sent-2", notification_job_id: "sent-new-2" }
  ]);
  const evidenceKeeper = await db
    .prepare(
      `SELECT status, next_attempt_at, last_error_code
       FROM notification_jobs WHERE id = 'failed-evidential'`
    )
    .first<{ status: string; next_attempt_at: string | null; last_error_code: string | null }>();
  assert.deepEqual(evidenceKeeper, {
    status: "sent",
    next_attempt_at: null,
    last_error_code: null
  });
  const resendState = await db
    .prepare("SELECT COUNT(*) AS count FROM notification_jobs WHERE kind = 'waiver_receipt' AND status <> 'sent'")
    .first<{ count: number }>();
  assert.equal(resendState?.count, 0);

  await notificationJobInsert(db, "generic-c", "account_notice", "same-target").run();
  await assert.rejects(
    notificationJobInsert(db, "receipt-third", "waiver_receipt", "acceptance-1").run(),
    /UNIQUE constraint failed/i
  );
});
