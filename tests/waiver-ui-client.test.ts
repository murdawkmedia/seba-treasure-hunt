import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWaiverPayload,
  validateWaiverDraft,
  type WaiverDraft,
} from "../src/client/dashboard";

const validDraft: WaiverDraft = {
  reviewEventId: "review-1",
  version: "2026.1",
  hash: "a".repeat(64),
  waiverAccepted: true,
  guardianAttested: true,
  minors: [{ fullName: " Sam Hunter ", birthYear: "2014" }],
};

test("waiver draft validates a reviewed document and normalizes covered minors", () => {
  assert.deepEqual(validateWaiverDraft(validDraft), {});
  assert.deepEqual(buildWaiverPayload(validDraft), {
    reviewEventId: "review-1",
    version: "2026.1",
    hash: "a".repeat(64),
    waiverAccepted: true,
    guardianAttested: true,
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
  });
});

test("waiver acceptance stays locked until the current document review is recorded", () => {
  const errors = validateWaiverDraft({
    ...validDraft,
    reviewEventId: "",
    version: "",
    hash: "",
  });
  assert.equal(errors.review, "Open and review the current participation waiver before accepting it.");
});

test("waiver draft requires acceptance and validates minor names and birth years", () => {
  const currentYear = new Date().getFullYear();
  const errors = validateWaiverDraft({
    ...validDraft,
    waiverAccepted: false,
    minors: [
      { fullName: " ", birthYear: "2014" },
      { fullName: "A".repeat(101), birthYear: String(currentYear + 1) },
    ],
  });
  assert.equal(errors.waiverAccepted, "Accept the participation waiver to register.");
  assert.equal(errors.minors, "Enter each minor's full name (1–100 characters) and a valid minor birth year.");
});

test("guardian confirmation is required only when minors are listed", () => {
  assert.equal(
    validateWaiverDraft({ ...validDraft, guardianAttested: false }).guardianAttested,
    "Confirm that you are the parent or legal guardian of every listed minor.",
  );
  assert.deepEqual(
    validateWaiverDraft({ ...validDraft, guardianAttested: false, minors: [] }),
    {},
  );
});

test("one adult can cover no more than ten supervised minors", () => {
  const minors = Array.from({ length: 11 }, (_, index) => ({
    fullName: `Minor ${index + 1}`,
    birthYear: "2014",
  }));
  assert.equal(
    validateWaiverDraft({ ...validDraft, minors }).minors,
    "Add no more than 10 supervised minors.",
  );
});
