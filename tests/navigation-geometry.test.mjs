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

const readFocusStyle = (locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  const parseColor = (color) => {
    const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
    return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
  };
  let effectiveBackground = [0, 0, 0, 0];
  for (let current = element; current instanceof Element; current = current.parentElement) {
    const background = parseColor(getComputedStyle(current).backgroundColor);
    const outputAlpha = effectiveBackground[3] + (background[3] * (1 - effectiveBackground[3]));
    if (outputAlpha > 0) {
      effectiveBackground = [
        ((effectiveBackground[0] * effectiveBackground[3]) + (background[0] * background[3] * (1 - effectiveBackground[3]))) / outputAlpha,
        ((effectiveBackground[1] * effectiveBackground[3]) + (background[1] * background[3] * (1 - effectiveBackground[3]))) / outputAlpha,
        ((effectiveBackground[2] * effectiveBackground[3]) + (background[2] * background[3] * (1 - effectiveBackground[3]))) / outputAlpha,
        outputAlpha,
      ];
    }
    if (effectiveBackground[3] >= 0.999) break;
  }
  return {
    backgroundColor: style.backgroundColor,
    boxShadow: style.boxShadow,
    effectiveBackgroundColor: `rgb(${effectiveBackground.slice(0, 3).map(Math.round).join(", ")})`,
    focusVisible: element.matches(":focus-visible"),
    outlineColor: style.outlineColor,
    outlineOffset: style.outlineOffset,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
  };
});

const contrastRatio = (foreground, background) => {
  const parse = (color) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(channels?.length, 3, `expected an RGB color, received ${color}`);
    return channels;
  };
  const luminance = (color) => {
    const channels = parse(color).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
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

test("contextual focus outlines preserve raised and current-state shadows", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${origin}/start.html`, { waitUntil: "domcontentloaded" });
    const hunterButton = page.locator(".hunter-button").first();
    const hunterShadow = (await readFocusStyle(hunterButton)).boxShadow;
    await hunterButton.focus();
    const focusedHunter = await readFocusStyle(hunterButton);
    assert.equal(focusedHunter.focusVisible, true);
    assert.equal(focusedHunter.boxShadow, hunterShadow, "Hunter focus keeps the raised component shadow");
    assert.deepEqual(
      [focusedHunter.outlineColor, focusedHunter.outlineStyle, focusedHunter.outlineWidth, focusedHunter.outlineOffset],
      ["rgb(242, 205, 106)", "solid", "3px", "3px"],
    );

    await page.goto(`${origin}/sponsors.html`, { waitUntil: "domcontentloaded" });
    const sponsorNav = page.locator("#campaign-nav .nav-sponsors");
    const sponsorNavShadow = (await readFocusStyle(sponsorNav)).boxShadow;
    assert.match(sponsorNavShadow, /inset/, "current Sponsors nav starts with its inset state shadow");
    await sponsorNav.focus();
    const focusedSponsorNav = await readFocusStyle(sponsorNav);
    assert.equal(focusedSponsorNav.boxShadow, sponsorNavShadow, "Sponsors focus keeps the current-state inset shadow");
    assert.equal(focusedSponsorNav.outlineColor, "rgb(242, 205, 106)");

    const sponsorInput = page.locator("#sponsor-contact");
    const sponsorInputShadow = (await readFocusStyle(sponsorInput)).boxShadow;
    await sponsorInput.focus();
    const focusedSponsorInput = await readFocusStyle(sponsorInput);
    assert.equal(focusedSponsorInput.boxShadow, sponsorInputShadow, "Sponsor input focus keeps its component shadow");
    assert.deepEqual(
      [focusedSponsorInput.outlineColor, focusedSponsorInput.outlineStyle, focusedSponsorInput.outlineWidth, focusedSponsorInput.outlineOffset],
      ["rgb(7, 31, 28)", "solid", "3px", "3px"],
    );
  } finally {
    await browser.close();
  }
});

test("contextual focus maps public parchment and resets nested dark utilities", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  const assertFocusColor = async (locator, expectedColor, message, contextSurface = locator) => {
    const shadow = (await readFocusStyle(locator)).boxShadow;
    const contextBackground = (await readFocusStyle(contextSurface)).effectiveBackgroundColor;
    await locator.focus();
    const focused = await readFocusStyle(locator);
    const ratio = contrastRatio(focused.outlineColor, contextBackground);
    assert.equal(focused.focusVisible, true, `${message} is keyboard-focused`);
    assert.equal(focused.outlineColor, expectedColor, message);
    assert.equal(focused.boxShadow, shadow, `${message} preserves the component shadow`);
    assert.ok(ratio >= 3, `${message} has ${ratio.toFixed(2)}:1 outline contrast`);
    return focused;
  };

  const dark = "rgb(7, 31, 28)";
  const gold = "rgb(242, 205, 106)";

  try {
    const page = await context.newPage();

    await page.goto(`${origin}/sponsors.html`, { waitUntil: "domcontentloaded" });
    await assertFocusColor(page.locator(".opportunity-card a").first(), dark, "sponsor opportunity link uses dark focus on paper", page.locator(".opportunity-card").first());
    await assertFocusColor(page.locator(".sponsor-form .turnstile-shell"), gold, "sponsor Turnstile shell resets to gold on its dark surface");
    const sponsorResult = page.locator(".sponsor-form__result");
    await sponsorResult.evaluate((element) => {
      element.hidden = false;
      element.textContent = "Test result";
    });
    await assertFocusColor(sponsorResult, gold, "sponsor result resets to gold on its dark surface");

    await page.goto(`${origin}/route.html`, { waitUntil: "domcontentloaded" });
    await assertFocusColor(page.locator(".stop .stop-meta a").first(), dark, "route stop link uses dark focus on parchment", page.locator(".stop").first());
    await assertFocusColor(page.locator(".stop .photo a").first(), dark, "route photo card link uses dark focus in its parchment stop", page.locator(".stop").first());

    await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded" });
    await assertFocusColor(page.locator(".step a").first(), dark, "How to Play step link uses dark focus on paper", page.locator(".step").first());
    await assertFocusColor(page.locator(".legend .btn"), dark, "legend control uses dark focus on paper", page.locator(".legend .scroll"));

    await page.goto(`${origin}/start.html`, { waitUntil: "domcontentloaded" });
    const hunterValidation = page.locator(".field-panel--paper").first().locator(".system-message");
    await page.locator(".field-panel--paper").first().evaluate((panel) => {
      panel.insertAdjacentHTML("beforeend", '<div class="system-message" tabindex="-1">Validation test</div>');
    });
    await assertFocusColor(hunterValidation, gold, "Hunter dark validation nested in paper resets to gold");

    await page.goto(`${origin}/clue-board.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#board-feed").evaluate((feed) => {
      feed.innerHTML = '<article class="field-note"><div class="form-error-summary" tabindex="-1">Validation test</div></article>';
    });
    await assertFocusColor(page.locator(".field-note .form-error-summary"), gold, "Board dark validation nested in paper resets to gold");
  } finally {
    await browser.close();
  }
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
