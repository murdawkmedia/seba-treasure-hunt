import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { participationWaiverDocument } from "../src/server/legal-documents";
import {
  FakeIdentity,
  FakeEnvironment,
  FakeLegalReceiptSender,
  FakeOperatorAlertSender,
  FakeRateLimits,
  FakeStaffAccounts,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  grantFakeCurrentPlayerAccess,
  json,
  responseJson
} from "./api-test-kit";

const makeApp = (store = new FakeStore()) => {
  const staffAccounts = new FakeStaffAccounts();
  const rateLimits = new FakeRateLimits();
  const waiverReceipts = new FakeLegalReceiptSender();
  const operatorAlerts = new FakeOperatorAlertSender();
  const uploads = new FakeUploads();
  return {
    app: createApi({
      store,
      identity: new FakeIdentity(),
      turnstile: new FakeTurnstile(),
      uploads,
      staffAccounts,
      playerAccounts: staffAccounts,
      rateLimits,
      waiverReceipts,
      operatorAlerts,
      environment: new FakeEnvironment()
    }),
    store,
    staffAccounts,
    rateLimits,
    waiverReceipts,
    operatorAlerts,
    uploads
  };
};

const hunterHeaders = {
  authorization: "Bearer hunter-token",
  origin: "https://www.timlostsomething.com",
  "cf-turnstile-response": "human-token"
};

test("keeps exact waypoint directions behind hunter auth and fail-closed safety state", async () => {
  const { app, store } = makeApp();

  const anonymous = await app.request(
    "https://www.timlostsomething.com/api/v1/member/waypoints/1"
  );
  assert.equal(anonymous.status, 401);

  const incomplete = await app.request(
    "https://www.timlostsomething.com/api/v1/member/waypoints/1",
    { headers: hunterHeaders }
  );
  assert.equal(incomplete.status, 409);
  assert.equal((await responseJson(incomplete)).error.code, "profile_required");

  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    email: "hunter@example.test",
    publicHandle: "Hunter A7F3"
  });
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.legalEvents.push({ subject: "hunter-1", documentType: "privacy_media" });
  store.waiverStatus = "accepted";
  store.participationUnlocked = true;

  const allowed = await app.request(
    "https://www.timlostsomething.com/api/v1/member/waypoints/1",
    { headers: hunterHeaders }
  );
  assert.equal(allowed.status, 200);
  assert.equal((await responseJson(allowed)).data.exactUrl, "https://maps.example.test/private");

  store.status = { ...store.status!, state: "paused" } as typeof store.status;
  const paused = await app.request(
    "https://www.timlostsomething.com/api/v1/member/waypoints/1",
    { headers: hunterHeaders }
  );
  assert.equal(paused.status, 423);
  assert.equal((await responseJson(paused)).error.code, "exact_directions_unavailable");

  store.status = { ...store.status!, state: "open" } as typeof store.status;
  store.waypoints[0]!.zoneState = "restricted";
  const restricted = await app.request(
    "https://www.timlostsomething.com/api/v1/member/waypoints/1",
    { headers: hunterHeaders }
  );
  assert.equal(restricted.status, 423);

  const luckyThirteen = await app.request(
    "https://www.timlostsomething.com/api/v1/progress/13",
    { method: "PUT", ...json({ state: "visited" }, hunterHeaders) }
  );
  assert.equal(luckyThirteen.status, 200);
  assert.equal((await responseJson(luckyThirteen)).data.waypointId, 13);

  const outOfRange = await app.request(
    "https://www.timlostsomething.com/api/v1/progress/14",
    { method: "PUT", ...json({ state: "visited" }, hunterHeaders) }
  );
  assert.equal(outOfRange.status, 422);
  assert.equal((await responseJson(outOfRange)).error.message, "Waypoint must be a number from 1 to 13.");
});

test("updates a hunter profile after legal acceptance and gates progress on the waiver", async () => {
  const { app, store, rateLimits } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const profile = {
    fullName: "A Hunter",
    townArea: "Seba Beach",
    interests: ["treasure-hunt"],
    discoverySource: "friend",
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: true,
    privacyMediaAccepted: true,
    privacyMediaVersion: "2026.3",
    consents: { huntEmail: true, marketing: false }
  };

  const response = await app.request(
    "https://www.timlostsomething.com/api/v1/me/profile",
    { method: "PATCH", ...json(profile, hunterHeaders) }
  );
  assert.equal(response.status, 200);
  const profileResponse = await responseJson(response);
  assert.equal(profileResponse.data.subject, "hunter-1");
  assert.equal(profileResponse.data.participationBasis, "minor_guardian_permission");
  assert.equal(profileResponse.data.guardianPermissionAttested, true);
  assert.deepEqual(profileResponse.data.consents, {
    huntEmail: true,
    marketing: false
  });
  assert.equal(store.profiles.size, 1);

  const missingPermission = await app.request(
    "https://www.timlostsomething.com/api/v1/me/profile",
    { method: "PATCH", ...json({ ...profile, guardianPermissionAttested: false }, hunterHeaders) }
  );
  assert.equal(missingPermission.status, 422);
  assert.equal((await responseJson(missingPermission)).error.code, "guardian_permission_required");

  const locked = await app.request(
    "https://www.timlostsomething.com/api/v1/progress/1",
    { method: "PUT", ...json({ state: "visited" }, hunterHeaders) }
  );
  assert.equal(locked.status, 423);
  assert.equal((await responseJson(locked)).error.code, "participation_waiver_required");

  store.waiverStatus = "accepted";
  store.participationUnlocked = true;

  const progress = await app.request(
    "https://www.timlostsomething.com/api/v1/progress/1",
    { method: "PUT", ...json({ state: "visited" }, hunterHeaders) }
  );
  assert.equal(progress.status, 200);
  assert.equal((await responseJson(progress)).data.state, "visited");
  const dashboard = await app.request("https://www.timlostsomething.com/api/v1/me/dashboard", {
    headers: hunterHeaders
  });
  assert.deepEqual((await responseJson(dashboard)).data.profile.consents, {
    huntEmail: true,
    marketing: false
  });
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), ["profile", "profile", "progress", "progress"]);
});

