import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAMPAIGN_MENU,
  CAMPAIGN_PAGES,
  renderCampaignPage,
} from "../scripts/campaign-shell.mjs";
import { buildSite } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => readFileSync(path.join(root, filename), "utf8");
const visibleText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

test("Casey's golf-ball search is one registered public route", () => {
  assert.equal(CAMPAIGN_PAGES["golf-balls.html"], "golf-balls");
  assert.deepEqual(
    CAMPAIGN_MENU.find((item) => item.route === "golf-balls"),
    { route: "golf-balls", label: "Golf Balls", href: "/golf-balls" },
  );
  assert.equal(
    CAMPAIGN_MENU.filter((item) => item.route === "golf-balls").length,
    1,
  );
});

test("the golf-ball page separates Casey's search from Tim's case", () => {
  const source = read("golf-balls.html");
  const rendered = renderCampaignPage(source, "golf-balls.html");
  const text = visibleText(rendered);

  assert.match(source, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/golf-balls"/);
  assert.match(source, /<meta name="description" content="[^"]*Casey[^"]*In the Woods[^"]*golf balls[^"]*festival ticket/i);
  assert.match(source, /<meta property="og:url" content="https:\/\/www\.timlostsomething\.com\/golf-balls"/);
  assert.match(source, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  for (const block of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    JSON.parse(block[1]);
  }

  assert.match(text, /Casey lost the golf balls/i);
  assert.match(text, /official In the Woods logo/i);
  assert.match(text, /ordinary golf balls do not qualify/i);
  assert.match(text, /one qualifying ball[^.]*one[^.]*festival ticket/i);
  assert.match(text, /return the ball/i);
  assert.match(text, /SebaHub School[^.]*Monday[^.]*Friday/i);
  assert.match(rendered, /href="mailto:casey@sebahub\.com"/i);
  assert.match(rendered, /href="https:\/\/www\.inthewoodsmusicfestival\.com\/"/i);
  assert.match(rendered, /href="\/rules"/i);
  assert.doesNotMatch(text, /Tim lost[^.]*golf balls/i);
  assert.doesNotMatch(text, /Casey lost[^.]*ID|Casey lost[^.]*rings|Casey lost[^.]*cash/i);
});

test("the homepage keeps Tim primary and introduces Casey second", () => {
  const home = read("index.html");
  const text = visibleText(home);
  const timHeading = home.indexOf("<h1>Tim lost his ID.</h1>");
  const caseyHeading = home.indexOf("Casey lost something too.");

  assert.ok(timHeading >= 0);
  assert.ok(caseyHeading > timHeading);
  assert.match(text, /search began with roughly \$5,000/i);
  assert.match(text, /approaching \$10,000/i);
  assert.match(text, /Tim keeps retracing his steps/i);
  assert.match(text, /ID[^.]*still missing/i);
  assert.match(text, /two diamond rings[^.]*still missing/i);
  assert.match(home, /href="\/golf-balls"[^>]*>Follow Casey(?:'|&#39;)s golf-ball search<\/a>/i);
});

test("only approved surfaces publish the new golf-ball story", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const text = visibleText(read(filename));
    if (["index.html", "golf-balls.html"].includes(filename)) {
      assert.match(text, /golf[\s-]+balls?/i, filename);
    } else {
      assert.doesNotMatch(text, /Casey lost the golf balls|one qualifying ball/i, filename);
    }
  }
  assert.doesNotMatch(visibleText(read("interview.html")), /golf[\s-]+balls?/i);
});

test("the production build contains the new canonical page", async () => {
  const output = await buildSite({ temporary: true });
  try {
    const builtPath = path.join(output.dist, "golf-balls.html");
    assert.equal(existsSync(builtPath), true);
    const built = readFileSync(builtPath, "utf8");
    assert.match(built, /aria-current="page"[^>]*>Golf Balls<\/a>/);
    assert.match(built, /class="campaign-footer"/);
  } finally {
    await output.cleanup();
  }
});
