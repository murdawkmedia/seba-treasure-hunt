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

test("separate account and Dashboard bundles share live sign-in and sign-out state", { timeout: 180_000 }, async () => {
  const output = await buildSite({ temporary: true });
  const identity = {
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
  const appServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://local.test");
      const json = (body) => {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
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
        json({ data: { ready: true } });
        return;
      }
      if (url.pathname === "/api/v1/me/profile") {
        json({ data: identity });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
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
      if (url.pathname === "/api/v1/me/waiver") {
        json({ data: null });
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
      const state = { publishes: 0, signOuts: 0, activations: 0 };
      const clerk = {
        user: null,
        session: null,
        client: {
          signUp: null,
          signIn: {
            async create() {
              return { status: "complete", createdSessionId: "session_browser" };
            },
          },
        },
      };
      let snapshot = { status: "ready", clerk, user: null, session: null, profile: null };
      let profileKey = "";
      const publish = () => {
        state.publishes += 1;
        for (const listener of [...listeners]) listener(snapshot);
      };
      const coordinator = {
        async load() { return snapshot; },
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
          state.signOuts += 1;
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

    await accountToggle.click();
    await page.locator("[data-campaign-sign-out]").click();
    await page.locator("[data-campaign-account-sign-in]").waitFor({ state: "visible" });
    await page.locator("[data-dashboard-content]").waitFor({ state: "hidden" });
    assert.equal(await page.locator("[data-dashboard-state]").isVisible(), true);
    assert.equal(await page.locator("[data-dashboard-content]").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => globalThis.__sharedAuthBrowserState), {
      publishes: 3,
      signOuts: 1,
      activations: 1,
    });
  } finally {
    await context?.close();
    await browser.close();
    await new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve()));
    await output.cleanup();
  }
});