test("pre-moderates field notes, constrains replies, and accepts private abuse flags", async () => {
  const { app, store, rateLimits, operatorAlerts } = makeApp();
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    email: "hunter@example.test",
    publicHandle: "Hunter A7F3"
  });
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.legalEvents.push({ subject: "hunter-1", documentType: "privacy_media" });
  store.waiverStatus = "accepted";
  store.participationUnlocked = true;

  const note = await app.request(
    "https://www.timlostsomething.com/api/v1/board/notes",
    {
      method: "POST",
      ...json(
        { waypointId: 1, body: "Fresh boot prints beside the trail." },
        { ...hunterHeaders, "idempotency-key": "field-note-key-1234" }
      )
    }
  );
  assert.equal(note.status, 201);
  const noteData = (await responseJson(note)).data;
  assert.equal(noteData.status, "pending");
  assert.equal("operatorAlertJobId" in noteData, false);
  assert.deepEqual(operatorAlerts.calls, ["operator-note-job-1"]);

  const replay = await app.request(
    "https://www.timlostsomething.com/api/v1/board/notes",
    {
      method: "POST",
      ...json(
        { waypointId: 1, body: "Fresh boot prints beside the trail." },
        { ...hunterHeaders, "idempotency-key": "field-note-key-1234" }
      )
    }
  );
  assert.equal(replay.status, 200);
  assert.equal((await responseJson(replay)).data.id, noteData.id);
  assert.equal(store.notes.length, 1);
  assert.deepEqual(operatorAlerts.calls, ["operator-note-job-1"]);
  store.notes[0]!.status = "approved";
  store.board.push({
    ...store.notes[0],
    authorSubject: "hunter-1",
    status: "approved",
    publishedAt: "2026-07-17T18:00:00.000Z",
    replies: []
  });

  const unsafeReply = await app.request(
    `https://www.timlostsomething.com/api/v1/board/notes/${noteData.id}/replies`,
    { method: "POST", ...json({ body: "Email me at bad@example.test" }, hunterHeaders) }
  );
  assert.equal(unsafeReply.status, 422);
  assert.equal((await responseJson(unsafeReply)).error.code, "unsafe_reply");

  const reply = await app.request(
    `https://www.timlostsomething.com/api/v1/board/notes/${noteData.id}/replies`,
    { method: "POST", ...json({ body: "I saw the same prints this morning." }, hunterHeaders) }
  );
  assert.equal(reply.status, 201);
  assert.equal((await responseJson(reply)).data.status, "published");

  const flag = await app.request(
    `https://www.timlostsomething.com/api/v1/board/reply/${store.replies[0]!.id}/flags`,
    { method: "POST", ...json({ reason: "unsafe", details: "This could direct hunters off trail." }, hunterHeaders) }
  );
  assert.equal(flag.status, 201);
  assert.equal((await responseJson(flag)).data.status, "received");
  assert.equal(store.flags.length, 1);
  store.replies[0]!.status = "hidden";
  const hiddenReplyFlag = await app.request(
    `https://www.timlostsomething.com/api/v1/board/reply/${store.replies[0]!.id}/flags`,
    { method: "POST", ...json({ reason: "unsafe" }, hunterHeaders) }
  );
  assert.equal(hiddenReplyFlag.status, 404);
  assert.equal((await responseJson(hiddenReplyFlag)).error.code, "content_not_found");
  assert.equal(store.flags.length, 1);
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), [
    "field_note",
    "field_note",
    "reply",
    "reply",
    "flag",
    "flag"
  ]);
});

test("separates staff identity from hunter identity and repeats authorization in D1", async () => {
  const { app, store } = makeApp();

  const hunter = await app.request("https://www.timlostsomething.com/api/v1/ops/session", {
    headers: hunterHeaders
  });
  assert.equal(hunter.status, 401);

  store.staff.clear();
  const removedStaff = await app.request("https://www.timlostsomething.com/api/v1/ops/session", {
    headers: { authorization: "Bearer staff-token" }
  });
  assert.equal(removedStaff.status, 403);

  store.staff.add("staff-1");
  const staff = await app.request("https://www.timlostsomething.com/api/v1/ops/session", {
    headers: { authorization: "Bearer staff-token" }
  });
  assert.equal(staff.status, 200);
  assert.equal((await responseJson(staff)).data.subject, "staff-1");
});

test("lists reply and flag moderation queues only for active staff", async () => {
  const { app, store } = makeApp();
  store.board.push({
    id: "note-moderation-1",
    status: "approved",
    waypointId: 1,
    body: "A public Case Note.",
    replies: [
      { id: "reply-moderation-1", body: "A public reply." },
      { id: "reply-moderation-2", body: "An older public reply." }
    ]
  });
  store.profiles.set("hunter-moderation-1", {
    subject: "hunter-moderation-1",
    publicHandle: "Hunter A7F3"
  });
  store.replies.push({
    id: "reply-moderation-1",
    noteId: "note-moderation-1",
    authorSubject: "hunter-moderation-1",
    body: "A public reply.",
    status: "published",
    createdAt: "2026-07-17T18:00:00.000Z"
  });
  store.replies.push({
    id: "reply-moderation-2",
    noteId: "note-moderation-1",
    authorSubject: "hunter-moderation-1",
    body: "An older public reply.",
    status: "published",
    createdAt: "2026-07-17T17:59:00.000Z"
  });
  store.flags.push({
    id: "flag-moderation-1",
    targetKind: "reply",
    targetId: "reply-moderation-1",
    reason: "unsafe",
    status: "received",
    createdAt: "2026-07-17T18:01:00.000Z"
  });
  store.flags.push({
    id: "flag-moderation-2",
    targetKind: "reply",
    targetId: "reply-moderation-2",
    reason: "unsafe",
    status: "received",
    createdAt: "2026-07-17T18:00:00.000Z"
  });

  for (const path of ["replies", "flags"]) {
    const anonymous = await app.request(`https://www.timlostsomething.com/api/v1/ops/moderation/${path}`);
    assert.equal(anonymous.status, 401);

    const hunter = await app.request(`https://www.timlostsomething.com/api/v1/ops/moderation/${path}`, {
      headers: hunterHeaders
    });
    assert.equal(hunter.status, 401);

    const staff = await app.request(`https://www.timlostsomething.com/api/v1/ops/moderation/${path}`, {
      headers: { authorization: "Bearer staff-token" }
    });
    const body = await responseJson(staff);
    assert.equal(staff.status, 200);
    assert.equal(staff.headers.get("cache-control"), "no-store");
    assert.equal(body.data[0].id, `${path === "replies" ? "reply" : "flag"}-moderation-1`);
    assert.deepEqual(body.page, { nextCursor: null });

    const firstPage = await app.request(
      `https://www.timlostsomething.com/api/v1/ops/moderation/${path}?limit=1`,
      { headers: { authorization: "Bearer staff-token" } }
    );
    const firstPageBody = await responseJson(firstPage);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPageBody.data.length, 1);
    assert.equal(firstPageBody.data[0].id, `${path === "replies" ? "reply" : "flag"}-moderation-1`);
    assert.equal(typeof firstPageBody.page.nextCursor, "string");

    const secondPage = await app.request(
      `https://www.timlostsomething.com/api/v1/ops/moderation/${path}?limit=1&cursor=${encodeURIComponent(firstPageBody.page.nextCursor)}`,
      { headers: { authorization: "Bearer staff-token" } }
    );
    const secondPageBody = await responseJson(secondPage);
    assert.equal(secondPage.status, 200);
    assert.equal(secondPageBody.data.length, 1);
    assert.equal(secondPageBody.data[0].id, `${path === "replies" ? "reply" : "flag"}-moderation-2`);
    assert.equal(secondPageBody.page.nextCursor, null);
  }
});

test("lets active staff hide a public reply through the private moderation API", async () => {
  const { app, store } = makeApp();
  store.board.push({
    id: "note-reply-hide-1",
    status: "approved",
    waypointId: 1,
    body: "A public Case Note.",
    replies: [{ id: "reply-hide-1", body: "Remove this reply." }]
  });
  store.profiles.set("hunter-reply-hide-1", {
    subject: "hunter-reply-hide-1",
    publicHandle: "Hunter B4D2"
  });
  store.replies.push({
    id: "reply-hide-1",
    noteId: "note-reply-hide-1",
    authorSubject: "hunter-reply-hide-1",
    body: "Remove this reply.",
    status: "published",
    createdAt: "2026-07-17T18:00:00.000Z"
  });

  const hidden = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/replies/reply-hide-1",
    {
      method: "POST",
      ...json(
        { action: "hide", reason: "Automated spam" },
        { authorization: "Bearer staff-token", origin: "https://www.timlostsomething.com" }
      )
    }
  );
  assert.equal(hidden.status, 200);
  assert.equal(hidden.headers.get("cache-control"), "no-store");
  assert.equal((await responseJson(hidden)).data.status, "hidden");

  const board = await app.request("https://www.timlostsomething.com/api/v1/board");
  assert.deepEqual((await responseJson(board)).data[0].replies, []);
});

