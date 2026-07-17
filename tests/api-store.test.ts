import assert from "node:assert/strict";
import test from "node:test";
import { D1DataStore } from "../src/server/d1-store";
import { ApiError } from "../src/server/errors";
import { participationWaiverDocument } from "../src/server/legal-documents";
import { FakeStore } from "./api-test-kit";

type Row = Record<string, unknown>;

class Statement {
  bindings: unknown[] = [];

  constructor(
    private readonly database: ScriptedD1,
    readonly sql: string
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    if (this.database.firstResults.length > 0) {
      return this.database.firstResults.shift() as T | null;
    }
    if (this.sql.includes("FROM hunter_profiles WHERE subject")) return null;
    if (this.sql.includes("SELECT p.*")) return this.database.profile as T;
    if (this.sql.includes("COUNT(*) AS total_profiles")) return this.database.counts as T;
    return null;
  }

  async all<T>() {
    if (this.database.allResults.length > 0) {
      return { results: this.database.allResults.shift() as T[] };
    }
    if (this.sql.includes("ORDER BY p.updated_at DESC")) {
      return { results: this.database.subscribers as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    if (this.database.runError) throw this.database.runError;
    return { success: true, meta: { changes: 1 } };
  }
}

class ScriptedD1 {
  statements: Statement[] = [];
  firstResults: Array<Row | null> = [];
  allResults: Row[][] = [];
  batchCalls: Statement[][] = [];
  batchChanges: number[][] = [];
  batchError: Error | null = null;
  runError: Error | null = null;
  profile: Row = {
    subject: "hunter-1",
    verified_email: "hunter@example.test",
    full_name: "A Hunter",
    public_handle: "Hunter A7F3",
    phone: null,
    town_area: "Seba Beach",
    age_band: "25-34",
    interests_json: "[]",
    discovery_source: "friend",
    adult_attested_at: "2026-07-11T15:00:00.000Z",
    created_at: "2026-07-11T15:00:00.000Z",
    updated_at: "2026-07-11T17:00:00.000Z",
    hunt_email_consent: 1,
    marketing_consent: 0
  };
  counts: Row = {
    total_profiles: 2,
    hunt_email_count: 2,
    marketing_count: 1
  };
  subscribers: Row[] = [
    {
      ...this.profile,
      phone: null
    }
  ];

  prepare(sql: string) {
    const statement = new Statement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: Statement[]) {
    this.batchCalls.push(statements);
    if (this.batchError) throw this.batchError;
    const changes = this.batchChanges.shift() ?? statements.map(() => 1);
    return statements.map((_statement, index) => ({
      results: [],
      success: true,
      meta: { changes: changes[index] ?? 0 }
    }));
  }
}

const sponsorRow = (overrides: Row = {}): Row => ({
  id: "sponsor-1",
  reference_code: "SP-AB12CD34",
  contact_name: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: null,
  support_type: "lead",
  contribution_range: "prefer_to_discuss",
  desired_outcome: "Discuss a useful local activation.",
  acknowledgement_version: "2026.1",
  state: "new",
  created_at: "2026-07-13T20:00:00.000Z",
  updated_at: "2026-07-13T20:00:00.000Z",
  ...overrides
});

const sponsorInput = {
  contactName: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: null,
  supportType: "lead" as const,
  contributionRange: "prefer_to_discuss" as const,
  desiredOutcome: "Discuss a useful local activation.",
  acknowledgementVersion: "2026.1"
};

const waiverReviewRow: Row = {
  id: "review-1",
  hunter_subject: "hunter-1",
  document_version: participationWaiverDocument.version,
  document_hash: participationWaiverDocument.hash,
  reviewed_at: "2026-07-13T20:00:00.000Z"
};

const waiverAcceptanceRow: Row = {
  id: "acceptance-12345678-aaaa-bbbb-cccc-1234567890ab",
  hunter_subject: "hunter-1",
  document_version: participationWaiverDocument.version,
  document_hash: participationWaiverDocument.hash,
  accepted_at: "2026-07-13T20:02:00.000Z",
  job_id: "receipt-job-1",
  job_status: "pending",
  job_attempts: 0,
  sent_at: null
};

const waiverParticipantRows: Row[] = [
  {
    participant_role: "adult",
    participation_basis: "adult",
    full_name: "Alex Adult",
    birth_year: null,
    guardian_attested: 0
  },
  {
    participant_role: "minor",
    participation_basis: null,
    full_name: "Casey Minor",
    birth_year: 2014,
    guardian_attested: 1
  }
];

const waiverAccountProfileRow: Row = {
  full_name: "Alex Adult",
  participation_basis: "adult",
  guardian_permission_attested_at: null
};

const waiverAcceptanceInput = {
  reviewEventId: "review-1",
  idempotencyKey: "waiver-key-1",
  adultName: "Alex Adult",
  minors: [{ fullName: "Casey Minor", birthYear: 2014 }],
  guardianAttested: true,
  documentVersion: participationWaiverDocument.version,
  documentHash: participationWaiverDocument.hash
};

test("D1 report creation atomically snapshots active activated operators for one alert job", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(null, {
    id: "report-1",
    report_type: "tip",
    hunter_subject: null,
    reporter_name: "Private Reporter",
    reporter_email: "private@example.test",
    reporter_phone: null,
    waypoint_id: null,
    waypoint_route_order: null,
    waypoint_name: null,
    location_description: "Private location",
    latitude: null,
    longitude: null,
    details: "Private detail",
    status: "received",
    created_at: "2026-07-16T20:00:00.000Z",
    updated_at: "2026-07-16T20:00:00.000Z",
    assigned_to: null
  });
  const store = new D1DataStore(database as never);

  const result = await store.createReport({
    type: "tip",
    name: "Private Reporter",
    email: "private@example.test",
    locationDescription: "Private location",
    details: "Private detail",
    media: []
  }, "report-key-1");

  assert.equal(result.replayed, false);
  assert.equal(typeof result.operatorAlertJobId, "string");
  const sql = database.batchCalls[0]!.map((statement) => statement.sql).join("\n");
  assert.match(sql, /VALUES \(\?, 'operator_private_report'/i);
  assert.match(sql, /INSERT INTO operator_alert_recipients/i);
  assert.match(sql, /FROM staff_principals/i);
  assert.match(sql, /status = 'active'/i);
  assert.match(sql, /provider_subject IS NOT NULL/i);
  assert.match(sql, /activated_at IS NOT NULL/i);
  const job = database.batchCalls[0]!.find((statement) =>
    statement.sql.includes("'operator_private_report'")
  );
  assert.equal(result.operatorAlertJobId, job?.bindings[0]);
});

test("D1 Field Note creation atomically snapshots operators for one moderation alert job", async () => {
  const database = new ScriptedD1();
  const store = new D1DataStore(database as never);

  const result = await store.createFieldNote({
    authorSubject: "hunter-1",
    waypointId: 1,
    body: "A note for moderation.",
    media: []
  }, "field-note-test-key");

  assert.equal(typeof result.operatorAlertJobId, "string");
  const sql = database.batchCalls[0]!.map((statement) => statement.sql).join("\n");
  assert.match(sql, /VALUES \(\?, 'operator_field_note_moderation'/i);
  assert.match(sql, /INSERT INTO operator_alert_recipients/i);
  const job = database.batchCalls[0]!.find((statement) =>
    statement.sql.includes("'operator_field_note_moderation'")
  );
  assert.equal(result.operatorAlertJobId, job?.bindings[0]);
});

test("D1 waiver acceptance writes one atomic immutable snapshot and subject-scoped replay key", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(null, waiverReviewRow, waiverAccountProfileRow, waiverAcceptanceRow);
  database.allResults.push(waiverParticipantRows);
  const store = new D1DataStore(database as never);

  const result = await store.acceptParticipationWaiver("hunter-1", waiverAcceptanceInput);

  assert.equal(result.replayed, false);
  assert.equal(result.value.referenceCode, "TLS-W-ACCEPTAN");
  assert.deepEqual(result.value.participants, [
    { role: "adult", participationBasis: "adult", fullName: "Alex Adult", birthYear: null, guardianAttested: false },
    { role: "minor", participationBasis: undefined, fullName: "Casey Minor", birthYear: 2014, guardianAttested: true }
  ]);
  assert.equal(database.batchCalls.length, 1);
  assert.equal(database.batchCalls[0]?.length, 7);
  const sql = database.batchCalls[0]!.map((statement) => statement.sql).join("\n");
  assert.match(sql, /INSERT INTO legal_acceptance_events/);
  const acceptance = database.batchCalls[0]!.find((statement) =>
    statement.sql.includes("INSERT INTO legal_acceptance_events")
  );
  assert.match(acceptance?.sql ?? "", /SELECT[\s\S]+FROM legal_document_review_events/i);
  assert.match(acceptance?.sql ?? "", /account_state = 'active'/i);
  assert.match(acceptance?.sql ?? "", /r\.id = \?[\s\S]+r\.hunter_subject = \?/i);
  assert.match(sql, /INSERT INTO waiver_acceptance_participants/);
  assert.match(sql, /INSERT INTO waiver_account_participants/);
  assert.match(sql, /INSERT INTO notification_jobs/);
  assert.match(sql, /INSERT INTO notification_delivery_events/);
  assert.match(sql, /INSERT INTO idempotency_keys/);
  const idempotency = database.batchCalls[0]!.find((statement) =>
    statement.sql.includes("INSERT INTO idempotency_keys")
  );
  assert.equal(idempotency?.bindings[0], "waiver_acceptance:hunter-1");
  assert.equal(idempotency?.bindings[1], "waiver-key-1");
});

test("D1 waiver replay returns the subject-owned winner without duplicating acceptance", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(
    { record_id: waiverAcceptanceRow.id },
    waiverAcceptanceRow
  );
  database.allResults.push(waiverParticipantRows);
  const store = new D1DataStore(database as never);

  const result = await store.acceptParticipationWaiver("hunter-1", waiverAcceptanceInput);

  assert.equal(result.replayed, true);
  assert.equal(result.value.id, waiverAcceptanceRow.id);
  assert.equal(database.batchCalls.length, 0);
});

test("D1 returns private Ops waiver detail only after appending a privacy-safe view audit", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(
    { id: waiverAcceptanceRow.id, action: "accepted" },
    waiverAcceptanceRow
  );
  database.allResults.push(waiverParticipantRows);
  const store = new D1DataStore(database as never);

  const detail = await store.getAndAuditOpsWaiverDetail("hunter-1", "staff-1");

  assert.equal(detail?.id, waiverAcceptanceRow.id);
  const audit = database.statements.find((statement) =>
    statement.sql.includes("INSERT INTO audit_events")
  );
  assert.ok(audit);
  assert.equal(audit.bindings[1], "staff-1");
  assert.equal(audit.bindings[2], "player.waiver-detail.viewed");
  assert.equal(audit.bindings[3], "legal_acceptance");
  assert.equal(audit.bindings[4], waiverAcceptanceRow.id);
  assert.equal(audit.bindings[5], "{}");
  assert.match(String(audit.bindings[6]), /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(
    JSON.stringify(audit.bindings),
    /Alex Adult|Casey Minor|hunter@example\.test|2014/
  );

  const failingDatabase = new ScriptedD1();
  failingDatabase.firstResults.push(
    { id: waiverAcceptanceRow.id, action: "accepted" },
    waiverAcceptanceRow
  );
  failingDatabase.allResults.push(waiverParticipantRows);
  failingDatabase.runError = new Error("audit unavailable");
  const failingStore = new D1DataStore(failingDatabase as never);

  await assert.rejects(
    failingStore.getAndAuditOpsWaiverDetail("hunter-1", "staff-1"),
    /audit unavailable/
  );
});

test("D1 waiver acceptance recovers only the exact idempotency unique race", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(
    null,
    waiverReviewRow,
    waiverAccountProfileRow,
    { record_id: waiverAcceptanceRow.id },
    waiverAcceptanceRow
  );
  database.allResults.push(waiverParticipantRows);
  database.batchError = new Error(
    "D1_ERROR: UNIQUE constraint failed: idempotency_keys.scope, idempotency_keys.idempotency_key"
  );
  const store = new D1DataStore(database as never);

  const result = await store.acceptParticipationWaiver("hunter-1", waiverAcceptanceInput);
  assert.equal(result.replayed, true);

  const otherDatabase = new ScriptedD1();
  otherDatabase.firstResults.push(null, waiverReviewRow, waiverAccountProfileRow);
  otherDatabase.batchError = new Error(
    "D1_ERROR: UNIQUE constraint failed: notification_jobs.kind, notification_jobs.target_record_id"
  );
  const otherStore = new D1DataStore(otherDatabase as never);
  await assert.rejects(
    otherStore.acceptParticipationWaiver("hunter-1", waiverAcceptanceInput),
    /notification_jobs/
  );
});

