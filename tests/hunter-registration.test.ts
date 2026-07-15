import assert from "node:assert/strict";
import test from "node:test";

import {
  completeHunterRegistration,
  validateHunterSignupDraft,
  type HunterSignupDraft,
} from "../src/client/dashboard";

const validDraft: HunterSignupDraft = {
  fullName: "Alex Hunter",
  emailAddress: "alex@example.test",
  password: "a-secure-password",
  confirmation: "a-secure-password",
  adultAttested: true,
  privacyMediaReviewed: true,
  privacyMediaAccepted: true,
  waiverReviewed: true,
  waiverAccepted: true,
};

test("hunter signup cannot reach Clerk before both current legal documents are reviewed and accepted", () => {
  assert.deepEqual(validateHunterSignupDraft(validDraft), {});
  assert.deepEqual(validateHunterSignupDraft({ ...validDraft, privacyMediaReviewed: false }), {
    privacyMedia: "Open and review the current Privacy Policy & Media Notice, then accept it.",
  });
  assert.deepEqual(validateHunterSignupDraft({ ...validDraft, waiverAccepted: false }), {
    waiver: "Open and review the current Participation Waiver, then accept it.",
  });
});

test("verified signup finalization writes profile and legal records before refreshing protected data", async () => {
  const calls: string[] = [];
  const document = { version: "2026.1", hash: "a".repeat(64) };
  await completeHunterRegistration({
    bootstrap: async () => { calls.push("bootstrap"); },
    saveProfileAndPrivacy: async () => { calls.push("profile"); },
    fetchWaiverDocument: async () => { calls.push("fetch-waiver"); return document; },
    recordWaiverReview: async (value) => { assert.equal(value, document); calls.push("review"); return "review-1"; },
    acceptWaiver: async (value, reviewId) => {
      assert.equal(value, document);
      assert.equal(reviewId, "review-1");
      calls.push("accept");
    },
    refreshDashboard: async () => { calls.push("refresh"); },
  });
  assert.deepEqual(calls, ["bootstrap", "profile", "fetch-waiver", "review", "accept", "refresh"]);
});
