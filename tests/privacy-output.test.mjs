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
    assert.equal(result.privateBundleOutputs.privacyFindings.length, privateValues.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
