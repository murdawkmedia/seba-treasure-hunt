import assert from "node:assert/strict";
import test from "node:test";

import { cyclePhotoIndex, swipePhotoDelta } from "../src/client/route-lightbox";

test("cycles waypoint photo indexes within the available photos", () => {
  assert.equal(cyclePhotoIndex(0, -1, 3), 2);
  assert.equal(cyclePhotoIndex(2, 1, 3), 0);
  assert.equal(cyclePhotoIndex(1, 1, 3), 2);
  assert.equal(cyclePhotoIndex(0, 1, 1), 0);
});

test("maps horizontal swipes to waypoint photo deltas", () => {
  assert.equal(swipePhotoDelta(180, 80), 1);
  assert.equal(swipePhotoDelta(80, 180), -1);
  assert.equal(swipePhotoDelta(100, 130), 0);
  assert.equal(swipePhotoDelta(null, 100), 0);
});
