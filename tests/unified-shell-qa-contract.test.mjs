import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(root, "scripts", "verify-unified-shell-qa.mjs");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function readRunner() {
  assert.equal(existsSync(runnerPath), true, "the unified-shell QA runner must exist");
  return readFile(runnerPath, "utf8");
}

test("unified-shell QA is a durable isolated command with the exact route-state matrix", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const script = await readRunner();

  assert.equal(packageJson.scripts["verify:unified-shell-qa"], "node scripts/verify-unified-shell-qa.mjs");
  assert.match(script, /from ["']@playwright\/test["']/);
  assert.match(script, /buildSite\(\{\s*temporary:\s*true\s*\}\)/);
  assert.match(script, /CAMPAIGN_PAGES/);
  assert.match(script, /Object\.keys\(CAMPAIGN_PAGES\)/);
  for (const viewport of [
    /name:\s*["']360x900["'],\s*width:\s*360,\s*height:\s*900/,
    /name:\s*["']768x900["'],\s*width:\s*768,\s*height:\s*900/,
    /name:\s*["']1440x900["'],\s*width:\s*1440,\s*height:\s*900/,
    /name:\s*["']720x500["'],\s*width:\s*720,\s*height:\s*500/,
    /name:\s*["']390x844["'],\s*width:\s*390,\s*height:\s*844/,
    /name:\s*["']1440x1000-representative["'],\s*width:\s*1440,\s*height:\s*1000/,
  ]) assert.match(script, viewport);
  assert.match(script, /pageNavigations/);
  assert.match(script, /statesAudited/);
  assert.match(script, /consoleErrorCount/);
  assert.match(script, /pageErrorCount/);
  assert.match(script, /statesAudited,\s*111/);
  assert.match(script, /pageNavigations,\s*72/);
});

test("unified-shell QA keeps screenshots and its JSON ledger in a unique OS temp directory", async () => {
  const script = await readRunner();

  assert.match(script, /mkdtemp\(path\.join\(os\.tmpdir\(\),\s*["']tim-lost-unified-shell-qa-["']\)\)/);
  assert.match(script, /const screenshotRoot = path\.join\(artifactRoot,\s*["']screenshots["']\)/);
  assert.match(script, /const logPath = path\.join\(artifactRoot,\s*["']qa-log\.json["']\)/);
  assert.match(script, /createHash\(["']sha256["']\)/);
  assert.match(script, /artifactName/);
  assert.match(script, /sha256/);
  assert.match(script, /mobile-390x844-home\.png/);
  assert.match(script, /desktop-1440x1000-waiver\.png/);
  assert.match(script, /zoom-200-route-menu-open\.png/);
  assert.match(script, /UNIFIED_SHELL_QA_PRESERVE_ARTIFACTS/);
  assert.match(script, /rm\(artifactRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(script, /path\.join\(root,\s*["'](?:screenshots|qa-log\.json)["']\)/);
});

test("unified-shell QA fails closed at every network and write boundary", async () => {
  const script = await readRunner();

  assert.match(script, /await context\.route\(["']\*\*\/\*["']/);
  assert.match(script, /method === ["']GET["'] \|\| method === ["']HEAD["']/);
  assert.match(script, /externalRequestAttempts/);
  assert.match(script, /externalWriteAttempts/);
  assert.match(script, /continuedExternalRequests/);
  assert.match(script, /localWriteAttempts/);
  assert.match(script, /serverRejectedWrites/);
  assert.match(script, /fulfilled-local-external-read/);
  assert.match(script, /route\.fulfill/);
  assert.match(script, /route\.abort\(["']blockedbyclient["']\)/);
  assert.match(script, /assert\.equal\(networkLedger\.externalWriteAttempts\.length,\s*0/);
  assert.match(script, /assert\.equal\(networkLedger\.continuedExternalRequests\.length,\s*0/);
  assert.match(script, /assert\.equal\(networkLedger\.localWriteAttempts\.length,\s*0/);
  assert.match(script, /assert\.equal\(serverLedger\.rejectedWrites\.length,\s*0/);
});

test("zoom evidence proves real skip-link focus and uses viewport captures", async () => {
  const script = await readRunner();

  assert.match(script, /assertActiveElement\(zoomPage,\s*homeSkipLink/);
  assert.match(script, /homeSkipLink\.evaluate\(\(element\)\s*=>\s*getComputedStyle\(element\)\.visibility/);
  assert.match(script, /assertElementInViewport\(zoomPage,\s*homeSkipLink/);
  assert.match(script, /const waiverSkipLink = zoomPage\.locator\(["']\.skip-link["']\)/);
  assert.match(script, /assert\.equal\(await waiverSkipLink\.getAttribute\(["']href["']\),\s*["']#main["']/);
  assert.match(script, /await waiverSkipLink\.press\(["']Enter["']\)/);
  assert.match(script, /assertActiveElement\(zoomPage,\s*waiverMain/);
  assert.match(script, /--stacked-header-height/);
  assert.match(script, /assertMainClearsStickyHeader\(zoomPage,\s*waiverMain/);
  for (const artifact of [
    "zoom-200-home-tab-focus.png",
    "zoom-200-route-menu-open.png",
    "zoom-200-waiver-main-focus.png",
  ]) {
    assert.match(script, new RegExp(`capture\\(zoomPage,\\s*["']${artifact.replaceAll(".", "\\.")}["'],\\s*screenshotEvidence,\\s*\\{\\s*fullPage:\\s*false\\s*\\}\\)`));
  }
});

test("evidence timestamps the real execution separately from the fixed browser clock", async () => {
  const script = await readRunner();

  assert.match(script, /const executionStartedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(script, /executedAt:\s*executionStartedAt/);
  assert.match(script, /runDate:\s*executionStartedAt\.slice\(0,\s*10\)/);
  assert.match(script, /browserFixtureTime:\s*fixedNow/);
  assert.doesNotMatch(script, /runDate:\s*["']2026-07-14["']/);
});

test("artifact reporting distinguishes preserved evidence from completed cleanup", async () => {
  const script = await readRunner();

  assert.match(script, /let completed = false/);
  assert.match(script, /completed = true/);
  assert.match(script, /if \(completed\)/);
  assert.match(script, /preserveArtifacts\s*\?\s*`Unified shell QA artifacts preserved/);
  assert.match(script, /:\s*["']Unified shell QA artifacts removed after verification["']/);
  assert.equal(
    (script.match(/Unified shell QA artifacts preserved/g) ?? []).length,
    1,
    "preserved output is emitted only by the preserve branch",
  );
});
