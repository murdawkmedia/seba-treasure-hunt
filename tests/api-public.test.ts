import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { participationWaiverDocument, privacyMediaDocument } from "../src/server/legal-documents";
import {
  FakeIdentity,
  FakeEnvironment,
  FakeOperatorAlertSender,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  openStatus,
  responseJson
} from "./api-test-kit";

const makeApp = (store = new FakeStore(), turnstile = new FakeTurnstile()) => {
  const uploads = new FakeUploads();
  const rateLimits = new FakeRateLimits();
  const operatorAlerts = new FakeOperatorAlertSender();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile,
    uploads,
    rateLimits,
    operatorAlerts,
    environment: new FakeEnvironment()
  });
  return { app, store, uploads, rateLimits, operatorAlerts };
};

test("serves public case data without leaking exact waypoint navigation", async () => {
  const { app } = makeApp();

  const [statusResponse, updatesResponse, rulesResponse, waypointsResponse] = await Promise.all([
    app.request("https://www.timlostsomething.com/api/v1/status"),
    app.request("https://www.timlostsomething.com/api/v1/updates"),
    app.request("https://www.timlostsomething.com/api/v1/rules/current"),
    app.request("https://www.timlostsomething.com/api/v1/waypoints")
  ]);

  assert.equal(statusResponse.status, 200);
  assert.deepEqual((await responseJson(statusResponse)).data, openStatus);
  assert.equal(updatesResponse.status, 200);
  assert.equal((await responseJson(updatesResponse)).data[0].title, "Case opened");
  assert.equal(rulesResponse.status, 200);
  assert.equal((await responseJson(rulesResponse)).data.version, "2026.1");
  const waypointBody = await responseJson(waypointsResponse);
  assert.equal(waypointBody.data[0].name, "Waypoint One");
  assert.equal("exactUrl" in waypointBody.data[0], false);
});

test("public API projections exclude private waiver, minor, report, and location evidence", async () => {
  const store = new FakeStore();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  store.profiles.set("hunter-1", { subject: "hunter-1", fullName: "Alex Hunter" });
  const review = await store.recordWaiverReview("hunter-1", {
    version: "2026.1",
    hash: "a".repeat(64)
  });
  const accepted = await store.acceptParticipationWaiver("hunter-1", {
    reviewEventId: review.id,
    idempotencyKey: "public-scan-acceptance",
    adultName: "Alex Hunter",
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
    guardianAttested: true,
    documentVersion: "2026.1",
    documentHash: "a".repeat(64)
  });
  store.reports.push({
    id: "private-report",
    details: "Private report evidence phrase",
    latitude: 53.123456,
    longitude: -114.123456,
    status: "received"
  });
  store.notes.push({
    id: "pending-private-note",
    body: "Pending private moderation phrase",
    status: "pending"
  });
  const { app } = makeApp(store);
  const paths = [
    "/api/v1/status",
    "/api/v1/updates",
    "/api/v1/rules/current",
    "/api/v1/zones",
    "/api/v1/waypoints",
    "/api/v1/board",
    "/api/v1/legal/waiver"
  ];
  const publicOutput = (await Promise.all(paths.map(async (path) => {
    const response = await app.request(`https://www.timlostsomething.com${path}`);
    assert.equal(response.status, 200, path);
    return response.text();
  }))).join("\n");

  for (const privateValue of [
    "hunter@example.test",
    "Alex Hunter",
    "Sam Hunter",
    "2014",
    accepted.value.id,
    accepted.value.receipt.jobId,
    "53.123456",
    "-114.123456",
    "Private report evidence phrase",
    "Pending private moderation phrase"
  ]) {
    assert.equal(publicOutput.includes(privateValue), false, privateValue);
  }
});

test("exposes only browser-safe runtime configuration", async () => {
  const store = new FakeStore();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    environment: new FakeEnvironment(),
    config: {
      deploymentEnvironment: "validation",
      turnstileSiteKey: "0x-public",
      hunterPublishableKey: "pk_test_public",
      hunterAccountPortalUrl: "https://accounts.example.test",
      staffPublishableKey: "pk_test_staff",
      staffAccountPortalUrl: "https://ops-accounts.example.test"
    }
  });

  const response = await app.request("https://www.timlostsomething.com/api/v1/config");
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, {
    deploymentEnvironment: "validation",
    turnstileSiteKey: "0x-public",
    hunterPublishableKey: "pk_test_public",
    hunterAccountPortalUrl: "https://accounts.example.test",
    staffPublishableKey: "pk_test_staff",
    staffAccountPortalUrl: "https://ops-accounts.example.test",
    privacyMediaVersion: privacyMediaDocument.version,
    privacyMediaHash: privacyMediaDocument.hash,
    waiverStatus: "active",
    waiverVersion: participationWaiverDocument.version,
    waiverHash: participationWaiverDocument.hash,
    waiverEffectiveDate: participationWaiverDocument.effectiveDate
  });
  assert.equal(JSON.stringify(body).includes("secret"), false);
});

