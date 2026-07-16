import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
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
  return fs.readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
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
    const builtFiles = recursiveFiles(path.relative(root, output.dist), new Set([".html", ".css", ".js"]));
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
  assert.match(html, /2026 search · Seba Beach, Alberta/);
  assert.match(html, /<h1>Tim lost his ID\.<\/h1>/);
  assert.match(visibleText(html), /side-by-side tour[^.]{0,80}roughly \$5,000[^.]{0,80}two diamond rings/i);
  for (const [href, label] of [
    ["start.html", "Start here"],
    ["report.html", "Report something"],
    ["updates.html", "Read official updates"],
    ["rules.html", "Rules and safety"],
  ]) assert.match(html, new RegExp(`href="${href}"[^>]*>${label}<`));

  const ids = ["what-is-tim-lost-something", "evidence", "account", "route-overview", "latest-update", "participate", "report", "sponsor", "hunt-faq"];
  let previous = -1;
  for (const id of ids) {
    const current = html.indexOf(`id="${id}"`);
    assert.ok(current > previous, `#${id} follows the approved homepage order`);
    previous = current;
  }
  assert.doesNotMatch(html, /This Is Just Year One/i);
});

test("real evidence is primary and the fictional ID appears once sitewide after it", () => {
  const source = publicPages.map((name) => read(name)).join("\n");
  const image = "assets/photos/tim-lost-id-campaign-prop.webp";
  assert.equal(source.split(image).length - 1, 1);
  const home = read("index.html");
  assert.ok(home.indexOf("assets/photos/evidence-cash.jpg") < home.indexOf(image));
  assert.match(home, /Campaign reference — not the missing card/);
  assert.match(home, /fictional[^.]*not Tim(?:'|’|&rsquo;)s real ID[^.]*not an exact picture of the missing card/i);
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

test("public naming is Case Notes and Support the Search while routes and hooks stay stable", () => {
  const namedPages = ["clue-board.html", "community-guidelines.html", "updates.html", "start.html", "dashboard.html", "report.html"];
  for (const filename of namedPages) {
    assert.doesNotMatch(visibleText(read(filename)), /\bClue Board\b/i, filename);
  }
  assert.match(read("clue-board.html"), /Case Notes/);
  assert.match(readRenderedCampaignPage("index.html"), /href="\/clue-board"[^>]*>Case Notes<\/a>/);
  assert.doesNotMatch(publicPages.map((name) => read(name)).join("\n"), /\/case-notes/i);
  assert.match(readRenderedCampaignPage("index.html"), /href="\/sponsors"[^>]*>Support the Search<\/a>/);
  assert.match(read("sponsors.html"), /<h1[^>]*>Support the Search<\/h1>/);
});

test("Support the Search uses the real aerial photograph and no retired pirate artwork", () => {
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
  const rebrandedPaths = ["/", "/route", "/updates", "/rules", "/clue-board", "/interview", "/community-guidelines", "/sponsors"];
  for (const route of rebrandedPaths) {
    const escapedUrl = `https://www.timlostsomething.com${route}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(sitemap, new RegExp(`<loc>${escapedUrl}</loc>\\s*<lastmod>2026-07-16</lastmod>`), route);
  }
});

test("Tim's 19 answer bodies remain byte-identical", () => {
  const expected = [
    "6953dfc7878544ea51d70fed38fa38fd725c6210a678d1d32ea8637c0cb87d9d", "a8ce5cf6ae16ec677ed009ae5523a0dec51c598e1da099954a3c5ff1b66535e7", "63eadee0353bc32c4f80ca763a718df79b10d8140a0ed5c8f969b798dcdc77f9", "c7b1bdf30406609733683e2520ff0e50a3165ffec93a3169b2085fcb7b3cdc0c", "e69772f529db309d549f25ae17f2576c61314d74b8b371423ef560782ea1b624", "311daa8d340e9520418ef23c1ee3e674a3f58771c8b2ed778ec6d02ccb58dafc", "c6d3c18d9b3028136ec6c82cfcf9e20e5bb1c6f17a0ac9b059fddc38d540b47d", "de00acfc885ff8c277230e5aa98fb90a5d39062b1b6498bd77eb89009fd636cf", "ccbec3cbd453294508be8d3dcd63bbda7a41fe7b54c9f384ce8b6458a86e38b3", "0b0e0040dc2721b4b192cc48c82156e70c1d1cb2079ca2cb68bfa596917a7aec", "95216c973b2303faf265ec592a6dcda15b460bc314ee03cf77e4d922d0670fe7", "190eef9d057be7fbb3ca8ebb4be434c763b3d131588f502d1fe9922f44be370b", "b6d6814a4118608afc710f435c3d8be0e0266cd96a5a3c5d5746e1dffcac6905", "5fb7953be7458f40e6d749507914b5000e5561f84575224ec0c4a88191ecc98f", "57b9b97d268b5b147a7483ca71abc5f28b6174856bab89027d181a22b6750a88", "4ecf7312187dd03e7b15f5bac201c2877ca80169979e5bfa2095bd4e023aaec2", "7ce6babb88b6d95202df6bd82e0186434cbd0caf57ec1f9a220f086bb0096275", "7677b71757ad2d6c8c0410044b5e300c9f7652f429ff50e7e462e1b83222e920", "fc05212c100f70179d31ca05e14b5c6625cb2439a92deaf051fd40799ced7be7",
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
  for (const [href, label] of [["interview.html", "Tim’s Account"], ["rules.html", "Current rules"], ["report.html", "Private report"]]) {
    assert.match(route, new RegExp(`href="${href}"[^>]*>${label}<`, "i"));
  }
});
