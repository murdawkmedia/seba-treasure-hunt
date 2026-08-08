import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Waiver 2026.3 permits only explicitly authorized shallow hand digging", async () => {
  const waiver = JSON.parse(await readFile(new URL("../legal/participation-waiver-2026.3.json", import.meta.url), "utf8"));
  assert.equal(waiver.version, "2026.3");
  const text = JSON.stringify(waiver);
  for (const required of [
    "only when the current clue or current area instructions explicitly permit it",
    "12 inches (300 millimetres)",
    "hand trowel",
    "refill and smooth",
    "buried utilities",
    "directly supervise"
  ]) assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(text, /full-size shovels, powered tools, machinery or excavation equipment/i);
});
