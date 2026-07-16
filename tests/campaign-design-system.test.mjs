import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const customProperties = (css) => Object.fromEntries(
  [...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)]
    .map((match) => [match[1], match[2].trim()]),
);

const resolveHexColor = (value, properties, seen = new Set()) => {
  assert.equal(typeof value, "string", "color token is defined");
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/i)?.[1];
  if (!reference) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `${value} is a six-digit hex color`);
    return value;
  }
  assert.equal(seen.has(reference), false, `${reference} is not a circular color token`);
  assert.ok(properties[reference], `${reference} is defined`);
  return resolveHexColor(properties[reference], properties, new Set([...seen, reference]));
};

const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
};

const contrastRatio = (first, second) => {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
};

const PAGE_FAMILIES = Object.freeze({
  "index.html": "landing",
  "start.html": "landing",
  "updates.html": "landing",
  "route.html": "route",
  "interview.html": "editorial",
  "clue-board.html": "ledger",
  "dashboard.html": "workspace",
  "report.html": "workspace",
  "rules.html": "document",
  "privacy.html": "document",
  "waiver.html": "document",
  "community-guidelines.html": "document",
  "sponsors.html": "sponsors",
});

const FUNCTIONAL_PAGE_CLASSES = Object.freeze({
  "start.html": ["hunter-page"],
  "updates.html": ["hunter-page"],
  "clue-board.html": ["board-page"],
  "dashboard.html": ["hunter-page"],
  "report.html": ["hunter-page"],
  "rules.html": ["hunter-page"],
  "privacy.html": ["hunter-page"],
  "waiver.html": ["hunter-page", "waiver-page"],
  "community-guidelines.html": ["hunter-page"],
  "sponsors.html": ["hunter-page", "sponsor-page"],
});

const LEGACY_SHELL_CLASSES = Object.freeze([
  "topbar",
  "footer",
  "hunter-header",
  "hunter-nav",
  "hunter-footer",
  "board-topbar",
  "board-brand",
  "board-menu-toggle",
  "board-nav",
  "board-footer",
  "case-signal",
  "sponsor-topbar",
  "sponsor-footer",
  "site-header",
  "site-footer",
]);

function stripCssComments(css) {
  let output = "";
  let quote = "";
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      output += character;
      if (character === "\\" && index + 1 < css.length) output += css[index += 1];
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
      output += character;
    } else if (character === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      assert.notEqual(end, -1, "CSS comments are terminated");
      output += " ";
      index = end + 1;
    } else {
      output += character;
    }
  }
  assert.equal(quote, "", "CSS strings are terminated");
  return output;
}

function consumeCssEscape(source, start) {
  const next = source[start + 1];
  if (next === undefined) return { end: start + 1, value: "" };
  if (next === "\n" || next === "\f") return { end: start + 2, value: "" };
  if (next === "\r") {
    return { end: start + (source[start + 2] === "\n" ? 3 : 2), value: "" };
  }

  const hex = source.slice(start + 1).match(/^[0-9a-f]{1,6}/i)?.[0];
  if (!hex) return { end: start + 2, value: next };
  const codePoint = Number.parseInt(hex, 16);
  let end = start + 1 + hex.length;
  if (/[\t\n\f\r ]/.test(source[end] ?? "")) {
    end += source[end] === "\r" && source[end + 1] === "\n" ? 2 : 1;
  }
  return {
    end,
    value: codePoint === 0 || codePoint > 0x10ffff
      ? "\ufffd"
      : String.fromCodePoint(codePoint),
  };
}

function readCssIdentifier(source, start) {
  let cursor = start;
  let value = "";
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      const escape = consumeCssEscape(source, cursor);
      value += escape.value;
      cursor = escape.end;
    } else if (/[-_a-z0-9]/i.test(source[cursor]) || source.charCodeAt(cursor) >= 0x80) {
      value += source[cursor];
      cursor += 1;
    } else {
      break;
    }
  }
  return { end: cursor, value };
}

function readCssString(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  let value = "";
  while (cursor < source.length && source[cursor] !== quote) {
    if (source[cursor] === "\\") {
      const escape = consumeCssEscape(source, cursor);
      value += escape.value;
      cursor = escape.end;
    } else {
      value += source[cursor];
      cursor += 1;
    }
  }
  return {
    end: cursor < source.length ? cursor + 1 : cursor,
    terminated: source[cursor] === quote,
    value,
  };
}