test("D1 profile projection returns the latest consent booleans", async () => {
  const database = new ScriptedD1();
  const store = new D1DataStore(database as never);

  const profile = await store.getProfile("hunter-1");

  assert.deepEqual(profile?.consents, {
    huntEmail: true,
    marketing: false
  });
  assert.match(database.statements[0]?.sql ?? "", /consent_type = 'hunt_email'/);
  assert.match(database.statements[0]?.sql ?? "", /ORDER BY occurred_at DESC, id DESC/);
});

test("D1 subscriber ledger maps current consent and contact projections", async () => {
  const database = new ScriptedD1();
  const store = new D1DataStore(database as never);

  const ledger = await store.listSubscribers({ limit: 25 });

  assert.deepEqual(ledger.counts, {
    totalProfiles: 2,
    huntEmail: 2,
    marketing: 1
  });
  assert.equal(ledger.items[0]?.verifiedEmail, "hunter@example.test");
  assert.deepEqual(ledger.items[0]?.consents, {
    huntEmail: true,
    marketing: false
  });
  assert.match(database.statements.find((entry) => entry.sql.includes("ORDER BY p.updated_at DESC"))?.sql ?? "", /ROW_NUMBER\(\) OVER/);
});

test("D1 sponsor projection maps private rows to the exact domain record", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(sponsorRow());
  const store = new D1DataStore(database as never);

  const inquiry = await store.getSponsorInquiryByIdempotencyKey("sponsor-key-1");

  assert.deepEqual(inquiry, {
    id: "sponsor-1",
    referenceCode: "SP-AB12CD34",
    contactName: "Alex Sponsor",
    organization: "Example Ltd.",
    email: "alex@example.test",
    phone: null,
    supportType: "lead",
    contributionRange: "prefer_to_discuss",
    desiredOutcome: "Discuss a useful local activation.",
    acknowledgementVersion: "2026.1",
    state: "new",
    createdAt: "2026-07-13T20:00:00.000Z",
    updatedAt: "2026-07-13T20:00:00.000Z"
  });
  assert.deepEqual(database.statements[0]?.bindings, ["sponsor-key-1"]);
});

