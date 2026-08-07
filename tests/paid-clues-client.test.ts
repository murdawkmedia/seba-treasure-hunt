import assert from "node:assert/strict";
import test from "node:test";

import { normalizeClueOrderResponse, normalizeMyClues, normalizePublicClues, orderPaymentPresentation } from "../src/client/clues";

test("public clue normalization keeps sealed records sealed", () => {
  const clues = normalizePublicClues({ data: { clues: [
    { id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "A public riddle", decoder: { mode: "paid", access: "purchase_required" } },
    { id: "clue-02", sequence: 2, state: "sealed", title: "must not survive", riddle: "must not survive", decoder: { explanation: "must not survive" } },
  ] } });

  assert.equal(clues.length, 2);
  assert.equal(clues[0]?.riddle, "A public riddle");
  assert.equal(clues[1]?.sealed, true);
  assert.equal(clues[1]?.title, null);
  assert.equal(clues[1]?.riddle, null);
  assert.equal(clues[1]?.decoder, null);
});

test("My Clues recognizes approved and waiting decoder orders", () => {
  const projection = normalizeMyClues({ data: {
    clues: [
      { id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "Riddle", decoder: { mode: "paid", access: "unlocked", explanation: "Plain answer", narrowingSummary: "One area" } },
      { id: "clue-02", sequence: 2, state: "released", title: "Second", riddle: "Riddle two", decoder: { mode: "paid", access: "purchase_required" } },
    ],
    orders: [{ id: "order-2", clueId: "clue-02", status: "waiting_verification", reference: "TLS-C02-K4M2", version: 2 }],
  } });

  assert.equal(projection.clues[0]?.decoder, "Plain answer");
  assert.equal(projection.clues[0]?.narrowing, "One area");
  assert.equal(projection.clues[1]?.decoderAccess, "purchase_required");
  assert.equal(projection.orders[0]?.status, "waiting_verification");
  assert.equal(projection.orders[0]?.reference, "TLS-C02-K4M2");
});

test("public clue normalization preserves the waiting-for-verification access state", () => {
  const [clue] = normalizePublicClues({ data: { clues: [{
    id: "clue-01", sequence: 1, state: "released", title: "The Starting Line", riddle: "Riddle",
    decoder: { mode: "paid", access: "waiting_verification" },
  }] } });
  assert.equal(clue?.decoderAccess, "waiting_verification");
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