function skipCssWhitespace(source, start) {
  let cursor = start;
  while (/[\t\n\f\r ]/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function cssRulePreludes(css) {
  const source = stripCssComments(css);
  const preludes = [];
  let boundary = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") {
      index = consumeCssEscape(source, index).end - 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (bracketDepth === 0 && parenthesisDepth === 0 && character === "{") {
      const prelude = source.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) preludes.push(prelude);
      boundary = index + 1;
    } else if (
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      (character === ";" || character === "}")
    ) {
      boundary = index + 1;
    }
  }
  return preludes;
}

function readClassAttributeSelector(selector, start) {
  let cursor = skipCssWhitespace(selector, start + 1);
  const attributeName = readCssIdentifier(selector, cursor);
  cursor = skipCssWhitespace(selector, attributeName.end);

  let operator = "";
  if (selector.startsWith("~=", cursor)) {
    operator = "~=";
    cursor += 2;
  } else if (selector[cursor] === "=") {
    operator = "=";
    cursor += 1;
  }
  cursor = skipCssWhitespace(selector, cursor);

  let attributeValue = { end: cursor, terminated: true, value: "" };
  if (selector[cursor] === '"' || selector[cursor] === "'") {
    attributeValue = readCssString(selector, cursor);
  } else {
    const identifier = readCssIdentifier(selector, cursor);
    attributeValue = { ...identifier, terminated: true };
  }
  cursor = skipCssWhitespace(selector, attributeValue.end);

  let flag = "";
  if (selector[cursor] !== "]") {
    const flagToken = readCssIdentifier(selector, cursor);
    flag = flagToken.value.toLowerCase();
    cursor = skipCssWhitespace(selector, flagToken.end);
  }

  const valid =
    selector[cursor] === "]" &&
    attributeValue.terminated &&
    attributeName.value.toLowerCase() === "class" &&
    (operator === "=" || operator === "~=") &&
    (flag === "" || flag === "i" || flag === "s");
  const normalizedValue = flag === "i"
    ? attributeValue.value.toLowerCase()
    : attributeValue.value;
  return {
    classNames: !valid
      ? []
      : operator === "="
        ? normalizedValue.split(/[\t\n\f\r ]+/).filter(Boolean)
        : [normalizedValue],
    end: selector.indexOf("]", Math.max(cursor, start + 1)),
  };
}

function classSelectors(selector) {
  const classes = [];
  let quote = "";

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") {
      const attribute = readClassAttributeSelector(selector, index);
      classes.push(...attribute.classNames);
      if (attribute.end !== -1) index = attribute.end;
      continue;
    }
    if (character === ".") {
      const identifier = readCssIdentifier(selector, index + 1);
      if (identifier.value) {
        classes.push(identifier.value);
        index = identifier.end - 1;
      }
    }
  }
  return classes;
}

function legacyCssClassSelectors(css) {
  const legacy = new Set(LEGACY_SHELL_CLASSES);
  return [...new Set(cssRulePreludes(css).flatMap(classSelectors)
    .filter((className) => legacy.has(className)))]
    .sort();
}

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

test("the canonical stylesheet defines the shared campaign design tokens", () => {
  const css = read("css/campaign-shell.css");
  for (const [token, value] of Object.entries({
    "--campaign-font-display": '"Cormorant Garamond", Georgia, serif',
    "--campaign-font-body": '"Source Sans 3", "Segoe UI", sans-serif',
    "--campaign-font-meta": '"IBM Plex Mono", "Courier New", monospace',
    "--campaign-space-section": "clamp(3rem, 7vw, 6rem)",
    "--campaign-radius-control": "10px",
    "--campaign-focus-light": "var(--campaign-gold-300)",
    "--campaign-focus-dark": "var(--campaign-forest-950)",
    "--campaign-focus": "var(--campaign-focus-light)",
    "--campaign-surface-paper": "var(--campaign-paper-100)",
    "--campaign-surface-dark": "var(--campaign-forest-950)",
  })) {
    assert.match(css, new RegExp(`${token.replaceAll("-", "\\-")}:\\s*${value.replace(/[()]/g, "\\$&")}\\s*;`));
  }
});

