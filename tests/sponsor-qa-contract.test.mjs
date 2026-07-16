import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(root, "scripts", "verify-sponsor-qa.mjs");

async function readRunner() {
  return readFile(runnerPath, "utf8");
}

function parseStringList(source) {
  return [...source.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function parseBroadDisposition(script) {
  const block = script.match(/const allowedBroadPaths = \{([^]*?)\n\s*\};/);
  assert.ok(block, "sponsor QA must declare its broad privacy-scan disposition");
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(?:([a-z_]+)|["']([^"']+)["']): new Set\((?:\[([^\]]*)\])?\),?$/gm)]
      .map((match) => [match[1] ?? match[2], parseStringList(match[3] ?? "")]),
  );
}

function parseExactPublicContacts(script) {
  const block = script.match(/const exactPublicContacts = new Map\(\[([^]*?)\n\s*\]\);/);
  assert.ok(block, "sponsor QA must declare its exact public-contact disposition");
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*\[["']([^"']+)["'], new Set\(\[([^\]]*)\]\)\],?$/gm)]
      .map((match) => [match[1], parseStringList(match[2])]),
  );
}

function parseReviewedPrivateNoteCopy(script) {
  const block = script.match(/const reviewedPrivateNoteCopy = \[([^]*?)\n\s*\];/);
  assert.ok(block, "sponsor QA must declare its exact reviewed private-note copy");
  return parseStringList(block[1]);
}

test("sponsor QA pins the exact approved broad contact disposition", async () => {
  const script = await readRunner();

  assert.deepEqual(parseBroadDisposition(script), {
    sponsor_inquiries: ["dist/_worker.js"],
    sponsor_inquiry_events: ["dist/_worker.js"],
    "private note": ["dist/assets/app/ops.js"],
    "@sebahub.com": ["dist/privacy.html", "dist/route.html"],
    "@businessasaforceforgood.ca": [],
    cfcw: [],
  });
});

test("sponsor QA pins every remaining public contact to its only approved page", async () => {
  const script = await readRunner();

  assert.deepEqual(parseExactPublicContacts(script), {
    "casey@sebahub.com": ["dist/route.html"],
    "info@sebahub.com": ["dist/privacy.html"],
  });
  assert.doesNotMatch(script, /tim@businessasaforceforgood\.ca/i);
});

test("sponsor QA pins every reviewed Ops private-note string", async () => {
  const script = await readRunner();

  assert.deepEqual(parseReviewedPrivateNoteCopy(script), [
    "Add an optional private note for this status change:",
    "Add a private note for this sponsor state change (optional, 2,000 characters maximum):",
    "Private notes must be 2,000 characters or fewer.",
  ]);
  assert.match(script, /matches\(opsDocument\.text, \/private note\/i\)\.length,\s*reviewedPrivateNoteCopy\.length/);
});

test("sponsor QA keeps its privacy scans fail closed", async () => {
  const script = await readRunner();

  assert.match(script, /const broadPattern = \/sponsor_inquiries\|sponsor_inquiry_events\|private note\|@sebahub\\\.com\|@businessasaforceforgood\\\.ca\|CFCW\/i/);
  assert.match(script, /allowedBroadPaths\[normalized\]\?\.has\(document\.path\)/);
  assert.match(script, /for \(const \[value, allowedPaths\] of Object\.entries\(allowedBroadPaths\)\)/);
  assert.match(script, /broadMatches\.some\(\(match\) => match\.path === expectedPath && match\.value\.toLowerCase\(\) === value\)/);
  assert.match(script, /exactPublicContacts\.get\(normalized\)\?\.has\(document\.path\)/);
  assert.match(script, /const correctedPattern = \/sponsor_inquiries\|sponsor_inquiry_events\|private note\|CFCW\/i/);
  assert.match(script, /const fixturePatternText = ["']alex@example\.test\|Good local fit\|staff_subject["']/);
  assert.match(script, /matches\(sponsorsHtml, \/@sebahub\\\.com\|@businessasaforceforgood\\\.ca\/i\)/);
  assert.match(script, /matches\(document\.text, \/CFCW\/i\)/);
});

test("sponsor QA exercises the canonical campaign shell", async () => {
  const script = await readRunner();

  assert.match(script, /["']\.case-strip["']/);
  assert.match(script, /["']\.campaign-header["']/);
  assert.match(script, /["']\.campaign-menu-toggle["']/);
  assert.match(script, /["']#campaign-nav["']/);
  assert.match(script, /["']#campaign-nav \.nav-sponsors["']/);
  assert.match(script, /["']\.campaign-footer["']/);
  assert.doesNotMatch(script, /sponsor-topbar|sponsor-footer|case-signal|board-topbar|board-menu-toggle|["']\.menu-toggle["']|["']#nav["']/);
});
