import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBoardPayload,
  renderBoardFeed,
  validateReply,
} from "../src/client/board";
import {
  buildSubscriberCsv,
  applyWaiverReceiptRetryState,
  normalizeOpsDashboard,
  normalizeOpsSponsors,
  normalizeOpsSubscribers,
  normalizeOpsWaiverDetail,
  renderOpsWaiverDetail,
  renderSubscriberRows,
  renderSponsorRows,
  renderStaffRows,
  resolveOpsView,
  waiverReceiptRetryIntent,
} from "../src/client/ops";

const uncertainRetryConfirmation = "I checked the configured sender mailbox Sent Items or provider delivery log and still want to retry this uncertain receipt.";

test("player ledger keeps only a waiver summary until deliberate detail review", () => {
  const ledger = normalizeOpsSubscribers({ data: { counts: {}, items: [{
    id: "hunter-1",
    verifiedEmail: "hunter@example.test",
    accountState: "active",
    profileComplete: true,
    fullName: "Alex Hunter",
    publicHandle: "Hunter A1B2",
    townArea: "Seba Beach",
    privacyMediaVersion: "2026.2",
    waiverStatus: "accepted",
    waiverVersion: "2026.1",
    acceptedAt: "2026-07-13T18:05:00.000Z",
    minorCount: 1,
    receiptStatus: "pending",
    participationUnlocked: true,
    consents: { huntEmail: false, marketing: false },
    createdAt: "2026-07-13T18:00:00.000Z",
    updatedAt: "2026-07-13T18:05:00.000Z",
  }] } });
  assert.equal(ledger.items[0]?.minorCount, 1);
  const rows = renderSubscriberRows(ledger.items);
  assert.match(rows, /Review legal record/);
  assert.match(rows, /1 supervised minor/);
  assert.doesNotMatch(rows, /Sam Hunter|birth year/);

  const csv = buildSubscriberCsv(ledger.items);
  assert.doesNotMatch(csv, /minor_count|receipt_status|accepted_at/i);
});

test("waiver detail rendering validates and escapes the deliberately loaded private record", () => {
  const detail = normalizeOpsWaiverDetail({ data: {
    id: "waiver-1",
    subject: "hunter-1",
    documentVersion: "2026.1",
    documentHash: "a".repeat(64),
    acceptedAt: "2026-07-13T18:05:00.000Z",
    referenceCode: "TLS-W-ABC12345",
    participants: [
      { role: "adult", fullName: "Alex <Hunter>", birthYear: null, guardianAttested: false },
      { role: "minor", fullName: "Sam <script>", birthYear: 2014, guardianAttested: true },
    ],
    receipt: { jobId: "private-job", status: "failed", attempts: 2, sentAt: null },
  } });
  assert.equal(detail?.participants.length, 2);
  const html = renderOpsWaiverDetail(detail!);
  assert.match(html, /Alex &lt;Hunter&gt;/);
  assert.match(html, /Sam &lt;script&gt;<\/strong> \(birth year 2014\)/);
  assert.match(html, /2 attempts/);
  assert.doesNotMatch(html, /<script>|private-job/);
});

test("Ops sends the uncertain override only after the explicit Sent Items confirmation", () => {
  assert.deepEqual(waiverReceiptRetryIntent("uncertain"), {
    confirmation: uncertainRetryConfirmation,
    body: { confirmUncertainRetry: true },
  });
  assert.deepEqual(waiverReceiptRetryIntent("failed"), {
    confirmation: "Retry this participant's legal receipt email? This action will be audited.",
    body: undefined,
  });
});

test("Ops keeps a successfully queued receipt retry locked until detail refresh", () => {
  const dialog = { dataset: { receiptStatus: "uncertain" } };
  const button = { disabled: false };
  applyWaiverReceiptRetryState(dialog, button, true);
  assert.equal(dialog.dataset.receiptStatus, "pending");
  assert.equal(button.disabled, true);

  applyWaiverReceiptRetryState(dialog, button, false);
  assert.equal(dialog.dataset.receiptStatus, "pending");
  assert.equal(button.disabled, false);
});

test("sponsor operations rows normalize private fields and escape every rendered value", () => {
  const ledger = normalizeOpsSponsors({
    data: {
      counts: { new: 61, contacted: 4, qualified: 3, accepted: 2, closed: 9 },
      items: [{
      id: "sponsor-1",
      referenceCode: "SP-AB12CD34",
      contactName: "<script>alert(1)</script>",
      organization: "=Example Ltd.",
      email: "alex@example.test",
      phone: null,
      supportType: "lead",
      contributionRange: "prefer_to_discuss",
      desiredOutcome: "<img src=x onerror=alert(1)>",
      acknowledgementVersion: "2026.1",
      state: "new",
      createdAt: "2026-07-13T20:00:00.000Z",
      updatedAt: "2026-07-13T20:00:00.000Z"
      }]
    },
    page: { nextCursor: "cursor-2" }
  });
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.nextCursor, "cursor-2");
  assert.deepEqual(ledger.counts, { new: 61, contacted: 4, qualified: 3, accepted: 2, closed: 9 });

  const html = renderSponsorRows(ledger.items);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /SP-AB12CD34/);
  assert.match(html, /alex@example\.test/);
  assert.match(html, /data-sponsor-id="sponsor-1"/);
});

