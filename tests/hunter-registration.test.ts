import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewedSignupDocumentsCurrent,
  completeHunterRegistration,
  prepareSignupLegalReview,
  validateHunterSignupDraft,
  type LegalDocumentIdentity,
  type HunterSignupDraft,
} from "../src/client/dashboard";

const privacyMediaDocument: LegalDocumentIdentity = {
  version: "2026.3",
  hash: "a".repeat(64),
};

const waiverDocument: LegalDocumentIdentity = {
  version: "2026.2",
  hash: "b".repeat(64),
};

const validDraft: HunterSignupDraft = {
  fullName: "Alex Hunter",
  emailAddress: "alex@example.test",
  password: "a-secure-password",
  confirmation: "a-secure-password",
  participationBasis: "adult",
  guardianPermissionAttested: false,
  privacyMediaReviewed: true,
  privacyMediaAccepted: true,
  privacyMediaDocument,
  waiverReviewed: true,
  waiverAccepted: true,
  waiverDocument,
};

test("hunter signup requires direct legal acceptance but does not require opening either document", () => {
  assert.deepEqual(validateHunterSignupDraft(validDraft), {});
  assert.deepEqual(validateHunterSignupDraft({ ...validDraft, privacyMediaReviewed: false, waiverReviewed: false }), {});
  assert.deepEqual(validateHunterSignupDraft({ ...validDraft, waiverAccepted: false }), {
    waiver: "Accept the current Participation Waiver.",
  });
});

test("hunter signup accepts either an adult basis or guardian-permitted minor basis", () => {
  assert.deepEqual(validateHunterSignupDraft({
    ...validDraft,
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: false,
  }), {
    guardianPermission: "Confirm that your parent or legal guardian reviewed the documents, gave permission, and will supervise your participation.",
  });
  assert.deepEqual(validateHunterSignupDraft({
    ...validDraft,
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: true,
  }), {});
});

test("verified signup finalization writes profile and legal records before refreshing protected data", async () => {
  const calls: string[] = [];
  const document = { version: "2026.2", hash: "a".repeat(64) };
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

test("verified signup rejects legal documents that changed during email verification", () => {
  assert.doesNotThrow(() => assertReviewedSignupDocumentsCurrent(validDraft, {
    privacyMedia: privacyMediaDocument,
    waiver: waiverDocument,
  }));

  assert.throws(
    () => assertReviewedSignupDocumentsCurrent(validDraft, {
      privacyMedia: { ...privacyMediaDocument, version: "2026.4", hash: "c".repeat(64) },
      waiver: waiverDocument,
    }),
    /changed while your email was being verified/i,
  );
  assert.throws(
    () => assertReviewedSignupDocumentsCurrent(validDraft, {
      privacyMedia: privacyMediaDocument,
      waiver: { ...waiverDocument, hash: "d".repeat(64) },
    }),
    /changed while your email was being verified/i,
  );
});

test("legal signup review requires exact document versions and hashes", () => {
  assert.deepEqual(validateHunterSignupDraft({
    ...validDraft,
    privacyMediaDocument: null,
  }), {
    privacyMedia: "The current Privacy Policy & Media Notice is unavailable. Refresh and try again.",
  });
  assert.deepEqual(validateHunterSignupDraft({
    ...validDraft,
    waiverDocument: { version: "2026.2", hash: "not-a-document-hash" },
  }), {
    waiver: "The current Participation Waiver is unavailable. Refresh and try again.",
  });
});

test("signup legal review loads the fetched identity without changing acceptance state", async () => {
  let finishLoad!: () => void;
  const loaded = new Promise<void>((resolve) => { finishLoad = resolve; });
  const events: string[] = [];
  let viewerUrl = "";
  const review = prepareSignupLegalReview({
    kind: "privacy-media",
    identity: { version: "2026.4", hash: "c".repeat(64) },
    loadViewer: async (url) => {
      viewerUrl = url;
      events.push("load-start");
      await loaded;
      events.push("load-complete");
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ["load-start"]);
  assert.equal(
    viewerUrl,
    `/privacy.html?embed=signup&documentVersion=2026.4&documentHash=${"c".repeat(64)}#media-notice`,
  );

  finishLoad();
  assert.equal(await review, viewerUrl);
  assert.deepEqual(events, ["load-start", "load-complete"]);
});

test("opening a changed signup legal identity never changes prior acceptance", async () => {
  let accepted = true;
  await prepareSignupLegalReview({
    kind: "waiver",
    identity: { version: "2026.3", hash: "d".repeat(64) },
    loadViewer: async (url) => {
      assert.equal(
        url,
        `/waiver.html?embed=signup&documentVersion=2026.3&documentHash=${"d".repeat(64)}`,
      );
      assert.equal(accepted, true, "loading is independent from the participant's acceptance control");
    },
  });
  assert.equal(accepted, true);
});
