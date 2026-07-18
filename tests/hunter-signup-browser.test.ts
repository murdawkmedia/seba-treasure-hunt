import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";

const origin = "https://signup.test";
const namespace = `${origin}:validation`;
const storageKey = `tim-lost:hunter-signup-resume:${encodeURIComponent(namespace)}`;
const privacy = { version: "2026.3", hash: "a".repeat(64) };
const waiver = { version: "2026.2", hash: "b".repeat(64) };

let browser: Browser;
let dashboardBundle = "";

before(async () => {
  browser = await chromium.launch({ headless: true });
  const output = await build({
    absWorkingDir: new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"),
    entryPoints: ["src/client/dashboard.ts"],
    bundle: true,
    format: "iife",
    globalName: "DashboardTestModule",
    platform: "browser",
    write: false,
  });
  dashboardBundle = output.outputFiles[0]?.text ?? "";
});

after(async () => {
  await browser?.close();
});

function resumeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    createdAt: Date.now() - 1_000,
    stage: "awaiting_email_verification",
    emailAddress: "alex@example.test",
    maskedEmail: "a***@e***.test",
    fullName: "Alex Hunter",
    participationBasis: "adult",
    guardianPermissionAttested: false,
    privacyMediaDocument: privacy,
    waiverDocument: waiver,
    providerAttemptId: "sua_attempt_a",
    resendAvailableAt: null,
    finalizationIdempotencyKey: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

async function signupPage(context?: BrowserContext): Promise<Page> {
  const page = context ? await context.newPage() : await browser.newPage();
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let livePrivacy = privacy;
  let liveWaiver = waiver;
  let legalFetchFailure = false;
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/dashboard") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    if (url.pathname === "/api/v1/config") {
      if (legalFetchFailure) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Legal documents are temporarily unavailable." } }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            hunterPublishableKey: null,
            deploymentEnvironment: "validation",
            privacyMediaVersion: livePrivacy.version,
            privacyMediaHash: livePrivacy.hash,
            waiverVersion: liveWaiver.version,
            waiverHash: liveWaiver.hash,
          },
        }),
      });
      return;
    }
    if (url.pathname === "/privacy.html" || url.pathname === "/waiver.html") {
      const kind = url.pathname === "/privacy.html" ? "privacy" : "waiver";
      const identity = kind === "privacy" ? livePrivacy : liveWaiver;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<script>parent.postMessage(${JSON.stringify({
          type: "tim-lost:legal-embed-ready",
          embed: "signup",
          route: kind,
          version: identity.version,
          hash: identity.hash,
        })}, ${JSON.stringify(origin)});<\/script>`,
      });
      return;
    }
    if (url.pathname === "/api/v1/legal/waiver") {
      if (legalFetchFailure) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Waiver is temporarily unavailable." } }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { document: { ...liveWaiver, title: "Participation Waiver", sections: [] } } }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${origin}/dashboard`);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__timLostDisableAutoInitialize = true;
  });
  await page.addScriptTag({ content: dashboardBundle });
  await page.evaluate(() => {
    const module = (window as unknown as Record<string, Record<string, unknown>>).DashboardTestModule;
    if (typeof module?.setupAccountFormsForTest !== "function") {
      throw new Error("setupAccountFormsForTest export is unavailable");
    }
  });
  (page as Page & { setLegal?: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal = (nextPrivacy, nextWaiver) => {
    livePrivacy = nextPrivacy;
    liveWaiver = nextWaiver;
  };
  (page as Page & { setLegalFetchFailure?: (value: boolean) => void }).setLegalFetchFailure = (value) => {
    legalFetchFailure = value;
  };
  return page;
}

async function installResume(page: Page, tier: "session" | "local", record: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ key, serialized, tierName }) => {
    window[tierName === "session" ? "sessionStorage" : "localStorage"].setItem(key, serialized);
  }, { key: storageKey, serialized: JSON.stringify(record), tierName: tier });
}

async function setup(page: Page, providerAttempt: Record<string, unknown> | null, cooldownMs = 200): Promise<string> {
  const source = String.raw`
    let hydrated = attempt ? { ...attempt } : null;
    if (hydrated) {
    hydrated.create = async function () {
      window.__createCalls = Number(window.__createCalls || 0) + 1;
      if (window.__createGate) await window.__createGate;
      window.__createCompleted = Number(window.__createCompleted || 0) + 1;
      if (window.__createFailure === true) throw new Error("Account provider response was interrupted.");
      return hydrated;
    };
    hydrated.prepareEmailAddressVerification = async function () {
      window.__resendCalls = Number(window.__resendCalls || 0) + 1;
      if (window.__prepareGate) await window.__prepareGate;
      window.__prepareCompleted = Number(window.__prepareCompleted || 0) + 1;
      if (window.__resendFailure === true) {
        throw {
          retryAfter: window.__retryAfterSeconds,
          errors: [{ longMessage: "Please wait before requesting another code." }],
        };
      }
      if (window.__prepareUnprepared === true) {
        return {
          ...hydrated,
          verifications: { emailAddress: { status: null, strategy: null } },
        };
      }
      return hydrated;
    };
    hydrated.attemptEmailAddressVerification = async function (input) {
      window.__verificationCalls = Number(window.__verificationCalls || 0) + 1;
      window.__attemptedCode = input.code;
      if (window.__verificationGate) await window.__verificationGate;
      return { ...hydrated, status: "complete", createdSessionId: "session-1", unverifiedFields: [] };
    };
    }
    const clerk = {
      client: { signUp: hydrated, signIn: { create: async function () { return {}; } } },
      user: null,
      session: null,
      setActive: async function () {},
      signOut: async function () {},
    };
    return window.DashboardTestModule.setupAccountFormsForTest({
      clerk,
      config: {
        hunterPublishableKey: "pk_test_local",
        deploymentEnvironment: "validation",
        privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
        waiver: { version: "2026.2", hash: "b".repeat(64) },
      },
      auth: { getToken: async function () { return null; } },
      activateSession: async function (sessionId) {
        window.__activationCalls = Number(window.__activationCalls || 0) + 1;
        if (Number(window.__activationFailuresRemaining || 0) > 0) {
          window.__activationFailuresRemaining = Number(window.__activationFailuresRemaining) - 1;
          return false;
        }
        window.__activatedSession = sessionId;
        return true;
      },
      finalizeSignup: async function (draft) {
        window.__finalizeCalls = Number(window.__finalizeCalls || 0) + 1;
        window.__finalizationKeys = [...(window.__finalizationKeys || []), draft.finalizationIdempotencyKey];
        if (Array.isArray(window.__legalChanged)) {
          throw new window.DashboardTestModule.SignupLegalDocumentsChangedError(window.__legalChanged);
        }
        if (window.__authoritativeWriteDone !== true) {
          window.__authoritativeWriteDone = true;
          window.__authoritativeWriteCalls = Number(window.__authoritativeWriteCalls || 0) + 1;
        }
        if (Number(window.__finalizeFailuresRemaining || 0) > 0) {
          window.__finalizeFailuresRemaining = Number(window.__finalizeFailuresRemaining) - 1;
          throw new Error("The authoritative account update was interrupted.");
        }
        window.__finalizedDraft = draft;
      },
      resendCooldownMs: cooldown,
    });
  `;
  return page.evaluate(({ attempt, cooldown, body }) => (
    new Function("attempt", "cooldown", body)(attempt, cooldown)
  ), { attempt: providerAttempt, cooldown: cooldownMs, body: source });
}

async function installOperationGate(page: Page, kind: "create" | "prepare"): Promise<void> {
  await page.evaluate((gateKind) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state = window as unknown as Record<string, unknown>;
    state[gateKind === "create" ? "__createGate" : "__prepareGate"] = gate;
    state[gateKind === "create" ? "__releaseCreate" : "__releasePrepare"] = release;
  }, kind);
}

async function fillValidSignup(page: Page): Promise<void> {
  await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
  await page.locator('#hunter-sign-up-form [name="fullName"]').fill("Alex Hunter");
  await page.locator('#hunter-sign-up-form [name="email"]').fill("alex@example.test");
  await page.locator('#hunter-sign-up-form [name="password"]').fill("a-secure-password");
  await page.locator('#hunter-sign-up-form [name="confirmPassword"]').fill("a-secure-password");
  await page.locator('#hunter-sign-up-form [name="participationBasis"][value="adult"]').check();
  await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
  await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
}

const preparedAttempt = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "sua_attempt_a",
  status: "missing_requirements",
  emailAddress: "alex@example.test",
  createdSessionId: null,
  unverifiedFields: ["email_address"],
  missingFields: [],
  verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
  ...overrides,
});