test("every public campaign source loads only the documentary type stack", () => {
  const publicCss = [
    "css/campaign-shell.css",
    "css/style.css",
    "css/hunter.css",
    "css/board.css",
    "css/sponsors.css",
  ];
  const legacyTypography = /Pirata One|IM Fell English|Special Elite|--font-pirate/i;

  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const html = read(filename);
    assert.match(html, /family=Cormorant\+Garamond/);
    assert.match(html, /family=IBM\+Plex\+Mono/);
    assert.match(html, /family=Source\+Sans\+3/);
    assert.doesNotMatch(html, legacyTypography, filename);
  }

  for (const filename of publicCss) {
    assert.doesNotMatch(read(filename), legacyTypography, filename);
  }
});

test("DESIGN.md records the approved documentary case-file source of truth", () => {
  const design = read("DESIGN.md");
  for (const required of [
    /Documentary Case File/i,
    /genuine local mystery/i,
    /SebaHub.*host.*not.*subject/i,
    /dark forest.*cream.*gold/i,
    /verification red/i,
    /Cormorant Garamond/i,
    /Source Sans 3/i,
    /IBM Plex Mono/i,
    /no pirate language/i,
    /mobile/i,
    /accessibility/i,
    /legal/i,
    /auth/i,
    /route/i,
    /report/i,
  ]) {
    assert.match(design, required);
  }
});

test("campaign pages share body type, headings, readable wrapping, controls, and focus", () => {
  const css = read("css/campaign-shell.css");
  assert.match(
    css,
    /\.campaign-page\s*\{[^}]*font-family:\s*var\(--campaign-font-body\);[^}]*line-height:\s*1\.6;/s,
  );
  assert.match(
    css,
    /\.campaign-page\s+:where\(h1,\s*h2,\s*h3\)\s*\{(?=[^}]*font-family:\s*var\(--campaign-font-display\);)(?=[^}]*font-weight:\s*400;)(?=[^}]*line-height:\s*1\.05;)(?=[^}]*text-wrap:\s*balance;)[^}]*\}/s,
  );
  assert.match(
    css,
    /\.campaign-page\s+:where\(p,\s*li,\s*dd\)\s*\{[^}]*text-wrap:\s*pretty;[^}]*\}/s,
  );
  assert.match(
    css,
    /\.campaign-page\s+:where\(\.btn,\s*\.hunter-button,\s*\.board-button,\s*\.sponsor-button\)\s*\{(?=[^}]*border-radius:\s*var\(--campaign-radius-control\);)(?=[^}]*font-family:\s*var\(--campaign-font-display\);)[^}]*\}/s,
  );
  const focusRules = [...css.matchAll(
    /\.campaign-page\s+:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/g,
  )];
  assert.equal(focusRules.length, 1, "campaign focus styling has one scoped source");
  assert.deepEqual(
    focusRules[0][1].split(",").map((target) => target.trim()),
    ["a", "button", "input", "select", "textarea", "summary", "[tabindex]"],
    "focus styling covers links, controls, disclosure widgets, and explicit focus targets",
  );
  assert.match(focusRules[0][2], /outline:\s*3px solid var\(--campaign-focus\);/);
  assert.match(focusRules[0][2], /outline-offset:\s*3px;/);
  assert.doesNotMatch(focusRules[0][2], /box-shadow\s*:/, "shared focus never replaces component shadows");
  assert.doesNotMatch(css, /\.campaign-page\s+:focus-visible/);
  assert.match(
    css,
    /\.campaign-page \.photo:focus-within,\s*\.campaign-page details\.qa:focus-within\s*\{\s*outline:\s*3px solid var\(--campaign-focus\);\s*outline-offset:\s*3px;\s*\}\s*\.campaign-page \.photo > a:focus-visible,\s*\.campaign-page details\.qa > summary:focus-visible\s*\{\s*outline:\s*none;\s*\}/s,
    "focus-within provides the parent outline and direct-child suppression without feature detection",
  );
  assert.equal(
    css.slice(0, css.indexOf(".campaign-page .photo:focus-within")).match(/@supports selector\(:has\(\*\)\)/g)?.length ?? 0,
    0,
    "the focus-within baseline is outside every :has support guard",
  );
});

test("contextual focus tokens keep three-to-one outlines on light and dark surfaces", () => {
  const properties = customProperties(read("css/campaign-shell.css"));
  const focusLight = resolveHexColor(properties["--campaign-focus-light"], properties);
  const focusDark = resolveHexColor(properties["--campaign-focus-dark"], properties);
  const paper = resolveHexColor(properties["--campaign-surface-paper"], properties);
  const forest = resolveHexColor(properties["--campaign-surface-dark"], properties);
  const darkOnPaper = contrastRatio(focusDark, paper);
  const lightOnForest = contrastRatio(focusLight, forest);

  assert.ok(darkOnPaper >= 3, `dark focus edge contrasts ${darkOnPaper.toFixed(2)}:1 on parchment`);
  assert.ok(lightOnForest >= 3, `light focus edge contrasts ${lightOnForest.toFixed(2)}:1 on forest`);
});

