import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

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
      const body = await readFile(filename);
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

test("390px headers use measured compact stacked geometry and an operable menu", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });

  try {
    const page = await context.newPage();
    for (const [file, headerSelector] of [["index.html", ".topbar"], ["privacy.html", ".hunter-header"]]) {
      await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
      const geometry = await page.evaluate((selector) => {
        const strip = document.querySelector(".case-strip");
        const header = document.querySelector(selector);
        if (!(strip instanceof HTMLElement) || !(header instanceof HTMLElement)) return null;
        const stripHeight = strip.getBoundingClientRect().height;
        const styles = getComputedStyle(header);
        return {
          stripHeight,
          headerPosition: styles.position,
          headerTop: Number.parseFloat(styles.top),
        };
      }, headerSelector);
      assert.ok(geometry, `${file} exposes both stacked rows`);
      assert.ok(geometry.stripHeight <= 76, `${file} case strip is ${geometry.stripHeight}px high`);
      assert.equal(geometry.headerPosition, "sticky", `${file} campaign header is sticky`);
      assert.ok(Math.abs(geometry.headerTop - geometry.stripHeight) <= 1, `${file} header top ${geometry.headerTop}px matches strip ${geometry.stripHeight}px`);
    }

    await page.goto(`${origin}/privacy.html`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".menu-toggle");
    const nav = page.locator("#nav");
    assert.equal(await toggle.count(), 1);
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "none");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "flex");
    await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await nav.evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);
  } finally {
    await browser.close();
  }
});
