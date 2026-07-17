import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { createApi } from "../src/server/app";
import { D1DataStore } from "../src/server/d1-store";
import { ApiError } from "../src/server/errors";
import { participationWaiverDocument, privacyMediaDocument } from "../src/server/legal-documents";
import { ManagedWaiverReceipts } from "../src/server/waiver-receipts";
import type {
  TransactionalMailAcceptance,
  TransactionalMessage
} from "../src/server/transactional-mail";
import type {
  DataStore,
  SponsorInquiryInput,
  WaiverReceiptCompletion
} from "../src/server/types";
import {
  FakeEnvironment,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";

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
  if (/PRAGMA\s+defer_foreign_keys\s*=\s*ON/i.test(sql)) {
    await db.batch(statements.map((sqlStatement) => db.prepare(sqlStatement)));
    return;
  }
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

const mediaUploadInsert = (
  db: D1Database,
  id: string,
  ownerKind: "field_note" | "report",
  ownerId: string,
  status: "processing" | "ready" | "rejected",
  derivativeObjectKey: string | null
) =>
  db
    .prepare(
      `INSERT INTO media_uploads
       (id, owner_kind, owner_id, private_object_key, derivative_object_key,
        content_type, byte_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024, ?, ?)`
    )
    .bind(
      id,
      ownerKind,
      ownerId,
      `private/${id}/original.jpg`,
      derivativeObjectKey,
      status,
      "2026-07-15T20:02:00.000Z"
    );

test("pending Case Notes project media and scope ready derivatives to the owning note", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  await applyOperatorAlertMigration(db);
  await seedOperatorAlertFixtures(db);
  const store = new D1DataStore(db);
  const capture = await store.createFieldNote({
    authorSubject: "hunter-alert",
    waypointId: 1,
    body: "A photographed observation awaiting moderation.",
    media: []
  }, "pending-media-note-key");
  const noteId = String(capture.value.id);
  await db.batch([
    mediaUploadInsert(db, "note-media-ready", "field_note", noteId, "ready", "derivatives/note-media-ready.webp"),
    mediaUploadInsert(db, "note-media-processing", "field_note", noteId, "processing", null),
    mediaUploadInsert(db, "note-media-rejected", "field_note", noteId, "rejected", null),
    mediaUploadInsert(db, "other-note-media", "field_note", "another-note", "ready", "derivatives/other-note-media.webp")
  ]);

  const pending = await store.listPendingNotes();
  const note = pending.items.find((item) => item.id === noteId);
  assert.ok(note);
  assert.equal(note.mediaCount, 3);
  assert.deepEqual(note.media, [
    { id: "note-media-ready", status: "ready", contentType: "image/jpeg", size: 1024 },
    { id: "note-media-processing", status: "processing", contentType: "image/jpeg", size: 1024 },
    { id: "note-media-rejected", status: "rejected", contentType: "image/jpeg", size: 1024 }
  ]);

  assert.deepEqual(
    await store.getFieldNoteMedia(noteId, "note-media-ready", "staff-media-review"),
    { key: "derivatives/note-media-ready.webp", contentType: "image/jpeg" }
  );
  assert.equal(await store.getFieldNoteMedia(noteId, "note-media-processing", "staff-media-review"), null);
  assert.equal(await store.getFieldNoteMedia(noteId, "other-note-media", "staff-media-review"), null);

  const replay = await store.createFieldNote({
    authorSubject: "hunter-alert",
    waypointId: 1,
    body: "A different retry body must not create a duplicate.",
    media: []
  }, "pending-media-note-key");
  assert.equal(replay.replayed, true);
  assert.equal(replay.operatorAlertJobId, null);
  assert.equal(replay.value.id, noteId);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM field_notes").first<{ count: number }>())?.count,
    1
  );
});

const officialUpdateMediaInsert = (db: D1Database, updateId: string, mediaId: string) =>
  db
    .prepare(
      `INSERT INTO official_update_media (update_id, media_id, selected_by, selected_at)
       VALUES (?, ?, 'staff-1', ?)`
    )
    .bind(updateId, mediaId, "2026-07-15T20:03:00.000Z");

const canonicalJson = (input: unknown): string => {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`;
  const record = input as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
};

const operatorAlertMigrationFiles = [
  "0001_hunter_platform.sql",
  "0002_consent_ledger_index.sql",
  "0003_player_accounts_and_legal_acceptance.sql",
  "0004_environment_metadata.sql",
  "0005_sponsor_inquiries.sql",
  "0006_participation_waiver_and_receipts.sql",
  "0007_waiver_receipt_leases.sql",
  "0008_immutable_waiver_ledgers.sql",
  "0009_atomic_rate_limits.sql",
  "0010_graph_transactional_email.sql",
  "0011_report_publication_and_participation.sql",
  "0012_lucky_13_waypoints.sql",
  "0015_submission_ops_publication_refinement.sql"
] as const;

const createOperatorAlertDatabase = async (t: { after(callback: () => unknown): void }) => {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `operator-alert-store-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of operatorAlertMigrationFiles) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }
  return db;
};

const applyOperatorAlertMigration = async (db: D1Database) => {
  const sql = await readFile(
    path.join(root, "migrations", "0013_operator_submission_alerts.sql"),
    "utf8"
  );
  await applySql(db, sql);
};

const seedOperatorAlertFixtures = async (db: D1Database) => {
  const timestamp = "2026-07-16T18:00:00.000Z";
  await db.batch([
    db.prepare(
      `INSERT INTO waypoints
       (id, route_order, name, description, is_published, updated_at, updated_by)
       VALUES (1, 1, 'Waypoint One', 'Public description.', 1, ?, 'staff-seed')`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('hunter-alert', 'hunter-alert@example.test', 'Alert Hunter', 'Hunter Alert', ?,
               'adult', NULL, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-active-domain', 'subject-active-domain', 'ops@sebahub.com', 'Ops One',
               'active', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-active-external', 'subject-active-external', 'operator@unrelated.example',
               'Ops External', 'active', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-not-activated', 'subject-not-activated', 'not-activated@sebahub.com',
               'Not Activated', 'active', ?, NULL)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-invited', NULL, 'invited@sebahub.com', 'Invited', 'invited', ?, NULL)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-suspended', 'subject-suspended', 'suspended@sebahub.com', 'Suspended',
               'suspended', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO staff_principals
       (id, provider_subject, normalized_email, display_name, status, invited_at, activated_at)
       VALUES ('staff-revoked', 'subject-revoked', 'revoked@sebahub.com', 'Revoked',
               'revoked', ?, ?)`
    ).bind(timestamp, timestamp)
  ]);
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
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
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

  await assert.rejects(
    store.upsertProfile("hunter-invalid-basis", {
      verifiedEmail: "hunter-invalid-basis@example.test",
      fullName: "Invalid Basis",
      participationBasis: "unexpected-value",
      privacyMediaVersion: privacyMediaDocument.version,
      privacyMediaHash: privacyMediaDocument.hash
    }),
    (error: unknown) => error instanceof ApiError && error.code === "participation_basis_required"
  );

  const preparePlayer = async (subject: string) => {
    await store.upsertPlayerAccount(subject, `${subject}@example.test`);
    await store.upsertProfile(subject, {
      verifiedEmail: `${subject}@example.test`,
      fullName: `Adult ${subject}`,
      townArea: "Seba Beach",
      interests: ["treasure-hunt"],
      discoverySource: "friend",
      participationBasis: "adult",
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

  await preparePlayer("hunter-replay-backoff");
  const replayBackoffReview = await store.recordWaiverReview("hunter-replay-backoff", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  const replayBackoffInput = {
    ...input,
    reviewEventId: replayBackoffReview.id,
    idempotencyKey: "replay-after-interrupted-schedule",
    adultName: "Replay Test Adult",
    minors: []
  };
  const replayBackoffAcceptance = await store.acceptParticipationWaiver(
    "hunter-replay-backoff",
    replayBackoffInput
  );
  await db
    .prepare(
      `UPDATE notification_jobs
       SET status = 'failed', next_attempt_at = '9999-12-31T23:59:59.999Z',
           last_error_code = 'provider_unavailable'
       WHERE id = ?`
    )
    .bind(replayBackoffAcceptance.value.receipt.jobId)
    .run();
  await db
    .prepare(
      `INSERT INTO notification_job_leases
       (notification_job_id, lease_token, attempt_generation, lease_until, claimed_at)
       VALUES (?, 'active-replay-lease', 0, '9999-12-31T23:59:59.999Z', ?)`
    )
    .bind(replayBackoffAcceptance.value.receipt.jobId, new Date().toISOString())
    .run();
  const replayMessages: TransactionalMessage[] = [];
  const receiptSender = new ManagedWaiverReceipts(store, {
    mailer: {
      async send(message) {
        replayMessages.push(message);
        return {
          provider: "microsoft_graph",
          providerReference: "replay-delivery-1",
          providerReferenceKind: "graph_request_id",
          acceptedAt: "2026-07-14T18:00:00.000Z"
        };
      }
    },
    sender: { name: "Tim Lost Something? by SebaHub", address: "tech@sebahub.com" },
    replyTo: "casey@sebahub.com",
    canonicalOrigin: "https://www.timlostsomething.com/"
  });
  const replayApi = createApi({
    store,
    identity: {
      async authenticateHunter(request) {
        return request.headers.get("authorization") === "Bearer replay-hunter"
          ? {
              kind: "hunter" as const,
              subject: "hunter-replay-backoff",
              email: "hunter-replay-backoff@example.test"
            }
          : null;
      },
      async authenticateStaff() {
        return null;
      }
    },
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    waiverReceipts: receiptSender,
    environment: new FakeEnvironment()
  });
  const requestReplay = () =>
    replayApi.request("https://www.timlostsomething.com/api/v1/me/waiver/accept", {
      method: "POST",
      ...json(
        {
          reviewEventId: replayBackoffReview.id,
          version: participationWaiverDocument.version,
          hash: participationWaiverDocument.hash,
          waiverAccepted: true,
          guardianAttested: true,
          minors: replayBackoffInput.minors
        },
        {
          authorization: "Bearer replay-hunter",
          origin: "https://www.timlostsomething.com",
          "idempotency-key": replayBackoffInput.idempotencyKey
        }
      )
    });

  const activeLeaseReplay = await requestReplay();
  assert.equal(
    activeLeaseReplay.status,
    200,
    JSON.stringify(await responseJson(activeLeaseReplay.clone()))
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(replayMessages.length, 0, "an active receipt lease suppresses replay delivery");
  const replayActiveLeaseState = await db
    .prepare(
      `SELECT j.status, j.next_attempt_at, lease.lease_token
       FROM notification_jobs j
       JOIN notification_job_leases lease ON lease.notification_job_id = j.id
       WHERE j.id = ?`
    )
    .bind(replayBackoffAcceptance.value.receipt.jobId)
    .first<{ status: string; next_attempt_at: string; lease_token: string }>();
  assert.deepEqual(replayActiveLeaseState, {
    status: "failed",
    next_attempt_at: "9999-12-31T23:59:59.999Z",
    lease_token: "active-replay-lease"
  });

  await db
    .prepare("DELETE FROM notification_job_leases WHERE notification_job_id = ?")
    .bind(replayBackoffAcceptance.value.receipt.jobId)
    .run();
  const replayResponse = await requestReplay();
  assert.equal(replayResponse.status, 200, JSON.stringify(await responseJson(replayResponse.clone())));
  for (let attempt = 0; attempt < 40 && replayMessages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(replayMessages.length, 1, "a deliberate idempotent replay bypasses stale receipt backoff");
  assert.equal(
    (await store.getParticipationWaiver("hunter-replay-backoff"))?.receipt.status,
    "sent"
  );
  const sentReplay = await requestReplay();
  assert.equal(sentReplay.status, 200, JSON.stringify(await responseJson(sentReplay.clone())));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(replayMessages.length, 1, "a sent receipt remains silent on acceptance replay");

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
    db.prepare("SELECT COUNT(*) AS count FROM waiver_account_participants WHERE acceptance_event_id = ?").bind(accepted.value.id).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM waiver_acceptance_participants WHERE acceptance_event_id = ?").bind(accepted.value.id).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM notification_jobs WHERE target_record_id = ? AND kind = 'waiver_receipt'").bind(accepted.value.id).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_events WHERE notification_job_id = ? AND event_type = 'queued'").bind(accepted.value.receipt.jobId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ? AND idempotency_key = ?").bind("waiver_acceptance:hunter-current-1", input.idempotencyKey).first<{ count: number }>()
  ]);
  assert.deepEqual(counts.map((row) => row?.count), [1, 1, 2, 1, 1, 1]);
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
    provider: "microsoft_graph",
    providerReference: "graph-request-1",
    providerReferenceKind: "graph_request_id",
    acceptedAt: "2026-07-14T18:00:00.000Z"
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
    .prepare(
      `SELECT provider, provider_message_id, provider_reference, provider_reference_kind,
              error_code, occurred_at
       FROM notification_delivery_events
       WHERE notification_job_id = ? ORDER BY occurred_at DESC, id DESC`
    )
    .bind(claimed!.id)
    .all<{
      provider: string | null;
      provider_message_id: string | null;
      provider_reference: string | null;
      provider_reference_kind: string | null;
      error_code: string | null;
      occurred_at: string;
    }>();
  assert.deepEqual(
    evidence.results.filter((event) => event.provider_reference !== null),
    [{
      provider: "microsoft_graph",
      provider_message_id: null,
      provider_reference: "graph-request-1",
      provider_reference_kind: "graph_request_id",
      error_code: null,
      occurred_at: "2026-07-14T18:00:00.000Z"
    }]
  );
  assert.equal(
    evidence.results.filter((event) => event.error_code !== null).length,
    1,
    "the stale completion appends no losing delivery event"
  );

  await store.queueWaiverReceiptResend("hunter-current-1", accepted.value.id);
  const resendClaim = await store.claimWaiverReceiptJob(accepted.value.id);
  assert.ok(resendClaim);
  await store.completeWaiverReceiptJob(resendClaim, {
    status: "sent",
    provider: "resend",
    providerReference: "resend-message-2",
    providerReferenceKind: "resend_message_id",
    acceptedAt: "2026-07-14T18:05:00.000Z"
  });
  await store.queueWaiverReceiptResend("hunter-current-1", accepted.value.id);
  const mismatchedGraphClaim = await store.claimWaiverReceiptJob(accepted.value.id);
  assert.ok(mismatchedGraphClaim);
  const completionState = async () => {
    const jobState = await db
      .prepare(
        `SELECT status, attempts, next_attempt_at, last_error_code, updated_at
         FROM notification_jobs WHERE id = ?`
      )
      .bind(mismatchedGraphClaim.id)
      .first<Record<string, unknown>>();
    const leaseState = await db
      .prepare(
        `SELECT lease_token, attempt_generation, lease_until, claimed_at
         FROM notification_job_leases WHERE notification_job_id = ?`
      )
      .bind(mismatchedGraphClaim.id)
      .first<Record<string, unknown>>();
    const deliveryState = await db
      .prepare(
        `SELECT id, event_type, provider, provider_message_id, provider_reference,
                provider_reference_kind, error_code, occurred_at
         FROM notification_delivery_events
         WHERE notification_job_id = ? ORDER BY occurred_at, id`
      )
      .bind(mismatchedGraphClaim.id)
      .all<Record<string, unknown>>();
    return { jobState, leaseState, deliveryState: deliveryState.results };
  };
  const beforeInvalidCompletion = await completionState();
  // @ts-expect-error Graph acceptance cannot use a Resend-only reference kind.
  const mismatchedGraphAcceptance: TransactionalMailAcceptance = {
    provider: "microsoft_graph",
    providerReference: "graph-kind-mismatch",
    providerReferenceKind: "resend_message_id",
    acceptedAt: "2026-07-14T18:10:00.000Z"
  };
  const invalidCompletions: Array<{ name: string; result: WaiverReceiptCompletion }> = [
    {
      name: "mismatched provider and reference kind",
      result: { status: "sent", ...mismatchedGraphAcceptance }
    },
    {
      name: "empty provider reference",
      result: {
        status: "sent",
        provider: "microsoft_graph",
        providerReference: "",
        providerReferenceKind: "graph_request_id",
        acceptedAt: "2026-07-14T18:10:00.000Z"
      }
    },
    {
      name: "oversized provider reference",
      result: {
        status: "sent",
        provider: "resend",
        providerReference: "r".repeat(129),
        providerReferenceKind: "resend_message_id",
        acceptedAt: "2026-07-14T18:10:00.000Z"
      }
    },
    {
      name: "unsafe provider reference",
      result: {
        status: "sent",
        provider: "microsoft_graph",
        providerReference: "graph-reference\nprivate-detail",
        providerReferenceKind: "client_request_id",
        acceptedAt: "2026-07-14T18:10:00.000Z"
      }
    },
    {
      name: "non-string provider reference",
      result: {
        status: "sent",
        provider: "microsoft_graph",
        providerReference: null,
        providerReferenceKind: "graph_request_id",
        acceptedAt: "2026-07-14T18:10:00.000Z"
      } as unknown as WaiverReceiptCompletion
    },
    {
      name: "non-canonical provider timestamp",
      result: {
        status: "sent",
        provider: "microsoft_graph",
        providerReference: "graph-request-invalid-time",
        providerReferenceKind: "graph_request_id",
        acceptedAt: "2026-07-14T18:10:00Z"
      }
    }
  ];
  for (const invalid of invalidCompletions) {
    await assert.rejects(
      () => store.completeWaiverReceiptJob(mismatchedGraphClaim, invalid.result),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 422 &&
        error.code === "waiver_receipt_acceptance_invalid" &&
        error.message === "The receipt provider acceptance is invalid.",
      invalid.name
    );
    assert.deepEqual(
      await completionState(),
      beforeInvalidCompletion,
      `${invalid.name} leaves the job, lease, and immutable delivery ledger unchanged`
    );
  }
  const sentEvidence = await db
    .prepare(
      `SELECT provider, provider_message_id, provider_reference, provider_reference_kind, occurred_at
       FROM notification_delivery_events
       WHERE notification_job_id = ? AND event_type = 'sent'
       ORDER BY occurred_at, id`
    )
    .bind(claimed!.id)
    .all<{
      provider: string | null;
      provider_message_id: string | null;
      provider_reference: string | null;
      provider_reference_kind: string | null;
      occurred_at: string;
    }>();
  assert.deepEqual(sentEvidence.results, [
    {
      provider: "microsoft_graph",
      provider_message_id: null,
      provider_reference: "graph-request-1",
      provider_reference_kind: "graph_request_id",
      occurred_at: "2026-07-14T18:00:00.000Z"
    },
    {
      provider: "resend",
      provider_message_id: "resend-message-2",
      provider_reference: "resend-message-2",
      provider_reference_kind: "resend_message_id",
      occurred_at: "2026-07-14T18:05:00.000Z"
    }
  ]);
  const afterResendCount = await db
    .prepare("SELECT COUNT(*) AS count FROM legal_acceptance_events WHERE id = ?")
    .bind(accepted.value.id)
    .first<{ count: number }>();
  assert.equal(afterResendCount?.count, 1, "resending never creates another legal acceptance");

  const uncertain = await prepareRaceAcceptance(
    "hunter-uncertain-receipt",
    "uncertain-receipt"
  );
  const uncertainClaim = await store.claimWaiverReceiptJob(uncertain.value.id);
  assert.ok(uncertainClaim);
  await store.completeWaiverReceiptJob(uncertainClaim, {
    status: "failed",
    errorCode: "provider_delivery_uncertain"
  });

  const uncertainProjection = await store.getParticipationWaiver(
    "hunter-uncertain-receipt"
  );
  assert.equal(uncertainProjection?.receipt.status, "uncertain");
  assert.doesNotMatch(
    JSON.stringify(uncertainProjection),
    /providerReference|provider_reference|provider_message_id|graph_request_id|client_request_id/i
  );
  const uncertainReplay = await store.acceptParticipationWaiver(
    "hunter-uncertain-receipt",
    {
      ...input,
      reviewEventId: "unused-on-idempotent-replay",
      idempotencyKey: "uncertain-receipt",
      adultName: "Race Test Adult",
      minors: []
    }
  );
  assert.equal(uncertainReplay.replayed, true);
  assert.equal(
    await store.requeueWaiverReceiptForAcceptanceReplay(
      "hunter-uncertain-receipt",
      uncertain.value.id
    ),
    false,
    "acceptance replay cannot requeue an uncertain delivery"
  );
  assert.equal(
    (await store.queueWaiverReceiptResend(
      "hunter-uncertain-receipt",
      uncertain.value.id
    ))?.receipt.status,
    "uncertain",
    "participant resend preserves the uncertain projection"
  );
  assert.equal(
    await store.claimWaiverReceiptJob(uncertain.value.id),
    null,
    "the ordinary worker claim path cannot retry an uncertain delivery"
  );
  assert.deepEqual(
    await store.queueOpsWaiverReceiptResend(
      "hunter-uncertain-receipt",
      uncertain.value.id,
      "staff-uncertain-review"
    ),
    { status: "uncertain" },
    "standard Ops retry is fenced until mailbox confirmation"
  );

  const confirmedRetries = await Promise.all([
    store.queueOpsWaiverReceiptResend(
      "hunter-uncertain-receipt",
      uncertain.value.id,
      "staff-uncertain-review",
      true
    ),
    store.queueOpsWaiverReceiptResend(
      "hunter-uncertain-receipt",
      uncertain.value.id,
      "staff-uncertain-review",
      true
    )
  ]);
  assert.equal(
    confirmedRetries.filter((result) => result.status === "queued").length,
    1,
    "only one concurrent confirmed uncertain retry wins the D1 fence"
  );
  assert.equal(
    confirmedRetries.filter((result) => result.status === "in_progress").length,
    1,
    "the losing concurrent confirmation observes the in-progress retry"
  );
  const uncertainEvidence = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM notification_delivery_events
         WHERE notification_job_id = ? AND event_type = 'requeued'`
      )
      .bind(uncertain.value.receipt.jobId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_events
         WHERE target_id = ? AND action = 'player.waiver-receipt.requested'`
      )
      .bind(uncertain.value.id)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_events
         WHERE target_id = ?
           AND action = 'player.waiver-receipt.uncertain-retry-confirmed'`
      )
      .bind(uncertain.value.id)
      .first<{ count: number }>()
  ]);
  assert.deepEqual(
    uncertainEvidence.map((row) => row?.count ?? 0),
    [1, 1, 1],
    "the winning retry, ordinary audit, and explicit mailbox confirmation commit together"
  );
  const uncertainAudit = await db
    .prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events
       WHERE target_id = ?
         AND action = 'player.waiver-receipt.uncertain-retry-confirmed'`
    )
    .bind(uncertain.value.id)
    .first<Record<string, unknown>>();
  assert.deepEqual(uncertainAudit, {
    actor_subject: "staff-uncertain-review",
    action: "player.waiver-receipt.uncertain-retry-confirmed",
    target_kind: "legal_acceptance",
    target_id: uncertain.value.id,
    metadata_json: "{}"
  });

  await store.upsertPlayerAccount("hunter-minor-success", "hunter-minor-success@example.test");
  await store.upsertProfile("hunter-minor-success", {
    verifiedEmail: "hunter-minor-success@example.test",
    fullName: "Young D1 Hunter",
    townArea: "Seba Beach",
    interests: ["treasure-hunt"],
    discoverySource: "friend",
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: true,
    consents: { huntEmail: false, marketing: false },
    privacyMediaVersion: privacyMediaDocument.version,
    privacyMediaHash: privacyMediaDocument.hash
  });
  const minorReview = await store.recordWaiverReview("hunter-minor-success", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  const minorAcceptance = await store.acceptParticipationWaiver("hunter-minor-success", {
    reviewEventId: minorReview.id,
    idempotencyKey: "minor-success",
    adultName: "Untrusted client name",
    minors: [],
    guardianAttested: false,
    documentVersion: participationWaiverDocument.version,
    documentHash: participationWaiverDocument.hash
  });
  const expectedMinorSnapshot = [{
    role: "minor" as const,
    participationBasis: "minor_guardian_permission" as const,
    fullName: "Young D1 Hunter",
    birthYear: null,
    guardianAttested: true
  }];
  assert.deepEqual(minorAcceptance.value.participants, expectedMinorSnapshot);
  assert.deepEqual(
    (await store.getParticipationWaiver("hunter-minor-success"))?.participants,
    expectedMinorSnapshot
  );
  assert.deepEqual(
    (await store.getWaiverReceiptEnvelope(minorAcceptance.value.id))?.acceptance.participants,
    expectedMinorSnapshot
  );
  assert.deepEqual(
    (await store.getAndAuditOpsWaiverDetail("hunter-minor-success", "staff-minor-viewer"))?.participants,
    expectedMinorSnapshot
  );
  const minorAccess = await store.getPlayerAccess("hunter-minor-success");
  assert.equal(minorAccess.waiverStatus, "accepted");
  assert.equal(minorAccess.participationUnlocked, true);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT participation_basis, full_name, guardian_permission_attested
         FROM waiver_account_participants WHERE acceptance_event_id = ?`
      )
      .bind(minorAcceptance.value.id)
      .first<Record<string, unknown>>(),
    {
      participation_basis: "minor_guardian_permission",
      full_name: "Young D1 Hunter",
      guardian_permission_attested: 1
    }
  );

  await store.upsertProfile("hunter-current-1", {
    verifiedEmail: "hunter-current-1@example.test",
    fullName: "Adult hunter-current-1",
    townArea: "Seba Beach",
    interests: ["treasure-hunt"],
    discoverySource: "friend",
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: true,
    consents: { huntEmail: false, marketing: false },
    privacyMediaVersion: privacyMediaDocument.version,
    privacyMediaHash: privacyMediaDocument.hash
  });
  assert.equal((await store.getPlayerAccess("hunter-current-1")).participationUnlocked, false);
  assert.equal(
    await store.getParticipationWaiver("hunter-current-1"),
    null,
    "changing the account participation basis requires a matching fresh waiver"
  );

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

