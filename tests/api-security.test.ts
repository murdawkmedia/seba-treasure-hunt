import assert from "node:assert/strict";
import test from "node:test";
import { featureSwitches } from "../src/server/d1-store";

test("missing D1 feature rows fail closed instead of enabling community writes", () => {
  assert.deepEqual(featureSwitches([]), {
    boardVisible: false,
    notesEnabled: false,
    repliesEnabled: false
  });
});

test("only explicit enabled values open a community feature", () => {
  assert.deepEqual(
    featureSwitches([
      { key: "board_visible", enabled: 1 },
      { key: "notes_enabled", enabled: 0 },
      { key: "replies_enabled", enabled: 1 }
    ]),
    { boardVisible: true, notesEnabled: false, repliesEnabled: true }
  );
});
