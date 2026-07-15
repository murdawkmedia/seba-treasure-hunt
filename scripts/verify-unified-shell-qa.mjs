import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { buildSite } from "./build.mjs";
import { CAMPAIGN_PAGES } from "./campaign-shell.mjs";

const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "tim-lost-unified-shell-qa-"));
const screenshotRoot = path.join(artifactRoot, "screenshots");
const logPath = path.join(artifactRoot, "qa-log.json");
const preserveArtifacts = process.env.UNIFIED_SHELL_QA_PRESERVE_ARTIFACTS !== "0";
const executionStartedAt = new Date().toISOString();
const fixedNow = "2026-07-14T18:00:00.000Z";
const campaignFiles = Object.keys(CAMPAIGN_PAGES);
const representativeFiles = [
  "index.html",
  "route.html",
  "interview.html",
  "clue-board.html",
  "dashboard.html",
  "sponsors.html",
  "privacy.html",
];
const screenshotFiles = [
  "index.html",
  "route.html",
  "interview.html",
  "clue-board.html",
  "dashboard.html",
  "sponsors.html",
  "privacy.html",
  "waiver.html",
];
const expectedScreenshotNames = [
  "mobile-390x844-home.png",
  "mobile-390x844-route.png",
  "mobile-390x844-interview.png",
  "mobile-390x844-clue-board.png",
  "mobile-390x844-dashboard.png",
  "mobile-390x844-sponsors.png",
  "mobile-390x844-privacy.png",
  "mobile-390x844-waiver.png",
  "desktop-1440x1000-home.png",
  "desktop-1440x1000-route.png",
  "desktop-1440x1000-interview.png",
  "desktop-1440x1000-clue-board.png",
  "desktop-1440x1000-dashboard.png",
  "desktop-1440x1000-sponsors.png",
  "desktop-1440x1000-privacy.png",
  "desktop-1440x1000-waiver.png",
  "zoom-200-home-tab-focus.png",
  "zoom-200-route-menu-open.png",
  "zoom-200-waiver-main-focus.png",
];
const auditMatrix = [
  { name: "360x900", width: 360, height: 900, files: campaignFiles, auditMenuOpen: true },
  { name: "768x900", width: 768, height: 900, files: campaignFiles, auditMenuOpen: false },
  { name: "1440x900", width: 1440, height: 900, files: campaignFiles, auditMenuOpen: false },
  { name: "720x500", width: 720, height: 500, files: campaignFiles, auditMenuOpen: true },
  { name: "390x844", width: 390, height: 844, files: campaignFiles, auditMenuOpen: true },
  { name: "1440x1000-representative", width: 1440, height: 1000, files: representativeFiles, auditMenuOpen: false },
];
const statusEnvelope = {
  data: {
    state: "open",
    hours: { opens: "09:00", closes: "20:00", timezone: "America/Edmonton" },
    updatedAt: "2026-07-14T17:30:00.000Z",
    nextClue: { title: "Next clue under review", releasesAt: "2026-07-15T18:00:00.000Z" },
    version: 1,
  },
};
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function pageName(filename) {
  return filename === "index.html" ? "home" : filename.replace(/\.html$/, "");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ headless: true }), source: "playwright-chromium" };
  } catch (bundledError) {
    try {
      return { browser: await chromium.launch({ channel: "chrome", headless: true }), source: "system-chrome" };
    } catch (chromeError) {
      throw new Error(`Unable to launch Playwright Chromium or Chrome. ${bundledError.message} ${chromeError.message}`);
    }
  }
}

