import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { participationWaiverDocument } from "../src/server/legal-documents";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeLegalReceiptSender,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson,
} from "./api-test-kit";

const origin = "https://www.timlostsomething.com";
const hunterHeaders = { authorization: "Bearer hunter-token", origin };
const documentIdentity = {
  version: participationWaiverDocument.version,
  hash: participationWaiverDocument.hash,
};

const makeApp = () => {
  const store = new FakeStore();
  const receipts = new FakeLegalReceiptSender();
  const rateLimits = new FakeRateLimits();
  const environment = new FakeEnvironment();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits,
    waiverReceipts: receipts,
    environment,
  });
  return { app, store, receipts, rateLimits, environment };
};

const completePlayer = async (store: FakeStore) => {
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    fullName: "Alex Hunter",
    privacyMediaVersion: "2026.2",
  });
  store.legalEvents.push({
    subject: "hunter-1",
    documentType: "privacy_media",
    version: "2026.2",
  });
};

const recordReview = async (app: ReturnType<typeof createApi>) => {
  const response = await app.request(`${origin}/api/v1/me/waiver/review`, {
    method: "POST",
    ...json(documentIdentity, hunterHeaders),
  });
  assert.equal(response.status, 201);
  return (await responseJson(response)).data.review.id as string;
};

