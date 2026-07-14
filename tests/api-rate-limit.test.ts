import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import { D1RateLimiter } from "../src/server/rate-limit";
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

const rateLimitMigration = await readFile(
  path.resolve("migrations", "0009_atomic_rate_limits.sql"),
  "utf8"
);

const createRateLimitDatabase = async (t: test.TestContext) => {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: `rate-limit-${crypto.randomUUID()}` }
  });
  t.after(() => miniflare.dispose());
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  for (const statement of rateLimitMigration.split(";").map((item) => item.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  return db;
};

test("D1 limiter atomically allows no more than the configured concurrent request limit", async (t) => {
  const db = await createRateLimitDatabase(t);
  const now = Date.parse("2026-07-14T18:02:00.000Z");
  const limiter = new D1RateLimiter(db, "test-only-salt", () => now);
  const input = {
    scope: "reply",
    identifiers: ["203.0.113.8", "hunter-subject-1"],
    limit: 5,
    windowSeconds: 600
  };

  const results = await Promise.all(
    Array.from({ length: 40 }, () => limiter.consume(input))
  );

  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.equal(results.filter((result) => !result.allowed).length, 35);
  const row = await db
    .prepare(
      `SELECT identifier_hash, request_count, window_expires_at
       FROM campaign_rate_limit_buckets WHERE scope = ?`
    )
    .bind("reply")
    .first<{ identifier_hash: string; request_count: number; window_expires_at: number }>();
  assert.match(row?.identifier_hash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(row?.request_count, 5);
  assert.equal(row?.window_expires_at, Math.floor(now / 1_000 / 600) * 600 + 600);
});

test("D1 limiter stores only a salted hash and removes expired buckets", async (t) => {
  const db = await createRateLimitDatabase(t);
  const now = Date.parse("2026-07-14T18:02:00.000Z");
  await db
    .prepare(
      `INSERT INTO campaign_rate_limit_buckets
       (scope, identifier_hash, window_started_at, window_expires_at, request_count)
       VALUES ('old', ?, 1, 2, 1)`
    )
    .bind("a".repeat(64))
    .run();
  const limiter = new D1RateLimiter(db, "test-only-salt", () => now);
  await limiter.consume({
    scope: "waiver_accept",
    identifiers: ["ip:203.0.113.8", "subject:hunter-subject-1"],
    limit: 10,
    windowSeconds: 600
  });

  const rows = await db
    .prepare(
      `SELECT scope, identifier_hash FROM campaign_rate_limit_buckets ORDER BY scope`
    )
    .all<{ scope: string; identifier_hash: string }>();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0]?.scope, "waiver_accept");
  assert.match(rows.results[0]?.identifier_hash ?? "", /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(rows.results);
  assert.equal(serialized.includes("203.0.113.8"), false);
  assert.equal(serialized.includes("hunter-subject-1"), false);
});

test("D1 limiter fails closed when its database, salt, or atomic query is unavailable", async () => {
  const unavailableDb = {
    prepare() {
      throw new Error("D1 unavailable");
    }
  };
  const missingDb = new D1RateLimiter(null, "test-only-salt");
  const missingSalt = new D1RateLimiter(unavailableDb as never, null);
  const failedQuery = new D1RateLimiter(unavailableDb as never, "test-only-salt");
  const input = { scope: "report", identifiers: ["anonymous"], limit: 5, windowSeconds: 600 };

  await assert.rejects(missingDb.consume(input), (error: { code?: string }) => error.code === "rate_limit_unavailable");
  await assert.rejects(missingSalt.consume(input), (error: { code?: string }) => error.code === "rate_limit_unavailable");
  await assert.rejects(failedQuery.consume(input), (error: { code?: string }) => error.code === "rate_limit_unavailable");
});

test("the Worker uses the sentinel-protected D1 database for rate limits and has no KV limiter path", async () => {
  const [worker, types, wrangler] = await Promise.all([
    readFile(path.resolve("src", "worker.ts"), "utf8"),
    readFile(path.resolve("src", "server", "types.ts"), "utf8"),
    readFile(path.resolve("wrangler.toml"), "utf8")
  ]);

  assert.match(worker, /new D1RateLimiter\(env\.DB \?\? null, env\.RATE_LIMIT_SALT \?\? null\)/);
  assert.doesNotMatch(worker, /KvRateLimiter|env\.RATE_LIMITS/);
  assert.doesNotMatch(types, /RATE_LIMITS\??:\s*KVNamespace/);
  assert.doesNotMatch(wrangler, /binding\s*=\s*"RATE_LIMITS"/);
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
