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
  for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
};

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
    db
      .prepare(
        `INSERT INTO player_accounts
         (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
         VALUES (?, ?, 'active', ?, ?, ?)`
      )
      .bind(
        "hunter-waiver-1",
        "hunter-waiver-1@example.test",
        "2026-07-13T20:00:00.000Z",
        "2026-07-13T20:00:00.000Z",
        "2026-07-13T20:00:00.000Z"
      ),
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
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES (?, ?, 'participation_waiver', ?, ?, 'accepted', ?)`
      )
      .bind(
        "acceptance-1",
        "hunter-waiver-1",
        "2026.1",
        "waiver-hash",
        "2026-07-13T20:02:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO waiver_acceptance_participants
         (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
         VALUES (?, ?, 'adult', ?, NULL, 0, ?)`
      )
      .bind("participant-adult", "acceptance-1", "Alex Adult", "2026-07-13T20:02:00.000Z"),
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
    db
      .prepare(
        `INSERT INTO notification_jobs
         (id, kind, target_record_id, status, attempts, created_at, updated_at)
         VALUES (?, 'waiver_receipt', ?, 'pending', 0, ?, ?)`
      )
      .bind(
        "receipt-job-1",
        "acceptance-1",
        "2026-07-13T20:02:00.000Z",
        "2026-07-13T20:02:00.000Z"
      ),
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

  await assert.rejects(
    db
      .prepare(
        `INSERT INTO notification_jobs
         (id, kind, target_record_id, status, attempts, created_at, updated_at)
         VALUES (?, 'waiver_receipt', ?, 'pending', 0, ?, ?)`
      )
      .bind(
        "receipt-job-2",
        "acceptance-1",
        "2026-07-13T20:03:00.000Z",
        "2026-07-13T20:03:00.000Z"
      )
      .run(),
    /UNIQUE constraint failed/i
  );
});