test("the real D1 report publication migration stores participation and enforces immutable snapshots", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
  ];
  const migrations = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(root, "migrations", file), "utf8"))
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `report-publication-migration-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;

  for (const sql of migrations) await applySql(db, sql);

  await db.batch([
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at, created_at, updated_at)
         VALUES ('hunter-adult', 'adult@example.test', 'Adult Hunter', 'adult-hunter', ?, ?, ?)`
      )
      .bind(
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-minor', 'minor@example.test', 'Minor Hunter', 'minor-hunter', ?,
                 'minor_guardian_permission', ?, ?, ?)`
      )
      .bind(
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z"
      ),
    playerInsert(db, "hunter-adult"),
    playerInsert(db, "hunter-minor")
  ]);

  const adult = await db
    .prepare(
      `SELECT participation_basis, guardian_permission_attested_at
       FROM hunter_profiles WHERE subject = 'hunter-adult'`
    )
    .first<{ participation_basis: string; guardian_permission_attested_at: string | null }>();
  const minor = await db
    .prepare(
      `SELECT participation_basis, guardian_permission_attested_at
       FROM hunter_profiles WHERE subject = 'hunter-minor'`
    )
    .first<{ participation_basis: string; guardian_permission_attested_at: string | null }>();
  assert.equal(adult?.participation_basis, "adult");
  assert.equal(adult?.guardian_permission_attested_at, null);
  assert.equal(minor?.participation_basis, "minor_guardian_permission");
  assert.ok(minor?.guardian_permission_attested_at);
  await assert.rejects(
    db
      .prepare("UPDATE hunter_profiles SET participation_basis = 'minor' WHERE subject = 'hunter-adult'")
      .run(),
    /CHECK constraint failed/i
  );
  const invalidProfileInserts = [
    `INSERT INTO hunter_profiles
     (subject, verified_email, full_name, public_handle, adult_attested_at,
      participation_basis, guardian_permission_attested_at, created_at, updated_at)
     VALUES ('hunter-invalid-adult', 'invalid-adult@example.test', 'Invalid Adult',
             'invalid-adult', '2026-07-15T20:00:00.000Z', 'adult',
             '2026-07-15T20:00:00.000Z', '2026-07-15T20:00:00.000Z',
             '2026-07-15T20:00:00.000Z')`,
    `INSERT INTO hunter_profiles
     (subject, verified_email, full_name, public_handle, adult_attested_at,
      participation_basis, guardian_permission_attested_at, created_at, updated_at)
     VALUES ('hunter-invalid-minor', 'invalid-minor@example.test', 'Invalid Minor',
             'invalid-minor', '2026-07-15T20:00:00.000Z', 'minor_guardian_permission', NULL,
             '2026-07-15T20:00:00.000Z', '2026-07-15T20:00:00.000Z')`
  ];
  for (const invalidInsert of invalidProfileInserts) {
    await assert.rejects(
      db.prepare(invalidInsert).run(),
      /hunter profile participation and guardian permission are inconsistent/i
    );
  }
  const invalidProfileUpdates = [
    "UPDATE hunter_profiles SET participation_basis = 'minor_guardian_permission' WHERE subject = 'hunter-adult'",
    "UPDATE hunter_profiles SET participation_basis = 'adult' WHERE subject = 'hunter-minor'"
  ];
  for (const invalidUpdate of invalidProfileUpdates) {
    await assert.rejects(
      db.prepare(invalidUpdate).run(),
      /hunter profile participation and guardian permission are inconsistent/i
    );
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO waypoints
         (id, route_order, name, description, member_exact_url, member_content,
          is_published, updated_at, updated_by)
         VALUES (1, 1, 'Creek crossing', 'Public waypoint description.', NULL, NULL, 1, ?, 'staff-1')`
      )
      .bind("2026-07-15T20:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO private_reports
         (id, report_type, hunter_subject, reporter_name, reporter_email, reporter_phone,
          waypoint_id, location_description, latitude, longitude, details, status, created_at, updated_at)
         VALUES ('report-published', 'find', 'hunter-adult', 'Adult Hunter', 'adult@example.test',
                 '780-555-0123', 1, 'Near the trail', 53.123, -114.456,
                 'Found a possible clue.', 'verified', ?, ?)`
      )
      .bind("2026-07-15T20:01:00.000Z", "2026-07-15T20:01:00.000Z"),
    db
      .prepare(
        `INSERT INTO private_reports
         (id, report_type, hunter_subject, reporter_name, reporter_email, location_description,
          details, status, created_at, updated_at)
         VALUES ('report-other', 'tip', 'hunter-adult', 'Adult Hunter', 'adult@example.test',
                 'Across the trail', 'A different report.', 'verified', ?, ?)`
      )
      .bind("2026-07-15T20:01:00.000Z", "2026-07-15T20:01:00.000Z")
  ]);
  await db
    .prepare(
      `INSERT INTO official_updates
       (id, title, body, publisher_subject, published_at, source_report_id)
       VALUES ('update-report-1', 'Hunter report', 'A possible clue was found.', 'staff-1', ?,
               'report-published')`
    )
    .bind("2026-07-15T20:02:00.000Z")
    .run();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, published_at, source_report_id)
         VALUES ('update-report-2', 'Duplicate report', 'Duplicate publication.', 'staff-1', ?,
                 'report-published')`
      )
      .bind("2026-07-15T20:03:00.000Z")
      .run(),
    /UNIQUE constraint failed/i
  );

  const coordinateUpdateInsert = (id: string, latitude: number | null, longitude: number | null) =>
    db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, published_at, latitude, longitude)
         VALUES (?, 'Coordinate update', 'A location update.', 'staff-1', ?, ?, ?)`
      )
      .bind(id, "2026-07-15T20:03:00.000Z", latitude, longitude);
  await assert.rejects(
    coordinateUpdateInsert("update-invalid-latitude", 91, 0).run(),
    /official update coordinates are invalid/i
  );
  await assert.rejects(
    coordinateUpdateInsert("update-half-coordinates", 53.5, null).run(),
    /official update coordinates are invalid/i
  );
  await coordinateUpdateInsert("update-valid-coordinates", 53.5, -113.5).run();
  assert.deepEqual(
    await db
      .prepare(
        `SELECT latitude, longitude FROM official_updates
         WHERE id = 'update-valid-coordinates'`
      )
      .first<{ latitude: number; longitude: number }>(),
    { latitude: 53.5, longitude: -113.5 }
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE official_updates SET longitude = 181
         WHERE id = 'update-valid-coordinates'`
      )
      .run(),
    /official update coordinates are invalid/i
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE official_updates SET latitude = NULL
         WHERE id = 'update-valid-coordinates'`
      )
      .run(),
    /official update coordinates are invalid/i
  );

  await db.batch([
    db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, published_at)
         VALUES ('update-ordinary', 'Ordinary update', 'No source report.', 'staff-1', ?)`
      )
      .bind("2026-07-15T20:03:00.000Z"),
    mediaUploadInsert(
      db,
      "media-valid",
      "report",
      "report-published",
      "ready",
      "derivatives/media-valid.jpg"
    ),
    mediaUploadInsert(
      db,
      "media-cross-report",
      "report",
      "report-other",
      "ready",
      "derivatives/media-cross-report.jpg"
    ),
    mediaUploadInsert(
      db,
      "media-field-note",
      "field_note",
      "note-1",
      "ready",
      "derivatives/media-field-note.jpg"
    ),
    mediaUploadInsert(
      db,
      "media-processing",
      "report",
      "report-published",
      "processing",
      "derivatives/media-processing.jpg"
    ),
    mediaUploadInsert(db, "media-no-derivative", "report", "report-published", "ready", null),
    mediaUploadInsert(
      db,
      "media-outside-derivatives",
      "report",
      "report-published",
      "ready",
      "originals/media-outside-derivatives.jpg"
    )
  ]);

  const privateReportStore = new D1DataStore(db) as unknown as {
    getReportDetail(id: string, actorSubject: string): Promise<Record<string, unknown> | null>;
    getReportMedia(
      reportId: string,
      mediaId: string,
      actorSubject: string
    ): Promise<{ key: string; contentType: string } | null>;
  };
  const detail = await privateReportStore.getReportDetail("report-published", "staff-private-review");
  assert.ok(detail);
  assert.equal(detail.email, "adult@example.test");
  assert.equal(detail.phone, "780-555-0123");
  assert.equal(detail.waypointId, 1);
  assert.equal(detail.locationDescription, "Near the trail");
  assert.equal(detail.details, "Found a possible clue.");
  assert.equal(detail.latitude, 53.123);
  assert.equal(detail.longitude, -114.456);
  assert.deepEqual(
    (detail.media as Array<Record<string, unknown>>).sort((left, right) =>
      String(left.id).localeCompare(String(right.id))
    ),
    [
      { id: "media-no-derivative", contentType: "image/jpeg", size: 1024, status: "ready" },
      { id: "media-outside-derivatives", contentType: "image/jpeg", size: 1024, status: "ready" },
      { id: "media-processing", contentType: "image/jpeg", size: 1024, status: "processing" },
      { id: "media-valid", contentType: "image/jpeg", size: 1024, status: "ready" }
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(detail),
    /privateObjectKey|derivativeObjectKey|private\/|originals\/|derivatives\//i
  );
  const detailAudit = await db
    .prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events WHERE action = 'report.detail.viewed' AND target_id = ?`
    )
    .bind("report-published")
    .first<Record<string, unknown>>();
  assert.deepEqual(detailAudit, {
    actor_subject: "staff-private-review",
    action: "report.detail.viewed",
    target_kind: "report",
    target_id: "report-published",
    metadata_json: "{}"
  });

  assert.deepEqual(
    await privateReportStore.getReportMedia(
      "report-published",
      "media-valid",
      "staff-private-media"
    ),
    { key: "derivatives/media-valid.jpg", contentType: "image/jpeg" }
  );
  assert.equal(
    await privateReportStore.getReportMedia(
      "report-published",
      "media-cross-report",
      "staff-private-media"
    ),
    null
  );
  assert.equal(
    await privateReportStore.getReportMedia(
      "report-published",
      "media-outside-derivatives",
      "staff-private-media"
    ),
    null
  );
  assert.equal(
    await privateReportStore.getReportMedia(
      "report-published",
      "media-processing",
      "staff-private-media"
    ),
    null
  );
  assert.equal(
    await privateReportStore.getReportMedia(
      "report-published",
      "media-no-derivative",
      "staff-private-media"
    ),
    null
  );
  const mediaAudits = await db
    .prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events WHERE action = 'report.media.viewed' ORDER BY occurred_at`
    )
    .all<Record<string, unknown>>();
  assert.deepEqual(mediaAudits.results, [
    {
      actor_subject: "staff-private-media",
      action: "report.media.viewed",
      target_kind: "report",
      target_id: "report-published",
      metadata_json: '{"mediaId":"media-valid"}'
    }
  ]);
  const invalidMediaSelections = [
    ["update-ordinary", "media-valid"],
    ["update-report-1", "media-cross-report"],
    ["update-report-1", "media-field-note"],
    ["update-report-1", "media-processing"],
    ["update-report-1", "media-no-derivative"]
  ] as const;
  for (const [updateId, mediaId] of invalidMediaSelections) {
    await assert.rejects(
      officialUpdateMediaInsert(db, updateId, mediaId).run(),
      /official update media must select a ready report derivative/i
    );
  }
  await officialUpdateMediaInsert(db, "update-report-1", "media-valid").run();
  const invalidMediaSelectionUpdates = [
    "UPDATE official_update_media SET update_id = 'update-ordinary' WHERE update_id = 'update-report-1' AND media_id = 'media-valid'",
    "UPDATE official_update_media SET media_id = 'media-cross-report' WHERE update_id = 'update-report-1' AND media_id = 'media-valid'",
    "UPDATE official_update_media SET media_id = 'media-field-note' WHERE update_id = 'update-report-1' AND media_id = 'media-valid'",
    "UPDATE official_update_media SET media_id = 'media-processing' WHERE update_id = 'update-report-1' AND media_id = 'media-valid'",
    "UPDATE official_update_media SET media_id = 'media-no-derivative' WHERE update_id = 'update-report-1' AND media_id = 'media-valid'"
  ];
  for (const invalidUpdate of invalidMediaSelectionUpdates) {
    await assert.rejects(
      db.prepare(invalidUpdate).run(),
      /official update media must select a ready report derivative/i
    );
  }
  await assert.rejects(
    db
      .prepare(
        `UPDATE official_updates SET source_report_id = 'report-other'
         WHERE id = 'update-report-1'`
      )
      .run(),
    /selected official update media must remain valid/i
  );
  const invalidSelectedMediaUpdates = [
    "UPDATE media_uploads SET owner_kind = 'field_note' WHERE id = 'media-valid'",
    "UPDATE media_uploads SET owner_id = 'report-other' WHERE id = 'media-valid'",
    "UPDATE media_uploads SET status = 'processing' WHERE id = 'media-valid'",
    "UPDATE media_uploads SET derivative_object_key = NULL WHERE id = 'media-valid'"
  ];
  for (const invalidUpdate of invalidSelectedMediaUpdates) {
    await assert.rejects(
      db.prepare(invalidUpdate).run(),
      /selected publication media must remain valid/i
    );
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-account-adult', 'hunter-adult', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-account-minor', 'hunter-minor', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-invalid-adult', 'hunter-adult', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-invalid-minor', 'hunter-minor', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-privacy', 'hunter-adult', 'privacy_media',
                 '2026.3', 'privacy-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-withdrawn', 'hunter-adult', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'withdrawn', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES ('acceptance-mismatched-profile', 'hunter-adult', 'participation_waiver',
                 '2026.2', 'waiver-hash', 'accepted', ?)`
      )
      .bind("2026-07-15T20:04:00.000Z")
  ]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('acceptance-account-adult', 'adult', 'Adult Hunter', 0, ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('acceptance-account-minor', 'minor_guardian_permission', 'Minor Hunter', 1, ?)`
      )
      .bind("2026-07-15T20:04:00.000Z")
  ]);
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('acceptance-invalid-adult', 'adult', 'Adult Hunter', 1, ?)`
      )
      .bind("2026-07-15T20:05:00.000Z")
      .run(),
    /CHECK constraint failed/i
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('acceptance-invalid-minor', 'minor_guardian_permission', 'Minor Hunter', 0, ?)`
      )
      .bind("2026-07-15T20:05:00.000Z")
      .run(),
    /CHECK constraint failed/i
  );
  const invalidAccountSnapshots = [
    ["acceptance-privacy", "adult", "Adult Hunter", 0],
    ["acceptance-withdrawn", "adult", "Adult Hunter", 0],
    ["acceptance-mismatched-profile", "adult", "Changed Adult", 0],
    ["acceptance-mismatched-profile", "minor_guardian_permission", "Adult Hunter", 1]
  ] as const;
  for (const [acceptanceId, basis, fullName, guardianAttested] of invalidAccountSnapshots) {
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO waiver_account_participants
           (acceptance_event_id, participation_basis, full_name,
            guardian_permission_attested, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          acceptanceId,
          basis,
          fullName,
          guardianAttested,
          "2026-07-15T20:05:00.000Z"
        )
        .run(),
      /waiver account participant must match an accepted waiver profile/i
    );
  }
  await assert.rejects(
    db
      .prepare(
        `UPDATE waiver_account_participants SET full_name = 'Changed Name'
         WHERE acceptance_event_id = 'acceptance-account-adult'`
      )
      .run(),
    /waiver account participants are immutable/i
  );
  await assert.rejects(
    db
      .prepare(
        `DELETE FROM waiver_account_participants
         WHERE acceptance_event_id = 'acceptance-account-minor'`
      )
      .run(),
    /waiver account participants are immutable/i
  );
});

