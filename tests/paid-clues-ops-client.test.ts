import assert from "node:assert/strict";
import test from "node:test";

import {
  clueWorkflowGuidance,
  normalizeOpsClueOrders,
  normalizeOpsClues,
  normalizeZones,
  renderOrder,
  responseNextCursor,
  responseWaitingCount,
} from "../src/client/ops-clues";

test("Ops clue normalization preserves private editorial fields and versions", () => {
  const rows = normalizeOpsClues({ data: { clues: [{
    id: "clue-01", sequence: 1, title: "The Starting Line", riddle: "Riddle",
    decoderExplanation: "Explanation", narrowingSummary: "One place",
    internalNapkinNote: "Review privately", internalScore: 7, state: "released",
    decoderMode: "paid", version: 4, digPermitEnabled: false,
  }] } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.internalNapkinNote, "Review privately");
  assert.equal(rows[0]?.version, 4);
});

test("Ops treats every area returned by the published-zones endpoint as published", () => {
  assert.deepEqual(normalizeZones({ data: [{
    id: "zone-loose-sand",
    slug: "loose-sand",
    label: "Marked loose-sand square",
    state: "open"
  }] }), [{
    id: "zone-loose-sand",
    label: "Marked loose-sand square",
    state: "open",
    published: true
  }]);
});

test("Ops payment pages preserve the aggregate waiting count and next cursor", () => {
  const payload = { data: { orders: [], counts: { waiting_verification: 17 } }, page: { nextCursor: "cursor-2" } };
  assert.equal(responseWaitingCount(payload), 17);
  assert.equal(responseNextCursor(payload), "cursor-2");
});

test("Ops payment normalization keeps the matching fields and rejects malformed rows", () => {
  const rows = normalizeOpsClueOrders({ data: { orders: [
    { id: "order-1", clueId: "clue-01", clueSequence: 1, clueTitle: "The Starting Line", reference: "TLS-C01-K4M2", senderName: "A Hunter", status: "waiting_verification", version: 2, updatedAt: "2026-08-07T12:00:00Z" },
    { id: "", reference: "broken" },
  ] } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.reference, "TLS-C01-K4M2");
  assert.equal(rows[0]?.status, "waiting_verification");
});

test("workflow guidance makes the next safe action explicit", () => {
  assert.deepEqual(clueWorkflowGuidance([], []), {
    state: "No clue records loaded",
    next: "Import the reviewed clue ledger before releasing anything.",
    kind: "empty",
  });
  assert.match(clueWorkflowGuidance([
    { id: "clue-02", sequence: 2, title: "Second", riddle: "R", decoderExplanation: "D", narrowingSummary: "N", internalNapkinNote: "", internalScore: 0, state: "ready", version: 1, digPermitEnabled: false, digZoneId: "", digInstruction: "", digMaxDepthMm: null, digAllowedTools: [], digZoneState: "", digZonePublished: false },
  ], []).next, /Review Clue 02, then use Release the next clue/i);
});

test("approved early-access orders expose a plain retry-email action", () => {
  const html = renderOrder({
    id: "order-1", clueId: "clue-01", clueSequence: 1, clueTitle: "The Starting Line",
    reference: "TLS-C01-K4M2", senderName: "A Hunter", status: "approved",
    decisionNote: "", version: 3, updatedAt: "2026-08-07T12:00:00Z",
  });
  assert.match(html, /data-order-notify/);
  assert.match(html, /retry access email/i);
  assert.doesNotMatch(html, /data-order-decision="approve"/);
});

test("waiting payments require an explicit Tim-cleared confirmation", () => {
  const html = renderOrder({
    id: "order-2", clueId: "clue-02", clueSequence: 2, clueTitle: "Private next clue",
    reference: "TLS-C02-ABCD", senderName: "A Hunter", status: "waiting_verification",
    decisionNote: "", version: 2, updatedAt: "2026-08-07T12:00:00Z",
  });
  assert.match(html, /data-tim-payment-confirmed/);
  assert.match(html, /Tim personally confirmed/i);
  assert.match(html, /Confirm payment and unlock early access/i);
});
