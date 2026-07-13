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

class CountingTurnstile {
  calls = 0;
  actions: string[] = [];

  async verify(token: string | null, action: string) {
    this.calls += 1;
    this.actions.push(action);
    return token === "human-token";
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
  const store = new FakeStore();
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
