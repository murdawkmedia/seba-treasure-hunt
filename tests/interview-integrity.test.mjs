import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CAMPAIGN_MENU } from "../scripts/campaign-shell.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => readFileSync(path.join(repo, filename), "utf8");
const interview = read("interview.html");
const golfBallPhrase = /golf(?:[\s-]+)balls?/i;

function visibleTextFromHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:nbsp|ensp|emsp|thinsp|tab|newline);|&#0*(?:9|10|13|32|160);|&#x0*(?:9|a|d|20|a0);/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

test("Tim's Account publishes exactly 19 uniquely and sequentially numbered entries", () => {
  const entries = [...interview.matchAll(/<details class="qa">[\s\S]*?<\/details>/g)];
  const numbers = entries.map((entry) => {
    const number = entry[0].match(/<span class="qa-num">(\d+)<\/span>/);
    assert.ok(number, "every interview entry has a visible number");
    return Number(number[1]);
  });

  assert.equal(entries.length, 19);
  assert.deepEqual(numbers, Array.from({ length: 19 }, (_, index) => index + 1));
  assert.equal(new Set(numbers).size, 19);
});

test("Tim's Account has the three accessible editorial sections in story order", () => {
  const headings = [...interview.matchAll(/<h3\b[^>]*class="interview-part-title"[^>]*>([^<]+)<\/h3>/g)]
    .map((match) => match[1]);

  assert.deepEqual(headings, [
    "Before the route",
    "Along the route",
    "After the discovery",
  ]);
});

test("the editorial sections group the account before, along, and after the route", () => {
  const sections = [...interview.matchAll(
    /<section class="interview-part" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g,
  )];
  const expected = [
    ["before-the-route", [1, 2, 3, 4]],
    ["along-the-route", [5, 6, 7, 8, 9, 10, 11, 12, 13]],
    ["after-the-discovery", [14, 15, 16, 17, 18, 19]],
  ];

  assert.equal(sections.length, expected.length);
  sections.forEach((section, index) => {
    const [id, numbers] = expected[index];
    assert.equal(section[1], id);
    assert.match(section[2], new RegExp(`<h3 id="${id}"`));
    assert.deepEqual(
      [...section[2].matchAll(/<span class="qa-num">(\d+)<\/span>/g)]
        .map((match) => Number(match[1])),
      numbers,
    );
  });
});

test("Tim's Account is the primary public name across discovery and navigation copy", () => {
  for (const [filename, pattern] of [
    ["interview.html", /<h1>[^<]*Tim(?:'|’)s Account[^<]*<\/h1>/],
    ["interview.html", /<meta property="og:title" content="[^"]*Tim(?:'|’)s Account[^"]*"/],
    ["interview.html", /<meta name="twitter:title" content="[^"]*Tim(?:'|’)s Account[^"]*"/],
    ["interview.html", /"name": "Tim(?:'|’)s Account"/],
    ["index.html", />[^<]*Tim(?:'|’)s Account[^<]*<\/a>/],
    ["route.html", />[^<]*Tim(?:'|’)s Account[^<]*<\/a>/],
    ["start.html", /Tim(?:'|’)s Account/],
  ]) {
    assert.match(read(filename), pattern, `${filename} uses the primary feature name`);
  }
});

test("the campaign navigation names the public feature Tim's Account", () => {
  assert.deepEqual(
    CAMPAIGN_MENU.find((item) => item.route === "interview"),
    { route: "interview", label: "Tim's Account", href: "/interview" },
  );
});

test("public sources make no numeric interview-count claim", () => {
  const publicSources = readdirSync(repo)
    .filter((filename) => filename.endsWith(".html"))
    .map((filename) => read(filename))
    .join("\n");

  assert.doesNotMatch(
    publicSources,
    /\b(?:19|20|nineteen|twenty)[-\s]+(?:public\s+)?(?:questions?|answers?)\b/i,
  );
});

test("the unpublished golf-ball question stays absent from public sources", () => {
  for (const filename of readdirSync(repo).filter((candidate) => candidate.endsWith(".html"))) {
    assert.doesNotMatch(
      visibleTextFromHtml(read(filename)),
      golfBallPhrase,
      `${filename} contains no visible golf-ball phrase`,
    );
  }
});

test("the golf-ball guard catches whitespace, entity, and inline-markup bypasses", () => {
  for (const fixture of [
    "golf   balls",
    "golf\n\nballs",
    "golf&nbsp;ball",
    "golf&#160;balls",
    "golf&#xA0;ball",
    "golf <em>ball</em>",
  ]) {
    assert.match(visibleTextFromHtml(fixture), golfBallPhrase, `guard catches ${fixture}`);
  }
});
