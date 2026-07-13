import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sponsorLink = /<a\b(?=[^>]*\bhref=["'](?:\/sponsors|sponsors\.html)["'])[^>]*>[\s\S]*?\bSponsors\b[\s\S]*?<\/a>/i;

const extractRegion = (html, tag, context) => {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  assert.ok(match, `${context} must contain a <${tag}> region`);
  return match[0];
};

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
  const missing = [];

  for (const name of [
    "index.html", "route.html", "interview.html", "start.html", "dashboard.html",
    "updates.html", "report.html", "rules.html", "privacy.html",
    "community-guidelines.html", "clue-board.html", "sponsors.html"
  ]) {
    if (!fs.existsSync(path.join(root, name))) {
      missing.push(`${name}: page`);
      continue;
    }

    const html = read(name);
    const header = extractRegion(html, "header", name);
    const navigation = extractRegion(header, "nav", `${name} header`);
    const footer = extractRegion(html, "footer", name);

    if (!sponsorLink.test(navigation)) missing.push(`${name}: campaign navigation`);
    if (!sponsorLink.test(footer)) missing.push(`${name}: footer`);
  }

  assert.deepEqual(missing, [], `missing correctly labelled Sponsors links:\n${missing.join("\n")}`);
});

test("the sponsor page contains no public lead data or invented partner claim", () => {
  const html = read("sponsors.html");
  assert.doesNotMatch(html, /@sebahub\.com|@businessasaforceforgood\.ca/i);
  assert.doesNotMatch(html, /sponsor_inquiries|private note|staff_subject/i);
  assert.doesNotMatch(html, /radio partner|media partner|impressions|audience size/i);
});
