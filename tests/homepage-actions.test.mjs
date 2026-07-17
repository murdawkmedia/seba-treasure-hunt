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
  const heroEnd = html.indexOf("<!-- ===================== DIRECT ANSWER");
  const sourceFirstScreen = html.slice(0, heroEnd);
  const renderedHtml = rendered();
  const renderedFirstScreen = renderedHtml.slice(0, renderedHtml.indexOf("<!-- ===================== DIRECT ANSWER"));

  assert.match(renderedFirstScreen, /data-case-status/i);
  assert.match(renderedFirstScreen, /Status unavailable/i);
  assert.match(html, /assets\/app\/status\.js/i);
  assert.match(sourceFirstScreen, /href="start\.html"/i);
  assert.match(sourceFirstScreen, /href="report\.html"/i);
  assert.match(sourceFirstScreen, /href="updates\.html"/i);
  assert.match(sourceFirstScreen, /href="rules\.html"/i);
});

test("homepage navigation reaches the living campaign surfaces without sponsorship", () => {
  for (const target of [
    "/start",
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