async function startReadOnlyServer(distRoot, serverLedger) {
  const normalizedRoot = path.resolve(distRoot);
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      serverLedger.rejectedWrites.push({ method, pathname: request.url ?? "/" });
      response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Read-only QA server");
      return;
    }

    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidate = path.resolve(normalizedRoot, relative);
      const insideRoot = candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${path.sep}`);
      if (!insideRoot) {
        response.writeHead(403).end();
        return;
      }
      const candidateStat = await stat(candidate).catch(() => null);
      if (!candidateStat?.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      const body = await readFile(candidate);
      serverLedger.reads.push({ method, pathname });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(path.extname(candidate).toLowerCase()) ?? "application/octet-stream",
      });
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function installQaBoundary(context, origin, networkLedger) {
  await context.addInitScript(({ iso }) => {
    const RealDate = Date;
    const epoch = RealDate.parse(iso);
    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [epoch] : args));
      }
      static now() { return epoch; }
    }
    Object.setPrototypeOf(FixedDate, RealDate);
    globalThis.Date = FixedDate;
  }, { iso: fixedNow });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const isRead = method === "GET" || method === "HEAD";
    const isLocal = url.origin === origin;

    if (isLocal && url.pathname.startsWith("/api/")) {
      if (!isRead) {
        networkLedger.localWriteAttempts.push({ method, pathname: url.pathname });
        await route.abort("blockedbyclient");
        return;
      }
      const body = url.pathname === "/api/v1/status" ? statusEnvelope : { data: null };
      networkLedger.localApiMocks.push({ method, pathname: url.pathname });
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
      return;
    }

    if (isLocal) {
      if (!isRead) {
        networkLedger.localWriteAttempts.push({ method, pathname: url.pathname });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    if (!isRead) {
      networkLedger.externalWriteAttempts.push({ method, origin: url.origin, pathname: url.pathname });
      await route.abort("blockedbyclient");
      return;
    }

    const disposition = "fulfilled-local-external-read";
    networkLedger.externalRequestAttempts.push({
      method,
      origin: url.origin,
      pathname: url.pathname,
      resourceType: request.resourceType(),
      disposition,
    });
    if (request.resourceType() === "stylesheet") {
      await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: "" });
    } else if (request.resourceType() === "script") {
      const body = url.hostname === "challenges.cloudflare.com"
        ? "globalThis.turnstile={render(){return 'qa-local-turnstile';},reset(){},remove(){}};"
        : "";
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body });
    } else {
      await route.fulfill({ status: 204, body: "" });
    }
  });
}

function attachErrorAudit(page, label, consoleErrors, pageErrors) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ label: label(), message: message.text() });
  });
  page.on("pageerror", (error) => pageErrors.push({ label: label(), message: error.message }));
}

async function openPage(page, origin, filename) {
  await page.goto(`${origin}/${filename}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-case-status]").waitFor({ state: "visible" });
  await page.waitForTimeout(100);
}

async function warmLazyImages(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(300, window.innerHeight * 0.8)) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
}

async function assertActiveElement(page, locator, label) {
  await locator.waitFor({ state: "attached" });
  const active = await locator.evaluate((element) => document.activeElement === element);
  assert.equal(active, true, `${label} must be the active element`);
  assert.ok(page.viewportSize(), `${label} requires a real browser viewport`);
}

