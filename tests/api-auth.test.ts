import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeIdentity,
  FakeRateLimits,
  FakeStaffAccounts,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";

const makeApp = (store = new FakeStore()) => {
  const staffAccounts = new FakeStaffAccounts();
  const rateLimits = new FakeRateLimits();
  return {
    app: createApi({
      store,
      identity: new FakeIdentity(),
      turnstile: new FakeTurnstile(),
      uploads: new FakeUploads(),
      staffAccounts,
      playerAccounts: staffAccounts,
      rateLimits
    }),
    store,
    staffAccounts,
    rateLimits
  };
};

const hunterHeaders = {
  authorization: "Bearer hunter-token",
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
});

test("updates a hunter profile after legal acceptance and gates progress on the waiver", async () => {
  const { app, store, rateLimits } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const profile = {
    fullName: "A Hunter",
    townArea: "Seba Beach",
    interests: ["treasure-hunt"],
    discoverySource: "friend",
    adultAttested: true,
    privacyMediaAccepted: true,
    privacyMediaVersion: "2026.1",
    consents: { huntEmail: true, marketing: false }
  };

  const response = await app.request(
    "https://www.timlostsomething.com/api/v1/me/profile",
    { method: "PATCH", ...json(profile, hunterHeaders) }
  );
  assert.equal(response.status, 200);
  const profileResponse = await responseJson(response);
  assert.equal(profileResponse.data.subject, "hunter-1");
  assert.deepEqual(profileResponse.data.consents, {
    huntEmail: true,
    marketing: false
  });
  assert.equal(store.profiles.size, 1);
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
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), ["profile", "progress"]);
});

test("pre-moderates field notes, constrains replies, and accepts private abuse flags", async () => {
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

  const note = await app.request(
    "https://www.timlostsomething.com/api/v1/board/notes",
    { method: "POST", ...json({ waypointId: 1, body: "Fresh boot prints beside the trail." }, hunterHeaders) }
  );
  assert.equal(note.status, 201);
  const noteData = (await responseJson(note)).data;
  assert.equal(noteData.status, "pending");

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
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), [
    "field_note",
    "reply",
    "reply",
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
  const headers = { authorization: "Bearer staff-token" };

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
  store.notes.push({ id: "note-1", status: "pending", body: "A pending observation." });
  const headers = { authorization: "Bearer staff-token" };

  const dashboard = await app.request("https://www.timlostsomething.com/api/v1/ops/dashboard", { headers });
  assert.equal(dashboard.status, 200);
  assert.equal((await responseJson(dashboard)).data.counts.pendingNotes, 1);

  const reports = await app.request("https://www.timlostsomething.com/api/v1/ops/reports", { headers });
  assert.equal((await responseJson(reports)).data[0].id, "report-1");

  const reportUpdate = await app.request("https://www.timlostsomething.com/api/v1/ops/reports/report-1", {
    method: "PATCH",
    ...json({ status: "reviewing", note: "Checking the supplied details." }, headers)
  });
  assert.equal((await responseJson(reportUpdate)).data.status, "reviewing");

  const pending = await app.request("https://www.timlostsomething.com/api/v1/ops/moderation/notes", { headers });
  assert.equal((await responseJson(pending)).data[0].id, "note-1");

  const moderation = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/moderation/notes/note-1",
    { method: "POST", ...json({ decision: "approved" }, headers) }
  );
  assert.equal((await responseJson(moderation)).data.status, "approved");

  const audit = await app.request("https://www.timlostsomething.com/api/v1/ops/audit", { headers });
  assert.equal(audit.status, 200);
  assert.equal((await responseJson(audit)).data.at(-1).action, "note.moderated");
});

test("lets one active operator send another operator through verified password recovery", async () => {
  const { app, store, staffAccounts } = makeApp();
  const response = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/staff/staff-1/recovery",
    { method: "POST", headers: { authorization: "Bearer staff-token" } }
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
  const headers = { authorization: "Bearer staff-token" };

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