test("D1 sponsor creation checks idempotency and batches the inquiry with its submitted event", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(null, sponsorRow());
  const store = new D1DataStore(database as never);

  const created = await store.createSponsorInquiry(sponsorInput, "sponsor-key-1");

  assert.equal(created.replayed, false);
  assert.equal(created.value.referenceCode, "SP-AB12CD34");
  assert.match(database.statements[0]?.sql ?? "", /WHERE idempotency_key = \?/i);
  assert.equal(database.batchCalls.length, 1);
  const [inquiryInsert, eventInsert] = database.batchCalls[0] ?? [];
  assert.match(inquiryInsert?.sql ?? "", /INSERT INTO sponsor_inquiries/i);
  assert.ok(inquiryInsert?.bindings.includes("sponsor-key-1"));
  assert.match(eventInsert?.sql ?? "", /INSERT INTO sponsor_inquiry_events[\s\S]*'submitted'/i);
  assert.equal(eventInsert?.bindings[1], inquiryInsert?.bindings[0]);
  assert.match(database.statements.at(-1)?.sql ?? "", /WHERE id = \?/i);
});

test("D1 sponsor creation replays an existing idempotency key without writing", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(sponsorRow());
  const store = new D1DataStore(database as never);

  const replay = await store.createSponsorInquiry(sponsorInput, "sponsor-key-1");

  assert.equal(replay.replayed, true);
  assert.equal(replay.value.id, "sponsor-1");
  assert.equal(database.batchCalls.length, 0);
  assert.equal(database.statements.length, 1);
});