test("real D1 atomically changes private report state with its event and audit history", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
  ];
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `report-status-atomic-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of migrationFiles) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }
  await db.prepare(
    `INSERT INTO private_reports
     (id, report_type, reporter_name, reporter_email, location_description, details,
      status, created_at, updated_at)
     VALUES ('report-atomic', 'tip', 'Private Reporter', 'private@example.test',
             'Near the trail', 'Private details', 'reviewing', ?, ?)`
  ).bind("2026-07-15T20:00:00.000Z", "2026-07-15T20:00:00.000Z").run();
  const store = new D1DataStore(db);

  await db.prepare(
    `INSERT INTO private_reports
     (id, report_type, reporter_name, reporter_email, location_description, details,
      status, created_at, updated_at)
     VALUES ('report-guided', 'tip', 'Guided Reporter', 'guided@example.test',
             'Near the path', 'Guided details', 'received', ?, ?)`
  ).bind("2026-07-15T20:00:00.000Z", "2026-07-15T20:00:00.000Z").run();
  await assert.rejects(
    store.updateReport("report-guided", { status: "verified" }, "staff-owner"),
    /transition/i
  );
  const reviewing = await store.updateReport(
    "report-guided",
    { status: "reviewing" },
    "staff-owner"
  );
  assert.equal(reviewing?.status, "reviewing");
  assert.equal(reviewing?.assignedTo, "staff-owner");
  await assert.rejects(
    store.updateReport("report-guided", { status: "resolved" }, "staff-owner"),
    /transition/i
  );

  const assertRolledBack = async () => {
    assert.deepEqual(
      await db.prepare(
        `SELECT status, updated_at, assigned_to FROM private_reports WHERE id = 'report-atomic'`
      ).first(),
      { status: "reviewing", updated_at: "2026-07-15T20:00:00.000Z", assigned_to: null }
    );
    assert.equal(
      (await db.prepare(
        `SELECT COUNT(*) AS count FROM report_events WHERE report_id = 'report-atomic'`
      ).first<{ count: number }>())?.count,
      0
    );
    assert.equal(
      (await db.prepare(
        `SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'report-atomic'`
      ).first<{ count: number }>())?.count,
      0
    );
  };

  await db.prepare(
    `CREATE TRIGGER fail_atomic_report_event
     BEFORE INSERT ON report_events WHEN NEW.report_id = 'report-atomic'
     BEGIN SELECT RAISE(ABORT, 'forced report event failure'); END`
  ).run();
  await assert.rejects(
    store.updateReport("report-atomic", { status: "contacted" }, "staff-atomic"),
    /forced report event failure/i
  );
  await db.prepare("DROP TRIGGER fail_atomic_report_event").run();
  await assertRolledBack();

  await db.prepare(
    `CREATE TRIGGER fail_atomic_report_audit
     BEFORE INSERT ON audit_events WHEN NEW.action = 'report.updated' AND NEW.target_id = 'report-atomic'
     BEGIN SELECT RAISE(ABORT, 'forced report audit failure'); END`
  ).run();
  await assert.rejects(
    store.updateReport("report-atomic", { status: "contacted" }, "staff-atomic"),
    /forced report audit failure/i
  );
  await db.prepare("DROP TRIGGER fail_atomic_report_audit").run();
  await assertRolledBack();

  const updated = await store.updateReport(
    "report-atomic",
    { status: "contacted", note: "Reached the reporter" },
    "staff-atomic"
  );
  assert.equal(updated?.status, "contacted");
  assert.deepEqual(
    await db.prepare(
      `SELECT event_type, actor_subject, note FROM report_events WHERE report_id = 'report-atomic'`
    ).first(),
    { event_type: "status.contacted", actor_subject: "staff-atomic", note: "Reached the reporter" }
  );
  assert.deepEqual(
    await db.prepare(
      `SELECT action, actor_subject, target_kind, target_id, metadata_json
       FROM audit_events WHERE target_id = 'report-atomic'`
    ).first(),
    {
      action: "report.updated",
      actor_subject: "staff-atomic",
      target_kind: "report",
      target_id: "report-atomic",
      metadata_json: '{"status":"contacted"}'
    }
  );
});

test("real D1 publishes and withdraws a report-sourced Case Note independently from Updates", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  await applyOperatorAlertMigration(db);
  const timestamp = "2026-07-15T18:00:00.000Z";
  await db.batch([
    db.prepare(
      `INSERT INTO waypoints
       (id, route_order, name, description, is_published, updated_at, updated_by)
       VALUES (1, 1, 'Creek Property', 'Public stop.', 1, ?, 'staff-seed')`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO private_reports
       (id, report_type, reporter_name, reporter_email, waypoint_id, location_description,
        latitude, longitude, details, public_attribution, attribution_kind, status, created_at, updated_at)
       VALUES ('report-case-note', 'tip', 'Private Reporter', 'private@example.test', 1,
               'Private location', 53.5, -114.5, 'Private details', 'Community Hunter',
               'community', 'reviewing', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO media_uploads
       (id, owner_kind, owner_id, private_object_key, derivative_object_key,
        content_type, byte_size, status, created_at)
       VALUES ('media-case-note', 'report', 'report-case-note', 'private/report/original.jpg',
               'derivatives/media-case-note.webp', 'image/webp', 2048, 'ready', ?)`
    ).bind(timestamp)
  ]);
  const store = new D1DataStore(db);
  const input = { body: "An operator-reviewed public observation.", mediaIds: ["media-case-note"] };
  const note = await store.publishReportToCaseNotes("report-case-note", input, "staff-reviewer");
  assert.equal(note?.noteKind, "operator_reviewed");
  assert.equal(note?.authorHandle, "Community Hunter");
  assert.equal(note?.latitude, 53.5);
  assert.equal(note?.longitude, -114.5);
  assert.equal(JSON.stringify(note).includes("report-case-note"), false);
  const replay = await store.publishReportToCaseNotes("report-case-note", input, "staff-reviewer");
  assert.equal(replay?.id, note?.id);

  const board = await store.listBoard(null, { limit: 10 });
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0]?.noteKind, "operator_reviewed");
  assert.equal(JSON.stringify(board.items).includes("report-case-note"), false);
  assert.equal((await store.listUpdates({ limit: 10 })).items.length, 0);
  assert.deepEqual(await store.getPublicMedia("media-case-note"), {
    key: "derivatives/media-case-note.webp",
    contentType: "image/webp",
    cacheControl: "no-store"
  });

  const withdrawn = await store.withdrawReportCaseNote("report-case-note", "staff-reviewer");
  assert.equal(withdrawn?.status, "withdrawn");
  assert.equal((await store.listBoard(null, { limit: 10 })).items.length, 0);
  assert.equal((await store.listUpdates({ limit: 10 })).items.length, 0);
  assert.equal(await store.getPublicMedia("media-case-note"), null);
});