test("lets active staff dismiss a flag without hiding its public reply", async () => {
  const { app, store } = makeApp();
  store.board.push({
    id: "note-flag-dismiss-1",
    status: "approved",
    waypointId: 1,
    body: "A public Case Note.",
    replies: [{ id: "reply-flag-dismiss-1", body: "Keep this reply." }]
  });
  store.profiles.set("hunter-flag-dismiss-1", {
    subject: "hunter-flag-dismiss-1",
    publicHandle: "Hunter C3A9"
  });
  store.replies.push({
    id: "reply-flag-dismiss-1",
    noteId: "note-flag-dismiss-1",
    authorSubject: "hunter-flag-dismiss-1",
    body: "Keep this reply.",
    status: "published",
    createdAt: "2026-07-17T18:00:00.000Z"
  });
  store.flags.push({
    id: "flag-dismiss-1",
    targetKind: "reply",
    targetId: "reply-flag-dismiss-1",
    reason: "unsafe",
    status: "received",
    createdAt: "2026-07-17T18:01:00.000Z"
  });

  const dismissed = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/flags/flag-dismiss-1",
    {
      method: "POST",
      ...json(
        { action: "dismiss", reason: "The reply is within the guidelines." },
        { authorization: "Bearer staff-token", origin: "https://www.timlostsomething.com" }
      )
    }
  );
  assert.equal(dismissed.status, 200);
  assert.equal((await responseJson(dismissed)).data.status, "dismissed");

  const board = await app.request("https://www.timlostsomething.com/api/v1/board");
  assert.equal((await responseJson(board)).data[0].replies[0].id, "reply-flag-dismiss-1");
});

test("moderates publicly accepted flags for operator-reviewed Case Notes end to end", async () => {
  const { app, store } = makeApp();
  store.reports.push({
    id: "report-operator-note-flag",
    status: "reviewing",
    publicAttribution: "Community Hunter",
    waypointId: 1,
    reporterEmail: "private@example.test",
    details: "Private report details.",
    media: []
  });
  const note = await store.publishReportToCaseNotes(
    "report-operator-note-flag",
    { body: "A reviewed public observation.", mediaIds: [] },
    "staff-publisher"
  );
  const noteId = String(note?.id);

  const createFlag = (reason: string, details?: string, targetId = noteId) => app.request(
    `https://www.timlostsomething.com/api/v1/board/note/${encodeURIComponent(targetId)}/flags`,
    {
      method: "POST",
      ...json({ reason, details, turnstileToken: "human-token" }, hunterHeaders)
    }
  );
  const missingFlag = await createFlag("privacy", undefined, "not-a-public-note");
  assert.equal(missingFlag.status, 404);
  const missingFlagError = (await responseJson(missingFlag)).error;
  assert.equal(missingFlagError.code, "content_not_found");
  assert.equal(missingFlagError.message, "Community content not found.");
  assert.equal(store.flags.length, 0);

  store.reports.push({
    id: "report-withdrawn-operator-note",
    status: "reviewing",
    publicAttribution: "Community Hunter",
    media: []
  });
  const withdrawnNote = await store.publishReportToCaseNotes(
    "report-withdrawn-operator-note",
    { body: "A withdrawn reviewed observation.", mediaIds: [] },
    "staff-publisher"
  );
  await store.withdrawReportCaseNote("report-withdrawn-operator-note", "staff-publisher");
  const withdrawnFlag = await createFlag("privacy", undefined, String(withdrawnNote?.id));
  assert.equal(withdrawnFlag.status, 404);
  const withdrawnFlagError = (await responseJson(withdrawnFlag)).error;
  assert.equal(withdrawnFlagError.code, "content_not_found");
  assert.equal(withdrawnFlagError.message, "Community content not found.");
  assert.equal(store.flags.length, 0);

  const firstFlag = await createFlag("privacy", "Private reporter context.");
  assert.equal(firstFlag.status, 201);
  const firstFlagBody = await responseJson(firstFlag);

  const dashboard = await app.request("https://www.timlostsomething.com/api/v1/ops/dashboard", {
    headers: { authorization: "Bearer staff-token" }
  });
  assert.equal((await responseJson(dashboard)).data.counts.receivedFlags, 1);
  const queue = await app.request("https://www.timlostsomething.com/api/v1/ops/moderation/flags", {
    headers: { authorization: "Bearer staff-token" }
  });
  const queueBody = await responseJson(queue);
  assert.deepEqual(queueBody.data.map((item: { id: string }) => item.id), [firstFlagBody.data.id]);
  assert.equal(queueBody.data[0].targetKind, "note");
  assert.equal(queueBody.data[0].targetId, noteId);
  assert.equal(queueBody.data[0].authorHandle, "Community Hunter");
  assert.equal(queueBody.data[0].targetExcerpt, "A reviewed public observation.");
  assert.doesNotMatch(
    JSON.stringify(queueBody),
    /private@example\.test|Private report details|Private reporter context|hunter-1/
  );

  const staffHeaders = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };
  const dismissed = await app.request(
    `https://www.timlostsomething.com/api/v1/ops/moderation/flags/${encodeURIComponent(firstFlagBody.data.id)}`,
    {
      method: "POST",
      ...json({ action: "dismiss", reason: "The note is within the guidelines." }, staffHeaders)
    }
  );
  assert.equal(dismissed.status, 200);
  assert.equal((await responseJson(dismissed)).data.status, "dismissed");
  assert.equal((await responseJson(await app.request("https://www.timlostsomething.com/api/v1/board"))).data[0].id, noteId);

  const hideFlag = await responseJson(await createFlag("privacy"));
  const siblingFlag = await responseJson(await createFlag("unsafe"));
  const expectedPageOrder = [hideFlag.data.id, siblingFlag.data.id].sort().reverse();
  const firstPage = await responseJson(await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/flags?limit=1",
    { headers: { authorization: "Bearer staff-token" } }
  ));
  assert.equal(firstPage.data[0].id, expectedPageOrder[0]);
  assert.equal(typeof firstPage.page.nextCursor, "string");
  const secondPage = await responseJson(await app.request(
    `https://www.timlostsomething.com/api/v1/ops/moderation/flags?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`,
    { headers: { authorization: "Bearer staff-token" } }
  ));
  assert.equal(secondPage.data[0].id, expectedPageOrder[1]);
  assert.equal(secondPage.page.nextCursor, null);
  const hidden = await app.request(
    `https://www.timlostsomething.com/api/v1/ops/moderation/flags/${encodeURIComponent(hideFlag.data.id)}`,
    {
      method: "POST",
      ...json({ action: "hide_target", reason: "The note discloses private information." }, staffHeaders)
    }
  );
  assert.equal(hidden.status, 200);
  assert.equal((await responseJson(hidden)).data.status, "resolved");
  assert.deepEqual(
    [hideFlag.data.id, siblingFlag.data.id].map(
      (id) => store.flags.find((flag) => flag.id === id)?.status
    ),
    ["resolved", "resolved"]
  );
  assert.deepEqual(
    (await responseJson(await app.request("https://www.timlostsomething.com/api/v1/board"))).data,
    []
  );
  assert.equal(
    store.audits.filter((audit) => audit.action === "content_flag.target_hidden" && audit.targetId === hideFlag.data.id).length,
    1
  );
  const hiddenFlagCount = store.flags.length;
  const hiddenTargetFlag = await createFlag("privacy");
  assert.equal(hiddenTargetFlag.status, 404);
  const hiddenTargetFlagError = (await responseJson(hiddenTargetFlag)).error;
  assert.equal(hiddenTargetFlagError.code, "content_not_found");
  assert.equal(hiddenTargetFlagError.message, "Community content not found.");
  assert.equal(store.flags.length, hiddenFlagCount);
  const unsupportedRestore = await app.request(
    `https://www.timlostsomething.com/api/v1/ops/moderation/flags/${encodeURIComponent(hideFlag.data.id)}`,
    {
      method: "POST",
      ...json({ action: "restore_target", reason: "No restore action is part of this API." }, staffHeaders)
    }
  );
  assert.equal(unsupportedRestore.status, 422);
  assert.equal((await responseJson(unsupportedRestore)).error.code, "validation_failed");
});

