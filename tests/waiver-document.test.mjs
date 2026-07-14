import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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
