import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import axeCore from "axe-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const screenshotRoot = path.join(os.tmpdir(), "tim-lost-task10");
const defaultBaseUrl = "http://127.0.0.1:8788";
const configuredBaseUrl = process.env.SPONSOR_QA_BASE_URL || defaultBaseUrl;
const baseUrl = new URL(configuredBaseUrl);
const baseOrigin = baseUrl.origin;
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const sponsorInquiryPath = "/api/v1/sponsors/inquiries";
const validationNoticeFixture = `<aside class="validation-environment-notice" role="status" aria-label="Validation environment notice"><strong>Validation environment</strong><span>Test accounts and submissions will be deleted before launch.</span></aside>`;
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt", ".xml"]);

assert.ok(["http:", "https:"].includes(baseUrl.protocol), "SPONSOR_QA_BASE_URL must use HTTP or HTTPS.");

const evidence = {
  ok: false,
  runDate: "2026-07-13",
  baseUrl: baseOrigin,
  readOnly: true,
  sponsorPosts: 0,
  axeTags,
  checks: {},
  screenshots: [],
};

const routeUrl = (pathname) => new URL(pathname, `${baseOrigin}/`).href;
const round = (value) => Math.round(value * 100) / 100;
const near = (actual, expected, tolerance, label) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
};

async function packageVersion(relativePackageJson) {
  const value = JSON.parse(await readFile(path.join(root, relativePackageJson), "utf8"));
  return value.version;
}

async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ headless: true }), source: "playwright-chromium" };
  } catch (bundledError) {
    try {
      return { browser: await chromium.launch({ channel: "chrome", headless: true }), source: "system-chrome" };
    } catch (chromeError) {
      throw new Error(
        `Unable to launch Playwright Chromium or the Chrome channel. ${bundledError.message} ${chromeError.message}`,
      );
    }
  }
}

async function createQaPage(browser, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    bypassCSP: true,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  const tracker = { sponsorPosts: 0, consoleProblems: [] };

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === sponsorInquiryPath) {
      tracker.sponsorPosts += 1;
      await route.abort("blockedbyclient");
      return;
    }
    if (options.mockConfig && url.origin === baseOrigin && url.pathname === "/api/v1/config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { turnstileSiteKey: "test-only-site-key" } }),
      });
      return;
    }
    if (["http:", "https:"].includes(url.protocol) && !["GET", "HEAD"].includes(request.method())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  if (options.fakeTurnstile) {
    await context.addInitScript(() => {
      window.turnstile = {
        render(container, callbacks) {
          container.textContent = "Test-only mocked human check";
          queueMicrotask(() => callbacks.callback("test-only-token"));
          return "test-only-widget";
        },
        reset() {},
      };
    });
  }

  const page = await context.newPage();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      tracker.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => tracker.consoleProblems.push(`pageerror: ${error.message}`));
  return { context, page, tracker };
}

