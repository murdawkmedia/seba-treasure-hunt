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
  appendDistinctModerationRecords,
  createReportReviewGuard,
  normalizeModeration,
  normalizeModerationReplies,
  normalizeContentFlags,
  normalizeOpsDashboard,
  normalizeOpsReportDetail,
  reportDestinationControls,
  reportReviewControls,
  reportPublicationConfirmationAfterInput,
  normalizeReports,
  normalizeOpsSponsors,
  normalizeOpsSubscribers,
  normalizeOpsWaiverDetail,
  renderOpsWaiverDetail,
  renderReportEvidence,
  renderReportUpdateUploads,
  renderModerationRows,
  renderModerationReplyRows,
  renderContentFlagRows,
  renderReportPrivateDetail,
  renderReportPublicationPreview,
  renderReportState,
  renderReportRows,
  renderSubscriberRows,
  renderSponsorRows,
  renderStaffRows,
  normalizeProductionSnapshotSummary,
  normalizeProductionSnapshotReports,
  renderProductionSnapshotReportRows,
  resolveOpsView,
  waiverReceiptRetryIntent,
} from "../src/client/ops";
import { nextReportStates } from "../src/shared/publication";

test("Case Note moderation renders truthful media states with publication selection off", () => {
  const records = normalizeModeration({ data: [{
    id: "note-1",
    createdAt: "2026-07-17T18:00:00.000Z",
    authorHandle: "Hunter A7F3",
    waypointId: 11,
    waypointRouteOrder: 11,
    waypointName: "The Driving Range & the Digger Café",
    body: "A photographed observation.",
    mediaCount: 3,
    media: [
      { id: "ready", status: "ready", contentType: "image/webp", size: 100794 },
      { id: "processing", status: "processing", contentType: "image/jpeg", size: 11000000 },
      { id: "rejected", status: "rejected", contentType: "image/jpeg", size: 2048 }
    ]
  }] });

  assert.equal(records[0]?.mediaCount, 3);
  const html = renderModerationRows(records);
  assert.match(html, /3 images/);
  assert.match(html, /data-note-media-preview="ready"/);
  assert.match(html, /name="publicMedia" value="ready"/);
  assert.doesNotMatch(html, /name="publicMedia" value="ready"[^>]*checked/);
  assert.match(html, /name="publicMedia" value="processing"[^>]*disabled/);
  assert.match(html, /name="publicMedia" value="rejected"[^>]*disabled/);
});

