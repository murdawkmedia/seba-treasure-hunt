import assert from "node:assert/strict";
import test from "node:test";
import { KvRateLimiter } from "../src/server/rate-limit";

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