test("public case actions use the readable filled button contract", () => {
  const publicMarkup = Object.keys(CAMPAIGN_PAGES)
    .filter((name) => name !== "ops.html")
    .map((name) => read(name))
    .join("\n");
  const publicCss = read("css/style.css");

  assert.doesNotMatch(publicMarkup, /\bbtn--ghost\b/);
  assert.doesNotMatch(publicMarkup, /class="btn"[^>]*style=/);
  assert.doesNotMatch(publicCss, /\.btn--ghost\b/);

  const properties = {
    ...customProperties(read("css/campaign-shell.css")),
    ...customProperties(publicCss),
  };
  const ink = resolveHexColor(properties["--campaign-ink"], properties);
  const gold = resolveHexColor(properties["--campaign-gold-300"], properties);
  assert.ok(contrastRatio(ink, gold) >= 4.5);
});

test("light surfaces select dark focus while dark campaign chrome stays gold", () => {
  const shellCss = read("css/campaign-shell.css");
  const sponsorCss = read("css/sponsors.css");
  const hunterCss = read("css/hunter.css");
  const boardCss = read("css/board.css");
  const publicCss = read("css/style.css");

  assert.match(
    shellCss,
    /\.case-strip,\s*\.campaign-header,\s*\.campaign-footer\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-light\);[^}]*\}/s,
    "canonical dark chrome pins the gold focus token",
  );
  assert.match(
    shellCss,
    /\.campaign-page\s+:where\(\.system-message,\s*\.turnstile-shell,\s*\.form-error-summary\)\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-light\);[^}]*\}/s,
    "shared dark validation and challenge surfaces reset inherited paper focus to gold",
  );
  assert.match(
    sponsorCss,
    /\.trust-grid,\s*\.opportunity-card,\s*\.recognition__paper,\s*\.sponsor-form\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-dark\);[^}]*\}/s,
    "all sponsor parchment surfaces select dark focus",
  );
  assert.match(
    sponsorCss,
    /\.sponsor-page,\s*\.sponsor-hero,\s*\.opportunities,\s*\.recognition,\s*\.inquiry,\s*\.sponsor-faq,\s*\.faq-list\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-light\);[^}]*\}/s,
    "sponsor forest sections, including the actual dark FAQ, pin gold focus",
  );
  assert.match(
    hunterCss,
    /\.field-panel--paper,\s*\.waiver-legal-body\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-dark\);[^}]*\}/s,
    "Hunter paper and waiver surfaces select dark focus",
  );
  assert.match(
    hunterCss,
    /\.field-panel--paper\s+:where\(\.system-message,\s*\.turnstile-shell\)\s*\{[^}]*background:\s*var\(--hunter-night\);[^}]*\}/s,
    "Hunter dark utilities remain opaque enough when nested in paper",
  );
  assert.match(
    boardCss,
    /\.community-notice,\s*\.field-note\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-dark\);[^}]*\}/s,
    "Board paper notes and their replies select dark focus",
  );
  assert.match(
    publicCss,
    /\.answer-block,\s*\.campaign-prop,\s*\.rules,\s*\.legend,\s*\.islands,\s*\.card,\s*\.howto,\s*\.step,\s*\.evidence,\s*\.found,\s*\.longgame,\s*\.fineprint,\s*\.hunt-faq,\s*\.interview-section,\s*details\.qa,\s*\.lookfor,\s*\.stops-intro,\s*\.stop,\s*\.anchor-sponsor\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-dark\);[^}]*\}/s,
    "public light and parchment roots systematically select dark focus",
  );
  assert.match(
    publicCss,
    /\.hero,\s*\.prize,\s*\.festival,\s*\.mapsection,\s*\.gallery,\s*\.route-teaser,\s*\.sponsor,\s*\.contact-card,\s*\.hours-banner,\s*\.checklist,\s*\.route-hero,\s*\.routevideo,\s*\.route-footnote,\s*\.evidence-section,\s*\.final-cta\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-light\);[^}]*\}/s,
    "public forest surfaces pin gold focus, including dark cards nested in paper sections",
  );
});

