import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

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
  "sponsors.html",
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
  const context = await browser.newContext({ viewport });
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else await route.abort();
  });
  const page = await context.newPage();

  try {
    for (const file of files) {
      await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator('nav[aria-label="Campaign"]').count(), 1, `${file} Campaign landmark at ${viewport.width}px`);
      assert.equal(await page.locator("#campaign-nav").count(), 1, `${file} campaign nav id at ${viewport.width}px`);
      assert.equal(await page.locator(".campaign-menu-toggle").count(), 1, `${file} menu toggle at ${viewport.width}px`);
      assert.equal(await page.locator(".skip-link").count(), 1, `${file} skip link at ${viewport.width}px`);
      assert.equal(await page.locator("main").count(), 1, `${file} main landmark at ${viewport.width}px`);

      await page.addScriptTag({ content: axeSource });
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
      assert.deepEqual(violations, [], `${file} serious/critical axe findings at ${viewport.width}px`);
    }
  } finally {
    await context.close();
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