test("D1 sponsor creation resolves only an idempotency-key unique race as replay", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(null, sponsorRow());
  database.batchError = new Error(
    "D1_ERROR: UNIQUE constraint failed: sponsor_inquiries.idempotency_key"
  );
  const store = new D1DataStore(database as never);

  const replay = await store.createSponsorInquiry(sponsorInput, "sponsor-key-1");

  assert.equal(replay.replayed, true);
  assert.equal(replay.value.referenceCode, "SP-AB12CD34");
  assert.equal(database.batchCalls.length, 1);

  const otherDatabase = new ScriptedD1();
  otherDatabase.firstResults.push(null);
  otherDatabase.batchError = new Error("D1_ERROR: disk unavailable");
  const otherStore = new D1DataStore(otherDatabase as never);
  await assert.rejects(
    otherStore.createSponsorInquiry(sponsorInput, "sponsor-key-2"),
    /disk unavailable/
  );
});

test("D1 sponsor listing parameterizes filters, escapes LIKE wildcards, and pages by an opaque tuple cursor", async () => {
  const database = new ScriptedD1();
  const rows = Array.from({ length: 51 }, (_, index) =>
    sponsorRow({
      id: `sponsor-${String(100 - index).padStart(3, "0")}`,
      created_at: "2026-07-13T20:00:00.000Z"
    })
  );
  database.allResults.push(rows, []);
  const store = new D1DataStore(database as never);
  const options = {
    limit: 100,
    state: "qualified" as const,
    supportType: "lead" as const,
    query: "%_\\Acme"
  };

  const page = await store.listSponsorInquiries(options);

  assert.equal(page.items.length, 50);
  assert.ok(page.nextCursor);
  assert.doesNotMatch(page.nextCursor, /2026|sponsor/i);
  const firstStatement = database.statements[0];
  assert.match(firstStatement?.sql ?? "", /state = \?/i);
  assert.match(firstStatement?.sql ?? "", /support_type = \?/i);
  assert.match(firstStatement?.sql ?? "", /contact_name LIKE \?/i);
  assert.match(firstStatement?.sql ?? "", /organization LIKE \?/i);
  assert.match(firstStatement?.sql ?? "", /email LIKE \?/i);
  assert.equal((firstStatement?.sql.split("ESCAPE '\\'").length ?? 1) - 1, 3);
  assert.match(firstStatement?.sql ?? "", /ORDER BY created_at DESC, id DESC LIMIT \?/i);
  assert.doesNotMatch(firstStatement?.sql ?? "", /Acme/);
  assert.deepEqual(firstStatement?.bindings, [
    "qualified",
    "lead",
    "%\\%\\_\\\\Acme%",
    "%\\%\\_\\\\Acme%",
    "%\\%\\_\\\\Acme%",
    51
  ]);

  await store.listSponsorInquiries({ ...options, cursor: page.nextCursor });
  const cursorStatement = database.statements[1];
  assert.match(
    cursorStatement?.sql ?? "",
    /created_at < \? OR \(created_at = \? AND id < \?\)/i
  );
  assert.deepEqual(cursorStatement?.bindings.slice(-4), [
    "2026-07-13T20:00:00.000Z",
    "2026-07-13T20:00:00.000Z",
    "sponsor-051",
    51
  ]);
});