test("validates staff reply and flag moderation mutations and resolves target hides", async () => {
  const { app, store } = makeApp();
  store.board.push({
    id: "note-mutation-contract-1",
    status: "approved",
    waypointId: 1,
    body: "A public Case Note.",
    replies: [{ id: "reply-mutation-contract-1", body: "Moderate this reply." }]
  });
  store.profiles.set("hunter-mutation-contract-1", {
    subject: "hunter-mutation-contract-1",
    publicHandle: "Hunter D8E6"
  });
  store.replies.push({
    id: "reply-mutation-contract-1",
    noteId: "note-mutation-contract-1",
    authorSubject: "hunter-mutation-contract-1",
    body: "Moderate this reply.",
    status: "published",
    createdAt: "2026-07-17T18:00:00.000Z"
  });
  store.flags.push({
    id: "flag-mutation-contract-1",
    targetKind: "reply",
    targetId: "reply-mutation-contract-1",
    reason: "unsafe",
    status: "received",
    createdAt: "2026-07-17T18:01:00.000Z"
  });
  const staffHeaders = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };
  const replyPath = "https://www.timlostsomething.com/api/v1/ops/moderation/replies/reply-mutation-contract-1";
  const flagPath = "https://www.timlostsomething.com/api/v1/ops/moderation/flags/flag-mutation-contract-1";

  for (const [path, action] of [[replyPath, "hide"], [flagPath, "dismiss"]] as const) {
    for (const headers of [{ origin: staffHeaders.origin }, { ...hunterHeaders, origin: staffHeaders.origin }]) {
      const response = await app.request(path, {
        method: "POST",
        ...json({ action, reason: "A valid private moderation reason." }, headers)
      });
      assert.equal(response.status, 401);
    }
  }

  const missingOrigin = await app.request(replyPath, {
    method: "POST",
    headers: { authorization: "Bearer staff-token", "content-type": "application/json" },
    body: JSON.stringify({ action: "hide", reason: "A valid private moderation reason." })
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await responseJson(missingOrigin)).error.code, "origin_rejected");

  const nonJson = await app.request(replyPath, {
    method: "POST",
    headers: { ...staffHeaders, "content-type": "text/plain" },
    body: JSON.stringify({ action: "hide", reason: "A valid private moderation reason." })
  });
  assert.equal(nonJson.status, 415);
  assert.equal((await responseJson(nonJson)).error.message, "Reply moderation accepts application/json only.");

  const flagNonJson = await app.request(flagPath, {
    method: "POST",
    headers: { ...staffHeaders, "content-type": "text/plain" },
    body: JSON.stringify({ action: "dismiss", reason: "A valid private moderation reason." })
  });
  assert.equal(flagNonJson.status, 415);
  assert.equal((await responseJson(flagNonJson)).error.message, "Flag moderation accepts application/json only.");

  const files = new FormData();
  files.set("images", new File(["not an image"], "proof.txt", { type: "text/plain" }));
  const multipart = await app.request(replyPath, {
    method: "POST",
    headers: staffHeaders,
    body: files
  });
  assert.equal(multipart.status, 415);

  for (const body of [
    { reason: "A valid private moderation reason." },
    { action: "remove", reason: "A valid private moderation reason." },
    { action: "hide", reason: "no" },
    { action: "hide", reason: "x".repeat(501) }
  ]) {
    const response = await app.request(replyPath, {
      method: "POST",
      ...json(body, staffHeaders)
    });
    assert.equal(response.status, 422);
    assert.equal((await responseJson(response)).error.code, "validation_failed");
  }

  const invalidFlagAction = await app.request(flagPath, {
    method: "POST",
    ...json({ action: "resolve", reason: "A valid private moderation reason." }, staffHeaders)
  });
  assert.equal(invalidFlagAction.status, 422);
  assert.equal((await responseJson(invalidFlagAction)).error.code, "validation_failed");

  const hidden = await app.request(replyPath, {
    method: "POST",
    ...json({ action: "hide", reason: "Automated spam" }, staffHeaders)
  });
  assert.equal(hidden.status, 200);

  const repeatedHide = await app.request(replyPath, {
    method: "POST",
    ...json({ action: "hide", reason: "Automated spam" }, staffHeaders)
  });
  assert.equal(repeatedHide.status, 409);
  assert.equal((await responseJson(repeatedHide)).error.code, "reply_state_conflict");

  const restored = await app.request(replyPath, {
    method: "POST",
    ...json({ action: "restore", reason: "False positive" }, staffHeaders)
  });
  assert.equal(restored.status, 200);
  const restoredBoard = await app.request("https://www.timlostsomething.com/api/v1/board");
  assert.equal((await responseJson(restoredBoard)).data[0].replies[0].id, "reply-mutation-contract-1");

  store.flags.push({
    id: "flag-hide-target-1",
    targetKind: "reply",
    targetId: "reply-mutation-contract-1",
    reason: "unsafe",
    status: "received",
    createdAt: "2026-07-17T18:02:00.000Z"
  });
  const hideTarget = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/flags/flag-hide-target-1",
    {
      method: "POST",
      ...json({ action: "hide_target", reason: "The target breaks the guidelines." }, staffHeaders)
    }
  );
  assert.equal(hideTarget.status, 200);
  assert.equal((await responseJson(hideTarget)).data.status, "resolved");
  assert.equal(store.flags.find((flag) => flag.id === "flag-hide-target-1")?.status, "resolved");
  const hiddenBoard = await app.request("https://www.timlostsomething.com/api/v1/board");
  assert.deepEqual((await responseJson(hiddenBoard)).data[0].replies, []);

  const repeatedFlag = await app.request(flagPath, {
    method: "POST",
    ...json({ action: "dismiss", reason: "Already resolved by target hide." }, staffHeaders)
  });
  assert.equal(repeatedFlag.status, 409);
  assert.equal((await responseJson(repeatedFlag)).error.code, "flag_state_conflict");
});

test("activates a verified staff subject only when its email was privately invited", async () => {
  const { app, store } = makeApp();
  store.staff.clear();
  store.invitedStaffEmails.add("operator@example.test");

  const activated = await app.request("https://www.timlostsomething.com/api/v1/ops/session", {
    headers: { authorization: "Bearer staff-token" }
  });

  assert.equal(activated.status, 200);
  assert.equal(store.staff.has("staff-1"), true);
  assert.equal(store.audits.at(-1)?.action, "staff.activated");

  store.staff.clear();
  const uninvited = await app.request("https://www.timlostsomething.com/api/v1/ops/session", {
    headers: { authorization: "Bearer staff-token" }
  });
  assert.equal(uninvited.status, 403);
});

test("requires deliberate FOUND confirmation and records an auditable reason", async () => {
  const { app, store } = makeApp();
  const headers = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };

  const rejected = await app.request("https://www.timlostsomething.com/api/v1/ops/status", {
    method: "PUT",
    ...json({ state: "found", version: 1, confirmFound: true }, headers)
  });
  assert.equal(rejected.status, 422);
  assert.equal((await responseJson(rejected)).error.code, "found_evidence_required");

  const accepted = await app.request("https://www.timlostsomething.com/api/v1/ops/status", {
    method: "PUT",
    ...json(
      {
        state: "found",
        version: 1,
        confirmFound: true,
        adjudicationReason: "The item was recovered and verified directly."
      },
      headers
    )
  });
  assert.equal(accepted.status, 200);
  assert.equal((await responseJson(accepted)).data.state, "found");
  assert.equal(store.audits.at(-1)?.action, "status.updated");
});

