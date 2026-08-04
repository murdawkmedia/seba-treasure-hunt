import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSite } from "../scripts/build.mjs";
import { CAMPAIGN_MENU, CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nonLegalPublicPages = Object.keys(CAMPAIGN_PAGES)
  .filter((filename) => !["privacy.html", "waiver.html"].includes(filename));

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&(?:amp);/gi, "&")
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&quot;/gi, '"')
    .normalize("NFKC")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

function publicMetadataText(html) {
  const metaContent = [...html.matchAll(/<meta\b[^>]*\bcontent=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2] ?? "");
  const structuredData = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.stringify(JSON.parse(match[1])));
  return [...metaContent, ...structuredData].join(" ");
}

function publicSiteBlurbs(source) {
  return [...source.matchAll(/\bblurb:\s*"([^"]*)"/g)].map((match) => match[1]);
}

test("the public case shell uses plain hunt actions and has no sponsorship destination", () => {
  assert.equal(Object.hasOwn(CAMPAIGN_PAGES, "sponsors.html"), false);
  assert.deepEqual(CAMPAIGN_MENU.find((item) => item.route === "route"), {
    route: "route",
    label: "Where to Look",
    href: "/route",
  });
  assert.equal(CAMPAIGN_MENU.some((item) => item.route === "sponsors"), false);

  const home = renderCampaignPage(readFileSync(path.join(root, "index.html"), "utf8"), "index.html");
  assert.match(home, /Tim Lost Something\?<span>Tim found his ID\. The rest is still out there\.<\/span>/);
  assert.doesNotMatch(home, /Support the Search|href=["']\/?sponsors(?:\.html)?["']/i);
});

test("Casey's public page uses local-case language", () => {
  const golfBalls = readFileSync(path.join(root, "golf-balls.html"), "utf8");
  assert.match(golfBalls, /Casey Lost the Golf Balls/);
  assert.doesNotMatch(
    visibleText(golfBalls),
    /\bcampaign\b|\boperators?\b|Support the Search/i,
  );
});

test("the README documents 13 places and the withdrawn public sponsorship surface", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");

  assert.match(readme, /\| `\/route` \| Where to Look: 13 public place stories;/);
  assert.doesNotMatch(readme, /Lucky 13|\| `\/sponsors` \||submitted through `\/sponsors`/i);
  assert.match(readme, /Public sponsorship is withdrawn\./);
  assert.match(readme, /`sponsors\.html` source remains in the repository/);
  assert.match(readme, /Existing sponsor inquiry records remain private in the Ops Sponsors ledger\./);
});

test("the public build excludes the withdrawn sponsor page, stylesheet, and browser entries", async () => {
  const output = await buildSite({ temporary: true });
  try {
    assert.equal(existsSync(path.join(output.dist, "sponsors.html")), false);
    assert.equal(existsSync(path.join(output.dist, "css", "sponsors.css")), false);
    assert.equal(existsSync(path.join(output.dist, "assets", "app", "sponsors.js")), false);
    assert.equal(existsSync(path.join(output.dist, "assets", "app", "sponsor-submission.js")), false);
  } finally {
    await output.cleanup();
  }
});

test("all non-legal public pages use current local-case vocabulary in rendered and built output", async () => {
  const stalePublicVocabulary = /\bThis year\b|\bLucky 13\b|\bcampaign\b|\bfictional reference image\b/i;

  for (const filename of nonLegalPublicPages) {
    const source = readFileSync(path.join(root, filename), "utf8");
    const rendered = renderCampaignPage(source, filename);
    assert.doesNotMatch(visibleText(rendered), stalePublicVocabulary, `${filename} rendered visible text`);
    assert.doesNotMatch(publicMetadataText(rendered), /\bcampaign\b/i, `${filename} rendered metadata`);
  }
  const sourceBlurbs = publicSiteBlurbs(readFileSync(path.join(root, "js/site.js"), "utf8"));
  assert.equal(sourceBlurbs.length, 4, "all public property-card blurbs are scanned");
  assert.doesNotMatch(sourceBlurbs.join(" "), /\bcampaign\b/i, "source property-card blurbs");

  const output = await buildSite({ temporary: true });
  try {
    for (const filename of nonLegalPublicPages) {
      const built = readFileSync(path.join(output.dist, filename), "utf8");
      assert.doesNotMatch(visibleText(built), stalePublicVocabulary, `${filename} built visible text`);
      assert.doesNotMatch(publicMetadataText(built), /\bcampaign\b/i, `${filename} built metadata`);
    }
    const builtBlurbs = publicSiteBlurbs(
      readFileSync(path.join(output.dist, "js", "site.js"), "utf8"),
    );
    assert.deepEqual(builtBlurbs, sourceBlurbs, "the built property-card copy matches reviewed source");
    assert.doesNotMatch(builtBlurbs.join(" "), /\bcampaign\b/i, "built property-card blurbs");
  } finally {
    await output.cleanup();
  }
});

test("the homepage presents the ID reference once with an accessible FOUND treatment", () => {
  const home = readFileSync(path.join(root, "index.html"), "utf8");
  const presentation = home.match(/<li\b(?=[^>]*data-case-item="tims-id")[^>]*>[\s\S]*?<\/li>/)?.[0];

  assert.ok(presentation, "the ID reference presentation is present");
  assert.equal((home.match(/tim-lost-id-campaign-prop\.webp/g) ?? []).length, 1);
  assert.match(presentation, /alt="A visual representation of what Tim's ID could look like"/);
  assert.match(presentation, /aria-label="Status: found"[^>]*>FOUND<\/span>/);
});

test("visitor-facing copy identifies SebaHub representatives without operator language", () => {
  for (const filename of nonLegalPublicPages) {
    const rendered = renderCampaignPage(
      readFileSync(path.join(root, filename), "utf8"),
      filename,
    );
    assert.doesNotMatch(visibleText(rendered), /\boperators?\b/i, `${filename} visible text`);
    assert.doesNotMatch(publicMetadataText(rendered), /\boperators?\b/i, `${filename} metadata`);
  }

  const dormantSponsors = readFileSync(path.join(root, "sponsors.html"), "utf8");
  assert.match(
    dormantSponsors,
    /<p class="sponsor-hero__lead">Help a local story gather momentum\.<\/p>/,
  );
  assert.doesNotMatch(visibleText(dormantSponsors), /\boperators?\b/i);

  const dashboardClient = readFileSync(path.join(root, "src/client/dashboard.ts"), "utf8");
  assert.match(dashboardClient, /text\(value\.publisherName, "A representative from SebaHub"\)/);
  assert.doesNotMatch(dashboardClient, /text\(value\.publisherName, "Campaign operator"\)/);
  for (const filename of ["src/client/report.ts", "src/client/board.ts", "src/client/dashboard.ts"]) {
    assert.doesNotMatch(
      readFileSync(path.join(root, filename), "utf8"),
      /\boperators?\b/i,
      `${filename} visitor copy`,
    );
  }
});
