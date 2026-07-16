import assert from "node:assert/strict";
import test from "node:test";
import { FakeLegalReceiptSender, FakeStore } from "./api-test-kit";

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
    { role: "adult", participationBasis: "adult", fullName: "Alex Hunter", birthYear: null, guardianAttested: false },
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

test("waiver access and current acceptance stay scoped to the accepting player", async () => {
  const store = new FakeStore();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const firstReview = await store.recordWaiverReview("hunter-1", { version: "2026.1", hash });
  await store.acceptParticipationWaiver("hunter-1", {
    reviewEventId: firstReview.id,
    idempotencyKey: "accept-first",
    adultName: "Alex Hunter",
    minors: [],
    guardianAttested: false,
    documentVersion: "2026.1",
    documentHash: hash,
  });

  const unrelated = await store.getPlayerAccess("hunter-2");
  assert.equal(unrelated.waiverStatus, "pending");
  assert.equal(unrelated.participationUnlocked, false);

  const newerHash = "b".repeat(64);
  const newerReview = await store.recordWaiverReview("hunter-1", {
    version: "2026.2",
    hash: newerHash,
  });
  const newer = await store.acceptParticipationWaiver("hunter-1", {
    reviewEventId: newerReview.id,
    idempotencyKey: "accept-newer",
    adultName: "Alex Hunter",
    minors: [],
    guardianAttested: false,
    documentVersion: "2026.2",
    documentHash: newerHash,
  });
  assert.equal((await store.getParticipationWaiver("hunter-1"))?.id, newer.value.id);
});

test("the fake legal receipt sender records delivery calls without network traffic", async () => {
  const sender = new FakeLegalReceiptSender();
  assert.deepEqual(await sender.deliver("acceptance-1"), { status: "sent" });
  assert.deepEqual(sender.calls, ["acceptance-1"]);
});
