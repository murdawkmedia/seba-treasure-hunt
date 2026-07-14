import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const readGeometry = (page, stripSelector, headerSelector) => page.evaluate(([stripSelector, headerSelector]) => {
  const strip = document.querySelector(stripSelector);
  const header = document.querySelector(headerSelector);
  const target = document.querySelector("#main, #top");
  if (!(strip instanceof HTMLElement) || !(header instanceof HTMLElement) || !(target instanceof HTMLElement)) return null;
  const rootStyles = getComputedStyle(document.documentElement);
  const stripHeight = strip.getBoundingClientRect().height;
  const headerHeight = header.getBoundingClientRect().height;
  const stripStyles = getComputedStyle(strip);
  const headerStyles = getComputedStyle(header);
  return {
    stripHeight,
    headerHeight,
    stripPosition: stripStyles.position,
    stripTop: Number.parseFloat(stripStyles.top),
    headerPosition: headerStyles.position,
    headerTop: Number.parseFloat(headerStyles.top),
    caseVariable: Number.parseFloat(rootStyles.getPropertyValue("--case-strip-height")),
    navVariable: Number.parseFloat(rootStyles.getPropertyValue("--campaign-nav-height")),
    stackedVariable: Number.parseFloat(rootStyles.getPropertyValue("--stacked-header-height")),
    scrollPaddingTop: Number.parseFloat(rootStyles.scrollPaddingTop),
    targetScrollMarginTop: Number.parseFloat(getComputedStyle(target).scrollMarginTop),
  };
}, [stripSelector, headerSelector]);

const waitForSyncedGeometry = async (page, stripSelector, headerSelector, minimumStripHeight = 0) => {
  await page.waitForFunction(([stripSelector, headerSelector, minimumStripHeight]) => {
    const strip = document.querySelector(stripSelector);
    const header = document.querySelector(headerSelector);
    const target = document.querySelector("#main, #top");
    if (!(strip instanceof HTMLElement) || !(header instanceof HTMLElement) || !(target instanceof HTMLElement)) return false;
    const rootStyles = getComputedStyle(document.documentElement);
    const stripHeight = strip.getBoundingClientRect().height;
    const headerHeight = header.getBoundingClientRect().height;
    const values = [
      Number.parseFloat(rootStyles.getPropertyValue("--case-strip-height")),
      Number.parseFloat(rootStyles.getPropertyValue("--campaign-nav-height")),
      Number.parseFloat(rootStyles.getPropertyValue("--stacked-header-height")),
      Number.parseFloat(rootStyles.scrollPaddingTop),
      Number.parseFloat(getComputedStyle(target).scrollMarginTop),
      Number.parseFloat(getComputedStyle(header).top),
    ];
    if (values.some((value) => !Number.isFinite(value))) return false;
    const stackedHeight = stripHeight + headerHeight;
    return stripHeight > minimumStripHeight
      && Math.abs(values[0] - stripHeight) <= 1
      && Math.abs(values[1] - headerHeight) <= 1
      && Math.abs(values[2] - stackedHeight) <= 1
      && Math.abs(values[3] - stackedHeight) <= 1
      && Math.abs(values[4] - stackedHeight) <= 1
      && Math.abs(values[5] - stripHeight) <= 1;
  }, [stripSelector, headerSelector, minimumStripHeight], { timeout: 3_000 });
  return readGeometry(page, stripSelector, headerSelector);
};

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

