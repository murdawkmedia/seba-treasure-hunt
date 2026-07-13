import assert from "node:assert/strict";
import test from "node:test";
import { validateTarget, verifySummary } from "../scripts/verify-environment.mjs";

const ready = {
  environment: "validation",
  state: "open",
  publishedWaypoints: 12,
  publishedRules: 1,
  publishedZones: 2,
  featureFlags: 3,
  playerAccounts: 0,
  hunterProfiles: 0,
  reports: 0,
  fieldNotes: 0,
  staffPrincipals: 0
};

test("accepts only an explicitly validation-suffixed target", () => {
  assert.deepEqual(
    validateTarget("tim-lost-hunter-platform-validation", "validation"),
    { database: "tim-lost-hunter-platform-validation", expected: "validation" }
  );
  assert.throws(
    () => validateTarget("tim-lost-hunter-platform", "validation"),
    /validation-suffixed/i
  );
  assert.throws(
    () => validateTarget("tim-lost-hunter-platform-validation", "production"),
    /validation verifier/i
  );
});

test("verifies public seed counts without accepting personal validation data", () => {
  assert.deepEqual(verifySummary(ready, "validation"), ready);
  assert.throws(() => verifySummary({ ...ready, environment: "production" }, "validation"), /sentinel/i);
  assert.throws(() => verifySummary({ ...ready, publishedWaypoints: 11 }, "validation"), /waypoints/i);
  assert.throws(() => verifySummary({ ...ready, playerAccounts: 1 }, "validation"), /personal/i);
});
