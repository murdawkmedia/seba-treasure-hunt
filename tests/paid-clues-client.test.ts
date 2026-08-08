import assert from "node:assert/strict";
import test from "node:test";

import { normalizeClueOrderResponse, normalizeMyClues, normalizePublicClues, orderPaymentPresentation } from "../src/client/clues";

test("public clue normalization keeps sealed records sealed", () => {
  const clues = normalizePublicClues({ data: { clues: [
    { id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "A public riddle", decoder: { access: "public_sample", explanation: "A public decoder" } },
    { id: "clue-02", sequence: 2, state: "sealed", title: "must not survive", riddle: "must not survive", decoder: { explanation: "must not survive" }, earlyAccess: { priceCad: 5, access: "purchase_required" } },
  ] } });

  assert.equal(clues.length, 2);
  assert.equal(clues[0]?.riddle, "A public riddle");
  assert.equal(clues[1]?.sealed, true);
  assert.equal(clues[1]?.title, null);
  assert.equal(clues[1]?.riddle, null);
  assert.equal(clues[1]?.decoder, null);
  assert.equal(clues[0]?.decoderAccess, "public_sample");
  assert.equal(clues[1]?.earlyAccess, "purchase_required");
});

test("My Clues recognizes released-member access and the next waiting early-access order", () => {
  const projection = normalizeMyClues({ data: {
    clues: [
      { id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "Riddle", decoder: { access: "released_member", explanation: "Plain answer", narrowingSummary: "One area" } },
      { id: "clue-02", sequence: 2, state: "sealed", earlyAccess: { priceCad: 5, access: "waiting_verification" } },
    ],
    orders: [{ id: "order-2", clueId: "clue-02", status: "waiting_verification", reference: "TLS-C02-K4M2", version: 2 }],
  } });

  assert.equal(projection.clues[0]?.decoder, "Plain answer");
  assert.equal(projection.clues[0]?.narrowing, "One area");
  assert.equal(projection.clues[0]?.decoderAccess, "released_member");
  assert.equal(projection.clues[1]?.earlyAccess, "waiting_verification");
  assert.equal(projection.orders[0]?.status, "waiting_verification");
  assert.equal(projection.orders[0]?.reference, "TLS-C02-K4M2");
});

test("public clue normalization preserves controlled digging access without leaking exact detail", () => {
  const [clue] = normalizePublicClues({ data: { clues: [{
    id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "Riddle",
    decoder: { access: "sign_in_required" }, digPermit: { access: "sign_in_required", instruction: "must not survive" },
  }] } });
  assert.equal(clue?.decoderAccess, "sign_in_required");
  assert.deepEqual(clue?.digPermit, { access: "sign_in_required", instruction: null, maxDepthMm: null, allowedTools: [] });
});

test("order creation normalizes the nested API order and environment-safe payment instructions", () => {
  const validation = normalizeClueOrderResponse({ data: {
    order: { id: "order-1", clueId: "clue-01", status: "created", reference: "TLS-C01-K4M2", version: 1 },
    payment: { amountCad: 5, instructions: "Validation only - do not send money." },
  } });
  assert.equal(validation?.order.id, "order-1");
  assert.equal(validation?.payment.validationOnly, true);
  assert.equal(validation?.payment.recipient, null);

  const production = normalizeClueOrderResponse({ data: {
    order: { id: "order-2", clueId: "clue-02", status: "created", reference: "TLS-C02-ABCD", version: 1 },
    payment: { amountCad: 5, recipient: "tim@example.test", reference: "TLS-C02-ABCD", instructions: "Send $5 CAD." },
  } });
  assert.equal(production?.payment.validationOnly, false);
  assert.equal(production?.payment.recipient, "tim@example.test");
});

test("reused waiting and approved orders normalize without repeating payment instructions", () => {
  const waiting = normalizeClueOrderResponse({ data: {
    order: { id: "order-1", clueId: "clue-01", status: "waiting_verification", reference: "TLS-C01-K4M2", version: 2 },
    payment: { status: "waiting_verification" },
  } });
  const approved = normalizeClueOrderResponse({ data: {
    order: { id: "order-1", clueId: "clue-01", status: "approved", reference: "TLS-C01-K4M2", version: 3 },
    payment: { status: "unlocked" },
  } });
  assert.equal(waiting?.payment.status, "waiting_verification");
  assert.equal(approved?.payment.status, "unlocked");
});

test("payment presentation differentiates safe validation instructions from production", () => {
  assert.deepEqual(orderPaymentPresentation({ environment: "validation", paymentAddress: null }), {
    payable: false,
    address: "Test payment only — do not send money",
    message: "Validation mode: this is a disposable test order. Do not send a real e-transfer.",
  });
  assert.deepEqual(orderPaymentPresentation({ environment: "production", paymentAddress: "tim@example.test" }), {
    payable: true,
    address: "tim@example.test",
    message: "Send exactly $5 CAD and include your unique reference in the transfer message.",
  });
});