test("real D1 publishes only report-linked safe updates and selected derivatives", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
  ];
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `report-publication-store-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of migrationFiles) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO waypoints
         (id, route_order, name, description, is_published, updated_at, updated_by)
         VALUES (1, 1, 'Creek crossing', 'Public waypoint.', 1, ?, 'staff-seed')`
      )
      .bind("2026-07-15T19:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-minor-public', 'private-minor@example.test', 'Private Minor Name',
                 'Minor Handle Must Stay Private', ?, 'minor_guardian_permission', ?, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-adult-public', 'private-adult@example.test', 'Private Adult Name',
                 'Hunter A7F3', ?, 'adult', NULL, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-adult-to-minor', 'adult-minor@example.test', 'Adult To Minor',
                 'Adult Handle Must Stay Private', ?, 'adult', NULL, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-withdrawn-before-report', 'withdrawn-before@example.test',
                 'Withdrawn Before Report', 'Withdrawn Hunter', ?, 'adult', NULL, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-mismatch-public', 'private-mismatch@example.test', 'Original Account Name',
                 'Mismatch Hunter', ?, 'adult', NULL, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at,
          participation_basis, guardian_permission_attested_at, created_at, updated_at)
         VALUES ('hunter-stale-public', 'private-stale@example.test', 'Private Stale Name',
                 'Stale Hunter', ?, 'adult', NULL, ?, ?)`
      )
      .bind(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T19:00:00.000Z"
      ),
    playerInsert(db, "hunter-minor-public"),
    playerInsert(db, "hunter-adult-public"),
    playerInsert(db, "hunter-stale-public"),
    playerInsert(db, "hunter-mismatch-public"),
    playerInsert(db, "hunter-adult-to-minor"),
    playerInsert(db, "hunter-withdrawn-before-report"),
    db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, publisher_name, published_at, status)
         VALUES ('ordinary-update', 'Ordinary update', 'Campaign-authored story.',
                 'staff-seed', 'Campaign Ops', ?, 'published')`
      )
      .bind("2026-07-11T18:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, publisher_name, published_at, status)
         VALUES ('legacy-operator-update', 'Legacy operator update', 'Another stored story.',
                 'staff-seed', '  cAmPaIgN oPeRaToR  ', ?, 'published')`
      )
      .bind("2026-07-11T17:00:00.000Z")
  ]);

  const legalAcceptance = (
    acceptanceId: string,
    subject: string,
    documentType: "privacy_media" | "participation_waiver",
    version: string,
    hash: string,
    action: "accepted" | "withdrawn",
    acceptedAt: string
  ) =>
    db
      .prepare(
        `INSERT INTO legal_acceptance_events
         (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(acceptanceId, subject, documentType, version, hash, action, acceptedAt);
  await db.batch([
    legalAcceptance(
      "privacy-minor-current",
      "hunter-minor-public",
      "privacy_media",
      privacyMediaDocument.version,
      privacyMediaDocument.hash,
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-minor-report-time",
      "hunter-minor-public",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "privacy-adult-current",
      "hunter-adult-public",
      "privacy_media",
      privacyMediaDocument.version,
      privacyMediaDocument.hash,
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-adult-current",
      "hunter-adult-public",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "privacy-stale",
      "hunter-stale-public",
      "privacy_media",
      "2026.2",
      "stale-privacy-hash",
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-stale",
      "hunter-stale-public",
      "participation_waiver",
      "2026.1",
      "stale-waiver-hash",
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "privacy-mismatch-current",
      "hunter-mismatch-public",
      "privacy_media",
      privacyMediaDocument.version,
      privacyMediaDocument.hash,
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-mismatch-current",
      "hunter-mismatch-public",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "privacy-adult-to-minor",
      "hunter-adult-to-minor",
      "privacy_media",
      privacyMediaDocument.version,
      privacyMediaDocument.hash,
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-adult-to-minor-report-time",
      "hunter-adult-to-minor",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "privacy-withdrawn-before-report",
      "hunter-withdrawn-before-report",
      "privacy_media",
      privacyMediaDocument.version,
      privacyMediaDocument.hash,
      "accepted",
      "2026-07-15T19:10:00.000Z"
    ),
    legalAcceptance(
      "waiver-withdrawn-report-time-accepted",
      "hunter-withdrawn-before-report",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T19:11:00.000Z"
    ),
    legalAcceptance(
      "waiver-withdrawn-before-report",
      "hunter-withdrawn-before-report",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "withdrawn",
      "2026-07-15T19:50:00.000Z"
    )
  ]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-minor-report-time', 'minor_guardian_permission',
                 'Private Minor Name', 1, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-adult-current', 'adult', 'Private Adult Name', 0, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-stale', 'adult', 'Private Stale Name', 0, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-mismatch-current', 'adult', 'Original Account Name', 0, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-adult-to-minor-report-time', 'adult', 'Adult To Minor', 0, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-withdrawn-report-time-accepted', 'adult',
                 'Withdrawn Before Report', 0, ?)`
      )
      .bind("2026-07-15T19:11:00.000Z")
  ]);

  const reportInsert = (
    reportId: string,
    hunterSubject: string | null,
    reporterName: string,
    waypointId: number | null,
    latitude: number | null,
    longitude: number | null
  ) =>
    db
      .prepare(
        `INSERT INTO private_reports
         (id, report_type, hunter_subject, reporter_name, reporter_email, reporter_phone,
          waypoint_id, location_description, latitude, longitude, details, status, created_at, updated_at)
         VALUES (?, 'tip', ?, ?, ?, '780-555-0199', ?, 'Private location description', ?, ?,
                 'Private unedited report details', 'reviewing', ?, ?)`
      )
      .bind(
        reportId,
        hunterSubject,
        reporterName,
        `${reportId}@example.test`,
        waypointId,
        latitude,
        longitude,
        "2026-07-15T20:00:00.000Z",
        "2026-07-15T20:00:00.000Z"
      );
  await db.batch([
    reportInsert("report-minor", "hunter-minor-public", "Private Minor Name", 1, 53.123, -114.456),
    reportInsert("report-adult", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-adult-community", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-young-snapshot", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-missing-snapshot", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-blank-snapshot", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-invalid-snapshot", "hunter-adult-public", "Private Adult Name", 1, 53.124, -114.457),
    reportInsert("report-community", null, "Private Community Name", null, null, null),
    reportInsert("report-stale", "hunter-stale-public", "Private Stale Name", 1, 53.125, -114.458),
    reportInsert("report-mismatch", "hunter-mismatch-public", "Original Account Name", 1, 53.127, -114.460),
    reportInsert("report-concurrent", null, "Private Concurrent Name", 1, 53.126, -114.459),
    reportInsert("report-schedule", null, "Private Scheduled Name", 1, 53.1265, -114.4595),
    reportInsert("report-rejected-real", null, "Private Rejected Name", 1, 53.128, -114.461),
    reportInsert("report-resolved-real", null, "Private Resolved Name", 1, 53.129, -114.462),
    reportInsert("report-adult-to-minor", "hunter-adult-to-minor", "Adult To Minor", 1, 53.130, -114.463),
    reportInsert("report-withdrawn-before", "hunter-withdrawn-before-report", "Withdrawn Before Report", 1, 53.131, -114.464),
    reportInsert("report-no-report-time-waiver", "hunter-adult-public", "Private Adult Name", 1, 53.132, -114.465),
    mediaUploadInsert(db, "media-selected", "report", "report-minor", "ready", "derivatives/media-selected.webp"),
    mediaUploadInsert(db, "media-unselected", "report", "report-minor", "ready", "derivatives/media-unselected.webp"),
    mediaUploadInsert(db, "media-cross-report", "report", "report-adult", "ready", "derivatives/media-cross-report.webp"),
    mediaUploadInsert(db, "media-processing-publication", "report", "report-minor", "processing", "derivatives/media-processing.webp"),
    mediaUploadInsert(db, "media-no-public-derivative", "report", "report-minor", "ready", null),
    mediaUploadInsert(db, "media-original-only", "report", "report-minor", "ready", "originals/media-original-only.jpg"),
    mediaUploadInsert(db, "media-concurrent-a", "report", "report-concurrent", "ready", "derivatives/media-concurrent-a.webp"),
    mediaUploadInsert(db, "media-concurrent-b", "report", "report-concurrent", "ready", "derivatives/media-concurrent-b.webp")
  ]);
  await db
    .prepare(
      `UPDATE private_reports SET created_at = ?, updated_at = ?
       WHERE id = 'report-no-report-time-waiver'`
    )
    .bind("2026-07-15T19:00:00.000Z", "2026-07-15T19:00:00.000Z")
    .run();
  await db.batch([
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = 'Trail Friends', attribution_kind = 'display_name'
       WHERE id = 'report-adult'`
    ),
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = 'Community Hunter', attribution_kind = 'community'
       WHERE id = 'report-adult-community'`
    ),
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = 'Young Hunter', attribution_kind = 'young_hunter'
       WHERE id = 'report-minor'`
    ),
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = 'Young Hunter', attribution_kind = 'young_hunter'
       WHERE id = 'report-young-snapshot'`
    ),
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = '', attribution_kind = 'display_name'
       WHERE id = 'report-blank-snapshot'`
    ),
    db.prepare(
      `UPDATE private_reports
       SET public_attribution = 'Invalid stored label', attribution_kind = NULL
       WHERE id = 'report-invalid-snapshot'`
    ),
    db.prepare(
      `UPDATE hunter_profiles
       SET public_handle = 'Current Handle Must Not Leak',
           public_display_name = 'Current Display Must Not Leak', updated_at = ?
       WHERE subject = 'hunter-adult-public'`
    ).bind("2026-07-15T20:00:30.000Z")
  ]);
  await db
    .prepare(
      `UPDATE hunter_profiles
       SET participation_basis = 'adult', guardian_permission_attested_at = NULL,
           public_handle = 'Adult Handle After Transition', updated_at = ?
       WHERE subject = 'hunter-minor-public'`
    )
    .bind("2026-07-15T20:01:00.000Z")
    .run();
  await legalAcceptance(
    "waiver-minor-current-adult",
    "hunter-minor-public",
    "participation_waiver",
    participationWaiverDocument.version,
    participationWaiverDocument.hash,
    "accepted",
    "2026-07-15T20:02:00.000Z"
  ).run();
  await db
    .prepare(
      `INSERT INTO waiver_account_participants
       (acceptance_event_id, participation_basis, full_name,
        guardian_permission_attested, created_at)
       VALUES ('waiver-minor-current-adult', 'adult', 'Private Minor Name', 0, ?)`
    )
    .bind("2026-07-15T20:02:00.000Z")
    .run();
  await db
    .prepare(
      `UPDATE hunter_profiles SET full_name = 'Changed Account Name', updated_at = ?
       WHERE subject = 'hunter-mismatch-public'`
    )
    .bind("2026-07-15T20:03:00.000Z")
    .run();
  await db
    .prepare(
      `UPDATE hunter_profiles
       SET participation_basis = 'minor_guardian_permission',
           guardian_permission_attested_at = ?, updated_at = ?
       WHERE subject = 'hunter-adult-to-minor'`
    )
    .bind("2026-07-15T20:03:00.000Z", "2026-07-15T20:03:00.000Z")
    .run();
  await db.batch([
    legalAcceptance(
      "waiver-adult-to-minor-current",
      "hunter-adult-to-minor",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T20:04:00.000Z"
    ),
    legalAcceptance(
      "waiver-withdrawn-current",
      "hunter-withdrawn-before-report",
      "participation_waiver",
      participationWaiverDocument.version,
      participationWaiverDocument.hash,
      "accepted",
      "2026-07-15T20:04:00.000Z"
    )
  ]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-adult-to-minor-current', 'minor_guardian_permission',
                 'Adult To Minor', 1, ?)`
      )
      .bind("2026-07-15T20:04:00.000Z"),
    db
      .prepare(
        `INSERT INTO waiver_account_participants
         (acceptance_event_id, participation_basis, full_name,
          guardian_permission_attested, created_at)
         VALUES ('waiver-withdrawn-current', 'adult', 'Withdrawn Before Report', 0, ?)`
      )
      .bind("2026-07-15T20:04:00.000Z")
  ]);
  await db.batch([
    db
      .prepare("UPDATE private_reports SET status = 'rejected' WHERE id = 'report-rejected-real'"),
    db
      .prepare("UPDATE private_reports SET status = 'resolved' WHERE id = 'report-resolved-real'")
  ]);

  const store = new D1DataStore(db) as D1DataStore & {
    publishReport(
      reportId: string,
      input: { title: string; body: string; mediaIds: string[] },
      actorSubject: string
    ): Promise<Record<string, unknown> | null>;
    unpublishReport(reportId: string, actorSubject: string): Promise<Record<string, unknown> | null>;
  };
  const minorPreview = await store.getReportDetail("report-minor", "staff-preview-minor");
  assert.equal(minorPreview?.publicAttribution, "Young Hunter");
  assert.equal(minorPreview?.publicationEligible, true);
  assert.equal(minorPreview?.publicationEligibilityReason, "eligible");
  assert.deepEqual(minorPreview?.publication, {
    published: false,
    updateId: null,
    status: null,
    scheduledFor: null,
    title: null,
    body: null,
    mediaIds: [],
    uploads: [],
  });
  assert.doesNotMatch(JSON.stringify(minorPreview), /Minor Handle Must Stay Private|participationBasis/);

  const adultPreview = await store.getReportDetail("report-adult", "staff-preview-adult");
  assert.equal(adultPreview?.publicAttribution, "Trail Friends");
  assert.equal(adultPreview?.publicationEligible, true);

  const adultCommunityPreview = await store.getReportDetail(
    "report-adult-community",
    "staff-preview-adult-community"
  );
  assert.equal(adultCommunityPreview?.publicAttribution, "Community Hunter");
  assert.equal(adultCommunityPreview?.publicationEligible, true);

  const youngSnapshotPreview = await store.getReportDetail(
    "report-young-snapshot",
    "staff-preview-young-snapshot"
  );
  assert.equal(youngSnapshotPreview?.publicAttribution, "Young Hunter");
  assert.equal(youngSnapshotPreview?.publicationEligible, true);

  for (const reportId of [
    "report-missing-snapshot",
    "report-blank-snapshot",
    "report-invalid-snapshot"
  ]) {
    const ineligible = await store.getReportDetail(reportId, `staff-preview-${reportId}`);
    assert.equal(ineligible?.publicAttribution, null, reportId);
    assert.equal(ineligible?.publicationEligible, false, reportId);
    assert.equal(ineligible?.publicationEligibilityReason, "public_attribution_required", reportId);
    assert.doesNotMatch(
      JSON.stringify(ineligible),
      /Current Handle Must Not Leak|Current Display Must Not Leak/,
      reportId
    );
  }

  const transitionedPreview = await store.getReportDetail("report-adult-to-minor", "staff-preview-transitioned");
  assert.equal(transitionedPreview?.publicAttribution, "Young Hunter");
  assert.equal(transitionedPreview?.publicationEligible, true);
  assert.doesNotMatch(JSON.stringify(transitionedPreview), /Adult Handle Must Stay Private/);

  for (const reportId of ["report-stale", "report-mismatch", "report-no-report-time-waiver"]) {
    const ineligible = await store.getReportDetail(reportId, `staff-preview-${reportId}`);
    assert.equal(ineligible?.publicationEligible, false, reportId);
    assert.notEqual(ineligible?.publicationEligibilityReason, "eligible", reportId);
    assert.equal(ineligible?.publicAttribution, null, reportId);
  }

  const anonymousPreview = await store.getReportDetail("report-community", "staff-preview-community");
  assert.equal(anonymousPreview?.publicAttribution, "Community Hunter");
  assert.equal(anonymousPreview?.publicationEligible, true);
  await assert.rejects(
    store.publishReport(
      "report-schedule",
      { title: "Too soon", body: "Not verified", mediaIds: [], action: "publish_now" },
      "staff-publisher"
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "report_update_requires_verification"
  );
  await assert.rejects(
    store.publishReport(
      "report-stale",
      { title: "Stale legal record", body: "Must remain private", mediaIds: [] },
      "staff-publisher"
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "report_publication_legal_required"
  );
  for (const reportId of ["report-rejected-real", "report-resolved-real"]) {
    await assert.rejects(
      store.publishReport(
        reportId,
        { title: "Terminal report", body: "Must remain private", mediaIds: [] },
        "staff-publisher"
      ),
      (error: unknown) =>
        error instanceof ApiError && error.code === "report_publication_state_invalid",
      reportId
    );
  }
  assert.equal(
    (await db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_events
         WHERE target_id IN ('report-rejected-real', 'report-resolved-real')`
      )
      .first<{ count: number }>())?.count,
    0
  );
  await assert.rejects(
    store.publishReport(
      "report-mismatch",
      { title: "Mismatched legal record", body: "Must remain private", mediaIds: [] },
      "staff-publisher"
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "report_publication_legal_required"
  );
  for (const reportId of ["report-withdrawn-before", "report-no-report-time-waiver"]) {
    await assert.rejects(
      store.publishReport(
        reportId,
        { title: "Invalid report-time waiver", body: "Must remain private", mediaIds: [] },
        "staff-publisher"
      ),
      (error: unknown) =>
        error instanceof ApiError && error.code === "report_publication_legal_required",
      reportId
    );
  }
  await db
    .prepare(
      `UPDATE private_reports SET status = 'verified'
       WHERE id IN ('report-adult-to-minor', 'report-minor', 'report-adult',
                     'report-adult-community', 'report-young-snapshot',
                     'report-missing-snapshot', 'report-blank-snapshot',
                     'report-invalid-snapshot', 'report-community', 'report-concurrent',
                     'report-schedule')`
    )
    .run();
  const savedDraft = await store.publishReport(
    "report-schedule",
    { title: "Scheduled finding", body: "Draft body", mediaIds: [], action: "save_draft" },
    "staff-publisher"
  );
  assert.equal(savedDraft?.status, "draft");
  assert.equal(
    (await store.listUpdates({ limit: 20 })).items.some((item) => item.id === savedDraft?.id),
    false
  );
  await store.addReportUpdateUploads("report-schedule", [{
    id: "update-upload-schedule",
    key: "originals/2026-07-17/official_update/update-upload-schedule",
    contentType: "image/webp",
    size: 100794,
    status: "processing",
  }], "staff-publisher");
  assert.equal(await store.getPublicMedia("update-upload-schedule"), null);
  await db.prepare(
    `UPDATE official_update_uploads
     SET status = 'ready', derivative_object_key = 'derivatives/update-upload-schedule.webp'
     WHERE id = 'update-upload-schedule'`
  ).run();
  assert.equal(await store.getPublicMedia("update-upload-schedule"), null);
  const scheduledFor = "2099-07-17T19:00:00.000Z";
  const scheduled = await store.publishReport(
    "report-schedule",
    {
      title: "Scheduled finding",
      body: "Scheduled body",
      mediaIds: ["update-upload-schedule"],
      mediaSelections: [{
        id: "update-upload-schedule",
        altText: "A weathered five-dollar bill beside a yellow golf ball",
        caption: "Submitted by a hunter near Stop 11.",
      }],
      action: "schedule",
      scheduledFor,
    },
    "staff-publisher"
  );
  assert.equal(scheduled?.id, savedDraft?.id);
  assert.equal(scheduled?.status, "scheduled");
  const scheduledReplay = await store.publishReport(
    "report-schedule",
    {
      title: "Scheduled finding",
      body: "Scheduled body",
      mediaIds: ["update-upload-schedule"],
      mediaSelections: [{
        id: "update-upload-schedule",
        altText: "A weathered five-dollar bill beside a yellow golf ball",
        caption: "Submitted by a hunter near Stop 11.",
      }],
      action: "schedule",
      scheduledFor,
    },
    "staff-publisher"
  );
  assert.equal(scheduledReplay?.id, scheduled?.id);
  assert.equal(
    (await db.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE target_id = 'report-schedule' AND action = 'report.update.scheduled'`
    ).first<{ count: number }>())?.count,
    1
  );
  assert.equal(
    (await store.listUpdates({ limit: 20, cursor: "2099-07-17T18:59:59.999Z" })).items
      .some((item) => item.id === scheduled?.id),
    false
  );
  assert.equal(
    (await store.listUpdates({ limit: 20, cursor: scheduledFor })).items
      .some((item) => item.id === scheduled?.id),
    true
  );
  const dueUpdate = (await store.listUpdates({ limit: 20, cursor: scheduledFor })).items
    .find((item) => item.id === scheduled?.id) as Record<string, unknown> | undefined;
  assert.deepEqual(dueUpdate?.media, [{
    id: "update-upload-schedule",
    url: "/api/v1/media/update-upload-schedule",
    contentType: "image/webp",
    alt: "A weathered five-dollar bill beside a yellow golf ball",
    caption: "Submitted by a hunter near Stop 11.",
  }]);
  assert.equal(await store.getPublicMedia("update-upload-schedule"), null);
  await db.prepare(
    "UPDATE official_updates SET scheduled_for = '2026-07-17T00:00:00.000Z' WHERE id = ?"
  ).bind(scheduled?.id).run();
  assert.deepEqual(await store.getPublicMedia("update-upload-schedule"), {
    key: "derivatives/update-upload-schedule.webp",
    contentType: "image/webp",
    cacheControl: "no-store",
  });
  await store.unpublishReport("report-schedule", "staff-publisher");
  const transitionedMinorUpdate = await store.publishReport(
    "report-adult-to-minor",
    { title: "Transitioned hunter", body: "Approved public story", mediaIds: [] },
    "staff-publisher"
  );
  assert.equal(transitionedMinorUpdate?.publisherName, "Young Hunter");
  assert.equal(
    JSON.stringify(transitionedMinorUpdate).includes("Adult Handle Must Stay Private"),
    false
  );
  const minorUpdate = await store.publishReport(
    "report-minor",
    {
      title: "Possible clue near the creek",
      body: "Edited operator-approved story",
      mediaIds: ["media-selected"]
    },
    "staff-publisher"
  );
  assert.ok(minorUpdate);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(minorUpdate).filter(([key]) => !["id", "publishedAt"].includes(key))
    ),
    {
      kind: "approved_report",
      title: "Possible clue near the creek",
      body: "Edited operator-approved story",
      publisherName: "Young Hunter",
      waypointId: 1,
      latitude: 53.123,
      longitude: -114.456,
      scheduledFor: null,
      status: "published",
      media: [
        {
          id: "media-selected",
          url: "/api/v1/media/media-selected",
          contentType: "image/jpeg"
        }
      ]
    }
  );
  assert.equal(typeof minorUpdate.id, "string");
  assert.match(String(minorUpdate.publishedAt), /^\d{4}-\d{2}-\d{2}T/);
  const publishedMinorDetail = await store.getReportDetail("report-minor", "staff-preview-published-minor");
  assert.deepEqual(publishedMinorDetail?.publication, {
    published: true,
    updateId: minorUpdate.id,
    status: "published",
    scheduledFor: null,
    title: "Possible clue near the creek",
    body: "Edited operator-approved story",
    mediaIds: ["media-selected"],
    uploads: [],
  });
  await assert.rejects(
    store.updateReport("report-minor", { status: "resolved" }, "staff-terminal-blocked"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "report_publication_active"
  );
  const publicText = JSON.stringify(minorUpdate);
  for (const forbidden of [
    "Private Minor Name",
    "Minor Handle Must Stay Private",
    "private-minor@example.test",
    "780-555-0199",
    "hunter-minor-public",
    "report-minor",
    "media-unselected",
    "private/",
    "derivatives/"
  ]) {
    assert.equal(publicText.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(await store.getPublicMedia("media-selected"), {
    key: "derivatives/media-selected.webp",
    contentType: "image/jpeg",
    cacheControl: "no-store"
  });
  assert.equal(await store.getPublicMedia("media-unselected"), null);

  for (const mediaId of [
    "media-cross-report",
    "media-processing-publication",
    "media-no-public-derivative",
    "media-original-only",
    "missing-media"
  ]) {
    await assert.rejects(
      store.publishReport(
        "report-minor",
        { title: "Invalid media", body: "Must fail closed", mediaIds: [mediaId] },
        "staff-publisher"
      ),
      (error: unknown) => error instanceof ApiError && error.code === "publication_media_invalid",
      mediaId
    );
  }

  const adultUpdate = await store.publishReport(
    "report-adult",
    { title: "Adult report", body: "Edited adult story", mediaIds: [] },
    "staff-publisher"
  );
  const adultCommunityUpdate = await store.publishReport(
    "report-adult-community",
    { title: "Adult community report", body: "Edited adult community story", mediaIds: [] },
    "staff-publisher"
  );
  const youngSnapshotUpdate = await store.publishReport(
    "report-young-snapshot",
    { title: "Young Hunter report", body: "Edited privacy-safe story", mediaIds: [] },
    "staff-publisher"
  );
  for (const reportId of [
    "report-missing-snapshot",
    "report-blank-snapshot",
    "report-invalid-snapshot"
  ]) {
    await assert.rejects(
      store.publishReport(
        reportId,
        { title: "Unsafe attribution", body: "Must remain private", mediaIds: [] },
        "staff-publisher"
      ),
      (error: unknown) =>
        error instanceof ApiError && error.code === "report_publication_ineligible",
      reportId
    );
  }
  const communityUpdate = await store.publishReport(
    "report-community",
    { title: "Community report", body: "Edited community story", mediaIds: [] },
    "staff-publisher"
  );
  assert.equal(adultUpdate?.publisherName, adultPreview?.publicAttribution);
  assert.equal(adultUpdate?.publisherName, "Trail Friends");
  assert.equal(adultCommunityUpdate?.publisherName, adultCommunityPreview?.publicAttribution);
  assert.equal(adultCommunityUpdate?.publisherName, "Community Hunter");
  assert.equal(youngSnapshotUpdate?.publisherName, youngSnapshotPreview?.publicAttribution);
  assert.equal(youngSnapshotUpdate?.publisherName, "Young Hunter");
  assert.equal(communityUpdate?.publisherName, "Community Hunter");
  const storedAttributionSnapshots = await db.prepare(
    `SELECT id, public_attribution, attribution_kind
     FROM private_reports
     WHERE id IN ('report-adult', 'report-adult-community', 'report-minor', 'report-young-snapshot')
     ORDER BY id`
  ).all<{ id: string; public_attribution: string; attribution_kind: string }>();
  assert.deepEqual(storedAttributionSnapshots.results, [
    {
      id: "report-adult",
      public_attribution: "Trail Friends",
      attribution_kind: "display_name"
    },
    {
      id: "report-adult-community",
      public_attribution: "Community Hunter",
      attribution_kind: "community"
    },
    {
      id: "report-minor",
      public_attribution: "Young Hunter",
      attribution_kind: "young_hunter"
    },
    {
      id: "report-young-snapshot",
      public_attribution: "Young Hunter",
      attribution_kind: "young_hunter"
    }
  ]);
  const storedPublishedAttributions = await db.prepare(
    `SELECT source_report_id, publisher_name, public_attribution
     FROM official_updates
     WHERE source_report_id IN ('report-adult', 'report-adult-community', 'report-minor',
                                'report-young-snapshot')
     ORDER BY source_report_id`
  ).all<{ source_report_id: string; publisher_name: string; public_attribution: string }>();
  assert.deepEqual(storedPublishedAttributions.results, [
    {
      source_report_id: "report-adult",
      publisher_name: "Trail Friends",
      public_attribution: "Trail Friends"
    },
    {
      source_report_id: "report-adult-community",
      publisher_name: "Community Hunter",
      public_attribution: "Community Hunter"
    },
    {
      source_report_id: "report-minor",
      publisher_name: "Young Hunter",
      public_attribution: "Young Hunter"
    },
    {
      source_report_id: "report-young-snapshot",
      publisher_name: "Young Hunter",
      public_attribution: "Young Hunter"
    }
  ]);
  assert.doesNotMatch(
    JSON.stringify([adultUpdate, adultCommunityUpdate, minorUpdate, youngSnapshotUpdate]),
    /Current Handle Must Not Leak|Current Display Must Not Leak/
  );
  assert.equal(
    (await db.prepare(
      `SELECT COUNT(*) AS count FROM official_updates
       WHERE source_report_id IN ('report-missing-snapshot', 'report-blank-snapshot',
                                  'report-invalid-snapshot')`
    ).first<{ count: number }>())?.count,
    0
  );

  await legalAcceptance(
    "privacy-adult-withdrawn",
    "hunter-adult-public",
    "privacy_media",
    privacyMediaDocument.version,
    privacyMediaDocument.hash,
    "withdrawn",
    "2026-07-15T21:00:00.000Z"
  ).run();
  await assert.rejects(
    store.publishReport(
      "report-adult",
      { title: "Consent withdrawn", body: "Must not replace the approved story", mediaIds: [] },
      "staff-publisher"
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "report_publication_legal_required"
  );

  const feed = await store.listUpdates({ limit: 10 });
  assert.equal(feed.items.length, 8);
  assert.equal(feed.items.some((item) => item.kind === "approved_report"), true);
  assert.equal(
    feed.items.find((item) => item.title === "Ordinary update")?.publisherName,
    "A representative from SebaHub"
  );
  assert.equal(
    feed.items.find((item) => item.title === "Legacy operator update")?.publisherName,
    "A representative from SebaHub"
  );
  const storedLegacyPublishers = await db
    .prepare(
      `SELECT id, publisher_name FROM official_updates
       WHERE id IN ('ordinary-update', 'legacy-operator-update') ORDER BY id`
    )
    .all<{ id: string; publisher_name: string }>();
  assert.deepEqual(storedLegacyPublishers.results, [
    { id: "legacy-operator-update", publisher_name: "  cAmPaIgN oPeRaToR  " },
    { id: "ordinary-update", publisher_name: "Campaign Ops" }
  ]);

  const concurrentFirstPublish = await Promise.allSettled([
    store.publishReport(
      "report-concurrent",
      { title: "Concurrent version A", body: "Version A", mediaIds: ["media-concurrent-a"] },
      "staff-concurrent-a"
    ),
    store.publishReport(
      "report-concurrent",
      { title: "Concurrent version B", body: "Version B", mediaIds: ["media-concurrent-b"] },
      "staff-concurrent-b"
    )
  ]);
  assert.deepEqual(concurrentFirstPublish.map((result) => result.status), ["fulfilled", "fulfilled"]);
  for (const result of concurrentFirstPublish) {
    if (result.status !== "fulfilled") continue;
    assert.ok(result.value);
    assert.equal(result.value.kind, "approved_report");
    assert.match(String(result.value.id), /^approved-report:/);
  }
  const concurrentRow = await db
    .prepare(
      `SELECT id, title, status FROM official_updates
       WHERE source_report_id = 'report-concurrent'`
    )
    .first<{ id: string; title: string; status: string }>();
  assert.ok(concurrentRow);
  assert.equal(
    concurrentRow.id,
    `approved-report:${createHash("sha256")
      .update("official-update:report-concurrent")
      .digest("hex")
      .slice(0, 32)}`
  );
  const concurrentSelections = await db
    .prepare(
      `SELECT media_id FROM official_update_media
       WHERE update_id = ? ORDER BY media_id`
    )
    .bind(concurrentRow.id)
    .all<{ media_id: string }>();
  assert.deepEqual(
    concurrentSelections.results.map((row) => row.media_id),
    [concurrentRow.title === "Concurrent version A" ? "media-concurrent-a" : "media-concurrent-b"]
  );

  const concurrentPublishUnpublish = await Promise.allSettled([
    store.publishReport(
      "report-concurrent",
      {
        title: "Concurrent final publication",
        body: "Concurrent final body",
        mediaIds: ["media-concurrent-a", "media-concurrent-b"]
      },
      "staff-concurrent-publisher"
    ),
    store.unpublishReport("report-concurrent", "staff-concurrent-unpublisher")
  ]);
  assert.deepEqual(
    concurrentPublishUnpublish.map((result) => result.status),
    ["fulfilled", "fulfilled"]
  );
  const concurrentPublishResult = concurrentPublishUnpublish[0];
  if (concurrentPublishResult?.status === "fulfilled") {
    assert.ok(concurrentPublishResult.value);
    assert.equal(concurrentPublishResult.value.kind, "approved_report");
    assert.equal(concurrentPublishResult.value.title, "Concurrent final publication");
    assert.deepEqual(
      (concurrentPublishResult.value.media as Array<{ id: string }>).map((item) => item.id).sort(),
      ["media-concurrent-a", "media-concurrent-b"]
    );
  }
  const concurrentFinal = await db
    .prepare("SELECT status FROM official_updates WHERE id = ?")
    .bind(concurrentRow.id)
    .first<{ status: string }>();
  const concurrentFinalSelections = await db
    .prepare("SELECT COUNT(*) AS count FROM official_update_media WHERE update_id = ?")
    .bind(concurrentRow.id)
    .first<{ count: number }>();
  if (concurrentFinal?.status === "published") {
    assert.equal(concurrentFinalSelections?.count, 2);
    assert.ok(await store.getPublicMedia("media-concurrent-a"));
    assert.ok(await store.getPublicMedia("media-concurrent-b"));
  } else {
    assert.equal(concurrentFinal?.status, "withdrawn");
    assert.equal(concurrentFinalSelections?.count, 0);
    assert.equal(await store.getPublicMedia("media-concurrent-a"), null);
    assert.equal(await store.getPublicMedia("media-concurrent-b"), null);
  }
  await store.unpublishReport("report-concurrent", "staff-concurrent-cleanup");

  const republished = await store.publishReport(
    "report-minor",
    {
      title: "Possible clue near the creek",
      body: "Edited story after a second review",
      mediaIds: ["media-selected"]
    },
    "staff-publisher"
  );
  assert.equal(republished?.id, minorUpdate.id);
  const publicationCount = await db
    .prepare("SELECT COUNT(*) AS count FROM official_updates WHERE source_report_id = 'report-minor'")
    .first<{ count: number }>();
  const selectionCount = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM official_update_media
       WHERE update_id = (SELECT id FROM official_updates WHERE source_report_id = 'report-minor')`
    )
    .first<{ count: number }>();
  assert.equal(publicationCount?.count, 1);
  assert.equal(selectionCount?.count, 1);

  const reportState = await db
    .prepare("SELECT status FROM private_reports WHERE id = 'report-minor'")
    .first<{ status: string }>();
  assert.equal(reportState?.status, "verified");
  const events = await db
    .prepare(
      `SELECT event_type FROM report_events
       WHERE report_id = 'report-minor' ORDER BY occurred_at, id`
    )
    .all<{ event_type: string }>();
  assert.equal(events.results.some((event) => event.event_type === "published"), true);
  const audits = await db
    .prepare(
      `SELECT action, metadata_json FROM audit_events
       WHERE target_id = 'report-minor' ORDER BY occurred_at, id`
    )
    .all<{ action: string; metadata_json: string }>();
  assert.equal(audits.results.some((event) => event.action === "report.published"), true);
  assert.doesNotMatch(JSON.stringify(audits.results), /Private Minor Name|minor-private|780-555/);
  const publicationAudits = audits.results
    .filter((event) => event.action === "report.published")
    .map((event) => JSON.parse(event.metadata_json) as Record<string, unknown>);
  assert.equal(publicationAudits.length, 2);
  assert.deepEqual(
    publicationAudits.map((metadata) =>
      (metadata.publication as Record<string, unknown>).body
    ),
    ["Edited operator-approved story", "Edited story after a second review"]
  );
  for (const metadata of publicationAudits) {
    const publication = metadata.publication;
    assert.equal(metadata.hashAlgorithm, "sha256");
    assert.equal(
      metadata.publicationHash,
      createHash("sha256").update(canonicalJson(publication)).digest("hex")
    );
    assert.deepEqual(Object.keys(publication as Record<string, unknown>).sort(), [
      "action",
      "body",
      "kind",
      "latitude",
      "longitude",
      "mediaIds",
      "publisherName",
      "scheduledFor",
      "status",
      "title",
      "waypointId"
    ]);
  }
  assert.doesNotMatch(
    JSON.stringify(publicationAudits),
    /Private Minor Name|minor-private|780-555|hunter-minor-public|private\/|derivatives\//
  );

  assert.ok(await store.unpublishReport("report-minor", "staff-publisher"));
  assert.ok(await store.unpublishReport("report-minor", "staff-publisher"));
  assert.equal(await store.getPublicMedia("media-selected"), null);
  const afterUnpublish = await store.listUpdates({ limit: 10 });
  assert.equal(afterUnpublish.items.some((item) => item.id === minorUpdate.id), false);
  assert.equal(
    (await db.prepare("SELECT status FROM official_updates WHERE id = ?").bind(minorUpdate.id).first<{ status: string }>())?.status,
    "withdrawn"
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM official_update_media WHERE update_id = ?").bind(minorUpdate.id).first<{ count: number }>())?.count,
    0
  );
  const unpublishedEvidence = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM report_events
          WHERE report_id = 'report-minor' AND event_type = 'unpublished') AS report_events,
         (SELECT COUNT(*) FROM audit_events
          WHERE target_id = 'report-minor' AND action = 'report.unpublished') AS audit_events`
    )
    .first<{ report_events: number; audit_events: number }>();
  assert.deepEqual(unpublishedEvidence, { report_events: 1, audit_events: 1 });

  const publishedAgain = await store.publishReport(
    "report-minor",
    {
      title: "Possible clue near the creek",
      body: "Re-approved public story",
      mediaIds: ["media-selected"]
    },
    "staff-publisher"
  );
  assert.equal(publishedAgain?.id, minorUpdate.id);
  assert.deepEqual(await store.getPublicMedia("media-selected"), {
    key: "derivatives/media-selected.webp",
    contentType: "image/jpeg",
    cacheControl: "no-store"
  });
  assert.ok(await store.unpublishReport("report-minor", "staff-publisher"));
  assert.equal(await store.publishReport("missing-report", { title: "No", body: "No", mediaIds: [] }, "staff"), null);
  assert.equal(await store.unpublishReport("missing-report", "staff"), null);
  const finalWithdrawnDetail = await store.getReportDetail("report-minor", "staff-preview-withdrawn-minor");
  assert.deepEqual(finalWithdrawnDetail?.publication, {
    published: false,
    updateId: minorUpdate.id,
    status: "withdrawn",
    scheduledFor: null,
    title: "Possible clue near the creek",
    body: "Re-approved public story",
    mediaIds: [],
    uploads: [],
  });
  const resolvedAfterUnpublish = await store.updateReport(
    "report-minor",
    { status: "resolved" },
    "staff-terminal-after-unpublish"
  );
  assert.equal(resolvedAfterUnpublish?.status, "resolved");
});

test("FakeStore publishes the exact snapshotted report attribution after profile changes", async () => {
  const store = new FakeStore();
  store.profiles.set("hunter-display-snapshot", {
    subject: "hunter-display-snapshot",
    participationBasis: "adult",
    publicHandle: "Current Handle Must Not Leak",
    publicDisplayName: "Current Display Must Not Leak"
  });
  store.profiles.set("hunter-community-snapshot", {
    subject: "hunter-community-snapshot",
    participationBasis: "adult",
    publicHandle: "Current Community Handle Must Not Leak"
  });
  store.profiles.set("hunter-minor-snapshot", {
    subject: "hunter-minor-snapshot",
    participationBasis: "adult",
    publicHandle: "Former Minor Current Handle Must Not Leak"
  });
  store.reports.push(
    {
      id: "fake-report-display-snapshot",
      hunterSubject: "hunter-display-snapshot",
      status: "verified",
      publicAttribution: "Trail Friends",
      attributionKind: "display_name",
      media: []
    },
    {
      id: "fake-report-community-snapshot",
      hunterSubject: "hunter-community-snapshot",
      status: "verified",
      publicAttribution: "Community Hunter",
      attributionKind: "community",
      media: []
    },
    {
      id: "fake-report-minor-snapshot",
      hunterSubject: "hunter-minor-snapshot",
      status: "verified",
      publicAttribution: "Young Hunter",
      attributionKind: "young_hunter",
      media: []
    },
    {
      id: "fake-report-missing-snapshot",
      hunterSubject: "hunter-display-snapshot",
      status: "verified",
      media: []
    },
    {
      id: "fake-report-blank-snapshot",
      hunterSubject: "hunter-display-snapshot",
      status: "verified",
      publicAttribution: "",
      attributionKind: "display_name",
      media: []
    },
    {
      id: "fake-report-invalid-snapshot",
      hunterSubject: "hunter-display-snapshot",
      status: "verified",
      publicAttribution: "Invalid stored label",
      media: []
    },
    {
      id: "fake-report-anonymous",
      hunterSubject: null,
      status: "verified",
      media: []
    }
  );
  const storedSnapshots = structuredClone(store.reports);

  for (const [reportId, expectedAttribution] of [
    ["fake-report-display-snapshot", "Trail Friends"],
    ["fake-report-community-snapshot", "Community Hunter"],
    ["fake-report-minor-snapshot", "Young Hunter"]
  ] as const) {
    const preview = await store.getReportDetail(reportId, "staff-preview");
    assert.equal(preview?.publicAttribution, expectedAttribution);

    const update = await store.publishReport(
      reportId,
      { title: `Update for ${reportId}`, body: "Reviewed public story", mediaIds: [] },
      "staff-publisher"
    );
    assert.equal(update?.publisherName, preview?.publicAttribution);
    assert.equal(update?.publisherName, expectedAttribution);
  }

  for (const reportId of [
    "fake-report-missing-snapshot",
    "fake-report-blank-snapshot",
    "fake-report-invalid-snapshot"
  ]) {
    const preview = await store.getReportDetail(reportId, "staff-preview");
    assert.equal(preview?.publicAttribution, null, reportId);
    assert.equal(preview?.publicationEligible, false, reportId);
    assert.equal(preview?.publicationEligibilityReason, "public_attribution_required", reportId);
    await assert.rejects(
      store.publishReport(
        reportId,
        { title: "Unsafe attribution", body: "Must remain private", mediaIds: [] },
        "staff-publisher"
      ),
      (error: unknown) =>
        error instanceof ApiError && error.code === "report_publication_ineligible",
      reportId
    );
  }

  const anonymousPreview = await store.getReportDetail("fake-report-anonymous", "staff-preview");
  assert.equal(anonymousPreview?.publicAttribution, "Community Hunter");
  assert.equal(anonymousPreview?.publicationEligible, true);
  const anonymousUpdate = await store.publishReport(
    "fake-report-anonymous",
    { title: "Anonymous report", body: "Reviewed public story", mediaIds: [] },
    "staff-publisher"
  );
  assert.equal(anonymousUpdate?.publisherName, "Community Hunter");

  assert.deepEqual(store.reports, storedSnapshots);
  assert.doesNotMatch(
    JSON.stringify(store.updates),
    /Current Handle Must Not Leak|Current Display Must Not Leak|Current Community Handle Must Not Leak|Former Minor Current Handle Must Not Leak/
  );
});

test("the Lucky 13 D1 upgrade preserves stable references and projects public route order", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql"
  ];
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `lucky-13-waypoints-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of migrationFiles) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }

  const timestamp = "2026-07-15T20:00:00.000Z";
  await db.batch([
    db
      .prepare(
        `INSERT INTO case_status
         (id, state, hours_open, hours_close, timezone, version, updated_at, updated_by)
         VALUES (1, 'open', '09:00', '20:00', 'America/Edmonton', 1, ?, 'staff-route')`
      )
      .bind(timestamp),
    db
      .prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, adult_attested_at, created_at, updated_at)
         VALUES ('hunter-route', 'hunter-route@example.test', 'Route Hunter', 'Hunter Route', ?, ?, ?)`
      )
      .bind(timestamp, timestamp, timestamp),
    ...Array.from({ length: 12 }, (_, index) => {
      const waypoint = index + 1;
      return db
        .prepare(
          `INSERT INTO waypoints
           (id, name, description, member_exact_url, member_content,
            is_published, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, 1, ?, 'staff-route')`
        )
        .bind(
          waypoint,
          waypoint === 4 ? "Seniors / Derby legacy stop" : `Waypoint ${waypoint}`,
          `Public description ${waypoint}`,
          `https://maps.example.test/legacy-${waypoint}`,
          `Member content ${waypoint}`,
          timestamp
        );
    })
  ]);

  for (const waypointId of [4, 5, 12]) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO waypoint_progress (hunter_subject, waypoint_id, state, updated_at)
           VALUES ('hunter-route', ?, 'visited', ?)`
        )
        .bind(waypointId, timestamp),
      db
        .prepare(
          `INSERT INTO field_notes
           (id, author_subject, waypoint_id, body, status, created_at, updated_at, published_at)
           VALUES (?, 'hunter-route', ?, ?, 'approved', ?, ?, ?)`
        )
        .bind(
          `note-route-${waypointId}`,
          waypointId,
          `Public note ${waypointId}`,
          timestamp,
          timestamp,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO private_reports
           (id, report_type, hunter_subject, reporter_name, reporter_email, waypoint_id,
            location_description, details, status, created_at, updated_at)
           VALUES (?, 'tip', 'hunter-route', 'Route Hunter', 'hunter-route@example.test', ?,
                   ?, ?, 'reviewing', ?, ?)`
        )
        .bind(
          `report-route-${waypointId}`,
          waypointId,
          `Private location ${waypointId}`,
          `Private details ${waypointId}`,
          timestamp,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO official_updates
           (id, title, body, publisher_subject, publisher_name, published_at, status,
            source_report_id, public_attribution, waypoint_id)
           VALUES (?, ?, ?, 'staff-route', 'Campaign Ops', ?, 'published', ?, 'Hunter Route', ?)`
        )
        .bind(
          `update-route-${waypointId}`,
          `Approved route update ${waypointId}`,
          `Approved public story ${waypointId}`,
          timestamp,
          `report-route-${waypointId}`,
          waypointId
        )
    ]);
  }

  const lucky13Migration = await readFile(
    path.join(root, "migrations", "0012_lucky_13_waypoints.sql"),
    "utf8"
  );
  await applySql(db, lucky13Migration);
  await applySql(
    db,
    await readFile(
      path.join(root, "migrations", "0015_submission_ops_publication_refinement.sql"),
      "utf8"
    )
  );

  const expectedOrder = [
    [1, 1], [2, 2], [3, 3], [4, 4], [13, 5],
    [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
    [10, 11], [11, 12], [12, 13]
  ];
  const waypointRows = await db
    .prepare("SELECT id, route_order FROM waypoints ORDER BY route_order")
    .all<{ id: number; route_order: number }>();
  assert.deepEqual(
    waypointRows.results.map((row) => [row.id, row.route_order]),
    expectedOrder
  );
  assert.equal(new Set(waypointRows.results.map((row) => row.route_order)).size, 13);
  const splitStops = await db
    .prepare("SELECT id, name, member_exact_url FROM waypoints WHERE id IN (4, 13) ORDER BY id")
    .all<{ id: number; name: string; member_exact_url: string }>();
  assert.deepEqual(splitStops.results, [
    {
      id: 4,
      name: "Seba Beach Seniors Centre",
      member_exact_url:
        "https://www.google.com/maps/search/?api=1&query=53.5593028,-114.7359167"
    },
    {
      id: 13,
      name: "Derby's Lakeview General Store",
      member_exact_url:
        "https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167"
    }
  ]);

  for (const table of ["waypoint_progress", "field_notes", "private_reports", "official_updates"]) {
    const rows = await db
      .prepare(`SELECT waypoint_id FROM ${table} ORDER BY waypoint_id`)
      .all<{ waypoint_id: number }>();
    assert.deepEqual(rows.results.map((row) => row.waypoint_id), [4, 5, 12], table);
  }
  const foreignKeyCheck = await db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(foreignKeyCheck.results.length, 0);

  const store = new D1DataStore(db);
  const publicWaypoints = await store.listWaypoints();
  assert.deepEqual(
    publicWaypoints.map((waypoint) => [waypoint.id, waypoint.routeOrder]),
    expectedOrder
  );
  assert.equal(JSON.stringify(publicWaypoints).includes("google.com/maps"), false);
  const derby = await store.getMemberWaypoint(13);
  assert.equal(derby?.routeOrder, 5);
  assert.equal(
    derby?.exactUrl,
    "https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167"
  );

  await db.prepare("UPDATE waypoints SET is_published = 0 WHERE id = 5").run();

  const board = await store.listBoard(null);
  const reports = await store.listReports();
  const reportDetail = await store.getReportDetail("report-route-5", "staff-route");
  const updates = await store.listUpdates();
  const dashboard = await store.getHunterDashboard("hunter-route");
  await db
    .prepare("UPDATE field_notes SET status = 'pending' WHERE id = 'note-route-5'")
    .run();
  const pendingNotes = await store.listPendingNotes();
  const moderatedNote = await store.moderateNote(
    "note-route-5",
    "approved",
    null,
    "staff-route"
  );
  const recordProjections = [
    ...board.items,
    ...reports.items,
    reportDetail,
    ...updates.items,
    ...(dashboard.progress as Record<string, unknown>[]),
    ...(dashboard.notes as Record<string, unknown>[]),
    ...pendingNotes.items,
    moderatedNote
  ];
  const ordinaryHunterRecords = [
    board.items.find((record) => record.waypointId === 5),
    updates.items.find((record) => record.id === "update-route-5"),
    (dashboard.progress as Record<string, unknown>[]).find(
      (record) => record.waypointId === 5
    ),
    (dashboard.notes as Record<string, unknown>[]).find(
      (record) => record.id === "note-route-5"
    )
  ];
  for (const record of ordinaryHunterRecords) {
    assert.ok(record, "history remains visible when its waypoint is unpublished");
    assert.equal(record.waypointRouteOrder, null);
    assert.equal(record.waypointName, null);
    assert.equal("exactUrl" in record, false);
  }

  const privateStaffRecords = [
    reports.items.find((record) => record.waypointId === 5),
    reportDetail,
    pendingNotes.items.find((record) => record.waypointId === 5),
    moderatedNote
  ];
  for (const record of privateStaffRecords) {
    assert.ok(record);
    assert.equal(record.waypointRouteOrder, 6);
    assert.equal(record.waypointName, "Waypoint 5");
    assert.equal("exactUrl" in record, false);
  }
  assert.equal(JSON.stringify(recordProjections).includes("google.com/maps"), false);
});

test("real D1 self-enrolls only exact approved staff domains and preserves blocked principals", async (t) => {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "staff-domain-test" }
  });
  t.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB") as unknown as D1Database;
  await applySql(db, await readFile(path.join(root, "migrations", "0001_hunter_platform.sql"), "utf8"));
  const store = new D1DataStore(db);

  assert.equal(await store.isActiveStaff("staff-operator", "Operator@SebaHub.com"), true);
  assert.equal(await store.isActiveStaff("staff-partner", "operator@businessasaforceforgood.ca"), true);
  assert.equal(await store.isActiveStaff("staff-lookalike", "attacker@sebahub.com.evil.test"), false);

  await db.prepare(
    `INSERT INTO staff_principals
     (id, provider_subject, normalized_email, display_name, status, invited_at)
     VALUES ('blocked-tech', NULL, 'tech@sebahub.com', 'Tech', 'suspended', ?)`
  ).bind("2026-07-15T18:00:00.000Z").run();
  assert.equal(await store.isActiveStaff("staff-tech", "tech@sebahub.com"), false);

  const rows = await db.prepare(
    "SELECT normalized_email, provider_subject, status FROM staff_principals ORDER BY normalized_email"
  ).all<Record<string, unknown>>();
  assert.deepEqual(rows.results.map((row) => row.normalized_email), [
    "operator@businessasaforceforgood.ca",
    "operator@sebahub.com",
    "tech@sebahub.com"
  ]);
  assert.equal(rows.results.find((row) => row.normalized_email === "tech@sebahub.com")?.status, "suspended");

  const audit = await db.prepare(
    "SELECT action, actor_subject FROM audit_events WHERE action = 'staff.domain_activated' ORDER BY occurred_at"
  ).all<Record<string, unknown>>();
  assert.deepEqual(audit.results.map((row) => row.actor_subject).sort(), ["staff-operator", "staff-partner"]);
});

test("the Graph state upgrade preserves historical immutable delivery evidence", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql"
  ];
  const migrations = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(root, "migrations", file), "utf8"))
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `graph-upgrade-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;

  for (const sql of migrations.slice(0, -1)) await applySql(db, sql);
  await db.batch([
    playerInsert(db, "hunter-waiver-1"),
    acceptanceInsert(db, "acceptance-graph-upgrade", "participation_waiver"),
    notificationJobInsert(db, "receipt-graph-upgrade", "waiver_receipt", "acceptance-graph-upgrade"),
    deliveryEventInsert(
      db,
      "delivery-graph-upgrade",
      "receipt-graph-upgrade",
      "sent",
      "2026-07-14T20:00:00.000Z"
    )
  ]);

  const graphMigration = migrations.at(-1);
  assert.ok(graphMigration);
  await applySql(db, graphMigration);

  const historical = await db
    .prepare(
      `SELECT id, event_type, provider_reference, provider_reference_kind
       FROM notification_delivery_events WHERE id = 'delivery-graph-upgrade'`
    )
    .first<{
      id: string;
      event_type: string;
      provider_reference: string | null;
      provider_reference_kind: string | null;
    }>();
  assert.deepEqual(historical, {
    id: "delivery-graph-upgrade",
    event_type: "sent",
    provider_reference: null,
    provider_reference_kind: null
  });
  await assert.rejects(
    db
      .prepare(
        `UPDATE notification_delivery_events
         SET provider_reference = 'changed' WHERE id = 'delivery-graph-upgrade'`
      )
      .run(),
    /notification delivery events are immutable/i
  );
  await assert.rejects(
    db.prepare("DELETE FROM notification_delivery_events WHERE id = 'delivery-graph-upgrade'").run(),
    /notification delivery events are immutable/i
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

test("operator alert migration is repeatable and never backfills historical report jobs", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  await notificationJobInsert(
    db,
    "historical-report-job",
    "report_received",
    "historical-report",
    "2026-07-14T18:00:00.000Z"
  ).run();

  await applyOperatorAlertMigration(db);
  await applyOperatorAlertMigration(db);

  const historicalRecipients = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM operator_alert_recipients
       WHERE notification_job_id = 'historical-report-job'`
    )
    .first<{ count: number }>();
  assert.equal(historicalRecipients?.count, 0);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT kind, status FROM notification_jobs
         WHERE id = 'historical-report-job'`
      )
      .first(),
    { kind: "report_received", status: "pending" }
  );
});

