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

test("sponsor QA treats both public sponsor URLs as withdrawn while retaining private Ops protection", async () => {
  const script = await readRunner();

  assert.match(script, /for \(const pathname of \["\/sponsors", "\/sponsors\.html"\]\)/);
  assert.match(script, /assert\.equal\(response\.status, 404/);
  assert.match(script, /fetch\(routeUrl\("\/api\/v1\/ops\/sponsors"\)/);
  assert.match(script, /assert\.equal\(ops\.status, 401/);
  assert.match(script, /staff_auth_required/);
  assert.match(script, /Object\.hasOwn\(opsBody, "data"\), false/);
});

test("sponsor QA verifies public build withdrawal without weakening private-output privacy scans", async () => {
  const script = await readRunner();

  assert.match(script, /sponsors\.html/);
  assert.match(script, /css", "sponsors\.css/);
  assert.match(script, /assets", "app", "sponsors\.js/);
  assert.match(script, /sponsor-submission\.js/);
  assert.match(script, /const broadPattern = \/sponsor_inquiries\|sponsor_inquiry_events\|private note\|@sebahub\\\.com\|@businessasaforceforgood\\\.ca\|CFCW\/i/);
  assert.match(script, /const correctedPattern = \/sponsor_inquiries\|sponsor_inquiry_events\|private note\|CFCW\/i/);
  assert.match(script, /dist\/assets\/app\/ops\.js/);
});
