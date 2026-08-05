import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  freshDropManifest,
  omittedFreshDropSources
} from "../scripts/fresh-drops-manifest.mjs";
import { importFreshDrops } from "../scripts/import-fresh-drops.mjs";

test("the July 31 manifest reconciles every source, including intentionally reused evidence", () => {
  const used = freshDropManifest.flatMap((item) => item.media.map((media) => media.source));
  const reconciled = [...new Set([...used, ...omittedFreshDropSources])].sort();
  const expected = [
    "01-IMG_5645.jpg",
    "02-IMG_5646.jpg",
    "03-IMG_5647.jpg",
    "04-IMG_5630.jpg",
    "05-IMG_5629.jpg",
    "06-IMG_5628.jpg",
    "07-IMG_5627.jpg",
    "08-IMG_5625.jpg",
    "09-IMG_5622.jpg",
    "10-IMG_5621.jpg",
    "11-IMG_5620.jpg",
    "12-IMG_5619.jpg",
    "13-IMG_5618.jpg",
    "14-IMG_5617.jpg",
    "15-IMG_5616.jpg",
    "16-IMG_5615.jpg",
    "17-IMG_5613.jpg",
    "18-IMG_5614.jpg",
    "19-IMG_5612.jpg",
    "20-IMG_5610.jpg",
    "21-image000001.jpg",
    "22-IMG_5280.jpg",
    "23-gucci-belt.jpg"
  ];

  assert.deepEqual(reconciled, expected.sort());
  assert.deepEqual(omittedFreshDropSources, ["02-IMG_5646.jpg"]);
});

test("the approved Gucci belt is a hunter-only findable Fresh Drop", () => {
  const belt = freshDropManifest.find((item) => item.id === "case-item-gucci-belt");

  assert.deepEqual(belt, {
    id: "case-item-gucci-belt",
    slug: "gucci-belt",
    owner: "tim",
    category: "accessory",
    title: "A Gucci belt",
    description: "A Gucci belt is pictured among the latest drops. The finder keeps it.",
    finderKeeps: true,
    reportable: true,
    closeOnFind: true,
    audience: "hunter_only",
    showOnBoard: false,
    teaserOrder: null,
    collectionOrder: 18,
    media: [{
      source: "23-gucci-belt.jpg",
      alt: "A Gucci monogram belt with a gold double-G buckle photographed before it was hidden",
      audience: "hunter_only",
      caption: null
    }]
  });
});

test("only the camera and toy car are public teaser media", () => {
  const teaser = freshDropManifest
    .filter((item) => item.teaserOrder !== null)
    .map((item) => [
      item.id,
      item.teaserOrder,
      item.media.map((media) => media.audience)
    ]);

  assert.deepEqual(teaser, [
    ["case-item-camera", 1, ["public"]],
    ["case-item-toy-car", 2, ["public"]]
  ]);
});

test("public evidence-board items publish their verified source media", () => {
  const boardItems = freshDropManifest.filter((item) => item.showOnBoard);

  assert.deepEqual(
    boardItems.map((item) => [
      item.id,
      item.media.map((media) => media.audience)
    ]),
    [
      ["case-item-camera", ["public"]],
      ["case-item-watch", ["public"]],
      ["case-item-toy-car", ["public"]],
      ["case-item-rings", ["public"]],
      ["case-item-purse", ["public", "public"]]
    ]
  );
});

test("every item placed on the public board has selected public media", () => {
  for (const item of freshDropManifest.filter((candidate) => candidate.showOnBoard)) {
    assert.ok(item.media.length > 0, `${item.id} must have public evidence`);
    assert.equal(item.media.every((entry) => entry.audience === "public"), true, item.id);
  }
});

test("every finite Fresh Drop is finder-kept and closes when its reviewed find is published", () => {
  const finiteItems = freshDropManifest.filter((item) => item.reportable);
  assert.ok(finiteItems.length > 0);
  assert.equal(finiteItems.every((item) => item.finderKeeps === true), true);
  assert.equal(finiteItems.every((item) => item.closeOnFind === true), true);
  const story = freshDropManifest.find((item) => !item.reportable);
  assert.equal(story?.closeOnFind, false);
});

