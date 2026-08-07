import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { FakeEnvironment, FakeIdentity, FakeRateLimits, FakeStore, FakeTurnstile, FakeUploads, responseJson } from "./api-test-kit";

const makeApp = (store = new FakeStore(), clueNotices?: { deliver(jobId: string): Promise<unknown> }) => ({
  store,
  app: createApi({ store, identity: new FakeIdentity(), turnstile: new FakeTurnstile(), uploads: new FakeUploads(), rateLimits: new FakeRateLimits(), environment: new FakeEnvironment(), clueNotices } as any)
});
const origin = "https://www.timlostsomething.com";
const hunter = { authorization: "Bearer hunter-token", origin, "content-type": "application/json" };
const staff = { authorization: "Bearer staff-token", origin, "content-type": "application/json" };

test("public clue catalogue never leaks sealed clue copy", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/clues`);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.equal(body.data.clues[0].title, "The Starting Line");
  assert.equal(body.data.clues[1].label, "Clue 02 — Sealed");
  assert.equal("title" in body.data.clues[1], false);
  assert.equal("riddle" in body.data.clues[1], false);
  assert.equal(/Private later|Private decoder|Private note/.test(JSON.stringify(body.data.clues)), false);
});

test("later released riddles require an active synchronized hunter while Clue 01 stays public", async () => {
  const { app, store } = makeApp();
  store.paidClues[1].state = "released";
  store.paidClues[1].releasedAt = "2026-08-07T13:00:00.000Z";
  const anonymous = await responseJson(await app.request(`${origin}/api/v1/clues`));
  assert.equal(anonymous.data.clues[0].title, "The Starting Line");
  assert.equal(anonymous.data.clues[1].state, "released");
  assert.equal("title" in anonymous.data.clues[1], false);
  const pending = await app.request(`${origin}/api/v1/clues`, { headers: { authorization: "Bearer hunter-token" } });
  assert.equal(pending.status, 409);
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const signedIn = await responseJson(await app.request(`${origin}/api/v1/clues`, { headers: { authorization: "Bearer hunter-token" } }));
  assert.equal(signedIn.data.clues[1].title, "Private later clue");
  assert.equal(signedIn.data.clues[1].riddle, "Private later riddle.");
  assert.equal("explanation" in signedIn.data.clues[1].decoder, false);
});

test("a free decoder for a later released clue remains sealed until hunter entitlement", async () => {
  const { app, store } = makeApp();
  store.paidClues[1].state = "released";
  store.paidClues[1].decoderMode = "free";
  store.paidClues[1].releasedAt = "2026-08-07T13:00:00.000Z";
  const anonymous = await responseJson(await app.request(`${origin}/api/v1/clues`));
  const clue = anonymous.data.clues[1];
  assert.match(clue.label, /^Clue 02 .* Sealed$/);
  assert.equal("title" in clue, false);
  assert.equal("riddle" in clue, false);
  assert.equal("explanation" in clue.decoder, false);
  assert.equal("narrowingSummary" in clue.decoder, false);
  assert.equal(clue.decoder.access, "sign_in_required");
});

test("hunter order is reusable, claimed, approved, and then unlocks only that decoder", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const first = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  assert.equal(first.status, 201);
  const firstBody = await responseJson(first);
  assert.match(firstBody.data.order.reference, /^TLS-C01-/);
  assert.equal("playerSubject" in firstBody.data.order, false);
  assert.equal("decidedBy" in firstBody.data.order, false);
  const reused = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  const reusedBody = await responseJson(reused);
  assert.equal(reusedBody.data.reused, true);
  assert.equal(reusedBody.data.payment.amountCad, 5);
  const claim = await app.request(`${origin}/api/v1/me/clue-orders/${firstBody.data.order.id}/claim`, { method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter", expectedVersion: firstBody.data.order.version }) });
  assert.equal((await responseJson(claim)).data.order.status, "waiting_verification");
  const waiting = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  const waitingBody = await responseJson(waiting);
  assert.deepEqual(waitingBody.data.payment, { status: "waiting_verification" });
  assert.equal(waitingBody.data.order.playerSubject, undefined);
  const pending = store.paidClueOrders[0];
  const approved = await app.request(`${origin}/api/v1/ops/clue-orders/${pending.id}/approve`, { method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: pending.version }) });
  assert.equal(approved.status, 200);
  assert.equal((await responseJson(approved)).data.order.status, "approved");
  const owned = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  assert.deepEqual((await responseJson(owned)).data.payment, { status: "unlocked" });
  const mine = await app.request(`${origin}/api/v1/me/clues`, { headers: { authorization: "Bearer hunter-token" } });
  const data = await responseJson(mine);
  assert.equal(data.data.clues[0].decoder.access, "unlocked");
  assert.equal(typeof data.data.clues[0].decoder.explanation, "string");
  assert.equal("playerSubject" in data.data.orders[0], false);
  assert.equal("decidedBy" in data.data.orders[0], false);
  store.paidClues[0].state = "retired";
  const historical = await responseJson(await app.request(`${origin}/api/v1/me/clues`, { headers: { authorization: "Bearer hunter-token" } }));
  assert.equal(historical.data.clues[0].decoder.access, "unlocked", "retirement preserves an approved historical purchase");
});

test("paid clue account access waits for an active synchronized player identity", async () => {
  const { app, store } = makeApp();
  for (const [method, path, body] of [
    ["GET", "/api/v1/me/clues", undefined],
    ["POST", "/api/v1/clues/clue-01/orders", "{}"]
  ] as const) {
    const response = await app.request(`${origin}${path}`, { method, headers: hunter, body });
    assert.equal(response.status, 409);
    assert.equal((await responseJson(response)).error.code, "identity_sync_pending");
  }
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const order = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  assert.equal(order.status, 201);
  const created = (await responseJson(order)).data.order;
  store.accounts.set("hunter-1", { ...store.accounts.get("hunter-1"), accountState: "deleted" });
  const claim = await app.request(`${origin}/api/v1/me/clue-orders/${created.id}/claim`, {
    method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter", expectedVersion: created.version })
  });
  assert.equal(claim.status, 409);
  assert.equal((await responseJson(claim)).error.code, "identity_sync_pending");
});

test("claim requires the hunter's current order version", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const created = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  const order = (await responseJson(created)).data.order;
  const missing = await app.request(`${origin}/api/v1/me/clue-orders/${order.id}/claim`, {
    method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter" })
  });
  assert.equal(missing.status, 422);
  const stale = await app.request(`${origin}/api/v1/me/clue-orders/${order.id}/claim`, {
    method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter", expectedVersion: 999 })
  });
  assert.equal(stale.status, 409);
});

test("a waiting order is reflected in the auth-aware clue decoder state", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const created = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  const order = (await responseJson(created)).data.order;
  await app.request(`${origin}/api/v1/me/clue-orders/${order.id}/claim`, {
    method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter", expectedVersion: order.version })
  });
  store.paidClueOrders.push({
    ...store.paidClueOrders[0], id: "older-cancelled", status: "cancelled", version: 3,
    updatedAt: "2026-08-06T00:00:00.000Z"
  });
  const catalogue = await app.request(`${origin}/api/v1/clues`, { headers: { authorization: "Bearer hunter-token" } });
  assert.equal((await responseJson(catalogue)).data.clues[0].decoder.access, "waiting_verification");
});

test("approving a waiting order persists decoder access before its transactional notice is delivered", async () => {
  const delivered: string[] = [];
  const { app, store } = makeApp(undefined, {
    async deliver(jobId) {
      delivered.push(jobId);
      throw new Error("mail provider unavailable");
    }
  });
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const order = await store.createOrReuseClueOrder("hunter-1", "clue-01");
  const claimed = await store.claimClueOrder("hunter-1", order.order.id, "A Hunter", order.order.version);
  assert.ok(claimed);

  const approved = await app.request(`${origin}/api/v1/ops/clue-orders/${order.order.id}/approve`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: claimed.version })
  });

  assert.equal(approved.status, 200);
  assert.equal(store.paidClueOrders[0]?.status, "approved");
  assert.equal(delivered.length, 1);
});

test("a confirmed release notice snapshots only hunt-email opt-ins and is durable-idempotent", async () => {
  const { app, store } = makeApp();
  store.huntEmailSubscribers.add("hunter-2");
  store.huntEmailSubscribers.delete("hunter-1");

  const missingConfirmation = await app.request(`${origin}/api/v1/ops/clues/clue-01/notify`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 1 })
  });
  assert.equal(missingConfirmation.status, 422);

  const first = await app.request(`${origin}/api/v1/ops/clues/clue-01/notify`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 1, confirmNotify: true })
  });
  assert.equal(first.status, 202);
  assert.deepEqual(store.clueNoticeRecipients.map((recipient) => recipient.hunterSubject), ["hunter-2"]);
  assert.ok(store.audits.some((audit) => audit.action === "clue.notified"));

  const second = await app.request(`${origin}/api/v1/ops/clues/clue-01/notify`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 1, confirmNotify: true })
  });
  assert.equal(second.status, 202);
  assert.equal(store.clueNoticeJobs.filter((job) => job.kind === "clue_released").length, 1);
  assert.equal((await responseJson(second)).data.replayed, true);
});

test("ops releases sequentially and needs a reason to retract", async () => {
  const { app, store } = makeApp();
  store.paidClues[1].state = "ready";
  const release = await app.request(`${origin}/api/v1/ops/clues/clue-02/release`, { method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 1 }) });
  assert.equal(release.status, 200);
  const rejectRetract = await app.request(`${origin}/api/v1/ops/clues/clue-02/retract`, { method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 2, reason: "" }) });
  assert.equal(rejectRetract.status, 422);
  const retract = await app.request(`${origin}/api/v1/ops/clues/clue-02/retract`, { method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 2, reason: "Unsafe wording" }) });
  assert.equal((await responseJson(retract)).data.clue.state, "ready");
});

test("generic clue editing cannot bypass release and retraction lifecycle routes", async () => {
  const { app, store } = makeApp();
  store.paidClues[1].state = "ready";
  const bypassRelease = await app.request(`${origin}/api/v1/ops/clues/clue-02`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ expectedVersion: 1, state: "released" })
  });
  assert.equal(bypassRelease.status, 422);
  const bypassRetraction = await app.request(`${origin}/api/v1/ops/clues/clue-01`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ expectedVersion: 1, state: "ready" })
  });
  assert.equal(bypassRetraction.status, 422);
  const safe = await app.request(`${origin}/api/v1/ops/clues/clue-02`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ expectedVersion: 1, state: "retired" })
  });
  assert.equal(safe.status, 200);
});

test("operators can cancel an unclaimed order and later reopen it", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const created = await store.createOrReuseClueOrder("hunter-1", "clue-01");
  const cancelled = await app.request(`${origin}/api/v1/ops/clue-orders/${created.order.id}/cancel`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: 1 })
  });
  assert.equal(cancelled.status, 200);
  const cancelledOrder = (await responseJson(cancelled)).data.order;
  assert.equal(cancelledOrder.status, "cancelled");
  const reopened = await app.request(`${origin}/api/v1/ops/clue-orders/${created.order.id}/reopen`, {
    method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: cancelledOrder.version })
  });
  assert.equal(reopened.status, 200);
  assert.equal((await responseJson(reopened)).data.order.status, "created");
});

test("ops clue order queue exposes cursor pagination and aggregate counts", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  const first = await store.createOrReuseClueOrder("hunter-1", "clue-01");
  await store.decideClueOrder(first.order.id, { expectedVersion: 1, status: "cancelled" }, "staff-1");
  const second = await store.createOrReuseClueOrder("hunter-1", "clue-01");
  const page = await app.request(`${origin}/api/v1/ops/clue-orders?limit=1`, { headers: { authorization: "Bearer staff-token" } });
  assert.equal(page.status, 200);
  const body = await responseJson(page);
  assert.equal(body.data.orders.length, 1);
  assert.equal(body.data.counts.cancelled, 1);
  assert.equal(body.data.counts.created, 1);
  assert.ok(body.page.nextCursor);
  const next = await app.request(`${origin}/api/v1/ops/clue-orders?limit=1&cursor=${encodeURIComponent(body.page.nextCursor)}`, { headers: { authorization: "Bearer staff-token" } });
  assert.equal((await responseJson(next)).data.orders[0].id === second.order.id, false);
  const invalid = await app.request(`${origin}/api/v1/ops/clue-orders?cursor=not-a-cursor`, { headers: { authorization: "Bearer staff-token" } });
  assert.equal(invalid.status, 400);
});