test("sponsor workflow totals fail closed when aggregate metadata is malformed", () => {
  const ledger = normalizeOpsSponsors({
    data: {
      counts: { new: -1, contacted: "4", qualified: 3.5, accepted: null },
      items: []
    },
    page: { nextCursor: null }
  });

  assert.deepEqual(ledger.counts, {
    new: null,
    contacted: null,
    qualified: null,
    accepted: null,
    closed: null
  });
});

test("visible sponsor metrics select workflow totals instead of current table rows", async () => {
  const opsModule = await import("../src/client/ops") as Record<string, unknown>;
  const metricValues = opsModule.sponsorMetricValues;
  assert.equal(typeof metricValues, "function");
  if (typeof metricValues !== "function") return;

  const ledger = normalizeOpsSponsors({
    data: {
      counts: { new: 80, contacted: 12, qualified: 7, accepted: 4, closed: 20 },
      items: [{
        id: "only-filtered-row",
        referenceCode: "SP-FILTER01",
        contactName: "Filtered Contact",
        organization: "Filtered Partner",
        email: "filtered@example.test",
        phone: null,
        supportType: "lead",
        contributionRange: null,
        desiredOutcome: "A filtered table result.",
        acknowledgementVersion: "2026.1",
        state: "qualified",
        createdAt: "2026-07-13T20:00:00.000Z",
        updatedAt: "2026-07-13T20:00:00.000Z"
      }]
    }
  });

  assert.deepEqual((metricValues as (value: unknown) => unknown)(ledger), [80, 12, 7, 4]);
});

test("board normalizer accepts opaque waypoint IDs ending in a zero-padded number", () => {
  const notes = normalizeBoardPayload({
    data: {
      items: [{
        id: "note-safe",
        waypointId: "wp-01",
        body: "A careful observation.",
        authorHandle: "Hunter A1B2",
        createdAt: "2026-07-11T18:00:00.000Z",
        media: [],
        replies: [],
      }],
    },
  });

  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.waypointId, "wp-01");
});

test("board normalizer accepts the backend's numeric waypoint projection", () => {
  const notes = normalizeBoardPayload({ data: [{
    id: "note-numeric",
    waypointId: 12,
    body: "Observation from the last waypoint.",
    authorHandle: "Hunter C3D4",
    createdAt: "2026-07-11T18:00:00.000Z",
    media: [],
    replies: [],
  }] });
  assert.equal(notes[0]?.waypointId, "12");
});

test("board renderer escapes community content and preserves the disclaimer", () => {
  const html = renderBoardFeed({
    kind: "ready",
    canReply: true,
    notes: [{
      id: "note-1",
      waypointId: "1",
      body: '<img src=x onerror="alert(1)">',
      authorHandle: "Hunter <script>",
      createdAt: "2026-07-11T18:00:00.000Z",
      media: [],
      replies: [],
    }],
  });

  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Community observation&mdash;not an official clue/);
  assert.match(html, /data-note-id="note-1"/);
});

test("flat replies reject public contact details, links and exact coordinates", () => {
  assert.equal(validateReply("Useful nearby landmark, no exact pin."), null);
  assert.match(validateReply("Email me at hunter@example.test") ?? "", /Contact details/);
  assert.match(validateReply("See https://example.test") ?? "", /Links/);
  assert.match(validateReply("53.12345, -114.12345") ?? "", /coordinates/);
});

test("ops dashboard fails closed when status or controls are incomplete", () => {
  const dashboard = normalizeOpsDashboard({ data: { status: null, counts: {}, killSwitches: { boardVisible: true } } });
  assert.equal(dashboard.status, null);
  assert.equal(dashboard.killSwitches, null);
  assert.equal(dashboard.counts.pendingNotes, null);
});

test("staff actions are capability-driven and never expose peer password controls", () => {
  const html = renderStaffRows([{
    subject: "staff_subject_1",
    email: "operator@example.test",
    displayName: "Case Operator",
    status: "active",
    invitedAt: "2026-07-11T18:00:00.000Z",
    lastLoginAt: "2026-07-11T18:10:00.000Z",
    sessionCount: 2,
    actions: ["recovery", "revoke-sessions", "suspend"],
  }]);

  assert.match(html, /Send recovery instructions/);
  assert.match(html, /Revoke sessions/);
  assert.match(html, /Suspend access/);
  assert.doesNotMatch(html, /set password|otherPassword|peerPassword/i);
});