test("real signup legal review clears only the acceptance whose loaded identity changed", async () => {
  const page = await signupPage();
  try {
    await setup(page, { status: null, emailAddress: null });
    await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    const changedPrivacy = { version: "2026.4", hash: "c".repeat(64) };
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(changedPrivacy, waiver);
    await page.locator('[data-signup-review="privacy-media"]').click();
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('[data-signup-dialog="privacy-media"] iframe')?.hidden === false);
    assert.equal(await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').isChecked(), false);
    assert.equal(await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').isChecked(), true);
    await page.locator('[data-signup-dialog="privacy-media"] [data-signup-dialog-close]').first().click();

    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('[data-signup-review="privacy-media"]').click();
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('[data-signup-dialog="privacy-media"] iframe')?.hidden === false);
    assert.equal(await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').isChecked(), true);
    await page.locator('[data-signup-dialog="privacy-media"] [data-signup-dialog-close]').first().click();

    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    const changedWaiver = { version: "2026.3", hash: "d".repeat(64) };
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(changedPrivacy, changedWaiver);
    await page.locator('[data-signup-review="waiver"]').click();
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('[data-signup-dialog="waiver"] iframe')?.hidden === false);
    assert.equal(await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').isChecked(), false);
    assert.equal(await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').isChecked(), true);
  } finally {
    await page.close();
  }
});

test("real signup handlers restore prepared verification and show lost attempts explicitly", async () => {
  const restored = await signupPage();
  try {
    await installResume(restored, "local", resumeRecord());
    assert.equal(await setup(restored, preparedAttempt()), "verification");
    assert.equal(await restored.locator("#hunter-verify-form").isVisible(), true);
    assert.equal(await restored.locator("[data-signup-masked-email]").textContent(), "a***@e***.test");
    assert.match(await restored.locator("[data-signup-verification-status]").textContent() ?? "", /still waiting/i);
  } finally {
    await restored.close();
  }

  const lost = await signupPage();
  try {
    await installResume(lost, "local", resumeRecord());
    assert.equal(await setup(lost, { status: null, emailAddress: null }), "lost_attempt");
    assert.equal(await lost.locator("#hunter-signup-lost-state").isVisible(), true);
    assert.match(await lost.locator("[data-signup-lost-detail]").textContent() ?? "", /no longer has the matching/i);
  } finally {
    await lost.close();
  }
});

test("a retained safe resume without a provider attempt exposes explicit recovery choices", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "local", resumeRecord());
    assert.equal(await setup(page, null), "lost_attempt");
    assert.equal(await page.locator("#hunter-signup-lost-state").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-restart]").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-back-to-sign-in]").isVisible(), true);
    assert.match(await page.locator("[data-signup-lost-detail]").textContent() ?? "", /no longer has the matching/i);
    const stored = await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey);
    assert.ok(stored.session);
    assert.ok(stored.local);
  } finally {
    await page.close();
  }
});

test("failed initial provider preparation retains safe resume and exposes recovery choices", async () => {
  const page = await signupPage();
  try {
    await setup(page, preparedAttempt({
      verifications: { emailAddress: { status: null, strategy: null } },
    }));
    await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__resendFailure = true; });
    await page.locator('#hunter-sign-up-form [name="fullName"]').fill("Alex Hunter");
    await page.locator('#hunter-sign-up-form [name="email"]').fill("alex@example.test");
    await page.locator('#hunter-sign-up-form [name="password"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="confirmPassword"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="participationBasis"][value="adult"]').check();
    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    await page.locator("#hunter-sign-up-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#hunter-signup-lost-state")?.hidden);
    assert.match(await page.locator("[data-signup-lost-detail]").textContent() ?? "", /Please wait before requesting another code/);
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-restart]").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-retry]").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-back-to-sign-in]").isVisible(), true);
    const stored = await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey);
    assert.ok(stored.session);
    assert.ok(stored.local);
  } finally {
    await page.close();
  }
});

test("resolved but unprepared initial provider state cannot masquerade as waiting for code", async () => {
  const page = await signupPage();
  try {
    await setup(page, preparedAttempt());
    await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__prepareUnprepared = true; });
    await page.locator('#hunter-sign-up-form [name="fullName"]').fill("Alex Hunter");
    await page.locator('#hunter-sign-up-form [name="email"]').fill("alex@example.test");
    await page.locator('#hunter-sign-up-form [name="password"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="confirmPassword"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="participationBasis"][value="adult"]').check();
    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    await page.locator("#hunter-sign-up-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#hunter-signup-lost-state")?.hidden);
    assert.match(await page.locator("[data-signup-lost-detail]").textContent() ?? "", /could not be prepared/i);
    const stored = await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey);
    assert.ok(stored.session);
    assert.ok(stored.local);
  } finally {
    await page.close();
  }
});

test("ambiguous initial create failure never adopts an uncorrelated same-email provider attempt", async () => {
  const page = await signupPage();
  try {
    await setup(page, preparedAttempt());
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__createFailure = true; });
    await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
    await page.locator('#hunter-sign-up-form [name="fullName"]').fill("Alex Hunter");
    await page.locator('#hunter-sign-up-form [name="email"]').fill("alex@example.test");
    await page.locator('#hunter-sign-up-form [name="password"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="confirmPassword"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="participationBasis"][value="adult"]').check();
    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    await page.locator("#hunter-sign-up-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#hunter-signup-lost-state")?.hidden);
    assert.match(await page.locator("[data-signup-lost-detail]").textContent() ?? "", /retained.*retry.*restart.*sign in/i);
    const record = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), storageKey))!);
    assert.equal(record.providerAttemptId, null);
  } finally {
    await page.close();
  }
});

for (const correlation of [null, "sua_different"] as const) {
  test(`Retry refuses ${correlation === null ? "missing" : "mismatched"} provider correlation before preparation`, async () => {
    const page = await signupPage();
    try {
      await installResume(page, "session", resumeRecord({ providerAttemptId: correlation }));
      await setup(page, preparedAttempt());
      await page.evaluate(() => { (window as unknown as Record<string, unknown>).__resendCalls = 0; });
      await page.locator("[data-signup-retry]").click();
      await page.waitForFunction(() => /cannot be retried safely/i.test(
        document.querySelector("[data-signup-lost-detail]")?.textContent ?? "",
      ), undefined, { timeout: 2_000 });
      assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0)), 0);
      assert.equal(await page.locator("#hunter-signup-lost-state").isVisible(), true);
    } finally {
      await page.close();
    }
  });
}

test("Retry provider errors persist the Clerk retryAfter cooldown", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord());
    await setup(page, preparedAttempt({ status: null, verifications: { emailAddress: { status: null, strategy: null } } }), 500);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__resendFailure = true;
      (window as unknown as Record<string, unknown>).__retryAfterSeconds = 2;
      (window as unknown as Record<string, unknown>).__resendCalls = 0;
    });
    await page.locator("[data-signup-retry]").click();
    await page.waitForFunction(() => /Please wait before requesting another code/i.test(
      document.querySelector("[data-signup-lost-detail]")?.textContent ?? "",
    ));
    assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0)), 1);
    const stored = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), storageKey))!);
    assert.ok(stored.resendAvailableAt > Date.now() + 1_000);
    const retry = page.locator("[data-signup-retry]");
    assert.equal(await retry.isDisabled(), true);
    assert.match(await retry.textContent() ?? "", /Retry.*in \d+s/i);
    await retry.evaluate((button: HTMLButtonElement) => button.click());
    assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0)), 1);
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("[data-signup-retry]")?.disabled === false, undefined, { timeout: 5_000 });
    await retry.click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0) === 2);
  } finally {
    await page.close();
  }
});

test("real resend handler exposes success, cooldown, and provider error", async () => {
  const page = await signupPage();
  let failedRecord: Record<string, unknown>;
  try {
    await installResume(page, "session", resumeRecord());
    await setup(page, preparedAttempt(), 1_500);
    const resend = page.locator("[data-signup-resend]");
    await resend.click();
    assert.equal(await resend.isDisabled(), true);
    assert.match(await resend.textContent() ?? "", /Resend code in/);
    assert.match(await page.locator("[data-signup-verification-status]").textContent() ?? "", /new code was sent/i);
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("[data-signup-resend]")?.disabled === false, undefined, { timeout: 5_000 });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__resendFailure = true; });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__retryAfterSeconds = 2; });
    await resend.click();
    assert.match(await page.locator("[data-signup-verification-status]").textContent() ?? "", /Please wait before requesting another code/);
    assert.equal(await resend.isDisabled(), true);
    failedRecord = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), storageKey))!);
    assert.ok((failedRecord.resendAvailableAt as number) > Date.now());
  } finally {
    await page.close();
  }
  const reloaded = await signupPage();
  try {
    await installResume(reloaded, "local", failedRecord!);
    await setup(reloaded, preparedAttempt(), 1_500);
    const resend = reloaded.locator("[data-signup-resend]");
    assert.equal(await resend.isDisabled(), true);
    await reloaded.waitForFunction(() => document.querySelector<HTMLButtonElement>("[data-signup-resend]")?.disabled === false, undefined, { timeout: 5_000 });
    assert.equal(await resend.isDisabled(), false);
  } finally {
    await reloaded.close();
  }
});

test("resend cooldown survives reload and lost state announces after focus moves to its heading", async () => {
  const cooldown = await signupPage();
  try {
    await installResume(cooldown, "local", resumeRecord({ resendAvailableAt: Date.now() + 5_000 }));
    await setup(cooldown, preparedAttempt(), 200);
    assert.equal(await cooldown.locator("[data-signup-resend]").isDisabled(), true);
    assert.match(await cooldown.locator("[data-signup-resend]").textContent() ?? "", /Resend code in/);
  } finally {
    await cooldown.close();
  }
  const lost = await signupPage();
  try {
    await installResume(lost, "local", resumeRecord({ resendAvailableAt: Date.now() + 5_000 }));
    await setup(lost, { id: "sua_different", status: null, emailAddress: "alex@example.test" });
    assert.equal(await lost.evaluate(() => document.activeElement?.id), "hunter-signup-lost-title");
    assert.match(await lost.locator("[data-signup-lost-detail]").textContent() ?? "", /safe account details/i);
    assert.equal(await lost.locator("[data-signup-retry]").isDisabled(), true);
    assert.match(await lost.locator("[data-signup-retry]").textContent() ?? "", /Retry.*in \d+s/i);
  } finally {
    await lost.close();
  }
});

