import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const rendered = () => readRenderedCampaignPage("index.html");

const extractRegion = (source, tag, context) => {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  assert.ok(match, `${context} must contain a <${tag}> region`);
  return match[0];
};

test("the first public screen exposes the live case state and primary actions", () => {
  const sourceFirstScreen = extractRegion(html, "section", "homepage evidence wall");
  const renderedFirstScreen = rendered();

  assert.match(renderedFirstScreen, /data-case-status/i);
  assert.match(renderedFirstScreen, /Status unavailable/i);
  assert.match(html, /assets\/app\/status\.js/i);
  assert.match(sourceFirstScreen, /href="\/route"/i);
  assert.match(sourceFirstScreen, /href="\/report"/i);
  assert.match(renderedFirstScreen, /href="\/dashboard"/i);
});

test("homepage navigation reaches the living campaign surfaces without sponsorship", () => {
  for (const target of [
    "/route",
    "/dashboard",
    "/updates",
    "/report",
    "/clue-board",
    "/rules"
  ]) {
    assert.match(rendered(), new RegExp(`href=["']${target.replaceAll("/", "\\/")}["']`, "i"));
  }

  const renderedHtml = rendered();
  assert.doesNotMatch(renderedHtml, /Support the Search|href=["']\/?sponsors(?:\.html)?["']/i);
});

test("homepage has no sponsor section or inquiry call to action", () => {
  assert.doesNotMatch(html, /<section\b(?=[^>]*\bid=["']sponsor["'])/i);
  assert.doesNotMatch(html, /Support the Search|sponsors\.html/i);
});