test("lists only approved community notes on the public board", async () => {
  const store = new FakeStore();
  store.board.push({
    id: "note-public",
    waypointId: 1,
    body: "Tracks near the public path.",
    authorHandle: "Hunter A7F3",
    createdAt: "2026-07-11T16:00:00.000Z",
    media: [],
    replies: []
  });
  const { app } = makeApp(store);

  const response = await app.request("https://www.timlostsomething.com/api/v1/board?waypoint=1");
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.data[0].authorHandle, "Hunter A7F3");
  assert.deepEqual(body.page, { nextCursor: null });
});

test("does not expose public moderation routes", async () => {
  const { app } = makeApp();

  for (const path of [
    "/api/v1/moderation/replies",
    "/api/v1/moderation/flags",
    "/api/v1/moderation/replies/reply-1",
    "/api/v1/moderation/flags/flag-1"
  ]) {
    const response = await app.request(`https://www.timlostsomething.com${path}`, {
      method: path.endsWith("reply-1") || path.endsWith("flag-1") ? "POST" : "GET"
    });
    assert.equal(response.status, 404, path);
  }
});

test("serves only a D1-authorized ready derivative without exposing its R2 key", async () => {
  const store = new FakeStore();
  store.publicMedia.set("media-ready", {
    key: "derivatives/media-ready.webp",
    contentType: "image/webp",
    cacheControl: "immutable"
  });
  const { app } = makeApp(store);

  const response = await app.request("https://www.timlostsomething.com/api/v1/media/media-ready");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(response.headers.get("etag"), '"etag-ready"');
  assert.equal(response.headers.get("x-r2-key"), null);

  const missing = await app.request("https://www.timlostsomething.com/api/v1/media/not-public");
  assert.equal(missing.status, 404);
});

test("publishes only the approved minor-safe report projection and selected derivative", async () => {
  const store = new FakeStore();
  store.profiles.set("minor-subject", {
    subject: "minor-subject",
    fullName: "Private Minor Name",
    publicHandle: "Minor Handle Must Stay Private",
    participationBasis: "minor_guardian_permission"
  });
  store.reports.push({
    id: "report-minor-publication",
    hunterSubject: "minor-subject",
    name: "Private Minor Name",
    email: "minor-private@example.test",
    phone: "780-555-0101",
    waypointId: 1,
    latitude: 53.123,
    longitude: -114.456,
    status: "verified",
    media: [
      {
        id: "media-selected",
        privateObjectKey: "private/report-minor-publication/original-selected.jpg",
        derivativeObjectKey: "derivatives/media-selected.webp",
        contentType: "image/webp",
        status: "ready"
      },
      {
        id: "media-unselected",
        privateObjectKey: "private/report-minor-publication/original-unselected.jpg",
        derivativeObjectKey: "derivatives/media-unselected.webp",
        contentType: "image/webp",
        status: "ready"
      }
    ]
  });
  const { app } = makeApp(store);
  const published = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-minor-publication/publish",
    {
      method: "POST",
      ...json(
        {
          title: "Possible clue near the creek",
          body: "Edited operator-approved story",
          mediaIds: ["media-selected"],
          action: "publish_now"
        },
        { authorization: "Bearer staff-token" }
      )
    }
  );
  assert.equal(published.status, 200);

  const response = await app.request("https://www.timlostsomething.com/api/v1/updates");
  assert.equal(response.status, 200);
  const update = (await responseJson(response)).data[0];
  assert.deepEqual(update, {
    id: "approved-report-1",
    kind: "approved_report",
    title: "Possible clue near the creek",
    body: "Edited operator-approved story",
    publisherName: "Young Hunter",
    waypointId: 1,
    latitude: 53.123,
    longitude: -114.456,
    media: [
      {
        id: "media-selected",
        url: "/api/v1/media/media-selected",
        contentType: "image/webp"
      }
    ],
    publishedAt: "2026-07-15T21:00:00.000Z"
  });
  const publicText = JSON.stringify(update);
  for (const forbidden of [
    "Private Minor Name",
    "Minor Handle Must Stay Private",
    "minor-private@example.test",
    "780-555-0101",
    "minor-subject",
    "report-minor-publication",
    "media-unselected",
    "private/",
    "derivatives/"
  ]) {
    assert.equal(publicText.includes(forbidden), false, forbidden);
  }

  const selectedMedia = await app.request(
    "https://www.timlostsomething.com/api/v1/media/media-selected"
  );
  assert.equal(selectedMedia.status, 200);
  assert.equal(selectedMedia.headers.get("cache-control"), "no-store");
  assert.equal(
    (await app.request("https://www.timlostsomething.com/api/v1/media/media-unselected")).status,
    404
  );

  const unpublished = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/reports/report-minor-publication/unpublish",
    {
      method: "POST",
      ...json({}, { authorization: "Bearer staff-token" })
    }
  );
  assert.equal(unpublished.status, 200);
  const after = await app.request("https://www.timlostsomething.com/api/v1/updates");
  assert.equal(
    (await responseJson(after)).data.some((item: Record<string, unknown>) => item.kind === "approved_report"),
    false
  );
  assert.equal(
    (await app.request("https://www.timlostsomething.com/api/v1/media/media-selected")).status,
    404
  );
});