test("the Apple Watch remains found in the manifest and route-page public copy", async () => {
  const watch = freshDropManifest.find((item) => item.id === "case-item-watch");
  assert.equal(watch?.status, "found");
  assert.equal(watch?.description, "Found. Its finder has it.");

  const route = await readFile(new URL("../route.html", import.meta.url), "utf8");
  assert.match(route, /Apple Watch has been found/i);
  assert.doesNotMatch(route, /Apple Watch[^\n]*may appear/i);
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const fakeItem = (manifestItem, overrides = {}) => ({
  id: manifestItem.id,
  slug: manifestItem.slug,
  owner: manifestItem.owner,
  category: manifestItem.category,
  title: manifestItem.title,
  description: manifestItem.description,
  finderKeeps: manifestItem.finderKeeps,
  closeOnFind: manifestItem.closeOnFind,
  status: manifestItem.status ?? "out_there",
  displayOrder: 100 + manifestItem.collectionOrder,
  collection: "fresh_drops",
  collectionOrder: manifestItem.collectionOrder,
  audience: manifestItem.audience,
  showOnBoard: manifestItem.showOnBoard,
  teaserOrder: manifestItem.teaserOrder,
  reportable: manifestItem.reportable,
  version: 1,
  uploads: [],
  ...overrides,
});

function fakeImporterServer({ environment = "validation", readyMedia = true } = {}) {
  const camera = freshDropManifest.find((item) => item.id === "case-item-camera");
  const watch = freshDropManifest.find((item) => item.id === "case-item-watch");
  assert.ok(camera && watch);
  const cameraBytes = Buffer.from(camera.media[0].source);
  const state = {
    items: [
      fakeItem(camera, {
        uploads: [{
          id: "existing-camera-media",
          status: "ready",
          sourceSha256: digest(cameraBytes),
          position: null,
          altText: null,
          caption: null,
          audience: "public",
        }],
      }),
      fakeItem(watch),
    ],
    requests: [],
  };

  const response = (data, status = 200) => new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
  const findItem = (id) => state.items.find((item) => item.id === id);
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    state.requests.push({ method, path: url.pathname });
    if (url.pathname === "/api/v1/config" && method === "GET") {
      return response({ deploymentEnvironment: environment });
    }
    if (url.pathname === "/api/v1/ops/items" && method === "GET") {
      if (readyMedia) {
        for (const item of state.items) {
          for (const upload of item.uploads) if (upload.status === "processing") upload.status = "ready";
        }
      }
      return response(state.items);
    }
    if (url.pathname === "/api/v1/ops/items" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const item = { ...body, id: `server-${body.slug}`, version: 1, uploads: [] };
      state.items.push(item);
      return response(item, 201);
    }
    const mediaMatch = url.pathname.match(/^\/api\/v1\/ops\/items\/([^/]+)\/media$/);
    if (mediaMatch && method === "POST") {
      const item = findItem(decodeURIComponent(mediaMatch[1]));
      assert.ok(item);
      const files = init.body.getAll("images");
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        item.uploads.push({
          id: `media-${item.slug}-${item.uploads.length + 1}`,
          status: "processing",
          sourceSha256: digest(bytes),
          position: null,
          altText: null,
          caption: null,
          audience: "hunter_only",
        });
      }
      return response(item, 201);
    }
    const itemMatch = url.pathname.match(/^\/api\/v1\/ops\/items\/([^/]+)$/);
    if (itemMatch && method === "PATCH") {
      const item = findItem(decodeURIComponent(itemMatch[1]));
      assert.ok(item);
      const body = JSON.parse(String(init.body));
      assert.equal(body.expectedVersion, item.version);
      Object.assign(item, body, { version: item.version + 1 });
      const selected = new Map(body.mediaSelections.map((selection, position) => [selection.id, { ...selection, position }]));
      item.uploads = item.uploads.map((upload) => ({ ...upload, ...(selected.get(upload.id) ?? { position: null }) }));
      delete item.expectedVersion;
      delete item.mediaSelections;
      return response(item);
    }
    return response({ code: "not_found" }, 404);
  };
  return { state, fetchImpl };
}