test("D1 sponsor state totals use one parameter-free aggregate and zero-fill missing states", async () => {
  const database = new ScriptedD1();
  database.allResults.push([
    { state: "new", count: 62 },
    { state: "qualified", count: 3 },
    { state: "closed", count: 1 }
  ]);
  const store = new D1DataStore(database as never);

  const counts = await store.countSponsorInquiriesByState();

  assert.deepEqual(counts, {
    new: 62,
    contacted: 0,
    qualified: 3,
    accepted: 0,
    closed: 1
  });
  assert.equal(database.statements.length, 1);
  const statement = database.statements[0];
  assert.match(statement?.sql ?? "", /SELECT state, COUNT\(\*\) AS count[\s\S]*FROM sponsor_inquiries[\s\S]*GROUP BY state/i);
  assert.doesNotMatch(statement?.sql ?? "", /WHERE|LIMIT|contact_name|organization|email/i);
  assert.deepEqual(statement?.bindings, []);
});

test("D1 sponsor update batches the transition event and skips unknown or empty changes", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(
    sponsorRow(),
    sponsorRow({ state: "qualified", updated_at: "2026-07-13T21:00:00.000Z" })
  );
  const store = new D1DataStore(database as never);

  const updated = await store.updateSponsorInquiry(
    "sponsor-1",
    { state: "qualified", note: "Call scheduled." },
    "staff-1"
  );

  assert.equal(updated?.state, "qualified");
  assert.equal(database.batchCalls.length, 1);
  const [eventStatement, updateStatement] = database.batchCalls[0] ?? [];
  assert.match(
    eventStatement?.sql ?? "",
    /INSERT INTO sponsor_inquiry_events[\s\S]*SELECT[\s\S]*FROM sponsor_inquiries[\s\S]*WHERE id = \? AND state = \?/i
  );
  assert.deepEqual(eventStatement?.bindings.slice(-2), ["sponsor-1", "new"]);
  assert.match(updateStatement?.sql ?? "", /UPDATE sponsor_inquiries/i);
  assert.match(updateStatement?.sql ?? "", /WHERE id = \? AND state = \?/i);
  assert.equal(updateStatement?.bindings[0], "qualified");
  assert.deepEqual(updateStatement?.bindings.slice(-2), ["sponsor-1", "new"]);
  for (const expected of [
    "sponsor-1",
    "staff-1",
    "state_changed",
    "new",
    "qualified",
    "Call scheduled."
  ]) {
    assert.ok(eventStatement?.bindings.includes(expected), `${expected} event binding`);
  }

  const unknownDatabase = new ScriptedD1();
  unknownDatabase.firstResults.push(null);
  const unknownStore = new D1DataStore(unknownDatabase as never);
  assert.equal(
    await unknownStore.updateSponsorInquiry(
      "missing",
      { state: "closed", note: "Not found." },
      "staff-1"
    ),
    null
  );
  assert.equal(unknownDatabase.batchCalls.length, 0);

  const noChangeDatabase = new ScriptedD1();
  noChangeDatabase.firstResults.push(sponsorRow());
  const noChangeStore = new D1DataStore(noChangeDatabase as never);
  assert.equal(
    (await noChangeStore.updateSponsorInquiry(
      "sponsor-1",
      { state: "new", note: "   " },
      "staff-1"
    ))?.id,
    "sponsor-1"
  );
  assert.equal(noChangeDatabase.batchCalls.length, 0);
});