test("derives adult and unsigned report attribution only from stored ownership", async () => {
  const store = new FakeStore();
  store.profiles.set("adult-subject", {
    subject: "adult-subject",
    publicHandle: "Hunter A7F3",
    participationBasis: "adult"
  });
  store.reports.push(
    {
      id: "report-adult-publication",
      hunterSubject: "adult-subject",
      waypointId: 2,
      status: "verified",
      media: []
    },
    {
      id: "report-anonymous-publication",
      hunterSubject: null,
      waypointId: null,
      status: "verified",
      media: []
    }
  );
  const { app } = makeApp(store);
  const headers = { authorization: "Bearer staff-token" };
  for (const [reportId, title] of [
    ["report-adult-publication", "Adult report"],
    ["report-anonymous-publication", "Community report"]
  ]) {
    const result = await app.request(
      `https://www.timlostsomething.com/api/v1/ops/reports/${reportId}/publish`,
      {
        method: "POST",
        ...json({ title, body: "Operator-edited story", mediaIds: [], action: "publish_now" }, headers)
      }
    );
    assert.equal(result.status, 200, reportId);
  }
  const updates = (await responseJson(
    await app.request("https://www.timlostsomething.com/api/v1/updates")
  )).data;
  assert.equal(
    updates.find((item: Record<string, unknown>) => item.title === "Adult report")?.publisherName,
    "Hunter A7F3"
  );
  assert.equal(
    updates.find((item: Record<string, unknown>) => item.title === "Community report")?.publisherName,
    "Community Hunter"
  );
});

test("fails closed when official status is unavailable", async () => {
  const store = new FakeStore();
  store.status = null;
  const { app } = makeApp(store);

  const response = await app.request("https://www.timlostsomething.com/api/v1/status");
  const body = await responseJson(response);

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "status_unavailable");
  assert.ok(body.error.requestId);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("requires Turnstile and idempotency before capturing a private report", async () => {
  const { app, store, rateLimits, operatorAlerts } = makeApp();
  const report = {
    type: "tip",
    name: "A Hunter",
    email: "hunter@example.test",
    waypointId: 13,
    locationDescription: "Near waypoint one",
    details: "I noticed a possible clue."
  };

  const rejected = await app.request(
    "https://www.timlostsomething.com/api/v1/reports",
    { method: "POST", ...json(report, { "idempotency-key": "report-key-1" }) }
  );
  assert.equal(rejected.status, 400);
  assert.equal((await responseJson(rejected)).error.code, "human_verification_failed");

  const accepted = await app.request(
    "https://www.timlostsomething.com/api/v1/reports",
    {
      method: "POST",
      ...json(report, {
        "idempotency-key": "report-key-1",
        "cf-turnstile-response": "human-token"
      })
    }
  );
  assert.equal(accepted.status, 201);
  assert.equal((await responseJson(accepted)).data.replayed, false);

  const replayed = await app.request(
    "https://www.timlostsomething.com/api/v1/reports",
    {
      method: "POST",
      ...json(report, {
        "idempotency-key": "report-key-1"
      })
    }
  );
  assert.equal(replayed.status, 200);
  assert.equal((await responseJson(replayed)).data.replayed, true);
  assert.equal(store.reports.length, 1);
  assert.equal(store.reports[0]?.waypointId, 13);
  assert.equal(rateLimits.seen.filter((entry) => entry.scope === "report").length, 2);
  assert.deepEqual(operatorAlerts.calls, ["operator-report-job-1"]);

  const outOfRange = await app.request(
    "https://www.timlostsomething.com/api/v1/reports",
    {
      method: "POST",
      ...json(
        { ...report, waypointId: 14 },
        {
          "idempotency-key": "report-key-14",
          "cf-turnstile-response": "human-token"
        }
      )
    }
  );
  assert.equal(outOfRange.status, 422);
  assert.equal((await responseJson(outOfRange)).error.message, "Waypoint must be a number from 1 to 13.");
});

test("a background operator-alert failure never changes a successful report response", async () => {
  const operatorAlerts = new FakeOperatorAlertSender(true);
  const app = createApi({
    store: new FakeStore(),
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    operatorAlerts,
    environment: new FakeEnvironment()
  });
  const response = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(
      {
        type: "tip",
        name: "A Hunter",
        email: "hunter@example.test",
        locationDescription: "Near the public trail",
        details: "A possible clue was visible."
      },
      {
        "idempotency-key": "background-alert-failure",
        "cf-turnstile-response": "human-token"
      }
    )
  });

  assert.equal(response.status, 201);
  assert.deepEqual(operatorAlerts.calls, ["operator-report-job-1"]);
});