test("real D1 atomically creates one alert outbox and only active activated recipient snapshots", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  await applyOperatorAlertMigration(db);
  await seedOperatorAlertFixtures(db);
  const store = new D1DataStore(db);

  const report = await store.createReport(
    {
      type: "tip",
      hunterSubject: "hunter-alert",
      name: "Private Reporter",
      email: "private-reporter@example.test",
      phone: "780-555-0100",
      waypointId: 1,
      locationDescription: "Private report location",
      latitude: 53.5,
      longitude: -114.5,
      details: "Private report details",
      publicAttribution: "Trail Friends",
      attributionKind: "display_name",
      media: [
        {
          id: "report-alert-media",
          key: "private/report-alert/original.jpg",
          contentType: "image/jpeg",
          size: 2048,
          status: "ready"
        }
      ]
    },
    "operator-alert-report-key"
  );
  assert.equal(report.replayed, false);
  assert.equal(typeof report.operatorAlertJobId, "string");
  assert.equal(report.value.publicAttribution, "Trail Friends");
  assert.equal(report.value.attributionKind, "display_name");

  const reportJob = await db
    .prepare(
      `SELECT id, kind, target_record_id, status
       FROM notification_jobs WHERE id = ?`
    )
    .bind(report.operatorAlertJobId)
    .first();
  assert.deepEqual(reportJob, {
    id: report.operatorAlertJobId,
    kind: "operator_private_report",
    target_record_id: report.value.id,
    status: "pending"
  });
  const reportRecipients = await db
    .prepare(
      `SELECT staff_principal_id, recipient_email, status, attempts
       FROM operator_alert_recipients
       WHERE notification_job_id = ? ORDER BY staff_principal_id`
    )
    .bind(report.operatorAlertJobId)
    .all();
  assert.deepEqual(reportRecipients.results, [
    {
      staff_principal_id: "staff-active-domain",
      recipient_email: "ops@sebahub.com",
      status: "pending",
      attempts: 0
    },
    {
      staff_principal_id: "staff-active-external",
      recipient_email: "operator@unrelated.example",
      status: "pending",
      attempts: 0
    }
  ]);

  const replay = await store.createReport(
    {
      type: "tip",
      name: "Different replay body",
      email: "different@example.test",
      locationDescription: "Different",
      details: "Different"
    },
    "operator-alert-report-key"
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.id, report.value.id);
  assert.equal(replay.operatorAlertJobId, null);
  assert.equal(
    (await db
      .prepare(
        `SELECT COUNT(*) AS count FROM notification_jobs
         WHERE kind = 'operator_private_report' AND target_record_id = ?`
      )
      .bind(report.value.id)
      .first<{ count: number }>())?.count,
    1
  );

  const note = await store.createFieldNote({
    authorSubject: "hunter-alert",
    waypointId: 1,
    body: "A private note awaiting moderation.",
    media: []
  }, "operator-alert-note-key");
  assert.equal(typeof note.operatorAlertJobId, "string");
  assert.deepEqual(
    await db
      .prepare(
        `SELECT kind, target_record_id FROM notification_jobs WHERE id = ?`
      )
      .bind(note.operatorAlertJobId)
      .first(),
    {
      kind: "operator_field_note_moderation",
      target_record_id: note.value.id
    }
  );
  assert.equal(
    (await db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_alert_recipients
         WHERE notification_job_id = ?`
      )
      .bind(note.operatorAlertJobId)
      .first<{ count: number }>())?.count,
    2
  );

  await db
    .prepare(
      `CREATE TRIGGER force_operator_recipient_failure
       BEFORE INSERT ON operator_alert_recipients
       BEGIN SELECT RAISE(ABORT, 'forced operator recipient failure'); END`
    )
    .run();
  await assert.rejects(
    store.createReport(
      {
        type: "find",
        name: "Rollback Reporter",
        email: "rollback@example.test",
        locationDescription: "Rollback location",
        details: "Rollback details",
        media: [
          {
            id: "rollback-alert-media",
            key: "private/rollback-alert/original.jpg",
            contentType: "image/jpeg",
            size: 4096,
            status: "ready"
          }
        ]
      },
      "rollback-alert-key"
    ),
    /forced operator recipient failure/i
  );
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) AS count FROM private_reports WHERE reporter_email = 'rollback@example.test'")
      .first<{ count: number }>())?.count,
    0
  );
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) AS count FROM media_uploads WHERE id = 'rollback-alert-media'")
      .first<{ count: number }>())?.count,
    0
  );
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE idempotency_key = 'rollback-alert-key'")
      .first<{ count: number }>())?.count,
    0
  );
});

test("real D1 leases operator recipients exclusively and reconciles partial and uncertain delivery", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  await applyOperatorAlertMigration(db);
  await seedOperatorAlertFixtures(db);
  const store = new D1DataStore(db);
  const report = await store.createReport(
    {
      type: "safety",
      name: "Private Reporter",
      email: "private@example.test",
      locationDescription: "Private location",
      details: "Private safety details"
    },
    "operator-alert-lifecycle"
  );
  assert.ok(report.operatorAlertJobId);

  const firstClaims = await store.claimOperatorAlertRecipients(report.operatorAlertJobId);
  const secondClaims = await store.claimOperatorAlertRecipients(report.operatorAlertJobId);
  const claims = [...firstClaims, ...secondClaims];
  assert.equal(firstClaims.length, 1, "only one operator is leased before its send attempt");
  assert.equal(secondClaims.length, 1, "the next operator remains independently claimable");
  assert.deepEqual(
    claims.map((claim) => claim.email).sort(),
    ["operator@unrelated.example", "ops@sebahub.com"]
  );
  assert.ok(claims.every((claim) => claim.attempts === 1 && claim.leaseToken && claim.correlationId));
  assert.deepEqual(await store.claimOperatorAlertRecipients(report.operatorAlertJobId), []);

  await assert.rejects(
    store.completeOperatorAlertRecipient(
      { ...claims[0]!, leaseToken: "stale-lease" },
      {
        status: "sent",
        provider: "microsoft_graph",
        providerReference: "request-stale",
        providerReferenceKind: "client_request_id",
        acceptedAt: "2026-07-16T20:00:00.000Z"
      }
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "operator_alert_lease_lost"
  );

  await store.completeOperatorAlertRecipient(claims[0]!, {
    status: "sent",
    provider: "microsoft_graph",
    providerReference: "request-sent-1",
    providerReferenceKind: "client_request_id",
    acceptedAt: "2026-07-16T20:00:00.000Z"
  });
  await store.reconcileOperatorAlertJob(report.operatorAlertJobId);
  assert.equal(
    (await db.prepare("SELECT status FROM notification_jobs WHERE id = ?")
      .bind(report.operatorAlertJobId).first<{ status: string }>())?.status,
    "pending"
  );

  await store.completeOperatorAlertRecipient(claims[1]!, {
    status: "retry",
    errorCode: "provider_unavailable",
    nextAttemptAt: "2020-01-01T00:00:00.000Z"
  });
  await store.reconcileOperatorAlertJob(report.operatorAlertJobId);
  const retryClaims = await store.claimOperatorAlertRecipients(report.operatorAlertJobId);
  assert.equal(retryClaims.length, 1);
  assert.equal(retryClaims[0]?.id, claims[1]?.id);
  assert.equal(retryClaims[0]?.attempts, 2);
  await store.completeOperatorAlertRecipient(retryClaims[0]!, {
    status: "uncertain",
    errorCode: "provider_delivery_uncertain"
  });
  await store.reconcileOperatorAlertJob(report.operatorAlertJobId);
  assert.equal(
    (await db.prepare("SELECT status FROM notification_jobs WHERE id = ?")
      .bind(report.operatorAlertJobId).first<{ status: string }>())?.status,
    "failed"
  );
  assert.deepEqual(
    (await db
      .prepare(
        `SELECT status, last_error_code FROM operator_alert_recipients
         WHERE id = ?`
      )
      .bind(retryClaims[0]!.id)
      .first()),
    { status: "uncertain", last_error_code: "provider_delivery_uncertain" }
  );

  const second = await store.createReport(
    {
      type: "tip",
      name: "Second Reporter",
      email: "second@example.test",
      locationDescription: "Second private location",
      details: "Second private details"
    },
    "operator-alert-eligibility-recheck"
  );
  assert.ok(second.operatorAlertJobId);
  await db
    .prepare("UPDATE staff_principals SET status = 'suspended' WHERE id = 'staff-active-external'")
    .run();
  const eligibleClaims = await store.claimOperatorAlertRecipients(second.operatorAlertJobId);
  assert.deepEqual(eligibleClaims.map((claim) => claim.email), ["ops@sebahub.com"]);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status, last_error_code FROM operator_alert_recipients
         WHERE notification_job_id = ? AND staff_principal_id = 'staff-active-external'`
      )
      .bind(second.operatorAlertJobId)
      .first(),
    { status: "cancelled", last_error_code: "recipient_ineligible" }
  );
});

