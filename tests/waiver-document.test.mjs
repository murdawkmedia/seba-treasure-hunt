import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const WAIVER_HASH = "cc687dd75974155c0bde30dfdc07925c69a7e80aeba4edf6012d077b2e99a380";
const PRIVACY_HASH = "7008d366a8c96b789bceba97a1e207fe25a94d4f3c057f624fb3b82316c8c82e";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("waiver 2026.2 is generated from one approved source while 2026.1 remains archived", () => {
  execFileSync(process.execPath, ["scripts/generate-waiver.mjs", "--check"], { stdio: "pipe" });
  const html = readFileSync("waiver.html", "utf8");
  const generated = readFileSync("src/generated/participation-waiver.ts", "utf8");

  assert.match(html, /SebaHub Tim Lost Something\? Participant Acknowledgement, Waiver and Release/);
  assert.match(html, /Effective July 15, 2026/);
  assert.match(html, /In an emergency, I will call 911\./);
  assert.match(html, /official website form or another contact method published on the campaign website/);
  assert.doesNotMatch(html, /Lost Wallet Mystery|campaign hotline|\[what is/i);
  assert.match(generated, /"version": "2026\.2"/);
  assert.match(generated, /Report publication and minor privacy/);
  assert.match(generated, /A participant under 18 may create an individual account/);
  assert.match(generated, /"hash": "[a-f0-9]{64}"/);
});

test("the waiver is a clean public route and allowlisted build artifact", () => {
  const app = readFileSync("src/server/app.ts", "utf8");
  const build = readFileSync("scripts/build.mjs", "utf8");

  assert.match(app, /\["\/waiver", "\/waiver\.html"\]/);
  assert.match(build, /"waiver\.html"/);
  assert.match(build, /legal:verify/);
  assert.ok(existsSync("src/client/waiver.ts"));
  assert.ok(existsSync("src/client/legal-embed.ts"));
});

test("legal documents load the presentation-only signup embed outside authoritative content", () => {
  const waiver = readFileSync("waiver.html", "utf8");
  const privacy = readFileSync("privacy.html", "utf8");

  for (const [name, html] of [["waiver", waiver], ["privacy", privacy]]) {
    const legalMain = html.match(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/)?.[0] ?? "";
    assert.ok(legalMain, `${name} keeps its authoritative legal main`);
    assert.doesNotMatch(legalMain, /legal-embed\.js/);
    assert.match(html.slice(html.indexOf("</main>")), /<script type="module" src="\/assets\/app\/legal-embed\.js"><\/script>/);
  }
});

test("the approved waiver and privacy legal bodies retain their exact hashes", () => {
  const archivedWaiverSource = JSON.parse(readFileSync("legal/participation-waiver-2026.1.json", "utf8"));
  const waiverSource = JSON.parse(readFileSync("legal/participation-waiver-2026.2.json", "utf8"));
  const privacyHtml = readFileSync("privacy.html", "utf8");
  const privacyMain = privacyHtml.match(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/)?.[0];
  const generatedWaiver = readFileSync("src/generated/participation-waiver.ts", "utf8");
  const generatedPrivacy = readFileSync("src/generated/privacy-media.ts", "utf8");

  assert.ok(privacyMain, "privacy.html contains its canonical legal main content");
  assert.equal(archivedWaiverSource.version, "2026.1");
  assert.equal(waiverSource.version, "2026.2");
  assert.equal(sha256(`${JSON.stringify(waiverSource)}\n`), WAIVER_HASH);
  assert.equal(sha256(`${privacyMain.replaceAll("\r\n", "\n").trim()}\n`), PRIVACY_HASH);
  assert.match(generatedWaiver, new RegExp(`"hash": "${WAIVER_HASH}"`));
  assert.match(generatedPrivacy, new RegExp(`hash: "${PRIVACY_HASH}"`));
  assert.match(generatedPrivacy, /version: "2026\.3"/);
});