test("reply and flag moderation discard malformed rows and render distinct escaped actions", () => {
  const replies = normalizeModerationReplies({ data: [
    {
      id: "reply-1",
      noteId: "note-1",
      noteExcerpt: "Parent <note>",
      waypointRouteOrder: 4,
      waypointName: "The <Bridge>",
      body: "Reply <script>alert(1)</script>",
      authorHandle: "Hunter <A1B2>",
      status: "published",
      flagCount: 2,
      createdAt: "2026-07-17T18:00:00.000Z",
      moderatedAt: null,
    },
    { id: "reply-malformed", body: "Missing required moderation fields" },
    { id: "reply-fractional-flag-count", noteId: "note-1", noteExcerpt: "Parent", waypointRouteOrder: 4, waypointName: "Bridge", body: "Bad count", authorHandle: "Hunter", status: "published", flagCount: 1.5, createdAt: "2026-07-17T18:00:00.000Z", moderatedAt: null },
    { id: "reply-negative-flag-count", noteId: "note-1", noteExcerpt: "Parent", waypointRouteOrder: 4, waypointName: "Bridge", body: "Bad count", authorHandle: "Hunter", status: "published", flagCount: -1, createdAt: "2026-07-17T18:00:00.000Z", moderatedAt: null },
    { id: "reply-negative-route", noteId: "note-1", noteExcerpt: "Parent", waypointRouteOrder: -1, waypointName: "Bridge", body: "Bad route", authorHandle: "Hunter", status: "published", flagCount: 1, createdAt: "2026-07-17T18:00:00.000Z", moderatedAt: null },
    { id: "reply-fractional-route", noteId: "note-1", noteExcerpt: "Parent", waypointRouteOrder: 4.5, waypointName: "Bridge", body: "Bad route", authorHandle: "Hunter", status: "published", flagCount: 1, createdAt: "2026-07-17T18:00:00.000Z", moderatedAt: null },
  ] });
  const flags = normalizeContentFlags({ data: [
    {
      id: "flag-1",
      targetKind: "reply",
      targetId: "reply-1",
      targetExcerpt: "Reply <script>alert(1)</script>",
      authorHandle: "Hunter <A1B2>",
      targetStatus: "published",
      noteExcerpt: "Parent <note>",
      waypointRouteOrder: 4,
      waypointName: "The <Bridge>",
      reason: "harassment <img src=x>",
      status: "received",
      createdAt: "2026-07-17T18:01:00.000Z",
    },
    { id: "flag-note", targetKind: "note", targetId: "note-1" },
    { id: "flag-negative-route", targetKind: "reply", targetId: "reply-1", targetExcerpt: "Reply", authorHandle: "Hunter", targetStatus: "published", noteExcerpt: "Parent", waypointRouteOrder: -1, waypointName: "Bridge", reason: "unsafe", status: "received", createdAt: "2026-07-17T18:01:00.000Z" },
    { id: "flag-fractional-route", targetKind: "reply", targetId: "reply-1", targetExcerpt: "Reply", authorHandle: "Hunter", targetStatus: "published", noteExcerpt: "Parent", waypointRouteOrder: 4.5, waypointName: "Bridge", reason: "unsafe", status: "received", createdAt: "2026-07-17T18:01:00.000Z" },
  ] });

  assert.equal(replies.length, 1);
  assert.equal(flags.length, 1);

  const replyHtml = renderModerationReplyRows(replies);
  assert.match(replyHtml, /&lt;script&gt;/);
  assert.doesNotMatch(replyHtml, /<script>|<img/);
  assert.match(replyHtml, /data-reply-moderation-action="hide"/);
  assert.doesNotMatch(replyHtml, /data-reply-moderation-action="restore"/);
  assert.match(replyHtml, />Hide<\/button>/);

  const hiddenReplyHtml = renderModerationReplyRows([{ ...replies[0]!, status: "hidden" }]);
  assert.match(hiddenReplyHtml, /data-reply-moderation-action="restore"/);
  assert.doesNotMatch(hiddenReplyHtml, /data-reply-moderation-action="hide"/);
  assert.match(hiddenReplyHtml, />Restore<\/button>/);

  const flagHtml = renderContentFlagRows(flags);
  assert.match(flagHtml, /&lt;script&gt;/);
  assert.match(flagHtml, /&lt;img src=x&gt;/);
  assert.doesNotMatch(flagHtml, /<script>|<img/);
  assert.match(flagHtml, /data-flag-moderation-action="hide_target"/);
  assert.match(flagHtml, /data-flag-moderation-action="dismiss"/);
  assert.match(flagHtml, />Hide reply<\/button>/);
  assert.match(flagHtml, />Dismiss<\/button>/);
});

test("older moderation pages append only distinct records", () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `reply-${50 - index}` }));
  const secondPage = [{ id: "reply-1" }, { id: "reply-older" }, { id: "reply-older" }];
  const combined = appendDistinctModerationRecords(firstPage, secondPage);
  assert.equal(combined.length, 51);
  assert.equal(combined.at(-1)?.id, "reply-older");
  assert.equal(combined.filter((record) => record.id === "reply-1").length, 1);
});

test("production snapshot normalization and rows preserve private review data without mutation controls", () => {
  const summary = normalizeProductionSnapshotSummary({ data: {
    kind: "production-snapshot",
    status: "verified",
    snapshotId: "snapshot-20260716",
    verifiedAt: "2026-07-16T22:00:00.000Z",
    counts: { reports: 2, players: 5, staff: 4, audit: 20, media: 3 },
  } });
  assert.equal(summary?.counts.players, 5);

  const reports = normalizeProductionSnapshotReports({ data: [{
    id: "report-1",
    reportType: "tip",
    reporterName: "Private Hunter",
    reporterEmail: "hunter@example.test",
    waypointRouteOrder: 5,
    waypointName: "Derby's Lakeview General Store",
    status: "received",
    createdAt: "2026-07-16T21:00:00.000Z",
  }] });
  const html = renderProductionSnapshotReportRows(reports);
  assert.match(html, /hunter@example\.test/);
  assert.match(html, /Review snapshot report/);
  assert.doesNotMatch(html, /approve|publish|begin review|data-report-save/i);
  assert.equal(resolveOpsView("#production-snapshot"), "production-snapshot");
  assert.equal(resolveOpsView("#production-snapshot", false), "command");
  assert.equal(resolveOpsView("#production-snapshot", true), "production-snapshot");
});

