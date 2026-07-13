import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

const workerPath = new URL("../canonical-host-worker.mjs", import.meta.url);
const entryPath = new URL("../_worker.js", import.meta.url);

test("the bare campaign hostname redirects permanently and preserves the URL", async () => {
  assert.ok(existsSync(workerPath), "canonical host worker should exist");
  assert.ok(existsSync(entryPath), "Pages worker entrypoint should exist");

  const { default: worker } = await import(workerPath);
  const response = await worker.fetch(
    new Request("https://timlostsomething.com/route?source=apex-test"),
    { ASSETS: { fetch: () => new Response("unexpected") } },
  );

  assert.equal(response.status, 301);
  assert.equal(
    response.headers.get("location"),
    "https://www.timlostsomething.com/route?source=apex-test",
  );
});

test("the canonical hostname and Pages aliases pass through to static assets", async () => {
  assert.ok(existsSync(workerPath), "canonical host worker should exist");

  const { default: worker } = await import(workerPath);
  const seen = [];
  const env = {
    ASSETS: {
      fetch(request) {
        seen.push(request.url);
        return new Response("asset", { status: 200 });
      },
    },
  };

  const canonical = await worker.fetch(
    new Request("https://www.timlostsomething.com/interview"),
    env,
  );
  const pagesAlias = await worker.fetch(
    new Request("https://seba-treasure-hunt.pages.dev/route"),
    env,
  );

  assert.equal(canonical.status, 200);
  assert.equal(pagesAlias.status, 200);
  assert.deepEqual(seen, [
    "https://www.timlostsomething.com/interview",
    "https://seba-treasure-hunt.pages.dev/route",
  ]);
});

test("removed partner and repository paths return 404 before asset fallback", async () => {
  const { default: worker } = await import(workerPath);
  const seen = [];
  const env = {
    ASSETS: {
      fetch(request) {
        seen.push(request.url);
        return new Response("stale asset", { status: 200 });
      },
    },
  };
  const removedPartner = String.fromCharCode(67, 70, 67, 87).toLowerCase();
  const blockedPaths = [
    `/assets/${removedPartner}-logo.png`,
    "/docs/internal-note.md",
    "/tests/public-contract.test.mjs",
    "/scripts/build-public.mjs",
  ];

  for (const pathname of blockedPaths) {
    const response = await worker.fetch(
      new Request(`https://www.timlostsomething.com${pathname}`),
      env,
    );
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers.get("cache-control"), "no-store", pathname);
  }

  assert.deepEqual(seen, []);
});