for (const operation of ["Create", "Retry", "Resend"] as const) {
  test(`pending ${operation} cannot restore cleared signup state after deliberate exit`, async () => {
    const page = await signupPage();
    try {
      if (operation !== "Create") await installResume(page, "session", resumeRecord());
      await setup(
        page,
        operation === "Retry"
          ? preparedAttempt({ status: null, verifications: { emailAddress: { status: null, strategy: null } } })
          : preparedAttempt(),
        200,
      );
      await installOperationGate(page, operation === "Create" ? "create" : "prepare");
      if (operation === "Create") {
        await fillValidSignup(page);
        await page.locator("#hunter-sign-up-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
        await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__createCalls ?? 0) === 1);
        await page.locator("#hunter-sign-up-form [data-signup-back-to-sign-in]").click();
      } else if (operation === "Retry") {
        await page.locator("[data-signup-retry]").click();
        await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0) === 1);
        await page.locator("#hunter-signup-lost-state [data-signup-back-to-sign-in]").click();
      } else {
        await page.locator("[data-signup-resend]").click();
        await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0) === 1);
        await page.locator("#hunter-verify-form [data-signup-back-to-sign-in]").click();
      }
      const exitMessage = await page.locator("[data-auth-message]").textContent();
      await page.evaluate((releaseName) => {
        const release = (window as unknown as Record<string, () => void>)[releaseName];
        if (!release) throw new Error(`Missing ${releaseName}`);
        release();
      }, operation === "Create" ? "__releaseCreate" : "__releasePrepare");
      await page.waitForFunction((completedName) => Number(
        (window as unknown as Record<string, unknown>)[completedName] ?? 0,
      ) === 1, operation === "Create" ? "__createCompleted" : "__prepareCompleted");
      await page.waitForFunction(() => document.querySelector<HTMLFormElement>("#hunter-sign-in-form")?.hidden === false);
      assert.deepEqual(await page.evaluate((key) => ({
        session: sessionStorage.getItem(key),
        local: localStorage.getItem(key),
      }), storageKey), { session: null, local: null });
      assert.equal(await page.locator("#hunter-sign-in-form").isVisible(), true);
      assert.equal(await page.locator("#hunter-verify-form").isVisible(), false);
      assert.equal(await page.locator("#hunter-signup-lost-state").isVisible(), false);
      assert.equal(await page.locator("[data-auth-message]").textContent(), exitMessage);
      assert.doesNotMatch(
        await page.locator("[data-signup-verification-status]").textContent() ?? "",
        /Requesting|new code|Please wait/i,
      );
    } finally {
      await page.close();
    }
  });
}

test("real verification exits clear both tiers and route to the selected form", async () => {
  for (const [selector, expectedForm] of [
    ["[data-signup-restart]", "#hunter-sign-up-form"],
    ["[data-signup-back-to-sign-in]", "#hunter-sign-in-form"],
  ] as const) {
    const page = await signupPage();
    try {
      await installResume(page, "session", resumeRecord());
      await installResume(page, "local", resumeRecord());
      await setup(page, preparedAttempt());
      await page.locator(`#hunter-verify-form ${selector}`).click();
      assert.equal(await page.locator(expectedForm).isVisible(), true);
      assert.deepEqual(await page.evaluate((key) => ({
        session: sessionStorage.getItem(key),
        local: localStorage.getItem(key),
      }), storageKey), { session: null, local: null });
    } finally {
      await page.close();
    }
  }
});

test("password recovery activation stays in verified finishing through transient provisioning and manual retry", async () => {
  const page = await signupPage();
  try {
    const source = String.raw`
      const completed = {
        status: "complete",
        createdSessionId: "session-recovered",
      };
      const needsPassword = {
        status: "needs_new_password",
        createdSessionId: null,
        resetPassword: async function () { return completed; },
      };
      const recoveryAttempt = {
        supportedFirstFactors: [{ strategy: "reset_password_email_code", emailAddressId: "email-1" }],
        prepareFirstFactor: async function () { return recoveryAttempt; },
        attemptFirstFactor: async function () { return needsPassword; },
      };
      window.__recoveryDashboardFailures = 1;
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return recoveryAttempt; } } },
          user: null,
          session: null,
          setActive: async function () {},
          signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local",
          deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "recovered-token"; } },
        activateSession: async function () { return true; },
        finalizeSignup: async function () {},
        loadSignedInAccount: async function () {
          window.__recoveryDashboardLoads = Number(window.__recoveryDashboardLoads || 0) + 1;
          if (Number(window.__recoveryDashboardFailures || 0) > 0) {
            window.__recoveryDashboardFailures = Number(window.__recoveryDashboardFailures) - 1;
            throw new window.DashboardTestModule.PlayerBootstrapError("retryable", true);
          }
          document.querySelector("[data-dashboard-state]").hidden = true;
          document.querySelector("[data-dashboard-content]").hidden = false;
        },
      });
    `;
    await page.evaluate((body) => new Function(body)(), source);
    await page.locator('[data-show-auth="hunter-recovery-form"]').click();
    await page.locator('#hunter-recovery-form [name="email"]').fill("alex@example.test");
    await page.locator("#hunter-recovery-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-reset-form")?.hidden);
    await page.locator('#hunter-reset-form [name="code"]').fill("123456");
    await page.locator('#hunter-reset-form [name="newPassword"]').fill("new-secure-password");
    await page.locator('#hunter-reset-form [name="confirmPassword"]').fill("new-secure-password");
    await page.locator('#hunter-reset-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#hunter-signup-finishing-state")?.hidden);
    assert.match(await page.locator("[data-signup-finishing-status]").textContent() ?? "", /verified.*sync|email is verified/is);
    assert.doesNotMatch(await page.locator("[data-auth-message]").textContent() ?? "", /Password recovery failed/i);
    assert.equal(await page.locator("#hunter-reset-form").isVisible(), false);
    await page.locator("[data-signup-finishing-retry]").click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__recoveryDashboardLoads || 0) === 2);
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), true);
  } finally {
    await page.close();
  }
});

test("real recovered verification keeps the active-tab session draft authoritative", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord({
      createdAt: Date.now() - 5_000,
      fullName: "Stale Session Participant",
    }));
    const newestPrivacy = { version: "2026.4", hash: "c".repeat(64) };
    await installResume(page, "local", resumeRecord({
      createdAt: Date.now() - 500,
      fullName: "Newest Local Participant",
      privacyMediaDocument: newestPrivacy,
    }));
    await setup(page, preparedAttempt());
    await page.locator("#hunter-verification-code").fill("123456");
    await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__finalizedDraft));
    const result = await page.evaluate((key) => ({
      attemptedCode: (window as unknown as Record<string, unknown>).__attemptedCode,
      activatedSession: (window as unknown as Record<string, unknown>).__activatedSession,
      draft: (window as unknown as Record<string, unknown>).__finalizedDraft,
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
      status: document.querySelector("[data-signup-verification-status]")?.textContent,
    }), storageKey) as { draft: Record<string, unknown>; [key: string]: unknown };
    assert.equal(result.attemptedCode, "123456");
    assert.equal(result.activatedSession, "session-1");
    assert.equal(result.draft.fullName, "Stale Session Participant");
    assert.deepEqual(result.draft.privacyMediaDocument, privacy);
    assert.equal(result.session, null);
    assert.equal(result.local, null);
    assert.match(String(result.status), /Email verified/i);
  } finally {
    await page.close();
  }
});

test("verification double-submit runs one provider attempt and disables conflicting actions", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord());
    await setup(page, preparedAttempt());
    await page.evaluate(() => {
      let release!: () => void;
      (window as unknown as Record<string, unknown>).__verificationGate = new Promise<void>((resolve) => { release = resolve; });
      (window as unknown as Record<string, unknown>).__releaseVerification = release;
    });
    await page.locator("#hunter-verification-code").fill("123456");
    await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.waitForFunction(() => (window as unknown as Record<string, number>).__verificationCalls === 1);
    assert.equal(await page.locator("#hunter-verify-form button:enabled").count(), 0);
    await page.evaluate(() => (window as unknown as { __releaseVerification: () => void }).__releaseVerification());
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__finalizedDraft));
    assert.equal(await page.evaluate(() => (window as unknown as Record<string, number>).__verificationCalls), 1);
  } finally {
    await page.close();
  }
});

test("blocked browser storage warns that leaving cannot be recovered while live verification remains usable", async () => {
  const page = await signupPage();
  try {
    await setup(page, preparedAttempt());
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new DOMException("denied", "SecurityError"); };
    });
    await page.locator('#hunter-sign-in-form [data-show-auth="hunter-sign-up-form"]').click();
    await page.locator('#hunter-sign-up-form [name="fullName"]').fill("Alex Hunter");
    await page.locator('#hunter-sign-up-form [name="email"]').fill("alex@example.test");
    await page.locator('#hunter-sign-up-form [name="password"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="confirmPassword"]').fill("a-secure-password");
    await page.locator('#hunter-sign-up-form [name="participationBasis"][value="adult"]').check();
    await page.locator('#hunter-sign-up-form [name="privacyMediaAccepted"]').check();
    await page.locator('#hunter-sign-up-form [name="waiverAccepted"]').check();
    await page.locator("#hunter-sign-up-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-verify-form")?.hidden);
    assert.match(await page.locator("[data-signup-verification-status]").textContent() ?? "", /keep this page open.*leaving or reloading cannot recover/i);
  } finally {
    await page.close();
  }
});

