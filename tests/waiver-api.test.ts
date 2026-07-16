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
const uncertainParticipantMessage = "The email provider may already have accepted this receipt. The case team must check the configured sender mailbox Sent Items or provider delivery log before another copy can be sent.";
const uncertainOpsMessage = "Check the configured sender mailbox Sent Items or provider delivery log, then explicitly confirm before retrying this uncertain receipt.";

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
    participationBasis: "adult",
    guardianPermissionAttestedAt: null,
    privacyMediaVersion: "2026.3",
  });
  store.legalEvents.push({
    subject: "hunter-1",
    documentType: "privacy_media",
    version: "2026.3",
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
  assert.equal(document.sections.length, 12);
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

test("accepts a guardian-permitted minor account but rejects supervised dependants", async () => {
  const { app, store, receipts } = makeApp();
  await completePlayer(store);
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    fullName: "Young Test Hunter",
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttestedAt: "2026-07-15T18:00:00.000Z",
    privacyMediaVersion: "2026.3",
  });
  const reviewEventId = await recordReview(app);
  const base = {
    reviewEventId,
    ...documentIdentity,
    waiverAccepted: true,
    guardianAttested: false,
  };
  const withDependant = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({ ...base, minors: [{ fullName: "Another Minor", birthYear: 2014 }] }, {
      ...hunterHeaders,
      "idempotency-key": "minor-with-dependant",
    }),
  });
  assert.equal(withDependant.status, 422);
  assert.equal((await responseJson(withDependant)).error.code, "minor_dependants_not_allowed");

  const accepted = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({ ...base, minors: [] }, {
      ...hunterHeaders,
      "idempotency-key": "minor-account",
    }),
  });
  assert.equal(accepted.status, 201);
  const acceptanceData = (await responseJson(accepted)).data;
  assert.equal(acceptanceData.participationUnlocked, true);
  assert.deepEqual(acceptanceData.acceptance.participants, [{
    role: "minor",
    participationBasis: "minor_guardian_permission",
    fullName: "Young Test Hunter",
    birthYear: null,
    guardianAttested: true,
  }]);
  assert.deepEqual(receipts.calls, [acceptanceData.acceptance.id]);

  const current = await app.request(`${origin}/api/v1/me/waiver`, { headers: hunterHeaders });
  assert.equal(current.status, 200);
  assert.deepEqual(
    (await responseJson(current)).data.acceptance.participants,
    acceptanceData.acceptance.participants,
  );

  const ops = await app.request(`${origin}/api/v1/ops/players/hunter-1/waiver`, {
    headers: { authorization: "Bearer staff-token", origin },
  });
  assert.equal(ops.status, 200);
  assert.deepEqual((await responseJson(ops)).data.participants, acceptanceData.acceptance.participants);

  const envelope = await store.getWaiverReceiptEnvelope(acceptanceData.acceptance.id);
  assert.deepEqual(envelope?.acceptance.participants, acceptanceData.acceptance.participants);
  assert.equal((await store.getPlayerAccess("hunter-1")).participationUnlocked, true);
});