const uncertainRetryConfirmation = "I checked the configured sender mailbox Sent Items or provider delivery log and still want to retry this uncertain receipt.";

test("report summaries preserve numeric waypoint identifiers and offer deliberate review", () => {
  const records = normalizeReports({ data: [{
    id: "report-1",
    type: "tip",
    waypointId: 4,
    waypointRouteOrder: 4,
    waypointName: "Seba Beach Seniors Centre",
    createdAt: "2026-07-15T20:00:00.000Z",
    status: "received",
    mediaCount: 2,
  }] });

  assert.equal(records[0]?.waypointId, "4");
  const html = renderReportRows(records);
  assert.match(html, /Stop 04 · Seniors Centre/);
  assert.match(html, /Review report/);
  assert.doesNotMatch(html, />Begin review</);
});

test("report review states expose only guided next steps and a persistent assignment summary", () => {
  assert.deepEqual(nextReportStates("received"), ["reviewing", "rejected"]);
  assert.deepEqual(nextReportStates("reviewing"), ["contacted", "escalated", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("verified"), ["resolved"]);
  assert.deepEqual(nextReportStates("resolved"), []);
  const html = renderReportState({ status: "reviewing", assignedTo: "staff-1" });
  assert.match(html, /Status: Reviewing/);
  assert.match(html, /Assigned to: staff-1/);
  assert.doesNotMatch(html, /Begin review/);
});

test("minor report publication preview exposes game facts but no private identity", () => {
  const detail = normalizeOpsReportDetail({ data: {
    id: "report-minor-1",
    type: "find",
    hunterSubject: "hunter-minor-private",
    name: "Alex Young",
    email: "alex@example.ca",
    phone: "780-555-0123",
    publicAttribution: "Young Hunter",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: false, updateId: null },
    waypointId: 4,
    waypointRouteOrder: 4,
    waypointName: "Seba Beach Seniors Centre",
    locationDescription: "Near the creek crossing.",
    latitude: 53.123,
    longitude: -114.456,
    details: "I found a possible clue beneath a fallen branch.",
    status: "reviewing",
    createdAt: "2026-07-15T20:00:00.000Z",
    updatedAt: "2026-07-15T20:05:00.000Z",
    media: [
      { id: "media-ready", contentType: "image/webp", size: 4096, status: "ready" },
      { id: "media-processing", contentType: "image/jpeg", size: 2048, status: "processing" },
    ],
  } });
  assert.ok(detail);

  const privateHtml = renderReportPrivateDetail(detail);
  assert.match(privateHtml, /alex@example\.ca/);
  assert.match(privateHtml, /780-555-0123/);

  const preview = renderReportPublicationPreview(detail, {
    title: "Possible creek clue",
    body: "Edited public story",
  });
  assert.match(preview, /Young Hunter/);
  assert.match(preview, /Stop 04 · Seniors Centre/);
  assert.match(preview, /53\.123/);
  assert.match(preview, /-114\.456/);
  assert.doesNotMatch(preview, /Alex Young|alex@example\.ca|780-555-0123|hunter-minor-private/);

  const evidence = renderReportEvidence(detail);
  assert.match(evidence, /media-ready/);
  assert.match(evidence, /Processing; unavailable for publication/);
  assert.doesNotMatch(evidence, /checked[^>]*name="publishMedia"|name="publishMedia"[^>]*checked/);
});