test("rate limits report capture and returns a retry interval", async () => {
  const store = new FakeStore();
  const limiter = new FakeRateLimits({ report: 1 });
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: limiter,
    environment: new FakeEnvironment()
  });
  const report = {
    type: "tip",
    name: "A Hunter",
    email: "hunter@example.test",
    locationDescription: "Near waypoint one",
    details: "I noticed a possible clue."
  };
  const headers = {
    "cf-turnstile-response": "human-token",
    "cf-connecting-ip": "203.0.113.8"
  };

  const first = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(report, { ...headers, "idempotency-key": "rate-key-1" })
  });
  assert.equal(first.status, 201);
  const limited = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(report, { ...headers, "idempotency-key": "rate-key-2" })
  });
  assert.equal(limited.status, 429);
  assert.equal((await responseJson(limited)).error.code, "rate_limit_exceeded");
  assert.equal(limited.headers.get("retry-after"), "600");
});

test("fails closed on report writes when rate-limit protection is not configured", async () => {
  const app = createApi({
    store: new FakeStore(),
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    environment: new FakeEnvironment()
  });
  const response = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(
      {
        type: "tip",
        name: "A Hunter",
        email: "hunter@example.test",
        locationDescription: "Near waypoint one",
        details: "I noticed a possible clue."
      },
      {
        "cf-turnstile-response": "human-token",
        "idempotency-key": "rate-key-3",
        "cf-connecting-ip": "203.0.113.8"
      }
    )
  });
  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, "rate_limit_unavailable");
});

test("rejects an oversized JSON request before human-verification work", async () => {
  const { app } = makeApp();
  const response = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "70000",
      "idempotency-key": "large-key-1",
      origin: "https://www.timlostsomething.com",
      "cf-connecting-ip": "203.0.113.9"
    },
    body: "{}"
  });

  assert.equal(response.status, 413);
  assert.equal((await responseJson(response)).error.code, "request_too_large");
});

test("requires an image for find reports and stores accepted uploads privately", async () => {
  const { app, uploads } = makeApp();
  const missingPhoto = new FormData();
  missingPhoto.set("type", "find");
  missingPhoto.set("name", "A Hunter");
  missingPhoto.set("email", "hunter@example.test");
  missingPhoto.set("locationDescription", "Near waypoint one");
  missingPhoto.set("details", "I found an item.");
  missingPhoto.set("cfTurnstileResponse", "human-token");

  const rejected = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: {
      "idempotency-key": "find-key-1",
      origin: "https://www.timlostsomething.com"
    },
    body: missingPhoto
  });
  assert.equal(rejected.status, 422);
  assert.equal((await responseJson(rejected)).error.code, "photo_required");

  const withPhoto = new FormData();
  for (const [key, value] of missingPhoto.entries()) withPhoto.append(key, value);
  withPhoto.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "find.jpg", { type: "image/jpeg" }));
  const accepted = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: {
      "idempotency-key": "find-key-2",
      origin: "https://www.timlostsomething.com"
    },
    body: withPhoto
  });
  assert.equal(accepted.status, 201);
  assert.equal(uploads.saved.length, 1);
  const body = await responseJson(accepted);
  assert.equal(body.data.status, "received");
  assert.equal(body.data.media[0].status, "processing");
  assert.equal(JSON.stringify(body).includes("private/"), false);

  const retry = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: {
      "idempotency-key": "find-key-2",
      origin: "https://www.timlostsomething.com"
    },
    body: withPhoto
  });
  assert.equal(retry.status, 200);
  assert.equal(uploads.saved.length, 1, "an idempotent retry must not create an orphan upload");
});

