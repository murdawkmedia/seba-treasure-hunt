import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedStaffEmail } from "../src/server/staff-domains";

test("staff self-registration accepts only exact approved company domains", () => {
  assert.equal(isAllowedStaffEmail("operator@sebahub.com"), true);
  assert.equal(isAllowedStaffEmail("Operator@BusinessAsAForceForGood.ca"), true);
  assert.equal(isAllowedStaffEmail("person@sub.sebahub.com"), false);
  assert.equal(isAllowedStaffEmail("person@sebahub.com.evil.test"), false);
  assert.equal(isAllowedStaffEmail("person@businessasaforceforgood.ca.evil.test"), false);
  assert.equal(isAllowedStaffEmail("person@example.com"), false);
  assert.equal(isAllowedStaffEmail(null), false);
});
