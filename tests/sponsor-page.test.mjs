import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("the sponsor page is a canonical, indexable conversion surface", () => {
  const html = read("sponsors.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/sponsors"/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /Put your name inside the mystery/i);
  assert.match(html, /Community Sponsor/);
  assert.match(html, /Lead Sponsor/);
  assert.match(html, /Prize (?:&amp;|&) In-Kind Partner/);
  assert.match(html, /data-sponsor-form/);
  assert.match(html, /data-sponsor-turnstile/);
  assert.match(html, /Submitting.*does not create.*agreement/is);
  assert.match(html, /FAQPage/);
  assert.doesNotMatch(html, /\$\d|CFCW|guaranteed reach|exclusive sponsor/i);
});

test("every public page reaches Sponsors from navigation and footer", () => {
  for (const name of [
    "index.html", "route.html", "interview.html", "start.html", "dashboard.html",
    "updates.html", "report.html", "rules.html", "privacy.html",
    "community-guidelines.html", "clue-board.html", "sponsors.html"
  ]) {
    const html = read(name);
    assert.match(html, /href=["'](?:\/sponsors|sponsors\.html)["']/i, name + " sponsor link");
    assert.match(html, /Sponsors/i, name + " sponsor label");
  }
});

test("the sponsor page contains no public lead data or invented partner claim", () => {
  const html = read("sponsors.html");
  assert.doesNotMatch(html, /@sebahub\.com|@businessasaforceforgood\.ca/i);
  assert.doesNotMatch(html, /sponsor_inquiries|private note|staff_subject/i);
  assert.doesNotMatch(html, /radio partner|media partner|impressions|audience size/i);
});
