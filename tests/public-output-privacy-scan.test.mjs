import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("Dashboard and Ops static assets are public scan surfaces while the Pages worker is not served", async () => {
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
    assert.deepEqual(result.publicSurfaceOutputs.files.sort(), ["assets/app/dashboard.js", "assets/app/ops.js", "dashboard.html", "ops.html"]);
    assert.deepEqual(
      result.publicSurfaceOutputs.privacyFindings.map(({ file }) => file).sort(),
      ["assets/app/dashboard.js", "assets/app/ops.js", "dashboard.html", "ops.html"],
    );
    assert.deepEqual(result.privateBundleOutputs.files, ["_worker.js"]);
    assert.equal(result.privateBundleOutputs.privacyFindings.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("privacy scanner CLI scans served Ops assets, reports safely, and imports without running", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tim-lost-output-cli-test-"));
  const scriptPath = fileURLToPath(new URL("../scripts/qa-output-privacy.mjs", import.meta.url));
  const privateSentinel = "qa-private-credential-sentinel";

  try {
    await mkdir(path.join(root, "assets", "app"), { recursive: true });
    await writeFile(path.join(root, "ops.html"), `<main>${privateSentinel}</main>`, "utf8");
    await writeFile(path.join(root, "assets", "app", "ops.js"), `const leaked = ${JSON.stringify(privateSentinel)};`, "utf8");
    await writeFile(path.join(root, "_worker.js"), `const serverOnly = ${JSON.stringify(privateSentinel)};`, "utf8");

    const failed = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /privacy scan failed/i);
    assert.match(failed.stdout, /ops\.html|assets\/app\/ops\.js/);
    assert.doesNotMatch(`${failed.stdout}\n${failed.stderr}`, new RegExp(privateSentinel));

    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(scriptPath).href)})`],
      { encoding: "utf8" },
    );
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved-report privacy fixtures fail closed while selected public media remains allowed", async () => {
  const { scanBuiltOutputPrivacy } = await import("../scripts/qa-output-privacy.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "tim-lost-report-output-scan-test-"));
  const privateValues = [
    "QA Private Minor Report Child",
    "qa-private-minor-report@example.test",
    "qa-private-child-phone-780-555-0199",
    "hunter-subject-qa-private-minor-001",
    "media-unselected-qa-private-001",
    "private/report-minor-qa-001/original-private.jpg",
  ];
  const selectedMediaId = "media-selected-qa-public-001";

  try {
    await mkdir(path.join(root, "assets", "app"), { recursive: true });
    await writeFile(
      path.join(root, "updates.html"),
      `<main>Young Hunter Waypoint 7 53.548321,-114.468765 ${selectedMediaId}</main>`,
      "utf8",
    );
    await writeFile(
      path.join(root, "assets", "app", "updates.js"),
      `const privateLeak = ${JSON.stringify(privateValues.join("|"))};`,
      "utf8",
    );

    const result = await scanBuiltOutputPrivacy({ distRoot: root, privateFixtureValues: privateValues });
    assert.equal(result.publicSurfaceOutputs.files.includes("updates.html"), true);
    assert.equal(result.publicSurfaceOutputs.files.includes("assets/app/updates.js"), true);
    assert.deepEqual(
      [...new Set(result.publicSurfaceOutputs.privacyFindings.map(({ fixture }) => fixture))].sort(),
      [...privateValues].sort(),
    );
    assert.doesNotMatch(JSON.stringify(result.publicSurfaceOutputs.privacyFindings), new RegExp(selectedMediaId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
