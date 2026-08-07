import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  findPrivateClueLeak,
  paidClueInsertSql,
  reconcileExistingClues,
  requireEnvironmentSentinel,
  validatePrivateClueSeed,
  wranglerNodeInvocation,
} from "../scripts/paid-clue-import.mjs";

const seed = Array.from({ length: 30 }, (_, index) => ({
  id: `clue-${String(index + 1).padStart(2, "0")}`, sequence: index + 1,
  title: `Safe private clue title ${index + 1}`, riddle: `Safe private riddle text ${index + 1}`,
  decoderExplanation: `Safe private decoder explanation ${index + 1}`,
  narrowingSummary: `Safe private narrowing summary ${index + 1}`,
  internalNapkinNote: `Safe private note ${index + 1}`, internalScore: 50,
  state: index === 0 ? "released" : "draft", decoderMode: "paid",
}));

test("private clue seed requires one released clue and 29 drafts", () => {
  assert.equal(validatePrivateClueSeed(seed).length, 30);
  assert.throws(() => validatePrivateClueSeed(seed.map((row) => row.sequence === 2 ? { ...row, state: "released" } : row)), /Only Clue 01/);
});

test("insert SQL records the release timestamp and append-only seed events", () => {
  const output = paidClueInsertSql([seed[0], seed[1]], "2026-08-07T12:00:00.000Z");
  assert.match(output, /INSERT INTO clues/);
  assert.match(output, /seed-clue-01-v1/);
  assert.match(output, /controller-private-import/);
  assert.match(output, /'released', 'paid', 1, '2026-08-07T12:00:00.000Z'/);
  assert.match(output, /'draft', 'paid', 1, NULL, NULL/);
});

test("reconciliation imports only missing canonical records and rejects conflicts", () => {
  const missing = reconcileExistingClues(seed, [{ id: "clue-01", sequence: 1, state: "released", version: 2 }]);
  assert.equal(missing.length, 29);
  assert.equal(missing[0].id, "clue-02");
  assert.throws(() => reconcileExistingClues(seed, [{ id: "other", sequence: 1, version: 1 }]), /conflicts/);
  const exact = { ...seed[0], version: 1 };
  assert.equal(reconcileExistingClues(seed, [exact]).length, 29);
  assert.throws(
    () => reconcileExistingClues(seed, [{ ...exact, decoderExplanation: "Wrong untouched decoder" }]),
    /untouched seed content.*sequence 1/i,
  );
});

test("privacy scan identifies a sealed clue leak without printing its contents", () => {
  assert.deepEqual(findPrivateClueLeak(seed, [{ path: "dist/assets/app/clues.js", contents: seed[1].riddle }]), {
    sequence: 2, field: "riddle", file: "dist/assets/app/clues.js",
  });
  assert.equal(findPrivateClueLeak(seed, [{ path: "dist/clues.html", contents: "Clue 02 - Sealed" }]), null);
  assert.deepEqual(findPrivateClueLeak(seed, [{ path: "dist/assets/app/clues.js", contents: seed[0].decoderExplanation }]), {
    sequence: 1, field: "decoderExplanation", file: "dist/assets/app/clues.js",
  });
  assert.equal(findPrivateClueLeak(seed, [{ path: "dist/clues.html", contents: seed[0].riddle }]), null);
  const knownPublicTitleSeed = seed.map((row) => row.sequence === 2 ? { ...row, title: "Already published stop name" } : row);
  assert.equal(findPrivateClueLeak(
    knownPublicTitleSeed,
    [{ path: "dist/route.html", contents: "Already published stop name" }],
    { knownPublicFacts: "The route has an Already published stop name on it." },
  ), null);
  const privateDecoderSeed = seed.map((row) => row.sequence === 1 ? { ...row, decoderExplanation: "Already published stop name" } : row);
  assert.equal(findPrivateClueLeak(
    privateDecoderSeed,
    [{ path: "dist/route.html", contents: "Already published stop name" }],
    { knownPublicFacts: "The route has an Already published stop name on it." },
  )?.field, "decoderExplanation");
});

test("the importer uses a platform-safe Node Wrangler invocation and verifies the D1 sentinel", () => {
  const invocation = wranglerNodeInvocation("C:/project", ["d1", "execute", "DB"]);
  assert.equal(invocation.file, process.execPath);
  assert.match(invocation.args[0], /node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
  assert.deepEqual(requireEnvironmentSentinel("validation", [{ environment: "validation" }]), { environment: "validation" });
  assert.throws(() => requireEnvironmentSentinel("validation", [{ environment: "production" }]), /sentinel.*validation/i);
  assert.throws(() => requireEnvironmentSentinel("production", []), /sentinel.*production/i);
});

test("the controller requires a public-build and tracked-source scan before any write", async () => {
  const script = await readFile(path.resolve(import.meta.dirname, "../scripts/import-paid-clues.ts"), "utf8");
  assert.match(script, /apply && !scanDist/);
  assert.match(script, /git["'], \[["']ls-files["'], ["']-z["']\]/);
  assert.match(script, /Any production access requires both/);
  assert.match(script, /requireEnvironmentSentinel/);
});