const importerOptions = (server, overrides = {}) => ({
  origin: "https://codex-validation.seba-treasure-hunt.pages.dev",
  sourceDirectory: "C:/private/fresh-drops",
  token: "test-token-that-must-never-be-logged",
  fetchImpl: server.fetchImpl,
  readFile: async (file) => Buffer.from(path.basename(file)),
  sha256: digest,
  sleep: async () => {},
  ...overrides,
});

test("the importer rejects production before making a request without both explicit guards", async () => {
  let calls = 0;
  const options = {
    origin: "https://www.timlostsomething.com",
    sourceDirectory: "C:/private/fresh-drops",
    token: "secret-token",
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
    readFile: async () => Buffer.from("unused"),
    sha256: digest,
    sleep: async () => {},
  };
  await assert.rejects(() => importFreshDrops(options), /production import requires/i);
  assert.equal(calls, 0);
  await assert.rejects(() => importFreshDrops({ ...options, allowProduction: true }), /production import requires/i);
  assert.equal(calls, 0);
});

test("the validation importer fails before mutation when runtime identity is not validation", async () => {
  const server = fakeImporterServer({ environment: "production" });
  await assert.rejects(() => importFreshDrops(importerOptions(server)), /expected validation/i);
  assert.deepEqual(server.state.requests, [{ method: "GET", path: "/api/v1/config" }]);
});

test("the importer patches seeded items, skips matching hashes, and reruns without creates or uploads", async () => {
  const server = fakeImporterServer();
  const first = await importFreshDrops(importerOptions(server));
  assert.equal(first.created.length, freshDropManifest.length - 2);
  const expectedUploadCount = freshDropManifest.reduce((total, item) => total + item.media.length, 0) - 1;
  assert.equal(first.uploaded.length, expectedUploadCount);
  assert.equal(first.skipped.some((entry) => entry.source === "16-IMG_5615.jpg" && entry.reason === "hash_exists"), true);
  assert.equal(server.state.requests.filter((entry) => entry.method === "POST" && entry.path === "/api/v1/ops/items").length,
    freshDropManifest.length - 2);
  assert.equal(server.state.items.filter((item) => item.slug === "camera").length, 1);
  assert.equal(server.state.items.filter((item) => item.slug === "apple-watch").length, 1);
  const watchAfterFirstImport = server.state.items.find((item) => item.slug === "apple-watch");
  assert.equal(watchAfterFirstImport?.status, "found");
  assert.equal(watchAfterFirstImport?.description, "Found. Its finder has it.");
  assert.equal(
    server.state.items
      .filter((item) => item.slug !== "apple-watch")
      .every((item) => item.status === "out_there"),
    true
  );
  const watchVersionAfterFirstImport = watchAfterFirstImport?.version;

  const createsBefore = server.state.requests.filter((entry) => entry.method === "POST" && entry.path === "/api/v1/ops/items").length;
  const mediaBefore = server.state.requests.filter((entry) => entry.method === "POST" && entry.path.endsWith("/media")).length;
  const second = await importFreshDrops(importerOptions(server));
  assert.equal(second.created.length, 0);
  assert.equal(second.uploaded.length, 0);
  const watchAfterSecondImport = server.state.items.find((item) => item.slug === "apple-watch");
  assert.equal(watchAfterSecondImport?.status, "found");
  assert.equal(watchAfterSecondImport?.description, "Found. Its finder has it.");
  assert.equal(watchAfterSecondImport?.version, watchVersionAfterFirstImport);
  assert.equal(server.state.requests.filter((entry) => entry.method === "POST" && entry.path === "/api/v1/ops/items").length, createsBefore);
  assert.equal(server.state.requests.filter((entry) => entry.method === "POST" && entry.path.endsWith("/media")).length, mediaBefore);
});

test("a media timeout leaves the item Draft, identifies the safe source, and stops later items", async () => {
  const server = fakeImporterServer({ readyMedia: false });
  await assert.rejects(
    () => importFreshDrops(importerOptions(server)),
    /fresh-drops-story.*01-IMG_5645\.jpg/i,
  );
  const story = server.state.items.find((item) => item.slug === "fresh-drops-story");
  assert.equal(story?.status, "draft");
  assert.equal(server.state.items.some((item) => item.slug === "toy-car"), false);
});
