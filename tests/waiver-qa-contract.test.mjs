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
  assert.match(script, /stagePathAllowed/);
  assert.ok(script.includes("/^\\.env"));
  assert.ok(script.includes("/^\\.dev\\.vars"));
  assert.ok(script.includes("npmrc"));
  for (const forbiddenDirectory of [".wrangler", ".superpowers", ".ssh"]) assert.ok(script.includes(`"${forbiddenDirectory}"`));
  assert.match(script, /assertStagingTreeCredentialFree/);
  assert.match(script, /symlink\([^]*?["']junction["']/);
  assert.match(script, /replace\(\/\\r\\n\/g,\s*["']\\n["']\)/);
  assert.match(script, /spawnSync\(\s*process\.execPath,\s*\[path\.join\(stagingRoot,\s*["']scripts["'],\s*["']generate-waiver\.mjs["']\)/);
  assert.match(script, /spawnSync\(process\.execPath,\s*\[path\.join\(stagingRoot,\s*["']scripts["'],\s*["']build\.mjs["']\)/);
  assert.match(script, /mkdtemp\(path\.join\(os\.tmpdir\(\),\s*["']tim-lost-waiver-qa-["']\)\)/);
  assert.match(script, /preserveArtifacts/);
  assert.match(script, /WAIVER_QA_PRESERVE_ARTIFACTS\s*===?\s*["']1["']/);
  assert.match(script, /preservedArtifactAllowlist\s*=\s*new Set\(\[[^]*?["']qa-log\.json["'][^]*?["']screenshots["']/);
  assert.match(script, /finally\s*\{/);
  assert.match(script, /rm\(artifactRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  assert.match(script, /rm\(stagingRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  assert.match(script, /assertPreservedArtifactAllowlist/);
  assert.doesNotMatch(script, /path\.join\(os\.tmpdir\(\),\s*["']tim-lost-waiver-qa["']\)/);
  assert.match(script, /screenshots/);
  assert.match(script, /qa-log\.json/);
});

test("waiver QA opens registration through the production account control", async () => {
  const script = await readRunner();
  const dashboardClient = await read("src/client/dashboard.ts");

  assert.match(script, /\[data-show-auth=["']hunter-sign-up-form["']\]/);
  assert.match(script, /createAccountControl\.click\(\)/);
  assert.match(script, /signIn\.isHidden\(\)/);
  assert.match(script, /document\.activeElement/);
  assert.doesNotMatch(script, /signup\.evaluate\([^]*?form\.hidden\s*=\s*false/);
  assert.doesNotMatch(script, /signedOutRegion\.hidden\s*=\s*false/);
  assert.match(dashboardClient, /showAuthForm\([^]*?querySelector<HTMLElement>\([^]*?\.focus\(\)/);
});

test("waiver QA statically covers every required route, viewport, and state", async () => {
  const script = await readRunner();

  for (const route of ["/waiver", "/dashboard", "/ops", "/clue-board", "/report", "/route", "/updates"]) {
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
  assert.match(script, /minor signup and guardian permission/i);
  assert.match(script, /signed-in report prefill/i);
  assert.match(script, /thirteen waypoints plus two fallback choices/i);
  assert.match(script, /thirteen authenticated exact links/i);
  assert.match(script, /thirteen public route stories/i);
  assert.match(script, /61 public-safe photos/i);
  assert.match(script, /explicit report receipt/i);
  assert.match(script, /Staff report detail/i);
  assert.match(script, /one selected image and one private image/i);
  assert.match(script, /explicit publish confirmation/i);
  assert.match(script, /public signed-out approved report/i);
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
  assert.match(script, /data-report-review-dialog/);
  assert.match(script, /data-report-publication-form/);
  assert.match(script, /data-updates-list/);
  assert.match(script, /prepareEmailAddressVerification/);
  assert.match(script, /attemptEmailAddressVerification/);
  assert.match(script, /qa-minor-verification-code/);
  assert.match(script, /minor_guardian_permission/);
  assert.match(script, /guardianPermissionAttestedAt/);
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

test("signup legal QA covers success controls and deterministic failure recovery", async () => {
  const dashboard = await read("dashboard.html");
  const client = await read("src/client/dashboard.ts");
  const runner = await readRunner();

  assert.equal((dashboard.match(/data-signup-dialog-close/g) ?? []).length, 4);
  assert.equal((dashboard.match(/Done &mdash; back to account setup/g) ?? []).length, 2);
  assert.equal((dashboard.match(/data-signup-dialog-status/g) ?? []).length, 2);
  assert.equal((dashboard.match(/data-signup-dialog-fallback/g) ?? []).length, 2);
  assert.match(client, /tim-lost:legal-embed-ready/);
  assert.match(client, /event\.origin\s*!==\s*window\.location\.origin/);
  assert.match(client, /The embedded legal document could not be displayed/);
  assert.match(runner, /signup-legal-dialog__header["']\)\.getByRole\(["']button["'],\s*\{\s*name:\s*["']Close Privacy Policy and Media Notice["']/);
  assert.match(runner, /signup-legal-dialog__footer["']\)\.getByRole\(["']button["'],\s*\{\s*name:\s*["']Done — back to account setup["']/);
  assert.match(runner, /keyboard\.press\(["']Escape["']\)/);
  assert.match(runner, /data-signup-dialog-status/);
  assert.match(runner, /data-signup-dialog-fallback/);
  assert.match(runner, /document\.activeElement/);
  assert.match(runner, /privacyAcceptance\s*=\s*signup\.locator\(["']\[name=[^\]]*privacyMediaAccepted[^\]]*\]["']\)/);
  assert.match(runner, /waiverAcceptance\s*=\s*signup\.locator\(["']\[name=[^\]]*waiverAccepted[^\]]*\]["']\)/);
  assert.match(runner, /privacyAcceptance\.isChecked\(\)/);
  assert.match(runner, /waiverAcceptance\.isChecked\(\)/);
  assert.doesNotMatch(runner, /locator\(["']\[data-signup-dialog-close\]["']\)\.click\(\)/);
  assert.match(runner, /async function exerciseSignupLegalFailureRecovery\(/);
  assert.match(runner, /page\.clock\.install\(\)/);
  assert.match(runner, /page\.clock\.fastForward\(12_000\)/);
  assert.match(runner, /embedded legal document could not be displayed/i);
  assert.match(runner, /failureViewer\.isHidden\(\)/);
  assert.match(runner, /failureViewer\.getAttribute\(["']src["']\)/);
  assert.match(runner, /failureAcceptance\.isEnabled\(\)/);
  assert.match(runner, /failureAcceptance\.isChecked\(\)/);
  assert.match(runner, /failureReview[^;]*document\.activeElement/);
});

test("waiver QA covers resumable mobile signup and returning sign-in journeys", async () => {
  const script = await readRunner();

  for (const scenario of [
    "iPhone signup and returning sign-in",
    "verification reload and email-app return",
    "resend code and change email",
    "delayed provisioning and manual retry",
    "valid session with incomplete profile",
    "shared account header synchronization",
  ]) assert.match(script, new RegExp(scenario, "i"));

  assert.match(script, /name:\s*["']iphone["'],\s*width:\s*390,\s*height:\s*844/);
  assert.match(script, /async function exerciseResumableMobileSignup\(/);
  assert.match(script, /page\.reload\(/);
  assert.match(script, /data-signup-resend/);
  assert.match(script, /data-signup-restart/);
  assert.match(script, /changed-hunter@different\.test/);
  assert.match(script, /assertEmbeddedLegalIsolation\([^;]*privacy/i);
  assert.match(script, /assertEmbeddedLegalIsolation\([^;]*waiver/i);
  assert.match(script, /keyboardTabTo\(/);
  assert.match(script, /keyboardTypeInto\(/);
  assert.match(script, /assertSignupRecoveryCleared\(/);
  assert.match(script, /async function exerciseDelayedProvisioningRecovery\(/);
  assert.match(script, /data-signup-finishing-retry/);
  assert.match(script, /async function exerciseReturningSignInAndHeader\(/);
  assert.match(script, /data-campaign-account-handle/);
});

test("waiver QA audits mobile accessibility and storage privacy without external writes", async () => {
  const script = await readRunner();

  for (const scenario of [
    "keyboard-only signup",
    "screen-reader names and live statuses",
    "200 percent zoom signup",
    "reduced motion signup",
    "44 pixel signup targets",
    "mobile signup horizontal overflow",
    "unsafe signup storage privacy",
  ]) assert.match(script, new RegExp(scenario, "i"));

  assert.match(script, /async function assertMinimumTargetSize\(/);
  assert.match(script, /async function assertVisibleFocus\(/);
  assert.match(script, /unfocused/);
  assert.match(script, /focused/);
  assert.match(script, /assertReducedMotionApplied\(/);
  assert.match(script, /emulateMedia\(\{\s*reducedMotion:\s*["']reduce["']/);
  assert.match(script, /legal dialog controls/i);
  assert.match(script, /verification controls/i);
  assert.match(script, /const storageSnapshot\s*=\s*await page\.evaluate/);
  assert.match(script, /localStorage/);
  assert.match(script, /sessionStorage/);
  assert.match(script, /password|verification code|session token/i);
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
    "/api/v1/me/profile",
    "/api/v1/me/waiver/accept",
    "/api/v1/me/waiver/receipt",
    "/api/v1/me/waiver/review",
    "/api/v1/ops/players/hunter-1/waiver/receipt",
    "/api/v1/ops/reports/report-minor-qa-001/publish",
    "/api/v1/reports",
  ]);

  assert.match(script, /installNetworkGuard\(context/);
  assert.match(script, /await installNetworkGuard\(context[^]*?await context\.newPage\(\)/);
  assert.match(script, /method === ["']GET["'] \|\| method === ["']HEAD["']/);
  assert.match(script, /url\.origin === localOrigin/);
  assert.match(script, /allowedWritePaths\.has\(url\.pathname\)/);
  assert.match(script, /allowedWriteMethod\(method,\s*url\.pathname\)/);
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
    "qa-private-credential-sentinel",
    "53.123456,-114.654321",
    "qa-private-note-evidence",
    "qa-private-report-evidence",
    "qa-private-child-phone-780-555-0199",
    "hunter-subject-qa-private-minor-001",
    "media-unselected-qa-private-001",
    "private/report-minor-qa-001/original-private.jpg",
  ]) {
    assert.match(script, new RegExp(privateFixture.replaceAll(".", "\\.")));
  }

  assert.match(script, /production source privacy scan/i);
  assert.match(script, /rendered public output privacy scan/i);
  assert.match(script, /server\/Ops bundle privacy classification/i);
  assert.match(script, /publicSurfaceOutputs/);
  assert.match(script, /privateBundleOutputs/);
  assert.match(script, /privacyFindings/);
  assert.match(script, /participation-waiver-2026\.2\.json/);
  assert.match(script, /privacyMediaVersion:\s*["']2026\.3["']/);
  assert.match(script, /assert\.equal\([^]*?15[^]*?thirteen waypoints plus two fallback choices/i);
  assert.match(script, /const expectedReportOptions = \[/);
  assert.match(script, /value:\s*["']not_sure["']/);
  assert.match(script, /value:\s*["']different_location["']/);
  const stableIdsInPublicOrder = [1, 2, 3, 4, 13, 5, 6, 7, 8, 9, 10, 11, 12];
  for (const [index, id] of stableIdsInPublicOrder.entries()) {
    assert.match(script, new RegExp(`routeOrder:\\s*${index + 1},\\s*id:\\s*${id}(?:,|\\s)`));
  }
  assert.match(script, /routeOrder:\s*5,\s*id:\s*13,\s*name:\s*["']Derby's Lakeview General Store/);
  assert.match(script, /assert\.equal\([^]*?exactWaypointLinks\.count\(\)[^]*?13[^]*?thirteen authenticated exact links/i);
  assert.match(script, /assert\.equal\([^]*?routeStories\.count\(\)[^]*?13[^]*?thirteen public route stories/i);
  assert.match(script, /assert\.equal\([^]*?routePhotos\.count\(\)[^]*?61[^]*?61 public-safe photos/i);
  assert.match(script, /Young Hunter/);
  assert.match(script, /media-selected-qa-public-001/);
  assert.match(script, /waypointRouteOrder:\s*reportWaypoint\.routeOrder/);
  assert.match(script, /waypointName:\s*reportWaypoint\.name/);
  assert.match(script, /Waypoint 8 — The Lodge Trails/);
});

test("waiver QA compares protected route links without value-bearing assertions", async () => {
  const script = await readRunner();

  assert.doesNotMatch(
    script,
    /assert\.(?:equal|deepEqual)\([^;]*(?:getAttribute\(["']href["']\)|actualHref|waypoint\.exactUrl)[^;]*\);/,
    "an AssertionError must never serialize a protected expected or actual URL",
  );
  assert.match(script, /Protected route link mismatch at route order/);
});

test("waiver QA runs a real signed-out route privacy journey before the signed-in link journey", async () => {
  const script = await readRunner();

  assert.match(script, /async function exerciseSignedOutRoute\(/);
  assert.match(script, /signedOutRouteState\s*=\s*\{[^}]*mode:\s*["']route["'][^}]*signedOut:\s*true/);
  assert.match(script, /createQaPage\([^;]*signedOutRouteState[^;]*\)/);
  assert.match(script, /goto\([^;]*["']\/route["']\)/);
  assert.match(script, /data-route-signed-out/);
  assert.match(script, /exactWaypointLinks\.count\(\),\s*0/);
  assert.match(script, /page\.locator\(["']\[href\]["']\)\.evaluateAll\(/);
  assert.match(script, /getAttribute\(["']href["']\)/);
  assert.match(script, /publicWaypointFixtures[^]*hrefValues\.some\([^]*href\s*===\s*waypoint\.exactUrl/);
  assert.doesNotMatch(
    script,
    /(?:routeHtml|page\.content\(\))[^;]*\.includes\(waypoint\.exactUrl\)/,
    "serialized HTML must not be used to prove exact protected href privacy",
  );
  assert.match(script, /await exerciseSignedOutRoute\([^]*await exerciseRoute\(/);
});

test("waiver QA treats Dashboard static artifacts as public while Ops and Worker remain private", async () => {
  const script = await readRunner();

  assert.match(script, /scanBuiltOutputPrivacy/);
  assert.doesNotMatch(script, /!file\.endsWith\(["']dashboard\.html["']\)/);
  assert.doesNotMatch(script, /!file\.endsWith\(`\$\{path\.sep\}dashboard\.js`\)/);
  assert.match(script, /publicSurfaceOutputs/);
  assert.match(script, /privateBundleOutputs/);
});