const assertPublicBoardEnvelopeShape = (value: unknown): void => {
  const assertRecordKeys = (
    candidate: unknown,
    required: readonly string[],
    optional: readonly string[],
    path: string
  ): Record<string, unknown> => {
    assert.ok(candidate && typeof candidate === "object" && !Array.isArray(candidate), `${path} must be an object`);
    const record = candidate as Record<string, unknown>;
    const unexpected = Object.keys(record).filter((key) => !required.includes(key) && !optional.includes(key));
    assert.deepEqual(unexpected, [], `${path} contains unexpected public board keys`);
    assert.deepEqual(
      required.filter((key) => !(key in record)),
      [],
      `${path} is missing required public board keys`
    );
    return record;
  };

  const envelope = assertRecordKeys(value, ["data", "page"], [], "envelope");
  const page = assertRecordKeys(envelope.page, ["nextCursor"], [], "page");
  assert.ok(page.nextCursor === null || typeof page.nextCursor === "string", "page.nextCursor must be a nullable cursor");
  assert.ok(Array.isArray(envelope.data), "envelope.data must be an array");
  for (const [index, item] of envelope.data.entries()) {
    const note = assertRecordKeys(
      item,
      [
        "id", "waypointId", "waypointRouteOrder", "waypointName", "body", "authorHandle", "noteKind",
        "latitude", "longitude", "createdAt", "publishedAt", "media", "replies"
      ],
      [],
      `data[${index}]`
    );
    assert.ok(Array.isArray(note.replies), `data[${index}].replies must be an array`);
    for (const [replyIndex, reply] of note.replies.entries()) {
      assertRecordKeys(reply, ["id", "body", "authorHandle", "createdAt"], [], `data[${index}].replies[${replyIndex}]`);
    }
    assert.ok(Array.isArray(note.media), `data[${index}].media must be an array`);
    for (const [mediaIndex, media] of note.media.entries()) {
      assertRecordKeys(media, ["id", "url"], ["alt"], `data[${index}].media[${mediaIndex}]`);
    }
  }
};

