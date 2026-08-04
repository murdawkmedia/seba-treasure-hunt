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

test("Fresh Drops migration separates collection, placement, and media audience", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.indexOf("0017_fresh_drops_hunter_gallery.sql") > names.indexOf("0016_dynamic_case_items.sql"));
  const sql = await readFile(path.resolve("migrations", "0017_fresh_drops_hunter_gallery.sql"), "utf8");
  assert.match(sql, /ADD COLUMN collection TEXT NOT NULL DEFAULT 'case'/i);
  assert.match(sql, /ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'/i);
  assert.match(sql, /ADD COLUMN show_on_board INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /ADD COLUMN teaser_order INTEGER/i);
  assert.match(sql, /ADD COLUMN reportable INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /ALTER TABLE case_item_media ADD COLUMN audience/i);
  assert.match(sql, /ALTER TABLE case_item_uploads ADD COLUMN source_sha256/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN case_item_id/i);
  assert.match(sql, /WHERE id = 'case-item-camera'/i);
  assert.match(sql, /WHERE id = 'case-item-watch'/i);
  assert.doesNotMatch(sql, /INSERT[^;]+INTO case_items/is);
});

test("finder-sharing migration is additive and configures finite item closing", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.indexOf("0018_keep_it_tell_us.sql") > names.indexOf("0017_fresh_drops_hunter_gallery.sql"));
  const sql = await readFile(path.resolve("migrations", "0018_keep_it_tell_us.sql"), "utf8");
  assert.match(sql, /ALTER TABLE case_items ADD COLUMN close_on_find/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN custom_item_name/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN publication_preference/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN sharing_notice_version/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN sharing_notice_accepted_at/i);
  assert.match(sql, /WHERE id IN \([\s\S]*case-item-camera[\s\S]*case-item-watch[\s\S]*case-item-purse/i);
  assert.match(sql, /case-item-cash[\s\S]*close_on_find = 0/i);
  assert.match(sql, /close_on_find = 0[^;]+case-item-golf-balls/i);
  assert.match(sql, /WHERE id = 10 AND route_order = 11/i);
  assert.match(sql, /The Driving Range & Brewing at Seba/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i);
});

test("Apple Watch found migration conditionally marks only the Watch found", async () => {
  const names = (await readdir(path.resolve("migrations"))).sort();
  assert.ok(names.includes("0022_mark_apple_watch_found.sql"));
  const sql = await readFile(path.resolve("migrations", "0022_mark_apple_watch_found.sql"), "utf8");
  assert.match(sql, /UPDATE case_items/i);
  assert.match(sql, /status\s*=\s*'found'/i);
  assert.match(sql, /description\s*=\s*'Found\. Its finder has it\.'/i);
  assert.match(sql, /version\s*=\s*version\s*\+\s*1/i);
  assert.match(sql, /updated_at\s*=\s*'2026-08-04T16:00:00\.000Z'/i);
  assert.match(sql, /updated_by\s*=\s*'system:migration:0022'/i);
  assert.match(sql, /WHERE id\s*=\s*'case-item-watch'\s+AND status\s*<>\s*'found'/i);
  assert.match(sql, /UPDATE case_items\s+SET description = 'Found\. Its finder has it\.'\s+WHERE id = 'case-item-watch'\s+AND status = 'found'\s+AND description = 'An Apple Watch is now somewhere in the search area\. The finder keeps it\.'/is);
  assert.doesNotMatch(sql, /AND status\s*=\s*'out_there'/i);
  assert.doesNotMatch(sql, /changes\(\)/i);
  assert.doesNotMatch(sql, /0019|0020|0021/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i);
});

