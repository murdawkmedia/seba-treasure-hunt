import assert from "node:assert/strict";
import test from "node:test";
import { featureSwitches } from "../src/server/d1-store";
import { createApi } from "../src/server/app";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  responseJson
} from "./api-test-kit";

test("missing D1 feature rows fail closed instead of enabling community writes", () => {
  assert.deepEqual(featureSwitches([]), {
    boardVisible: false,
    notesEnabled: false,
    repliesEnabled: false
  });
});

test("only explicit enabled values open a community feature", () => {
  assert.deepEqual(
    featureSwitches([
      { key: "board_visible", enabled: 1 },
      { key: "notes_enabled", enabled: 0 },
      { key: "replies_enabled", enabled: 1 }
    ]),
    { boardVisible: true, notesEnabled: false, repliesEnabled: true }
  );
});

test("does not expose sponsor lead enumeration, contact, proposal, or lookup routes", async () => {
  const app = createApi({
    store: new FakeStore(),
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    environment: new FakeEnvironment()
  });
  const paths = [
    "/api/v1/sponsors/inquiries",
    "/api/v1/sponsors/inquiries/SP-00000001",
    "/api/v1/sponsors/leads",
    "/api/v1/sponsors/contacts",
    "/api/v1/sponsors/proposals"
  ];

  for (const path of paths) {
    for (const method of ["GET", "HEAD"]) {
      const response = await app.request(`https://www.timlostsomething.com${path}`, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      if (method === "GET") assert.equal((await responseJson(response)).error.code, "not_found");
    }
  }
});
