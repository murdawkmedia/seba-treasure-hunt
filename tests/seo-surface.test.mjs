import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sitemap = fs.readFileSync(path.join(repo, "sitemap.xml"), "utf8");
const robots = fs.readFileSync(path.join(repo, "robots.txt"), "utf8");

test("sitemap exposes every indexable answer surface and no private tool", () => {
  for (const route of [
    "/",
    "/route",
    "/interview",
    "/updates",
    "/rules",
    "/privacy",
    "/waiver",
    "/community-guidelines",
    "/clue-board",
  ]) {
    assert.match(sitemap, new RegExp(`<loc>https://www\\.timlostsomething\\.com${route.replaceAll("/", "\\/")}</loc>`));
  }
  for (const route of ["/dashboard", "/report", "/ops", "/api/", "/sponsors"]) {
    assert.doesNotMatch(sitemap, new RegExp(`<loc>[^<]+${route.replaceAll("/", "\\/")}`));
  }
  assert.doesNotMatch(sitemap, /\.html<\/loc>/);
});

test("robots protects staff, member, and API surfaces while advertising the sitemap", () => {
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Disallow: \/ops/m);
  assert.match(robots, /^Disallow: \/dashboard/m);
  assert.match(robots, /^Disallow: \/api\//m);
  assert.match(robots, /^Sitemap: https:\/\/www\.timlostsomething\.com\/sitemap\.xml$/m);
});
