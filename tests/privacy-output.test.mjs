import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("public output privacy scan catches board identity, moderation and object-key leaks", async () => {
  const { scanBuiltOutputPrivacy } = await import("../scripts/qa-output-privacy.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "tim-lost-board-privacy-scan-"));
  const privateValues = [
    "profile-subject-private-001",
    "verified-private@example.test",
    "Minor Custom Source Name",
    "Minor Generated Source Handle",
    "Private moderator reason",
    "flag-reporter-subject-private-001",
    "privateObjectKey",
    "private/board-asset/original.jpg",
  ];

  try {
    await mkdir(path.join(root, "assets", "app"), { recursive: true });
    await writeFile(path.join(root, "clue-board.html"), "<main>Young Hunter</main>", "utf8");
    await writeFile(
      path.join(root, "assets", "app", "board.js"),
      `const boardPayload = ${JSON.stringify(privateValues.join("|"))};`,
      "utf8",
    );
    await writeFile(path.join(root, "ops.html"), `<main>${privateValues.join("|")}</main>`, "utf8");

    const result = await scanBuiltOutputPrivacy({ distRoot: root, privateFixtureValues: privateValues });
    assert.deepEqual(
      [...new Set(result.publicSurfaceOutputs.privacyFindings.map(({ fixture }) => fixture))].sort(),
      [...privateValues].sort(),
    );
    assert.equal(result.publicSurfaceOutputs.files.includes("ops.html"), true);
    assert.equal(result.publicSurfaceOutputs.privacyFindings.filter(({ file }) => file === "ops.html").length, privateValues.length);
    assert.equal(result.privateBundleOutputs.privacyFindings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mobile onboarding QA fails if secrets or private profile values enter browser storage", async () => {
  const runner = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../scripts/verify-waiver-qa.mjs", import.meta.url),
    "utf8",
  ));

  assert.match(runner, /unsafe signup storage privacy/i);
  assert.match(runner, /const storageSnapshot\s*=\s*await page\.evaluate/);
  assert.match(runner, /Object\.entries\(localStorage\)/);
  assert.match(runner, /Object\.entries\(sessionStorage\)/);
  assert.match(runner, /QA-guardian-password-2026/);
  assert.match(runner, /qa-minor-verification-code/);
  assert.match(runner, /qa-local-auth-token/);
  assert.match(runner, /privateProfileStorageSentinels/);
  assert.match(runner, /privacyMediaAccepted/);
  assert.match(runner, /waiverAccepted/);
  assert.match(runner, /assertUnsafeStorageFree/);
});