test("snapshots safe report attribution from the stored profile instead of client-supplied labels", async () => {
  const store = new FakeStore();
  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    participationBasis: "adult",
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
    fullName: "Private Legal Name",
    email: "private@example.ca"
  });
  const { app } = makeApp(store);
  const base = {
    type: "tip",
    name: "Private Legal Name",
    email: "private@example.ca",
    locationDescription: "Near the public trail",
    details: "A possible clue was visible.",
    publicAttributionKind: "display_name",
    publicAttribution: "Attacker supplied label"
  };
  const missingChoice = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(
      { ...base, publicAttributionKind: undefined },
      {
        authorization: "Bearer hunter-token",
        "idempotency-key": "missing-attribution",
        "cf-turnstile-response": "human-token"
      }
    )
  });
  assert.equal(missingChoice.status, 422);
  assert.equal((await responseJson(missingChoice)).error.code, "public_attribution_required");

  const adult = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(base, {
      authorization: "Bearer hunter-token",
      "idempotency-key": "adult-attribution",
      "cf-turnstile-response": "human-token"
    })
  });
  assert.equal(adult.status, 201);
  assert.equal(store.reports[0]?.publicAttribution, "Nancy & Ron");
  assert.equal(store.reports[0]?.attributionKind, "display_name");

  store.profiles.set("hunter-1", {
    subject: "hunter-1",
    participationBasis: "minor_guardian_permission",
    publicDisplayName: "Child Name",
    publicHandle: "Hunter CHILD"
  });
  const minor = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(base, {
      authorization: "Bearer hunter-token",
      "idempotency-key": "minor-attribution",
      "cf-turnstile-response": "human-token"
    })
  });
  assert.equal(minor.status, 201);
  assert.equal(store.reports[1]?.publicAttribution, "Young Hunter");
  assert.equal(store.reports[1]?.attributionKind, "young_hunter");

  const anonymous = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    ...json(base, {
      "idempotency-key": "anonymous-attribution",
      "cf-turnstile-response": "human-token"
    })
  });
  assert.equal(anonymous.status, 201);
  assert.equal(store.reports[2]?.publicAttribution, "Community Hunter");
  assert.equal(store.reports[2]?.attributionKind, "community");
  assert.equal(JSON.stringify(store.reports.map(({ publicAttribution }) => publicAttribution)).includes("Private"), false);
});

test("enforces decimal 20 MB per-image and 30 MB combined report limits", async () => {
  const jpeg = (size: number, name: string) => {
    const bytes = new Uint8Array(size);
    bytes.set([0xff, 0xd8, 0xff]);
    return new File([bytes], name, { type: "image/jpeg" });
  };
  const report = (images: File[]) => {
    const form = new FormData();
    form.set("type", "tip");
    form.set("name", "A Hunter");
    form.set("email", "hunter@example.test");
    form.set("locationDescription", "Near waypoint one");
    form.set("details", "Large image boundary test.");
    form.set("cfTurnstileResponse", "human-token");
    for (const image of images) form.append("images", image, image.name);
    return form;
  };

  const acceptedApp = makeApp().app;
  const accepted = await acceptedApp.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: { "idempotency-key": "image-boundary-accepted", origin: "https://www.timlostsomething.com" },
    body: report([jpeg(20_000_000, "accepted.jpg")]),
  });
  assert.equal(accepted.status, 201);

  const oversizedApp = makeApp().app;
  const oversized = await oversizedApp.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: { "idempotency-key": "image-boundary-oversized", origin: "https://www.timlostsomething.com" },
    body: report([jpeg(20_000_001, "oversized.jpg")]),
  });
  assert.equal(oversized.status, 415);
  assert.equal((await responseJson(oversized)).error.code, "invalid_image");

  const combinedApp = makeApp().app;
  const combined = await combinedApp.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: { "idempotency-key": "image-boundary-combined", origin: "https://www.timlostsomething.com" },
    body: report([jpeg(15_000_001, "combined-a.jpg"), jpeg(15_000_000, "combined-b.jpg")]),
  });
  assert.equal(combined.status, 413);
  assert.equal((await responseJson(combined)).error.code, "images_total_too_large");
});

