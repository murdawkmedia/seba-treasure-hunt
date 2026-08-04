import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolveFromRoot = (name) => path.isAbsolute(name) ? name : path.join(root, name);
const read = (name) => fs.readFileSync(resolveFromRoot(name), "utf8");
const publicPages = Object.keys(CAMPAIGN_PAGES).filter((name) => !["privacy.html", "waiver.html"].includes(name));
const publicCode = [
  "scripts/campaign-shell.mjs",
  "js/site.js",
  "css/style.css",
  "css/campaign-shell.css",
  "css/hunter.css",
  "css/board.css",
  "css/sponsors.css",
  "src/client/board.ts",
  "src/client/dashboard.ts",
  "src/client/updates.ts",
];

function recursiveFiles(directory, extensions) {
  const absoluteInput = path.isAbsolute(directory);
  const baseDirectory = resolveFromRoot(directory);
  return fs.readdirSync(baseDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const filename = path.join(entry.parentPath, entry.name);
      return (absoluteInput ? filename : path.relative(root, filename)).replaceAll("\\", "/");
    });
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&(nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&(?:amp);/gi, "&")
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&quot;/gi, '"');
}

function visibleText(html) {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, ""))
    .normalize("NFKC")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

const pirateVocabulary = /\b(?:pirate(?:s|'s)?|ar+r+|matey|first[\s-]+mate|sea[\s-]+legs?|galleons?|kraken|captain[\s-]+latimer)\b/i;
const pirateSourceReferences = /sunny-pirate-treasure-seba-beach|font-pirate|pirata\s*one|rye\s*,?\s*serif|--font-pirate|firstmate/i;

test("all public source and rendered campaign surfaces use documentary language", () => {
  for (const filename of publicPages) {
    const sourceText = visibleText(read(filename));
    const renderedText = visibleText(readRenderedCampaignPage(filename));
    assert.doesNotMatch(sourceText, pirateVocabulary, `${filename} source visible text`);
    assert.doesNotMatch(renderedText, pirateVocabulary, `${filename} rendered visible text`);
  }
  const recursivePublicCode = [
    ...recursiveFiles("css", new Set([".css"])).filter((name) => name !== "css/ops.css"),
    ...recursiveFiles("js", new Set([".js"])).filter((name) => !name.startsWith("js/vendor/")),
    ...recursiveFiles("src/client", new Set([".ts"])).filter((name) => name !== "src/client/ops.ts"),
  ];
  for (const filename of [...new Set([...publicPages, ...publicCode, ...recursivePublicCode])]) {
    assert.doesNotMatch(read(filename), pirateSourceReferences, `${filename} contains no pirate asset/font reference`);
  }
});

test("a fresh recursive build contains documentary public output and no retired artwork", async () => {
  const { buildSite } = await import("../scripts/build.mjs");
  const output = await buildSite({ temporary: true });
  try {
    const builtFiles = recursiveFiles(output.dist, new Set([".html", ".css", ".js"]));
    const publicBuiltFiles = builtFiles.filter((name) =>
      !/(?:^|\/)(?:ops\.html|privacy\.html|waiver\.html|_worker\.js|ops\.js|ops\.css)$/.test(name),
    );
    for (const filename of publicBuiltFiles) {
      const content = read(filename);
      assert.doesNotMatch(content, pirateSourceReferences, `${filename} built references`);
      if (filename.endsWith(".html")) assert.doesNotMatch(visibleText(content), pirateVocabulary, `${filename} built text`);
    }
    assert.equal(fs.existsSync(path.join(output.dist, "assets/photos/sunny-pirate-treasure-seba-beach.jpg")), false);
    assert.equal(fs.existsSync(path.join(output.dist, "assets/photos/sunny-pirate-treasure-seba-beach.webp")), false);
  } finally {
    await output.cleanup();
  }
});

test("the documentary vocabulary guard catches whitespace, entities, and inline markup", () => {
  for (const sample of [
    "first   mate",
    "sea\nlegs",
    "first&nbsp;mate",
    "sea&#x20;legs",
    "<span>Captain</span> Latimer",
    "<strong>pir</strong>ate",
  ]) {
    assert.match(visibleText(sample).replace(/\s+/g, " "), pirateVocabulary, sample);
  }
});

test("the homepage presents the case in the approved documentary order", () => {
  const html = read("index.html");
  assert.match(html, /Seba Beach open case/);
  assert.match(html, /<h1[^>]*>Tim found his ID\.[\s\S]*The rest is still out there\./);
  assert.match(
    visibleText(html),
    /roughly \$5,000 was the initial amount[\s\S]{0,220}approaching \$10,000/i,
  );
  for (const [href, label] of [
    ["/route", "Where to Look"],
    ["/report", "I Found Something"],
    ["/dashboard", "My Hunt"],
  ]) assert.match(html, new RegExp(`href="${href}"[^>]*>[\\s\\S]{0,100}${label}`, "i"));

  const ids = [
    "top",
    "what-is-tim-lost-something",
    "evidence",
    "account",
    "route-overview",
    "latest-update",
    "casey-search",
    "participate",
    "report",
    "hunt-faq",
  ];
  let previous = -1;
  for (const id of ids) {
    const current = html.indexOf(`id="${id}"`);
    assert.ok(current > previous, `#${id} follows the approved homepage order`);
    previous = current;
  }
  assert.doesNotMatch(html, /<section\b(?=[^>]*\bid=["']sponsor["'])/i);
  assert.doesNotMatch(html, /Support the Search|href=["']\/?sponsors(?:\.html)?["']/i);
  assert.doesNotMatch(html, /This Is Just Year One/i);
});

test("real evidence is authoritative and the ID reference appears once with FOUND status", () => {
  const source = publicPages.map((name) => read(name)).join("\n");
  const image = "assets/photos/tim-lost-id-campaign-prop.webp";
  assert.equal(source.split(image).length - 1, 1);
  const home = read("index.html");
  assert.match(home, /alt="A visual representation of what Tim's ID could look like"/);
  assert.match(home, /aria-label="Status: found"[^>]*>FOUND<\/span>/);
  assert.match(home, /assets\/photos\/evidence-cash\.jpg/);
  assert.doesNotMatch(home, /Campaign reference|fictional reference image|fictional[^.]*not Tim(?:'|’|&rsquo;)s real ID/i);
  assert.match(home, /<meta property="og:image" content="https:\/\/www\.timlostsomething\.com\/assets\/photos\/evidence-cash\.jpg"/);
  assert.match(home, /<meta name="twitter:image" content="https:\/\/www\.timlostsomething\.com\/assets\/photos\/evidence-cash\.jpg"/);
  for (const block of [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]) {
    JSON.parse(block[1]);
    assert.doesNotMatch(block[1], /tim-lost-id-campaign-prop/);
  }
});

test("the homepage reuses the approved updates client with one bounded item and no pagination", () => {
  const home = read("index.html");
  assert.match(home, /data-updates-list/);
  assert.match(home, /data-updates-feed[^>]*data-updates-limit="1"[^>]*data-updates-paginate="false"/);
  assert.doesNotMatch(home, /data-updates-more/);
  assert.match(home, /<script type="module" src="\/assets\/app\/updates\.js"><\/script>/);
  const client = read("src/client/updates.ts");
  assert.match(client, /dataset\.updatesLimit/);
  assert.match(client, /Math\.min\([^\n]+20/);
  assert.match(read("updates.html"), /data-updates-limit="20"/);
  assert.match(read("updates.html"), /data-updates-more/);
});

test("the latest update card keeps its timestamp readable on the cream surface", () => {
  const css = read("css/style.css");
  const shellCss = read("css/campaign-shell.css");
  assert.match(css, /\.latest-update \.section-note\s*{\s*color:\s*var\(--cream-300\);\s*}/);
  assert.match(css, /\.latest-update \.official-note time\s*{\s*color:\s*var\(--ink-700\);\s*}/);
  assert.doesNotMatch(css, /\.latest-update\s+time[^{}]*{[^{}]*color:\s*var\(--cream-/);
  assert.match(css, /\.latest-update \.official-note \.provenance\s*{\s*color:\s*var\(--rust-600\);\s*}/);

  const hexToken = (source, name) => source.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const foreground = luminance(hexToken(css, "--ink-700"));
  const background = luminance(hexToken(shellCss, "--campaign-paper-100"));
  const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  assert.ok(contrast >= 4.5, `update timestamp contrast ${contrast.toFixed(2)}:1 meets WCAG AA`);
});

test("public naming is What People Found while sponsorship remains withdrawn", () => {
  const namedPages = ["clue-board.html", "community-guidelines.html", "updates.html", "start.html", "dashboard.html", "report.html"];
  for (const filename of namedPages) {
    assert.doesNotMatch(visibleText(read(filename)), /\bClue Board\b/i, filename);
  }
  assert.match(read("clue-board.html"), /What People Found/);
  assert.match(readRenderedCampaignPage("index.html"), /href="\/clue-board"[^>]*>What People Found<\/a>/);
  assert.doesNotMatch(publicPages.map((name) => read(name)).join("\n"), /\/case-notes/i);
  const renderedHome = readRenderedCampaignPage("index.html");
  assert.doesNotMatch(renderedHome, /Support the Search|href="\/sponsors"/i);
  assert.equal(Object.hasOwn(CAMPAIGN_PAGES, "sponsors.html"), false);
  assert.ok(fs.existsSync(path.join(root, "sponsors.html")), "the dormant source remains retained");
});

test("the dormant sponsor source uses the real aerial photograph and no retired pirate artwork", () => {
  const html = read("sponsors.html");
  assert.match(html, /<title>Support the Search \| Tim Lost Something\?<\/title>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.timlostsomething\.com\/assets\/photos\/hero-aerial\.jpg"/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/www\.timlostsomething\.com\/assets\/photos\/hero-aerial\.jpg"/);
  assert.match(html, /<img[^>]+src="\/assets\/photos\/hero-aerial\.jpg"[^>]+alt="[^"]*Seba Beach[^"]*"/i);
  assert.equal(fs.existsSync(path.join(root, "assets/photos/sunny-pirate-treasure-seba-beach.jpg")), false);
  assert.equal(fs.existsSync(path.join(root, "assets/photos/sunny-pirate-treasure-seba-beach.webp")), false);
  for (const file of ["sponsors.html", "css/sponsors.css"]) assert.doesNotMatch(read(file), /sponsor-hero__artifact|pirate/i);
});

test("the sitemap dates every materially rebranded public page to this release", () => {
  const sitemap = read("sitemap.xml");
  const currentPaths = ["/", "/route", "/golf-balls"];
  for (const route of currentPaths) {
    const escapedUrl = `https://www.timlostsomething.com${route}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(sitemap, new RegExp(`<loc>${escapedUrl}</loc>\\s*<lastmod>2026-07-29</lastmod>`), route);
  }
  const preservedPaths = ["/updates", "/rules", "/clue-board", "/interview", "/community-guidelines"];
  for (const route of preservedPaths) {
    const escapedUrl = `https://www.timlostsomething.com${route}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(sitemap, new RegExp(`<loc>${escapedUrl}</loc>\\s*<lastmod>2026-07-16</lastmod>`), route);
  }
  assert.doesNotMatch(sitemap, /<loc>https:\/\/www\.timlostsomething\.com\/sponsors<\/loc>/);
});

test("Tim's 19 answer bodies remain byte-identical", () => {
  const expected = [
    "caa6dfa7a13adb892744c4a58a24a66e35dc17d4dcdd966dcd36151594dc99cf", "86f31e343d1bfe5cbb6c6a7ae957c59f88679d3fd565aab38a5156c31b2c2352", "b85f91fe726069a951f6ecb1b796e866003511eeb4d602c68782d24493fc86b4", "773bded8c4934a67b681d1a295236d3f709bc2ae8d2e85d47ece19c64bfcb0bd", "ff501e988c4d42b57bc78b708c7964104ac35984d5740933b8086ce42c1510b0", "3ce3d481a438a8b8b9b8bdc898610bb225fb9af78566a13b1265b7b5b40f6606", "b087bb9716cc19415a640d5886a4c43e8d8f0b9de40a3e49da669257e4cbbd07", "c3e8dfec321ff16581d5c92bfa23df03cd4e1d4872c302c95f6c0523bea253fd", "64cbb071d209dda8c220b778abdea973a5ad40bc1f59c4a8195b77debb7b97aa", "c2c01396a0566fabf1314fe3c29b8a83b8161831fd73c5cf73005677301cc1b4", "9dab7f203c4fc2471e018d73ca87b0cea716157c9b9243c145c9259662b9aa7b", "0213b6cf6bf6d76f42bebe88f22d5d3b6e378a7d3a2f0ff645b463575006afa7", "45fbfcd8c8ec7a89529286a08da63f0948aba3f01016877d0345797202cbce94", "c7032828b75bc91a3cfd9629533c9f026a045556d07ff0b9c318e681a167f18a", "aebc31fa5fe3f77f38faac0f736fc1c806dc49c357ed8028e8f681b46f66e2f8", "13ea5e1435eb00561db92d5fb25af2300c7177245e94515f1544b11136ca4fae", "23e154ebbab89203de73fbfdf2ad074721b9d36301f54992e1d86ba22fccf21c", "ca8df2887ce2972a6b9ea16676b0612e00e9ba271c34648a88d4813c00ff0a0c", "e3962287fefa4a4dcebf5d095da4a0ffab7166aa86c72a78180b11ffad4ddd15",
  ];
  const answers = [...read("interview.html").matchAll(/<div class="qa-body">([\s\S]*?)<\/div>\s*<\/details>/g)];
  assert.equal(answers.length, 19);
  assert.deepEqual(answers.map((match) => crypto.createHash("sha256").update(match[1]).digest("hex")), expected);
});

test("the retraced route keeps all stable waypoints and documentary endpoints", () => {
  const route = read("route.html");
  const routeText = visibleText(route).replace(/\s+/g, " ");
  assert.match(route, /<title>The Route, Retraced \| Tim Lost Something\?<\/title>/);
  assert.match(route, /<h1>The route Tim took<\/h1>/);
  assert.deepEqual([...route.matchAll(/data-waypoint-id="(\d+)"/g)].map((match) => Number(match[1])), [1, 2, 3, 4, 13, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(routeText, /Tim(?:'|’)s number is his personal cell\. Please treat it with the same respect you would want for your own\./);
  for (const [href, label] of [["interview.html", "Tim’s Account"], ["rules.html", "Current rules"], ["report.html", "I Found Something"]]) {
    assert.match(route, new RegExp(`href="${href}"[^>]*>${label}<`, "i"));
  }
});
