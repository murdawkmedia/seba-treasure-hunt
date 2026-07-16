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
assert.ok(campaignFiles.includes("updates.html"), "the public approved-report destination must remain in the canonical shell matrix");
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
  "desktop-route-lightbox.png",
  "mobile-route-lightbox.png",
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
      const relative = pathname === "/"
        ? "index.html"
        : pathname === "/route"
          ? "route.html"
          : pathname.replace(/^\/+/, "");
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

function attachErrorAudit(page, label, consoleErrors, pageErrors, requestFailures) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ label: label(), message: message.text(), location: message.location() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push({ label: label(), message: error.message }));
  page.on("requestfailed", (request) => requestFailures.push({
    label: label(),
    method: request.method(),
    url: request.url(),
    errorText: request.failure()?.errorText ?? "unknown request failure",
  }));
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

async function assertNoHorizontalViewportOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(
    geometry.documentScrollWidth <= geometry.viewportWidth + 1,
    `${label} document width ${geometry.documentScrollWidth} must not overflow viewport ${geometry.viewportWidth}`,
  );
  assert.ok(
    geometry.bodyScrollWidth <= geometry.viewportWidth + 1,
    `${label} body width ${geometry.bodyScrollWidth} must not overflow viewport ${geometry.viewportWidth}`,
  );
  assert.equal(geometry.documentClientWidth, geometry.viewportWidth, `${label} must not reserve horizontal overflow space`);
}

async function assertMinimumHitTargets(locators, label) {
  for (const [name, locator] of Object.entries(locators)) {
    await locator.waitFor({ state: "visible" });
    const box = await locator.boundingBox();
    assert.ok(box, `${label} ${name} control must have a visible box`);
    assert.ok(box.width >= 44, `${label} ${name} control width ${box.width} must be at least 44px`);
    assert.ok(box.height >= 44, `${label} ${name} control height ${box.height} must be at least 44px`);
  }
}

async function assertContainedRouteImage(page, image, label) {
  await image.waitFor({ state: "visible" });
  await page.waitForFunction((target) => target.complete && target.naturalWidth > 0 && target.naturalHeight > 0, await image.elementHandle());
  const geometry = await image.evaluate((element) => {
    const imageRect = element.getBoundingClientRect();
    const stageRect = element.closest(".route-lightbox__stage")?.getBoundingClientRect();
    return {
      complete: element.complete,
      naturalHeight: element.naturalHeight,
      naturalWidth: element.naturalWidth,
      objectFit: getComputedStyle(element).objectFit,
      image: { top: imageRect.top, right: imageRect.right, bottom: imageRect.bottom, left: imageRect.left, width: imageRect.width, height: imageRect.height },
      stage: stageRect
        ? { top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom, left: stageRect.left }
        : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  assert.equal(geometry.complete, true, `${label} image must finish loading`);
  assert.ok(geometry.naturalWidth > 0 && geometry.naturalHeight > 0, `${label} image must have nonzero intrinsic dimensions`);
  assert.ok(geometry.image.width > 0 && geometry.image.height > 0, `${label} image must have a nonzero rendered box`);
  assert.equal(geometry.objectFit, "contain", `${label} image must use contained rendering`);
  assert.ok(geometry.stage, `${label} image must remain inside its stage`);
  assert.ok(geometry.image.left >= geometry.stage.left - 1 && geometry.image.right <= geometry.stage.right + 1, `${label} image must fit the stage horizontally`);
  assert.ok(geometry.image.top >= geometry.stage.top - 1 && geometry.image.bottom <= geometry.stage.bottom + 1, `${label} image must fit the stage vertically`);
  assert.ok(geometry.image.left >= -1 && geometry.image.right <= geometry.viewport.width + 1, `${label} image must fit the viewport horizontally`);
  assert.ok(geometry.image.top >= -1 && geometry.image.bottom <= geometry.viewport.height + 1, `${label} image must fit the viewport vertically`);
}

async function dispatchUninterceptedFallbackClick(trigger, init) {
  return trigger.evaluate((element, clickInit) => {
    let defaultPreventedByLightbox = null;
    const qaNavigationGuard = (event) => {
      defaultPreventedByLightbox = event.defaultPrevented;
      event.preventDefault();
    };
    element.addEventListener("click", qaNavigationGuard, { once: true });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...clickInit }));
    return defaultPreventedByLightbox;
  }, init);
}

