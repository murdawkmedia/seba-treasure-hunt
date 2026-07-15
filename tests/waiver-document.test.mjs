import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const WAIVER_HASH = "1a6e50f445fc7c67962e5e0050c7fbe161d7d78e679dab4f6fde951602cf3607";
const PRIVACY_HASH = "47e26763d46441e2e155a6d0ca3869986395c49b60073a8da9256577229f07a8";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("waiver 2026.1 is generated from one approved source", () => {
  execFileSync(process.execPath, ["scripts/generate-waiver.mjs", "--check"], { stdio: "pipe" });
  const html = readFileSync("waiver.html", "utf8");
  const generated = readFileSync("src/generated/participation-waiver.ts", "utf8");

  assert.match(html, /SebaHub Tim Lost Something\? Participant Acknowledgement, Waiver and Release/);
  assert.match(html, /Effective July 13, 2026/);
  assert.match(html, /In an emergency, I will call 911\./);
  assert.match(html, /official website form or another contact method published on the campaign website/);
  assert.doesNotMatch(html, /Lost Wallet Mystery|campaign hotline|\[what is/i);
  assert.match(generated, /"version": "2026\.1"/);
  assert.match(generated, /"hash": "[a-f0-9]{64}"/);
});

test("the waiver is a clean public route and allowlisted build artifact", () => {
  const app = readFileSync("src/server/app.ts", "utf8");
  const build = readFileSync("scripts/build.mjs", "utf8");

  assert.match(app, /\["\/waiver", "\/waiver\.html"\]/);
  assert.match(build, /"waiver\.html"/);
  assert.match(build, /legal:verify/);
  assert.ok(existsSync("src/client/waiver.ts"));
});

test("the approved waiver and privacy legal bodies retain their exact hashes", () => {
  const waiverSource = JSON.parse(readFileSync("legal/participation-waiver-2026.1.json", "utf8"));
  const privacyHtml = readFileSync("privacy.html", "utf8");
  const privacyMain = privacyHtml.match(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/)?.[0];
  const generatedWaiver = readFileSync("src/generated/participation-waiver.ts", "utf8");
  const generatedPrivacy = readFileSync("src/generated/privacy-media.ts", "utf8");

  assert.ok(privacyMain, "privacy.html contains its canonical legal main content");
  assert.equal(sha256(`${JSON.stringify(waiverSource)}\n`), WAIVER_HASH);
  assert.equal(sha256(`${privacyMain.replaceAll("\r\n", "\n").trim()}\n`), PRIVACY_HASH);
  assert.match(generatedWaiver, new RegExp(`"hash": "${WAIVER_HASH}"`));
  assert.match(generatedPrivacy, new RegExp(`hash: "${PRIVACY_HASH}"`));
});