test("390px headers use measured compact stacked geometry and an operable menu", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  try {
    const page = await context.newPage();
    for (const [file, stripSelector, headerSelector] of [
      ["index.html", ".case-strip", ".campaign-header"],
      ["privacy.html", ".case-strip", ".campaign-header"],
      ["clue-board.html", ".case-strip", ".campaign-header"],
      ["sponsors.html", ".case-strip", ".campaign-header"],
    ]) {
      await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
      const geometry = await waitForSyncedGeometry(page, stripSelector, headerSelector);
      assert.ok(geometry, `${file} exposes both stacked rows`);
      assert.ok(geometry.stripHeight <= 76, `${file} case strip is ${geometry.stripHeight}px high`);
      assert.equal(geometry.stripPosition, "sticky", `${file} case strip is sticky`);
      assert.equal(geometry.stripTop, 0, `${file} case strip starts at the viewport top`);
      assert.equal(geometry.headerPosition, "sticky", `${file} campaign header is sticky`);
      assert.ok(Math.abs(geometry.headerTop - geometry.stripHeight) <= 1, `${file} header top ${geometry.headerTop}px matches strip ${geometry.stripHeight}px`);
    }

    for (const [file, stripSelector, headerSelector, labelSelector] of [
      ["privacy.html", ".case-strip", ".campaign-header", ".case-strip__label"],
      ["clue-board.html", ".case-strip", ".campaign-header", ".case-strip__label"],
    ]) {
      await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
      const normal = await waitForSyncedGeometry(page, stripSelector, headerSelector);
      await page.locator(labelSelector).evaluate((label) => {
        label.dataset.originalText = label.textContent ?? "";
        label.style.fontSize = "28px";
        label.textContent = "Official case status has changed and this deliberately long update must wrap across several lines to prove the live sticky offset follows the rendered row height.";
      });
      const grown = await waitForSyncedGeometry(page, stripSelector, headerSelector, 76);
      assert.ok(grown.stripHeight > normal.stripHeight, `${file} test content grows the first row`);
      await page.locator(labelSelector).evaluate((label) => {
        label.textContent = label.dataset.originalText ?? "";
        label.style.removeProperty("font-size");
        delete label.dataset.originalText;
      });
      await page.waitForFunction(([selector, grownHeight]) => {
        const strip = document.querySelector(selector);
        return strip instanceof HTMLElement && strip.getBoundingClientRect().height < grownHeight - 1;
      }, [stripSelector, grown.stripHeight]);
      const restored = await waitForSyncedGeometry(page, stripSelector, headerSelector);
      assert.ok(restored.stripHeight < grown.stripHeight, `${file} measured first-row variable shrinks after content restoration`);
    }

    await page.goto(`${origin}/sponsors.html`, { waitUntil: "domcontentloaded" });
    const readSponsorAnchors = () => page.evaluate(() => {
      const rootStyles = getComputedStyle(document.documentElement);
      const opportunities = document.querySelector("#opportunities");
      const inquiry = document.querySelector("#inquiry");
      if (!(opportunities instanceof HTMLElement) || !(inquiry instanceof HTMLElement)) return null;
      return {
        stackedHeight: Number.parseFloat(rootStyles.getPropertyValue("--stacked-header-height")),
        opportunitiesMargin: Number.parseFloat(getComputedStyle(opportunities).scrollMarginTop),
        inquiryMargin: Number.parseFloat(getComputedStyle(inquiry).scrollMarginTop),
      };
    });
    const normalSponsorGeometry = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header");
    const normalSponsorAnchors = await readSponsorAnchors();
    assert.ok(normalSponsorAnchors);
    assert.ok(Math.abs(normalSponsorAnchors.opportunitiesMargin - normalSponsorAnchors.stackedHeight) <= 1);
    assert.ok(Math.abs(normalSponsorAnchors.inquiryMargin - normalSponsorAnchors.stackedHeight) <= 1);
    await page.locator(".case-strip__label").evaluate((label) => {
      label.dataset.originalText = label.textContent ?? "";
      label.style.fontSize = "28px";
      label.textContent = "Sponsor case status has expanded into a deliberately long wrapped update so both primary conversion anchors must clear the complete live header stack.";
    });
    const grownSponsorGeometry = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header", 76);
    const grownSponsorAnchors = await readSponsorAnchors();
    assert.ok(grownSponsorGeometry.stackedVariable > normalSponsorGeometry.stackedVariable);
    assert.ok(Math.abs(grownSponsorAnchors.opportunitiesMargin - grownSponsorAnchors.stackedHeight) <= 1);
    assert.ok(Math.abs(grownSponsorAnchors.inquiryMargin - grownSponsorAnchors.stackedHeight) <= 1);
    await page.locator(".case-strip__label").evaluate((label) => {
      label.textContent = label.dataset.originalText ?? "";
      label.style.removeProperty("font-size");
      delete label.dataset.originalText;
    });
    await page.waitForFunction((grownHeight) => {
      const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stacked-header-height"));
      return Number.isFinite(value) && value < grownHeight - 1;
    }, grownSponsorGeometry.stackedVariable);
    const restoredSponsorGeometry = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header");
    const restoredSponsorAnchors = await readSponsorAnchors();
    assert.ok(restoredSponsorGeometry.stackedVariable < grownSponsorGeometry.stackedVariable);
    assert.ok(restoredSponsorAnchors.opportunitiesMargin < grownSponsorAnchors.opportunitiesMargin);
    assert.ok(Math.abs(restoredSponsorAnchors.opportunitiesMargin - restoredSponsorAnchors.stackedHeight) <= 1);
    assert.ok(Math.abs(restoredSponsorAnchors.inquiryMargin - restoredSponsorAnchors.stackedHeight) <= 1);

    await page.goto(`${origin}/privacy.html`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".campaign-menu-toggle");
    const nav = page.locator("#campaign-nav");
    assert.equal(await toggle.count(), 1);
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "none");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "flex");
    const expanded = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header");
    const nestedSponsorContent = nav.locator('a[href="/sponsors"] span[data-nested-link]');
    await nav.locator('a[href="/sponsors"]').evaluate((anchor) => {
      anchor.addEventListener("click", (event) => event.preventDefault(), { once: true });
      const nested = document.createElement("span");
      nested.dataset.nestedLink = "true";
      nested.textContent = " inquiry";
      anchor.append(nested);
    });
    await nestedSponsorContent.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "none");
    const nestedClosed = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header");
    assert.ok(nestedClosed.headerHeight < expanded.headerHeight, "nested link closure shrinks measured navigation height");
    await toggle.click();
    await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);

    await page.goto(`${origin}/clue-board.html`, { waitUntil: "domcontentloaded" });
    const boardToggle = page.locator(".campaign-menu-toggle");
    const boardNav = page.locator("#campaign-nav");
    assert.equal(await boardToggle.count(), 1);
    assert.equal(await boardNav.evaluate((element) => getComputedStyle(element).display), "none");
    await boardToggle.click();
    assert.equal(await boardToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await boardNav.evaluate((element) => getComputedStyle(element).display), "flex");
    const sponsors = boardNav.locator('a[href="/sponsors"]');
    const dashboard = boardNav.locator('a[href="/dashboard"]');
    assert.equal(await sponsors.isVisible(), true);
    assert.equal(await dashboard.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await boardToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await boardNav.evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await boardToggle.evaluate((element) => document.activeElement === element), true);
  } finally {
    await browser.close();
  }
});