test("gives active staff a private dashboard, report queue, and moderation actions", async () => {
  const { app, store } = makeApp();
  store.reports.push({ id: "report-1", status: "received", type: "tip" });
  store.notes.push({
    id: "note-1",
    status: "pending",
    body: "A pending observation.",
    media: [
      {
        id: "note-media-ready",
        contentType: "image/webp",
        size: 4,
        status: "ready",
        derivativeObjectKey: "derivatives/media-ready.webp"
      },
      { id: "note-media-processing", contentType: "image/jpeg", size: 2048, status: "processing" }
    ]
  });
  store.notes.push({
    id: "note-2",
    status: "pending",
    body: "Another observation.",
    media: [{
      id: "note-media-other",
      contentType: "image/webp",
      size: 4,
      status: "ready",
      derivativeObjectKey: "derivatives/media-ready.webp"
    }]
  });
  const headers = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };

  const dashboard = await app.request("https://www.timlostsomething.com/api/v1/ops/dashboard", { headers });
  assert.equal(dashboard.status, 200);
  assert.equal((await responseJson(dashboard)).data.counts.pendingNotes, 2);

  const reports = await app.request("https://www.timlostsomething.com/api/v1/ops/reports", { headers });
  assert.equal((await responseJson(reports)).data[0].id, "report-1");

  const reportUpdate = await app.request("https://www.timlostsomething.com/api/v1/ops/reports/report-1", {
    method: "PATCH",
    ...json({ status: "reviewing", note: "Checking the supplied details." }, headers)
  });
  assert.equal((await responseJson(reportUpdate)).data.status, "reviewing");

  const pending = await app.request("https://www.timlostsomething.com/api/v1/ops/moderation/notes", { headers });
  const pendingData = (await responseJson(pending)).data;
  assert.equal(pendingData[0].id, "note-1");
  assert.equal(pendingData[0].mediaCount, 2);
  assert.deepEqual(pendingData[0].media.map((item: Record<string, unknown>) => item.status), ["ready", "processing"]);

  const anonymousMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/notes/note-1/media/note-media-ready"
  );
  assert.equal(anonymousMedia.status, 401);
  const crossNoteMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/notes/note-1/media/note-media-other",
    { headers }
  );
  assert.equal(crossNoteMedia.status, 404);
  const noteMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/notes/note-1/media/note-media-ready",
    { headers }
  );
  assert.equal(noteMedia.status, 200);
  assert.equal(noteMedia.headers.get("content-type"), "image/webp");
  assert.equal(noteMedia.headers.get("cache-control"), "private, no-store");

  const moderation = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/notes/note-1",
    { method: "POST", ...json({ decision: "approved" }, headers) }
  );
  assert.equal((await responseJson(moderation)).data.status, "approved");

  const audit = await app.request("https://www.timlostsomething.com/api/v1/ops/audit", { headers });
  assert.equal(audit.status, 200);
  assert.equal((await responseJson(audit)).data.at(-1).action, "note.moderated");
});

test("lets active staff inspect a private report and only its scoped derivative evidence", async () => {
  const { app, store } = makeApp();
  store.profiles.set("hunter-minor-detail", {
    subject: "hunter-minor-detail",
    publicHandle: "Minor Handle Must Never Leave The Server",
    participationBasis: "minor_guardian_permission"
  });
  await grantFakeCurrentPlayerAccess(store, "hunter-minor-detail");
  store.reports.push(
    {
      id: "report-1",
      type: "find",
      hunterSubject: "hunter-minor-detail",
      name: "Alex Hunter",
      email: "alex@example.ca",
      phone: "780-555-0123",
      waypointId: 4,
      locationDescription: "Near the creek crossing.",
      latitude: 53.123,
      longitude: -114.456,
      details: "I found a possible clue beneath a fallen branch.",
      status: "received",
      createdAt: "2026-07-15T20:00:00.000Z",
      updatedAt: "2026-07-15T20:00:00.000Z",
      media: [
        {
          id: "media-ready",
          privateObjectKey: "private/report-1/original.jpg",
          derivativeObjectKey: "derivatives/media-ready.webp",
          contentType: "image/webp",
          size: 4,
          status: "ready"
        }
      ]
    },
    {
      id: "report-2",
      type: "tip",
      email: "other@example.ca",
      status: "received",
      media: [
        {
          id: "media-other",
          derivativeObjectKey: "derivatives/media-other.webp",
          contentType: "image/webp",
          size: 4,
          status: "ready"
        }
      ]
    }
  );
  const staffHeaders = { authorization: "Bearer staff-token" };

  const anonymousDetail = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-1"
  );
  assert.equal(anonymousDetail.status, 401);

  const detailResponse = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-1",
    { headers: staffHeaders }
  );
  assert.equal(detailResponse.status, 200);
  const detail = (await responseJson(detailResponse)).data;
  assert.equal(detail.email, "alex@example.ca");
  assert.equal(detail.phone, "780-555-0123");
  assert.equal(detail.waypointId, 4);
  assert.equal(detail.locationDescription, "Near the creek crossing.");
  assert.equal(detail.details, "I found a possible clue beneath a fallen branch.");
  assert.equal(detail.latitude, 53.123);
  assert.equal(detail.longitude, -114.456);
  assert.equal(detail.publicAttribution, "Young Hunter");
  assert.equal(detail.publicationEligible, true);
  assert.equal(detail.publicationEligibilityReason, "eligible");
  assert.deepEqual(detail.media, [
    { id: "media-ready", contentType: "image/webp", size: 4, status: "ready" }
  ]);
  assert.doesNotMatch(JSON.stringify(detail), /Minor Handle Must Never Leave|participationBasis|privateObjectKey|derivativeObjectKey|private\/|originals\/|derivatives\//i);
  assert.deepEqual(store.audits.at(-1), {
    action: "report.detail.viewed",
    actorSubject: "staff-1",
    targetId: "report-1"
  });

  const anonymousMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-1/media/media-ready"
  );
  assert.equal(anonymousMedia.status, 401);

  const crossReportMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-1/media/media-other",
    { headers: staffHeaders }
  );
  assert.equal(crossReportMedia.status, 404);
  const crossReportBody = await responseJson(crossReportMedia);
  assert.equal(crossReportBody.error.code, "report_media_not_found");
  assert.doesNotMatch(JSON.stringify(crossReportBody), /report-2|media-other|derivatives\//i);

  const mediaResponse = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-1/media/media-ready",
    { headers: staffHeaders }
  );
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get("content-type"), "image/webp");
  assert.equal(mediaResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(mediaResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(mediaResponse.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(mediaResponse.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal((await mediaResponse.arrayBuffer()).byteLength, 4);
  assert.deepEqual(store.audits.at(-1), {
    action: "report.media.viewed",
    actorSubject: "staff-1",
    targetId: "report-1",
    mediaId: "media-ready"
  });
});

test("publishes and withdraws a report only through exact-origin Staff requests", async () => {
  const { app, store } = makeApp();
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    publicHandle: "Hunter A7F3",
    participationBasis: "adult"
  });
  await grantFakeCurrentPlayerAccess(store, "hunter-1");
  store.reports.push({
    id: "report-publish-1",
    hunterSubject: "hunter-1",
    waypointId: 1,
    latitude: 53.123,
    longitude: -114.456,
    status: "reviewing",
    publicAttribution: "Hunter A7F3",
    attributionKind: "hunter_handle",
    media: [
      {
        id: "media-publish-1",
        derivativeObjectKey: "derivatives/media-publish-1.webp",
        contentType: "image/webp",
        status: "ready"
      }
    ]
  });
  const endpoint = "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1/publish";
  const input = {
    title: "Possible clue near the creek",
    body: "Edited operator-approved story",
    mediaIds: ["media-publish-1"],
    action: "publish_now"
  };

  const anonymous = await app.request(endpoint, { method: "POST", ...json(input) });
  assert.equal(anonymous.status, 401);

  const crossOrigin = await app.request(endpoint, {
    method: "POST",
    ...json(input, {
      authorization: "Bearer staff-token",
      origin: "https://attacker.example"
    })
  });
  assert.equal(crossOrigin.status, 403);

  const unverified = await app.request(endpoint, {
    method: "POST",
    ...json(input, { authorization: "Bearer staff-token" })
  });
  assert.equal(unverified.status, 409);
  assert.equal((await responseJson(unverified)).error.code, "report_update_requires_verification");
  store.reports.find((report) => report.id === "report-publish-1")!.status = "verified";

  const published = await app.request(endpoint, {
    method: "POST",
    ...json(input, { authorization: "Bearer staff-token" })
  });
  assert.equal(published.status, 200);
  const publishedData = (await responseJson(published)).data;
  assert.equal(publishedData.kind, "approved_report");
  assert.equal(store.reports.find((report) => report.id === "report-publish-1")?.status, "verified");

  const publishedDetail = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1",
    { headers: { authorization: "Bearer staff-token" } }
  );
  assert.equal(publishedDetail.status, 200);
  assert.deepEqual((await responseJson(publishedDetail)).data.publication, {
    published: true,
    updateId: publishedData.id,
    status: "published",
    scheduledFor: null,
    title: "Possible clue near the creek",
    body: "Edited operator-approved story",
    mediaIds: ["media-publish-1"],
    uploads: []
  });

  const terminalWhilePublished = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1",
    {
      method: "PATCH",
      ...json({ status: "resolved" }, { authorization: "Bearer staff-token" })
    }
  );
  assert.equal(terminalWhilePublished.status, 409);
  assert.equal((await responseJson(terminalWhilePublished)).error.code, "report_publication_active");
  assert.equal(store.reports.find((report) => report.id === "report-publish-1")?.status, "verified");
  assert.equal(store.updates.some((update) => update.id === publishedData.id), true);

  const withdrawn = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1/unpublish",
    {
      method: "POST",
      ...json({}, { authorization: "Bearer staff-token" })
    }
  );
  assert.equal(withdrawn.status, 200);
  assert.equal((await responseJson(withdrawn)).data.status, "withdrawn");

  const withdrawnDetail = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1",
    { headers: { authorization: "Bearer staff-token" } }
  );
  assert.equal(withdrawnDetail.status, 200);
  assert.deepEqual((await responseJson(withdrawnDetail)).data.publication, {
    published: false,
    updateId: publishedData.id,
    status: "withdrawn",
    scheduledFor: null,
    title: "Possible clue near the creek",
    body: "Edited operator-approved story",
    mediaIds: [],
    uploads: []
  });

  const terminalAfterUnpublish = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-1",
    {
      method: "PATCH",
      ...json({ status: "resolved" }, { authorization: "Bearer staff-token" })
    }
  );
  assert.equal(terminalAfterUnpublish.status, 200);
  assert.equal(store.reports.find((report) => report.id === "report-publish-1")?.status, "resolved");
});

