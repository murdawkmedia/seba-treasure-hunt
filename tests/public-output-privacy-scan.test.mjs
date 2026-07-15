import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Dashboard static HTML and client bundle are public scan surfaces and fixture leaks fail closed", async () => {
  const { scanBuiltOutputPrivacy } = await import("../scripts/qa-output-privacy.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "tim-lost-output-scan-test-"));
  const fixture = "qa-private-dashboard-leak";

  try {
    await mkdir(path.join(root, "assets", "app"), { recursive: true });
    await writeFile(path.join(root, "dashboard.html"), `<main>${fixture}</main>`, "utf8");
    await writeFile(path.join(root, "assets", "app", "dashboard.js"), `const leaked = ${JSON.stringify(fixture)};`, "utf8");
    await writeFile(path.join(root, "ops.html"), `<main>${fixture}</main>`, "utf8");
    await writeFile(path.join(root, "assets", "app", "ops.js"), `const privateOps = ${JSON.stringify(fixture)};`, "utf8");
    await writeFile(path.join(root, "_worker.js"), `const privateWorker = ${JSON.stringify(fixture)};`, "utf8");

    const result = await scanBuiltOutputPrivacy({ distRoot: root, privateFixtureValues: [fixture] });
    assert.deepEqual(result.publicSurfaceOutputs.files.sort(), ["assets/app/dashboard.js", "dashboard.html"]);
    assert.deepEqual(
      result.publicSurfaceOutputs.privacyFindings.map(({ file }) => file).sort(),
      ["assets/app/dashboard.js", "dashboard.html"],
    );
    assert.deepEqual(result.privateBundleOutputs.files.sort(), ["_worker.js", "assets/app/ops.js", "ops.html"]);
    assert.equal(result.privateBundleOutputs.privacyFindings.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