for (const changedKind of ["privacy-media", "waiver"] as const) {
  test(`post-verification ${changedKind} change keeps the session and asks only for changed acceptance`, async () => {
    const page = await signupPage();
    try {
      await installResume(page, "session", resumeRecord());
      const changedPrivacy = { version: "2026.4", hash: "c".repeat(64) };
      const changedWaiver = { version: "2026.3", hash: "d".repeat(64) };
      (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(
        changedKind === "privacy-media" ? changedPrivacy : privacy,
        changedKind === "waiver" ? changedWaiver : waiver,
      );
      await setup(page, preparedAttempt());
      await page.evaluate((kind) => { (window as unknown as Record<string, unknown>).__legalChanged = [kind]; }, changedKind);
      await page.locator("#hunter-verification-code").fill("123456");
      await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-signup-finish-form")?.hidden);
      assert.equal(await page.locator("[data-signup-finish-privacy]").isVisible(), changedKind === "privacy-media");
      assert.equal(await page.locator("[data-signup-finish-waiver]").isVisible(), changedKind === "waiver");
      await page.locator(`[data-signup-finish-${changedKind === "privacy-media" ? "privacy" : "waiver"}] input`).check();
      await page.evaluate(() => { delete (window as unknown as Record<string, unknown>).__legalChanged; });
      await page.locator("#hunter-signup-finish-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__finalizedDraft));
      const draft = await page.evaluate(() => (window as unknown as { __finalizedDraft: Record<string, unknown> }).__finalizedDraft);
      assert.deepEqual(draft.privacyMediaDocument, changedKind === "privacy-media" ? changedPrivacy : privacy);
      assert.deepEqual(draft.waiverDocument, changedKind === "waiver" ? changedWaiver : waiver);
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
    } finally {
      await page.close();
    }
  });
}

for (const completedStep of ["privacy", "waiver"] as const) {
  test(`actual finalization trusts authoritative ${completedStep} completion and writes only the missing step`, async () => {
    const page = await signupPage();
    let profileWrites = 0;
    let reviewWrites = 0;
    let acceptanceWrites = 0;
    try {
      const currentPrivacy = { version: "2026.4", hash: "c".repeat(64) };
      const currentWaiverIdentity = { version: "2026.3", hash: "d".repeat(64) };
      const currentWaiver = { ...currentWaiverIdentity, type: "participation_waiver", title: "Current waiver", sections: [] };
      let profileComplete = completedStep === "privacy";
      let acceptance: Record<string, unknown> | null = completedStep === "waiver" ? {
        id: "acceptance-current",
        documentVersion: currentWaiver.version,
        documentHash: currentWaiver.hash,
        acceptedAt: "2026-07-18T12:00:00.000Z",
        referenceCode: "TLS-CURRENT",
        receipt: { status: "sent" },
        participants: [],
      } : null;
      (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(currentPrivacy, currentWaiverIdentity);
      await page.route(`${origin}/api/v1/me/**`, async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        if (url.pathname === "/api/v1/me/bootstrap") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
          return;
        }
        if (url.pathname === "/api/v1/me/dashboard" && method === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: {
              profile: profileComplete ? { fullName: "Alex Hunter", participationBasis: "adult" } : null,
              privacyMediaRequired: !profileComplete,
              waypoints: [], progress: [], reports: [], fieldNotes: [],
            } }),
          });
          return;
        }
        if (url.pathname === "/api/v1/me/profile" && method === "PATCH") {
          profileWrites += 1;
          profileComplete = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { fullName: "Alex Hunter", participationBasis: "adult", privacyMediaRequired: false } }) });
          return;
        }
        if (url.pathname === "/api/v1/me/waiver" && method === "GET") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { acceptance, document: currentWaiver } }) });
          return;
        }
        if (url.pathname === "/api/v1/me/waiver/review") {
          reviewWrites += 1;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { review: { reviewEventId: "review-current" } } }) });
          return;
        }
        if (url.pathname === "/api/v1/me/waiver/accept") {
          acceptanceWrites += 1;
          acceptance = {
            documentVersion: currentWaiver.version,
            documentHash: currentWaiver.hash,
            acceptedAt: "2026-07-18T12:00:00.000Z",
            referenceCode: "TLS-NEW",
            receipt: { status: "sent" },
            participants: [],
          };
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { acceptance } }) });
          return;
        }
        await route.fallback();
      });
      await installResume(page, "session", resumeRecord({
        privacyMediaDocument: completedStep === "privacy" ? privacy : currentPrivacy,
        waiverDocument: completedStep === "waiver" ? waiver : currentWaiverIdentity,
      }));
      const source = String.raw`
        return window.DashboardTestModule.setupAccountFormsForTest({
          clerk: {
            client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
            user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
            session: { id: "session-complete" },
            setActive: async function () {}, signOut: async function () {},
          },
          config: {
            hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
            privacyMedia: currentPrivacy, waiver: currentWaiver,
          },
          auth: { getToken: async function () { return "valid-token"; } },
          activateSession: async function () { return true; },
        });
      `;
      const presentation = await page.evaluate(({ attempt, currentPrivacy, currentWaiver, body }) => (
        new Function("attempt", "currentPrivacy", "currentWaiver", body)(attempt, currentPrivacy, currentWaiver)
      ), {
        attempt: preparedAttempt({ status: "complete", createdSessionId: "session-complete", unverifiedFields: [], verifications: { emailAddress: { status: "verified", strategy: "email_code" } } }),
        currentPrivacy,
        currentWaiver: currentWaiverIdentity,
        body: source,
      });
      assert.equal(presentation, "finishing");
      await page.waitForFunction(() => !document.querySelector<HTMLElement>("[data-dashboard-content]")?.hidden);
      assert.deepEqual(
        { profileWrites, reviewWrites, acceptanceWrites },
        completedStep === "privacy"
          ? { profileWrites: 0, reviewWrites: 1, acceptanceWrites: 1 }
          : { profileWrites: 1, reviewWrites: 0, acceptanceWrites: 0 },
      );
    } finally {
      await page.close();
    }
  });
}

test("actual selective legal validation clears only the missing changed waiver acceptance", async () => {
  const page = await signupPage();
  let profileWrites = 0;
  let legalWrites = 0;
  try {
    const currentPrivacy = { version: "2026.4", hash: "c".repeat(64) };
    const currentWaiver = { version: "2026.3", hash: "d".repeat(64) };
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(currentPrivacy, currentWaiver);
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/me/bootstrap") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
      if (url.pathname === "/api/v1/me/dashboard") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { profile: { fullName: "Alex Hunter" }, privacyMediaRequired: false } }) });
      if (url.pathname === "/api/v1/me/waiver" && route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { acceptance: null, document: { ...currentWaiver, type: "participation_waiver", title: "Current waiver", sections: [] } } }) });
      if (url.pathname === "/api/v1/me/profile") profileWrites += 1;
      if (url.pathname === "/api/v1/me/waiver/review" || url.pathname === "/api/v1/me/waiver/accept") legalWrites += 1;
      await route.fallback();
    });
    await installResume(page, "session", resumeRecord({ privacyMediaDocument: privacy, waiverDocument: waiver }));
    const source = String.raw`
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-complete" }, setActive: async function () {}, signOut: async function () {},
        },
        config: { hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation", privacyMedia: currentPrivacy, waiver: currentWaiver },
        auth: { getToken: async function () { return "valid-token"; } },
        activateSession: async function () { return true; },
      });
    `;
    await page.evaluate(({ attempt, currentPrivacy, currentWaiver, body }) => (
      new Function("attempt", "currentPrivacy", "currentWaiver", body)(attempt, currentPrivacy, currentWaiver)
    ), {
      attempt: preparedAttempt({ status: "complete", createdSessionId: "session-complete", unverifiedFields: [], verifications: { emailAddress: { status: "verified", strategy: "email_code" } } }),
      currentPrivacy, currentWaiver, body: source,
    });
    await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-signup-finish-form")?.hidden);
    assert.equal(await page.locator("[data-signup-finish-privacy]").isVisible(), false);
    assert.equal(await page.locator("[data-signup-finish-waiver]").isVisible(), true);
    assert.equal(await page.locator("[data-signup-finish-waiver] input").isChecked(), false);
    assert.deepEqual({ profileWrites, legalWrites }, { profileWrites: 0, legalWrites: 0 });
  } finally {
    await page.close();
  }
});

test("a second legal identity change clears only its affected finishing acceptance", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord());
    const privacyV2 = { version: "2026.4", hash: "c".repeat(64) };
    const waiverV2 = { version: "2026.3", hash: "d".repeat(64) };
    const waiverV3 = { version: "2026.4", hash: "e".repeat(64) };
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(privacyV2, waiverV2);
    await setup(page, preparedAttempt());
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__legalChanged = ["privacy-media", "waiver"]; });
    await page.locator("#hunter-verification-code").fill("123456");
    await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-signup-finish-form")?.hidden);
    await page.locator("[data-signup-finish-privacy] input").check();
    await page.locator("[data-signup-finish-waiver] input").check();
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(privacyV2, waiverV3);
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__legalChanged = ["waiver"]; });
    await page.locator("#hunter-signup-finish-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => {
      const waiverInput = document.querySelector<HTMLInputElement>("[data-signup-finish-waiver] input");
      return waiverInput?.checked === false;
    });
    assert.equal(await page.locator("[data-signup-finish-waiver] input").isChecked(), false);
    assert.equal(await page.locator("[data-signup-finish-privacy] input").isChecked(), true);
  } finally {
    await page.close();
  }
});