test("D1 sponsor update records a note-only event without changing state", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(sponsorRow(), sponsorRow());
  const store = new D1DataStore(database as never);

  await store.updateSponsorInquiry(
    "sponsor-1",
    { state: "new", note: "Requested a follow-up." },
    "staff-1"
  );

  const updateStatement = database.batchCalls[0]?.[1];
  assert.match(updateStatement?.sql ?? "", /UPDATE sponsor_inquiries/i);
  const noteEventStatement = database.batchCalls[0]?.[0];
  assert.ok(noteEventStatement?.bindings.includes("note_added"));
  assert.deepEqual(
    noteEventStatement?.bindings.filter((item) => item === "new"),
    ["new", "new", "new"]
  );
});

test("D1 sponsor update throws a version conflict when its state guard loses a race", async () => {
  const database = new ScriptedD1();
  database.firstResults.push(sponsorRow());
  database.batchChanges.push([0, 0]);
  const store = new D1DataStore(database as never);

  await assert.rejects(
    store.updateSponsorInquiry(
      "sponsor-1",
      { state: "qualified", note: "Call scheduled." },
      "staff-1"
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "version_conflict" &&
      /sponsor inquiry.*refresh.*try again/i.test(error.message)
  );
  assert.equal(database.batchCalls.length, 1);
});

test("FakeStore rejects malformed sponsor cursors with the production API error", async () => {
  const store = new FakeStore();
  for (const cursor of [btoa("missing separator"), "%%%not-base64%%%"]) {
    await assert.rejects(
      store.listSponsorInquiries({ cursor }),
      (error: unknown) =>
        error instanceof ApiError && error.status === 400 && error.code === "invalid_cursor"
    );
  }
});
