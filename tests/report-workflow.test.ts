import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_REVIEW_STATES,
  hunterReportState,
  nextReportStates,
  reportStateCopy,
  reportTransitionRequiresConfirmation,
  reportTransitionRequiresReason,
} from "../src/shared/report-workflow";

test("defines the complete guided and reversible transition graph", () => {
  assert.deepEqual(REPORT_REVIEW_STATES, [
    "received",
    "reviewing",
    "contacted",
    "escalated",
    "verified",
    "rejected",
    "resolved",
  ]);
  assert.deepEqual(nextReportStates("received"), ["reviewing", "rejected"]);
  assert.deepEqual(nextReportStates("reviewing"), ["contacted", "escalated", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("contacted"), ["reviewing", "escalated", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("escalated"), ["reviewing", "contacted", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("verified"), ["reviewing", "resolved"]);
  assert.deepEqual(nextReportStates("resolved"), ["reviewing"]);
  assert.deepEqual(nextReportStates("rejected"), ["reviewing"]);
  assert.deepEqual(nextReportStates("unknown"), []);
});

test("keeps operator explanations separate from hunter-safe states", () => {
  assert.deepEqual(REPORT_REVIEW_STATES.map((state) => hunterReportState(state)), [
    "Received",
    "Under review",
    "Under review",
    "Under review",
    "Verified",
    "Closed",
    "Closed",
  ]);
  assert.equal(
    reportStateCopy("escalated").operatorExplanation,
    "The report needs additional operational or safety attention.",
  );
  assert.equal(reportStateCopy("rejected").operatorLabel, "Rejected");
});

test("requires reasons and confirmations for corrections and terminal decisions", () => {
  assert.equal(reportTransitionRequiresReason("received", "reviewing"), false);
  assert.equal(reportTransitionRequiresReason("reviewing", "contacted"), false);
  assert.equal(reportTransitionRequiresReason("contacted", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("verified", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("resolved", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("reviewing", "rejected"), true);
  assert.equal(reportTransitionRequiresReason("verified", "resolved"), true);
  assert.equal(reportTransitionRequiresConfirmation("contacted", "reviewing"), true);
  assert.equal(reportTransitionRequiresConfirmation("resolved", "reviewing"), true);
  assert.equal(reportTransitionRequiresConfirmation("reviewing", "rejected"), true);
  assert.equal(reportTransitionRequiresConfirmation("verified", "resolved"), true);
  assert.equal(reportTransitionRequiresConfirmation("reviewing", "verified"), false);
});
