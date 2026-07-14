import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { D1DataStore } from "../src/server/d1-store";
import { ApiError } from "../src/server/errors";
import { participationWaiverDocument, privacyMediaDocument } from "../src/server/legal-documents";
import type { DataStore, SponsorInquiryInput } from "../src/server/types";

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

test("real D1 persists current waiver acceptance, safe projections, and receipt lifecycle", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql"
  ];
  const migrations = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(root, "migrations", file), "utf8"))
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "waiver-store-test" }
  });
  t.after(() => miniflare.dispose());
  const miniflareDb = await miniflare.getD1Database("DB");
  const db = miniflareDb as unknown as D1Database;
  for (const sql of migrations) await applySql(db, sql);
  const store = new D1DataStore(db);

  const preparePlayer = async (subject: string) => {
    await store.upsertPlayerAccount(subject, `${subject}@example.test`);
    await store.upsertProfile(subject, {
      verifiedEmail: `${subject}@example.test`,
      fullName: `Adult ${subject}`,
      townArea: "Seba Beach",
      interests: ["treasure-hunt"],
      discoverySource: "friend",
      consents: { huntEmail: false, marketing: false },
      privacyMediaVersion: privacyMediaDocument.version,
      privacyMediaHash: privacyMediaDocument.hash
    });
  };

  await preparePlayer("hunter-current-1");
  assert.deepEqual(await store.getPlayerAccess("hunter-current-1"), {
    accountState: "active",
    profileComplete: true,
    privacyMediaRequired: false,
    privacyMediaVersion: privacyMediaDocument.version,
    waiverStatus: "required",
    waiverVersion: null,
    participationUnlocked: false
  });

  await assert.rejects(
    store.recordWaiverReview("hunter-current-1", {
      version: "stale-version",
      hash: participationWaiverDocument.hash
    }),
    (error: unknown) => error instanceof ApiError && error.code === "waiver_document_stale"
  );

  const review = await store.recordWaiverReview("hunter-current-1", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  assert.equal(await store.getWaiverReview("someone-else", review.id), null);

  const input = {
    reviewEventId: review.id,
    idempotencyKey: "same-browser-key",
    adultName: "Alex Adult",
    minors: [
      { fullName: "Casey Minor", birthYear: 2014 },
      { fullName: "Jordan Minor", birthYear: 2016 }
    ],
    guardianAttested: true,
    documentVersion: participationWaiverDocument.version,
    documentHash: participationWaiverDocument.hash
  };
  const accepted = await store.acceptParticipationWaiver("hunter-current-1", input);
  const replay = await store.acceptParticipationWaiver("hunter-current-1", input);
  assert.equal(accepted.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.id, accepted.value.id);
  assert.match(accepted.value.referenceCode, /^TLS-W-[A-F0-9]{8}$/);
  assert.equal(accepted.value.referenceCode.includes("HUNTER"), false);

  const viewed = await store.getAndAuditOpsWaiverDetail("hunter-current-1", "staff-viewer-1");
  assert.equal(viewed?.id, accepted.value.id);
  const viewAudit = await db
    .prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json, occurred_at
       FROM audit_events WHERE action = 'player.waiver-detail.viewed' AND target_id = ?`
    )
    .bind(accepted.value.id)
    .first<Record<string, unknown>>();
  assert.equal(viewAudit?.actor_subject, "staff-viewer-1");
  assert.equal(viewAudit?.target_kind, "legal_acceptance");
  assert.equal(viewAudit?.target_id, accepted.value.id);
  assert.equal(viewAudit?.metadata_json, "{}");
  assert.match(String(viewAudit?.occurred_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(
    JSON.stringify(viewAudit),
    /hunter-current-1@example\.test|Alex Adult|Casey Minor|Jordan Minor|2014|2016/
  );

  await preparePlayer("hunter-current-2");
  const secondReview = await store.recordWaiverReview("hunter-current-2", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  const second = await store.acceptParticipationWaiver("hunter-current-2", {
    ...input,
    reviewEventId: secondReview.id,
    adultName: "Second Adult",
    minors: []
  });
  assert.equal(second.replayed, false, "the same key is independent for another subject");
  assert.notEqual(second.value.id, accepted.value.id);

  await preparePlayer("hunter-race-delete");
  const racedReview = await store.recordWaiverReview("hunter-race-delete", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  let deletionInjected = false;
  const racingDb = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      if (
        !sql.trimStart().startsWith("SELECT") ||
        !sql.includes("FROM legal_document_review_events r")
      ) {
        return statement;
      }
      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            async first<T>() {
              const row = await bound.first<T>();
              if (row && !deletionInjected) {
                deletionInjected = true;
                await db
                  .prepare("UPDATE player_accounts SET account_state = 'deleted' WHERE subject = ?")
                  .bind("hunter-race-delete")
                  .run();
              }
              return row;
            }
          };
        }
      };
    },
    batch(statements: D1PreparedStatement[]) {
      return db.batch(statements);
    }
  };
  const racingStore = new D1DataStore(racingDb as unknown as D1Database);
  await assert.rejects(
    racingStore.acceptParticipationWaiver("hunter-race-delete", {
      ...input,
      reviewEventId: racedReview.id,
      idempotencyKey: "race-delete-key",
      adultName: "Race Adult",
      minors: []
    }),
    /accepted participation waiver/i
  );
  const racedWrites = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM legal_acceptance_events WHERE hunter_subject = ? AND document_type = 'participation_waiver'"
      )
      .bind("hunter-race-delete")
      .first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ?")
      .bind("waiver_acceptance:hunter-race-delete")
      .first<{ count: number }>()
  ]);
  assert.deepEqual(racedWrites.map((row) => row?.count), [0, 0]);

  await db
    .prepare(
      `INSERT INTO legal_acceptance_events
       (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
       VALUES (?, ?, 'participation_waiver', ?, ?, 'withdrawn', ?)`
    )
    .bind(
      "withdrawn-current-waiver",
      "hunter-current-2",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      new Date(Date.now() + 1000).toISOString()
    )
    .run();

  const counts = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM legal_acceptance_events WHERE hunter_subject = ? AND document_type = 'participation_waiver'").bind("hunter-current-1").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM waiver_acceptance_participants WHERE acceptance_event_id = ?").bind(accepted.value.id).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM notification_jobs WHERE target_record_id = ? AND kind = 'waiver_receipt'").bind(accepted.value.id).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_events WHERE notification_job_id = ? AND event_type = 'queued'").bind(accepted.value.receipt.jobId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ? AND idempotency_key = ?").bind("waiver_acceptance:hunter-current-1", input.idempotencyKey).first<{ count: number }>()
  ]);
  assert.deepEqual(counts.map((row) => row?.count), [1, 3, 1, 1, 1]);
  assert.equal((await store.getPlayerAccess("hunter-current-1")).participationUnlocked, true);

  const opsResend = (store as DataStore).queueOpsWaiverReceiptResend!;
  const evidenceCounts = async () => {
    const [requeued, audited] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM notification_delivery_events
           WHERE notification_job_id = ? AND event_type = 'requeued'`
        )
        .bind(accepted.value.receipt.jobId)
        .first<{ count: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'player.waiver-receipt.requested' AND target_id = ?`
        )
        .bind(accepted.value.id)
        .first<{ count: number }>()
    ]);
    return [requeued?.count ?? 0, audited?.count ?? 0] as const;
  };

  assert.deepEqual(
    await opsResend.call(store, "hunter-current-2", accepted.value.id, "staff-ops-1"),
    { status: "not_found" },
    "an acceptance cannot be retried through a foreign subject"
  );
  assert.deepEqual(await evidenceCounts(), [0, 0]);

  await db.batch([
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('stale-acceptance', 'hunter-current-2', 'participation_waiver',
                 '2025.1', 'stale-waiver-hash', 'accepted', '2026-07-13T20:20:00.000Z')`
      ),
    db
      .prepare(
        `INSERT INTO waiver_acceptance_participants
         (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
         VALUES ('stale-adult', 'stale-acceptance', 'adult', 'Stale Adult', NULL, 0,
                 '2026-07-13T20:20:00.000Z')`
      ),
    db
      .prepare(
        `INSERT INTO notification_jobs
         (id, kind, target_record_id, status, attempts, created_at, updated_at)
         VALUES ('stale-receipt-job', 'waiver_receipt', 'stale-acceptance', 'failed', 1,
                 '2026-07-13T20:20:00.000Z', '2026-07-13T20:20:00.000Z')`
      )
  ]);
  assert.deepEqual(
    await opsResend.call(store, "hunter-current-2", "stale-acceptance", "staff-ops-1"),
    { status: "not_found" },
    "only the exact current waiver document can be retried"
  );
  const staleJob = await db
    .prepare("SELECT status FROM notification_jobs WHERE id = 'stale-receipt-job'")
    .first<{ status: string }>();
  assert.equal(staleJob?.status, "failed");

  const opsQueued = await opsResend.call(
    store,
    "hunter-current-1",
    accepted.value.id,
    "staff-ops-1"
  );
  assert.equal(opsQueued.status, "queued");
  assert.equal(opsQueued.acceptance?.receipt.status, "pending");
  assert.deepEqual(await evidenceCounts(), [1, 1]);
  const opsAudit = await db
    .prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json, occurred_at
       FROM audit_events WHERE action = 'player.waiver-receipt.requested' AND target_id = ?`
    )
    .bind(accepted.value.id)
    .first<Record<string, unknown>>();
  assert.equal(opsAudit?.actor_subject, "staff-ops-1");
  assert.equal(opsAudit?.action, "player.waiver-receipt.requested");
  assert.equal(opsAudit?.target_kind, "legal_acceptance");
  assert.equal(opsAudit?.target_id, accepted.value.id);
  assert.equal(opsAudit?.metadata_json, "{}");
  assert.match(String(opsAudit?.occurred_at), /^\d{4}-\d{2}-\d{2}T/);
  const serializedAudit = JSON.stringify(opsAudit);
  for (const privateValue of [
    "hunter-current-1@example.test",
    "Alex Adult",
    "Casey Minor",
    "Jordan Minor",
    "birthYear",
    "participants"
  ]) {
    assert.equal(serializedAudit.includes(privateValue), false);
  }

  const prepareRaceAcceptance = async (subject: string, key: string) => {
    await preparePlayer(subject);
    const review = await store.recordWaiverReview(subject, {
      version: participationWaiverDocument.version,
      hash: participationWaiverDocument.hash
    });
    return store.acceptParticipationWaiver(subject, {
      ...input,
      reviewEventId: review.id,
      idempotencyKey: key,
      adultName: "Race Test Adult",
      minors: []
    });
  };
  const exerciseLegalRace = async (action: "accepted" | "withdrawn", suffix: string) => {
    const subject = `hunter-ops-race-${suffix}`;
    const raced = await prepareRaceAcceptance(subject, `ops-race-${suffix}`);
    let injected = false;
    const racingDb = {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        if (!sql.includes("FROM legal_acceptance_events l") || !sql.includes("JOIN notification_jobs j")) {
          return statement;
        }
        return {
          bind(...bindings: unknown[]) {
            const bound = statement.bind(...bindings);
            return {
              async first<T>() {
                const row = await bound.first<T>();
                if (
                  !injected &&
                  row &&
                  (row as Record<string, unknown>).id === raced.value.id
                ) {
                  injected = true;
                  await db
                    .prepare(
                      `INSERT INTO legal_acceptance_events
                       (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
                       VALUES (?, ?, 'participation_waiver', ?, ?, ?, '9999-12-31T23:59:59.999Z')`
                    )
                    .bind(
                      `newer-${suffix}`,
                      subject,
                      participationWaiverDocument.version,
                      participationWaiverDocument.hash,
                      action
                    )
                    .run();
                }
                return row;
              }
            };
          }
        };
      },
      batch(statements: D1PreparedStatement[]) {
        return db.batch(statements);
      }
    };
    const racingStore = new D1DataStore(racingDb as unknown as D1Database);
    const result = await racingStore.queueOpsWaiverReceiptResend(
      subject,
      raced.value.id,
      "staff-race-test"
    );
    assert.deepEqual(result, { status: "not_found" });
    const evidence = await Promise.all([
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_delivery_events WHERE notification_job_id = ? AND event_type = 'requeued'"
        )
        .bind(raced.value.receipt.jobId)
        .first<{ count: number }>(),
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'player.waiver-receipt.requested' AND target_id = ?"
        )
        .bind(raced.value.id)
        .first<{ count: number }>()
    ]);
    assert.deepEqual(
      evidence.map((row) => row?.count ?? 0),
      [0, 0],
      `a concurrent ${action} event prevents both delivery and audit evidence`
    );
  };
  await exerciseLegalRace("withdrawn", "withdrawn");
  await exerciseLegalRace("accepted", "newer-acceptance");

  const detail = await store.getParticipationWaiver("hunter-current-1");
  assert.deepEqual(detail?.participants, accepted.value.participants);
  const envelope = await store.getWaiverReceiptEnvelope(accepted.value.id);
  assert.equal(envelope?.verifiedEmail, "hunter-current-1@example.test");
  assert.equal(envelope?.acceptance.referenceCode, accepted.value.referenceCode);

  const players = await store.listPlayers({ limit: 10 });
  const firstPlayer = players.items.find((item) => item.id === "hunter-current-1");
  assert.equal(firstPlayer?.waiverVersion, participationWaiverDocument.version);
  assert.equal(firstPlayer?.acceptedAt, accepted.value.acceptedAt);
  assert.equal(firstPlayer?.minorCount, 2);
  assert.equal(firstPlayer?.receiptStatus, "pending");
  const serializedPlayer = JSON.stringify(firstPlayer);
  assert.equal(serializedPlayer.includes("Casey Minor"), false);
  assert.equal(serializedPlayer.includes("Jordan Minor"), false);
  assert.equal(serializedPlayer.includes("birthYear"), false);
  assert.equal(serializedPlayer.includes("participants"), false);
  const withdrawnPlayer = players.items.find((item) => item.id === "hunter-current-2");
  assert.equal(withdrawnPlayer?.waiverStatus, "required");
  assert.equal(withdrawnPlayer?.waiverVersion, null);
  assert.equal(withdrawnPlayer?.acceptedAt, null);
  assert.equal(withdrawnPlayer?.receiptStatus, null);
  assert.equal(withdrawnPlayer?.participationUnlocked, false);
  assert.equal(await store.getParticipationWaiver("hunter-current-2"), null);

  const claimed = await store.claimWaiverReceiptJob(accepted.value.id);
  assert.equal(claimed?.acceptanceId, accepted.value.id);
  assert.equal(claimed?.attempts, 1);
  assert.match(claimed?.leaseToken ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(await store.claimWaiverReceiptJob(accepted.value.id), null, "the five-minute lease suppresses another claim");
  await store.queueWaiverReceiptResend("hunter-current-1", accepted.value.id);
  const activeLeaseState = await db
    .prepare(
      `SELECT j.attempts, j.next_attempt_at,
              (SELECT COUNT(*) FROM notification_job_leases l
               WHERE l.notification_job_id = j.id) AS lease_count,
              (SELECT COUNT(*) FROM notification_delivery_events d
               WHERE d.notification_job_id = j.id AND d.event_type = 'requeued') AS requeue_count
       FROM notification_jobs j WHERE j.id = ?`
    )
    .bind(claimed!.id)
    .first<{ attempts: number; next_attempt_at: string | null; lease_count: number; requeue_count: number }>();
  assert.equal(activeLeaseState?.attempts, 1);
  assert.ok(activeLeaseState?.next_attempt_at, "resend does not clear an active lease");
  assert.equal(activeLeaseState?.lease_count, 1);
  assert.equal(activeLeaseState?.requeue_count, 1, "the active lease adds no second requeue event");
  assert.equal(
    (await opsResend.call(store, "hunter-current-1", accepted.value.id, "staff-ops-1")).status,
    "in_progress",
    "an Ops retry must not clear or steal an active receipt lease"
  );
  assert.equal(await store.claimWaiverReceiptJob(accepted.value.id), null);
  assert.deepEqual(await evidenceCounts(), [1, 1], "a blocked retry creates no delivery or audit evidence");
  await store.completeWaiverReceiptJob(claimed!, {
    status: "failed",
    errorCode: "document_mismatch"
  });
  assert.equal((await store.getParticipationWaiver("hunter-current-1"))?.receipt.status, "failed");

  const resent = await store.queueWaiverReceiptResend("hunter-current-1", accepted.value.id);
  assert.equal(resent?.receipt.status, "pending");
  const reclaimed = await store.claimWaiverReceiptJob(accepted.value.id);
  assert.equal(reclaimed?.attempts, 2);
  await store.completeWaiverReceiptJob(reclaimed!, {
    status: "sent",
    providerMessageId: "provider-message-1"
  });
  const sent = await store.getParticipationWaiver("hunter-current-1");
  assert.equal(sent?.receipt.status, "sent");
  assert.ok(sent?.receipt.sentAt);
  await store.completeWaiverReceiptJob(claimed!, {
    status: "failed",
    errorCode: "provider_unavailable"
  });
  assert.equal(
    (await store.getParticipationWaiver("hunter-current-1"))?.receipt.status,
    "sent",
    "a stale completion cannot overwrite a newer successful generation"
  );
  const evidence = await db
    .prepare("SELECT provider_message_id, error_code FROM notification_delivery_events WHERE notification_job_id = ? ORDER BY occurred_at DESC, id DESC")
    .bind(claimed!.id)
    .all<{ provider_message_id: string | null; error_code: string | null }>();
  assert.deepEqual(
    evidence.results.filter((event) => event.provider_message_id !== null),
    [{ provider_message_id: "provider-message-1", error_code: null }]
  );
  assert.equal(
    evidence.results.filter((event) => event.error_code !== null).length,
    1,
    "the stale completion appends no losing delivery event"
  );

  await store.queueWaiverReceiptResend("hunter-current-1", accepted.value.id);
  const afterResendCount = await db
    .prepare("SELECT COUNT(*) AS count FROM legal_acceptance_events WHERE id = ?")
    .bind(accepted.value.id)
    .first<{ count: number }>();
  assert.equal(afterResendCount?.count, 1, "resending never creates another legal acceptance");

  await store.applyIdentityEvent({
    id: "deleted-waiver-player",
    type: "user.deleted",
    data: { subject: "hunter-current-1", verifiedEmail: null }
  });
  const playersAfterDeletion = await store.listPlayers({ limit: 10 });
  assert.equal(playersAfterDeletion.items.some((item) => item.id === "hunter-current-1"), false);
});

test("the real D1 waiver migration is replayable and enforces one receipt job", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql"
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

  const immutableLedgerMutations = [
    {
      update: "UPDATE legal_document_review_events SET reviewed_at = '2026-07-13T21:00:00.000Z' WHERE id = 'review-1'",
      remove: "DELETE FROM legal_document_review_events WHERE id = 'review-1'",
      message: /legal document review events are immutable/i
    },
    {
      update: "UPDATE waiver_acceptance_participants SET full_name = 'Changed Name', birth_year = 2012 WHERE id = 'participant-minor-1'",
      remove: "DELETE FROM waiver_acceptance_participants WHERE id = 'participant-minor-1'",
      message: /waiver acceptance participants are immutable/i
    },
    {
      update: "UPDATE notification_delivery_events SET event_type = 'failed', error_code = 'changed' WHERE id = 'delivery-1'",
      remove: "DELETE FROM notification_delivery_events WHERE id = 'delivery-1'",
      message: /notification delivery events are immutable/i
    }
  ];
  for (const mutation of immutableLedgerMutations) {
    await assert.rejects(db.prepare(mutation.update).run(), mutation.message);
    await assert.rejects(db.prepare(mutation.remove).run(), mutation.message);
  }

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
      /accepted participation waiver|waiver acceptance participants are immutable/i
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
    "0006_participation_waiver_and_receipts.sql",
    "0008_immutable_waiver_ledgers.sql"
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
  const immutableLedgerMigration = migrations[6];
  assert.ok(immutableLedgerMigration, "immutable ledger migration is loaded");
  await applySql(db, immutableLedgerMigration);
  await applySql(db, immutableLedgerMigration);

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