async function assertReducedMotionLightbox(dialog, label) {
  const audits = await dialog.evaluate((root) => {
    const toMilliseconds = (value) => {
      const trimmed = value.trim();
      return trimmed.endsWith("ms") ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
    };
    const describe = (element) => {
      const className = typeof element.className === "string" && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).join(".")}`
        : "";
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${className}`;
    };
    const collect = (element, pseudo = null) => {
      const style = getComputedStyle(element, pseudo);
      return {
        target: `${describe(element)}${pseudo ?? ""}`,
        durations: [...style.transitionDuration.split(","), ...style.animationDuration.split(",")].map(toMilliseconds),
      };
    };
    const elements = [root, ...root.querySelectorAll("*")];
    return elements.flatMap((element) => [
      collect(element),
      collect(element, "::before"),
      collect(element, "::after"),
      ...(element === root ? [collect(element, "::backdrop")] : []),
    ]);
  });
  for (const audit of audits) {
    assert.ok(
      audit.durations.every((duration) => Number.isFinite(duration) && duration <= 0.01),
      `${label} ${audit.target} transition/animation durations must resolve to zero or 0.01ms: ${audit.durations.join(", ")}`,
    );
  }
  return audits.length;
}

async function openRouteAuditPage(page, origin) {
  await page.goto(`${origin}/route`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-case-status]").waitFor({ state: "visible" });
  await page.locator("[data-route-lightbox]").waitFor({ state: "attached" });
  await page.waitForTimeout(100);
}