test("stacked geometry remains live without ResizeObserver", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: undefined });
  });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${origin}/privacy.html`, { waitUntil: "domcontentloaded" });
    await waitForSyncedGeometry(page, ".case-strip", ".campaign-header");
    await page.locator(".case-strip__label").evaluate((label) => {
      label.style.fontSize = "28px";
      label.textContent = "This deliberately long live status update wraps repeatedly and must update sticky geometry even when ResizeObserver is not available.";
    });
    await waitForSyncedGeometry(page, ".case-strip", ".campaign-header", 76);
    await page.locator(".campaign-menu-toggle").click();
    const expanded = await waitForSyncedGeometry(page, ".case-strip", ".campaign-header", 76);
    assert.equal(await page.locator("#campaign-nav").evaluate((element) => getComputedStyle(element).display), "flex");
    assert.ok(expanded.stackedVariable > expanded.stripHeight, "fallback measures the expanded second row");
  } finally {
    await browser.close();
  }
});

test("short mobile viewports can scroll the full campaign menu into focus", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { viewport, files } of [
      { viewport: { width: 720, height: 500 }, files: ["index.html", "route.html", "interview.html", "clue-board.html"] },
      { viewport: { width: 320, height: 500 }, files: ["clue-board.html"] },
    ]) {
      const context = await browser.newContext({ viewport });
      await context.route("**/*", async (route) => {
        if (route.request().url().startsWith(origin)) await route.continue();
        else await route.abort();
      });
      const page = await context.newPage();

      for (const file of files) {
        await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
        const toggle = page.locator(".campaign-menu-toggle");
        await toggle.click();
        const initialScrollTop = await page.locator("#campaign-nav").evaluate((nav) => nav.scrollTop);
        const navLinkCount = await page.locator("#campaign-nav a").count();
        let focusedHref = null;
        for (let index = 0; index < navLinkCount; index += 1) {
          await page.keyboard.press("Tab");
          focusedHref = await page.evaluate(() => document.activeElement?.getAttribute("href"));
          if (focusedHref === "/sponsors") break;
        }
        assert.equal(focusedHref, "/sponsors", `${file} reaches Sponsors through keyboard Tab traversal`);
        const metrics = await page.evaluate(() => {
          const nav = document.querySelector("#campaign-nav");
          const sponsorLink = nav?.querySelector('a[href="/sponsors"]');
          if (!(nav instanceof HTMLElement) || !(sponsorLink instanceof HTMLElement)) return null;
          const navRect = nav.getBoundingClientRect();
          const sponsorRect = sponsorLink.getBoundingClientRect();
          const sponsorStyles = getComputedStyle(sponsorLink);
          const focusSpace = Number.parseFloat(sponsorStyles.outlineWidth) + Number.parseFloat(sponsorStyles.outlineOffset);
          return {
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            focusSpace,
            navBottom: navRect.bottom,
            navClientHeight: nav.clientHeight,
            navClientWidth: nav.clientWidth,
            navOverflowY: getComputedStyle(nav).overflowY,
            navScrollLeft: nav.scrollLeft,
            navScrollTop: nav.scrollTop,
            navScrollHeight: nav.scrollHeight,
            navScrollWidth: nav.scrollWidth,
            navLeft: navRect.left,
            navRight: navRect.right,
            navTop: navRect.top,
            sponsorBottom: sponsorRect.bottom,
            sponsorLeft: sponsorRect.left,
            sponsorRight: sponsorRect.right,
            sponsorTop: sponsorRect.top,
            viewportHeight: window.innerHeight,
          };
        });

        assert.ok(metrics, `${file} exposes menu geometry at ${viewport.width}x${viewport.height}`);
        assert.ok(metrics.documentOverflow <= 1, `${file} has no horizontal overflow at ${viewport.width}px`);
        assert.equal(metrics.navOverflowY, "auto", `${file} menu scroll is operable`);
        assert.ok(metrics.navScrollWidth <= metrics.navClientWidth, `${file} menu has no horizontal overflow`);
        assert.equal(metrics.navScrollLeft, 0, `${file} Tab traversal needs no horizontal scrolling`);
        assert.ok(
          metrics.navScrollHeight > metrics.navClientHeight,
          `${file} constrained menu has vertical overflow (${metrics.navScrollHeight} > ${metrics.navClientHeight})`,
        );
        assert.ok(metrics.navScrollTop > initialScrollTop, `${file} Tab traversal scrolls the menu vertically`);
        assert.ok(metrics.sponsorLeft >= metrics.navLeft + metrics.focusSpace - 1, `${file} Sponsors focus left is visible`);
        assert.ok(metrics.sponsorRight <= metrics.navRight - metrics.focusSpace + 1, `${file} Sponsors focus right is visible`);
        assert.ok(metrics.sponsorTop >= metrics.navTop + metrics.focusSpace - 1, `${file} Sponsors focus top is visible`);
        assert.ok(
          metrics.sponsorBottom <= Math.min(metrics.navBottom, metrics.viewportHeight) - metrics.focusSpace + 1,
          `${file} Sponsors focus bottom is visible (${metrics.sponsorBottom} <= ${Math.min(metrics.navBottom, metrics.viewportHeight) - metrics.focusSpace + 1}; scrollTop ${metrics.navScrollTop})`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("navigation remains usable when matchMedia is unavailable", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
  });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/privacy.html`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".campaign-menu-toggle");
    const nav = page.locator("#campaign-nav");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "flex");
    await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
