import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");

test("public pages do not disclose gated coordinates or unsafe route directions", () => {
  const publicSource = ["index.html", "route.html", "interview.html", "js/site.js"]
    .map(read)
    .join("\n");

  const forbidden = [
    /query=-?\d{2}\.\d+%?2?C?-?\d{2,3}\.\d+/i,
    /query=-?\d{2}\.\d+,-?\d{2,3}\.\d+/i,
    /\bROUTE_STOPS\b/,
    /class=["']coords["']/i,
    /class=["']photo-map["']/i,
    /GPS[- ]tagged/i,
    /exact photo locations?/i,
    /open this stop in Google Maps/i,
    /side spur[\s\S]{0,120}worth a look/i,
    /HIGH PRIORITY/i
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(publicSource, pattern, `public source matched ${pattern}`);
  }

  assert.match(read("route.html"), /sign in[\s\S]{0,160}Hunter Dashboard/i);
});

test("unconfirmed campaign extensions are not published as facts", () => {
  const publicHtml = ["index.html", "route.html", "interview.html"].map(read).join("\n");
  const forbidden = [
    /Official Radio Partner/i,
    /Friday[^<\n]{0,100}CFCW|CFCW[^<\n]{0,100}Friday/i,
    /\$10,000/i,
    /golf balls?/i,
    /trips and tickets/i,
    /founding sponsor/i
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(publicHtml, pattern, `public HTML matched ${pattern}`);
  }

  const publicCss = read("css/style.css");
  assert.doesNotMatch(publicCss, /CFCW|partner-strip|prize-cfcw|footer-cfcw/i);
});

test("published route photos contain no embedded location metadata", async () => {
  const routeRoot = path.join(repo, "assets", "route");
  const images = fs
    .readdirSync(routeRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:jpe?g)$/i.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));

  assert.ok(images.length >= 61, "expected the complete public route photo set");

  for (const image of images) {
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.exif, undefined, `${path.relative(repo, image)} retains EXIF`);
    assert.equal(metadata.xmp, undefined, `${path.relative(repo, image)} retains XMP`);
    assert.equal(metadata.iptc, undefined, `${path.relative(repo, image)} retains IPTC`);
    assert.equal(metadata.gps, undefined, `${path.relative(repo, image)} retains GPS`);
  }
});