async function runRouteLightboxAudit({ browser, origin, networkLedger, consoleErrors, pageErrors, requestFailures, screenshotEvidence }) {
  let statesAudited = 0;
  let reducedMotionTargetsAudited = 0;
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await installQaBoundary(desktopContext, origin, networkLedger);
  const desktopPage = await desktopContext.newPage();
  let desktopLabel = "route-lightbox/desktop/starting";
  attachErrorAudit(desktopPage, () => desktopLabel, consoleErrors, pageErrors, requestFailures);
  try {
    await openRouteAuditPage(desktopPage, origin);
    const firstPhoto = desktopPage.locator("#stop-1 .stop-gallery .photo > a").first();
    const dialog = desktopPage.locator("[data-route-lightbox]");
    const title = dialog.locator("#route-lightbox-title");
    const counter = dialog.locator("[data-route-lightbox-counter]");
    const image = dialog.locator("[data-route-lightbox-image]");
    const caption = dialog.locator("[data-route-lightbox-caption]");
    const close = dialog.locator("[data-route-lightbox-close]");
    const previous = dialog.locator("[data-route-lightbox-previous]");
    const next = dialog.locator("[data-route-lightbox-next]");
    const original = dialog.locator("[data-route-lightbox-original]");

    desktopLabel = "route-lightbox/desktop/open-photo-1";
    await firstPhoto.click();
    await dialog.waitFor({ state: "visible" });
    assert.equal(await desktopPage.locator("dialog[open]").count(), 1, "desktop route must have exactly one open dialog");
    assert.equal(await desktopPage.locator("dialog[open]:visible").count(), 1, "desktop route must have exactly one visible dialog");
    assert.equal(await title.textContent(), "The Creek Property — The Starting Point");
    assert.equal(await counter.textContent(), "Photo 1 of 3");
    assert.match(await original.evaluate((element) => element.href), /\/assets\/route\/stop-01\/IMG_5034\.jpg$/);
    await assertContainedRouteImage(desktopPage, image, "Desktop route photo 1");
    await assertMinimumHitTargets({ Close: close, Previous: previous, Next: next }, "Desktop route lightbox");
    await assertNoHorizontalViewportOverflow(desktopPage, "Desktop route lightbox");
    reducedMotionTargetsAudited = await assertReducedMotionLightbox(dialog, "Reduced-motion route lightbox");
    statesAudited += 1;

    desktopLabel = "route-lightbox/desktop/keyboard";
    await desktopPage.keyboard.press("ArrowRight");
    assert.equal(await counter.textContent(), "Photo 2 of 3", "ArrowRight must advance the route lightbox");
    await desktopPage.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await assertActiveElement(desktopPage, firstPhoto, "Route photo trigger after Escape");
    statesAudited += 1;

    desktopLabel = "route-lightbox/desktop/progressive-fallback";
    for (const [name, clickInit] of [
      ["Control-click", { button: 0, ctrlKey: true }],
      ["Meta-click", { button: 0, metaKey: true }],
      ["middle-click", { button: 1 }],
    ]) {
      assert.equal(
        await dispatchUninterceptedFallbackClick(firstPhoto, clickInit),
        false,
        `${name} must reach the fallback anchor without being default-prevented by the lightbox`,
      );
      assert.equal(await dialog.isVisible(), false, `${name} must leave the dialog closed`);
    }
    statesAudited += 1;

    desktopLabel = "route-lightbox/desktop/singleton";
    const singletonPhoto = desktopPage.locator("#stop-4 .stop-gallery .photo > a").first();
    await singletonPhoto.click();
    await dialog.waitFor({ state: "visible" });
    assert.equal(await counter.textContent(), "Photo 1 of 1");
    assert.equal(await previous.isHidden(), true, "singleton Previous must be hidden");
    assert.equal(await previous.isDisabled(), true, "singleton Previous must be disabled");
    assert.equal(await next.isHidden(), true, "singleton Next must be hidden");
    assert.equal(await next.isDisabled(), true, "singleton Next must be disabled");
    await close.click();
    await dialog.waitFor({ state: "hidden" });
    await assertActiveElement(desktopPage, singletonPhoto, "Singleton route photo trigger after Close");
    statesAudited += 1;

    desktopLabel = "route-lightbox/desktop/image-failure";
    await firstPhoto.click();
    await dialog.waitFor({ state: "visible" });
    const healthySrc = await image.getAttribute("src");
    assert.ok(healthySrc, "route image must have a restorable source before failure audit");
    const errorEventObserved = await image.evaluate((element) => {
      let observed = false;
      element.addEventListener("error", () => {
        observed = true;
      }, { once: true });
      element.dispatchEvent(new Event("error"));
      return observed;
    });
    assert.equal(errorEventObserved, true, "isolated image must exercise its native error event without a network request");
    await caption.waitFor({ state: "visible" });
    await close.waitFor({ state: "visible" });
    await original.waitFor({ state: "visible" });
    assert.ok((await caption.textContent())?.trim(), "caption must remain populated after image failure");
    assert.match(await original.evaluate((element) => element.href), /\/assets\/route\/stop-01\/IMG_5034\.jpg$/);
    await original.focus();
    await assertActiveElement(desktopPage, original, "Open original link after image failure");
    await close.click();
    await dialog.waitFor({ state: "hidden" });
    await assertActiveElement(desktopPage, firstPhoto, "Route photo trigger after image-failure Close");
    await firstPhoto.click();
    await dialog.waitFor({ state: "visible" });
    assert.equal(await image.getAttribute("src"), healthySrc, "reopening the viewer must restore the healthy image source");
    await assertContainedRouteImage(desktopPage, image, "Recovered desktop route photo 1");
    await close.click();
    await dialog.waitFor({ state: "hidden" });
    await assertActiveElement(desktopPage, firstPhoto, "Route photo trigger after recovered-image Close");
    statesAudited += 1;

    desktopLabel = "route-lightbox/desktop/screenshot";
    await firstPhoto.click();
    await dialog.waitFor({ state: "visible" });
    await assertContainedRouteImage(desktopPage, image, "Desktop screenshot route photo");
    await capture(desktopPage, "desktop-route-lightbox.png", screenshotEvidence, { fullPage: false });
    statesAudited += 1;
  } finally {
    await desktopContext.close();
  }

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await installQaBoundary(mobileContext, origin, networkLedger);
  const mobilePage = await mobileContext.newPage();
  let mobileLabel = "route-lightbox/mobile/starting";
  attachErrorAudit(mobilePage, () => mobileLabel, consoleErrors, pageErrors, requestFailures);
  try {
    await openRouteAuditPage(mobilePage, origin);
    const firstPhoto = mobilePage.locator("#stop-1 .stop-gallery .photo > a").first();
    const dialog = mobilePage.locator("[data-route-lightbox]");
    const counter = dialog.locator("[data-route-lightbox-counter]");
    const image = dialog.locator("[data-route-lightbox-image]");
    const close = dialog.locator("[data-route-lightbox-close]");
    const previous = dialog.locator("[data-route-lightbox-previous]");
    const next = dialog.locator("[data-route-lightbox-next]");
    await firstPhoto.click();
    await dialog.waitFor({ state: "visible" });
    await assertContainedRouteImage(mobilePage, image, "Mobile route photo 1");

    mobileLabel = "route-lightbox/mobile/horizontal-swipe";
    const imageBox = await image.boundingBox();
    assert.ok(imageBox, "mobile route image must have swipe geometry");
    await mobilePage.mouse.move(imageBox.x + imageBox.width * 0.75, imageBox.y + imageBox.height * 0.5);
    await mobilePage.mouse.down();
    await mobilePage.mouse.move(imageBox.x + imageBox.width * 0.25, imageBox.y + imageBox.height * 0.53, { steps: 4 });
    await mobilePage.mouse.up();
    assert.equal(await counter.textContent(), "Photo 2 of 3", "horizontally dominant left swipe must advance to photo 2");
    statesAudited += 1;

    mobileLabel = "route-lightbox/mobile/vertical-gesture";
    await mobilePage.mouse.move(imageBox.x + imageBox.width * 0.45, imageBox.y + imageBox.height * 0.3);
    await mobilePage.mouse.down();
    await mobilePage.mouse.move(imageBox.x + imageBox.width * 0.55, imageBox.y + imageBox.height * 0.7, { steps: 4 });
    await mobilePage.mouse.up();
    assert.equal(await counter.textContent(), "Photo 2 of 3", "vertically dominant gesture must not change the route photo");
    await assertNoHorizontalViewportOverflow(mobilePage, "Mobile route lightbox");
    await assertMinimumHitTargets({ Close: close, Previous: previous, Next: next }, "Mobile route lightbox");
    await capture(mobilePage, "mobile-route-lightbox.png", screenshotEvidence, { fullPage: false });
    statesAudited += 1;
  } finally {
    await mobileContext.close();
  }

  const shortContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await installQaBoundary(shortContext, origin, networkLedger);
  const shortPage = await shortContext.newPage();
  let shortLabel = "route-lightbox/short-viewport/starting";
  attachErrorAudit(shortPage, () => shortLabel, consoleErrors, pageErrors, requestFailures);
  try {
    await openRouteAuditPage(shortPage, origin);
    const dialog = shortPage.locator("[data-route-lightbox]");
    const image = dialog.locator("[data-route-lightbox-image]");
    const close = dialog.locator("[data-route-lightbox-close]");
    const previous = dialog.locator("[data-route-lightbox-previous]");
    const next = dialog.locator("[data-route-lightbox-next]");
    shortLabel = "route-lightbox/short-viewport/open";
    await shortPage.locator("#stop-1 .stop-gallery .photo > a").first().click();
    await dialog.waitFor({ state: "visible" });
    await assertContainedRouteImage(shortPage, image, "Short 640x360 route photo");
    await assertMinimumHitTargets({ Close: close, Previous: previous, Next: next }, "Short 640x360 route lightbox");
    await assertElementInViewport(shortPage, close, "Short route Close control");
    await assertElementInViewport(shortPage, previous, "Short route Previous control");
    await assertElementInViewport(shortPage, next, "Short route Next control");
    await assertNoHorizontalViewportOverflow(shortPage, "Short 640x360 route lightbox");
    await next.click();
    assert.equal(await dialog.locator("[data-route-lightbox-counter]").textContent(), "Photo 2 of 3", "short route lightbox must remain operable");
    statesAudited += 1;
  } finally {
    await shortContext.close();
  }

  const zoomEquivalentViewport = { width: 320, height: 180 };
  const zoomEquivalentContext = await browser.newContext({ viewport: zoomEquivalentViewport });
  await installQaBoundary(zoomEquivalentContext, origin, networkLedger);
  const zoomEquivalentPage = await zoomEquivalentContext.newPage();
  let zoomEquivalentLabel = "route-lightbox/200-percent-zoom-equivalent/starting";
  attachErrorAudit(zoomEquivalentPage, () => zoomEquivalentLabel, consoleErrors, pageErrors, requestFailures);
  try {
    assert.deepEqual(
      zoomEquivalentPage.viewportSize(),
      zoomEquivalentViewport,
      "640x360 at 200% zoom must use the equivalent 320x180 CSS layout viewport",
    );
    const zoomMetrics = await zoomEquivalentPage.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    }));
    assert.deepEqual(
      { width: zoomMetrics.innerWidth, height: zoomMetrics.innerHeight },
      zoomEquivalentViewport,
      "200% zoom evidence must constrain the real CSS layout viewport",
    );
    assert.equal(zoomMetrics.devicePixelRatio, 1, "200% zoom evidence must not substitute raster device scale for layout zoom");
    await openRouteAuditPage(zoomEquivalentPage, origin);
    const dialog = zoomEquivalentPage.locator("[data-route-lightbox]");
    const image = dialog.locator("[data-route-lightbox-image]");
    const close = dialog.locator("[data-route-lightbox-close]");
    const previous = dialog.locator("[data-route-lightbox-previous]");
    const next = dialog.locator("[data-route-lightbox-next]");
    zoomEquivalentLabel = "route-lightbox/200-percent-zoom-equivalent/open";
    await zoomEquivalentPage.locator("#stop-1 .stop-gallery .photo > a").first().click();
    await dialog.waitFor({ state: "visible" });
    await assertContainedRouteImage(zoomEquivalentPage, image, "Route photo at 200% zoom equivalent");
    await assertMinimumHitTargets({ Close: close, Previous: previous, Next: next }, "Route lightbox at 200% zoom equivalent");
    await assertElementInViewport(zoomEquivalentPage, close, "200% zoom-equivalent Close control");
    await assertElementInViewport(zoomEquivalentPage, previous, "200% zoom-equivalent Previous control");
    await assertElementInViewport(zoomEquivalentPage, next, "200% zoom-equivalent Next control");
    await assertNoHorizontalViewportOverflow(zoomEquivalentPage, "Route lightbox at 200% zoom equivalent");
    await next.click();
    assert.equal(
      await dialog.locator("[data-route-lightbox-counter]").textContent(),
      "Photo 2 of 3",
      "route lightbox must remain operable at the 200% zoom-equivalent layout viewport",
    );
    statesAudited += 1;
  } finally {
    await zoomEquivalentContext.close();
  }

  return {
    statesAudited,
    reducedMotionTargetsAudited,
    viewports: ["1440x1000", "390x844", "640x360"],
    zoomEquivalent: {
      sourceViewport: "640x360",
      cssLayoutViewport: "320x180",
      scalePercent: 200,
      mechanism: "halved CSS layout viewport",
      deviceScaleFactor: 1,
    },
  };
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
    const requestFailures = [];
    let pageNavigations = 0;
    let statesAudited = 0;

    for (const matrixEntry of auditMatrix) {
      const context = await browser.newContext({ viewport: { width: matrixEntry.width, height: matrixEntry.height } });
      await installQaBoundary(context, origin, networkLedger);
      const page = await context.newPage();
      let label = `${matrixEntry.name}/starting`;
      attachErrorAudit(page, () => label, consoleErrors, pageErrors, requestFailures);
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
      attachErrorAudit(page, () => label, consoleErrors, pageErrors, requestFailures);
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

    const shellZoomEquivalent = {
      sourceViewport: { width: 720, height: 500 },
      cssLayoutViewport: { width: 360, height: 250 },
      scalePercent: 200,
      mechanism: "halved CSS layout viewport",
      deviceScaleFactor: 1,
    };
    const zoomContext = await browser.newContext({
      viewport: shellZoomEquivalent.cssLayoutViewport,
      reducedMotion: "reduce",
    });
    await installQaBoundary(zoomContext, origin, networkLedger);
    const zoomPage = await zoomContext.newPage();
    let zoomLabel = "zoom-200/starting";
    attachErrorAudit(zoomPage, () => zoomLabel, consoleErrors, pageErrors, requestFailures);
    try {
      assert.deepEqual(zoomPage.viewportSize(), shellZoomEquivalent.cssLayoutViewport, "shell 200% zoom evidence must halve the CSS layout viewport");
      assert.equal(
        await zoomPage.evaluate(() => window.devicePixelRatio),
        shellZoomEquivalent.deviceScaleFactor,
        "shell 200% zoom evidence must not substitute raster device scale for layout zoom",
      );
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

    const routeLightboxAudit = await runRouteLightboxAudit({
      browser,
      origin,
      networkLedger,
      consoleErrors,
      pageErrors,
      requestFailures,
      screenshotEvidence,
    });

    const consoleErrorCount = consoleErrors.length;
    const pageErrorCount = pageErrors.length;
    const requestFailureCount = requestFailures.length;
    assert.equal(pageNavigations, 72, "the canonical matrix must navigate 72 page/view combinations");
    assert.equal(statesAudited, 111, "the canonical matrix must audit 111 shell states");
    assert.equal(routeLightboxAudit.statesAudited, 10, "the route lightbox audit must exercise 10 browser states");
    assert.ok(routeLightboxAudit.reducedMotionTargetsAudited >= 40, "the route lightbox audit must inspect the complete element and pseudo-element tree for reduced motion");
    assert.equal(screenshotEvidence.length, 21, "the screenshot suite must contain 21 artifacts");
    assert.deepEqual(
      screenshotEvidence.map(({ artifactName }) => artifactName.replace("screenshots/", "")).sort(),
      expectedScreenshotNames.toSorted(),
      "the screenshot ledger must contain the exact expected artifacts",
    );
    assert.equal(consoleErrorCount, 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    assert.equal(pageErrorCount, 0, `page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(requestFailureCount, 0, `request failures: ${JSON.stringify(requestFailures)}`);
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
      reportPublicationSurface: { updatesRouteAudited: true, signedOutPublicShellOnly: true },
      shellZoomEquivalent,
      routeLightbox: routeLightboxAudit,
      audit: {
        pageNavigations,
        statesAudited,
        matrix: auditMatrix.map(({ name, width, height, files, auditMenuOpen }) => ({ name, width, height, routes: files.length, auditMenuOpen })),
        consoleErrorCount,
        pageErrorCount,
        requestFailureCount,
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