test("invited staff remain visible before the identity provider assigns a subject", async () => {
  const opsModule = await import("../src/client/ops") as Record<string, unknown>;
  const normalize = opsModule.normalizeOpsStaff;
  assert.equal(typeof normalize, "function");
  if (typeof normalize !== "function") return;

  const records = (normalize as (payload: unknown) => Array<Record<string, unknown>>)({
    data: [{
      id: "staff-record-1",
      subject: null,
      email: "invited@example.test",
      displayName: "Invited Operator",
      status: "invited",
      invitedAt: "2026-07-11T18:00:00.000Z",
      activatedAt: null,
      lastLoginAt: null,
    }],
  });

  assert.equal(records.length, 1);
  const html = renderStaffRows(records as never);
  assert.match(html, /Invited Operator/);
  assert.match(html, /Resend invitation/);
  assert.doesNotMatch(html, /Revoke sessions/);
});

test("unknown operations hashes always return to the command desk", () => {
  assert.equal(resolveOpsView("#moderation"), "moderation");
  assert.equal(resolveOpsView("#not-a-ledger"), "command");
});

test("official mutations use the versioned backend contract", async () => {
  const opsModule = await import("../src/client/ops") as Record<string, unknown>;
  const buildStatus = opsModule.buildStatusMutation;
  const buildUpdate = opsModule.buildUpdateMutation;
  assert.equal(typeof buildStatus, "function");
  assert.equal(typeof buildUpdate, "function");
  if (typeof buildStatus !== "function" || typeof buildUpdate !== "function") return;

  assert.deepEqual(
    (buildStatus as (...args: unknown[]) => unknown)(
      { state: "found", reason: "Verified after operator review", reportId: "report-1", nextClue: "Case closed", nextClueAt: "2026-07-12T09:00", hoursOpen: "09:00", hoursClose: "20:00", confirmed: true },
      7,
    ),
    {
      state: "found",
      version: 7,
      confirmFound: true,
      reportId: "report-1",
      adjudicationReason: "Verified after operator review",
      nextClueTitle: "Case closed",
      nextClueAt: "2026-07-12T09:00",
      hoursOpen: "09:00",
      hoursClose: "20:00",
    },
  );
  assert.deepEqual(
    (buildUpdate as (...args: unknown[]) => unknown)({ title: "Update", body: "Details", publishAt: "2026-07-12T09:00" }),
    { title: "Update", body: "Details", scheduledFor: "2026-07-12T09:00" },
  );
});

test("subscriber payloads preserve separate consents and reject invalid rows", async () => {
  const opsModule = await import("../src/client/ops") as Record<string, unknown>;
  const normalize = opsModule.normalizeOpsSubscribers;
  assert.equal(typeof normalize, "function");
  if (typeof normalize !== "function") return;
  const ledger = (normalize as (payload: unknown) => Record<string, unknown>)({
    data: {
      counts: { verifiedAccounts: 12, completedProfiles: 8, huntEmail: 8, marketing: 3 },
      items: [
        {
          verifiedEmail: "hunter@example.test",
          id: "hunter-1",
          accountState: "active",
          profileComplete: true,
          fullName: "Example Hunter",
          publicHandle: "Hunter A1B2",
          townArea: "Parkland County",
          privacyMediaVersion: "2026.1",
          waiverStatus: "pending",
          waiverVersion: null,
          participationUnlocked: false,
          consents: { huntEmail: true, marketing: false },
          createdAt: "2026-07-11T18:00:00.000Z",
          updatedAt: "2026-07-11T18:05:00.000Z",
        },
        { fullName: "Missing verified email" },
      ],
    },
    page: { nextCursor: "cursor-2" },
  });
  assert.deepEqual(ledger.counts, { verifiedAccounts: 12, completedProfiles: 8, huntEmail: 8, marketing: 3 });
  assert.equal((ledger.items as unknown[]).length, 1);
  assert.equal((ledger.items as Array<Record<string, unknown>>)[0]?.publicHandle, "Hunter A1B2");
  assert.equal(ledger.nextCursor, "cursor-2");
});

test("subscriber CSV neutralizes spreadsheet formulas and quotes private values", async () => {
  const opsModule = await import("../src/client/ops") as Record<string, unknown>;
  const buildCsv = opsModule.buildSubscriberCsv;
  assert.equal(typeof buildCsv, "function");
  if (typeof buildCsv !== "function") return;
  const csv = (buildCsv as (items: unknown[]) => string)([{
    verifiedEmail: "=formula@example.test",
    id: "hunter-1",
    accountState: "active",
    profileComplete: true,
    fullName: 'Hunter "Quoted"',
    publicHandle: "+SUM(A1:A2)",
    townArea: "Parkland County",
    privacyMediaVersion: "2026.1",
    waiverStatus: "pending",
    waiverVersion: "",
    participationUnlocked: false,
    consents: { huntEmail: true, marketing: false },
    createdAt: "2026-07-11T18:00:00.000Z",
    updatedAt: "2026-07-11T18:05:00.000Z",
  }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=formula@example\.test"/);
  assert.match(csv, /"Hunter ""Quoted"""/);
  assert.match(csv, /"'\+SUM\(A1:A2\)"/);
  assert.match(csv, /"yes","2026\.1","pending","","no","yes","no"/);
});