test("Apple Watch found migration records one public-safe release event and audit", async () => {
  const sql = await readFile(path.resolve("migrations", "0022_mark_apple_watch_found.sql"), "utf8");
  assert.match(sql, /INSERT OR IGNORE INTO case_item_events/i);
  assert.match(sql, /'case-item-watch-found-0022'/i);
  assert.match(sql, /'case_item\.marked_found_release'/i);
  assert.doesNotMatch(sql, /'out_there'/i);
  assert.match(sql, /'found'/i);
  assert.match(sql, /'case_item\.marked_found_release',\s+status,\s+'found',\s+version\s*\+\s*1/i);
  assert.match(sql, /'\{"source":"confirmed-find"\}'/i);
  assert.match(sql, /INSERT OR IGNORE INTO audit_events/i);
  assert.match(sql, /'audit-case-item-watch-found-0022'/i);
  assert.match(sql, /'case_item'/i);
  assert.match(sql, /metadata_json/i);
  assert.match(sql, /'\{"source":"confirmed-find"\}'/i);
  const finalRowGuards = sql.match(/FROM case_items\s+WHERE id = 'case-item-watch'\s+AND status = 'found'\s+AND updated_by = 'system:migration:0022'/gi) ?? [];
  assert.match(sql, /FROM case_items\s+WHERE id = 'case-item-watch'\s+AND status\s*<>\s*'found'/i);
  assert.equal(finalRowGuards.length, 1);
  assert.doesNotMatch(sql, /private_reports|report_id|finder_(?:id|name|email)/i);
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
      closeOnFind: true,
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
      closeOnFind: true,
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
      closeOnFind: true,
      status: "out_there",
      displayOrder: 5,
      showOnBoard: false,
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
      closeOnFind: true,
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

test("focused item status mutation requires a confirmed paired transition and preserves the item", async () => {
  const { app, store } = makeApp();
  const endpoint = `${origin}/api/v1/ops/items/item-camera/status`;
  const staffHeaders = { authorization: "Bearer staff-token", origin };
  const before = structuredClone(store.caseItems.find((item) => item.id === "item-camera"));

  assert.equal((await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "found", confirmed: true })
  })).status, 401);
  assert.equal((await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "found", confirmed: true }, { ...staffHeaders, origin: "https://attacker.example" })
  })).status, 403);
  const wrongContentType = await app.request(endpoint, {
    method: "POST",
    headers: { ...staffHeaders, "content-type": "text/plain" },
    body: JSON.stringify({ expectedVersion: 1, status: "found", confirmed: true })
  });
  assert.equal(wrongContentType.status, 415);

  for (const body of [
    { expectedVersion: 1, status: "found", confirmed: false },
    { expectedVersion: 1, status: "found" },
    { status: "found", confirmed: true },
    { expectedVersion: 1.1, status: "found", confirmed: true },
    { expectedVersion: 1, status: "paused", confirmed: true },
    { expectedVersion: 1, status: "found", confirmed: true, title: "not accepted" }
  ]) {
    const response = await app.request(endpoint, { method: "POST", ...json(body, staffHeaders) });
    assert.equal(response.status, 422);
    assert.equal((await responseJson(response)).error.code, "validation_failed");
  }
  assert.equal(store.audits.filter((event) => event.action === "case_item.status_changed").length, 0);
  assert.equal(store.caseItemEvents.filter((event) => event.action === "case_item.status_changed").length, 0);

  const found = await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "found", confirmed: true }, staffHeaders)
  });
  assert.equal(found.status, 200);
  const changed = (await responseJson(found)).data;
  assert.equal(changed.status, "found");
  assert.equal(changed.version, 2);
  for (const field of ["title", "description", "uploads", "collection", "collectionOrder", "audience", "showOnBoard", "teaserOrder", "reportable"]) {
    assert.deepEqual(changed[field], before?.[field]);
  }
  assert.equal(store.audits.filter((event) => event.action === "case_item.status_changed").length, 1);
  assert.equal(store.caseItemEvents.filter((event) => event.action === "case_item.status_changed").length, 1);

  const same = await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 2, status: "found", confirmed: true }, staffHeaders)
  });
  assert.equal(same.status, 422);
  assert.equal((await responseJson(same)).error.code, "case_item_status_transition");
  const staleAtCurrentTarget = await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "found", confirmed: true }, staffHeaders)
  });
  assert.equal(staleAtCurrentTarget.status, 409);
  assert.equal((await responseJson(staleAtCurrentTarget)).error.code, "case_item_stale");
  const stale = await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "out_there", confirmed: true }, staffHeaders)
  });
  assert.equal(stale.status, 409);
  assert.equal((await responseJson(stale)).error.code, "case_item_stale");
  const reversed = await app.request(endpoint, {
    method: "POST",
    ...json({ expectedVersion: 2, status: "out_there", confirmed: true }, staffHeaders)
  });
  assert.equal(reversed.status, 200);
  assert.equal((await responseJson(reversed)).data.status, "out_there");
  const missing = await app.request(`${origin}/api/v1/ops/items/missing/status`, {
    method: "POST",
    ...json({ expectedVersion: 1, status: "found", confirmed: true }, staffHeaders)
  });
  assert.equal(missing.status, 404);
  assert.equal((await responseJson(missing)).error.code, "case_item_not_found");
  assert.equal(store.audits.filter((event) => event.action === "case_item.status_changed").length, 2);
  assert.equal(store.caseItemEvents.filter((event) => event.action === "case_item.status_changed").length, 2);
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
      closeOnFind: true,
      status: "out_there",
      displayOrder: 4,
      mediaSelections: [{ id: media.id, altText: "A camera hidden for the search", caption: null }]
    }, headers)
  });
  assert.equal(selected.status, 200);
  assert.equal((await app.request(`${origin}/api/v1/media/${media.id}`)).status, 200);
});

test("public board and teaser placement require selected public media", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/ops/items/item-camera`, {
    method: "PATCH",
    ...json({
      expectedVersion: 1,
      slug: "camera",
      owner: "tim",
      category: "prize",
      title: "A camera",
      description: "A camera is now somewhere in the search area.",
      finderKeeps: true,
      closeOnFind: true,
      status: "out_there",
      displayOrder: 4,
      showOnBoard: true,
      mediaSelections: []
    }, { authorization: "Bearer staff-token", origin })
  });
  assert.equal(response.status, 422);
  assert.equal((await responseJson(response)).error.code, "case_item_public_media_required");
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
