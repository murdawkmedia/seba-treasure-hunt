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
  nextHunterSignupResendAvailableAt,
  updateHunterSignupResume,
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
    version: 2,
    createdAt: 1_000,
    stage: "awaiting_email_verification",
    emailAddress: "alex.hunter@example.test",
    maskedEmail: "a***@e***.test",
    fullName: "Alex Hunter",
    participationBasis: "adult",
    guardianPermissionAttested: false,
    privacyMediaDocument,
    waiverDocument,
    providerAttemptId: null,
    resendAvailableAt: null,
    finalizationIdempotencyKey: record.finalizationIdempotencyKey,
  });
  for (const secret of ["a-secure-password", "123456", "654321", "sess_secret", "provider-secret", "unknown-value"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test("signup resume parsing discards corrupt, invalid, expired, and version-mismatched records", () => {
  const record = createHunterSignupResume(validDraft, 10_000);
  assert.deepEqual(parseHunterSignupResume(serializeHunterSignupResume(record), 10_001), record);
  assert.equal(parseHunterSignupResume("not-json", 10_001), null);
  assert.equal(parseHunterSignupResume(JSON.stringify({ ...record, version: 1 }), 10_001), null);
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

test("signup resume keeps the active tab session authoritative over a same-email local draft", () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const namespace = "https://validation.example.test:validation";
  const store = createHunterSignupResumeStore({
    sessionStorage: session,
    localStorage: local,
    namespace,
    now: () => 20_000,
  });
  const oldSession = updateHunterSignupResume(createHunterSignupResume(validDraft, 10_000), { providerAttemptId: "sua_tab_a" });
  const newLocal = updateHunterSignupResume(createHunterSignupResume({
    ...validDraft,
    fullName: "New Local Participant",
    privacyMediaDocument: { version: "2026.4", hash: "c".repeat(64) },
  }, 15_000), { providerAttemptId: "sua_tab_b" });
  session.setItem(store.key, serializeHunterSignupResume(oldSession));
  local.setItem(store.key, serializeHunterSignupResume(newLocal));

  assert.deepEqual(store.read(), oldSession);
  assert.deepEqual(parseHunterSignupResume(session.getItem(store.key), 20_000), oldSession);
  assert.deepEqual(parseHunterSignupResume(local.getItem(store.key), 20_000), oldSession);
  const providerB = {
    id: "sua_tab_b", status: "missing_requirements", emailAddress: oldSession.emailAddress,
    unverifiedFields: ["email_address"], missingFields: [],
    verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
  };
  assert.equal(reconcileHunterSignupResume(store.read()!, providerB).state, "lost_attempt");

  const newerSession = createHunterSignupResume({
    ...validDraft,
    fullName: "Newest Session Participant",
    waiverDocument: { version: "2026.5", hash: "d".repeat(64) },
  }, 18_000);
  session.setItem(store.key, serializeHunterSignupResume(newerSession));
  assert.deepEqual(store.read(), newerSession);
  assert.deepEqual(parseHunterSignupResume(local.getItem(store.key), 20_000), newerSession);

  const tiedLocal = createHunterSignupResume({ ...validDraft, fullName: "Tied Local Participant" }, 18_000);
  local.setItem(store.key, serializeHunterSignupResume(tiedLocal));
  assert.deepEqual(store.read(), newerSession, "session tier wins deterministic createdAt ties");
});

test("signup resume uses a stable key and sweeps prior-version records from both tiers", () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const namespace = "https://validation.example.test:validation";
  const store = createHunterSignupResumeStore({
    sessionStorage: session,
    localStorage: local,
    namespace,
    now: () => 20_000,
  });
  assert.equal(store.key, `tim-lost:hunter-signup-resume:${encodeURIComponent(namespace)}`);
  const prior = JSON.stringify({ ...createHunterSignupResume(validDraft, 10_000), version: 0 });
  const legacyKey = `tim-lost:hunter-signup-resume:v0:${encodeURIComponent(namespace)}`;
  session.setItem(store.key, prior);
  local.setItem(store.key, prior);
  session.setItem(legacyKey, prior);
  local.setItem(legacyKey, prior);

  assert.equal(store.read(), null);
  assert.equal(session.values.size, 0);
  assert.equal(local.values.size, 0);
});

test("signup resume reconnects only to the matching provider-managed pending attempt", () => {
  const resume = updateHunterSignupResume(createHunterSignupResume(validDraft, 1_000), { providerAttemptId: "sua_attempt_a" });
  const pending = {
    id: "sua_attempt_a",
    status: "missing_requirements",
    emailAddress: "alex@example.test",
    createdSessionId: null,
    unverifiedFields: ["email_address"],
    missingFields: [],
    verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
  };
  assert.equal(reconcileHunterSignupResume(resume, pending).state, "verification");
  assert.equal(reconcileHunterSignupResume(resume, null).state, "lost_attempt");
  assert.equal(reconcileHunterSignupResume(resume, { ...pending, id: "sua_attempt_b" }).state, "lost_attempt");
  assert.equal(reconcileHunterSignupResume(resume, { ...pending, emailAddress: "other@example.test" }).state, "lost_attempt");
  assert.equal(reconcileHunterSignupResume(resume, {
    ...pending,
    unverifiedFields: [],
    missingFields: ["first_name"],
    verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
  }).state, "unsupported");
});

test("signup resume accepts only a prepared pending email-code provider attempt", () => {
  const resume = updateHunterSignupResume(createHunterSignupResume(validDraft, 1_000), { providerAttemptId: "sua_attempt_a" });
  const prepared = {
    id: "sua_attempt_a",
    status: "missing_requirements",
    emailAddress: "alex@example.test",
    createdSessionId: null,
    unverifiedFields: ["email_address"],
    missingFields: [],
    verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
  };
  assert.equal(reconcileHunterSignupResume(resume, prepared).state, "verification");
  for (const attempt of [
    { ...prepared, verifications: { emailAddress: { status: null, strategy: null } } },
    { ...prepared, verifications: { emailAddress: { status: "failed", strategy: "email_code" } } },
    { ...prepared, verifications: { emailAddress: { status: "expired", strategy: "email_code" } } },
    { ...prepared, verifications: { emailAddress: { status: "verified", strategy: "email_code" } } },
    { ...prepared, verifications: { emailAddress: { status: "unverified", strategy: "email_link" } } },
    { ...prepared, missingFields: ["first_name"] },
    { ...prepared, unverifiedFields: [] },
    { ...prepared, unverifiedFields: ["email_address", "phone_number"] },
  ]) {
    assert.notEqual(reconcileHunterSignupResume(resume, attempt).state, "verification");
  }
});

test("signup resume reports verified persistence per storage tier", () => {
  class DeniedStorage extends MemoryStorage {
    override setItem(): void { throw new Error("denied"); }
  }
  const session = new MemoryStorage();
  const local = new DeniedStorage();
  const store = createHunterSignupResumeStore({ sessionStorage: session, localStorage: local, namespace: "durability" });
  assert.deepEqual(store.write(createHunterSignupResume(validDraft, Date.now())), {
    session: true,
    local: false,
    persisted: true,
  });
  const denied = createHunterSignupResumeStore({
    sessionStorage: new DeniedStorage(), localStorage: new DeniedStorage(), namespace: "denied",
  });
  assert.deepEqual(denied.write(createHunterSignupResume(validDraft, Date.now())), {
    session: false,
    local: false,
    persisted: false,
  });
  const onlyLocal = createHunterSignupResumeStore({
    sessionStorage: new DeniedStorage(), localStorage: new MemoryStorage(), namespace: "session-denied",
  });
  assert.deepEqual(onlyLocal.write(createHunterSignupResume(validDraft, Date.now())), {
    session: false,
    local: true,
    persisted: true,
  });
});

test("signup resume rotates finalization identity only when an accepted legal identity changes", async () => {
  const original = createHunterSignupResume(validDraft, 1_000, "11111111-1111-4111-8111-111111111111");
  const waiverV2 = { version: "2026.3", hash: "c".repeat(64) };
  const changed = updateHunterSignupResume(original, { waiverDocument: waiverV2 });
  assert.notEqual(changed.finalizationIdempotencyKey, original.finalizationIdempotencyKey);
  assert.deepEqual(changed.waiverDocument, waiverV2);
  const sameIdentityRetry = updateHunterSignupResume(changed, { waiverDocument: { ...waiverV2 } });
  assert.equal(sameIdentityRetry.finalizationIdempotencyKey, changed.finalizationIdempotencyKey);
  const normalizedSameIdentityRetry = updateHunterSignupResume(changed, {
    waiverDocument: { ...waiverV2, hash: waiverV2.hash.toUpperCase() },
  });
  assert.equal(normalizedSameIdentityRetry.finalizationIdempotencyKey, changed.finalizationIdempotencyKey);

  let authoritativeAcceptance: Record<string, unknown> | null = {
    documentVersion: original.waiverDocument.version,
    documentHash: original.waiverDocument.hash,
  };
  const acceptedKeys: string[] = [];
  const run = (resume: typeof changed) => completeHunterRegistration({
    bootstrap: async () => {},
    loadState: async () => ({ profileAndPrivacyComplete: true, waiverAcceptance: authoritativeAcceptance }),
    saveProfileAndPrivacy: async () => { throw new Error("profile must already be complete"); },
    fetchWaiverDocument: async () => resume.waiverDocument,
    recordWaiverReview: async () => "review-v2",
    acceptWaiver: async () => {
      acceptedKeys.push(resume.finalizationIdempotencyKey);
      authoritativeAcceptance = { documentVersion: waiverV2.version, documentHash: waiverV2.hash };
      throw new Error("accept response lost after commit");
    },
    refreshDashboard: async () => {},
  });
  await run(changed);
  await run(sameIdentityRetry);
  assert.deepEqual(acceptedKeys, [changed.finalizationIdempotencyKey]);
  assert.deepEqual(authoritativeAcceptance, { documentVersion: waiverV2.version, documentHash: waiverV2.hash });
});

test("resend retry timing honors longer provider metadata while remaining inside the resume lifetime", () => {
  const resume = createHunterSignupResume(validDraft, 1_000, "11111111-1111-4111-8111-111111111111");
  assert.equal(nextHunterSignupResendAvailableAt(resume, 30_000, 10_000), 40_000);
  assert.equal(nextHunterSignupResendAvailableAt(resume, 30_000, 10_000, {
    errors: [{ meta: { retry_after_seconds: 45 } }],
  }), 55_000);
  assert.equal(nextHunterSignupResendAvailableAt(resume, 30_000, 10_000, {
    retryAfter: 50,
    errors: [{ code: "too_many_requests" }],
  }), 60_000);
  assert.equal(
    nextHunterSignupResendAvailableAt(resume, 30_000, resume.createdAt + SIGNUP_RESUME_TTL_MS - 10_000),
    resume.createdAt + SIGNUP_RESUME_TTL_MS - 1,
  );
});

test("signup resume resync never erases its only valid source when canonical writes fail", () => {
  class ToggleStorage extends MemoryStorage {
    denyWrites = false;
    override setItem(key: string, value: string): void {
      if (this.denyWrites) throw new Error("write denied");
      super.setItem(key, value);
    }
  }
  const session = new ToggleStorage();
  const local = new ToggleStorage();
  const namespace = "resync-failure";
  const store = createHunterSignupResumeStore({ sessionStorage: session, localStorage: local, namespace, now: () => 2_000 });
  const record = createHunterSignupResume(validDraft, 1_000, "11111111-1111-4111-8111-111111111111");
  const legacyKey = `tim-lost:hunter-signup-resume:v2:${encodeURIComponent(namespace)}`;
  session.setItem(legacyKey, serializeHunterSignupResume(record));
  session.denyWrites = true;
  local.denyWrites = true;

  assert.deepEqual(store.read(), record);
  assert.equal(session.getItem(legacyKey), serializeHunterSignupResume(record));
  const diagnostics = (store as unknown as { lastPersistence?: () => unknown }).lastPersistence?.();
  assert.deepEqual(diagnostics, { session: false, local: false, persisted: false });
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
    loadState: async () => ({ profileAndPrivacyComplete: false, waiverAcceptance: null }),
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

test("verified signup retry skips profile and waiver writes already accepted authoritatively", async () => {
  const calls: string[] = [];
  const document = { version: "2026.2", hash: "a".repeat(64) };
  await completeHunterRegistration({
    bootstrap: async () => { calls.push("bootstrap"); },
    loadState: async () => ({
      profileAndPrivacyComplete: true,
      waiverAcceptance: { documentVersion: document.version, documentHash: document.hash },
    }),
    saveProfileAndPrivacy: async () => { calls.push("profile"); },
    fetchWaiverDocument: async () => { calls.push("fetch-waiver"); return document; },
    recordWaiverReview: async () => { calls.push("review"); return "review-1"; },
    acceptWaiver: async () => { calls.push("accept"); },
    refreshDashboard: async () => { calls.push("refresh"); },
  });
  assert.deepEqual(calls, ["bootstrap", "fetch-waiver", "refresh"]);
});

test("verified signup reconciles response loss before retrying profile or waiver acceptance", async () => {
  const document = { version: "2026.2", hash: "a".repeat(64) };
  let profileComplete = false;
  let acceptance: Record<string, unknown> | null = null;
  let profileWrites = 0;
  let accepts = 0;
  await completeHunterRegistration({
    bootstrap: async () => {},
    loadState: async () => ({ profileAndPrivacyComplete: profileComplete, waiverAcceptance: acceptance }),
    saveProfileAndPrivacy: async () => {
      profileWrites += 1;
      profileComplete = true;
      throw new Error("profile response lost");
    },
    fetchWaiverDocument: async () => document,
    recordWaiverReview: async () => "review-1",
    acceptWaiver: async () => {
      accepts += 1;
      acceptance = { documentVersion: document.version, documentHash: document.hash };
      throw new Error("accept response lost");
    },
    refreshDashboard: async () => {},
  });
  assert.equal(profileWrites, 1);
  assert.equal(accepts, 1);
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
  try {
    assertReviewedSignupDocumentsCurrent(validDraft, {
      privacyMedia: { ...privacyMediaDocument, version: "2026.4", hash: "c".repeat(64) },
      waiver: waiverDocument,
    });
  } catch (error) {
    assert.deepEqual((error as { changed: unknown }).changed, ["privacy-media"]);
  }
  assert.throws(
    () => assertReviewedSignupDocumentsCurrent(validDraft, {
      privacyMedia: privacyMediaDocument,
      waiver: { ...waiverDocument, hash: "d".repeat(64) },
    }),
    /changed while your email was being verified/i,
  );
  try {
    assertReviewedSignupDocumentsCurrent(validDraft, {
      privacyMedia: privacyMediaDocument,
      waiver: { ...waiverDocument, hash: "d".repeat(64) },
    });
  } catch (error) {
    assert.deepEqual((error as { changed: unknown }).changed, ["waiver"]);
  }
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

test("signup legal acceptance stays checked only when the loaded identity is unchanged", async () => {
  const module = await import("../src/client/dashboard") as Record<string, unknown>;
  assert.equal(typeof module.signupLegalAcceptanceAfterIdentityLoad, "function");
  if (typeof module.signupLegalAcceptanceAfterIdentityLoad !== "function") return;
  const acceptanceAfterLoad = module.signupLegalAcceptanceAfterIdentityLoad as (
    previous: LegalDocumentIdentity | null,
    next: LegalDocumentIdentity,
    accepted: boolean,
  ) => boolean;
  const changed = { version: "2026.3", hash: "d".repeat(64) };
  assert.equal(acceptanceAfterLoad(waiverDocument, waiverDocument, true), true);
  assert.equal(acceptanceAfterLoad(waiverDocument, changed, true), false);
  assert.equal(acceptanceAfterLoad(null, changed, true), false);
  assert.equal(acceptanceAfterLoad(waiverDocument, changed, false), false);
});
