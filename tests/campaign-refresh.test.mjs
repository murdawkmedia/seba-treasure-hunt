import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const pages = ["index.html", "route.html", "interview.html"];
const canonical = {
  "index.html": "https://www.timlostsomething.com/",
  "route.html": "https://www.timlostsomething.com/route",
  "interview.html": "https://www.timlostsomething.com/interview",
};

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("all pages use the campaign brand and canonical domain", () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /Tim Lost Something\?/);
    assert.match(
      html,
      new RegExp(
        `<link rel="canonical" href="${escapeRegExp(canonical[page])}"`,
      ),
    );
    assert.doesNotMatch(
      html,
      /murdawkmedia\.github\.io\/seba-treasure-hunt/,
    );
  }
});

test("every rendered campaign page has exactly one accessible Sunny guarantee badge in its footer", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const html = readRenderedCampaignPage(filename);
    const footer = html.match(/<footer class="campaign-footer">([\s\S]*?)<\/footer>/)?.[0];
    assert.ok(footer, `${filename} has the shared footer`);
    const badges = [
      ...html.matchAll(
        /<a\b(?=[^>]*\bclass="[^"]*\bsunny-badge-link\b[^"]*")[^>]*>/g,
      ),
    ].map((match) => match[0]);

    assert.equal(badges.length, 1, `${filename} has one Sunny badge`);
    const [badge] = badges;
    assert.match(footer, /class="sunny-badge-link"/);
    assert.match(badge, /\bhref="https:\/\/www\.sebastays\.com\/guarantee"/);
    assert.match(badge, /\btarget="_blank"/);
    assert.match(badge, /\brel="noopener"/);
    assert.match(
      badge,
      /\baria-label="Visit the SebaStays Sunny Guarantee \(opens in a new tab\)"/,
    );
  }

  const homepageMain = read("index.html").match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[0];
  assert.ok(homepageMain, "homepage has a main landmark");
  assert.doesNotMatch(homepageMain, /sunny-badge-link|Always Sunny in Seba/);
});

test("SEO and answer-engine surfaces are present and parseable", () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<meta name="description"/);
    assert.match(html, /<meta property="og:url"/);
    assert.match(
      html,
      /<meta name="twitter:card" content="summary_large_image"/,
    );

    const blocks = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    assert.ok(blocks.length > 0, `${page} should have JSON-LD`);
    for (const block of blocks) JSON.parse(block[1]);
  }

  assert.match(read("index.html"), /id="what-is-tim-lost-something"/);
  assert.match(read("index.html"), /id="hunt-faq"/);
});

test("the campaign prop is disclosed and never replaces evidence", () => {
  const html = read("index.html");
  assert.match(
    html,
    /assets\/photos\/tim-lost-id-campaign-prop\.webp/,
  );
  assert.match(html, /Campaign reference — not the missing card/);
  assert.match(html, /fictional, not Tim’s real ID, and not an exact picture of the missing card/);
  assert.match(html, /assets\/photos\/evidence-cash\.jpg/);
  assert.ok(
    existsSync(
      new URL(
        "../assets/photos/tim-lost-id-campaign-prop.webp",
        import.meta.url,
      ),
    ),
  );
});

test("crawl files use only the canonical hostname", () => {
  assert.ok(
    existsSync(new URL("../robots.txt", import.meta.url)),
    "robots.txt should exist",
  );
  assert.ok(
    existsSync(new URL("../sitemap.xml", import.meta.url)),
    "sitemap.xml should exist",
  );
  assert.match(
    read("robots.txt"),
    /Sitemap: https:\/\/www\.timlostsomething\.com\/sitemap\.xml/,
  );

  const sitemap = read("sitemap.xml");
  for (const url of Object.values(canonical)) {
    assert.match(sitemap, new RegExp(escapeRegExp(url)));
  }
});

test("canonical campaign copy calls the lost item an ID bundle", () => {
  const publicCopy = [...pages.map(read), read("js/site.js")].join("\n");
  const stalePhrases = [
    "The Legend of Tim's Lost Wallet",
    "1 Missing Wallet",
    "The wallet is out there",
    "and so is the wallet",
    "One lost wallet.",
    'This year Tim "lost" a wallet',
    "Ask the ghosts about Tim's wallet",
    "78 Seconds",
  ];

  for (const phrase of stalePhrases) {
    assert.doesNotMatch(publicCopy, new RegExp(escapeRegExp(phrase), "i"));
  }
});
