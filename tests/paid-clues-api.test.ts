import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { FakeEnvironment, FakeIdentity, FakeRateLimits, FakeStore, FakeTurnstile, FakeUploads, responseJson } from "./api-test-kit";

const makeApp = (store = new FakeStore()) => ({
  store,
  app: createApi({ store, identity: new FakeIdentity(), turnstile: new FakeTurnstile(), uploads: new FakeUploads(), rateLimits: new FakeRateLimits(), environment: new FakeEnvironment() })
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

test("hunter order is reusable, claimed, approved, and then unlocks only that decoder", async () => {
  const { app, store } = makeApp();
  const first = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  assert.equal(first.status, 201);
  const firstBody = await responseJson(first);
  assert.match(firstBody.data.order.reference, /^TLS-C01-/);
  const reused = await app.request(`${origin}/api/v1/clues/clue-01/orders`, { method: "POST", headers: hunter, body: "{}" });
  assert.equal((await responseJson(reused)).data.reused, true);
  const claim = await app.request(`${origin}/api/v1/me/clue-orders/${firstBody.data.order.id}/claim`, { method: "POST", headers: hunter, body: JSON.stringify({ senderName: "A Hunter" }) });
  assert.equal((await responseJson(claim)).data.order.status, "waiting_verification");
  const pending = store.paidClueOrders[0];
  const approved = await app.request(`${origin}/api/v1/ops/clue-orders/${pending.id}/approve`, { method: "POST", headers: staff, body: JSON.stringify({ expectedVersion: pending.version }) });
  assert.equal(approved.status, 200);
  assert.equal((await responseJson(approved)).data.order.status, "approved");
  const mine = await app.request(`${origin}/api/v1/me/clues`, { headers: { authorization: "Bearer hunter-token" } });
  const data = await responseJson(mine);
  assert.equal(data.data.clues[0].decoder.access, "unlocked");
  assert.equal(typeof data.data.clues[0].decoder.explanation, "string");
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
