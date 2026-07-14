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

const cssBlock = (css, marker) => {
  const markerMatch = marker.exec(css);
  assert.ok(markerMatch, `missing CSS block for ${marker}`);
  const start = css.indexOf("{", markerMatch.index);
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start + 1, index);
  }
  assert.fail(`unterminated CSS block for ${marker}`);
};

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

test("every campaign source uses root-relative local stylesheet URLs", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const head = read(filename).match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";
    const stylesheets = [...head.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1]);
    for (const href of stylesheets.filter((candidate) => !/^https?:\/\//i.test(candidate))) {
      assert.match(href, /^\//, `${filename} uses a root-relative local stylesheet URL: ${href}`);
    }
  }
});

test("every campaign source loads the canonical shell once after all author CSS", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const head = read(filename).match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";
    const stylesheets = [...head.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
    const canonical = stylesheets.filter((match) => match[1] === "/css/campaign-shell.css");
    assert.equal(canonical.length, 1, `${filename} loads one canonical shell stylesheet`);
    const canonicalEnd = canonical[0].index + canonical[0][0].length;
    const otherStylesheetEnd = Math.max(0, ...stylesheets
      .filter((match) => match[1] !== "/css/campaign-shell.css")
      .map((match) => match.index + match[0].length));
    const finalStyleEnd = Math.max(0, ...[...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
      .map((match) => match.index + match[0].length));
    assert.ok(canonicalEnd > otherStylesheetEnd, `${filename} loads the canonical shell after stylesheet links`);
    assert.ok(canonicalEnd > finalStyleEnd, `${filename} loads the canonical shell after inline author styles`);
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

test("the mobile shell uses compact measured row minimums", () => {
  const mobile = cssBlock(read("css/campaign-shell.css"), /@media\s*\(max-width:\s*760px\)/);
  assert.match(
    mobile,
    /:root\s*\{(?=[^}]*--campaign-case-min-height:\s*72px)(?=[^}]*--campaign-nav-min-height:\s*58px)[^}]*\}/s,
  );
});

test("reduced motion resets campaign animations and transitions", () => {
  const reducedMotion = cssBlock(read("css/campaign-shell.css"), /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(reducedMotion, /html\s*\{[^}]*scroll-behavior:\s*auto[^}]*\}/s);
  assert.match(
    reducedMotion,
    /\.campaign-page \*,\s*\.campaign-page \*::before,\s*\.campaign-page \*::after\s*\{[^}]*animation-duration:\s*0\.01ms\s*!important;[^}]*animation-iteration-count:\s*1\s*!important;[^}]*transition-duration:\s*0\.01ms\s*!important;[^}]*\}/s,
  );
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
