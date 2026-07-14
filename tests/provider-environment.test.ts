import assert from "node:assert/strict";
import test from "node:test";
import {
  providerKeyForEnvironment,
  publicUrlForEnvironment
} from "../src/server/provider-environment";

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

test("rejects Clerk live keys in validation", () => {
  assert.equal(providerKeyForEnvironment("pk_live_hunter", "validation"), null);
  assert.equal(providerKeyForEnvironment("sk_live_hunter", "validation"), null);
});

test("fails closed for an unknown runtime environment", () => {
  const unknownEnvironment = "staging" as never;
  assert.equal(providerKeyForEnvironment("pk_test_hunter", unknownEnvironment), null);
  assert.equal(
    publicUrlForEnvironment("https://www.timlostsomething.com/dashboard", unknownEnvironment),
    null
  );
});

test("accepts only environment-scoped configured campaign links", () => {
  const validationOrigin = "https://codex-validation.seba-treasure-hunt.pages.dev";

  assert.equal(
    publicUrlForEnvironment(`${validationOrigin}/dashboard`, "validation"),
    `${validationOrigin}/dashboard`
  );
  assert.equal(
    publicUrlForEnvironment("https://www.timlostsomething.com/dashboard", "validation"),
    null
  );
  assert.equal(
    publicUrlForEnvironment(
      "https://feature-branch.seba-treasure-hunt.pages.dev/dashboard",
      "validation"
    ),
    null
  );
  assert.equal(publicUrlForEnvironment(`${validationOrigin}/waiver`, "production"), null);
  assert.equal(
    publicUrlForEnvironment("http://www.timlostsomething.com/dashboard", "production"),
    null
  );
});