test("acceptance-only legal refresh failure stays visible and retries without losing the verified resume", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord());
    const control = page as Page & { setLegalFetchFailure: (value: boolean) => void };
    control.setLegalFetchFailure(true);
    await setup(page, preparedAttempt());
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__legalChanged = ["waiver"]; });
    await page.locator("#hunter-verification-code").fill("123456");
    await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("[data-signup-finish-retry]")?.hidden);
    assert.equal(await page.locator("#hunter-signup-finish-form").isVisible(), true);
    assert.match(await page.locator("[data-signup-finish-status]").textContent() ?? "", /temporarily unavailable|try again/i);
    assert.ok(await page.evaluate((key) => sessionStorage.getItem(key), storageKey));
    control.setLegalFetchFailure(false);
    await page.locator("[data-signup-finish-retry]").click();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("[data-signup-finish-retry]")?.hidden === true);
    assert.equal(await page.locator("[data-signup-finish-waiver]").isVisible(), true);
    assert.doesNotMatch(await page.locator("[data-signup-finish-status]").textContent() ?? "", /temporarily unavailable/i);
  } finally {
    await page.close();
  }
});

test("already-complete provider resume enters the same acceptance-only finishing state", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "local", resumeRecord());
    const changedWaiver = { version: "2026.3", hash: "e".repeat(64) };
    (page as Page & { setLegal: (nextPrivacy: typeof privacy, nextWaiver: typeof waiver) => void }).setLegal(privacy, changedWaiver);
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__legalChanged = ["waiver"]; });
    assert.equal(await setup(page, preparedAttempt({
      status: "complete",
      createdSessionId: "session-complete",
      unverifiedFields: [],
      verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
    })), "finishing");
    await page.waitForFunction(() => !document.querySelector<HTMLFormElement>("#hunter-signup-finish-form")?.hidden);
    assert.equal(await page.locator("[data-signup-finish-privacy]").isVisible(), false);
    assert.equal(await page.locator("[data-signup-finish-waiver]").isVisible(), true);
    assert.ok(await page.evaluate((key) => localStorage.getItem(key), storageKey));
    assert.equal(await page.evaluate(() => document.querySelector("[data-auth-message]")?.textContent ?? ""), "");
  } finally {
    await page.close();
  }
});

for (const failure of ["activation", "finalization"] as const) {
  test(`completed signup ${failure} failure retries from the dedicated finishing state`, async () => {
    const page = await signupPage();
    try {
      await installResume(page, "session", resumeRecord());
      await page.evaluate((failureKind) => {
        const state = window as unknown as Record<string, unknown>;
        state[failureKind === "activation" ? "__activationFailuresRemaining" : "__finalizeFailuresRemaining"] = 1;
      }, failure);
      assert.equal(await setup(page, preparedAttempt({
        status: "complete",
        createdSessionId: "session-complete",
        unverifiedFields: [],
        verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
      })), "finishing");
      await page.waitForFunction(() => !document.querySelector<HTMLElement>("#hunter-signup-finishing-state")?.hidden &&
        document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.disabled === false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "hunter-signup-finishing-title");
      assert.match(
        await page.locator("[data-signup-finishing-status]").textContent() ?? "",
        failure === "activation" ? /session.*starting|try again/i : /interrupted|try again/i,
      );
      assert.ok(await page.evaluate((key) => sessionStorage.getItem(key), storageKey));
      assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0)), 0);
      const finalizeCallsBeforeResend = await page.evaluate(() => Number(
        (window as unknown as Record<string, unknown>).__finalizeCalls ?? 0,
      ));
      await page.locator("[data-signup-resend]").evaluate((button: HTMLButtonElement) => button.click());
      assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__resendCalls ?? 0)), 0);
      assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__finalizeCalls ?? 0)), finalizeCallsBeforeResend);
      assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), true);
      await page.locator("[data-signup-finishing-retry]").click();
      await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__finalizedDraft));
      assert.equal(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__authoritativeWriteCalls ?? 0)), 1);
      assert.deepEqual(await page.evaluate(() => (window as unknown as Record<string, unknown>).__finalizationKeys),
        failure === "activation"
          ? ["11111111-1111-4111-8111-111111111111"]
          : ["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"]);
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
    } finally {
      await page.close();
    }
  });
}

test("active user wins over stale signup resumes shared across tabs", async () => {
  const context = await browser.newContext();
  const first = await signupPage(context);
  const second = await signupPage(context);
  try {
    await installResume(first, "local", resumeRecord());
    await installResume(second, "session", resumeRecord({ providerAttemptId: null }));
    const source = String.raw`
      const initialize = window.DashboardTestModule.initializeAccountStateForTest;
      if (!initialize) throw new Error("initializeAccountStateForTest export is unavailable");
      return initialize({
          clerk: {
            client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
            user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
            session: { id: "session-active" },
            setActive: async function () {},
            signOut: async function () {},
          },
          config: {
            hunterPublishableKey: "pk_test_local",
            deploymentEnvironment: "validation",
            privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
            waiver: { version: "2026.2", hash: "b".repeat(64) },
          },
          auth: { getToken: async function () { return null; } },
          loadDashboard: async function () {
            window.__dashboardLoads = Number(window.__dashboardLoads || 0) + 1;
            document.querySelector("[data-dashboard-state]").hidden = true;
            document.querySelector("[data-dashboard-content]").hidden = false;
          },
        }).then(function (presentation) {
          return {
            presentation,
            session: sessionStorage.getItem(key),
            local: localStorage.getItem(key),
            dashboardLoads: Number(window.__dashboardLoads || 0),
          };
        });
    `;
    const result = await second.evaluate(({ key, attempt, body }) => (
      new Function("key", "attempt", body)(key, attempt)
    ), { key: storageKey, attempt: preparedAttempt(), body: source });
    assert.deepEqual(result, { presentation: "dashboard", session: null, local: null, dashboardLoads: 1 });
    assert.equal(await second.locator("[data-dashboard-content]").isVisible(), true);
    assert.equal(await second.locator("#hunter-verify-form").isVisible(), false);
    assert.equal(await second.locator("#hunter-signup-lost-state").isVisible(), false);
  } finally {
    await first.close();
    await second.close();
    await context.close();
  }
});

test("a valid Clerk user stays in finishing while dashboard provisioning is unavailable, then manual retry succeeds", async () => {
  const page = await signupPage();
  try {
    const source = String.raw`
      const initialize = window.DashboardTestModule.initializeAccountStateForTest;
      if (!initialize) throw new Error("initializeAccountStateForTest export is unavailable");
      window.__activeDashboardFailures = 1;
      return initialize({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" },
          setActive: async function () {},
          signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local",
          deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-session-token"; } },
        loadDashboard: async function () {
          window.__activeDashboardLoads = Number(window.__activeDashboardLoads || 0) + 1;
          if (Number(window.__activeDashboardFailures || 0) > 0) {
            window.__activeDashboardFailures = Number(window.__activeDashboardFailures) - 1;
            throw new window.DashboardTestModule.PlayerBootstrapError("retryable", true);
          }
          document.querySelector("[data-dashboard-state]").hidden = true;
          document.querySelector("[data-dashboard-content]").hidden = false;
        },
      }).then(function (presentation) {
        return {
          presentation,
          dashboardState: document.querySelector("[data-dashboard-state]").getAttribute("data-dashboard-state"),
          signInHidden: document.querySelector("#hunter-sign-in-form").hidden,
          loads: Number(window.__activeDashboardLoads || 0),
        };
      });
    `;
    const result = await page.evaluate((body) => new Function(body)(), source);

    assert.deepEqual(result, {
      presentation: "finishing",
      dashboardState: "finishing",
      signInHidden: true,
      loads: 1,
    });
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), true);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), true);
    assert.match(await page.locator("[data-signup-finishing-status]").textContent() ?? "", /email is verified|email verified/i);
    assert.doesNotMatch(await page.locator("[data-signup-finishing-status]").textContent() ?? "", /password|invalid credentials|database|webhook|Clerk/i);

    await page.locator("[data-signup-finishing-retry]").click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__activeDashboardLoads || 0) === 2);
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), false);
  } finally {
    await page.close();
  }
});

for (const classification of ["retryable", "terminal"] as const) {
  test(`authoritative signup preflight preserves ${classification} provisioning presentation`, async () => {
    const page = await signupPage();
    try {
      await installResume(page, "session", resumeRecord());
      const source = String.raw`
        return window.DashboardTestModule.initializeAccountStateForTest({
          clerk: {
            client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
            user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
            session: { id: "session-active" },
            setActive: async function () {},
            signOut: async function () {},
          },
          config: {
            hunterPublishableKey: "pk_test_local",
            deploymentEnvironment: "validation",
            privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
            waiver: { version: "2026.2", hash: "b".repeat(64) },
          },
          auth: { getToken: async function () { return "valid-session-token"; } },
          signupNeedsFinishing: async function () {
            throw new window.DashboardTestModule.PlayerBootstrapError(classification, classification === "retryable");
          },
          loadDashboard: async function () { throw new Error("Dashboard fallback must not run."); },
        });
      `;
      const presentation = await page.evaluate(({ attempt, classification, body }) => (
        new Function("attempt", "classification", body)(attempt, classification)
      ), {
        attempt: preparedAttempt({
          status: "complete",
          createdSessionId: "session-complete",
          unverifiedFields: [],
          verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
        }),
        classification,
        body: source,
      });
      assert.equal(presentation, "finishing");
      assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), true);
      assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), classification === "retryable");
      const copy = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
      assert.match(copy, classification === "retryable" ? /sync|try again/i : /sign out.*sign in again/is);
      assert.doesNotMatch(copy, /password|invalid credentials|database|webhook|Clerk/i);
    } finally {
      await page.close();
    }
  });
}