async function goto(page, pathname) {
  const response = await page.goto(routeUrl(pathname), { waitUntil: "domcontentloaded" });
  assert.ok(response, `${pathname} did not produce a navigation response.`);
  assert.equal(response.status(), 200, `${pathname} must return HTTP 200.`);
  await page.waitForFunction(() => document.readyState === "complete");
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert.ok(
    dimensions.documentScrollWidth <= dimensions.clientWidth && dimensions.bodyScrollWidth <= dimensions.clientWidth,
    `${label} has horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
  return dimensions;
}

async function initialStickyGeometry(page, stripSelector, headerSelector, expected, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  const geometry = await page.evaluate(({ stripSelector: strip, headerSelector: header }) => {
    const first = document.querySelector(strip);
    const second = document.querySelector(header);
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return null;
    const notice = document.querySelector(".validation-environment-notice");
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    const firstStyle = getComputedStyle(first);
    const secondStyle = getComputedStyle(second);
    const noticeRect = notice instanceof HTMLElement ? notice.getBoundingClientRect() : null;
    const noticeStyle = notice instanceof HTMLElement ? getComputedStyle(notice) : null;
    const noticeVisible = noticeRect && noticeStyle
      ? noticeRect.height > 0 && noticeStyle.display !== "none" && noticeStyle.visibility !== "hidden"
      : false;
    return {
      notice: noticeVisible
        ? {
            top: noticeRect.top,
            bottom: noticeRect.bottom,
            height: noticeRect.height,
            position: noticeStyle.position,
          }
        : null,
      strip: { top: firstRect.top, height: firstRect.height, position: firstStyle.position },
      header: { top: secondRect.top, height: secondRect.height, position: secondStyle.position },
      stack: firstRect.height + secondRect.height,
      cssStack: getComputedStyle(document.documentElement).getPropertyValue("--stacked-header-height").trim(),
    };
  }, { stripSelector, headerSelector });
  assert.ok(geometry, `${label} sticky rows must exist.`);
  assert.equal(geometry.strip.position, "sticky", `${label} first row must be sticky.`);
  assert.equal(geometry.header.position, "sticky", `${label} second row must be sticky.`);
  if (geometry.notice) {
    assert.ok(
      !["fixed", "sticky"].includes(geometry.notice.position),
      `${label} initial validation notice must remain non-sticky in document flow.`,
    );
    near(geometry.notice.top, 0, 1, `${label} initial validation notice top`);
    near(geometry.strip.top, geometry.notice.bottom, 1, `${label} initial first-row top after validation notice`);
    near(geometry.strip.top, geometry.notice.height, 2, `${label} initial first-row top equals validation notice height`);
    near(
      geometry.header.top,
      geometry.notice.height + geometry.strip.height,
      2,
      `${label} initial second-row top after validation notice`,
    );
  } else {
    near(geometry.strip.top, 0, 1, `${label} initial first-row top without validation notice`);
    near(geometry.header.top, geometry.strip.height, 2, `${label} initial second-row top without validation notice`);
  }
  near(geometry.strip.height, expected.stripHeight, 2, `${label} first-row height`);
  near(geometry.header.height, expected.headerHeight, 3, `${label} second-row height`);
  near(geometry.stack, expected.stack, 4, `${label} stacked height`);
  return {
    notice: geometry.notice
      ? {
          present: true,
          top: round(geometry.notice.top),
          bottom: round(geometry.notice.bottom),
          height: round(geometry.notice.height),
          position: geometry.notice.position,
        }
      : { present: false },
    stripTop: round(geometry.strip.top),
    stripHeight: round(geometry.strip.height),
    headerTop: round(geometry.header.top),
    headerHeight: round(geometry.header.height),
    stack: round(geometry.stack),
    cssStack: geometry.cssStack,
  };
}

async function axe(page, label) {
  await page.addScriptTag({ content: axeCore.source });
  const result = await page.evaluate(async (tags) => {
    const report = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    }));
  }, axeTags);
  assert.deepEqual(result, [], `${label} axe violations: ${JSON.stringify(result)}`);
  return { tags: axeTags, violations: 0 };
}

async function saveScreenshot(page, name) {
  const filename = `${name}.png`;
  const absolutePath = path.join(screenshotRoot, filename);
  await page.screenshot({ path: absolutePath, fullPage: true });
  const digest = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
  const artifact = { filename, sha256: digest };
  evidence.screenshots.push(artifact);
  return artifact;
}

async function assertSponsorCurrent(page) {
  const state = await page.locator('.nav-sponsors[aria-current="page"]').evaluate((element) => ({
    ariaCurrent: element.getAttribute("aria-current"),
    backgroundColor: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));
  assert.equal(state.ariaCurrent, "page");
  assert.notEqual(state.backgroundColor, "rgba(0, 0, 0, 0)", "Sponsors must retain its gold current-page treatment.");
  return state;
}

async function assertStickyRowsAfterScroll(page, stripSelector, headerSelector, label) {
  await page.waitForFunction(({ stripSelector: strip, headerSelector: header }) => {
    const first = document.querySelector(strip)?.getBoundingClientRect();
    const second = document.querySelector(header)?.getBoundingClientRect();
    return first
      && second
      && Math.abs(first.top) <= 1
      && Math.abs(second.top - first.height) <= 2;
  }, { stripSelector, headerSelector });
  const geometry = await page.evaluate(({ stripSelector: strip, headerSelector: header }) => {
    const first = document.querySelector(strip)?.getBoundingClientRect();
    const second = document.querySelector(header)?.getBoundingClientRect();
    return first && second
      ? { stripTop: first.top, stripHeight: first.height, headerTop: second.top, headerHeight: second.height }
      : null;
  }, { stripSelector, headerSelector });
  assert.ok(geometry, `${label} sticky rows must remain measurable.`);
  near(geometry.stripTop, 0, 1, `${label} scrolled first-row top`);
  near(geometry.headerTop, geometry.stripHeight, 2, `${label} scrolled second-row top`);
  return {
    stripTop: round(geometry.stripTop),
    stripHeight: round(geometry.stripHeight),
    headerTop: round(geometry.headerTop),
    headerHeight: round(geometry.headerHeight),
    stack: round(geometry.stripHeight + geometry.headerHeight),
  };
}

async function scrollPastNoticeAndAssertStickyRows(page, stripSelector, headerSelector, label) {
  await page.evaluate(() => {
    const notice = document.querySelector(".validation-environment-notice");
    const noticeHeight = notice instanceof HTMLElement ? notice.getBoundingClientRect().height : 0;
    window.scrollTo({ top: Math.max(noticeHeight + 16, 160), behavior: "instant" });
  });
  assert.ok(
    await page.evaluate(() => window.scrollY > 0),
    `${label} navigation must scroll past the validation notice.`,
  );
  return assertStickyRowsAfterScroll(page, stripSelector, headerSelector, label);
}

async function assertStickyRowsAfterSurfaceScroll(page, stripSelector, headerSelector, label) {
  const atInitialFlow = await page.evaluate(() => window.scrollY === 0);
  if (atInitialFlow) {
    return scrollPastNoticeAndAssertStickyRows(page, stripSelector, headerSelector, label);
  }
  return assertStickyRowsAfterScroll(page, stripSelector, headerSelector, label);
}

async function validationNoticeGeometry(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 1440, height: 1000 });
  try {
    await goto(page, "/sponsors");
    const fixture = await page.evaluate((markup) => {
      const beforeCount = document.querySelectorAll(".validation-environment-notice").length;
      if (beforeCount > 1) throw new Error(`Expected at most one validation notice before fixture setup, received ${beforeCount}.`);
      if (beforeCount === 0) document.body.insertAdjacentHTML("afterbegin", markup);
      const notices = document.querySelectorAll(".validation-environment-notice");
      return {
        source: beforeCount === 0 ? "injected" : "existing",
        beforeCount,
        afterCount: notices.length,
        firstInBody: notices[0] === document.body.firstElementChild,
      };
    }, validationNoticeFixture);
    assert.equal(fixture.afterCount, 1, "Validation notice fixture must leave exactly one notice in the page.");
    assert.equal(fixture.firstInBody, true, "Validation notice fixture must participate in the site's normal body flow.");

    const initialGeometry = await initialStickyGeometry(
      page,
      ".case-strip",
      ".campaign-header",
      { stripHeight: 54, headerHeight: 113, stack: 167 },
      "Validation notice fixture",
    );
    assert.equal(initialGeometry.notice.present, true, "Validation notice fixture must always exercise notice-present geometry.");
    assert.equal(initialGeometry.notice.position, "relative", "Validation notice fixture must use the site's relative notice CSS.");
    const postScrollGeometry = await scrollPastNoticeAndAssertStickyRows(
      page,
      ".case-strip",
      ".campaign-header",
      "Validation notice fixture",
    );
    assert.equal(tracker.sponsorPosts, 0, "Validation notice fixture must observe zero sponsor POSTs.");
    evidence.sponsorPosts += tracker.sponsorPosts;
    return {
      scenario: "Validation notice fixture",
      source: fixture.source,
      beforeCount: fixture.beforeCount,
      afterCount: fixture.afterCount,
      initialGeometry,
      postScrollGeometry,
      sponsorPosts: tracker.sponsorPosts,
    };
  } finally {
    await context.close();
  }
}

async function sponsorDesktop(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 1440, height: 1000 });
  try {
    await goto(page, "/sponsors");
    const overflow = await noOverflow(page, "Sponsor desktop");
    const initialGeometry = await initialStickyGeometry(
      page,
      ".case-strip",
      ".campaign-header",
      { stripHeight: 54, headerHeight: 113, stack: 167 },
      "Sponsor desktop",
    );
    const current = await assertSponsorCurrent(page);
    const mainTop = await page.locator("#main").evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(mainTop >= initialGeometry.stack - 2, "The skip-link target must begin below both sticky rows.");

    await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => window.scrollY > 0);
    assert.ok(
      await page.evaluate(() => window.scrollY > 0),
      "Sponsor inquiry scroll action must move past the validation notice.",
    );
    const postScrollGeometry = await assertStickyRowsAfterScroll(page, ".case-strip", ".campaign-header", "Sponsor inquiry");
    await page.locator("#inquiry").evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await assertStickyRowsAfterScroll(page, ".case-strip", ".campaign-header", "Sponsor inquiry clearance");
    const inquiryTop = await page.locator("#inquiry").evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(inquiryTop >= postScrollGeometry.stack - 2, "Inquiry anchor must clear both sticky rows.");

    for (const selector of [
      "#sponsor-hero",
      ".opportunity-card:last-child",
      "[data-sponsor-form]",
      "#sponsor-faq",
      ".campaign-footer",
    ]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.waitForTimeout(50);
      await assertStickyRowsAfterSurfaceScroll(page, ".case-strip", ".campaign-header", `Sponsor ${selector}`);
    }

    const submit = page.locator("[data-sponsor-submit]");
    await page.waitForFunction(() => {
      const shell = document.querySelector("[data-sponsor-turnstile]");
      return shell?.textContent?.toLowerCase().includes("unavailable") === true;
    }, null, { timeout: 6_000 });
    assert.equal(await submit.isDisabled(), true, "Local sponsor submission must fail closed without Turnstile configuration.");
    assert.equal(tracker.consoleProblems.length, 0, `Sponsor desktop console problems: ${tracker.consoleProblems.join(" | ")}`);
    evidence.sponsorPosts += tracker.sponsorPosts;

    const accessibility = await axe(page, "Sponsor desktop");
    const screenshot = await saveScreenshot(page, "sponsors-desktop-1440x1000");
    return {
      viewport: { width: 1440, height: 1000 },
      overflow,
      geometry: initialGeometry,
      postScrollGeometry,
      mainTop: round(mainTop),
      inquiryTop: round(inquiryTop),
      current,
      failClosed: true,
      consoleProblems: 0,
      accessibility,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function exerciseMobileMenu(page, toggleSelector, navSelector, sponsorSelector, testLinkActivation) {
  const toggle = page.locator(toggleSelector);
  const nav = page.locator(navSelector);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true", "Mobile menu must open.");
  assert.equal(await page.locator(sponsorSelector).isVisible(), true, "Sponsors must be visible in the mobile menu.");

  if (testLinkActivation) {
    await page.locator(sponsorSelector).click();
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.locator(toggleSelector).getAttribute("aria-expanded"), "false", "Link activation must close the menu.");
  }

  await page.locator(toggleSelector).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(toggleSelector).getAttribute("aria-expanded"), "false", "Escape must close the menu.");
  assert.equal(await page.locator(toggleSelector).evaluate((element) => document.activeElement === element), true, "Escape must return focus to the menu toggle.");
  assert.equal(await nav.evaluate((element) => element.classList.contains("open")), false, "The mobile nav must not remain open.");
}

async function sponsorMobile(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 390, height: 844 });
  try {
    await goto(page, "/sponsors");
    const overflow = await noOverflow(page, "Sponsor mobile");
    const geometry = await initialStickyGeometry(
      page,
      ".case-strip",
      ".campaign-header",
      { stripHeight: 72, headerHeight: 60, stack: 132 },
      "Sponsor mobile",
    );
    const postScrollGeometry = await scrollPastNoticeAndAssertStickyRows(
      page,
      ".case-strip",
      ".campaign-header",
      "Sponsor mobile",
    );
    await exerciseMobileMenu(page, ".campaign-menu-toggle", "#campaign-nav", "#campaign-nav .nav-sponsors", true);

    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".opportunity-card")];
      const cardRects = cards.map((card) => card.getBoundingClientRect());
      const form = document.querySelector("[data-sponsor-form]");
      const formRect = form?.getBoundingClientRect();
      return {
        cardWidths: cardRects.map((rect) => rect.width),
        cardTops: cardRects.map((rect) => rect.top),
        inlineMinHeights: cards.map((card) => card.style.minHeight),
        computedMinHeights: cards.map((card) => getComputedStyle(card).minHeight),
        formWidth: formRect?.width ?? 0,
      };
    });
    assert.ok(layout.cardWidths.every((width) => width >= 340 && width <= 365), `Mobile cards must use the available single-column width: ${layout.cardWidths}`);
    assert.ok(layout.cardTops.every((top, index) => index === 0 || top > layout.cardTops[index - 1]), "Mobile cards must stack vertically.");
    assert.ok(layout.inlineMinHeights.every((value) => value === ""), "Mobile cards must not have artificial inline heights.");
    assert.ok(layout.computedMinHeights.every((value) => value === "auto" || value === "0px"), `Mobile card min-height must remain automatic: ${layout.computedMinHeights}`);
    assert.ok(layout.formWidth >= 340 && layout.formWidth <= 365, `Mobile form must remain readable: ${layout.formWidth}`);

    for (const selector of [
      "[data-sponsor-form]",
      ".acknowledgement-field",
      "[data-sponsor-turnstile]",
      "[data-sponsor-submit]",
    ]) {
      assert.equal(await page.locator(selector).isVisible(), true, `${selector} must be visible on mobile.`);
    }
    assert.equal(await page.locator("[data-sponsor-result]").count(), 1, "The mobile result region must remain present.");
    await page.waitForFunction(() => document.querySelector("[data-sponsor-turnstile]")?.textContent?.toLowerCase().includes("unavailable") === true, null, { timeout: 6_000 });
    assert.equal(await page.locator("[data-sponsor-submit]").isDisabled(), true, "Mobile submission must fail closed locally.");
    evidence.sponsorPosts += tracker.sponsorPosts;

    const accessibility = await axe(page, "Sponsor mobile");
    const screenshot = await saveScreenshot(page, "sponsors-mobile-390x844");
    return {
      viewport: { width: 390, height: 844 },
      overflow,
      geometry,
      postScrollGeometry,
      layout: {
        cardWidths: layout.cardWidths.map(round),
        formWidth: round(layout.formWidth),
        minHeights: layout.computedMinHeights,
      },
      menu: { sponsorsVisible: true, linkCloses: true, escapeClosesAndReturnsFocus: true },
      failClosed: true,
      accessibility,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function sponsorZoomEquivalent(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 720, height: 500 });
  try {
    await goto(page, "/sponsors");
    const overflow = await noOverflow(page, "Sponsor zoom-equivalent");
    const geometry = await initialStickyGeometry(
      page,
      ".case-strip",
      ".campaign-header",
      { stripHeight: 72, headerHeight: 60, stack: 132 },
      "Sponsor zoom-equivalent",
    );
    const heroTop = await page.locator("#sponsor-hero").evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(heroTop >= geometry.stack - 2, `Zoom-equivalent hero must begin below the sticky stack: ${heroTop}`);
    const postScrollGeometry = await scrollPastNoticeAndAssertStickyRows(
      page,
      ".case-strip",
      ".campaign-header",
      "Sponsor zoom-equivalent",
    );
    evidence.sponsorPosts += tracker.sponsorPosts;
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = await saveScreenshot(page, "sponsors-zoom-equivalent-720x500");
    return {
      viewport: { width: 720, height: 500 },
      overflow,
      geometry,
      postScrollGeometry,
      heroTop: round(heroTop),
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function clueBoardMobile(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 390, height: 844 });
  try {
    await goto(page, "/clue-board");
    const overflow = await noOverflow(page, "Clue Board mobile");
    const geometry = await initialStickyGeometry(
      page,
      ".case-strip",
      ".campaign-header",
      { stripHeight: 72, headerHeight: 60, stack: 132 },
      "Clue Board mobile",
    );
    const postScrollGeometry = await scrollPastNoticeAndAssertStickyRows(
      page,
      ".case-strip",
      ".campaign-header",
      "Clue Board mobile",
    );
    await exerciseMobileMenu(page, ".campaign-menu-toggle", "#campaign-nav", "#campaign-nav .nav-sponsors", false);
    evidence.sponsorPosts += tracker.sponsorPosts;
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = await saveScreenshot(page, "clue-board-mobile-390x844");
    return {
      viewport: { width: 390, height: 844 },
      overflow,
      geometry,
      postScrollGeometry,
      menu: { sponsorsVisible: true, escapeClosesAndReturnsFocus: true },
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function opsGate(browser) {
  const { context, page, tracker } = await createQaPage(browser, { width: 1440, height: 1000 });
  try {
    await goto(page, "/ops");
    await page.waitForFunction(() => document.querySelector("#ops-auth-config")?.textContent?.toLowerCase().includes("not configured") === true);
    assert.equal(await page.locator("#ops-auth-panel").isVisible(), true, "The unauthenticated Ops gate must be visible.");
    assert.equal(await page.locator("#ops-app").isHidden(), true, "The authorized Ops application must remain hidden.");
    const sponsorPanel = page.locator('[data-view-panel="sponsors"]');
    assert.equal(await sponsorPanel.count(), 1, "The authorized sponsor panel must exist in the static Ops shell.");
    assert.equal(await sponsorPanel.isHidden(), true, "The sponsor panel must remain hidden while unauthenticated.");
    evidence.sponsorPosts += tracker.sponsorPosts;
    const accessibility = await axe(page, "Unauthenticated Ops gate");
    const screenshot = await saveScreenshot(page, "ops-unauthenticated-1440x1000");
    return {
      gatewayVisible: true,
      authorizedAppHidden: true,
      sponsorPanelPresentAndHidden: true,
      accessibility,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function mockedInvalidForm(browser) {
  const { context, page, tracker } = await createQaPage(
    browser,
    { width: 1440, height: 1000 },
    { mockConfig: true, fakeTurnstile: true },
  );
  try {
    await goto(page, "/sponsors");
    const submit = page.locator("[data-sponsor-submit]");
    await page.waitForFunction(() => document.querySelector("[data-sponsor-submit]")?.disabled === false);
    assert.equal(await submit.isEnabled(), true, "Test-only mocked Turnstile must enable validation testing.");
    await submit.click();
    const contact = page.locator("#sponsor-contact");
    assert.equal(await contact.getAttribute("aria-invalid"), "true", "Empty submission must mark contactName invalid.");
    assert.equal(await contact.evaluate((element) => document.activeElement === element), true, "Empty submission must focus contactName.");
    assert.equal(tracker.sponsorPosts, 0, "Test-only mocked validation must observe zero sponsor POSTs.");
    evidence.sponsorPosts += tracker.sponsorPosts;
    return {
      boundary: "test-only mocked /api/v1/config and fake Turnstile",
      submitEnabledForInvalidFormOnly: true,
      focusedSelector: "#sponsor-contact",
      ariaInvalid: "true",
      sponsorPosts: tracker.sponsorPosts,
    };
  } finally {
    await context.close();
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else files.push(absolutePath);
  }
  return files;
}

function matches(text, regex) {
  return [...text.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))].map((match) => match[0]);
}

async function builtOutputScans() {
  const allFiles = await walk(distRoot);
  const candidates = await Promise.all(allFiles.map(async (absolutePath) => ({
    absolutePath,
    buffer: await readFile(absolutePath),
  })));
  const documents = candidates
    .filter(({ buffer }) => !buffer.subarray(0, 8_192).includes(0))
    .map(({ absolutePath, buffer }) => ({
      path: path.relative(root, absolutePath).replaceAll("\\", "/"),
      text: buffer.toString("utf8"),
    }));
  const broadPattern = /sponsor_inquiries|sponsor_inquiry_events|private note|@sebahub\.com|@businessasaforceforgood\.ca|CFCW/i;
  const allowedBroadPaths = {
    sponsor_inquiries: new Set(["dist/_worker.js"]),
    sponsor_inquiry_events: new Set(["dist/_worker.js"]),
    "private note": new Set(["dist/assets/app/ops.js"]),
    "@sebahub.com": new Set(["dist/privacy.html", "dist/route.html"]),
    "@businessasaforceforgood.ca": new Set(),
    cfcw: new Set(),
  };
  const broadMatches = [];
  for (const document of documents) {
    for (const value of matches(document.text, broadPattern)) {
      const normalized = value.toLowerCase();
      assert.ok(allowedBroadPaths[normalized]?.has(document.path), `Unexpected broad privacy-scan match ${value} in ${document.path}`);
      broadMatches.push({ path: document.path, value });
    }
  }
  for (const [value, allowedPaths] of Object.entries(allowedBroadPaths)) {
    for (const expectedPath of allowedPaths) {
      assert.ok(
        broadMatches.some((match) => match.path === expectedPath && match.value.toLowerCase() === value),
        `Expected broad privacy-scan match ${value} in ${expectedPath}`,
      );
    }
  }
  const opsDocument = documents.find((document) => document.path === "dist/assets/app/ops.js");
  assert.ok(opsDocument, "The built Ops implementation bundle must exist.");
  const reviewedPrivateNoteCopy = [
    "Add an optional private note for this status change:",
    "Add a private note for this sponsor state change (optional, 2,000 characters maximum):",
    "Private notes must be 2,000 characters or fewer.",
  ];
  for (const reviewedCopy of reviewedPrivateNoteCopy) {
    assert.ok(opsDocument.text.includes(reviewedCopy), `The classified private-note copy must retain: ${reviewedCopy}`);
  }
  assert.equal(
    matches(opsDocument.text, /private note/i).length,
    reviewedPrivateNoteCopy.length,
    "Only the reviewed private-note copy strings are allowed.",
  );

  const exactPublicContacts = new Map([
    ["casey@sebahub.com", new Set(["dist/route.html"])],
    ["info@sebahub.com", new Set(["dist/privacy.html"])],
  ]);
  const contactMatches = [];
  for (const document of documents) {
    for (const value of matches(document.text, /[a-z0-9._%+-]+@(?:sebahub\.com|businessasaforceforgood\.ca)/i)) {
      const normalized = value.toLowerCase();
      assert.ok(exactPublicContacts.get(normalized)?.has(document.path), `Unexpected public contact ${value} in ${document.path}`);
      contactMatches.push({ path: document.path, value: normalized });
    }
  }

  const correctedPattern = /sponsor_inquiries|sponsor_inquiry_events|private note|CFCW/i;
  const correctedExclusions = new Set(["dist/_worker.js", "dist/assets/app/ops.js"]);
  const correctedMatches = documents.flatMap((document) => correctedExclusions.has(document.path)
    ? []
    : matches(document.text, correctedPattern).map((value) => ({ path: document.path, value })));
  assert.deepEqual(correctedMatches, [], `Corrected rendered-public scan found ${JSON.stringify(correctedMatches)}`);

  const fixturePatternText = "alex@example.test|Good local fit|staff_subject";
  const fixturePattern = new RegExp(fixturePatternText, "i");
  const fixtureMatches = documents.flatMap((document) => matches(document.text, fixturePattern).map((value) => ({ path: document.path, value })));
  assert.deepEqual(fixtureMatches, [], `Built output contains private test fixture data: ${JSON.stringify(fixtureMatches)}`);

  const cfcwMatches = documents.flatMap((document) => matches(document.text, /CFCW/i).map((value) => ({ path: document.path, value })));
  assert.deepEqual(cfcwMatches, [], `Built output contains CFCW: ${JSON.stringify(cfcwMatches)}`);

  const sponsorsHtml = await readFile(path.join(distRoot, "sponsors.html"), "utf8");
  assert.deepEqual(matches(sponsorsHtml, /@sebahub\.com|@businessasaforceforgood\.ca/i), [], "Sponsor page must not publish contact addresses.");

  return {
    broadPattern: broadPattern.source,
    broadDisposition: {
      matchCount: broadMatches.length,
      pathsByValue: Object.fromEntries(Object.keys(allowedBroadPaths).map((value) => [
        value,
        [...new Set(broadMatches.filter((match) => match.value.toLowerCase() === value).map((match) => match.path))],
      ])),
      countsByValue: Object.fromEntries(Object.keys(allowedBroadPaths).map((value) => [
        value,
        broadMatches.filter((match) => match.value.toLowerCase() === value).length,
      ])),
      exactPublicContacts: Object.fromEntries([...exactPublicContacts].map(([address, paths]) => [address, [...paths]])),
      privateNoteCopy: reviewedPrivateNoteCopy,
    },
    correctedRenderedPublicScan: {
      pattern: correctedPattern.source,
      includedScope: "all non-binary files under dist",
      includedExtensions: [...textExtensions].sort(),
      includedExtensionlessPaths: documents
        .filter((document) => path.extname(document.path) === "")
        .map((document) => document.path)
        .sort(),
      excludedPaths: [...correctedExclusions],
      matches: 0,
    },
    fixturePattern: fixturePatternText,
    fixtureMatches: 0,
    cfcwMatches: 0,
    sponsorContactMatches: 0,
  };
}

async function httpChecks() {
  const sponsors = await fetch(routeUrl("/sponsors"), { redirect: "manual" });
  assert.equal(sponsors.status, 200, "/sponsors must return HTTP 200.");

  const status = await fetch(routeUrl("/api/v1/status"), { headers: { Accept: "application/json" } });
  const statusBody = await status.json();
  assert.equal(status.status, 200, "/api/v1/status must return HTTP 200.");
  assert.equal(statusBody?.data?.state, "open", "The local status payload must remain OPEN.");

  const worker = await fetch(routeUrl("/_worker.js"), { redirect: "manual" });
  assert.equal(worker.status, 404, "/_worker.js must not be publicly served.");

  const ops = await fetch(routeUrl("/api/v1/ops/sponsors"), { headers: { Accept: "application/json" } });
  const opsBody = await ops.json();
  assert.equal(ops.status, 401, "Unauthenticated Ops sponsors must return HTTP 401.");
  assert.equal(opsBody?.error?.code, "staff_auth_required", "Unauthenticated Ops sponsors must return the safe auth code.");
  assert.equal(Object.hasOwn(opsBody, "data"), false, "Unauthenticated Ops sponsors must return no inquiry data.");

  return {
    sponsors: sponsors.status,
    status: { http: status.status, state: statusBody.data.state, version: statusBody.data.version },
    workerBundle: worker.status,
    unauthenticatedOpsSponsors: { http: ops.status, code: opsBody.error.code, hasData: false },
  };
}

async function main() {
  await mkdir(screenshotRoot, { recursive: true });
  evidence.toolVersions = {
    playwright: await packageVersion("node_modules/@playwright/test/package.json"),
    axeCore: await packageVersion("node_modules/axe-core/package.json"),
  };
  evidence.checks.builtOutput = await builtOutputScans();
  evidence.checks.http = await httpChecks();

  const { browser, source } = await launchBrowser();
  evidence.browser = source;
  try {
    evidence.checks.validationNoticeGeometry = await validationNoticeGeometry(browser);
    evidence.checks.sponsorDesktop = await sponsorDesktop(browser);
    evidence.checks.sponsorMobile = await sponsorMobile(browser);
    evidence.checks.sponsorZoomEquivalent = await sponsorZoomEquivalent(browser);
    evidence.checks.clueBoardMobile = await clueBoardMobile(browser);
    evidence.checks.opsGate = await opsGate(browser);
    evidence.checks.mockedInvalidForm = await mockedInvalidForm(browser);
  } finally {
    await browser.close();
  }

  assert.equal(evidence.sponsorPosts, 0, "The complete QA run must observe zero sponsor POSTs.");
  evidence.ok = true;
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl: baseOrigin,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
