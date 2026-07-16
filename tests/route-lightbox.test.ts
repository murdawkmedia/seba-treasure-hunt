import assert from "node:assert/strict";
import test from "node:test";

import { cyclePhotoIndex, swipePhotoDelta } from "../src/client/route-lightbox";

test("cycles waypoint photo indexes within the available photos", () => {
  assert.equal(cyclePhotoIndex(0, -1, 3), 2);
  assert.equal(cyclePhotoIndex(2, 1, 3), 0);
  assert.equal(cyclePhotoIndex(1, 1, 3), 2);
  assert.equal(cyclePhotoIndex(0, 1, 1), 0);
});

test("resets the photo index for invalid viewer state", () => {
  assert.equal(cyclePhotoIndex(1, 1, 0), 0);
  assert.equal(cyclePhotoIndex(1, 1, -1), 0);
  assert.equal(cyclePhotoIndex(1, 1, 2.5), 0);
  assert.equal(cyclePhotoIndex(1.5, 1, 3), 0);
});

test("maps horizontal swipes to waypoint photo deltas", () => {
  assert.equal(swipePhotoDelta(180, 80), 1);
  assert.equal(swipePhotoDelta(80, 180), -1);
  assert.equal(swipePhotoDelta(100, 130), 0);
  assert.equal(swipePhotoDelta(null, 100), 0);
});

test("rejects non-finite swipe endpoints", () => {
  assert.equal(swipePhotoDelta(100, Number.NaN), 0);
  assert.equal(swipePhotoDelta(100, Number.POSITIVE_INFINITY), 0);
});

test("accepts swipes at the exact threshold", () => {
  assert.equal(swipePhotoDelta(100, 52), 1);
  assert.equal(swipePhotoDelta(100, 148), -1);
});

test("uses a custom swipe threshold", () => {
  assert.equal(swipePhotoDelta(100, 130, 24), -1);
});
