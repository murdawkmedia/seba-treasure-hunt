import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build as buildWithEsbuild } from "esbuild";
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

      if (file === "dashboard.html" && viewport.width === 390) {
        const contrastAgainstFooter = (fallback) => fallback.evaluate((element) => {
          const channels = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
          const luminance = (value) => {
            const [red, green, blue] = channels(value).map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const style = getComputedStyle(element);
          const background = getComputedStyle(element.closest(".signup-legal-dialog__footer")).backgroundColor;
          const ratio = (foreground) => {
            const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
            return (values[0] + 0.05) / (values[1] + 0.05);
          };
          return { text: ratio(style.color), outline: ratio(style.outlineColor) };
        });
        for (const kind of ["privacy-media", "waiver"]) {
          const dialog = page.locator(`[data-signup-dialog="${kind}"]`);
          await dialog.evaluate((element) => element.showModal());
          const fallback = dialog.locator("[data-signup-dialog-fallback]");
          const box = await fallback.boundingBox();
          assert.ok(box && box.height >= 44, `${kind} mobile legal fallback target is at least 44px high (actual ${box?.height ?? 0}px)`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${kind} mobile legal dialog does not create horizontal overflow`);
          await runAxe(`${kind} open legal dialog`);
          const restingContrast = await contrastAgainstFooter(fallback);
          assert.ok(restingContrast.text >= 4.5, `${kind} fallback text contrast is at least 4.5:1 (actual ${restingContrast.text})`);
          await fallback.hover();
          const hoverContrast = await contrastAgainstFooter(fallback);
          assert.ok(hoverContrast.text >= 4.5, `${kind} fallback hover contrast is at least 4.5:1 (actual ${hoverContrast.text})`);
          await page.keyboard.press("Tab");
          await fallback.focus();
          const focusContrast = await contrastAgainstFooter(fallback);
          assert.ok(focusContrast.outline >= 3, `${kind} fallback focus outline contrast is at least 3:1 (actual ${focusContrast.outline})`);
          await dialog.evaluate((element) => element.close());
        }
      }

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
  const realCoordinatorHarness = path.join(output.dist, "real-coordinator-harness.js");
  await buildWithEsbuild({
    stdin: {
      contents: `
        import { getHunterAuthSessionCoordinator } from "./src/client/hunter-auth-session.ts";
        globalThis.__createRealHunterAuthSessionForTest = (createClerk) =>
          getHunterAuthSessionCoordinator({ browserGlobal: globalThis, createClerk });
      `,
      resolveDir: root,
      sourcefile: "real-coordinator-harness.ts",
      loader: "ts",
    },
    outfile: realCoordinatorHarness,
    bundle: true,
    format: "iife",
    platform: "browser",
    logLevel: "silent",
  });
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
  let boardWriteMutations = 0;
  let dashboardRequests = 0;
  let holdDashboardResponse = false;
  let heldDashboardAborts = 0;
  let holdCaseNoteWrite = false;
  let holdReplyWrite = false;
  let heldCaseNoteAborts = 0;
  let heldReplyAborts = 0;
  let holdProfilePatch = false;
  let heldProfileAborts = 0;
  let holdWaiverAccept = false;
  let heldWaiverAcceptAborts = 0;
  let verificationBootstrapCalls = 0;
  let verificationBootstrapCompletions = 0;
  let verificationBootstrapAborts = 0;
  let verificationProfileWrites = 0;
  let verificationWaiverReviews = 0;
  let verificationWaiverAccepts = 0;
  let verificationProfile = null;
  let holdVerificationBootstrap = false;
  const releaseHeldBootstraps = [];
  const releaseHeldDashboards = [];
  const releaseHeldCaseNotes = [];
  const releaseHeldReplies = [];
  const releaseHeldProfiles = [];
  const releaseHeldWaiverAccepts = [];
  const releaseVerificationBootstraps = [];
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
          turnstileSiteKey: "turnstile-test",
          deploymentEnvironment: "test",
          privacyMediaVersion: "privacy-test",
          privacyMediaHash: legalHash,
          waiverVersion: "waiver-test",
          waiverHash: legalHash,
        } });
        return;
      }
      if (url.pathname === "/api/v1/me/bootstrap") {
        if (request.headers.authorization === "Bearer browser-verification-token") {
          verificationBootstrapCalls += 1;
          if (holdVerificationBootstrap) {
            let abortRecorded = false;
            const recordAbort = () => {
              if (abortRecorded || response.writableEnded) return;
              abortRecorded = true;
              verificationBootstrapAborts += 1;
            };
            request.once("aborted", recordAbort);
            response.once("close", recordAbort);
            releaseVerificationBootstraps.push(() => {
              if (!response.destroyed) {
                verificationBootstrapCompletions += 1;
                json({ data: { ready: true } });
              }
            });
            return;
          }
          verificationBootstrapCompletions += 1;
        }
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
        const verificationRequest = request.headers.authorization === "Bearer browser-verification-token";
        if (request.method === "PATCH") {
          profileMutations += 1;
          let body = "";
          for await (const chunk of request) body += chunk;
          const update = JSON.parse(body);
          if (verificationRequest) {
            verificationProfileWrites += 1;
            verificationProfile = { ...update, publicHandle: "Hunter VERIFY" };
            json({ data: verificationProfile });
            return;
          }
          if (holdProfilePatch) {
            const heldProfile = {
              ...identity,
              ...update,
              publicDisplayName: typeof update.publicDisplayName === "string" ? update.publicDisplayName : "",
            };
            let disconnected = false;
            const markDisconnected = () => {
              if (disconnected) return;
              disconnected = true;
              heldProfileAborts += 1;
            };
            request.once("aborted", markDisconnected);
            response.once("close", () => { if (!response.writableEnded) markDisconnected(); });
            releaseHeldProfiles.push(() => {
              if (!response.destroyed) json({ data: heldProfile });
            });
            return;
          }
          identity = {
            ...identity,
            ...update,
            publicDisplayName: typeof update.publicDisplayName === "string" ? update.publicDisplayName : "",
          };
        }
        json({ data: verificationRequest ? verificationProfile : identity });
        return;
      }
      if (url.pathname === "/api/v1/me/dashboard") {
        dashboardRequests += 1;
        const verificationRequest = request.headers.authorization === "Bearer browser-verification-token";
        if (request.headers.authorization !== "Bearer browser-token" && !verificationRequest) {
          json({ error: { message: "Sign in required" } }, 401);
          return;
        }
        if (holdDashboardResponse) {
          const heldIdentity = structuredClone(identity);
          request.once("aborted", () => { heldDashboardAborts += 1; });
          releaseHeldDashboards.push(() => {
            if (!response.destroyed) json({ data: {
              profile: heldIdentity,
              privacyMediaRequired: false,
              status: { state: "open" },
              waypoints: [],
              reports: [],
              notes: [],
              latestUpdate: null,
            } });
          });
          return;
        }
        json({ data: {
          profile: verificationRequest ? verificationProfile : identity,
          privacyMediaRequired: verificationRequest ? verificationProfile === null : false,
          status: { state: "open" },
          waypoints: [],
          reports: [],
          notes: [],
          latestUpdate: null,
        } });
        return;
      }
      if (url.pathname === "/api/v1/board/notes" && request.method === "POST" && holdCaseNoteWrite) {
        boardWriteMutations += 1;
        let disconnected = false;
        const markDisconnected = () => {
          if (disconnected) return;
          disconnected = true;
          heldCaseNoteAborts += 1;
        };
        request.once("aborted", markDisconnected);
        response.once("close", () => { if (!response.writableEnded) markDisconnected(); });
        releaseHeldCaseNotes.push(() => {
          if (!response.destroyed) json({ data: { id: "stale-case-note" } }, 201);
        });
        return;
      }
      if (/^\/api\/v1\/board\/notes\/[^/]+\/replies$/.test(url.pathname) && request.method === "POST" && holdReplyWrite) {
        boardWriteMutations += 1;
        let disconnected = false;
        const markDisconnected = () => {
          if (disconnected) return;
          disconnected = true;
          heldReplyAborts += 1;
        };
        request.once("aborted", markDisconnected);
        response.once("close", () => { if (!response.writableEnded) markDisconnected(); });
        releaseHeldReplies.push(() => {
          if (!response.destroyed) json({ data: { id: "stale-reply" } }, 201);
        });
        return;
      }
      if (url.pathname.startsWith("/api/v1/board/") && request.method !== "GET") {
        boardWriteMutations += 1;
        json({ data: { id: "unexpected-board-write" } }, 201);
        return;
      }
      if (url.pathname === "/api/v1/board") {
        json({ data: { items: [{
          id: "note-browser-1",
          noteKind: "community",
          waypointId: "1",
          waypointRouteOrder: 1,
          waypointName: "The Creek Property",
          body: "A public-safe board observation.",
          authorHandle: "Hunter A1B2",
          createdAt: "2026-07-18T12:00:00.000Z",
          media: [],
          replies: [{
            id: "reply-browser-1",
            body: "A public-safe reply.",
            authorHandle: "Hunter C3D4",
            createdAt: "2026-07-18T12:05:00.000Z",
          }],
        }] }, page: { nextCursor: null } });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver") {
        if (request.method !== "GET") legalMutations += 1;
        json({ data: null });
        return;
      }
      if (url.pathname === "/api/v1/legal/waiver") {
        json({ data: { waiver: {
          version: "waiver-test",
          hash: legalHash,
          title: "Browser participation waiver",
          effectiveDate: "2026-07-18",
          effectiveDateLabel: "July 18, 2026",
          acceptanceStatement: "I accept this browser participation waiver.",
          sections: [{ number: 1, title: "Test terms", blocks: [{ kind: "paragraph", text: "Browser-safe test terms." }] }],
        } } });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver/review") {
        legalMutations += 1;
        if (request.headers.authorization === "Bearer browser-verification-token") verificationWaiverReviews += 1;
        json({ data: { review: { reviewEventId: "review-browser" } } });
        return;
      }
      if (url.pathname === "/api/v1/me/waiver/accept" && holdWaiverAccept) {
        legalMutations += 1;
        let disconnected = false;
        const markDisconnected = () => {
          if (disconnected) return;
          disconnected = true;
          heldWaiverAcceptAborts += 1;
        };
        request.once("aborted", markDisconnected);
        response.once("close", () => { if (!response.writableEnded) markDisconnected(); });
        releaseHeldWaiverAccepts.push(() => {
          if (!response.destroyed) json({ data: { acceptance: { referenceCode: "STALE-A-ACCEPTANCE" } } });
        });
        return;
      }
      if (url.pathname.startsWith("/api/v1/me/waiver/")) {
        legalMutations += 1;
        if (url.pathname === "/api/v1/me/waiver/accept" && request.headers.authorization === "Bearer browser-verification-token") {
          verificationWaiverAccepts += 1;
        }
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
  let realCoordinatorContext;
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
      const verificationFixture = localStorage.getItem("__authVerificationFixture") === "true";
      const state = { publishes: 0, signOuts: 0, activations: 0, loadCalls: 0, failNextSignOut: false };
      const clerk = {
        user: startsSignedIn ? { id: "user_browser", imageUrl: null } : null,
        session: startsSignedIn ? { id: "session_browser", async getToken() { return "browser-token"; } } : null,
        client: {
          signUp: preflightFixture || verificationFixture ? (verificationFixture ? {
            id: "signup_verification",
            status: "missing_requirements",
            createdSessionId: null,
            emailAddress: "verification@example.test",
            unverifiedFields: ["email_address"],
            missingFields: [],
            verifications: { emailAddress: { status: "unverified", strategy: "email_code" } },
          } : {
            id: "signup_preflight",
            status: "complete",
            createdSessionId: "session_browser",
            emailAddress: "preflight@example.test",
          }) : null,
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
      let principalVersion = startsSignedIn ? 1 : 0;
      let snapshot = {
        status: "ready",
        principal: clerk.user && clerk.session
          ? { subject: clerk.user.id, version: principalVersion }
          : null,
        profile: null,
      };
      let profileKey = "";
      const refreshSnapshot = () => {
        snapshot = {
          status: "ready",
          principal: clerk.user && clerk.session
            ? { subject: clerk.user.id, version: principalVersion }
            : null,
          profile: snapshot.profile,
        };
        return snapshot;
      };
      const publish = () => {
        state.publishes += 1;
        for (const listener of [...listeners]) listener(snapshot);
      };
      const coordinator = {
        async load() { state.loadCalls += 1; return snapshot; },
        snapshot() { return snapshot; },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh() { return refreshSnapshot(); },
        setProfile(profile) {
          const projectedProfile = profile ? {
            ...(typeof profile.publicDisplayName === "string" && profile.publicDisplayName.trim()
              ? { publicDisplayName: profile.publicDisplayName.trim() }
              : {}),
            ...(typeof profile.publicHandle === "string" && profile.publicHandle.trim()
              ? { publicHandle: profile.publicHandle.trim() }
              : {}),
          } : null;
          const nextKey = JSON.stringify(projectedProfile);
          snapshot = { ...snapshot, profile: projectedProfile };
          if (nextKey === profileKey) return;
          profileKey = nextKey;
          publish();
        },
        async getToken() { return await clerk.session?.getToken() ?? null; },
        hasActiveSession(sessionId) { return clerk.session?.id === sessionId; },
        signupAttempt() {
          const attempt = clerk.client.signUp;
          return attempt ? {
            id: attempt.id,
            status: attempt.status,
            createdSessionId: attempt.createdSessionId,
            emailAddress: attempt.emailAddress,
            unverifiedFields: [...(attempt.unverifiedFields ?? [])],
            missingFields: [...(attempt.missingFields ?? [])],
            verifications: attempt.verifications ?? null,
          } : null;
        },
        async prepareSignupVerification() { return this.signupAttempt(); },
        async attemptSignupVerification() {
          clerk.client.signUp.status = "complete";
          clerk.client.signUp.createdSessionId = "session_verification";
          clerk.client.signUp.unverifiedFields = [];
          clerk.client.signUp.verifications = { emailAddress: { status: "verified", strategy: "email_code" } };
          return this.signupAttempt();
        },
        async signInWithPassword() {
          return { status: "complete", createdSessionId: "session_browser" };
        },
        primaryEmailMatches(emailAddress) {
          return clerk.user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() === emailAddress.trim().toLowerCase();
        },
        async activate(sessionId) {
          state.activations += 1;
          clerk.user = verificationFixture
            ? { id: "user_verification", imageUrl: null, primaryEmailAddress: { emailAddress: "verification@example.test" } }
            : { id: "user_browser", imageUrl: null };
          clerk.session = {
            id: sessionId,
            async getToken() { return verificationFixture ? "browser-verification-token" : "browser-token"; },
          };
          principalVersion += 1;
          snapshot = { status: "ready", principal: { subject: clerk.user.id, version: principalVersion }, profile: null };
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
          principalVersion += 1;
          snapshot = { status: "ready", principal: null, profile: null };
          profileKey = "";
          publish();
        },
        emitAuthLoss() {
          clerk.user = null;
          clerk.session = null;
          principalVersion += 1;
          snapshot = { status: "ready", principal: null, profile: null };
          profileKey = "";
          publish();
        },
        switchPrincipal(subject, shouldPublish = true) {
          clerk.user = { id: subject, imageUrl: null };
          clerk.session = { id: `session_${subject}`, async getToken() { return "browser-token"; } };
          principalVersion += 1;
          snapshot = { status: "ready", principal: { subject, version: principalVersion }, profile: null };
          profileKey = "";
          if (shouldPublish) publish();
        },
        teardown() { listeners.clear(); },
      };
      globalThis.__timLostHunterAuthSessionV1 = coordinator;
      globalThis.__sharedAuthBrowserState = state;
      let turnstileSequence = 0;
      const turnstileCallbacks = new Map();
      globalThis.turnstile = {
        render(_container, options) {
          const widgetId = `widget_browser_${++turnstileSequence}`;
          turnstileCallbacks.set(widgetId, options.callback);
          options.callback("human-token");
          return widgetId;
        },
        reset(widgetId) { turnstileCallbacks.get(widgetId)?.("human-token"); },
      };
    });
    const page = await context.newPage();
    await page.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__sharedAuthBrowserState.loadCalls === 2);
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

    const activationResumeKey = `tim-lost:hunter-signup-resume:${encodeURIComponent(`${appOrigin}:test`)}`;
    const verificationPage = await context.newPage();
    await verificationPage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await verificationPage.evaluate(({ key, hash }) => {
      localStorage.setItem("__authVerificationFixture", "true");
      const resume = JSON.stringify({
        version: 2,
        createdAt: Date.now(),
        stage: "awaiting_email_verification",
        emailAddress: "verification@example.test",
        maskedEmail: "v***@e***.test",
        fullName: "Activation Finalizer Hunter",
        participationBasis: "adult",
        guardianPermissionAttested: false,
        privacyMediaDocument: { version: "privacy-test", hash },
        waiverDocument: { version: "waiver-test", hash },
        providerAttemptId: "signup_verification",
        resendAvailableAt: null,
        finalizationIdempotencyKey: "22222222-2222-4222-8222-222222222222",
      });
      sessionStorage.setItem(key, resume);
      localStorage.setItem(key, resume);
    }, { key: activationResumeKey, hash: legalHash });
    holdVerificationBootstrap = true;
    await verificationPage.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await verificationPage.locator("#hunter-verify-form").waitFor({ state: "visible" });
    await verificationPage.locator('#hunter-verify-form [name="code"]').fill("123456");
    await verificationPage.locator('#hunter-verify-form button[type="submit"]').click();
    for (let attempt = 0; attempt < 50 && releaseVerificationBootstraps.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(verificationBootstrapCalls, 1, "owned activation begins one authoritative bootstrap");
    assert.equal(releaseVerificationBootstraps.length, 1, "verification finalization reaches the held bootstrap");
    assert.deepEqual(await verificationPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key) !== null,
      local: localStorage.getItem(key) !== null,
    }), { key: activationResumeKey }), { session: true, local: true }, "owned activation retains resumable state until authoritative completion");
    await verificationPage.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    for (let attempt = 0; attempt < 50 && verificationBootstrapAborts < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(verificationBootstrapAborts, 1, "pagehide aborts the first held finalization bootstrap before BFCache restore");
    await verificationPage.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    for (let attempt = 0; attempt < 50 && verificationBootstrapCalls < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(verificationBootstrapCalls, 2, "BFCache restore retries the interrupted authoritative bootstrap once");
    assert.deepEqual(await verificationPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key) !== null,
      local: localStorage.getItem(key) !== null,
    }), { key: activationResumeKey }), { session: true, local: true }, "BFCache restore retains the matching verified resume for reconciliation");
    holdVerificationBootstrap = false;
    for (const release of releaseVerificationBootstraps.splice(0)) release();
    await verificationPage.locator("[data-dashboard-profile]").getByText("Activation Finalizer Hunter").waitFor();
    assert.deepEqual({
      bootstrap: verificationBootstrapCalls,
      completedBootstrap: verificationBootstrapCompletions,
      profile: verificationProfileWrites,
      review: verificationWaiverReviews,
      accept: verificationWaiverAccepts,
    }, { bootstrap: 2, completedBootstrap: 1, profile: 1, review: 1, accept: 1 });
    assert.deepEqual(await verificationPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), { key: activationResumeKey }), { session: null, local: null });
    assert.equal(await verificationPage.locator("[data-dashboard-content]").isVisible(), true);
    assert.equal(await verificationPage.locator("#hunter-verify-form").isVisible(), false);
    await verificationPage.evaluate(() => localStorage.removeItem("__authVerificationFixture"));

    const bfcachePage = await context.newPage();
    await bfcachePage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await bfcachePage.evaluate(() => localStorage.setItem("__authStartSignedIn", "true"));
    await bfcachePage.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await bfcachePage.locator("[data-dashboard-content]").waitFor({ state: "visible" });
    await bfcachePage.evaluate(() => {
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      globalThis.__timLostHunterAuthSessionV1.emitAuthLoss();
    });
    await bfcachePage.locator("[data-campaign-account-sign-in]").waitFor({ state: "visible" });
    await bfcachePage.locator("#hunter-sign-in-form").waitFor({ state: "visible" });
    assert.equal(await bfcachePage.locator("[data-campaign-account-toggle]").isVisible(), false);
    assert.equal(await bfcachePage.locator("[data-dashboard-content]").isVisible(), false);

    identity = {
      ...identity,
      fullName: "First Account Private Name",
      publicDisplayName: "First Account",
      publicHandle: "Hunter FIRST",
    };
    const switchPage = await context.newPage();
    await switchPage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await switchPage.evaluate(() => localStorage.setItem("__authStartSignedIn", "true"));
    await switchPage.goto(`${appOrigin}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await switchPage.locator("[data-dashboard-profile]").getByText("First Account Private Name").waitFor();

    await switchPage.evaluate(({ key, hash }) => {
      const mismatchedResume = JSON.stringify({
        version: 2,
        createdAt: Date.now(),
        stage: "awaiting_email_verification",
        emailAddress: "different-account@example.test",
        maskedEmail: "d***@e***.test",
        fullName: "Different Account Resume",
        participationBasis: "adult",
        guardianPermissionAttested: false,
        privacyMediaDocument: { version: "privacy-test", hash },
        waiverDocument: { version: "waiver-test", hash },
        providerAttemptId: "signup_different_account",
        resendAvailableAt: null,
        finalizationIdempotencyKey: "33333333-3333-4333-8333-333333333333",
      });
      sessionStorage.setItem(key, mismatchedResume);
      localStorage.setItem(key, mismatchedResume);
    }, { key: activationResumeKey, hash: legalHash });

    holdDashboardResponse = true;
    identity = {
      ...identity,
      fullName: "Second Account Private Name",
      publicDisplayName: "Second Account",
      publicHandle: "Hunter SECOND",
    };
    await switchPage.evaluate(() => {
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      globalThis.__timLostHunterAuthSessionV1.switchPrincipal("user_browser_second", false);
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    assert.equal(
      await switchPage.locator("[data-dashboard-content]").isVisible(),
      false,
      "persisted principal switches synchronously hide the previous private Dashboard",
    );
    assert.equal(
      await switchPage.locator("body").textContent().then((copy) => copy.includes("First Account Private Name")),
      false,
      "persisted principal switches synchronously remove the previous account's private DOM",
    );
    for (let attempt = 0; attempt < 50 && releaseHeldDashboards.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldDashboards.length, 1, "the switched principal begins a fresh held Dashboard load");
    holdDashboardResponse = false;
    for (const release of releaseHeldDashboards.splice(0)) release();
    await switchPage.locator("[data-dashboard-profile]").getByText("Second Account Private Name").waitFor();
    assert.deepEqual(await switchPage.evaluate(({ key }) => ({
      session: sessionStorage.getItem(key),
      local: localStorage.getItem(key),
    }), { key: activationResumeKey }), { session: null, local: null }, "an external principal clears a mismatched signup resume after reconciliation");
    assert.equal(
      await switchPage.locator("body").textContent().then((copy) => copy.includes("First Account Private Name")),
      false,
      "the switched account response cannot restore private DOM from the previous principal",
    );
    assert.equal(heldDashboardAborts, 0, "the current principal's held response remains live until released");

    holdProfilePatch = true;
    await switchPage.locator('[data-profile-form] [name="fullName"]').fill("Stale Account A Saved Name");
    await switchPage.locator('[data-profile-form] [name="publicDisplayName"]').fill("Stale Account A Public Name");
    await switchPage.locator("[data-profile-submit]").click();
    for (let attempt = 0; attempt < 50 && releaseHeldProfiles.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldProfiles.length, 1, "Account A's profile PATCH reaches the held response");
    identity = {
      ...identity,
      fullName: "Profile Account B Private Name",
      publicDisplayName: "Profile Account B",
      publicHandle: "Hunter PROFILE-B",
    };
    await switchPage.evaluate(() => {
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      globalThis.__timLostHunterAuthSessionV1.switchPrincipal("user_profile_account_b", false);
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await switchPage.locator("[data-dashboard-profile]").getByText("Profile Account B Private Name").waitFor();
    for (let attempt = 0; attempt < 50 && heldProfileAborts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(heldProfileAborts, 1, "switching principals aborts Account A's profile PATCH");
    holdProfilePatch = false;
    for (const release of releaseHeldProfiles.splice(0)) release();
    await switchPage.waitForTimeout(50);
    const profileSwitchCopy = await switchPage.locator("body").textContent();
    assert.equal(profileSwitchCopy.includes("Stale Account A Saved Name"), false);
    assert.equal(profileSwitchCopy.includes("Stale Account A Public Name"), false);
    assert.equal(await switchPage.locator("[data-profile-result]").isVisible(), false);

    await switchPage.locator("[data-waiver-review-link]").click();
    await switchPage.waitForFunction(() => !document.querySelector("#waiver-accepted")?.disabled);
    holdWaiverAccept = true;
    await switchPage.locator("#waiver-accepted").check();
    await switchPage.locator("[data-waiver-submit]").click();
    for (let attempt = 0; attempt < 50 && releaseHeldWaiverAccepts.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldWaiverAccepts.length, 1, "Account A's waiver accept POST reaches the held response");
    identity = {
      ...identity,
      fullName: "Waiver Account B Private Name",
      publicDisplayName: "Waiver Account B",
      publicHandle: "Hunter WAIVER-B",
    };
    await switchPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.switchPrincipal("user_waiver_account_b"));
    await switchPage.locator("[data-dashboard-profile]").getByText("Waiver Account B Private Name").waitFor();
    for (let attempt = 0; attempt < 50 && heldWaiverAcceptAborts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(heldWaiverAcceptAborts, 1, "switching principals aborts Account A's waiver accept POST");
    holdWaiverAccept = false;
    for (const release of releaseHeldWaiverAccepts.splice(0)) release();
    await switchPage.waitForTimeout(50);
    const waiverSwitchCopy = await switchPage.locator("body").textContent();
    assert.equal(waiverSwitchCopy.includes("STALE-A-ACCEPTANCE"), false);
    assert.equal(await switchPage.locator("[data-waiver-receipt]").isVisible(), false);
    assert.equal(await switchPage.locator("[data-waiver-result]").isVisible(), false);

    realCoordinatorContext = await browser.newContext();
    const realCoordinatorPage = await realCoordinatorContext.newPage();
    await realCoordinatorPage.setContent("<!doctype html><title>Real coordinator harness</title>");
    await realCoordinatorPage.addScriptTag({ path: realCoordinatorHarness });
    const realCoordinatorJourney = await realCoordinatorPage.evaluate(async () => {
      const providerListeners = new Set();
      const provider = {
        user: {
          id: "user_real_private_subject",
          firstName: "Private",
          lastName: "Provider Name",
          primaryEmailAddress: { emailAddress: "provider-private@example.test" },
          privateMetadata: { recoveryCode: "provider-secret-code" },
        },
        session: {
          id: "session_real_private_id",
          privateMetadata: { bearerToken: "provider-secret-token" },
          async getToken() { return "browser-real-token"; },
        },
        client: { signUp: null, signIn: {} },
        async load() {},
        addListener(listener) {
          providerListeners.add(listener);
          return () => providerListeners.delete(listener);
        },
        async setActive() {},
        async signOut() {},
      };
      const coordinator = globalThis.__createRealHunterAuthSessionForTest(async () => provider);
      const publications = [];
      coordinator.subscribe((snapshot) => publications.push(snapshot));
      await coordinator.load("pk_test_real_production_coordinator");
      coordinator.setProfile({
        fullName: "Legal Private Profile Name",
        emailAddress: "profile-private@example.test",
        participationBasis: "adult",
        publicDisplayName: "Public Trail Team",
        publicHandle: "Hunter SAFE",
      });
      const initial = coordinator.snapshot();
      provider.user = {
        id: "user_real_second_subject",
        firstName: "Second Private",
        primaryEmailAddress: { emailAddress: "second-private@example.test" },
      };
      provider.session = {
        id: "session_real_second_private_id",
        privateMetadata: { bearerToken: "second-provider-secret-token" },
        async getToken() { return "browser-real-token-second"; },
      };
      for (const listener of providerListeners) listener();
      const switched = coordinator.snapshot();
      provider.user = null;
      provider.session = null;
      for (const listener of providerListeners) listener();
      const signedOut = coordinator.snapshot();
      return {
        initial,
        switched,
        signedOut,
        publications,
        globalSnapshot: globalThis.__timLostHunterAuthSessionV1.snapshot(),
        providerGlobalPresent: Object.hasOwn(globalThis, "clerk"),
      };
    });
    assert.deepEqual(realCoordinatorJourney.initial, {
      status: "ready",
      principal: { subject: "user_real_private_subject", version: 1 },
      profile: { publicDisplayName: "Public Trail Team", publicHandle: "Hunter SAFE" },
    });
    assert.deepEqual(realCoordinatorJourney.switched, {
      status: "ready",
      principal: { subject: "user_real_second_subject", version: 2 },
      profile: null,
    });
    assert.deepEqual(realCoordinatorJourney.signedOut, {
      status: "ready",
      principal: null,
      profile: null,
    });
    assert.deepEqual(realCoordinatorJourney.globalSnapshot, realCoordinatorJourney.signedOut);
    assert.equal(realCoordinatorJourney.providerGlobalPresent, false);
    assert.equal(realCoordinatorJourney.publications.length, 4, "the real provider listener publishes load, safe profile, switch, and auth loss");
    const serializedRealJourney = JSON.stringify(realCoordinatorJourney);
    for (const privateValue of [
      "Provider Name",
      "provider-private@example.test",
      "provider-secret-code",
      "session_real_private_id",
      "provider-secret-token",
      "Legal Private Profile Name",
      "profile-private@example.test",
      "second-private@example.test",
      "session_real_second_private_id",
      "second-provider-secret-token",
    ]) {
      assert.equal(serializedRealJourney.includes(privateValue), false, `real coordinator Chromium snapshots omit ${privateValue}`);
    }

    const boardPage = await context.newPage();
    await boardPage.goto(`${appOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await boardPage.evaluate(() => localStorage.setItem("__authStartSignedIn", "true"));
    await boardPage.goto(`${appOrigin}/clue-board.html`, { waitUntil: "domcontentloaded" });
    await boardPage.waitForFunction(() =>
      document.querySelector("#board-status")?.textContent?.startsWith("1 approved")
    );
    assert.equal(await boardPage.locator("#field-note-form").isVisible(), true);
    assert.equal(await boardPage.locator("#board-auth-prompt").isVisible(), false);
    assert.equal(await boardPage.locator(".reply-form").count(), 1);
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

    const boardWriteBaseline = boardWriteMutations;
    await boardPage.locator('[name="waypointId"]').selectOption("1");
    await boardPage.locator("#note-body").fill("This must not send after provider auth loss.");
    await boardPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.emitAuthLoss());
    await boardPage.locator("[data-campaign-account-sign-in]").waitFor({ state: "visible" });
    assert.equal(await boardPage.locator("#field-note-form").isVisible(), false);
    assert.equal(await boardPage.locator("#board-auth-prompt").isVisible(), true);
    assert.equal(await boardPage.locator(".reply-form").count(), 0);
    await boardPage.locator("#field-note-form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await boardPage.waitForTimeout(100);
    assert.equal(boardWriteMutations, boardWriteBaseline, "auth loss blocks hidden Case Note submission");

    const restoreDashboardBaseline = dashboardRequests;
    await boardPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.activate("session_browser_restored"));
    await boardPage.locator("#field-note-form").waitFor({ state: "visible" });
    assert.equal(dashboardRequests, restoreDashboardBaseline + 1, "reactive sign-in revalidates Dashboard authorization");
    assert.equal(await boardPage.locator("#board-auth-prompt").isVisible(), false);
    assert.equal(await boardPage.locator(".reply-form").count(), 1);

    holdCaseNoteWrite = true;
    await boardPage.locator('[name="waypointId"]').selectOption("1");
    await boardPage.locator("#note-body").fill("A held Case Note from the previous account.");
    await boardPage.waitForFunction(() => !document.querySelector('#field-note-form button[type="submit"]')?.disabled);
    await boardPage.locator('#field-note-form button[type="submit"]').click();
    for (let attempt = 0; attempt < 50 && releaseHeldCaseNotes.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldCaseNotes.length, 1, "the Case Note POST reaches the held server response");
    await boardPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.switchPrincipal("user_board_second"));
    await boardPage.locator("#field-note-form").waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 50 && heldCaseNoteAborts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(heldCaseNoteAborts, 1, "a principal switch aborts the previous account's Case Note POST");
    holdCaseNoteWrite = false;
    for (const release of releaseHeldCaseNotes.splice(0)) release();
    await boardPage.waitForTimeout(50);
    assert.equal(await boardPage.locator("[data-note-receipt]").isVisible(), false);
    assert.equal(await boardPage.locator("#note-form-result").textContent(), "");
    assert.equal(await boardPage.locator("#field-note-form").isVisible(), true);

    holdReplyWrite = true;
    const heldReplyForm = boardPage.locator(".reply-form").first();
    await heldReplyForm.locator('textarea[name="body"]').fill("A held reply from the previous account.");
    await boardPage.waitForFunction(() => !document.querySelector('.reply-form button[type="submit"]')?.disabled);
    await heldReplyForm.locator('button[type="submit"]').click();
    for (let attempt = 0; attempt < 50 && releaseHeldReplies.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(releaseHeldReplies.length, 1, "the reply POST reaches the held server response");
    await boardPage.evaluate(() => globalThis.__timLostHunterAuthSessionV1.switchPrincipal("user_board_third"));
    await boardPage.locator(".reply-form").waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 50 && heldReplyAborts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(heldReplyAborts, 1, "a principal switch aborts the previous account's reply POST");
    holdReplyWrite = false;
    for (const release of releaseHeldReplies.splice(0)) release();
    await boardPage.waitForTimeout(50);
    assert.equal(
      await boardPage.locator("#board-feed").textContent().then((copy) => copy.includes("Reply posted.")),
      false,
      "a stale reply success cannot mutate the restored principal's board UI",
    );
    assert.equal(await boardPage.locator(".reply-form").count(), 1);

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
    await realCoordinatorContext?.close();
    await context?.close();
    await browser.close();
    await new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve()));
    await output.cleanup();
  }
});
