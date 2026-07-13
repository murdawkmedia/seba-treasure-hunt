import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeIdentity,
  FakeEnvironment,
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
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile,
    uploads,
    rateLimits,
    environment: new FakeEnvironment()
  });
  return { app, store, uploads, rateLimits };
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
    staffAccountPortalUrl: "https://ops-accounts.example.test"
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

test("serves only a D1-authorized ready derivative without exposing its R2 key", async () => {
  const store = new FakeStore();
  store.publicMedia.set("media-ready", {
    key: "derivatives/media-ready.webp",
    contentType: "image/webp"
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
  const { app, store, rateLimits } = makeApp();
  const report = {
    type: "tip",
    name: "A Hunter",
    email: "hunter@example.test",
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
  assert.equal(rateLimits.seen.filter((entry) => entry.scope === "report").length, 2);
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
    headers: { "idempotency-key": "find-key-1" },
    body: missingPhoto
  });
  assert.equal(rejected.status, 422);
  assert.equal((await responseJson(rejected)).error.code, "photo_required");

  const withPhoto = new FormData();
  for (const [key, value] of missingPhoto.entries()) withPhoto.append(key, value);
  withPhoto.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "find.jpg", { type: "image/jpeg" }));
  const accepted = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: { "idempotency-key": "find-key-2" },
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
    headers: { "idempotency-key": "find-key-2" },
    body: withPhoto
  });
  assert.equal(retry.status, 200);
  assert.equal(uploads.saved.length, 1, "an idempotent retry must not create an orphan upload");
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
  assert.equal(staticResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(staticResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(staticResponse.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(self)");
  assert.equal(staticResponse.headers.get("strict-transport-security"), "max-age=31536000");

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