test("adult report preview uses only the stored public handle", () => {
  const detail = normalizeOpsReportDetail({ data: {
    id: "report-adult-1",
    type: "tip",
    hunterSubject: "hunter-adult-private",
    name: "Private Adult Name",
    email: "adult@example.ca",
    phone: null,
    publicAttribution: "Hunter A7F3",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: false, updateId: null },
    waypointId: null,
    waypointRouteOrder: null,
    waypointName: null,
    locationDescription: "Different spot",
    latitude: null,
    longitude: null,
    details: "A private report.",
    status: "received",
    createdAt: "2026-07-15T20:00:00.000Z",
    updatedAt: "2026-07-15T20:00:00.000Z",
    media: [],
  } });
  assert.ok(detail);
  const preview = renderReportPublicationPreview(detail, { title: "Public title", body: "Public body" });
  assert.match(preview, /Hunter A7F3/);
  assert.doesNotMatch(preview, /Private Adult Name|adult@example\.ca|hunter-adult-private/);
});

test("a signed-in report without a safe server attribution stays publication-ineligible", () => {
  const detail = normalizeOpsReportDetail({ data: {
    id: "report-ineligible-1",
    type: "tip",
    hunterSubject: "hunter-private",
    name: "Private Name",
    email: "private@example.ca",
    phone: null,
    publicAttribution: null,
    publicationEligible: false,
    publicationEligibilityReason: "current_legal_acceptance_required",
    publication: { published: false, updateId: null },
    waypointId: 2,
    waypointRouteOrder: 2,
    waypointName: "Waypoint Two",
    locationDescription: "Near the path",
    latitude: 53.1,
    longitude: -114.4,
    details: "Private details",
    status: "reviewing",
    createdAt: "2026-07-15T20:00:00.000Z",
    updatedAt: "2026-07-15T20:00:00.000Z",
    media: [],
  } });
  assert.ok(detail);
  assert.equal(detail.publicationEligible, false);
  assert.equal(detail.publicAttribution, null);
  const preview = renderReportPublicationPreview(detail, { title: "Preview", body: "Body" });
  assert.match(preview, /Not eligible for publication/);
  assert.doesNotMatch(preview, /Community Hunter/);
});

test("report review controls follow the actual linked public post, not private verified state", () => {
  const payload = {
    id: "report-publication-state",
    type: "tip",
    hunterSubject: "hunter-adult",
    name: "Private Reporter",
    email: "private@example.ca",
    phone: null,
    publicAttribution: "Hunter A7F3",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: true, updateId: "approved-report-1" },
    caseNote: { published: true, noteId: "reviewed-note-1", status: "published" },
    waypointId: 3,
    waypointRouteOrder: 3,
    waypointName: "Waypoint Three",
    locationDescription: "Near the public trail",
    latitude: 53.1,
    longitude: -114.4,
    details: "Private report details",
    status: "verified",
    createdAt: "2026-07-15T20:00:00.000Z",
    updatedAt: "2026-07-15T20:05:00.000Z",
    media: [],
  };
  const published = normalizeOpsReportDetail({ data: payload });
  assert.ok(published);
  assert.deepEqual(reportDestinationControls(published), {
    caseNotePublished: true,
    showPublishCaseNote: false,
    showWithdrawCaseNote: true,
    updatePublished: true,
  });
  assert.deepEqual(reportReviewControls(published), {
    showUnpublish: true,
    terminalTransitionsBlocked: true,
    guidance: "Unpublish first before rejecting or resolving this private report.",
  });

  const withdrawn = normalizeOpsReportDetail({
    data: {
      ...payload,
      publication: { published: false, updateId: null },
      caseNote: { published: false, noteId: null, status: null },
    },
  });
  assert.ok(withdrawn);
  assert.deepEqual(reportDestinationControls(withdrawn), {
    caseNotePublished: false,
    showPublishCaseNote: true,
    showWithdrawCaseNote: false,
    updatePublished: false,
  });
  assert.deepEqual(reportReviewControls(withdrawn), {
    showUnpublish: false,
    terminalTransitionsBlocked: false,
    guidance: "",
  });
});