test("real D1 resolves public Case Note and reply identities without exposing minor profile fields", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
  ];
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `public-identity-board-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of migrationFiles) await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));

  const timestamp = "2026-07-15T18:00:00.000Z";
  await db.batch([
    db.prepare(
      `INSERT INTO waypoints
       (id, route_order, name, description, is_published, updated_at, updated_by)
       VALUES (1, 1, 'Identity waypoint', 'Public description.', 1, ?, 'staff-seed')`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, public_display_name, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('adult-custom', 'adult-custom@example.test', 'Private Adult', 'Hunter 43BA', 'Nancy & Ron', ?,
               'adult', NULL, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, public_display_name, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('adult-fallback', 'adult-fallback@example.test', 'Private Fallback', 'Hunter Fallback', NULL, ?,
               'adult', NULL, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, public_display_name, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('minor-profile', 'minor-profile@example.test', 'Private Minor', 'Minor Generated Handle', 'Minor Custom Name', ?,
               'minor_guardian_permission', ?, ?, ?)`
    ).bind(timestamp, timestamp, timestamp, timestamp)
  ]);

  const identities = [
    ["adult-custom", "note-custom", "reply-custom", "Adult custom note."],
    ["adult-fallback", "note-fallback", "reply-fallback", "Adult fallback note."],
    ["minor-profile", "note-minor", "reply-minor", "Minor note."]
  ] as const;
  await db.batch(identities.flatMap(([subject, noteId, replyId, body]) => [
    db.prepare(
      `INSERT INTO field_notes
       (id, author_subject, waypoint_id, body, status, created_at, updated_at, published_at)
       VALUES (?, ?, 1, ?, 'approved', ?, ?, ?)`
    ).bind(noteId, subject, body, timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES (?, ?, ?, 'Reply.', 'published', ?)`
    ).bind(replyId, noteId, subject, timestamp)
  ]));

  await db.batch([
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('flag-reporter-subject-private-001', 'flag-reporter-private@example.test', 'Private flag reporter',
               'Private Reporter Handle', ?, 'adult', NULL, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO media_uploads
       (id, owner_kind, owner_id, private_object_key, derivative_object_key,
        content_type, byte_size, status, created_at)
       VALUES ('board-private-media', 'field_note', 'note-custom', 'private/board-asset/original.jpg',
               'derivatives/board-private-media.webp', 'image/webp', 1024, 'ready', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('board-private-reporter-flag', 'flag-reporter-subject-private-001', 'reply', 'reply-custom', 'spam', 'received', ?)`
    ).bind(timestamp)
  ]);

  const store = new D1DataStore(db);
  const board = await store.listBoard(null);
  const labels = new Map(board.items.map((note) => [String(note.id), {
    author: note.authorHandle,
    reply: (note.replies as Record<string, unknown>[])[0]?.authorHandle
  }]));
  assert.deepEqual(labels.get("note-custom"), { author: "Nancy & Ron", reply: "Nancy & Ron" });
  assert.deepEqual(labels.get("note-fallback"), { author: "Hunter Fallback", reply: "Hunter Fallback" });
  assert.deepEqual(labels.get("note-minor"), { author: "Young Hunter", reply: "Young Hunter" });
  await store.moderateReply("reply-custom", "hide", "Private moderation reason", "staff-identity");
  const boardWithModerationHistory = await store.listBoard(null);
  const publicEnvelope = {
    data: boardWithModerationHistory.items,
    page: { nextCursor: boardWithModerationHistory.nextCursor }
  };
  assertPublicBoardEnvelopeShape(publicEnvelope);
  assert.throws(
    () => assertPublicBoardEnvelopeShape({ ...publicEnvelope, subject: "fixture-independent-private-key" }),
    /unexpected public board keys/
  );
  const serializedBoard = JSON.stringify(boardWithModerationHistory);
  for (const privateValue of [
    "adult-custom",
    "adult-custom@example.test",
    "Private Adult",
    "minor-profile",
    "minor-profile@example.test",
    "Private Minor",
    "Minor Custom Name",
    "Minor Generated Handle",
    "Private moderation reason",
    "flag-reporter-subject-private-001",
    "privateObjectKey",
    "private/board-asset/original.jpg",
    "derivatives/board-private-media.webp"
  ]) {
    assert.equal(serializedBoard.includes(privateValue), false, `${privateValue} must not enter public board output`);
  }
  assert.match(serializedBoard, /Young Hunter/);
  assert.match(serializedBoard, /Nancy & Ron/);
});