test("limits a hunter to five public replies per ten minutes", async () => {
  const { app, store, rateLimits } = makeApp();
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    email: "hunter@example.test",
    publicHandle: "Hunter A7F3"
  });
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.legalEvents.push({ subject: "hunter-1", documentType: "privacy_media" });
  store.waiverStatus = "accepted";
  store.participationUnlocked = true;

  const replies = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    app.request("https://www.timlostsomething.com/api/v1/board/notes/note-1/replies", {
      method: "POST",
      ...json({ body: `Bounded public reply ${index + 1}` }, {
        ...hunterHeaders,
        "cf-connecting-ip": "203.0.113.44"
      })
    })
  ));

  assert.deepEqual(replies.map((response) => response.status), [201, 201, 201, 201, 201, 429]);
  assert.equal(replies[5]?.headers.get("retry-after"), "600");
  assert.equal(store.replies.length, 5);
  assert.deepEqual(rateLimits.seen.at(0), {
    scope: "reply",
    identifiers: ["ip:203.0.113.44", "subject:hunter-1"],
    limit: 5,
    windowSeconds: 600
  });
});

test("publishes a reviewed report to Case Notes without creating an official Update", async () => {
  const { app, store } = makeApp();
  store.reports.push({
    id: "report-case-note-1",
    hunterSubject: null,
    publicAttribution: "Community Hunter",
    attributionKind: "community",
    waypointId: 11,
    latitude: 53.5,
    longitude: -114.5,
    status: "reviewing",
    media: [{
      id: "media-case-note-1",
      derivativeObjectKey: "derivatives/media-case-note-1.webp",
      contentType: "image/webp",
      status: "ready"
    }]
  });
  const endpoint = "https://www.timlostsomething.com/api/v1/ops/reports/report-case-note-1/case-note";
  const input = { body: "A routine finding reviewed by an operator.", mediaIds: ["media-case-note-1"] };
  assert.equal((await app.request(endpoint, { method: "POST", ...json(input) })).status, 401);
  const published = await app.request(endpoint, {
    method: "POST",
    ...json(input, { authorization: "Bearer staff-token" })
  });
  assert.equal(published.status, 200);
  const note = (await responseJson(published)).data;
  assert.equal(note.noteKind, "operator_reviewed");
  assert.equal(note.authorHandle, "Community Hunter");
  assert.equal(JSON.stringify(note).includes("report-case-note-1"), false);
  assert.equal(store.updates.some((item) => item.title === input.body), false);

  const replay = await app.request(endpoint, {
    method: "POST",
    ...json(input, { authorization: "Bearer staff-token" })
  });
  assert.equal((await responseJson(replay)).data.id, note.id);

  const withdrawn = await app.request(`${endpoint}/withdraw`, {
    method: "POST",
    ...json({}, { authorization: "Bearer staff-token" })
  });
  assert.equal(withdrawn.status, 200);
});

test("keeps report Update drafts and future schedules private until their due time", async () => {
  const { app, store } = makeApp();
  store.reports.push({ id: "report-draft-1", status: "verified", media: [] });
  const endpoint = "https://www.timlostsomething.com/api/v1/ops/reports/report-draft-1/publish";
  const headers = { authorization: "Bearer staff-token" };
  const base = { title: "Draft finding", body: "Reviewed story", mediaIds: [] };

  const draft = await app.request(endpoint, {
    method: "POST",
    ...json({ ...base, action: "save_draft" }, headers)
  });
  assert.equal(draft.status, 200);
  assert.equal((await responseJson(draft)).data.status, "draft");
  assert.equal(store.updates[0]?.status, "draft");

  const schedule = await app.request(endpoint, {
    method: "POST",
    ...json({
      ...base,
      action: "schedule",
      scheduledFor: "2099-07-17T19:00:00.000Z"
    }, headers)
  });
  assert.equal(schedule.status, 200);
  assert.equal((await responseJson(schedule)).data.status, "scheduled");
  assert.equal(store.updates.filter((item) => item.id === store.updates[0]?.id).length, 1);
});