test("an uncertain receipt survives replay and requires explicit Ops mailbox confirmation", async () => {
  const { app, store, receipts } = makeApp();
  await completePlayer(store);
  const reviewEventId = await recordReview(app);
  const body = {
    reviewEventId,
    ...documentIdentity,
    waiverAccepted: true,
    guardianAttested: false,
    minors: [],
  };
  const accept = () => app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json(body, { ...hunterHeaders, "idempotency-key": "accept-uncertain" }),
  });
  const accepted = await accept();
  const acceptanceId = (await responseJson(accepted)).data.acceptance.id as string;
  const record = store.waiverAcceptances.get(acceptanceId)!;
  record.receipt.status = "uncertain";
  const callsBeforeReplay = [...receipts.calls];

  const replay = await accept();
  assert.equal(replay.status, 200);
  assert.equal((await responseJson(replay)).data.acceptance.receipt.status, "uncertain");
  assert.deepEqual(receipts.calls, callsBeforeReplay);

  const participantResend = await app.request(`${origin}/api/v1/me/waiver/receipt`, {
    method: "POST",
    ...json({}, hunterHeaders),
  });
  assert.equal(participantResend.status, 409);
  const participantResendError = (await responseJson(participantResend)).error;
  assert.equal(participantResendError.code, "waiver_receipt_delivery_uncertain");
  assert.equal(participantResendError.message, uncertainParticipantMessage);
  assert.deepEqual(receipts.calls, callsBeforeReplay);

  const opsHeaders = { authorization: "Bearer staff-token", origin };
  const ordinaryOpsRetry = await app.request(
    `${origin}/api/v1/ops/players/hunter-1/waiver/receipt`,
    { method: "POST", ...json({}, opsHeaders) }
  );
  assert.equal(ordinaryOpsRetry.status, 409);
  const ordinaryOpsError = (await responseJson(ordinaryOpsRetry)).error;
  assert.equal(ordinaryOpsError.code, "waiver_receipt_delivery_uncertain");
  assert.equal(ordinaryOpsError.message, uncertainOpsMessage);
  assert.deepEqual(receipts.calls, callsBeforeReplay);

  const confirmedOpsRetry = await app.request(
    `${origin}/api/v1/ops/players/hunter-1/waiver/receipt`,
    {
      method: "POST",
      ...json({ confirmUncertainRetry: true }, opsHeaders),
    }
  );
  assert.equal(confirmedOpsRetry.status, 202);
  const confirmedPayload = await responseJson(confirmedOpsRetry);
  assert.equal(confirmedPayload.data.acceptance.receipt.status, "pending");
  assert.doesNotMatch(
    JSON.stringify(confirmedPayload),
    /providerReference|provider_reference|provider_message_id/i
  );
  assert.deepEqual(receipts.calls, [...callsBeforeReplay, acceptanceId]);
  assert.equal(
    store.audits.filter(
      (event) => event.action === "player.waiver-receipt.uncertain-retry-confirmed"
    ).length,
    1
  );
});

test("Ops receipt retries require a JSON body whenever content is present", async () => {
  const { app, store } = makeApp();
  await completePlayer(store);
  const reviewEventId = await recordReview(app);
  const accepted = await app.request(`${origin}/api/v1/me/waiver/accept`, {
    method: "POST",
    ...json({
      reviewEventId,
      ...documentIdentity,
      waiverAccepted: true,
      guardianAttested: false,
      minors: [],
    }, { ...hunterHeaders, "idempotency-key": "accept-ops-media-type" }),
  });
  assert.equal(accepted.status, 201);
  const endpoint = `${origin}/api/v1/ops/players/hunter-1/waiver/receipt`;
  const opsHeaders = { authorization: "Bearer staff-token", origin };

  const formEncoded = await app.request(endpoint, {
    method: "POST",
    headers: {
      ...opsHeaders,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "confirmUncertainRetry=true",
  });
  assert.equal(formEncoded.status, 415);
  const formEncodedError = (await responseJson(formEncoded)).error;
  assert.equal(formEncodedError.code, "unsupported_media_type");
  assert.equal(formEncodedError.message, "Waiver receipt retry requests require JSON.");

  const multipartBody = new FormData();
  multipartBody.set("confirmUncertainRetry", "true");
  const multipart = await app.request(endpoint, {
    method: "POST",
    headers: opsHeaders,
    body: multipartBody,
  });
  assert.equal(multipart.status, 415);
  const multipartError = (await responseJson(multipart)).error;
  assert.equal(multipartError.code, "unsupported_media_type");
  assert.equal(multipartError.message, "Waiver receipt retry requests require JSON.");

  const jsonWithCharset = await app.request(endpoint, {
    method: "POST",
    headers: {
      ...opsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
    body: "{}",
  });
  assert.equal(jsonWithCharset.status, 202);
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
