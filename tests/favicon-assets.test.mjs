import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CAMPAIGN_PAGES } from "../scripts/campaign-shell.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPages = [...Object.keys(CAMPAIGN_PAGES), "ops.html"];

test("favicon SVG contains the approved Missing ID symbols", () => {
  const svg = fs.readFileSync(path.join(repo, "assets", "favicon.svg"), "utf8");
  assert.match(svg, /viewBox="0 0 64 64"/);
  for (const part of [
    "id-card",
    "portrait-silhouette",
    "question-mark",
    "open-case-status",
  ]) {
    assert.match(svg, new RegExp(`data-part="${part}"`));
  }
  assert.match(svg, /#071f1c/i, "dark-green case color");
  assert.match(svg, /#f6efdd/i, "cream evidence color");
  assert.match(svg, /#e0a01e/i, "gold verification color");
  assert.match(svg, /#a6452a/i, "restrained red open-case color");
  assert.doesNotMatch(svg, /pirate|eyepatch|hat|treasure|chest|mascot/i);
  assert.doesNotMatch(svg, /<text|<script|<defs|\b(?:href|src)=["']https?:/);
});

test("generated PNG and ICO assets have the required dimensions", async () => {
  for (const [file, width] of [
    ["assets/favicon-32x32.png", 32],
    ["assets/apple-touch-icon.png", 180],
    ["assets/favicon-192x192.png", 192],
    ["assets/favicon-512x512.png", 512],
  ]) {
    const metadata = await sharp(path.join(repo, file)).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, width);
    assert.equal(metadata.format, "png");
  }

  const ico = fs.readFileSync(path.join(repo, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [0, 1, 2].map((index) => ico[6 + index * 16] || 256);
  assert.deepEqual(sizes, [16, 32, 48]);
});

test("generated favicon pixels are fresh from the tracked SVG source", async () => {
  const source = fs.readFileSync(path.join(repo, "assets", "favicon.svg"));
  const outputs = [
    ["assets/favicon-32x32.png", 32],
    ["assets/apple-touch-icon.png", 180],
    ["assets/favicon-192x192.png", 192],
    ["assets/favicon-512x512.png", 512],
  ];

  for (const [file, size] of outputs) {
    const expected = await sharp(source, { density: 512 }).resize(size, size).png().toBuffer();
    assert.deepEqual(fs.readFileSync(path.join(repo, file)), expected, `${file} is current`);
  }

  const ico = fs.readFileSync(path.join(repo, "favicon.ico"));
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const expected = await sharp(source, { density: 512 }).resize(size, size).png().toBuffer();
    assert.deepEqual(ico.subarray(offset, offset + length), expected, `ICO ${size}px frame is current`);
  }
});

test("every HTML page references the shared favicon set", () => {
  for (const page of htmlPages) {
    const html = fs.readFileSync(path.join(repo, page), "utf8");
    assert.match(html, /href="\/favicon\.ico"/);
    assert.match(html, /href="\/assets\/favicon\.svg"/);
    assert.match(html, /href="\/assets\/favicon-32x32\.png"/);
    assert.match(html, /href="\/assets\/apple-touch-icon\.png"/);
    assert.match(html, /href="\/site\.webmanifest"/);
    assert.doesNotMatch(html, /data:image\/svg\+xml[^\n]+%F0%9F%92%B0/i);
  }
});

test("the build allowlist publishes the root favicon files", () => {
  const script = fs.readFileSync(path.join(repo, "scripts", "build.mjs"), "utf8");
  assert.match(script, /"favicon\.ico"/);
  assert.match(script, /"site\.webmanifest"/);
});
