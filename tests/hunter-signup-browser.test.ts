import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";
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
    version: 1,
    createdAt: Date.now() - 1_000,
    stage: "awaiting_email_verification",
    emailAddress: "alex@example.test",
    maskedEmail: "a***@e***.test",
    fullName: "Alex Hunter",
    participationBasis: "adult",
    guardianPermissionAttested: false,
    privacyMediaDocument: privacy,
    waiverDocument: waiver,
    ...overrides,
  };
}

async function signupPage(): Promise<Page> {
  const page = await browser.newPage();
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let livePrivacy = privacy;
  let liveWaiver = waiver;
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/dashboard") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    if (url.pathname === "/api/v1/config") {
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
  return page;
}

async function installResume(page: Page, tier: "session" | "local", record: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ key, serialized, tierName }) => {
    window[tierName === "session" ? "sessionStorage" : "localStorage"].setItem(key, serialized);
  }, { key: storageKey, serialized: JSON.stringify(record), tierName: tier });
}

async function setup(page: Page, providerAttempt: Record<string, unknown>, cooldownMs = 200): Promise<string> {
  const source = String.raw`
    let hydrated = { ...attempt };
    hydrated.create = async function () { return hydrated; };
    hydrated.prepareEmailAddressVerification = async function () {
      window.__resendCalls = Number(window.__resendCalls || 0) + 1;
      if (window.__resendFailure === true) {
        throw { errors: [{ longMessage: "Please wait before requesting another code." }] };
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
      window.__attemptedCode = input.code;
      return { ...hydrated, status: "complete", createdSessionId: "session-1", unverifiedFields: [] };
    };
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
        window.__activatedSession = sessionId;
        return true;
      },
      finalizeSignup: async function (draft) { window.__finalizedDraft = draft; },
      resendCooldownMs: cooldown,
    });
  `;
  return page.evaluate(({ attempt, cooldown, body }) => (
    new Function("attempt", "cooldown", body)(attempt, cooldown)
  ), { attempt: providerAttempt, cooldown: cooldownMs, body: source });
}

const preparedAttempt = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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

test("failed initial provider preparation clears resume and exposes restart and sign-in", async () => {
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
    assert.equal(await page.locator("#hunter-signup-lost-state [data-signup-back-to-sign-in]").isVisible(), true);
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey), { session: null, local: null });
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
    assert.deepEqual(await page.evaluate((key) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), storageKey), { session: null, local: null });
  } finally {
    await page.close();
  }
});

test("real resend handler exposes success, cooldown, and provider error", async () => {
  const page = await signupPage();
  try {
    await installResume(page, "session", resumeRecord());
    await setup(page, preparedAttempt(), 200);
    const resend = page.locator("[data-signup-resend]");
    await resend.click();
    assert.equal(await resend.isDisabled(), true);
    assert.match(await resend.textContent() ?? "", /Resend code in/);
    assert.match(await page.locator("[data-signup-verification-status]").textContent() ?? "", /new code was sent/i);
    await page.waitForTimeout(250);
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__resendFailure = true; });
    await resend.click();
    assert.match(await page.locator("[data-signup-verification-status]").textContent() ?? "", /Please wait before requesting another code/);
  } finally {
    await page.close();
  }
});

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

test("real recovered verification finalizes only the newest synchronized safe draft", async () => {
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
    assert.equal(result.draft.fullName, "Newest Local Participant");
    assert.deepEqual(result.draft.privacyMediaDocument, newestPrivacy);
    assert.equal(result.session, null);
    assert.equal(result.local, null);
    assert.match(String(result.status), /Email verified/i);
  } finally {
    await page.close();
  }
});