test("stores direct Official Update uploads privately only after a draft exists", async () => {
  const { app, store, uploads } = makeApp();
  store.reports.push({ id: "report-update-upload", status: "verified", media: [] });
  const base = "https://www.timlostsomething.com/api/v1/ops/reports/report-update-upload";
  const staffHeaders = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };
  const beforeDraft = new FormData();
  beforeDraft.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff])], "before.jpg", { type: "image/jpeg" }));
  const blocked = await app.request(`${base}/update-media`, {
    method: "POST",
    headers: staffHeaders,
    body: beforeDraft
  });
  assert.equal(blocked.status, 409);
  assert.equal(uploads.saved.length, 0);

  const draft = await app.request(`${base}/publish`, {
    method: "POST",
    ...json(
      { title: "Draft update", body: "Private draft body", mediaIds: [], action: "save_draft" },
      staffHeaders
    )
  });
  assert.equal(draft.status, 200);
  const form = new FormData();
  form.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff])], "update.jpg", { type: "image/jpeg" }));
  const uploaded = await app.request(`${base}/update-media`, {
    method: "POST",
    headers: staffHeaders,
    body: form
  });
  assert.equal(uploaded.status, 201);
  assert.deepEqual(uploads.contexts.at(-1), { kind: "official_update", subject: "staff-1" });
  assert.equal((await responseJson(uploaded)).data.publication.uploads[0].status, "processing");
});

test("rejects publication-controlled fields and more than three selected images", async () => {
  const { app, store } = makeApp();
  store.reports.push({ id: "report-publish-fields", status: "reviewing", media: [] });
  const endpoint = "https://www.timlostsomething.com/api/v1/ops/reports/report-publish-fields/publish";
  const headers = { authorization: "Bearer staff-token" };
  const forbiddenFields = [
    "name",
    "email",
    "phone",
    "hunterSubject",
    "publisherName",
    "publicAttribution",
    "waypointId",
    "latitude",
    "longitude"
  ];
  for (const field of forbiddenFields) {
    const response = await app.request(endpoint, {
      method: "POST",
      ...json(
        {
          title: "Possible clue",
          body: "Edited public story",
          mediaIds: [],
          action: "save_draft",
          [field]: "attempted override"
        },
        headers
      )
    });
    assert.equal(response.status, 422, field);
    assert.equal((await responseJson(response)).error.code, "publication_field_forbidden", field);
  }

  const tooMany = await app.request(endpoint, {
    method: "POST",
    ...json(
      {
        title: "Possible clue",
        body: "Edited public story",
        mediaIds: ["media-1", "media-2", "media-3", "media-4"],
        action: "save_draft"
      },
      headers
    )
  });
  assert.equal(tooMany.status, 422);
  assert.equal((await responseJson(tooMany)).error.code, "validation_failed");
  assert.equal(store.audits.some((event) => event.action === "report.published"), false);
});

test("does not resurrect a rejected or resolved report through publication", async () => {
  const { app, store } = makeApp();
  store.reports.push(
    { id: "report-rejected", status: "rejected", media: [] },
    { id: "report-resolved", status: "resolved", media: [] }
  );
  for (const reportId of ["report-rejected", "report-resolved"]) {
    const response = await app.request(
      `https://www.timlostsomething.com/api/v1/ops/reports/${reportId}/publish`,
      {
        method: "POST",
        ...json(
          { title: "Must remain private", body: "Terminal report", mediaIds: [], action: "publish_now" },
          { authorization: "Bearer staff-token" }
        )
      }
    );
    assert.equal(response.status, 409, reportId);
    assert.equal((await responseJson(response)).error.code, "report_publication_state_invalid");
  }
  assert.deepEqual(store.reports.map((report) => report.status), ["rejected", "resolved"]);
  assert.equal(store.audits.some((event) => event.action === "report.published"), false);
});

test("keeps the sponsor operations ledger behind active staff authorization", async () => {
  const { app, store } = makeApp();
  const origin = "https://www.timlostsomething.com";

  const anonymous = await app.request(`${origin}/api/v1/ops/sponsors`);
  assert.equal(anonymous.status, 401);

  const hunter = await app.request(`${origin}/api/v1/ops/sponsors`, { headers: hunterHeaders });
  assert.equal(hunter.status, 401);

  store.staff.clear();
  const inactive = await app.request(`${origin}/api/v1/ops/sponsors`, {
    headers: { authorization: "Bearer staff-token" }
  });
  assert.equal(inactive.status, 403);

  const inactiveMutation = await app.request(`${origin}/api/v1/ops/sponsors/unknown`, {
    method: "PATCH",
    ...json(
      { state: "qualified" },
      { authorization: "Bearer staff-token", origin }
    )
  });
  assert.equal(inactiveMutation.status, 403);
});

test("lets one active operator send another operator through verified password recovery", async () => {
  const { app, store, staffAccounts } = makeApp();
  const response = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/staff/staff-1/recovery",
    {
      method: "POST",
      headers: {
        authorization: "Bearer staff-token",
        origin: "https://www.timlostsomething.com"
      }
    }
  );

  const responseBody = await responseJson(response);
  assert.equal(response.status, 202);
  assert.equal(responseBody.data.status, "instructions_sent");
  assert.equal(staffAccounts.actions[0]?.action, "recovery");
  assert.equal(staffAccounts.actions[0]?.target.email, "operator@example.test");
  assert.equal(store.audits.at(-1)?.action, "staff.recovery.requested");
  assert.equal(JSON.stringify(responseBody).includes("password"), false);
});

test("exposes the consent-aware subscriber ledger only to active staff", async () => {
  const { app } = makeApp();
  const anonymous = await app.request("https://www.timlostsomething.com/api/v1/ops/subscribers");
  assert.equal(anonymous.status, 401);

  const hunter = await app.request("https://www.timlostsomething.com/api/v1/ops/subscribers", {
    headers: hunterHeaders
  });
  assert.equal(hunter.status, 401);

  const staff = await app.request("https://www.timlostsomething.com/api/v1/ops/subscribers", {
    headers: { authorization: "Bearer staff-token" }
  });
  const body = await responseJson(staff);
  assert.equal(staff.status, 200);
  assert.deepEqual(body.data.counts, {
    totalProfiles: 1,
    huntEmail: 1,
    marketing: 0
  });
  assert.equal(body.data.items[0].verifiedEmail, "hunter@example.test");
  assert.deepEqual(body.data.items[0].consents, {
    huntEmail: true,
    marketing: false
  });
  assert.deepEqual(body.page, { nextCursor: null });

  const publicAlias = await app.request("https://www.timlostsomething.com/api/v1/subscribers");
  assert.equal(publicAlias.status, 404);
});

test("lets active staff send player recovery instructions or revoke player sessions", async () => {
  const { app, store, staffAccounts } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const headers = {
    authorization: "Bearer staff-token",
    origin: "https://www.timlostsomething.com"
  };

  for (const action of ["recovery", "revoke-sessions"]) {
    const response = await app.request(
      `https://www.timlostsomething.com/api/v1/ops/players/hunter-1/${action}`,
      { method: "POST", headers }
    );
    assert.equal(response.status, 202);
  }
  assert.deepEqual(staffAccounts.actions.map((item) => item.action), ["recovery", "revoke-sessions"]);
  assert.equal(staffAccounts.actions[0]?.target.verifiedEmail, "hunter@example.test");
  assert.equal(store.audits.at(-1)?.action, "player.revoke-sessions.requested");
});

