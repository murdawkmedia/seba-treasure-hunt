import assert from "node:assert/strict";
import test from "node:test";
import { officialUpdateGuidance } from "../src/shared/official-update-workflow";

test("guides an empty standalone composer to a private draft", () => {
  const state = officialUpdateGuidance({
    hasDraft: false,
    status: null,
    sourceReportStatus: null,
    selectedCount: 0,
    processingSelectedCount: 0,
    confirmed: false,
  });

  assert.equal(state.stage, "write");
  assert.equal(state.primaryAction, "save_draft");
  assert.match(state.uploadBlocker ?? "", /saved private draft/i);
});

test("locks a report Update until its source report is verified", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: "reviewing",
    selectedCount: 1,
    processingSelectedCount: 0,
    confirmed: true,
  });

  assert.equal(state.stage, "verification");
  assert.equal(state.primaryAction, "go_to_review");
  assert.match(state.publishBlocker ?? "", /verified/i);
});

test("blocks publication while a selected image is processing", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: "verified",
    selectedCount: 2,
    processingSelectedCount: 1,
    confirmed: true,
  });

  assert.equal(state.stage, "processing");
  assert.equal(state.primaryAction, "wait_for_media");
  assert.match(state.publishBlocker ?? "", /finish processing/i);
});

test("requires confirmation of the exact public preview", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: null,
    selectedCount: 0,
    processingSelectedCount: 0,
    confirmed: false,
  });

  assert.equal(state.stage, "preview");
  assert.equal(state.primaryAction, "review_preview");
  assert.match(state.scheduleBlocker ?? "", /confirm/i);
});

test("allows an exact confirmed preview to publish without requiring images", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: "verified",
    selectedCount: 0,
    processingSelectedCount: 0,
    confirmed: true,
  });

  assert.equal(state.stage, "ready");
  assert.equal(state.primaryAction, "publish_now");
  assert.equal(state.publishBlocker, null);
  assert.equal(state.selectedLabel, "0 of 3 images selected");
});

test("describes scheduled and published Updates without offering draft actions", () => {
  const scheduled = officialUpdateGuidance({
    hasDraft: true,
    status: "scheduled",
    sourceReportStatus: null,
    selectedCount: 1,
    processingSelectedCount: 0,
    confirmed: true,
  });
  const published = officialUpdateGuidance({
    hasDraft: true,
    status: "published",
    sourceReportStatus: null,
    selectedCount: 1,
    processingSelectedCount: 0,
    confirmed: true,
  });
  const withdrawn = officialUpdateGuidance({
    hasDraft: true,
    status: "withdrawn",
    sourceReportStatus: null,
    selectedCount: 1,
    processingSelectedCount: 0,
    confirmed: true,
  });

  assert.equal(scheduled.primaryAction, "open_scheduled");
  assert.match(scheduled.explanation, /remains private/i);
  assert.equal(published.primaryAction, "open_published");
  assert.match(published.explanation, /public/i);
  assert.equal(withdrawn.stage, "withdrawn");
  assert.equal(withdrawn.primaryAction, "open_withdrawn");
  assert.match(withdrawn.explanation, /audit history/i);
});
