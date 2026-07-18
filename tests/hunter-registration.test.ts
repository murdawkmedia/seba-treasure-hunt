import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewedSignupDocumentsCurrent,
  completeSignupEmailVerification,
  completeHunterRegistration,
  hunterSignupDraftFromResume,
  prepareSignupLegalReview,
  validateHunterSignupDraft,
  type LegalDocumentIdentity,
  type HunterSignupDraft,
} from "../src/client/dashboard";
import {
  SIGNUP_RESUME_TTL_MS,
  createHunterSignupResume,
  createHunterSignupResumeStore,
  parseHunterSignupResume,
  reconcileHunterSignupResume,
  serializeHunterSignupResume,
  type SignupResumeStorage,
} from "../src/client/hunter-signup-resume";

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

class MemoryStorage implements SignupResumeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("signup resume records whitelist only non-secret normalized onboarding fields", () => {
  const record = createHunterSignupResume({
    ...validDraft,
    emailAddress: "  Alex.Hunter@Example.TEST ",
    verificationCode: "123456",
    sessionToken: "sess_secret",
    arbitrary: "must-not-survive",
  }, 1_000);
  const serialized = serializeHunterSignupResume({
    ...record,
    password: "a-secure-password",
    resetCode: "654321",
    providerSecret: "provider-secret",
    unknownField: "unknown-value",
  });

  assert.deepEqual(JSON.parse(serialized), {
    version: 1,
    createdAt: 1_000,
    stage: "awaiting_email_verification",
    emailAddress: "alex.hunter@example.test",
    maskedEmail: "a***@e***.test",
    fullName: "Alex Hunter",
    participationBasis: "adult",
    guardianPermissionAttested: false,
    privacyMediaDocument,
    waiverDocument,
  });
  for (const secret of ["a-secure-password", "123456", "654321", "sess_secret", "provider-secret", "unknown-value"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test("signup resume parsing discards corrupt, invalid, expired, and version-mismatched records", () => {
  const record = createHunterSignupResume(validDraft, 10_000);
  assert.deepEqual(parseHunterSignupResume(serializeHunterSignupResume(record), 10_001), record);
  assert.equal(parseHunterSignupResume("not-json", 10_001), null);
  assert.equal(parseHunterSignupResume(JSON.stringify({ ...record, version: 2 }), 10_001), null);
  assert.equal(parseHunterSignupResume(JSON.stringify({ ...record, emailAddress: "not-an-email" }), 10_001), null);
  assert.equal(parseHunterSignupResume(JSON.stringify({ ...record, stage: "password_collected" }), 10_001), null);
  assert.equal(parseHunterSignupResume(serializeHunterSignupResume(record), 10_000 + SIGNUP_RESUME_TTL_MS), null);
});

test("signup resume survives a fresh tab session through the bounded local fallback", () => {
  const firstSession = new MemoryStorage();
  const local = new MemoryStorage();
  const firstStore = createHunterSignupResumeStore({
    sessionStorage: firstSession,
    localStorage: local,
    namespace: "https://validation.example.test:validation",
    now: () => 5_000,
  });
  const resume = createHunterSignupResume(validDraft, 5_000);
  firstStore.write(resume);

  const afterEmailAppRoundTrip = createHunterSignupResumeStore({
    sessionStorage: new MemoryStorage(),
    localStorage: local,
    namespace: "https://validation.example.test:validation",
    now: () => 5_001,
  });
  assert.deepEqual(afterEmailAppRoundTrip.read(), resume);
  afterEmailAppRoundTrip.clear();
  assert.equal(afterEmailAppRoundTrip.read(), null);
  assert.equal(local.values.size, 0);
});

test("signup resume reconnects only to the matching provider-managed pending attempt", () => {
  const resume = createHunterSignupResume(validDraft, 1_000);
  const pending = {
    status: "missing_requirements",
    emailAddress: "alex@example.test",
    createdSessionId: null,
    unverifiedFields: ["email_address"],
    missingFields: [],
    verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
  };
  assert.equal(reconcileHunterSignupResume(resume, pending).state, "verification");
  assert.equal(reconcileHunterSignupResume(resume, null).state, "lost_attempt");
  assert.equal(reconcileHunterSignupResume(resume, { ...pending, emailAddress: "other@example.test" }).state, "lost_attempt");
  assert.equal(reconcileHunterSignupResume(resume, {
    ...pending,
    unverifiedFields: [],
    missingFields: ["first_name"],
    verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
  }).state, "unsupported");
});

test("successful verification after reload finalizes from the recovered safe draft and clears it", async () => {
  const resume = createHunterSignupResume(validDraft, 1_000);
  const calls: string[] = [];
  await completeSignupEmailVerification({
    code: "123456",
    resume,
    attemptVerification: async (code) => {
      assert.equal(code, "123456");
      calls.push("verify");
      return { status: "complete", createdSessionId: "session-1" };
    },
    activateSession: async (sessionId) => {
      assert.equal(sessionId, "session-1");
      calls.push("activate");
      return true;
    },
    finalize: async (draft) => {
      assert.deepEqual(draft, hunterSignupDraftFromResume(resume));
      calls.push("finalize");
    },
    clearResume: () => { calls.push("clear"); },
  });
  assert.deepEqual(calls, ["verify", "activate", "finalize", "clear"]);
});

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
