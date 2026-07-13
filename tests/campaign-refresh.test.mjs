import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

const buildPublic = () =>
  execFileSync(process.execPath, ["scripts/build-public.mjs"], {
    cwd: root,
    stdio: "pipe",
  });

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

test("the Hunt FAQ says where prize updates are published", () => {
  const html = read("index.html");
  const huntFaq = html.match(
    /<section\b[^>]*\bid="hunt-faq"[^>]*>[\s\S]*?<\/section>/,
  );

  assert.ok(huntFaq, "index.html should contain the complete Hunt FAQ section");
  assert.match(
    huntFaq[0],
    /Any prize updates will be published on this website\./,
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

test("public build is allowlisted and contains no unconfirmed partner material", () => {
  buildPublic();

  assert.deepEqual(readdirSync(path.join(root, "dist")).sort(), [
    "_worker.js",
    "assets",
    "canonical-host-worker.mjs",
    "css",
    "index.html",
    "interview.html",
    "js",
    "robots.txt",
    "route.html",
    "sitemap.xml",
  ]);

  assert.ok(existsSync(path.join(root, "dist", "index.html")));
  assert.ok(
    existsSync(path.join(root, "dist", "canonical-host-worker.mjs")),
  );
  assert.ok(!existsSync(path.join(root, "dist", "docs")));
  assert.ok(!existsSync(path.join(root, "dist", "tests")));
  assert.ok(!existsSync(path.join(root, "dist", "scripts")));
  assert.ok(
    !existsSync(
      path.join(
        root,
        "dist",
        "assets",
        `${prohibitedPartner.toLowerCase()}-logo.png`,
      ),
    ),
  );
});

test("failed public build removes prior deployable output", () => {
  const prohibitedSource = path.join(
    root,
    "assets",
    `${prohibitedPartner.toLowerCase()}-temporary.txt`,
  );

  buildPublic();
  try {
    writeFileSync(prohibitedSource, "temporary packaging failure fixture");
    assert.throws(buildPublic);
    assert.ok(!existsSync(path.join(root, "dist")));
  } finally {
    rmSync(prohibitedSource, { force: true });
    buildPublic();
  }
});

test("public build rejects symbolic links and removes deployable output", (t) => {
  const externalDirectory = mkdtempSync(
    path.join(tmpdir(), "campaign-public-build-"),
  );
  const externalFile = path.join(externalDirectory, "external.txt");
  const sourceLink = path.join(root, "assets", "temporary-public-build-link");
  let linkCreated = false;

  writeFileSync(externalFile, "external packaging fixture");
  buildPublic();
  try {
    try {
      symlinkSync(
        externalDirectory,
        sourceLink,
        process.platform === "win32" ? "junction" : "dir",
      );
      linkCreated = true;
    } catch (error) {
      t.skip(`symbolic link fixture unavailable: ${error.message}`);
      return;
    }

    let buildError;
    try {
      buildPublic();
    } catch (error) {
      buildError = error;
    }
    assert.ok(buildError, "builder should reject the symbolic link");
    assert.match(
      `${buildError.message}\n${buildError.stderr?.toString() ?? ""}`,
      /symbolic link/i,
    );
    assert.ok(!existsSync(path.join(root, "dist")));
  } finally {
    if (linkCreated) rmSync(sourceLink, { recursive: true, force: true });
    rmSync(externalDirectory, { recursive: true, force: true });
    buildPublic();
  }
});