test("keeps waiver summaries minimal and loads legal detail only for deliberate staff review", async () => {
  const { app, store, waiverReceipts } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const review = await store.recordWaiverReview("hunter-1", {
    version: participationWaiverDocument.version,
    hash: participationWaiverDocument.hash
  });
  const accepted = await store.acceptParticipationWaiver("hunter-1", {
    reviewEventId: review.id,
    idempotencyKey: "ops-acceptance",
    adultName: "Alex Hunter",
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
    guardianAttested: true,
    documentVersion: participationWaiverDocument.version,
    documentHash: participationWaiverDocument.hash
  });
  const staffHeaders = { authorization: "Bearer staff-token" };

  const anonymous = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/waiver"
  );
  assert.equal(anonymous.status, 401);
  const hunter = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/waiver",
    { headers: hunterHeaders }
  );
  assert.equal(hunter.status, 401);

  const list = await app.request("https://www.timlostsomething.com/api/v1/ops/players", {
    headers: staffHeaders
  });
  assert.equal(list.status, 200);
  const listText = await list.text();
  assert.doesNotMatch(listText, /Sam Hunter|birthYear|participants|waiver-receipt-/);
  const listItem = JSON.parse(listText).data.items[0];
  assert.equal(listItem.waiverVersion, participationWaiverDocument.version);
  assert.equal(listItem.minorCount, 1);
  assert.equal(listItem.receiptStatus, "pending");

  const detail = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/waiver",
    { headers: staffHeaders }
  );
  assert.equal(detail.status, 200);
  const detailBody = (await responseJson(detail)).data;
  assert.equal(detailBody.id, accepted.value.id);
  assert.equal(detailBody.participants[1].fullName, "Sam Hunter");
  const detailAudit = store.audits.at(-1);
  assert.equal(detailAudit?.action, "player.waiver-detail.viewed");
  assert.equal(detailAudit?.actorSubject, "staff-1");
  assert.equal(detailAudit?.target, accepted.value.id);
  assert.equal(typeof detailAudit?.occurredAt, "string");
  assert.match(String(detailAudit?.occurredAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(detailAudit), /Alex Hunter|Sam Hunter|hunter@example\.test|2014/);

  const retry = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/waiver/receipt",
    { method: "POST", headers: { ...staffHeaders, origin: "https://www.timlostsomething.com" } }
  );
  assert.equal(retry.status, 202);
  assert.deepEqual(waiverReceipts.calls, [accepted.value.id]);
  const audit = store.audits.at(-1);
  assert.equal(audit?.action, "player.waiver-receipt.requested");
  assert.equal(JSON.stringify(audit).includes("Sam Hunter"), false);

  store.waiverReceiptInProgress.add(accepted.value.id);
  const auditCount = store.audits.length;
  const retryWhileSending = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/waiver/receipt",
    { method: "POST", headers: { ...staffHeaders, origin: "https://www.timlostsomething.com" } }
  );
  assert.equal(retryWhileSending.status, 409);
  assert.equal((await responseJson(retryWhileSending)).error.code, "waiver_receipt_in_progress");
  assert.equal(store.audits.length, auditCount);
  assert.deepEqual(waiverReceipts.calls, [accepted.value.id]);
});

test("a current waiver unlocks hunter tools without weakening reports, moderation, or human checks", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    fullName: "Alex Hunter",
    participationBasis: "adult",
    guardianPermissionAttestedAt: null,
    publicHandle: "Hunter A7F3"
  });
  store.legalEvents.push({
    subject: "hunter-1",
    documentType: "privacy_media",
    version: "2026.3"
  });
  const lockedRequests: Array<[string, RequestInit]> = [
    ["/api/v1/member/waypoints/1", { headers: hunterHeaders }],
    ["/api/v1/progress/1", { method: "PUT", ...json({ state: "visited" }, hunterHeaders) }],
    ["/api/v1/board/notes", {
      method: "POST",
      ...json({ waypointId: 1, body: "A careful field observation." }, hunterHeaders)
    }],
    ["/api/v1/board/notes/note-1/replies", {
      method: "POST",
      ...json({ body: "A safe community reply." }, hunterHeaders)
    }],
  ];
  for (const [path, init] of lockedRequests) {
    const response = await app.request(`https://www.timlostsomething.com${path}`, init);
    assert.equal(response.status, 423, path);
    assert.equal((await responseJson(response)).error.code, "participation_waiver_required", path);
  }

  store.board.push({
    id: "public-waiver-flag-note",
    authorSubject: "hunter-1",
    status: "approved",
    body: "A public note eligible for replies.",
    replies: []
  });
  store.replies.push({
    id: "reply-1",
    noteId: "public-waiver-flag-note",
    authorSubject: "hunter-1",
    status: "published",
    body: "A public reply eligible for reporting."
  });

  const flag = await app.request("https://www.timlostsomething.com/api/v1/board/reply/reply-1/flags", {
    method: "POST",
    ...json({ reason: "unsafe", details: "Review this community reply." }, hunterHeaders)
  });
  assert.equal(flag.status, 201);
  const boardCountBeforePrivateReport = store.board.length;

  const privateReport = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json({
      type: "tip",
      name: "Anonymous-capable Reporter",
      email: "reporter@example.test",
      locationDescription: "Near the marked public trail.",
      details: "A private report that must not appear on the clue board.",
      cfTurnstileResponse: "human-token"
    }, { "idempotency-key": "waiver-matrix-report", origin: "https://www.timlostsomething.com" })
  });
  assert.equal(privateReport.status, 201);
  assert.equal(store.reports[0]?.hunterSubject, null);
  assert.equal(store.board.length, boardCountBeforePrivateReport);

  const review = await app.request("https://www.timlostsomething.com/api/v1/me/waiver/review", {
    method: "POST",
    ...json({
      version: participationWaiverDocument.version,
      hash: participationWaiverDocument.hash
    }, { ...hunterHeaders, origin: "https://www.timlostsomething.com" })
  });
  const reviewEventId = (await responseJson(review)).data.review.id;
  const acceptance = await app.request("https://www.timlostsomething.com/api/v1/me/waiver/accept", {
    method: "POST",
    ...json({
      reviewEventId,
      version: participationWaiverDocument.version,
      hash: participationWaiverDocument.hash,
      waiverAccepted: true,
      guardianAttested: false,
      minors: []
    }, {
      ...hunterHeaders,
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "waiver-matrix-acceptance"
    })
  });
  assert.equal(acceptance.status, 201);

  const progress = await app.request("https://www.timlostsomething.com/api/v1/progress/1", {
    method: "PUT",
    ...json({ state: "visited" }, hunterHeaders)
  });
  assert.equal(progress.status, 200);
  const waypoint = await app.request("https://www.timlostsomething.com/api/v1/member/waypoints/1", {
    headers: hunterHeaders
  });
  assert.equal(waypoint.status, 200);

  const form = new FormData();
  form.set("waypointId", "1");
  form.set("body", "Fresh boot prints beside the approved trail.");
  form.set("cfTurnstileResponse", "human-token");
  form.append(
    "images",
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "observation.png", { type: "image/png" })
  );
  const note = await app.request("https://www.timlostsomething.com/api/v1/board/notes", {
    method: "POST",
    headers: { ...hunterHeaders, "idempotency-key": "waiver-current-note-key" },
    body: form
  });
  assert.equal(note.status, 201);
  const noteBody = (await responseJson(note)).data;
  assert.equal(noteBody.status, "pending");
  assert.equal(noteBody.media[0].status, "processing");

  const reply = await app.request(
    `https://www.timlostsomething.com/api/v1/board/notes/${noteBody.id}/replies`,
    { method: "POST", ...json({ body: "I noticed that too." }, hunterHeaders) }
  );
  assert.equal(reply.status, 201);
  assert.equal(store.board.length, boardCountBeforePrivateReport);
});
