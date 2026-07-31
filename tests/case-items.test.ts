import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeOperatorAlertSender,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";

const origin = "https://www.timlostsomething.com";

test("case item migration is additive, append-only, and seeds the approved public facts", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.indexOf("0016_dynamic_case_items.sql") > names.indexOf("0015_submission_ops_publication_refinement.sql"));
  const sql = await readFile(path.resolve("migrations", "0016_dynamic_case_items.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS case_items/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS case_item_events/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_case_item_events_no_update/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_case_item_events_no_delete/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS case_item_uploads/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS case_item_media/i);
  for (const slug of ["tims-id", "cash", "diamond-rings", "camera", "apple-watch", "purse", "golf-balls"]) {
    assert.match(sql, new RegExp(`['\"]${slug}['\"]`, "i"));
  }
  assert.match(sql, /tims-id[\s\S]*found/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i);
});

const makeApp = () => {
  const store = new FakeStore();
  const uploads = new FakeUploads();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads,
    rateLimits: new FakeRateLimits(),
    operatorAlerts: new FakeOperatorAlertSender(),
    environment: new FakeEnvironment()
  });
  return { app, store, uploads };
};

test("public items expose only safe visible states in display order", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/items`);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.deepEqual(body.data.map((item: Record<string, unknown>) => item.slug), ["tims-id", "camera"]);
  assert.equal(body.data[0].status, "found");
  assert.equal("version" in body.data[0], false);
  assert.equal(JSON.stringify(body).includes("This must not leave Ops"), false);
});

test("case item mutations are staff-only, same-origin, versioned, and reversible", async () => {
  const { app, store } = makeApp();
  const endpoint = `${origin}/api/v1/ops/items`;
  const staffHeaders = { authorization: "Bearer staff-token", origin };

  assert.equal((await app.request(endpoint)).status, 401);
  assert.equal((await app.request(endpoint, {
    method: "POST",
    ...json({
      slug: "apple-watch",
      owner: "tim",
      category: "prize",
      title: "An Apple Watch",
      description: "Finder keeps it.",
      finderKeeps: true,
      status: "draft",
      displayOrder: 5
    }, { ...staffHeaders, origin: "https://attacker.example" })
  })).status, 403);

  const createdResponse = await app.request(endpoint, {
    method: "POST",
    ...json({
      slug: "apple-watch",
      owner: "tim",
      category: "prize",
      title: "An Apple Watch",
      description: "Finder keeps it.",
      finderKeeps: true,
      status: "draft",
      displayOrder: 5
    }, staffHeaders)
  });
  assert.equal(createdResponse.status, 201);
  const created = (await responseJson(createdResponse)).data;
  assert.equal(created.version, 1);

  const published = await app.request(`${endpoint}/${created.id}`, {
    method: "PATCH",
    ...json({
      expectedVersion: 1,
      slug: "apple-watch",
      owner: "tim",
      category: "prize",
      title: "An Apple Watch",
      description: "An Apple Watch is now somewhere in the search area.",
      finderKeeps: true,
      status: "out_there",
      displayOrder: 5,
      mediaSelections: []
    }, staffHeaders)
  });
  assert.equal(published.status, 200);
  assert.equal((await responseJson(published)).data.version, 2);

  const stale = await app.request(`${endpoint}/${created.id}`, {
    method: "PATCH",
    ...json({
      expectedVersion: 1,
      slug: "apple-watch",
      owner: "tim",
      category: "prize",
      title: "An Apple Watch",
      description: "Stale edit",
      finderKeeps: true,
      status: "found",
      displayOrder: 5,
      mediaSelections: []
    }, staffHeaders)
  });
  assert.equal(stale.status, 409);
  assert.equal((await responseJson(stale)).error.code, "case_item_stale");
  assert.equal(store.audits.some((event) => event.action === "case_item.created"), true);
  assert.equal(store.audits.some((event) => event.action === "case_item.updated"), true);
});

test("case item media stays private until selected on a public item", async () => {
  const { app, store, uploads } = makeApp();
  const endpoint = `${origin}/api/v1/ops/items/item-camera`;
  const headers = { authorization: "Bearer staff-token", origin };
  const form = new FormData();
  form.append("images", new File([new Uint8Array([0xff, 0xd8, 0xff])], "camera.jpg", {
    type: "image/jpeg"
  }));

  const uploaded = await app.request(`${endpoint}/media`, { method: "POST", headers, body: form });
  assert.equal(uploaded.status, 201);
  assert.equal(uploads.saved.length, 1);
  const item = store.caseItems.find((candidate) => candidate.id === "item-camera")!;
  const media = (item.uploads as Array<Record<string, unknown>>)[0]!;
  media.status = "ready";
  media.key = "derivatives/camera.webp";
  media.contentType = "image/webp";
  assert.equal((await app.request(`${origin}/api/v1/media/${media.id}`)).status, 404);

  const selected = await app.request(endpoint, {
    method: "PATCH",
    ...json({
      expectedVersion: 1,
      slug: "camera",
      owner: "tim",
      category: "prize",
      title: "A camera",
      description: "A camera is now somewhere in the search area.",
      finderKeeps: true,
      status: "out_there",
      displayOrder: 4,
      mediaSelections: [{ id: media.id, altText: "A camera hidden for the search", caption: null }]
    }, headers)
  });
  assert.equal(selected.status, 200);
  assert.equal((await app.request(`${origin}/api/v1/media/${media.id}`)).status, 200);
});

test("announcement action creates a private Official Update draft and never auto-publishes", async () => {
  const { app } = makeApp();
  const headers = { authorization: "Bearer staff-token", origin };
  const response = await app.request(`${origin}/api/v1/ops/items/item-camera/announcement-draft`, {
    method: "POST",
    ...json({}, headers)
  });
  assert.equal(response.status, 201);
  const draft = (await responseJson(response)).data;
  assert.equal(draft.status, "draft");
  assert.match(draft.title, /camera/i);
  const publicUpdates = await responseJson(await app.request(`${origin}/api/v1/updates`));
  assert.equal(publicUpdates.data.some((update: Record<string, unknown>) => update.id === draft.id), false);
});