test("dispatches multipart reports by media type essence and preserves case-sensitive boundaries", async () => {
  const { app } = makeApp();
  const boundary = "AaB03xWebKitBoundary";
  const fields = {
    type: "tip",
    name: "A Hunter",
    email: "hunter@example.test",
    locationDescription: "Near waypoint one",
    details: "A browser multipart request.",
    cfTurnstileResponse: "human-token"
  };
  const body =
    Object.entries(fields)
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
      .join("") + `--${boundary}--\r\n`;

  const response = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "idempotency-key": "boundary-key-1",
      origin: "https://www.timlostsomething.com",
      "cf-connecting-ip": "203.0.113.10"
    },
    body
  });

  assert.equal(response.status, 201);
  assert.equal((await responseJson(response)).data.status, "received");
});

test("canonicalizes the apex with method-safe redirects and falls through to static assets", async () => {
  const { app } = makeApp();
  const requestedPaths: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        requestedPaths.push(new URL(request.url).pathname);
        return new Response("static asset", { status: 200 });
      }
    }
  };

  const getResponse = await app.request("http://timlostsomething.com/route?x=1", {}, env as never);
  assert.equal(getResponse.status, 301);
  assert.equal(getResponse.headers.get("location"), "https://www.timlostsomething.com/route?x=1");

  const postResponse = await app.request(
    "https://timlostsomething.com/api/v1/reports",
    { method: "POST", body: "x" },
    env as never
  );
  assert.equal(postResponse.status, 308);
  assert.equal(postResponse.headers.get("location"), "https://www.timlostsomething.com/api/v1/reports");

  const staticResponse = await app.request("https://www.timlostsomething.com/route", {}, env as never);
  assert.equal(await staticResponse.text(), "static asset");
  assert.equal(requestedPaths.at(-1), "/route");
  assert.match(staticResponse.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(staticResponse.headers.get("content-security-policy") ?? "", /challenges\.cloudflare\.com/);
  assert.match(staticResponse.headers.get("content-security-policy") ?? "", /clerk\.timlostsomething\.com/);
  assert.match(staticResponse.headers.get("content-security-policy") ?? "", /clerk\.www\.timlostsomething\.com/);
  assert.equal(staticResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(staticResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(staticResponse.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(self)");
  assert.equal(staticResponse.headers.get("strict-transport-security"), "max-age=31536000");

  for (const legalPath of ["/privacy", "/privacy.html", "/waiver", "/waiver.html"]) {
    const legalResponse = await app.request(`https://www.timlostsomething.com${legalPath}`, {}, env as never);
    assert.match(legalResponse.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
    assert.equal(legalResponse.headers.get("x-frame-options"), "SAMEORIGIN");
  }

  await app.request("https://www.timlostsomething.com/start", {}, env as never);
  assert.equal(requestedPaths.at(-1), "/start");
  await app.request("https://www.timlostsomething.com/ops", {}, env as never);
  assert.equal(requestedPaths.at(-1), "/ops");

  const sponsorsResponse = await app.request("https://www.timlostsomething.com/sponsors", {}, env as never);
  assert.equal(sponsorsResponse.status, 200);
  assert.equal(requestedPaths.at(-1), "/sponsors");

  const fallbackResponse = await app.request("https://seba-treasure-hunt.pages.dev/sponsors?from=pages");
  assert.equal(fallbackResponse.status, 301);
  assert.equal(
    fallbackResponse.headers.get("location"),
    "https://www.timlostsomething.com/sponsors?from=pages"
  );
});

test("unknown routes and removed assets cannot become soft-200 homepages", async () => {
  const { app } = makeApp();
  const env = {
    ASSETS: {
      fetch: async () => new Response("home", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    }
  };

  const known = await app.request("https://www.timlostsomething.com/start", {}, env as never);
  assert.equal(known.status, 200);

  const missingPage = await app.request("https://www.timlostsomething.com/not-a-campaign-route", {}, env as never);
  assert.equal(missingPage.status, 404);
  assert.equal(await missingPage.text(), "Not found");

  const removedAsset = await app.request("https://www.timlostsomething.com/assets/cfcw-logo.png", {}, env as never);
  assert.equal(removedAsset.status, 404);
  assert.equal(removedAsset.headers.get("cache-control"), "no-store");
});