test("publishes the active waiver document without authentication", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/legal/waiver`);
  assert.equal(response.status, 200);
  const document = (await responseJson(response)).data;
  assert.equal(document.version, participationWaiverDocument.version);
  assert.equal(document.hash, participationWaiverDocument.hash);
  assert.equal(document.title, participationWaiverDocument.title);
  assert.equal(document.sections.length, 11);
});

test("records an authenticated review of only the active waiver", async () => {
  const { app, store, rateLimits, environment } = makeApp();
  await completePlayer(store);

  const anonymous = await app.request(`${origin}/api/v1/me/waiver/review`, {
    method: "POST",
    ...json(documentIdentity, { origin }),
  });
  assert.equal(anonymous.status, 401);

  const stale = await app.request(`${origin}/api/v1/me/waiver/review`, {
    method: "POST",
    ...json({ version: "2025.9", hash: "f".repeat(64) }, hunterHeaders),
  });
  assert.equal(stale.status, 409);
  assert.equal((await responseJson(stale)).error.code, "waiver_document_outdated");

  const reviewId = await recordReview(app);
  assert.match(reviewId, /^review-/);
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), ["waiver_review", "waiver_review"]);
  assert.equal(environment.checks, 3);
});

test("accepts the reviewed waiver for an adult and supervised minors idempotently", async () => {
  const { app, store, receipts, rateLimits } = makeApp();
  await completePlayer(store);
  const reviewEventId = await recordReview(app);
  const body = {
    reviewEventId,
    ...documentIdentity,
    waiverAccepted: true,
    guardianAttested: true,
    minors: [{ fullName: " Sam Hunter ", birthYear: 2014 }],
  };
  const request = () => app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json(body, { ...hunterHeaders, "idempotency-key": "accept-one" }),
  });

  const accepted = await request();
  assert.equal(accepted.status, 201);
  const first = (await responseJson(accepted)).data;
  assert.equal(first.participationUnlocked, true);
  assert.equal(first.acceptance.participants[0].fullName, "Alex Hunter");
  assert.equal(first.acceptance.participants[1].fullName, "Sam Hunter");
  assert.deepEqual(receipts.calls, [first.acceptance.id]);

  store.waiverAcceptances.get(first.acceptance.id)!.receipt.status = "sent";
  const replay = await request();
  assert.equal(replay.status, 200);
  const repeated = (await responseJson(replay)).data;
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.acceptance.id, first.acceptance.id);
  assert.deepEqual(receipts.calls, [first.acceptance.id]);

  const current = await app.request(`${origin}/api/v1/me/waiver`, { headers: hunterHeaders });
  assert.equal(current.status, 200);
  assert.equal((await responseJson(current)).data.acceptance.id, first.acceptance.id);
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), [
    "waiver_review",
    "waiver_accept",
    "waiver_accept",
  ]);
});

test("an idempotent acceptance replay re-drives an interrupted receipt unless it was already sent", async () => {
  const store = new FakeStore();
  await completePlayer(store);
  const firstApp = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    environment: new FakeEnvironment(),
  });
  const reviewEventId = await recordReview(firstApp);
  const body = {
    reviewEventId,
    ...documentIdentity,
    waiverAccepted: true,
    guardianAttested: true,
    minors: [],
  };
  const request = (app: ReturnType<typeof createApi>) => app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json(body, { ...hunterHeaders, "idempotency-key": "accept-interrupted-receipt" }),
  });

  const accepted = await request(firstApp);
  assert.equal(accepted.status, 201);
  const acceptanceId = (await responseJson(accepted)).data.acceptance.id as string;

  const receipts = new FakeLegalReceiptSender();
  const retryApp = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    waiverReceipts: receipts,
    environment: new FakeEnvironment(),
  });

  const pendingReplay = await request(retryApp);
  assert.equal(pendingReplay.status, 200);
  assert.deepEqual(receipts.calls, [acceptanceId]);

  store.waiverAcceptances.get(acceptanceId)!.receipt.status = "failed";
  const failedReplay = await request(retryApp);
  assert.equal(failedReplay.status, 200);
  assert.deepEqual(receipts.calls, [acceptanceId, acceptanceId]);

  store.waiverAcceptances.get(acceptanceId)!.receipt.status = "sent";
  const sentReplay = await request(retryApp);
  assert.equal(sentReplay.status, 200);
  assert.deepEqual(receipts.calls, [acceptanceId, acceptanceId]);
});

test("rejects stale, unreviewed, and ineligible waiver acceptance", async () => {
  const { app, store } = makeApp();
  await completePlayer(store);
  const reviewEventId = await recordReview(app);
  const valid = {
    reviewEventId,
    ...documentIdentity,
    waiverAccepted: true,
    guardianAttested: true,
    minors: [],
  };
  const submit = (body: Record<string, unknown>, key: string) =>
    app.request(`${origin}/api/v1/me/waiver/accept`, {
      method: "POST",
      ...json(body, { ...hunterHeaders, "idempotency-key": key }),
    });

  const stale = await submit({ ...valid, version: "2025.9" }, "invalid-stale");
  assert.equal(stale.status, 409);

  const staleHash = await submit({ ...valid, hash: "f".repeat(64) }, "invalid-stale-hash");
  assert.equal(staleHash.status, 409);
  assert.equal((await responseJson(staleHash)).error.code, "waiver_document_outdated");

  const missingReview = await submit({ ...valid, reviewEventId: "review-other" }, "invalid-review");
  assert.equal(missingReview.status, 422);

  const currentYear = Number(new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    timeZone: "America/Edmonton",
  }).format(new Date()));
  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ["acceptance", { ...valid, waiverAccepted: false }],
    ["blank-name", { ...valid, minors: [{ fullName: " ", birthYear: 2014 }] }],
    ["future-year", { ...valid, minors: [{ fullName: "Sam", birthYear: currentYear + 1 }] }],
    ["adult-year", { ...valid, minors: [{ fullName: "Sam", birthYear: currentYear - 19 }] }],
    ["guardian", { ...valid, guardianAttested: false, minors: [{ fullName: "Sam", birthYear: currentYear - 10 }] }],
    ["too-many", {
      ...valid,
      minors: Array.from({ length: 11 }, (_, index) => ({ fullName: `Minor ${index}`, birthYear: 2014 })),
    }],
  ];
  for (const [key, body] of invalidCases) {
    const response = await submit(body, `invalid-${key}`);
    assert.equal(response.status, 422, key);
  }
});

test("requires a verified active account, completed profile, and current privacy acceptance", async () => {
  const { app, store } = makeApp();
  const reviewEventId = await recordReview(app);
  const response = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({
      reviewEventId,
      ...documentIdentity,
      waiverAccepted: true,
      guardianAttested: false,
      minors: [],
    }, { ...hunterHeaders, "idempotency-key": "accept-incomplete" }),
  });
  assert.equal(response.status, 409);
  assert.equal((await responseJson(response)).error.code, "verified_account_required");

  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const noProfile = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({
      reviewEventId,
      ...documentIdentity,
      waiverAccepted: true,
      guardianAttested: false,
      minors: [],
    }, { ...hunterHeaders, "idempotency-key": "accept-no-profile" }),
  });
  assert.equal(noProfile.status, 409);
  assert.equal((await responseJson(noProfile)).error.code, "profile_required");
});

test("queues a receipt resend only for the signed-in player's stored acceptance", async () => {
  const { app, store, receipts } = makeApp();
  const anonymous = await app.request(`${origin}/api/v1/me/waiver/receipt`, {
    method: "POST",
    ...json({}, { origin }),
  });
  assert.equal(anonymous.status, 401);

  await completePlayer(store);
  const missing = await app.request(`${origin}/api/v1/me/waiver/receipt`, {
    method: "POST",
    ...json({}, hunterHeaders),
  });
  assert.equal(missing.status, 404);

  const reviewEventId = await recordReview(app);
  const accepted = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({
      reviewEventId,
      ...documentIdentity,
      waiverAccepted: true,
      guardianAttested: false,
      minors: [],
    }, { ...hunterHeaders, "idempotency-key": "accept-resend" }),
  });
  const acceptanceId = (await responseJson(accepted)).data.acceptance.id;
  const foreign = await app.request(`${origin}/api/v1/me/waiver/receipt`, {
    method: "POST",
    ...json({ acceptanceId: "someone-elses-acceptance" }, hunterHeaders),
  });
  assert.equal(foreign.status, 401);
  assert.equal((await responseJson(foreign)).error.code, "waiver_receipt_unauthorized");

  const resent = await app.request(`${origin}/api/v1/me/waiver/receipt`, {
    method: "POST",
    ...json({}, hunterHeaders),
  });
  assert.equal(resent.status, 202);
  assert.equal((await responseJson(resent)).data.acceptance.id, acceptanceId);
  assert.deepEqual(receipts.calls, [acceptanceId, acceptanceId]);
});
