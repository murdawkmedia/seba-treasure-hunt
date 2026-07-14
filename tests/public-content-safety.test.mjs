import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");

const publicFiles = [
  ...fs.readdirSync(repo).filter((file) => /\.(?:html|xml|txt)$/i.test(file)),
  ...["css", "js", "src/client"].flatMap((directory) =>
    fs.readdirSync(path.join(repo, directory))
      .filter((file) => /\.(?:css|js|ts)$/i.test(file))
      .map((file) => path.join(directory, file))
  )
];

test("sponsor inquiry handling is disclosed but private records never enter public files", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /<h3>Sponsorship inquiries<\/h3>/i);
  assert.match(privacy, /contact name.*organization.*work email.*optional callback phone/is);
  assert.match(privacy, /support type.*optional contribution range.*partnership outcome/is);
  assert.match(privacy, /assess and follow up.*private partnership pipeline.*prevent abuse.*later agreement/is);
  assert.match(privacy, /does not subscribe.*marketing.*create a sponsorship agreement.*authorize.*publish/is);

  const publicSources = publicFiles.map(read).join("\n");
  assert.doesNotMatch(publicSources, /alex@example\.test|Good local fit|staff_subject/i);
  assert.doesNotMatch(
    publicSources,
    /CFCW|Official Radio Partner|guaranteed reach|exclusive sponsor/i
  );
});

test("guardian data and legal receipt delivery are disclosed without making minors public", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /Version 2026\.2/i);
  assert.match(privacy, /supervised minors?[\s\S]{0,300}full name[\s\S]{0,160}birth year/i);
  assert.match(privacy, /transactional legal (?:waiver )?receipt[\s\S]{0,220}verified email/i);
  assert.match(privacy, /do not grant or change permission for hunt updates or SebaHub marketing/i);
  assert.match(privacy, /Minor participant snapshots[\s\S]{0,260}never public[\s\S]{0,180}never included in player exports/i);
});

test("public browser surfaces contain no legal ledger, participant, receipt, or report fixtures", () => {
  const publicSources = publicFiles.map(read).join("\n");
  for (const privatePattern of [
    /Sam Hunter|Alex Hunter/i,
    /hunter@example\.test/i,
    /waiver-receipt-(?:job|[0-9a-f]{8})|providerMessageId/i,
    /acceptance-(?:event|id|[0-9])/i,
    /birthYear\s*[:=]\s*2014/i,
    /Private report evidence phrase|Pending private moderation phrase/i,
    /53\.123456|-114\.123456/,
  ]) {
    assert.doesNotMatch(publicSources, privatePattern, `public browser surface matched ${privatePattern}`);
  }
});

test("project docs make the sponsor workflow and unresolved validation state actionable", () => {
  const readme = read("README.md");
  const status = read("STATUS.md");
  const legal = read("src/generated/privacy-media.ts");
  const currentHash = legal.match(/hash:\s*"([a-f0-9]{64})"/)?.[1];
  assert.ok(currentHash, "current privacy hash is documented in the server contract");

  assert.match(readme, /`\/sponsors`[\s\S]{0,180}sponsor(?:ship)? inquir/i);
  assert.match(readme, /sponsor inquir[\s\S]{0,220}private D1[\s\S]{0,220}event ledger/i);
  assert.match(readme, /no automated email|no email automation/i);
  assert.match(readme, /Ops Sponsors|Sponsors ledger/i);

  assert.match(status, /migration `?0005[^\n]*not (?:confirmed|applied) remotely/i);
  assert.match(status, /Turnstile[^\n]*`sponsor_inquiry`[^\n]*(?:not verified|not configured|unconfirmed)/i);
  assert.match(status, /production[^\n]*(?:migration|deployment|DNS|data)[\s\S]{0,240}unchanged/i);
  assert.match(status, /validation inquir[^\n]*disposable/i);
  assert.match(status, /c385974ca255ef14161e89041908f4b4eda97c9e7f207288bd1db304a02925d9/i);
  assert.match(status, new RegExp(currentHash, "i"));
});

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

test("the sponsor surface publishes no invented reach, partner, or private workflow claim", () => {
  const sponsorHtml = read("sponsors.html");
  const sponsorCss = read("css/sponsors.css");
  const publicSurface = `${sponsorHtml}\n${sponsorCss}`;

  for (const pattern of [
    /CFCW/i,
    /radio partner|media partner|official partner/i,
    /guaranteed reach|exclusive sponsor|impressions/i,
    /@sebahub\.com|@businessasaforceforgood\.ca/i,
    /sponsor_inquiries|staff_subject|private note/i,
  ]) {
    assert.doesNotMatch(publicSurface, pattern, `sponsor surface matched ${pattern}`);
  }

  assert.doesNotMatch(sponsorHtml, /"@type"\s*:\s*"(?:Event|Offer|Review)"/i);
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