test("active user trusts authoritative current waiver completion over stale resume legal identity", async () => {
  const page = await signupPage();
  let acceptanceWrites = 0;
  try {
    const currentWaiver = { type: "participation_waiver", version: "2026.7", hash: "f".repeat(64), title: "Current waiver", sections: [] };
    const currentAcceptance = {
      id: "acceptance-current",
      documentVersion: currentWaiver.version,
      documentHash: currentWaiver.hash,
      acceptedAt: "2026-07-17T12:00:00.000Z",
      referenceCode: "TLS-CURRENT",
      participants: [],
      receipt: { status: "sent" },
    };
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { profile: { fullName: "Active Hunter" }, privacyMediaRequired: false } }),
        });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver" && route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { acceptance: currentAcceptance, document: currentWaiver } }),
        });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver/review" || url.pathname === "/api/v1/me/waiver/accept") {
        acceptanceWrites += 1;
      }
      await route.fulfill({ status: 204, body: "" });
    });
    await installResume(page, "session", resumeRecord({
      privacyMediaDocument: { version: "2025.1", hash: "c".repeat(64) },
      waiverDocument: { version: "2025.1", hash: "d".repeat(64) },
    }));
    const source = String.raw`
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-active" },
          setActive: async function () {},
          signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local",
          deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.7", hash: "e".repeat(64) },
          waiver: { version: "2026.7", hash: "f".repeat(64) },
        },
        auth: { getToken: async function () { return null; } },
        activateSession: async function () { return false; },
        finalizeSignup: async function () { window.__acceptanceFinalizeCalls = Number(window.__acceptanceFinalizeCalls || 0) + 1; },
        loadDashboard: async function () {
          window.__dashboardLoads = Number(window.__dashboardLoads || 0) + 1;
          document.querySelector("[data-dashboard-state]").hidden = true;
          document.querySelector("[data-dashboard-content]").hidden = false;
        },
      }).then(function (presentation) {
        return {
          presentation,
          session: sessionStorage.getItem(key),
          local: localStorage.getItem(key),
          dashboardLoads: Number(window.__dashboardLoads || 0),
          finalizeCalls: Number(window.__acceptanceFinalizeCalls || 0),
        };
      });
    `;
    const result = await page.evaluate(({ key, attempt, body }) => (
      new Function("key", "attempt", body)(key, attempt)
    ), {
      key: storageKey,
      attempt: preparedAttempt({
        status: "complete",
        createdSessionId: "session-complete",
        unverifiedFields: [],
        verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
      }),
      body: source,
    });
    assert.deepEqual(result, {
      presentation: "dashboard",
      session: null,
      local: null,
      dashboardLoads: 1,
      finalizeCalls: 0,
    });
    assert.equal(acceptanceWrites, 0);
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), false);
  } finally {
    await page.close();
  }
});

test("indeterminate active signup finishing preserves both resume tiers until explicit retry proves completion", async () => {
  const page = await signupPage();
  try {
    const stale = resumeRecord();
    await installResume(page, "session", stale);
    await installResume(page, "local", stale);
    const source = String.raw`
      window.__finishingFailuresRemaining = 1;
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-active" },
          setActive: async function () {},
          signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local",
          deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return null; } },
        signupNeedsFinishing: async function () { throw new Error("Authoritative account state is temporarily unavailable."); },
        activateSession: async function () {
          window.__finishingActivationCalls = Number(window.__finishingActivationCalls || 0) + 1;
          return true;
        },
        finalizeSignup: async function (draft) {
          window.__indeterminateFinalizationKeys = [...(window.__indeterminateFinalizationKeys || []), draft.finalizationIdempotencyKey];
          if (Number(window.__finishingFailuresRemaining || 0) > 0) {
            window.__finishingFailuresRemaining = Number(window.__finishingFailuresRemaining) - 1;
            throw new Error("The authoritative Dashboard refresh failed.");
          }
          window.__indeterminateDashboardLoads = Number(window.__indeterminateDashboardLoads || 0) + 1;
          document.querySelector("[data-dashboard-state]").hidden = true;
          document.querySelector("[data-dashboard-content]").hidden = false;
        },
        loadDashboard: async function () { throw new Error("Dashboard fallback must not run."); },
      });
    `;
    const presentation = await page.evaluate(({ attempt, body }) => (
      new Function("attempt", body)(attempt)
    ), {
      attempt: preparedAttempt({
        status: "complete",
        createdSessionId: "session-complete",
        unverifiedFields: [],
        verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
      }),
      body: source,
    });
    assert.equal(presentation, "finishing");
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "hunter-signup-finishing-title");
    assert.match(await page.locator("[data-signup-finishing-status]").textContent() ?? "", /could not confirm|try again/i);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
      activationCalls: Number((window as unknown as Record<string, unknown>).__finishingActivationCalls || 0),
    }), storageKey), {
      session: JSON.stringify(stale),
      local: JSON.stringify(stale),
      activationCalls: 0,
    });

    const retry = page.locator("[data-signup-finishing-retry]");
    await retry.click();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.disabled === false &&
      /sync|try again/i.test(document.querySelector("[data-signup-finishing-status]")?.textContent ?? ""));
    assert.doesNotMatch(await page.locator("[data-signup-finishing-status]").textContent() ?? "", /Dashboard refresh failed/i);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey), { session: JSON.stringify(stale), local: JSON.stringify(stale) });

    await retry.click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__indeterminateDashboardLoads || 0) === 1);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
      keys: (window as unknown as Record<string, unknown>).__indeterminateFinalizationKeys,
      writes: Number((window as unknown as Record<string, unknown>).__indeterminateAcceptanceWrites || 0),
    }), storageKey), {
      session: null,
      local: null,
      keys: [
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
      ],
      writes: 0,
    });
  } finally {
    await page.close();
  }
});

test("sign out cancels a pending finishing delay before profile or legal mutation and clears resume only after provider success", async () => {
  const page = await signupPage();
  try {
    const resume = resumeRecord();
    await installResume(page, "session", resume);
    await installResume(page, "local", resume);
    const source = String.raw`
      let releaseDelay;
      let releaseSignOut;
      window.__finishingDelayGate = new Promise(function (resolve) { releaseDelay = resolve; });
      window.__providerSignOutGate = new Promise(function (resolve) { releaseSignOut = resolve; });
      window.__releaseFinishingDelay = releaseDelay;
      window.__releaseProviderSignOut = releaseSignOut;
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-complete" },
          setActive: async function () {},
          signOut: async function () {
            window.__providerSignOutStarted = true;
            await window.__providerSignOutGate;
          },
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        activateSession: async function () { return true; },
        finalizeSignup: async function (_draft, signal) {
          await window.DashboardTestModule.retryPlayerBootstrap(
            async function () {
              window.__cancelBootstrapAttempts = Number(window.__cancelBootstrapAttempts || 0) + 1;
              return { ok: false, status: 409 };
            },
            async function () {
              window.__finishingDelayStarted = true;
              await window.__finishingDelayGate;
            },
            undefined,
            signal,
          );
          window.__cancelProfileWrites = Number(window.__cancelProfileWrites || 0) + 1;
          window.__cancelPrivacyWrites = Number(window.__cancelPrivacyWrites || 0) + 1;
          window.__cancelWaiverWrites = Number(window.__cancelWaiverWrites || 0) + 1;
        },
      });
    `;
    assert.equal(await page.evaluate(({ attempt, body }) => new Function("attempt", body)(attempt), {
      attempt: preparedAttempt({ status: "complete", createdSessionId: "session-complete", unverifiedFields: [], verifications: { emailAddress: { status: "verified", strategy: "email_code" } } }),
      body: source,
    }), "finishing");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__finishingDelayStarted === true);
    await page.locator('#hunter-signup-finishing-state [data-hunter-sign-out]').click();
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__providerSignOutStarted === true);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
      retryVisible: !document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.hidden,
    }), storageKey), {
      session: JSON.stringify(resume),
      local: JSON.stringify(resume),
      retryVisible: false,
    });
    await page.evaluate(() => (window as unknown as { __releaseFinishingDelay: () => void }).__releaseFinishingDelay());
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => ({
      attempts: Number((window as unknown as Record<string, unknown>).__cancelBootstrapAttempts || 0),
      profile: Number((window as unknown as Record<string, unknown>).__cancelProfileWrites || 0),
      privacy: Number((window as unknown as Record<string, unknown>).__cancelPrivacyWrites || 0),
      waiver: Number((window as unknown as Record<string, unknown>).__cancelWaiverWrites || 0),
    })), { attempts: 1, profile: 0, privacy: 0, waiver: 0 });
    await page.evaluate(() => (window as unknown as { __releaseProviderSignOut: () => void }).__releaseProviderSignOut());
    await page.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey), { session: null, local: null });
  } finally {
    await page.close();
  }
});

