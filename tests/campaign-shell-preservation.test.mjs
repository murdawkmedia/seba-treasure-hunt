import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";

const baseCommit = "72109a9088770beb467964e464b091d9b7bbb581";
const manifest = JSON.parse(
  readFileSync(
    new URL("./fixtures/campaign-page-preservation.json", import.meta.url),
    "utf8",
  ),
);
const wrapperOnlyPages = new Set(["index.html", "route.html", "interview.html"]);
const clueBoardStatusScript =
  '<script type="module" src="/assets/app/status.js"></script>';
const authorizedBodyClasses = new Set([
  "campaign-page",
  "campaign-page--landing",
  "campaign-page--route",
  "campaign-page--editorial",
  "campaign-page--ledger",
  "campaign-page--workspace",
  "campaign-page--document",
  "campaign-page--sponsors",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLines(value) {
  return value.replaceAll("\r\n", "\n");
}

function requiredMatch(value, expression, description) {
  const match = value.match(expression);
  assert.ok(match, description);
  return match[1] ?? match[0];
}

function normalizeAttributes(value, expressions) {
  let attributes = value;
  for (const expression of expressions) attributes = attributes.replace(expression, "");
  return attributes.trim().replace(/\s+/g, " ");
}

function normalizeBodyAttributes(value) {
  const withoutCampaignClass = value.replace(
    /\s+class\s*=\s*(["'])(.*?)\1/i,
    (_attribute, _quote, classValue) => {
      const preservedClasses = classValue
        .split(/[\t\n\f\r ]+/)
        .filter((className) => className && !authorizedBodyClasses.has(className));
      return preservedClasses.length > 0
        ? ` class="${preservedClasses.join(" ")}"`
        : "";
    },
  );
  return normalizeAttributes(withoutCampaignClass, [
    /\s+data-campaign-route\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
  ]);
}

function scriptTags(html, filename) {
  const tags = [...normalizeLines(html).matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)]
    .map((match) => wrapperOnlyPages.has(filename)
      ? match[0].replace('src="/js/site.js"', 'src="js/site.js"')
      : match[0]);

  if (filename === "clue-board.html") {
    const allowedIndex = tags.indexOf(clueBoardStatusScript);
    if (allowedIndex !== -1) tags.splice(allowedIndex, 1);
  }
  return tags;
}

function normalizeBody(html, filename) {
  const bodyMatch = normalizeLines(html).match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  assert.ok(bodyMatch, `${filename} has a complete body`);
  const bodyAttributes = normalizeBodyAttributes(bodyMatch[1]);
  let body = bodyMatch[2];

  body = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--\s*CAMPAIGN_(?:SHELL[\s\S]*?|FOOTER)\s*-->/g, "")
    .replace(/<a\b(?=[^>]*class="[^"]*\bskip-link\b[^"]*")[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<section\b(?=[^>]*class="[^"]*\bcase-strip\b[^"]*")[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<div\b(?=[^>]*class="[^"]*\bcase-signal\b[^"]*")[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<header\b(?=[^>]*class="[^"]*\b(?:topbar|hunter-header|board-topbar)\b[^"]*")[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b(?=[^>]*class="[^"]*\b(?:footer|hunter-footer|board-footer)\b[^"]*")[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--\s*=+\s*(?:NAV|FOOTER)\s*=+\s*-->/gi, "");

  if (wrapperOnlyPages.has(filename)) {
    const mainMatch = body.match(/^\s*<main\b([^>]*)>/i);
    assert.ok(mainMatch, `${filename} has its approved primary main wrapper`);
    assert.equal(
      normalizeAttributes(mainMatch[1], [
        /\s+id\s*=\s*(?:"main"|'main'|main)(?=\s|$)/i,
        /\s+tabindex\s*=\s*(?:"-1"|'-1'|-1)(?=\s|$)/i,
      ]),
      "",
      `${filename} primary wrapper has only approved transformed attributes`,
    );
    body = body
      .replace(/^\s*<main\b[^>]*>/i, "")
      .replace(/<\/main>(?![\s\S]*<\/main>)/i, "");
  } else {
    body = body.replace(
      /<main\b([^>]*)>/i,
      (_tag, attributes) => {
        const remaining = normalizeAttributes(attributes, [
          /\s+id\s*=\s*(?:"main"|'main'|main)(?=\s|$)/i,
          /\s+tabindex\s*=\s*(?:"-1"|'-1'|-1)(?=\s|$)/i,
        ]);
        return remaining ? `<main ${remaining}>` : "<main>";
      },
    );
  }

  const content = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return `body-attributes:${bodyAttributes}\n${content}`;
}

function preservationHashes(html, filename) {
  let head = requiredMatch(
    normalizeLines(html),
    /<head\b[^>]*>[\s\S]*?<\/head>/i,
    `${filename} has a complete head`,
  ).replace(
    /^[ \t]*<link rel="stylesheet" href="\/css\/campaign-shell\.css" \/>\n/m,
    "",
  );
  if (wrapperOnlyPages.has(filename)) {
    head = head.replace('href="/css/style.css"', 'href="css/style.css"');
  }
  return {
    headSha256: sha256(head),
    scriptsSha256: sha256(JSON.stringify(scriptTags(html, filename))),
    bodySha256: sha256(normalizeBody(html, filename)),
  };
}

test("all campaign sources preserve the reviewed campaign page baseline", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.baseCommit, baseCommit);
  assert.equal(manifest.normalizationVersion, "campaign-shell-v2");
  assert.deepEqual(Object.keys(manifest.pages), Object.keys(CAMPAIGN_PAGES));

  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const html = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.deepEqual(
      preservationHashes(html, filename),
      manifest.pages[filename],
      `${filename} preservation hashes`,
    );
  }
});

test("preservation hashes detect head, script, and body drift", () => {
  const filename = "index.html";
  const html = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
  const expected = preservationHashes(html, filename);

  assert.notEqual(
    preservationHashes(html.replace("<title>", "<title>Changed "), filename).headSha256,
    expected.headSha256,
  );
  assert.notEqual(
    preservationHashes(html.replace('<script src="/js/site.js"></script>', ""), filename).scriptsSha256,
    expected.scriptsSha256,
  );
  assert.notEqual(
    preservationHashes(html.replace('<link rel="stylesheet" href="/css/style.css" />', ""), filename).headSha256,
    expected.headSha256,
    "removing an unrelated stylesheet must be detected",
  );
  assert.notEqual(
    preservationHashes(html.replace('/assets/app/status.js', '/assets/app/changed-status.js'), filename).scriptsSha256,
    expected.scriptsSha256,
    "changing an unrelated script must be detected",
  );
  assert.notEqual(
    preservationHashes(html.replace("Help Tim Find His ID", "Help Tim Misplace His ID"), filename).bodySha256,
    expected.bodySha256,
  );

  const hunterFilename = "start.html";
  const hunterHtml = readFileSync(new URL(`../${hunterFilename}`, import.meta.url), "utf8");
  assert.notEqual(
    preservationHashes(
      hunterHtml.replace(/\shunter-page(?=["'])/, ""),
      hunterFilename,
    ).bodySha256,
    preservationHashes(hunterHtml, hunterFilename).bodySha256,
    "removing an existing page-family class must be detected",
  );
});
