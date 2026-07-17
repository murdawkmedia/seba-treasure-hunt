import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  REPORT_IMAGE_SOURCE_BYTES,
  REPORT_IMAGE_TOTAL_BYTES,
  reportImageMegabytes,
} from "../src/shared/report-image-limits";

test("report image limits use decimal MB", () => {
  assert.equal(REPORT_IMAGE_DIRECT_BYTES, 20_000_000);
  assert.equal(REPORT_IMAGE_SOURCE_BYTES, 50_000_000);
  assert.equal(REPORT_IMAGE_TOTAL_BYTES, 30_000_000);
  assert.equal(REPORT_IMAGE_MAX_COUNT, 3);
  assert.equal(reportImageMegabytes(27_400_000), "27.4 MB");
  assert.equal(reportImageMegabytes(20_000_000), "20 MB");
});