test("initial authoritative preflight binds Sign out before its retry window settles", async () => {
  const page = await signupPage();
  try {
    const resume = resumeRecord();
    await installResume(page, "session", resume);
    await installResume(page, "local", resume);
    const source = String.raw`
      let releaseSignOut;
      window.__earlySignOutGate = new Promise(function (resolve) { releaseSignOut = resolve; });
      window.__releaseEarlySignOut = releaseSignOut;
      window.__earlyInitialization = window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-active" }, setActive: async function () {},
          signOut: async function () {
            window.__earlyProviderSignOutCalls = Number(window.__earlyProviderSignOutCalls || 0) + 1;
            await window.__earlySignOutGate;
          },
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        signupNeedsFinishing: async function (_resume, signal) {
          window.__earlyPreflightStarted = true;
          if (!signal) {
            window.__earlyPreflightMissingSignal = true;
            return await new Promise(function () {});
          }
          return await new Promise(function (resolve, reject) {
            window.__releaseEarlyPreflight = function () { resolve(true); };
            signal.addEventListener("abort", function () {
              window.__earlyPreflightAborted = true;
              reject(new DOMException("cancelled", "AbortError"));
            }, { once: true });
          });
        },
        finalizeSignup: async function () { window.__earlyMutationCalls = Number(window.__earlyMutationCalls || 0) + 1; },
        loadDashboard: async function () { window.__earlyDashboardLoads = Number(window.__earlyDashboardLoads || 0) + 1; },
      });
      return "started";
    `;
    assert.equal(await page.evaluate(({ attempt, body }) => new Function("attempt", body)(attempt), {
      attempt: preparedAttempt({ status: "complete", createdSessionId: "session-complete", unverifiedFields: [], verifications: { emailAddress: { status: "verified", strategy: "email_code" } } }),
      body: source,
    }), "started");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__earlyPreflightStarted === true);
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), true);
    await page.locator('#hunter-signup-finishing-state [data-hunter-sign-out]').click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__earlyProviderSignOutCalls || 0) === 1, null, { timeout: 1_000 });
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__earlyPreflightAborted === true);
    await page.evaluate(() => (window as unknown as { __releaseEarlyPreflight: () => void }).__releaseEarlyPreflight());
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
      mutations: Number((window as unknown as Record<string, unknown>).__earlyMutationCalls || 0),
      dashboardLoads: Number((window as unknown as Record<string, unknown>).__earlyDashboardLoads || 0),
      retryVisible: !document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.hidden,
    }), storageKey), {
      session: JSON.stringify(resume), local: JSON.stringify(resume),
      mutations: 0, dashboardLoads: 0, retryVisible: false,
    });
    await page.evaluate(() => (window as unknown as { __releaseEarlySignOut: () => void }).__releaseEarlySignOut());
    await page.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
    assert.deepEqual(await page.evaluate((key) => ({ session: sessionStorage.getItem(key), local: localStorage.getItem(key) }), storageKey), { session: null, local: null });
  } finally {
    await page.close();
  }
});

test("verification finalization cancellation cannot resurrect finishing retry while sign out is pending", async () => {
  const page = await signupPage();
  try {
    const resume = resumeRecord();
    await installResume(page, "session", resume);
    const source = String.raw`
      let releaseSignOut;
      window.__verificationSignOutGate = new Promise(function (resolve) { releaseSignOut = resolve; });
      window.__releaseVerificationSignOut = releaseSignOut;
      const hydrated = { ...attempt };
      hydrated.attemptEmailAddressVerification = async function () {
        return { ...hydrated, status: "complete", createdSessionId: "session-complete", unverifiedFields: [] };
      };
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: hydrated, signIn: { create: async function () { return {}; } } },
          user: null, session: null, setActive: async function () {},
          signOut: async function () {
            window.__verificationProviderSignOutCalls = Number(window.__verificationProviderSignOutCalls || 0) + 1;
            await window.__verificationSignOutGate;
          },
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        activateSession: async function () { return true; },
        finalizeSignup: async function (_draft, signal) {
          window.__verificationFinalizeCalls = Number(window.__verificationFinalizeCalls || 0) + 1;
          await new Promise(function (_resolve, reject) {
            signal.addEventListener("abort", function () {
              window.__verificationFinalizeAborted = true;
              reject(new DOMException("cancelled", "AbortError"));
            }, { once: true });
          });
        },
      });
    `;
    await page.evaluate(({ attempt, body }) => new Function("attempt", body)(attempt), { attempt: preparedAttempt(), body: source });
    await page.locator("#hunter-verification-code").fill("123456");
    await page.locator("#hunter-verify-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__verificationFinalizeCalls || 0) === 1);
    await page.locator('#hunter-signup-finishing-state [data-hunter-sign-out]').click();
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__verificationFinalizeAborted === true);
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__verificationProviderSignOutCalls || 0) === 1);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => {
      const retry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
      retry?.click();
      return {
        retryHidden: retry?.hidden,
        retryDisabled: retry?.disabled,
        finalizeCalls: Number((window as unknown as Record<string, unknown>).__verificationFinalizeCalls || 0),
        status: document.querySelector("[data-signup-finishing-status]")?.textContent,
      };
    }), {
      retryHidden: true,
      retryDisabled: true,
      finalizeCalls: 1,
      status: "Email verified. Checking the remaining account setup now…",
    });
    await page.evaluate(() => (window as unknown as { __releaseVerificationSignOut: () => void }).__releaseVerificationSignOut());
    await page.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
    assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
  } finally {
    await page.close();
  }
});

test("downstream dashboard authorization failure stops verified provisioning with re-auth guidance", async () => {
  const page = await signupPage();
  try {
    let dashboardCalls = 0;
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        dashboardCalls += 1;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "session_invalid", message: "internal auth detail must stay private" } }),
        });
        return;
      }
      await route.fallback();
    });

    const source = String.raw`
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" }, setActive: async function () {}, signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
      });
    `;
    const presentation = await page.evaluate((body) => new Function(body)(), source);

    assert.equal(presentation, "finishing");
    assert.equal(dashboardCalls, 1);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), false);
    const status = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
    assert.match(status, /sign out.*sign in again/is);
    assert.doesNotMatch(status, /internal auth detail|session_invalid/i);
  } finally {
    await page.close();
  }
});

test("downstream dashboard service failure remains a bounded manual retry", async () => {
  const page = await signupPage();
  try {
    let dashboardCalls = 0;
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        dashboardCalls += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "internal_sync_unavailable", message: "private service topology" } }),
        });
        return;
      }
      await route.fallback();
    });
    const source = String.raw`
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" }, setActive: async function () {}, signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
      });
    `;
    assert.equal(await page.evaluate((body) => new Function(body)(), source), "finishing");
    assert.equal(dashboardCalls, 1);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), true);
    const status = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
    assert.match(status, /sync|try again/i);
    assert.doesNotMatch(status, /private service topology|internal_sync_unavailable/i);
  } finally {
    await page.close();
  }
});

test("downstream waiver authorization failure stops verified provisioning with re-auth guidance", async () => {
  const page = await signupPage();
  try {
    let waiverCalls = 0;
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { profile: { fullName: "Active Hunter" }, privacyMediaRequired: false } }),
        });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver" && route.request().method() === "GET") {
        waiverCalls += 1;
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "session_forbidden", message: "private authorization implementation" } }),
        });
        return;
      }
      await route.fallback();
    });
    const source = String.raw`
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" }, setActive: async function () {}, signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
      });
    `;
    const presentation = await page.evaluate((body) => new Function(body)(), source);

    assert.equal(presentation, "finishing");
    assert.equal(waiverCalls, 1);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), false);
    const status = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
    assert.match(status, /sign out.*sign in again/is);
    assert.doesNotMatch(status, /private authorization implementation|session_forbidden/i);
  } finally {
    await page.close();
  }
});

test("terminal profile finalization failure disables retry and hides backend detail", async () => {
  const page = await signupPage();
  try {
    let profileCalls = 0;
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard" && method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { profile: null, privacyMediaRequired: true } }) });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver" && method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { acceptance: null, document: null } }) });
        return;
      }
      if (url.pathname === "/api/v1/me/profile" && method === "PATCH") {
        profileCalls += 1;
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "profile_policy_rejected", message: "private profile rule detail" } }),
        });
        return;
      }
      await route.fallback();
    });
    await installResume(page, "session", resumeRecord());
    const source = String.raw`
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-complete" }, setActive: async function () {}, signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        activateSession: async function () { return true; },
      });
    `;
    assert.equal(await page.evaluate(({ attempt, body }) => new Function("attempt", body)(attempt), {
      attempt: preparedAttempt({
        status: "complete", createdSessionId: "session-complete", unverifiedFields: [],
        verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
      }),
      body: source,
    }), "finishing");
    for (let turn = 0; turn < 20 && profileCalls === 0; turn += 1) await page.waitForTimeout(25);
    assert.equal(profileCalls, 1);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), false);
    const status = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
    assert.match(status, /sign out.*sign in again/is);
    assert.doesNotMatch(status, /private profile rule detail|profile_policy_rejected/i);
  } finally {
    await page.close();
  }
});

