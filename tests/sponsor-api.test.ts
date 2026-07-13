import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { privacyMediaDocument } from "../src/server/legal-documents";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeRateLimits,
  FakeStore,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";
import type { SponsorInquiryInput } from "../src/server/types";

class CountingTurnstile {
  calls = 0;
  actions: string[] = [];

  async verify(token: string | null, action: string) {
    this.calls += 1;
    this.actions.push(action);
    return token === "human-token";
  }
}

class TrackingSponsorStore extends FakeStore {
  sponsorLookups = 0;
  sponsorCreates = 0;

  override async getSponsorInquiryByIdempotencyKey(key: string) {
    this.sponsorLookups += 1;
    return super.getSponsorInquiryByIdempotencyKey(key);
  }

  override async createSponsorInquiry(input: SponsorInquiryInput, key: string) {
    this.sponsorCreates += 1;
    return super.createSponsorInquiry(input, key);
  }
}

const validInquiry = {
  contactName: "Pat Sponsor",
  organization: "Community Co-op",
  email: "SPONSOR@EXAMPLE.TEST",
  phone: "+1 555 010 0200",
  supportType: "community",
  contributionRange: "1000_2499",
  desiredOutcome: "Help make the community treasure hunt welcoming and memorable.",
  acknowledgementAccepted: true,
  acknowledgementVersion: privacyMediaDocument.version,
  cfTurnstileResponse: "human-token"
};

const makeApp = () => {
  const store = new TrackingSponsorStore();
  const turnstile = new CountingTurnstile();
  const rateLimits = new FakeRateLimits();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile,
    uploads: new FakeUploads(),
    rateLimits,
    environment: new FakeEnvironment()
  });
  return { app, store, turnstile, rateLimits };
};

const submit = (app: ReturnType<typeof createApi>, body = validInquiry, key = "sponsor-key-001") =>
  app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(body, {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": key,
      "cf-connecting-ip": "203.0.113.20"
    })
  });

test("accepts a valid public sponsor inquiry and returns only a safe receipt", async () => {
  const { app, store, turnstile, rateLimits } = makeApp();

  const response = await submit(app);
  const body = await responseJson(response);

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body.data).sort(), ["createdAt", "referenceCode", "replayed", "state"]);
  assert.match(body.data.referenceCode, /^SP-[A-Z0-9]{8}$/);
  assert.equal(body.data.state, "received");
  assert.equal(body.data.replayed, false);
  assert.match(body.data.createdAt, /^2026-07-13T/);
  for (const privateField of [
    "id",
    "email",
    "phone",
    "organization",
    "desiredOutcome",
    "acknowledgementVersion",
    "staff",
    "event"
  ]) {
    assert.equal(privateField in body.data, false, `${privateField} must remain private`);
  }
  const stored = (await store.listSponsorInquiries()).items[0];
  assert.equal(stored?.email, "sponsor@example.test");
  assert.equal(stored?.acknowledgementVersion, privacyMediaDocument.version);
  assert.deepEqual(turnstile.actions, ["sponsor_inquiry"]);
  assert.deepEqual(rateLimits.seen[0], {
    scope: "sponsor_inquiry",
    identifiers: ["ip:203.0.113.20"],
    limit: 3,
    windowSeconds: 600
  });
});

test("replays the same sponsor inquiry before rate limiting or Turnstile", async () => {
  const { app, store, turnstile, rateLimits } = makeApp();

  const created = await submit(app);
  const createdBody = await responseJson(created);
  const replay = await submit(app, { ...validInquiry, cfTurnstileResponse: "bad-token" });
  const replayBody = await responseJson(replay);

  assert.equal(created.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replayBody.data.referenceCode, createdBody.data.referenceCode);
  assert.equal(replayBody.data.replayed, true);
  assert.equal((await store.listSponsorInquiries()).items.length, 1);
  assert.equal(rateLimits.seen.length, 1);
  assert.equal(turnstile.calls, 1);
});

test("requires a strict browser origin before sponsor replay lookup", async () => {
  const rejectedOrigins: Array<{ name: string; origin?: string }> = [
    { name: "missing" },
    { name: "null", origin: "null" },
    { name: "malformed", origin: "://not-an-origin" },
    { name: "production http", origin: "http://www.timlostsomething.com" },
    { name: "production alternate port", origin: "https://www.timlostsomething.com:8443" },
    { name: "production suffix lookalike", origin: "https://www.timlostsomething.com.evil.example" },
    { name: "preview suffix lookalike", origin: "https://preview.seba-treasure-hunt.pages.dev.evil.example" },
    { name: "project-prefix lookalike", origin: "https://evilseba-treasure-hunt.pages.dev" },
    { name: "unrelated Pages project", origin: "https://other.pages.dev" },
    { name: "Pages project root", origin: "https://seba-treasure-hunt.pages.dev" }
  ];

  for (const item of rejectedOrigins) {
    const { app, store, rateLimits, turnstile } = makeApp();
    const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
      method: "POST",
      ...json(validInquiry, {
        "idempotency-key": `origin-reject-${item.name.replaceAll(" ", "-")}`,
        ...(item.origin ? { origin: item.origin } : {})
      })
    });

    assert.equal(response.status, 403, item.name);
    assert.equal((await responseJson(response)).error.code, "origin_rejected", item.name);
    assert.equal(store.sponsorLookups, 0, item.name);
    assert.equal(store.sponsorCreates, 0, item.name);
    assert.equal(rateLimits.seen.length, 0, item.name);
    assert.equal(turnstile.calls, 0, item.name);
  }
});

