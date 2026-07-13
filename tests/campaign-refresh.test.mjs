import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  encoding: "utf8",
}).trim();
const prohibitedPartner = String.fromCharCode(67, 70, 67, 87);
const prohibitedPattern = new RegExp(prohibitedPartner, "i");
const publicSourceFiles = [
  "index.html",
  "route.html",
  "interview.html",
  "css/style.css",
  "js/site.js",
  "robots.txt",
  "sitemap.xml",
];

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

test("all four Sunny badges link accessibly to the guarantee", () => {
  const html = pages.map(read).join("\n");
  const links =
    html.match(
      /href="https:\/\/www\.sebastays\.com\/guarantee"/g,
    ) ?? [];
  const labels =
    html.match(
      /aria-label="Visit the SebaStays Sunny Guarantee \(opens in a new tab\)"/g,
    ) ?? [];

  assert.equal(links.length, 4);
  assert.equal(labels.length, 4);
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
  assert.match(html, /Campaign prop \/ dramatization/);
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

test("public source contains no unconfirmed partner references", () => {
  const publicSource = publicSourceFiles
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(publicSource, prohibitedPattern);
  assert.doesNotMatch(publicSource, /official radio partner/i);
  assert.doesNotMatch(
    publicSource,
    /partner-strip|prize-cfcw|footer-cfcw/i,
  );
  assert.ok(
    !existsSync(
      path.join(
        root,
        "assets",
        `${prohibitedPartner.toLowerCase()}-logo.png`,
      ),
    ),
  );
});