test("terminal legal finalization failure disables retry and hides backend detail", async () => {
  const page = await signupPage();
  try {
    let reviewCalls = 0;
    await page.route(`${origin}/api/v1/me/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === "/api/v1/me/bootstrap") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard" && method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { profile: { fullName: "Alex Hunter" }, privacyMediaRequired: false } }) });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver" && method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { acceptance: null, document: null } }) });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver/review") {
        reviewCalls += 1;
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "waiver_policy_forbidden", message: "private waiver authorization detail" } }),
        });
        return;
      }
      await route.fallback();
    });
    await installResume(page, "session", resumeRecord());
    const source = String.raw`
      return window.DashboardTestModule.setupAccountFormsForTest({
        clerk: {
          client: { signUp: attempt, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "alex@example.test" } },
          session: { id: "session-complete" }, setActive: async function () {}, signOut: async function () {},
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        activateSession: async function () { return true; },
      });
    `;
    assert.equal(await page.evaluate(({ attempt, body }) => new Function("attempt", body)(attempt), {
      attempt: preparedAttempt({
        status: "complete", createdSessionId: "session-complete", unverifiedFields: [],
        verifications: { emailAddress: { status: "verified", strategy: "email_code" } },
      }),
      body: source,
    }), "finishing");
    for (let turn = 0; turn < 20 && reviewCalls === 0; turn += 1) await page.waitForTimeout(25);
    assert.equal(reviewCalls, 1);
    assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), false);
    const status = await page.locator("[data-signup-finishing-status]").textContent() ?? "";
    assert.match(status, /sign out.*sign in again/is);
    assert.doesNotMatch(status, /private waiver authorization detail|waiver_policy_forbidden/i);
  } finally {
    await page.close();
  }
});

test("sign out aborts the final signed-in waiver projection before it can render", async () => {
  const page = await signupPage();
  try {
    page.setDefaultTimeout(1_000);
    const source = String.raw`
      let releaseSignOut;
      window.__waiverSignOutGate = new Promise(function (resolve) { releaseSignOut = resolve; });
      window.__releaseWaiverSignOut = releaseSignOut;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function (input, init) {
        const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
        if (url.pathname === "/api/v1/me/bootstrap") {
          return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.pathname === "/api/v1/me/dashboard") {
          return new Response(JSON.stringify({ data: { profile: { fullName: "Active Hunter" }, privacyMediaRequired: false } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.pathname === "/api/v1/me/waiver") {
          window.__pendingWaiverStarted = true;
          return await new Promise(function (_resolve, reject) {
            const signal = init && init.signal;
            if (!signal) {
              window.__pendingWaiverMissingSignal = true;
              return;
            }
            signal.addEventListener("abort", function () {
              window.__pendingWaiverAborted = true;
              reject(new DOMException("cancelled", "AbortError"));
            }, { once: true });
          });
        }
        return originalFetch(input, init);
      };
      window.__pendingWaiverInitialization = window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" }, setActive: async function () {},
          signOut: async function () {
            window.__pendingWaiverProviderCalls = Number(window.__pendingWaiverProviderCalls || 0) + 1;
            await window.__waiverSignOutGate;
          },
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
      });
      return "started";
    `;
    assert.equal(await page.evaluate((body) => new Function(body)(), source), "started");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__pendingWaiverStarted === true);
    await page.evaluate(() => {
      const details = document.querySelector<HTMLElement>("[data-waiver-acceptance-details]");
      if (details) details.textContent = "unchanged waiver projection";
    });
    await page.locator('[data-dashboard-content] [data-hunter-sign-out]').click();
    await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__pendingWaiverProviderCalls || 0) === 1);
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__pendingWaiverAborted === true, null, { timeout: 1_000 });
    const presentation = await page.evaluate(() => (window as unknown as { __pendingWaiverInitialization: Promise<string> }).__pendingWaiverInitialization);
    assert.deepEqual(await page.evaluate(() => ({
      projection: document.querySelector("[data-waiver-acceptance-details]")?.textContent,
      retryVisible: !document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.hidden,
    })), {
      projection: "unchanged waiver projection",
      retryVisible: false,
    });
    assert.equal(presentation, "finishing");
    await page.evaluate(() => (window as unknown as { __releaseWaiverSignOut: () => void }).__releaseWaiverSignOut());
    await page.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
  } finally {
    await page.close();
  }
});

test("failed provider sign out hides the rendered private Dashboard behind finishing", async () => {
  const page = await signupPage();
  try {
    const source = String.raw`
      return window.DashboardTestModule.initializeAccountStateForTest({
        clerk: {
          client: { signUp: null, signIn: { create: async function () { return {}; } } },
          user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
          session: { id: "session-active" },
          setActive: async function () {},
          signOut: async function () { throw new Error("provider unavailable"); },
        },
        config: {
          hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
          privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
          waiver: { version: "2026.2", hash: "b".repeat(64) },
        },
        auth: { getToken: async function () { return "valid-token"; } },
        loadDashboard: async function () {
          const gate = document.querySelector("[data-dashboard-state]");
          const content = document.querySelector("[data-dashboard-content]");
          if (gate) gate.hidden = true;
          if (content) {
            content.hidden = false;
            content.style.display = "grid";
          }
        },
      });
    `;
    const presentation = await page.evaluate((body) => new Function(body)(), source);
    assert.equal(presentation, "dashboard");
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), true);

    await page.locator('[data-dashboard-content] [data-hunter-sign-out]').click();
    await page.locator("#hunter-signup-finishing-state").waitFor({ state: "visible" });
    assert.deepEqual(await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
      return { hidden: content?.hidden, display: content?.style.display };
    }), { hidden: true, display: "none" });
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), false);
  } finally {
    await page.close();
  }
});

for (const pendingRequest of ["dashboard", "waiver"] as const) {
  test(`sign out cancels manual Retry while its ${pendingRequest} request is pending`, async () => {
    const page = await signupPage();
    try {
      page.setDefaultTimeout(1_000);
      const source = String.raw`
        let releaseSignOut;
        window.__unifiedSignOutGate = new Promise(function (resolve) { releaseSignOut = resolve; });
        window.__releaseUnifiedSignOut = releaseSignOut;
        window.__retryDashboardCalls = 0;
        window.__retryWaiverCalls = 0;
        const pendingResponse = function (requestKind, init, responseBody) {
          window.__retryPendingStarted = requestKind;
          return new Promise(function (resolve, reject) {
            let settled = false;
            window.__releaseRetryPending = function () {
              if (settled) return;
              settled = true;
              resolve(new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } }));
            };
            const signal = init && init.signal;
            if (!signal) {
              window.__retryPendingMissingSignal = true;
              return;
            }
            signal.addEventListener("abort", function () {
              if (settled) return;
              settled = true;
              window.__retryPendingAborted = requestKind;
              reject(new DOMException("cancelled", "AbortError"));
            }, { once: true });
          });
        };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async function (input, init) {
          const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
          if (url.pathname === "/api/v1/me/bootstrap") {
            return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (url.pathname === "/api/v1/me/dashboard") {
            window.__retryDashboardCalls = Number(window.__retryDashboardCalls || 0) + 1;
            if (window.__retryDashboardCalls === 1) {
              return new Response(JSON.stringify({ error: { code: "sync_pending" } }), { status: 503, headers: { "content-type": "application/json" } });
            }
            const responseBody = { data: { profile: { fullName: "Active Hunter" }, privacyMediaRequired: false } };
            if (pendingKind === "dashboard") return await pendingResponse("dashboard", init, responseBody);
            return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (url.pathname === "/api/v1/me/waiver") {
            window.__retryWaiverCalls = Number(window.__retryWaiverCalls || 0) + 1;
            const responseBody = { data: { acceptance: null, document: null } };
            if (pendingKind === "waiver") return await pendingResponse("waiver", init, responseBody);
            return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
          }
          return originalFetch(input, init);
        };
        return window.DashboardTestModule.initializeAccountStateForTest({
          clerk: {
            client: { signUp: null, signIn: { create: async function () { return {}; } } },
            user: { id: "user-active", primaryEmailAddress: { emailAddress: "active@example.test" } },
            session: { id: "session-active" }, setActive: async function () {},
            signOut: async function () {
              window.__unifiedProviderSignOutCalls = Number(window.__unifiedProviderSignOutCalls || 0) + 1;
              await window.__unifiedSignOutGate;
            },
          },
          config: {
            hunterPublishableKey: "pk_test_local", deploymentEnvironment: "validation",
            privacyMedia: { version: "2026.3", hash: "a".repeat(64) },
            waiver: { version: "2026.2", hash: "b".repeat(64) },
          },
          auth: { getToken: async function () { return "valid-token"; } },
        });
      `;
      assert.equal(await page.evaluate(({ pendingKind, body }) => new Function("pendingKind", body)(pendingKind), {
        pendingKind: pendingRequest,
        body: source,
      }), "finishing");
      const retry = page.locator("[data-signup-finishing-retry]");
      assert.equal(await retry.isVisible(), true);
      await retry.click();
      await page.waitForFunction((requestKind) => (window as unknown as Record<string, unknown>).__retryPendingStarted === requestKind, pendingRequest);
      await page.evaluate(() => {
        const details = document.querySelector<HTMLElement>("[data-waiver-acceptance-details]");
        if (details) details.textContent = "unchanged after sign out";
      });
      const signOut = pendingRequest === "dashboard"
        ? page.locator('#hunter-signup-finishing-state [data-hunter-sign-out]')
        : page.locator('[data-dashboard-content] [data-hunter-sign-out]');
      await signOut.click();
      await page.waitForFunction(() => Number((window as unknown as Record<string, unknown>).__unifiedProviderSignOutCalls || 0) === 1);
      await page.waitForFunction((requestKind) => (window as unknown as Record<string, unknown>).__retryPendingAborted === requestKind, pendingRequest);
      await page.evaluate(() => (window as unknown as { __releaseRetryPending: () => void }).__releaseRetryPending());
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => {
        const retryControl = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
        retryControl?.click();
        return {
          dashboardCalls: Number((window as unknown as Record<string, unknown>).__retryDashboardCalls || 0),
          waiverCalls: Number((window as unknown as Record<string, unknown>).__retryWaiverCalls || 0),
          retryHidden: retryControl?.hidden,
          retryDisabled: retryControl?.disabled,
          projection: document.querySelector("[data-waiver-acceptance-details]")?.textContent,
          dashboardVisible: !document.querySelector<HTMLElement>("[data-dashboard-content]")?.hidden,
        };
      }), {
        dashboardCalls: 2,
        waiverCalls: pendingRequest === "waiver" ? 1 : 0,
        retryHidden: true,
        retryDisabled: true,
        projection: "unchanged after sign out",
        dashboardVisible: pendingRequest === "waiver",
      });
      await page.evaluate(() => (window as unknown as { __releaseUnifiedSignOut: () => void }).__releaseUnifiedSignOut());
      await page.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
      assert.equal(await page.locator("#hunter-sign-in-form").isVisible(), true);
      assert.equal(await page.locator("[data-dashboard-content]").isVisible(), false);
      assert.equal(await page.locator("[data-signup-finishing-retry]").isVisible(), false);
    } finally {
      await page.close();
    }
  });
}
