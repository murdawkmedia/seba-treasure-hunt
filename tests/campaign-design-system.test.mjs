import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";
import { buildSite } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("the canonical stylesheet owns every public campaign shell surface", () => {
  const css = read("css/campaign-shell.css");
  for (const selector of [
    ".case-strip",
    ".campaign-header",
    ".campaign-header__inner",
    ".campaign-brand",
    ".campaign-menu-toggle",
    ".campaign-nav",
    ".campaign-footer",
    ".skip-link",
  ]) {
    assert.match(css, new RegExp(`(?:^|[},\\s])${selector.replace(".", "\\.")}(?=[\\s:{,.#\\[])`, "m"), `${selector} is owned by campaign-shell.css`);
  }
});

test("legacy stylesheets no longer expose public shell selectors", () => {
  const css = ["css/style.css", "css/hunter.css", "css/board.css", "css/sponsors.css"]
    .map(read)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const selector of [".topbar", ".hunter-header", ".board-topbar", ".hunter-nav", ".board-nav", ".case-signal"]) {
    assert.doesNotMatch(css, new RegExp(`\\${selector}(?![\\w-])`), `${selector} is absent, including compound selectors`);
  }
});

test("every campaign source loads the canonical shell exactly once and last", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const html = read(filename);
    const stylesheets = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1]);
    assert.equal(stylesheets.filter((href) => href === "/css/campaign-shell.css").length, 1, `${filename} loads one canonical shell stylesheet`);
    assert.equal(stylesheets.at(-1), "/css/campaign-shell.css", `${filename} loads the canonical shell last`);
  }
});

test("shared shell JavaScript addresses canonical selectors only", () => {
  const site = read("js/site.js");
  for (const selector of [".case-strip", ".campaign-header", ".campaign-menu-toggle", "campaign-nav"]) {
    assert.match(site, new RegExp(selector.replace(/[.#]/g, "\\$&")), `site.js addresses ${selector}`);
  }
  for (const legacy of [".case-signal", ".topbar", ".hunter-header", ".board-topbar", 'getElementById("nav")', "#nav"]) {
    assert.doesNotMatch(site, new RegExp(legacy.replace(/[.#()]/g, "\\$&")), `site.js does not address ${legacy}`);
  }
});

test("the build publishes the canonical shell stylesheet", async () => {
  const output = await buildSite({ temporary: true });
  try {
    assert.equal(fs.existsSync(path.join(output.dist, "css", "campaign-shell.css")), true);
  } finally {
    await output.cleanup();
  }
});

test("generated waiver artifacts remain exact", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "generate-waiver.mjs"), "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});
