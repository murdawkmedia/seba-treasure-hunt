import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(root, "scripts", "verify-waiver-qa.mjs");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function readRunner() {
  assert.equal(existsSync(runnerPath), true, "the waiver browser QA runner must exist");
  return readFile(runnerPath, "utf8");
}

test("waiver QA has a durable local command and isolated browser server", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const script = await readRunner();

  assert.equal(packageJson.scripts["verify:waiver-qa"], "node scripts/verify-waiver-qa.mjs");
  assert.match(script, /from ["']@playwright\/test["']/);
  assert.match(script, /from ["']axe-core["']/);
  assert.match(script, /createServer/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /listen\(0/);
  assert.match(script, /npm\.cmd/);
  assert.match(script, /build\.mjs/);
  assert.match(script, /const stagingRoot = path\.join\(artifactRoot,\s*["']site-source["']\)/);
  assert.match(script, /cp\(root,\s*stagingRoot/);
  assert.match(script, /symlink\([^]*?["']junction["']/);
  assert.match(script, /replace\(\/\\r\\n\/g,\s*["']\\n["']\)/);
  assert.match(script, /spawnSync\(\s*process\.execPath,\s*\[path\.join\(stagingRoot,\s*["']scripts["'],\s*["']generate-waiver\.mjs["']\)/);
  assert.match(script, /spawnSync\(process\.execPath,\s*\[path\.join\(stagingRoot,\s*["']scripts["'],\s*["']build\.mjs["']\)/);
  assert.match(script, /mkdtemp\(path\.join\(os\.tmpdir\(\),\s*["']tim-lost-waiver-qa-["']\)\)/);
  assert.match(script, /preserveArtifacts/);
  assert.match(script, /finally\s*\{/);
  assert.match(script, /rm\(artifactRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(script, /path\.join\(os\.tmpdir\(\),\s*["']tim-lost-waiver-qa["']\)/);
  assert.match(script, /screenshots/);
  assert.match(script, /qa-log\.json/);
});

test("waiver QA statically covers every required route, viewport, and state", async () => {
  const script = await readRunner();

  for (const route of ["/waiver", "/dashboard", "/ops", "/clue-board", "/report"]) {
    assert.match(script, new RegExp(`(?:path|route):\\s*["']${route}["']`));
  }

  assert.match(script, /width:\s*1440,\s*height:\s*1000/);
  assert.match(script, /width:\s*390,\s*height:\s*844/);
  assert.match(script, /width:\s*720,\s*height:\s*500/);
  assert.match(script, /wcag2a["'],\s*["']wcag2aa["'],\s*["']wcag21a["'],\s*["']wcag21aa/);
  assert.match(script, /emulateMedia\(\{\s*media:\s*["']print["']/);
  assert.match(script, /@media print/);
  assert.match(script, /exact legal display/i);
  assert.match(script, /minor counts 0, 1, and 10/i);
  assert.match(script, /guardian validation and focus/i);
  assert.match(script, /acceptance success and reference/i);
  assert.match(script, /receipt pending, sent, and failed/i);
  assert.match(script, /participant receipt resend/i);
  assert.match(script, /Ops receipt retry/i);
  assert.match(script, /progress and waypoint boundaries/i);
  assert.match(script, /note upload boundary/i);
  assert.match(script, /reply privacy boundary/i);
  assert.match(script, /private find report boundary/i);
  assert.match(script, /report upload boundary/i);
  assert.match(script, /horizontal overflow/i);
  assert.match(script, /console errors/i);
  assert.match(script, /data-waiver-legal-body/);
  assert.match(script, /data-guardian-confirmation/);
  assert.match(script, /data-waiver-result/);
  assert.match(script, /data-waiver-receipt-status/);
  assert.match(script, /data-resend-waiver-receipt/);
  assert.match(script, /data-retry-waiver-receipt/);
  assert.match(script, /data-add-minor/);
  assert.match(script, /data-waiver-submit/);
  assert.match(script, /data-view=["']subscribers["']/);
  assert.match(script, /data-waiver-detail/);
});

test("waiver QA exercises built clients and mocks only auth, APIs, and providers", async () => {
  const script = await readRunner();

  assert.doesNotMatch(script, /installDashboardFixture|installOpsFixture/);
  assert.doesNotMatch(script, /window\.__waiverQa/);
  assert.match(script, /assets\/app\/dashboard\.js/);
  assert.match(script, /assets\/app\/ops\.js/);
  assert.match(script, /fake Clerk module/i);
  assert.match(script, /turnstile provider mock/i);
  assert.match(script, /data-waiver-review-link/);
  assert.match(script, /data-add-minor/);
  assert.match(script, /data-waiver-submit/);
  assert.match(script, /data-view=["']subscribers["']/);
  assert.match(script, /data-waiver-detail/);
  assert.match(script, /data-retry-waiver-receipt/);
});

test("waiver QA installs a zero-external-write boundary before every page", async () => {
  const script = await readRunner();
  const allowedMatch = script.match(/const allowedWritePaths = new Set\(\[([^]*?)\]\);/);

  assert.ok(allowedMatch, "runner must declare its exact local mocked-write allowlist");
  const actualAllowedWrites = [...allowedMatch[1].matchAll(/["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(actualAllowedWrites, [
    "/api/v1/me/bootstrap",
    "/api/v1/me/waiver/accept",
    "/api/v1/me/waiver/receipt",
    "/api/v1/me/waiver/review",
    "/api/v1/ops/players/hunter-1/waiver/receipt",
  ]);

  assert.match(script, /installNetworkGuard\(context/);
  assert.match(script, /await installNetworkGuard\(context[^]*?await context\.newPage\(\)/);
  assert.match(script, /method === ["']GET["'] \|\| method === ["']HEAD["']/);
  assert.match(script, /url\.origin === localOrigin/);
  assert.match(script, /allowedWritePaths\.has\(url\.pathname\)/);
  assert.match(script, /mockedWrites\.set/);
  assert.match(script, /identityBootstrapPath/);
  assert.match(script, /identityBootstrapWrites/);
  assert.match(script, /observedRequests/);
  assert.match(script, /disposition/);
  assert.match(script, /continuedExternalRequests/);
  assert.match(script, /externalWritesObserved/);
  assert.doesNotMatch(script, /externalRequestsReached/);
  assert.match(script, /route\.abort\(["']blockedbyclient["']\)/);
  assert.match(script, /Blocked non-allowlisted write/);
  assert.match(script, /zero external writes/i);
  assert.match(script, /assert\.equal\(networkLedger\.continuedExternalRequests\.length,\s*0/);
  assert.match(script, /assert\.equal\(networkLedger\.externalWritesObserved\.length,\s*0/);

  for (const forbiddenTarget of [
    "clerk",
    "api.resend.com",
    "cloudflare",
    "codex-validation.seba-treasure-hunt.pages.dev",
    "www.timlostsomething.com",
  ]) {
    assert.match(script.toLowerCase(), new RegExp(forbiddenTarget.replaceAll(".", "\\.")));
  }
});

test("waiver QA scans private fixture values across source and served public output", async () => {
  const script = await readRunner();

  for (const privateFixture of [
    "qa-private-hunter@example.test",
    "QA Private Minor 01",
    "2014",
    "waiver-acceptance-qa-private-001",
    "receipt-job-qa-private-001",
    "resend-provider-qa-private-001",
    "sk_test_qa_private_credential",
    "53.123456,-114.654321",
    "qa-private-note-evidence",
    "qa-private-report-evidence",
  ]) {
    assert.match(script, new RegExp(privateFixture.replaceAll(".", "\\.")));
  }

  assert.match(script, /production source privacy scan/i);
  assert.match(script, /rendered public output privacy scan/i);
  assert.match(script, /server\/Ops bundle privacy classification/i);
  assert.match(script, /publicSurfaceOutputs/);
  assert.match(script, /privateBundleOutputs/);
  assert.match(script, /privacyFindings/);
});