test("real D1 projects recent published replies with public parent context and received flag counts", async (t) => {
  const migrationFiles = [
    "0001_hunter_platform.sql",
    "0002_consent_ledger_index.sql",
    "0003_player_accounts_and_legal_acceptance.sql",
    "0004_environment_metadata.sql",
    "0005_sponsor_inquiries.sql",
    "0006_participation_waiver_and_receipts.sql",
    "0007_waiver_receipt_leases.sql",
    "0008_immutable_waiver_ledgers.sql",
    "0009_atomic_rate_limits.sql",
    "0010_graph_transactional_email.sql",
    "0011_report_publication_and_participation.sql",
    "0012_lucky_13_waypoints.sql",
    "0015_submission_ops_publication_refinement.sql"
  ];
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `reply-moderation-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const file of migrationFiles) await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));

  const timestamp = "2026-07-15T18:00:00.000Z";
  await db.batch([
    db.prepare(
      `INSERT INTO waypoints
       (id, route_order, name, description, is_published, updated_at, updated_by)
       VALUES (1, 4, 'Seniors Centre', 'Public waypoint context.', 1, ?, 'staff-seed')`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, public_display_name, adult_attested_at,
        participation_basis, guardian_permission_attested_at, created_at, updated_at)
       VALUES ('reply-author', 'reply-author@example.test', 'Private Author', 'Hunter 43BA', 'Nancy & Ron', ?,
               'adult', NULL, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, adult_attested_at, participation_basis, created_at, updated_at)
       VALUES ('flag-reporter', 'flag-reporter@example.test', 'Private Reporter', 'Hunter Reporter', ?, 'adult', ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO field_notes
       (id, author_subject, waypoint_id, body, status, created_at, updated_at, published_at)
       VALUES ('moderation-note', 'reply-author', 1, 'Public parent note.', 'approved', ?, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES ('moderation-reply', 'moderation-note', 'reply-author', 'A public reply.', 'published', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
       VALUES ('moderation-flag', 'flag-reporter', 'reply', 'moderation-reply', 'spam', 'Private reporter detail.', 'received', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
       VALUES ('moderation-reviewing-flag', 'flag-reporter', 'reply', 'moderation-reply', 'harassment', 'Private review detail.', 'reviewing', ?)`
    ).bind(timestamp)
  ]);

  const store = new D1DataStore(db);
  await db.batch([
    db.prepare(
      `INSERT INTO private_reports
       (id, report_type, reporter_name, reporter_email, location_description, details, status, created_at, updated_at)
       VALUES ('received-private-report', 'tip', 'Private reporter name', 'private-report@example.test',
               'Private location', 'Private report detail', 'received', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO field_notes
       (id, author_subject, waypoint_id, body, status, created_at, updated_at)
       VALUES ('unapproved-parent-note', 'reply-author', 1, 'Unapproved parent.', 'pending', ?, ?)`
    ).bind(timestamp, timestamp),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES ('unapproved-parent-reply', 'unapproved-parent-note', 'reply-author', 'Hidden parent reply.', 'published', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('unapproved-parent-flag', 'flag-reporter', 'reply', 'unapproved-parent-reply', 'spam', 'received', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES ('deleted-target-reply', 'moderation-note', 'reply-author', 'Deleted target.', 'deleted', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('deleted-target-flag', 'flag-reporter', 'reply', 'deleted-target-reply', 'spam', 'received', ?)`
    ).bind(timestamp)
  ]);
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 2
  });
  const cursorPayload = (input: unknown) => btoa(typeof input === "string" ? input : JSON.stringify(input))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const canonicalCursor = `m1.${cursorPayload([timestamp, "moderation-reply"])}`;
  const invalidCursors = [
    `m0.${cursorPayload([timestamp, "moderation-reply"])}`,
    `m1.${cursorPayload(["not-a-timestamp", ""])}`,
    `${canonicalCursor}=`,
    `m1.${cursorPayload(`["${timestamp}", "moderation-reply"]`)}`,
    `m1.${cursorPayload([timestamp, "moderation-reply", "surplus"])}`
  ];
  for (const cursor of invalidCursors) {
    for (const list of [
      () => store.listModerationReplies({ cursor }),
      () => store.listContentFlags({ cursor })
    ]) {
      await assert.rejects(
        list,
        (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "invalid_cursor"
      );
    }
  }
  const boardReplyCount = async () => {
    const note = (await store.listBoard(null)).items[0] as { replies?: unknown[] } | undefined;
    return note?.replies?.length ?? 0;
  };
  const replies = await store.listModerationReplies();
  assert.deepEqual(replies.items, [{
    id: "moderation-reply",
    noteId: "moderation-note",
    noteExcerpt: "Public parent note.",
    waypointRouteOrder: 4,
    waypointName: "Seniors Centre",
    body: "A public reply.",
    authorHandle: "Nancy & Ron",
    status: "published",
    flagCount: 2,
    createdAt: timestamp,
    moderatedAt: null
  }]);

  const hidden = await store.moderateReply("moderation-reply", "hide", "Spam burst", "staff-1");
  assert.equal(hidden?.status, "hidden");
  assert.equal(await boardReplyCount(), 0);
  assert.equal((await store.listModerationReplies()).items[0]?.status, "hidden");
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 0
  });
  assert.deepEqual(
    await db.prepare("SELECT status, resolved_by FROM content_flags WHERE id = 'moderation-flag'").first(),
    { status: "resolved", resolved_by: "staff-1" }
  );
  assert.deepEqual(
    await db.prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events WHERE target_id = 'moderation-reply'`
    ).first(),
    {
      actor_subject: "staff-1",
      action: "reply.hidden",
      target_kind: "field_note_reply",
      target_id: "moderation-reply",
      metadata_json: JSON.stringify({ reason: "Spam burst" })
    }
  );
  assert.equal(await store.moderateReply("moderation-reply", "hide", "Repeat", "staff-1"), null);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'moderation-reply'")
      .first<{ count: number }>())?.count,
    1
  );

  const restored = await store.moderateReply("moderation-reply", "restore", "False positive", "staff-2");
  assert.equal(restored?.status, "published");
  assert.equal(await boardReplyCount(), 1);
  assert.deepEqual(
    await db.prepare("SELECT status, resolved_by FROM content_flags WHERE id = 'moderation-flag'").first(),
    { status: "resolved", resolved_by: "staff-1" }
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'moderation-reply'")
      .first<{ count: number }>())?.count,
    2
  );

  await db.prepare(
    `INSERT INTO content_flags
     (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
     VALUES ('pending-flag', 'flag-reporter', 'reply', 'moderation-reply', 'harassment', 'Private flag detail.', 'received', ?)`
  ).bind(timestamp).run();
  const flags = await store.listContentFlags();
  assert.deepEqual(flags.items, [{
    id: "pending-flag",
    targetKind: "reply",
    targetId: "moderation-reply",
    targetExcerpt: "A public reply.",
    authorHandle: "Nancy & Ron",
    targetStatus: "published",
    noteExcerpt: "Public parent note.",
    waypointRouteOrder: 4,
    waypointName: "Seniors Centre",
    reason: "harassment",
    status: "received",
    createdAt: timestamp
  }]);
  assert.doesNotMatch(JSON.stringify(flags), /flag-reporter|Private flag detail/);

  const dismissed = await store.moderateContentFlag("pending-flag", "dismiss", "Not actionable", "staff-3");
  assert.equal(dismissed?.status, "dismissed");
  assert.equal(await boardReplyCount(), 1);
  assert.equal((await store.listContentFlags()).items.length, 0);
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 0
  });
  assert.deepEqual(
    await db.prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events WHERE target_id = 'pending-flag'`
    ).first(),
    {
      actor_subject: "staff-3",
      action: "content_flag.dismissed",
      target_kind: "content_flag",
      target_id: "pending-flag",
      metadata_json: JSON.stringify({ reason: "Not actionable" })
    }
  );
  assert.equal(await store.moderateContentFlag("pending-flag", "dismiss", "Repeat", "staff-3"), null);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'pending-flag'")
      .first<{ count: number }>())?.count,
    1
  );

  await db.batch([
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('note-received-flag', 'flag-reporter', 'note', 'moderation-note', 'spam', 'received', ?)`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('note-reviewing-flag', 'flag-reporter', 'note', 'moderation-note', 'harassment', 'reviewing', ?)`
    ).bind(timestamp)
  ]);
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 2
  });
  assert.deepEqual(
    (await store.listContentFlags()).items.map((flag) => [flag.id, flag.targetKind, flag.status]),
    [
      ["note-reviewing-flag", "note", "reviewing"],
      ["note-received-flag", "note", "received"]
    ]
  );
  assert.equal(
    (await store.moderateContentFlag("note-received-flag", "dismiss", "Not actionable", "staff-3"))?.status,
    "dismissed"
  );
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 1
  });
  assert.equal(
    (await store.moderateContentFlag("note-reviewing-flag", "dismiss", "Not actionable", "staff-3"))?.status,
    "dismissed"
  );
  assert.deepEqual((await store.getOpsDashboard()).counts, {
    pendingNotes: 1,
    receivedReports: 1,
    receivedFlags: 0
  });

  await db.prepare(
    `INSERT INTO content_flags
     (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
     VALUES ('hide-target-flag', 'flag-reporter', 'reply', 'moderation-reply', 'spam', NULL, 'reviewing', ?)`
  ).bind(timestamp).run();
  await db.prepare(
    `INSERT INTO content_flags
     (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
     VALUES ('hide-target-sibling-flag', 'flag-reporter', 'reply', 'moderation-reply', 'harassment', NULL, 'received', ?)`
  ).bind(timestamp).run();
  const hiddenByFlag = await store.moderateContentFlag(
    "hide-target-flag", "hide_target", "Confirmed abuse", "staff-4"
  );
  assert.equal(hiddenByFlag?.status, "resolved");
  assert.equal(await boardReplyCount(), 0);
  assert.deepEqual(
    await db.prepare("SELECT status, resolved_by FROM content_flags WHERE id = 'hide-target-flag'").first(),
    { status: "resolved", resolved_by: "staff-4" }
  );
  assert.deepEqual(
    await db.prepare("SELECT status, resolved_by FROM content_flags WHERE id = 'hide-target-sibling-flag'").first(),
    { status: "resolved", resolved_by: "staff-4" }
  );
  assert.deepEqual(
    await db.prepare(
      `SELECT actor_subject, action, target_kind, target_id, metadata_json
       FROM audit_events WHERE target_id = 'hide-target-flag'`
    ).first(),
    {
      actor_subject: "staff-4",
      action: "content_flag.target_hidden",
      target_kind: "content_flag",
      target_id: "hide-target-flag",
      metadata_json: JSON.stringify({ reason: "Confirmed abuse" })
    }
  );
  await db.prepare(
    `INSERT INTO content_flags
     (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
     VALUES ('repeat-hide-target-flag', 'flag-reporter', 'reply', 'moderation-reply', 'spam', NULL, 'received', ?)`
  ).bind(timestamp).run();
  assert.equal(
    await store.moderateContentFlag("repeat-hide-target-flag", "hide_target", "Repeat", "staff-4"),
    null
  );
  assert.deepEqual(
    await db.prepare("SELECT status FROM content_flags WHERE id = 'repeat-hide-target-flag'").first(),
    { status: "received" }
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'repeat-hide-target-flag'")
      .first<{ count: number }>())?.count,
    0
  );
  await db.prepare(
    `INSERT INTO content_flags
     (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
     VALUES ('note-hide-target-flag', 'flag-reporter', 'note', 'moderation-note', 'spam', NULL, 'received', ?)`
  ).bind(timestamp).run();
  assert.equal(
    await store.moderateContentFlag("note-hide-target-flag", "hide_target", "Wrong target", "staff-4"),
    null
  );
  assert.deepEqual(
    await db.prepare("SELECT status FROM content_flags WHERE id = 'note-hide-target-flag'").first(),
    { status: "received" }
  );

  await db.prepare(
    `INSERT INTO field_note_replies
     (id, field_note_id, author_subject, body, status, created_at)
     VALUES ('concurrent-reply', 'moderation-note', 'reply-author', 'Concurrent reply.', 'published', '2026-07-14T18:00:00.000Z')`
  ).run();
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-17T18:00:00.000Z") });
  try {
    const [firstHide, repeatedHide] = await Promise.all([
      store.moderateReply("concurrent-reply", "hide", "Confirmed spam", "staff-5"),
      store.moderateReply("concurrent-reply", "hide", "Repeat", "staff-5")
    ]);
    assert.equal(firstHide?.status, "hidden");
    assert.equal(repeatedHide, null);
  } finally {
    t.mock.timers.reset();
  }
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'concurrent-reply'")
      .first<{ count: number }>())?.count,
    1
  );

  await db.batch([
    db.prepare("UPDATE content_flags SET status = 'resolved'"),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES ('pagination-reply-a', 'moderation-note', 'reply-author', 'First paginated reply.', 'published', '2026-07-16T18:00:00.000Z')`
    ),
    db.prepare(
      `INSERT INTO field_note_replies
       (id, field_note_id, author_subject, body, status, created_at)
       VALUES ('pagination-reply-b', 'moderation-note', 'reply-author', 'Second paginated reply.', 'published', '2026-07-16T18:00:00.000Z')`
    ),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('pagination-flag-a', 'flag-reporter', 'reply', 'pagination-reply-a', 'spam', 'received', '2026-07-16T18:00:00.000Z')`
    ),
    db.prepare(
      `INSERT INTO content_flags
       (id, reporter_subject, target_kind, target_id, reason, status, created_at)
       VALUES ('pagination-flag-b', 'flag-reporter', 'reply', 'pagination-reply-b', 'spam', 'received', '2026-07-16T18:00:00.000Z')`
    )
  ]);
  const firstReplyPage = await store.listModerationReplies({ limit: 1 });
  assert.equal(firstReplyPage.items[0]?.id, "pagination-reply-b");
  assert.match(String(firstReplyPage.nextCursor), /^m1\./);
  assert.doesNotMatch(String(firstReplyPage.nextCursor), /2026-07-16/);
  const secondReplyPage = await store.listModerationReplies({ limit: 1, cursor: firstReplyPage.nextCursor });
  assert.equal(secondReplyPage.items[0]?.id, "pagination-reply-a");
  const thirdReplyPage = await store.listModerationReplies({ limit: 1, cursor: secondReplyPage.nextCursor });
  assert.equal(thirdReplyPage.items[0]?.id, "moderation-reply");
  const fourthReplyPage = await store.listModerationReplies({ limit: 1, cursor: thirdReplyPage.nextCursor });
  assert.equal(fourthReplyPage.items[0]?.id, "concurrent-reply");
  assert.equal(fourthReplyPage.nextCursor, null);

  const firstFlagPage = await store.listContentFlags({ limit: 1 });
  assert.equal(firstFlagPage.items[0]?.id, "pagination-flag-b");
  assert.match(String(firstFlagPage.nextCursor), /^m1\./);
  const secondFlagPage = await store.listContentFlags({ limit: 1, cursor: firstFlagPage.nextCursor });
  assert.equal(secondFlagPage.items[0]?.id, "pagination-flag-a");
  assert.equal(secondFlagPage.nextCursor, null);
});

test("FakeStore mirrors public reply moderation state and audited conditional transitions", async () => {
  const store = new FakeStore();
  store.profiles.set("reply-author", {
    participationBasis: "adult",
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA"
  });
  store.board.push({
    id: "fake-note",
    authorSubject: "reply-author",
    waypointId: 1,
    waypointRouteOrder: 4,
    waypointName: "Seniors Centre",
    body: "Public parent note.",
    authorHandle: "Nancy & Ron",
    status: "approved",
    createdAt: "2026-07-15T18:00:00.000Z",
    replies: [{
      id: "fake-reply",
      body: "A public reply.",
      authorHandle: "Nancy & Ron",
      createdAt: "2026-07-15T18:00:00.000Z"
    }]
  }, {
    id: "fake-unapproved-note",
    authorSubject: "reply-author",
    body: "Unapproved parent.",
    status: "pending",
    createdAt: "2026-07-15T18:00:00.000Z"
  });
  store.replies.push(
    {
      id: "fake-reply",
      noteId: "fake-note",
      authorSubject: "reply-author",
      body: "A public reply.",
      authorHandle: "Nancy & Ron",
      status: "published",
      createdAt: "2026-07-15T18:00:00.000Z"
    },
    {
      id: "fake-unapproved-parent-reply",
      noteId: "fake-unapproved-note",
      authorSubject: "reply-author",
      body: "Hidden parent reply.",
      status: "published",
      createdAt: "2026-07-16T18:00:00.000Z"
    },
    {
      id: "fake-missing-profile-reply",
      noteId: "fake-note",
      authorSubject: "missing-author",
      body: "Unknown author reply.",
      status: "published",
      createdAt: "2026-07-16T18:00:00.000Z"
    }
  );
  store.flags.push(
    {
      id: "fake-flag",
      targetKind: "reply",
      targetId: "fake-reply",
      reason: "spam",
      details: "Private reporter detail.",
      reporterSubject: "private-reporter",
      status: "received",
      createdAt: "2026-07-15T18:00:00.000Z"
    },
    {
      id: "fake-unapproved-parent-flag",
      targetKind: "reply",
      targetId: "fake-unapproved-parent-reply",
      reason: "spam",
      status: "received",
      createdAt: "2026-07-16T18:00:00.000Z"
    },
    {
      id: "fake-missing-profile-flag",
      targetKind: "reply",
      targetId: "fake-missing-profile-reply",
      reason: "spam",
      status: "received",
      createdAt: "2026-07-16T18:00:00.000Z"
    }
  );

  const cursorPayload = (input: unknown) => btoa(typeof input === "string" ? input : JSON.stringify(input))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const canonicalCursor = `m1.${cursorPayload(["2026-07-15T18:00:00.000Z", "fake-reply"])}`;
  const invalidCursors = [
    `m0.${cursorPayload(["2026-07-15T18:00:00.000Z", "fake-reply"])}`,
    `m1.${cursorPayload(["not-a-timestamp", ""])}`,
    `${canonicalCursor}=`,
    `m1.${cursorPayload('["2026-07-15T18:00:00.000Z", "fake-reply"]')}`,
    `m1.${cursorPayload(["2026-07-15T18:00:00.000Z", "fake-reply", "surplus"])}`
  ];
  for (const cursor of invalidCursors) {
    for (const list of [
      () => store.listModerationReplies({ cursor }),
      () => store.listContentFlags({ cursor })
    ]) {
      await assert.rejects(
        list,
        (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "invalid_cursor"
      );
    }
  }
  const initialFakeReplies = await store.listModerationReplies();
  assert.deepEqual(initialFakeReplies.items.map((reply) => reply.id), ["fake-reply"]);
  const initialFakeFlags = await store.listContentFlags();
  assert.deepEqual(initialFakeFlags.items.map((flag) => flag.id), ["fake-flag"]);
  assert.doesNotMatch(JSON.stringify(initialFakeFlags), /private-reporter|Private reporter detail/);
  assert.equal((await store.moderateReply("fake-reply", "hide", "Spam burst", "staff-1"))?.status, "hidden");
  assert.equal((await store.listBoard(null)).items[0]?.replies.length, 0);
  assert.equal(store.flags[0]?.status, "resolved");
  assert.equal(await store.moderateReply("fake-reply", "hide", "Repeat", "staff-1"), null);
  assert.equal(store.audits.filter((audit) => audit.targetId === "fake-reply").length, 1);

  assert.equal((await store.moderateReply("fake-reply", "restore", "False positive", "staff-2"))?.status, "published");
  store.flags.push(
    {
      id: "fake-hide-target-flag",
      targetKind: "reply",
      targetId: "fake-reply",
      reason: "harassment",
      status: "reviewing",
      createdAt: "2026-07-15T18:00:00.000Z"
    },
    {
      id: "fake-hide-target-sibling-flag",
      targetKind: "reply",
      targetId: "fake-reply",
      reason: "spam",
      status: "received",
      createdAt: "2026-07-15T18:00:00.000Z"
    }
  );
  assert.equal(
    (await store.moderateContentFlag("fake-hide-target-flag", "hide_target", "Confirmed abuse", "staff-3"))?.status,
    "resolved"
  );
  assert.deepEqual(store.flags.slice(-2).map((flag) => flag.status), ["resolved", "resolved"]);
  assert.equal(await store.moderateContentFlag("fake-hide-target-flag", "hide_target", "Repeat", "staff-3"), null);
  assert.equal(store.audits.filter((audit) => audit.targetId === "fake-hide-target-flag").length, 1);

  store.replies.push(
    {
      id: "fake-pagination-reply-a",
      noteId: "fake-note",
      authorSubject: "reply-author",
      body: "First paginated reply.",
      status: "published",
      createdAt: "2026-07-16T18:00:00.000Z"
    },
    {
      id: "fake-pagination-reply-b",
      noteId: "fake-note",
      authorSubject: "reply-author",
      body: "Second paginated reply.",
      status: "published",
      createdAt: "2026-07-16T18:00:00.000Z"
    }
  );
  store.flags.push(
    {
      id: "fake-pagination-flag-a",
      targetKind: "reply",
      targetId: "fake-pagination-reply-a",
      reason: "spam",
      status: "received",
      createdAt: "2026-07-16T18:00:00.000Z"
    },
    {
      id: "fake-pagination-flag-b",
      targetKind: "reply",
      targetId: "fake-pagination-reply-b",
      reason: "spam",
      status: "received",
      createdAt: "2026-07-16T18:00:00.000Z"
    }
  );
  const firstFakeReplyPage = await store.listModerationReplies({ limit: 1 });
  assert.equal(firstFakeReplyPage.items[0]?.id, "fake-pagination-reply-b");
  assert.match(String(firstFakeReplyPage.nextCursor), /^m1\./);
  const secondFakeReplyPage = await store.listModerationReplies({
    limit: 1,
    cursor: firstFakeReplyPage.nextCursor
  });
  assert.equal(secondFakeReplyPage.items[0]?.id, "fake-pagination-reply-a");
  const thirdFakeReplyPage = await store.listModerationReplies({
    limit: 1,
    cursor: secondFakeReplyPage.nextCursor
  });
  assert.equal(thirdFakeReplyPage.items[0]?.id, "fake-reply");
  assert.equal(thirdFakeReplyPage.nextCursor, null);

  const firstFakeFlagPage = await store.listContentFlags({ limit: 1 });
  assert.equal(firstFakeFlagPage.items[0]?.id, "fake-pagination-flag-b");
  const secondFakeFlagPage = await store.listContentFlags({
    limit: 1,
    cursor: firstFakeFlagPage.nextCursor
  });
  assert.equal(secondFakeFlagPage.items[0]?.id, "fake-pagination-flag-a");
  assert.equal(secondFakeFlagPage.nextCursor, null);
});
