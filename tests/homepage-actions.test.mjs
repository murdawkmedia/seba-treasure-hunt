import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const rendered = () => readRenderedCampaignPage("index.html");
const sponsorLink = /<a\b(?=[^>]*\bhref=["']\/sponsors["'])[^>]*>[\s\S]*?Support the Search[\s\S]*?<\/a>/i;

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

test("homepage navigation reaches the living campaign surfaces", () => {
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
  const header = extractRegion(renderedHtml, "header", "homepage");
  const navigation = extractRegion(header, "nav", "homepage header");
  const footer = extractRegion(renderedHtml, "footer", "homepage");
  const missing = [];

  if (!sponsorLink.test(navigation)) missing.push("homepage campaign navigation");
  if (!sponsorLink.test(footer)) missing.push("homepage footer");

  assert.deepEqual(missing, [], `missing correctly labelled Support the Search links:\n${missing.join("\n")}`);
});

test("homepage sponsor deep link is a concise path to the qualified inquiry", () => {
  const section = html.match(/<section\b(?=[^>]*\bid=["']sponsor["'])[^>]*>[\s\S]*?<\/section>/i)?.[0];
  assert.ok(section, "homepage must retain #sponsor for old deep links");
  assert.match(section, /Support the Search/i);
  for (const support of ["cash", "prizes", "services", "practical in-kind"]) {
    assert.match(section, new RegExp(support, "i"));
  }
  assert.match(section, /<a\b[^>]*href=["']sponsors\.html["'][^>]*>[\s\S]*Support the Search/i);
  assert.match(section, /does not create an agreement/i);
  assert.match(section, /does not authorize publication/i);
  assert.doesNotMatch(section, /href=["']https?:\/\/(?:www\.)?sebahub\.com|\$\s*\d|package|tier/i);
});
