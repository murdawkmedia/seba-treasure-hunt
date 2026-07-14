import assert from "node:assert/strict";
import test from "node:test";
import { FakeStore } from "./api-test-kit";

const hash = "a".repeat(64);

test("the fake store preserves immutable waiver participants and idempotent acceptance", async () => {
  const store = new FakeStore();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const review = await store.recordWaiverReview("hunter-1", {
    version: "2026.1",
    hash,
  });

  const input = {
    reviewEventId: review.id,
    idempotencyKey: "accept-1",
    adultName: "Alex Hunter",
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
    guardianAttested: true,
    documentVersion: "2026.1",
    documentHash: hash,
  };
  const accepted = await store.acceptParticipationWaiver("hunter-1", input);
  const replayed = await store.acceptParticipationWaiver("hunter-1", input);

  assert.equal(accepted.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.value.id, accepted.value.id);
  assert.deepEqual(accepted.value.participants, [
    { role: "adult", fullName: "Alex Hunter", birthYear: null, guardianAttested: false },
    { role: "minor", fullName: "Sam Hunter", birthYear: 2014, guardianAttested: true },
  ]);
  assert.equal(accepted.value.receipt.status, "pending");
  assert.equal((await store.getParticipationWaiver("hunter-1"))?.referenceCode, accepted.value.referenceCode);
});

test("receipt resend requeues the existing acceptance job without creating an acceptance", async () => {
  const store = new FakeStore();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const review = await store.recordWaiverReview("hunter-1", { version: "2026.1", hash });
  const accepted = await store.acceptParticipationWaiver("hunter-1", {
    reviewEventId: review.id,
    idempotencyKey: "accept-1",
    adultName: "Alex Hunter",
    minors: [],
    guardianAttested: false,
    documentVersion: "2026.1",
    documentHash: hash,
  });

  const requeued = await store.queueWaiverReceiptResend("hunter-1", accepted.value.id);
  assert.equal(requeued?.id, accepted.value.id);
  assert.equal(requeued?.receipt.status, "pending");
  assert.equal((await store.getParticipationWaiver("hunter-1"))?.id, accepted.value.id);
});