test("direct Update uploads start unselected and require publication metadata", () => {
  const detail = normalizeOpsReportDetail({ data: {
    id: "report-update-media",
    type: "find",
    hunterSubject: null,
    name: "Private Reporter",
    email: "private@example.test",
    phone: null,
    publicAttribution: "Community Hunter",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: {
      published: false,
      updateId: "approved-report-update-media",
      status: "draft",
      scheduledFor: null,
      title: "Draft",
      body: "Draft body",
      mediaIds: [],
      uploads: [{
        id: "update-upload-1",
        contentType: "image/webp",
        size: 100794,
        status: "ready",
        altText: null,
        caption: null,
        position: null,
      }],
    },
    waypointId: null,
    waypointRouteOrder: null,
    waypointName: null,
    locationDescription: "Different spot",
    latitude: null,
    longitude: null,
    details: "Private details",
    status: "verified",
    createdAt: "2026-07-17T18:00:00.000Z",
    updatedAt: "2026-07-17T18:00:00.000Z",
    media: [],
  } });
  assert.ok(detail);
  const html = renderReportUpdateUploads(detail);
  assert.match(html, /name="publishMedia" value="update-upload-1"/);
  assert.doesNotMatch(html, /name="publishMedia"[^>]*checked/);
  assert.match(html, /name="mediaAltText-update-upload-1"[^>]*required/);
  assert.match(html, /name="mediaCaption-update-upload-1"/);
});

test("Official Update draft state stays distinct from a live scheduled publication", () => {
  const base = {
    id: "report-update-state",
    type: "tip",
    hunterSubject: null,
    name: "Private Reporter",
    email: "private@example.ca",
    phone: null,
    publicAttribution: "Community Hunter",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    caseNote: { published: false, noteId: null, status: null },
    waypointId: null,
    waypointRouteOrder: null,
    waypointName: null,
    locationDescription: "Public trail",
    latitude: null,
    longitude: null,
    details: "Private report details",
    status: "verified",
    createdAt: "2026-07-17T18:00:00.000Z",
    updatedAt: "2026-07-17T18:05:00.000Z",
    media: [],
  };
  const draft = normalizeOpsReportDetail({ data: {
    ...base,
    publication: {
      published: false,
      updateId: "approved-report:draft",
      status: "draft",
      scheduledFor: null,
    },
  } });
  assert.equal(draft?.publication.status, "draft");
  assert.equal(reportReviewControls(draft!).terminalTransitionsBlocked, false);

  const dueSchedule = normalizeOpsReportDetail({ data: {
    ...base,
    publication: {
      published: true,
      updateId: "approved-report:scheduled",
      status: "scheduled",
      scheduledFor: "2026-07-17T19:00:00.000Z",
    },
  } });
  assert.equal(dueSchedule?.publication.status, "scheduled");
  assert.equal(reportReviewControls(dueSchedule!).terminalTransitionsBlocked, true);
});

test("a deferred report open or mutation cannot replace or act on a newer dialog", async () => {
  const guard = createReportReviewGuard();
  let resolveA!: (value: string) => void;
  const deferredA = new Promise<string>((resolve) => { resolveA = resolve; });
  let rendered: string | null = null;
  const intentA = guard.begin("report-a");
  const openA = deferredA.then((value) => {
    if (guard.isCurrent(intentA)) rendered = value;
  });

  guard.close();
  const intentB = guard.begin("report-b");
  resolveA("report-a");
  await openA;
  assert.equal(rendered, null);
  assert.equal(guard.isCurrent(intentB), true);

  let resolveMutation!: () => void;
  const deferredMutation = new Promise<void>((resolve) => { resolveMutation = resolve; });
  const mutationB = guard.capture();
  assert.ok(mutationB);
  const actedOn: string[] = [];
  const mutation = deferredMutation.then(() => {
    if (guard.isCurrent(mutationB)) actedOn.push(mutationB.reportId);
  });
  guard.close();
  const intentC = guard.begin("report-c");
  resolveMutation();
  await mutation;
  assert.deepEqual(actedOn, []);
  assert.equal(guard.isCurrent(intentC), true);
});

test("editing text or media invalidates an exact publication-preview confirmation", () => {
  assert.equal(reportPublicationConfirmationAfterInput(true, "title"), false);
  assert.equal(reportPublicationConfirmationAfterInput(true, "body"), false);
  assert.equal(reportPublicationConfirmationAfterInput(true, "publishMedia"), false);
  assert.equal(reportPublicationConfirmationAfterInput(true, "scheduledFor"), false);
  assert.equal(reportPublicationConfirmationAfterInput(true, "confirmPublication"), true);
});

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

