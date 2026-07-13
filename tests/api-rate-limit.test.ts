import assert from "node:assert/strict";
import test from "node:test";
import { KvRateLimiter } from "../src/server/rate-limit";
import { createApi } from "../src/server/app";
import { privacyMediaDocument } from "../src/server/legal-documents";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";

class MemoryKv {
  values = new Map<string, string>();
  keys: string[] = [];

  async get(key: string) {
    this.keys.push(key);
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.keys.push(key);
    this.values.set(key, value);
  }
}

test("KV limiter hashes client identifiers before constructing a key", async () => {
  const kv = new MemoryKv();
  const limiter = new KvRateLimiter(kv as never, "test-only-salt");
  const input = {
    scope: "reply",
    identifiers: ["203.0.113.8", "hunter-subject-1"],
    limit: 1,
    windowSeconds: 600
  };

  const first = await limiter.consume(input);
  const second = await limiter.consume(input);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.ok(kv.keys.length > 0);
  for (const key of kv.keys) {
    assert.equal(key.includes("203.0.113.8"), false);
    assert.equal(key.includes("hunter-subject-1"), false);
    assert.match(key, /^rl:v1:reply:[a-f0-9]{64}:\d+$/);
  }
});

test("KV limiter fails closed when its binding or salt is unavailable", async () => {
  const missingKv = new KvRateLimiter(null, "salt");
  const missingSalt = new KvRateLimiter(new MemoryKv() as never, null);
  const input = { scope: "report", identifiers: ["anonymous"], limit: 5, windowSeconds: 600 };

  await assert.rejects(missingKv.consume(input), (error: { code?: string }) => error.code === "rate_limit_unavailable");
  await assert.rejects(missingSalt.consume(input), (error: { code?: string }) => error.code === "rate_limit_unavailable");
});

const sponsorBody = {
  contactName: "Rate Limit Sponsor",
  organization: "Community Co-op",
  email: "sponsor@example.test",
  supportType: "lead",
  contributionRange: "2500_4999",
  desiredOutcome: "Support a safe and memorable community event.",
  acknowledgementAccepted: true,
  acknowledgementVersion: privacyMediaDocument.version,
  cfTurnstileResponse: "human-token"
};

test("limits the fourth unique sponsor inquiry in ten minutes", async () => {
  const limiter = new FakeRateLimits();
  const app = createApi({
    store: new FakeStore(),
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: limiter,
    environment: new FakeEnvironment()
  });

  for (let index = 1; index <= 4; index += 1) {
    const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
      method: "POST",
      ...json(sponsorBody, {
        origin: "https://www.timlostsomething.com",
        "cf-connecting-ip": "203.0.113.44",
        "idempotency-key": `sponsor-rate-${index}`
      })
    });
    assert.equal(response.status, index <= 3 ? 201 : 429);
    if (index === 4) {
      assert.equal((await responseJson(response)).error.code, "rate_limit_exceeded");
      assert.equal(response.headers.get("retry-after"), "600");
    }
  }
});

test("fails closed before sponsor inquiry mutation when rate limiting is unavailable", async () => {
  const store = new FakeStore();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    environment: new FakeEnvironment()
  });
  const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(sponsorBody, {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-no-limit"
    })
  });

  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, "rate_limit_unavailable");
  assert.equal((await store.listSponsorInquiries()).items.length, 0);
});