test("every campaign body has exactly one mapped page-family class and keeps functional classes", () => {
  assert.deepEqual(Object.keys(PAGE_FAMILIES).sort(), Object.keys(CAMPAIGN_PAGES).sort());
  for (const [filename, family] of Object.entries(PAGE_FAMILIES)) {
    const body = read(filename).match(/<body\b[^>]*\bclass=["']([^"']*)["'][^>]*>/i);
    assert.ok(body, `${filename} has a body class`);
    const classes = body[1].split(/\s+/).filter(Boolean);
    assert.ok(classes.includes("campaign-page"), `${filename} remains a campaign page`);
    assert.deepEqual(
      classes.filter((className) => className.startsWith("campaign-page--")),
      [`campaign-page--${family}`],
      `${filename} has its exact page-family class`,
    );
    for (const functionalClass of FUNCTIONAL_PAGE_CLASSES[filename] ?? []) {
      assert.ok(classes.includes(functionalClass), `${filename} keeps ${functionalClass}`);
    }
  }
});

test("the private Ops console has no campaign page-family or shared-style dependency", () => {
  const opsHtml = read("ops.html");
  const opsCss = read("css/ops.css");
  assert.doesNotMatch(opsHtml, /campaign-page(?:--[a-z]+)?/);
  assert.doesNotMatch(opsHtml, /campaign-shell\.css/);
  assert.doesNotMatch(opsCss, /campaign-page(?:--[a-z]+)?/);
});

test("legacy CSS selector detection covers attribute and escaped forms without inert false positives", () => {
  const detected = legacyCssClassSelectors(String.raw`
    /* .footer, [class~="hunter-footer"] { display: block; } */
    .campaign-footer { --example: ".topbar"; }
    [data-class~="topbar"] { content: '[class~="board-nav"]'; }
    [class~="topbar"] { display: block; }
    [CLASS ~= 'hunter-nav'] { display: block; }
    .\62 oard\2d topbar { display: block; }
  `);

  assert.deepEqual(detected, ["board-topbar", "hunter-nav", "topbar"]);
});

test("legacy CSS selector detection covers exact class equality forms", () => {
  assert.deepEqual(
    legacyCssClassSelectors(String.raw`
      [class="footer"] { display: block; }
      [ CLASS = 'HUNTER-FOOTER' i ] { display: block; }
      [cl\61 ss = board-footer] { display: block; }
    `),
    ["board-footer", "footer", "hunter-footer"],
  );
});

test("exact class equality checks every ASCII-whitespace-separated class token", () => {
  assert.deepEqual(
    legacyCssClassSelectors(`
      [class="topbar\tcampaign"] { display: block; }
      [class="campaign\nhunter-nav\fextra"] { display: block; }
      [class='campaign\rboard-footer '] { display: block; }
      [class="campaign \\74 opbar"] { display: block; }
      [class="campaign TOPBAR" i] { display: block; }
      [class="campaign TOPBAR" s] { display: block; }
    `),
    ["board-footer", "hunter-nav", "topbar"],
  );
});

test("class token matching keeps tilde-equals values atomic", () => {
  assert.deepEqual(
    legacyCssClassSelectors(`
      [class~="campaign topbar"] { display: block; }
      [class~="TOPBAR" s] { display: block; }
    `),
    [],
  );
  assert.deepEqual(
    legacyCssClassSelectors('[class~="TOPBAR" i] { display: block; }'),
    ["topbar"],
  );
});

test("CSS escapes are decoded inside tokens without becoming selector punctuation", () => {
  assert.deepEqual(
    legacyCssClassSelectors(String.raw`
      .\2e topbar { display: block; }
      [class|="hunter-nav"] { display: block; }
      [data-class="board-footer"] { display: block; }
      [class="TOPBAR" s] { display: block; }
      .campaign-footer { content: ".topbar"; }
      /* [class="site-footer"], .site-header { display: block; } */
    `),
    [],
  );
});

test("public stylesheets expose none of the complete legacy shell selector set", () => {
  const css = ["css/style.css", "css/hunter.css", "css/board.css", "css/sponsors.css", "css/campaign-shell.css"]
    .map(read)
    .join("\n");
  assert.deepEqual(legacyCssClassSelectors(css), []);
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

test("generated waiver artifacts remain exact", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "generate-waiver.mjs"), "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});
