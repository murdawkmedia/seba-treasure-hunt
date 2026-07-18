import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";
import { buildSite } from "../scripts/build.mjs";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaignFiles = Object.freeze(Object.keys(CAMPAIGN_PAGES));
const representativeDesktopFiles = Object.freeze([
  "index.html",
  "route.html",
  "interview.html",
  "clue-board.html",
  "dashboard.html",
  "privacy.html",
]);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

let server;
let origin;

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://local.test").pathname;
      const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const source = await readFile(filename);
      const body = Object.hasOwn(CAMPAIGN_PAGES, relative)
        ? renderCampaignPage(source.toString("utf8"), relative)
        : source;
      response.writeHead(200, { "content-type": mime[path.extname(filename)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function auditRoutes(browser, viewport, files) {
  let context;

  try {
    context = await browser.newContext({ viewport });
    await context.route("**/*", async (route) => {
      if (route.request().url().startsWith(origin)) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();

    const runAxe = async (state) => {
      const violations = await page.evaluate(async () => {
        const result = await globalThis.axe.run(document, {
          resultTypes: ["violations"],
          rules: {
            "color-contrast": { enabled: true },
          },
        });
        return result.violations
          .filter(({ impact }) => impact === "serious" || impact === "critical")
          .map(({ id, impact, nodes }) => ({
            id,
            impact,
            targets: nodes.map((node) => node.target),
          }));
      });
      assert.deepEqual(violations, [], `${state} serious/critical axe findings at ${viewport.width}px`);
    };

    for (const file of files) {
      await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator('nav[aria-label="Case"]').count(), 1, `${file} Case landmark at ${viewport.width}px`);
      assert.equal(await page.locator("#campaign-nav").count(), 1, `${file} campaign nav id at ${viewport.width}px`);
      assert.equal(await page.locator(".campaign-menu-toggle").count(), 1, `${file} menu toggle at ${viewport.width}px`);
      assert.equal(await page.locator(".skip-link").count(), 1, `${file} skip link at ${viewport.width}px`);
      assert.equal(await page.locator("main").count(), 1, `${file} main landmark at ${viewport.width}px`);

      await page.addScriptTag({ content: axeSource });
      await runAxe(`${file} collapsed menu`);

      if (viewport.width <= 760) {
        const toggle = page.locator(".campaign-menu-toggle");
        const nav = page.locator("#campaign-nav");
        await toggle.click();
        assert.equal(await toggle.getAttribute("aria-expanded"), "true", `${file} expands its mobile menu`);
        assert.equal(await nav.isVisible(), true, `${file} exposes its expanded mobile navigation`);
        await runAxe(`${file} expanded menu`);
      }
    }
  } finally {
    await context?.close();
  }
}

test("canonical campaign shell is accessible on every mobile route and representative desktop routes", { timeout: 180_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await auditRoutes(browser, { width: 390, height: 844 }, campaignFiles);
    await auditRoutes(browser, { width: 1440, height: 1000 }, representativeDesktopFiles);
  } finally {
    await browser.close();
  }
});

test("separate account, Dashboard, and board bundles share one live hunter session", { timeout: 180_000 }, async () => {
  const output = await buildSite({ temporary: true });
  let identity = {
    fullName: "Private Participant Name",
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
    participationBasis: "adult",
    townArea: "",
    interests: [],
    discoverySource: "",
    consents: {},
  };
  const legalHash = "a".repeat(64);
  let holdPreflightBootstrap = false;
  let preflightBootstrapAborts = 0;
  let profileMutations = 0;
  let legalMutations = 0;
  const releaseHeldBootstraps = [];
  const appServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://local.test");
      const json = (body, status = 200) => {
        response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/api/v1/config") {
        json({ data: {
          hunterPublishableKey: "pk_test_shared_browser",
          deploymentEnvironment: "test",
          privacyMediaVersion: "privacy-test",
          privacyMediaHash: legalHash,
          waiverVersion: "waiver-test",
          waiverHash: legalHash,
        } });
        return;
      }
      if (url.pathname === "/api/v1/me/bootstrap") {
        if (holdPreflightBootstrap) {
          request.once("aborted", () => { preflightBootstrapAborts += 1; });
          releaseHeldBootstraps.push(() => {
            if (!response.destroyed) json({ data: { ready: true } });
          });
          return;
        }
        json({ data: { ready: true } });
        return;
      }
      if (url.pathname === "/api/v1/me/profile") {
        if (request.method === "PATCH") {
          profileMutations += 1;
          let body = "";
          for await (const chunk of request) body += chunk;
          const update = JSON.parse(body);
          identity = {
            ...identity,
            ...update,
            publicDisplayName: typeof update.publicDisplayName === "string" ? update.publicDisplayName : "",
          };
        }
        json({ data: identity });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        if (request.headers.authorization !== "Bearer browser-token") {
          json({ error: { message: "Sign in required" } }, 401);
          return;
        }
        json({ data: {
          profile: identity,
          privacyMediaRequired: false,
          status: { state: "open" },
          waypoints: [],
          reports: [],
          notes: [],
          latestUpdate: null,
        } });
        return;
      }
      if (url.pathname === "/api/v1/board") {
        json({ data: { items: [] }, page: { nextCursor: null } });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver") {
        if (request.method !== "GET") legalMutations += 1;
        json({ data: null });
        return;
      }
      if (url.pathname.startsWith("/api/v1/me/waiver/")) {
        legalMutations += 1;
        json({ data: {} });
        return;
      }
      if (url.pathname === "/api/v1/status") {
        json({ data: { state: "open", updatedAt: new Date().toISOString() } });
        return;
      }

      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const filename = path.resolve(output.dist, relative);
      if (!filename.startsWith(`${output.dist}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const source = await readFile(filename);
      response.writeHead(200, { "content-type": mime[path.extname(filename)] ?? "application/octet-stream" });
      response.end(source);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  const address = appServer.address();
  const appOrigin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    assert.equal(
      await readFile(path.join(output.dist, "assets", "app", "account.js"), "utf8").then(() => true),
      true,
      "account remains a separate page entry",
    );
    assert.equal(
      await readFile(path.join(output.dist, "assets", "app", "dashboard.js"), "utf8").then(() => true),
      true,
      "Dashboard remains a separate page entry",
    );
    await assert.rejects(
      readFile(path.join(output.dist, "assets", "app", "hunter-auth-session.js"), "utf8"),
      { code: "ENOENT" },
      "the shared coordinator is not emitted as an unnecessary page entry",
    );

    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      const listeners = new Set();
      const startsSignedIn = localStorage.getItem("__authStartSignedIn") === "true";
      const preflightFixture = localStorage.getItem("__authPreflightFixture") === "true";
      const state = { publishes: 0, signOuts: 0, activations: 0, loadCalls: 0, failNextSignOut: false };
      const clerk = {
        user: startsSignedIn ? { id: "user_browser", imageUrl: null } : null,
        session: startsSignedIn ? { id: "session_browser", async getToken() { return "browser-token"; } } : null,
        client: {
          signUp: preflightFixture ? {
            id: "signup_preflight",
            status: "complete",
            createdSessionId: "session_browser",
            emailAddress: "preflight@example.test",
          } : null,
          signIn: {
            async create() {
              return { status: "complete", createdSessionId: "session_browser" };
            },
          },
        },
      };
      if (preflightFixture && clerk.user) {
        clerk.user.primaryEmailAddress = { emailAddress: "preflight@example.test" };
      }
      let snapshot = { status: "ready", clerk, user: clerk.user, session: clerk.session, profile: null };
      let profileKey = "";
      const publish = () => {
        state.publishes += 1;
        for (const listener of [...listeners]) listener(snapshot);
      };
      const coordinator = {
        async load() { state.loadCalls += 1; return snapshot; },
        snapshot() { return snapshot; },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh() { return snapshot; },
        setProfile(profile) {
          const nextKey = JSON.stringify([
            profile?.publicDisplayName ?? "",
            profile?.publicHandle ?? "",
            profile?.participationBasis ?? "",
          ]);
          snapshot = { ...snapshot, profile };
          if (nextKey === profileKey) return;
          profileKey = nextKey;
          publish();
        },
        async getToken() { return clerk.session ? "browser-token" : null; },
        async activate(sessionId) {
          state.activations += 1;
          clerk.user = { id: "user_browser", imageUrl: null };
          clerk.session = { id: sessionId, async getToken() { return "browser-token"; } };
          snapshot = { status: "ready", clerk, user: clerk.user, session: clerk.session, profile: null };
          profileKey = "";
          publish();
        },
        async signOut() {
          if (state.failNextSignOut) {
            state.failNextSignOut = false;
            throw new Error("provider unavailable");
          }
          state.signOuts += 1;
          clerk.user = null;
          clerk.session = null;
          snapshot = { status: "ready", clerk, user: null, session: null, profile: null };
          profileKey = "";
          publish();
        },
        emitAuthLoss() {
          clerk.user = null;
          clerk.session = null;
          snapshot = { status: "ready", clerk, user: null, session: null, profile: null };
          profileKey = "";
          publish();
        },
        teardown() { listeners.clear(); },
      };
      globalThis.__timLostHunterAuthSessionV1 = coordinator;
      globalThis.__sharedAuthBrowserState = state;
      globalThis.turnstile = {
        render(_container, options) { options.callback("human-token"); return "widget_browser"; },
        reset() {},
      };
    });
    const page = await context.newPage();
    await page.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#hunter-sign-in-email").fill("private@example.test");
    await page.locator("#hunter-sign-in-password").fill("a-secure-password");
    await page.locator('#hunter-sign-in-form button[type="submit"]').click();

    const accountToggle = page.locator("[data-campaign-account-toggle]");
    await accountToggle.waitFor({ state: "visible" });
    await page.locator("[data-campaign-account-handle]").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.querySelector("[data-campaign-account-handle]")?.textContent === "Nancy & Ron"
    );
    assert.equal(await page.locator("[data-campaign-account-handle]").textContent(), "Nancy & Ron");
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), true);

    const displayName = page.locator('[data-profile-form] [name="publicDisplayName"]');
    await displayName.fill("Trail Friends");
    await page.locator("[data-profile-submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-campaign-account-handle]")?.textContent === "Trail Friends"
    );
    assert.equal(await page.locator("[data-campaign-account-handle]").textContent(), "Trail Friends");

    await displayName.fill("");
    await page.locator("[data-profile-submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-campaign-account-handle]")?.textContent === "Hunter 43BA"
    );
    assert.equal(await page.locator("[data-campaign-account-handle]").textContent(), "Hunter 43BA");

    await accountToggle.click();
    await page.locator("[data-campaign-sign-out]").click();
    await page.locator("[data-campaign-account-sign-in]").waitFor({ state: "visible" });
    await page.locator("[data-dashboard-content]").waitFor({ state: "hidden" });
    assert.equal(await page.locator("[data-dashboard-state]").isVisible(), true);
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), false);
    assert.equal(await page.locator("#hunter-sign-in-form").isVisible(), true);
    assert.equal(await page.locator("#hunter-signup-finishing-state").isVisible(), false);
    assert.equal(await page.locator("#hunter-verify-form").isVisible(), false);
    assert.equal(await page.locator("#hunter-signup-lost-state").isVisible(), false);
    assert.equal(
      await page.locator('[data-dashboard-state] [data-hunter-sign-out]:visible').count(),
      0,
      "signed-out access never leaves a stale sign-out action in its gate",
    );
    assert.deepEqual(await page.evaluate(() => globalThis.__sharedAuthBrowserState), {
      publishes: 5,
      signOuts: 1,
      activations: 1,
      loadCalls: 2,
      failNextSignOut: false,
    });

    const boardPage = await context.newPage();
    await boardPage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await boardPage.evaluate(() => localStorage.setItem("__authStartSignedIn", "true"));
    await boardPage.goto(`${appOrigin}/clue-board.html`, { waitUntil: "domcontentloaded" });
    await boardPage.waitForFunction(() =>
      document.querySelector("#board-status")?.textContent?.startsWith("0 approved")
    );
    assert.equal(await boardPage.locator("#field-note-form").isVisible(), true);
    assert.equal(await boardPage.locator("#board-auth-prompt").isVisible(), false);
    assert.equal(
      await boardPage.evaluate(() => globalThis.__sharedAuthBrowserState.loadCalls),
      2,
      "account and board entries both join the one browser-global coordinator",
    );

    const resumeKey = `tim-lost:hunter-signup-resume:${encodeURIComponent(`${appOrigin}:test`)}`;
    await boardPage.evaluate(({ key }) => {
      sessionStorage.setItem(key, "safe-session-resume");
      localStorage.setItem(key, "safe-local-resume");
    }, { key: resumeKey });
    const boardAccountToggle = boardPage.locator("[data-campaign-account-toggle]");
    await boardAccountToggle.click();
    await boardPage.locator("[data-campaign-sign-out]").click();
    await boardPage.locator("[data-campaign-account-sign-in]").waitFor({ state: "visible" });
    assert.deepEqual(await boardPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), { key: resumeKey }), { session: null, local: null });

    await boardPage.evaluate(async ({ key }) => {
      await globalThis.__timLostHunterAuthSessionV1.activate("session_browser_retry");
      sessionStorage.setItem(key, "safe-session-resume");
      localStorage.setItem(key, "safe-local-resume");
      globalThis.__sharedAuthBrowserState.failNextSignOut = true;
    }, { key: resumeKey });
    await boardAccountToggle.waitFor({ state: "visible" });
    await boardAccountToggle.click();
    await boardPage.locator("[data-campaign-sign-out]").click();
    await boardPage.waitForTimeout(50);
    assert.deepEqual(await boardPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), { key: resumeKey }), {
      session: "safe-session-resume",
      local: "safe-local-resume",
    });
    assert.equal(await boardAccountToggle.isVisible(), true, "failed provider sign-out keeps the active header session");

    const preflightPage = await context.newPage();
    await preflightPage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await preflightPage.evaluate(({ key, hash }) => {
      localStorage.setItem("__authStartSignedIn", "true");
      localStorage.setItem("__authPreflightFixture", "true");
      const resume = JSON.stringify({
        version: 2,
        createdAt: Date.now(),
        stage: "awaiting_email_verification",
        emailAddress: "preflight@example.test",
        maskedEmail: "p***@e***.test",
        fullName: "Preflight Hunter",
        participationBasis: "adult",
        guardianPermissionAttested: false,
        privacyMediaDocument: { version: "privacy-test", hash },
        waiverDocument: { version: "waiver-test", hash },
        providerAttemptId: "signup_preflight",
        resendAvailableAt: null,
        finalizationIdempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
      sessionStorage.setItem(key, resume);
      localStorage.setItem(key, resume);
    }, { key: resumeKey, hash: legalHash });
    const mutationBaseline = { profile: profileMutations, legal: legalMutations };
    holdPreflightBootstrap = true;
    await preflightPage.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    for (let attempt = 0; attempt < 50 && releaseHeldBootstraps.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldBootstraps.length, 1, "authoritative preflight reaches the held bootstrap");
    assert.equal(await preflightPage.locator("#hunter-signup-finishing-state").isVisible(), true);
    assert.notEqual(await preflightPage.evaluate(({ key }) => sessionStorage.getItem(key), { key: resumeKey }), null);

    await preflightPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.emitAuthLoss());
    assert.equal(await preflightPage.locator("#hunter-sign-in-form").isVisible(), true);
    assert.equal(await preflightPage.locator("#hunter-signup-finishing-state").isVisible(), false);
    assert.deepEqual(await preflightPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), { key: resumeKey }), { session: null, local: null });
    for (let attempt = 0; attempt < 50 && preflightBootstrapAborts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(preflightBootstrapAborts, 1, "provider auth loss aborts the held preflight request");

    holdPreflightBootstrap = false;
    for (const release of releaseHeldBootstraps.splice(0)) release();
    await preflightPage.waitForTimeout(100);
    assert.equal(await preflightPage.locator("#hunter-sign-in-form").isVisible(), true);
    assert.equal(await preflightPage.locator("#hunter-signup-finishing-state").isVisible(), false);
    assert.deepEqual({ profile: profileMutations, legal: legalMutations }, mutationBaseline);
  } finally {
    await context?.close();
    await browser.close();
    await new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve()));
    await output.cleanup();
  }
});