async function assertElementInViewport(page, locator, label) {
  const element = await locator.elementHandle();
  assert.ok(element, `${label} must exist`);
  await page.waitForFunction((target) => {
    const rect = target.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
  }, element);
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  assert.ok(viewport, `${label} requires a viewport`);
  assert.ok(box, `${label} must have a visible bounding box`);
  assert.ok(box.x >= 0 && box.y >= 0, `${label} must begin inside the viewport`);
  assert.ok(box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${label} must fit inside the viewport`);
}

async function assertMainClearsStickyHeader(page, main) {
  const metrics = await main.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;height:var(--stacked-header-height);";
    document.body.append(probe);
    const headerHeight = probe.getBoundingClientRect().height;
    probe.remove();
    const rect = element.getBoundingClientRect();
    return { headerHeight, top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  });
  assert.ok(metrics.headerHeight > 0, "--stacked-header-height must resolve to a positive height");
  assert.ok(metrics.top >= metrics.headerHeight - 1, `#main top ${metrics.top} must clear sticky header ${metrics.headerHeight}`);
  assert.ok(metrics.top >= 0 && metrics.top < metrics.viewportHeight, "#main must begin inside the viewport");
  assert.ok(metrics.bottom > 0, "#main must intersect the viewport");
  assert.equal(metrics.viewportHeight, page.viewportSize()?.height, "#main geometry must use the active viewport");
}

async function capture(page, filename, evidence, { fullPage = true } = {}) {
  const target = path.join(screenshotRoot, filename);
  await page.screenshot({ path: target, fullPage });
  const artifactName = `screenshots/${filename}`;
  evidence.push({ artifactName, sha256: sha256(await readFile(target)) });
}

async function run() {
  let temporaryBuild;
  let server;
  let browser;
  let completed = false;
  try {
    temporaryBuild = await buildSite({ temporary: true });
    await mkdir(screenshotRoot, { recursive: true });
    const networkLedger = {
      externalRequestAttempts: [],
      externalWriteAttempts: [],
      continuedExternalRequests: [],
      localWriteAttempts: [],
      localApiMocks: [],
    };
    const serverLedger = { reads: [], rejectedWrites: [] };
    const started = await startReadOnlyServer(temporaryBuild.dist, serverLedger);
    server = started.server;
    const origin = started.origin;
    const launched = await launchBrowser();
    browser = launched.browser;
    const consoleErrors = [];
    const pageErrors = [];
    let pageNavigations = 0;
    let statesAudited = 0;

    for (const matrixEntry of auditMatrix) {
      const context = await browser.newContext({ viewport: { width: matrixEntry.width, height: matrixEntry.height } });
      await installQaBoundary(context, origin, networkLedger);
      const page = await context.newPage();
      let label = `${matrixEntry.name}/starting`;
      attachErrorAudit(page, () => label, consoleErrors, pageErrors);
      try {
        for (const filename of matrixEntry.files) {
          label = `${matrixEntry.name}/${filename}`;
          await openPage(page, origin, filename);
          pageNavigations += 1;
          statesAudited += 1;
          if (matrixEntry.auditMenuOpen) {
            const toggle = page.locator(".campaign-menu-toggle");
            await toggle.click();
            await page.locator("#campaign-nav.open").waitFor({ state: "visible" });
            statesAudited += 1;
          }
        }
      } finally {
        await context.close();
      }
    }

    const screenshotEvidence = [];
    for (const viewport of [
      { name: "mobile-390x844", width: 390, height: 844 },
      { name: "desktop-1440x1000", width: 1440, height: 1000 },
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      await installQaBoundary(context, origin, networkLedger);
      const page = await context.newPage();
      let label = `${viewport.name}/starting`;
      attachErrorAudit(page, () => label, consoleErrors, pageErrors);
      try {
        for (const filename of screenshotFiles) {
          label = `${viewport.name}/${filename}`;
          await openPage(page, origin, filename);
          await warmLazyImages(page);
          await capture(page, `${viewport.name}-${pageName(filename)}.png`, screenshotEvidence);
        }
      } finally {
        await context.close();
      }
    }

    const zoomContext = await browser.newContext({
      viewport: { width: 720, height: 500 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    await installQaBoundary(zoomContext, origin, networkLedger);
    const zoomPage = await zoomContext.newPage();
    let zoomLabel = "zoom-200/starting";
    attachErrorAudit(zoomPage, () => zoomLabel, consoleErrors, pageErrors);
    try {
      zoomLabel = "zoom-200/home-tab-focus";
      await openPage(zoomPage, origin, "index.html");
      await zoomPage.keyboard.press("Tab");
      const homeSkipLink = zoomPage.locator(".skip-link");
      await assertActiveElement(zoomPage, homeSkipLink, "Home skip link");
      assert.equal(await homeSkipLink.evaluate((element) => getComputedStyle(element).visibility), "visible");
      const homeSkipFocus = await homeSkipLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, transform: style.transform };
      });
      assert.notEqual(homeSkipFocus.outlineStyle, "none", "Home skip link must show a focus outline");
      assert.ok(parseFloat(homeSkipFocus.outlineWidth) >= 3, "Home skip link focus outline must remain visible");
      assert.notEqual(homeSkipFocus.transform, "none", "Home skip link must use its focused visible transform");
      await assertElementInViewport(zoomPage, homeSkipLink, "Home skip link");
      await capture(zoomPage, "zoom-200-home-tab-focus.png", screenshotEvidence, { fullPage: false });

      zoomLabel = "zoom-200/route-menu-open";
      await openPage(zoomPage, origin, "route.html");
      await zoomPage.locator(".campaign-menu-toggle").click();
      await zoomPage.locator("#campaign-nav.open").waitFor({ state: "visible" });
      await capture(zoomPage, "zoom-200-route-menu-open.png", screenshotEvidence, { fullPage: false });

      zoomLabel = "zoom-200/waiver-main-focus";
      await openPage(zoomPage, origin, "waiver.html");
      const waiverSkipLink = zoomPage.locator(".skip-link");
      assert.equal(await waiverSkipLink.getAttribute("href"), "#main", "Waiver skip link must target #main");
      await waiverSkipLink.focus();
      await assertActiveElement(zoomPage, waiverSkipLink, "Waiver skip link before activation");
      await waiverSkipLink.press("Enter");
      const waiverMain = zoomPage.locator("#main");
      await assertActiveElement(zoomPage, waiverMain, "Waiver #main after skip activation");
      await assertMainClearsStickyHeader(zoomPage, waiverMain);
      await capture(zoomPage, "zoom-200-waiver-main-focus.png", screenshotEvidence, { fullPage: false });
    } finally {
      await zoomContext.close();
    }

    const consoleErrorCount = consoleErrors.length;
    const pageErrorCount = pageErrors.length;
    assert.equal(pageNavigations, 72, "the canonical matrix must navigate 72 page/view combinations");
    assert.equal(statesAudited, 111, "the canonical matrix must audit 111 shell states");
    assert.equal(screenshotEvidence.length, 19, "the screenshot suite must contain 19 artifacts");
    assert.deepEqual(
      screenshotEvidence.map(({ artifactName }) => artifactName.replace("screenshots/", "")).sort(),
      expectedScreenshotNames.toSorted(),
      "the screenshot ledger must contain the exact expected artifacts",
    );
    assert.equal(consoleErrorCount, 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    assert.equal(pageErrorCount, 0, `page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(networkLedger.externalWriteAttempts.length, 0, "no external write may be attempted");
    assert.equal(networkLedger.continuedExternalRequests.length, 0, "no external request may leave the QA boundary");
    assert.equal(networkLedger.localWriteAttempts.length, 0, "the shell audit must not attempt local writes");
    assert.equal(serverLedger.rejectedWrites.length, 0, "no write may reach the read-only QA server");

    const requestClassifications = Object.fromEntries(
      [...new Set(networkLedger.externalRequestAttempts.map(({ resourceType }) => resourceType))]
        .sort()
        .map((resourceType) => [resourceType, networkLedger.externalRequestAttempts.filter((request) => request.resourceType === resourceType).length]),
    );
    const evidence = {
      ok: true,
      executedAt: executionStartedAt,
      runDate: executionStartedAt.slice(0, 10),
      isolated: true,
      browser: launched.source,
      browserFixtureTime: fixedNow,
      sourceRender: { campaignRoutes: campaignFiles.length, temporaryBuild: true, renderer: "renderCampaignPage" },
      audit: {
        pageNavigations,
        statesAudited,
        matrix: auditMatrix.map(({ name, width, height, files, auditMenuOpen }) => ({ name, width, height, routes: files.length, auditMenuOpen })),
        consoleErrorCount,
        pageErrorCount,
      },
      screenshots: { count: screenshotEvidence.length, artifacts: screenshotEvidence },
      networkBoundary: {
        externalRequestAttempts: networkLedger.externalRequestAttempts.length,
        classifications: requestClassifications,
        externalWriteAttempts: networkLedger.externalWriteAttempts.length,
        continuedExternalRequests: networkLedger.continuedExternalRequests.length,
        localWriteAttempts: networkLedger.localWriteAttempts.length,
        serverRejectedWrites: serverLedger.rejectedWrites.length,
      },
      localApiMocks: networkLedger.localApiMocks.length,
      serverReadCount: serverLedger.reads.length,
    };
    await writeFile(logPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    completed = true;
  } finally {
    if (browser) await browser.close();
    if (server) await closeServer(server);
    if (temporaryBuild) await temporaryBuild.cleanup();
    if (!preserveArtifacts) {
      await rm(artifactRoot, { recursive: true, force: true });
    }
    if (completed) {
      console.log(
        preserveArtifacts
          ? `Unified shell QA artifacts preserved in OS temp directory ${path.basename(artifactRoot)}`
          : "Unified shell QA artifacts removed after verification",
      );
    }
  }
}

await run();
