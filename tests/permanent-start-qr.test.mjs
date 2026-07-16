import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the physical campaign QR has one permanent, reproducible destination", () => {
  const scriptPath = path.join(repo, "scripts", "generate-start-qr.mjs");
  const assetPath = path.join(repo, "assets", "start-qr.svg");
  assert.equal(fs.existsSync(scriptPath), true);
  assert.equal(fs.existsSync(assetPath), true);

  const script = fs.readFileSync(scriptPath, "utf8");
  const svg = fs.readFileSync(assetPath, "utf8");
  assert.match(script, /https:\/\/www\.timlostsomething\.com\/start/);
  assert.match(svg, /^<svg[^>]+viewBox=/);
  assert.doesNotMatch(svg, /<script|javascript:/i);
});
