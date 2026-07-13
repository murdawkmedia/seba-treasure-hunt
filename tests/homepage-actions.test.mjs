import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const sponsorLink = /<a\b(?=[^>]*\bhref=["']sponsors\.html["'])[^>]*>[\s\S]*?\bSponsors\b[\s\S]*?<\/a>/i;

const extractRegion = (source, tag, context) => {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  assert.ok(match, `${context} must contain a <${tag}> region`);
  return match[0];
};

test("the first public screen exposes the live case state and primary actions", () => {
  const heroEnd = html.indexOf("<!-- ===================== DIRECT ANSWER");
  const firstScreen = html.slice(0, heroEnd);

  assert.match(firstScreen, /data-case-status/i);
  assert.match(firstScreen, /Status unavailable/i);
  assert.match(html, /assets\/app\/status\.js/i);
  assert.match(firstScreen, /href="start\.html"/i);
  assert.match(firstScreen, /href="report\.html"/i);
  assert.match(firstScreen, /href="updates\.html"/i);
  assert.match(firstScreen, /href="rules\.html"/i);
});

test("homepage navigation reaches the living campaign surfaces", () => {
  for (const target of [
    "start.html",
    "dashboard.html",
    "updates.html",
    "report.html",
    "clue-board.html",
    "rules.html"
  ]) {
    assert.match(html, new RegExp(`href=["']${target.replace(".", "\\.")}["']`, "i"));
  }

  const header = extractRegion(html, "header", "homepage");
  const navigation = extractRegion(header, "nav", "homepage header");
  const footer = extractRegion(html, "footer", "homepage");
  const missing = [];

  if (!sponsorLink.test(navigation)) missing.push("homepage campaign navigation");
  if (!sponsorLink.test(footer)) missing.push("homepage footer");

  assert.deepEqual(missing, [], `missing correctly labelled Sponsors links:\n${missing.join("\n")}`);
});