test("waiver detail renders a guardian-permitted minor account without a birth year", () => {
  const detail = normalizeOpsWaiverDetail({ data: {
    id: "waiver-minor-1",
    subject: "hunter-minor-1",
    documentVersion: "2026.2",
    documentHash: "b".repeat(64),
    acceptedAt: "2026-07-15T18:05:00.000Z",
    referenceCode: "TLS-W-MIN12345",
    participants: [{
      role: "minor",
      participationBasis: "minor_guardian_permission",
      fullName: "Young <Hunter>",
      birthYear: null,
      guardianAttested: true,
    }],
    receipt: { jobId: "private-minor-job", status: "pending", attempts: 0, sentAt: null },
  } });
  assert.equal(detail?.participants.length, 1);
  const html = renderOpsWaiverDetail(detail!);
  assert.match(html, /Young &lt;Hunter&gt;/);
  assert.match(html, /minor account holder; guardian permission recorded/);
  assert.doesNotMatch(html, /birth year null|private-minor-job/);
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
        waypointRouteOrder: null,
        waypointName: null,
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
    waypointRouteOrder: 13,
    waypointName: "The Final Stop",
    body: "Observation from the last waypoint.",
    authorHandle: "Hunter C3D4",
    createdAt: "2026-07-11T18:00:00.000Z",
    media: [],
    replies: [],
  }] });
  assert.equal(notes[0]?.waypointId, "12");
  assert.equal(notes[0]?.waypointRouteOrder, 13);
  assert.equal(notes[0]?.waypointName, "The Final Stop");
});

test("board filters accept stable waypoint ID 13 and reject ID 14", async () => {
  const boardModule = await import("../src/client/board") as Record<string, unknown>;
  assert.equal(typeof boardModule.normalizeBoardWaypointFilter, "function");
  if (typeof boardModule.normalizeBoardWaypointFilter !== "function") return;
  assert.equal(boardModule.normalizeBoardWaypointFilter("13"), "13");
  assert.equal(boardModule.normalizeBoardWaypointFilter("14"), "all");
});

test("board and Ops use public route metadata without guessing from stable IDs", () => {
  const notes = normalizeBoardPayload({ data: [{
    id: "note-derby",
    waypointId: 13,
    waypointRouteOrder: 5,
    waypointName: "Derby's Lakeview General Store",
    body: "Observation at Derby's.",
    authorHandle: "Hunter D3B5",
    createdAt: "2026-07-15T20:00:00.000Z",
    media: [],
    replies: [],
    email: "must-not-become-a-name@example.test",
    exactUrl: "https://maps.google.com/?q=private-waypoint",
  }] });
  const board = renderBoardFeed({ kind: "ready", canReply: false, notes });
  assert.match(board, /Stop 05 · Derby&#039;s General Store/);
  assert.doesNotMatch(board, /must-not-become-a-name|private-waypoint/);

  const detail = normalizeOpsReportDetail({ data: {
    id: "report-derby",
    type: "tip",
    hunterSubject: "hunter-private",
    name: "Private Reporter",
    email: "private@example.test",
    phone: null,
    publicAttribution: "Hunter D3B5",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: false, updateId: null },
    waypointId: 13,
    waypointRouteOrder: 5,
    waypointName: "Derby's Lakeview General Store",
    locationDescription: "Near the storefront.",
    latitude: null,
    longitude: null,
    details: "Private details.",
    status: "reviewing",
    createdAt: "2026-07-15T20:00:00.000Z",
    updatedAt: "2026-07-15T20:00:00.000Z",
    media: [],
  } });
  assert.ok(detail);
  const preview = renderReportPublicationPreview(detail, { title: "Derby's report", body: "Edited public story" });
  assert.match(preview, /Stop 05 · Derby&#039;s General Store/);
  assert.doesNotMatch(preview, /Private Reporter|private@example\.test/);
});

test("board renderer escapes community content and preserves the disclaimer", () => {
  const html = renderBoardFeed({
    kind: "ready",
    canReply: true,
    notes: [{
      id: "note-1",
      waypointId: "1",
      waypointRouteOrder: 1,
      waypointName: "The First Stop",
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
