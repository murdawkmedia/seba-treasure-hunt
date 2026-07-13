import assert from "node:assert/strict";
import test from "node:test";
import { providerKeyForEnvironment } from "../src/server/provider-environment";

test("accepts Clerk development keys only in validation", () => {
  assert.equal(providerKeyForEnvironment("pk_test_hunter", "validation"), "pk_test_hunter");
  assert.equal(providerKeyForEnvironment("sk_test_hunter", "validation"), "sk_test_hunter");
  assert.equal(providerKeyForEnvironment("pk_test_hunter", "production"), null);
  assert.equal(providerKeyForEnvironment("sk_test_hunter", "production"), null);
});

test("retains live keys in production and fails closed without an environment", () => {
  assert.equal(providerKeyForEnvironment("pk_live_hunter", "production"), "pk_live_hunter");
  assert.equal(providerKeyForEnvironment("sk_live_hunter", "production"), "sk_live_hunter");
  assert.equal(providerKeyForEnvironment("pk_live_hunter", null), null);
  assert.equal(providerKeyForEnvironment(null, "validation"), null);
});