test("accepts canonical, local development, and scoped Pages preview origins", async () => {
  const allowedOrigins = [
    "https://www.timlostsomething.com",
    "http://localhost",
    "http://localhost:8788",
    "https://localhost:3000",
    "http://127.0.0.1:8788",
    "https://validation.seba-treasure-hunt.pages.dev"
  ];

  for (const [index, origin] of allowedOrigins.entries()) {
    const { app } = makeApp();
    const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
      method: "POST",
      ...json(validInquiry, {
        origin,
        "idempotency-key": `origin-allow-${index}`
      })
    });
    assert.equal(response.status, 201, origin);
  }
});

test("rejects invalid sponsor inquiry headers and human-verification", async () => {
  const { app } = makeApp();
  const cases: Array<{ name: string; key?: string; origin?: string; token?: string; status: number; code: string }> = [
    { name: "missing idempotency", key: "", status: 400, code: "idempotency_key_required" },
    { name: "short idempotency", key: "short", status: 400, code: "idempotency_key_required" },
    { name: "cross origin", origin: "https://attacker.example", status: 403, code: "origin_rejected" },
    { name: "failed Turnstile", token: "bad-token", status: 400, code: "human_verification_failed" }
  ];

  for (const item of cases) {
    const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
      method: "POST",
      ...json(
        { ...validInquiry, cfTurnstileResponse: item.token ?? validInquiry.cfTurnstileResponse },
        {
          origin: item.origin ?? "https://www.timlostsomething.com",
          ...(item.key === "" ? {} : { "idempotency-key": item.key ?? `sponsor-${item.name.replaceAll(" ", "-")}` })
        }
      )
    });
    assert.equal(response.status, item.status, item.name);
    assert.equal((await responseJson(response)).error.code, item.code, item.name);
  }
});

test("validates sponsor acknowledgement and private form fields", async () => {
  const cases: Array<{ name: string; patch: Record<string, unknown>; status: number; code: string; field: string }> = [
    { name: "missing acknowledgement", patch: { acknowledgementAccepted: undefined }, status: 422, code: "acknowledgement_required", field: "acknowledgementAccepted" },
    { name: "false acknowledgement", patch: { acknowledgementAccepted: false }, status: 422, code: "acknowledgement_required", field: "acknowledgementAccepted" },
    { name: "old acknowledgement", patch: { acknowledgementVersion: "2025.9" }, status: 409, code: "privacy_version_outdated", field: "acknowledgementVersion" },
    { name: "invalid support type", patch: { supportType: "billboard" }, status: 422, code: "validation_failed", field: "supportType" },
    { name: "invalid contribution range", patch: { contributionRange: "millions" }, status: 422, code: "validation_failed", field: "contributionRange" },
    { name: "invalid email", patch: { email: "not-an-email" }, status: 422, code: "validation_failed", field: "email" },
    { name: "short desired outcome", patch: { desiredOutcome: "Too short" }, status: 422, code: "validation_failed", field: "desiredOutcome" },
    { name: "long desired outcome", patch: { desiredOutcome: "x".repeat(3001) }, status: 422, code: "validation_failed", field: "desiredOutcome" }
  ];

  for (const [index, item] of cases.entries()) {
    const { app } = makeApp();
    const response = await submit(app, { ...validInquiry, ...item.patch } as typeof validInquiry, `sponsor-validation-${index}`);
    const body = await responseJson(response);
    assert.equal(response.status, item.status, item.name);
    assert.equal(body.error.code, item.code, item.name);
    assert.equal(body.error.details.field, item.field, item.name);
  }
});

test("rejects multipart sponsor inquiries and file uploads", async () => {
  const { app } = makeApp();
  const form = new FormData();
  for (const [key, value] of Object.entries(validInquiry)) form.set(key, String(value));
  form.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff])], "proposal.jpg", { type: "image/jpeg" }));

  const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    headers: {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-file-001"
    },
    body: form
  });

  assert.equal(response.status, 415);
  assert.equal((await responseJson(response)).error.code, "unsupported_media_type");
});

test("accepts only the exact application/json media type with optional parameters", async () => {
  const { app } = makeApp();
  const accepted = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    headers: {
      "content-type": "Application/JSON; Charset=UTF-8",
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-json-params"
    },
    body: JSON.stringify(validInquiry)
  });
  assert.equal(accepted.status, 201);

  const rejectedTypes: Array<{ name: string; contentType?: string; body: string }> = [
    { name: "missing", body: JSON.stringify(validInquiry) },
    {
      name: "malformed multipart",
      contentType: "multipart/form-data; boundary=missing-boundary",
      body: "this body has no multipart boundary"
    },
    { name: "JSON Patch", contentType: "application/json-patch+json", body: JSON.stringify(validInquiry) },
    { name: "text prefix", contentType: "text/application/json", body: JSON.stringify(validInquiry) },
    { name: "suffix lookalike", contentType: "application/json-evil", body: JSON.stringify(validInquiry) },
    { name: "substring lookalike", contentType: "x-application/json", body: JSON.stringify(validInquiry) }
  ];

  for (const [index, item] of rejectedTypes.entries()) {
    const fixture = makeApp();
    const response = await fixture.app.request(
      "https://www.timlostsomething.com/api/v1/sponsors/inquiries",
      {
        method: "POST",
        headers: {
          origin: "https://www.timlostsomething.com",
          "idempotency-key": `sponsor-media-${index}`,
          ...(item.contentType ? { "content-type": item.contentType } : {})
        },
        body: item.body
      }
    );
    assert.equal(response.status, 415, item.name);
    assert.equal((await responseJson(response)).error.code, "unsupported_media_type", item.name);
    assert.equal(fixture.turnstile.calls, 0, item.name);
    assert.equal(fixture.store.sponsorCreates, 0, item.name);
    assert.equal((await fixture.store.listSponsorInquiries()).items.length, 0, item.name);
  }
});
