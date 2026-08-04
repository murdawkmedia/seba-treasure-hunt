import assert from "node:assert/strict";
import test from "node:test";
import {
  itemPlacementModel,
  normalizeItem
} from "../src/client/ops-items";

test("Ops preserves item and media audiences", () => {
  const item = normalizeItem({
    id: "case-item-wallet",
    slug: "wallet",
    owner: "tim",
    category: "accessory",
    title: "A wallet",
    description: "Out there",
    finderKeeps: false,
    closeOnFind: true,
    status: "out_there",
    displayOrder: 24,
    version: 2,
    collection: "fresh_drops",
    collectionOrder: 7,
    audience: "hunter_only",
    showOnBoard: false,
    teaserOrder: null,
    reportable: true,
    uploads: [{
      id: "media-wallet",
      status: "ready",
      audience: "hunter_only",
      sourceSha256: "a".repeat(64),
      position: 0,
      altText: "A wallet"
    }]
  });

  assert.equal(item?.audience, "hunter_only");
  assert.equal(item?.closeOnFind, true);
  assert.equal(item?.collection, "fresh_drops");
  assert.equal(item?.uploads[0]?.audience, "hunter_only");
  assert.equal(item?.uploads[0]?.sourceSha256, "a".repeat(64));
});

test("hunter-only placement disables public controls", () => {
  assert.deepEqual(itemPlacementModel("hunter_only", false, null), {
    showOnBoardEnabled: false,
    teaserEnabled: false,
    explanation: "Visible only to participation-unlocked hunters."
  });
});

test("an occupied teaser slot requires an explicit replacement choice", () => {
  assert.deepEqual(
    itemPlacementModel("public", false, 1, { id: "case-item-camera", title: "A camera" }),
    {
      showOnBoardEnabled: true,
      teaserEnabled: true,
      explanation: "Teaser slot 1 currently shows A camera. Choose Replace to move it."
    }
  );
});
test("quick item status controls only offer paired transitions with the exact title", async () => {
  const { quickItemStatusAction, quickItemStatusConfirmation } = await import("../src/client/ops-items");
  assert.deepEqual(quickItemStatusAction("out_there"), { target: "found", label: "Mark found" });
  assert.deepEqual(quickItemStatusAction("found"), { target: "out_there", label: "Mark out there" });
  assert.equal(quickItemStatusAction("draft"), null);
  assert.equal(quickItemStatusAction("paused"), null);
  assert.match(quickItemStatusConfirmation("Tim's exact Apple Watch", "found"), /Tim's exact Apple Watch/);
  assert.match(quickItemStatusConfirmation("Tim's exact Apple Watch", "found"), /FOUND/);
});

test("quick item status posts only the focused mutation and reloads authoritative items on success or conflict", async () => {
  const { requestQuickItemStatus } = await import("../src/client/ops-items");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let reloads = 0;
  const request = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      response: new Response(JSON.stringify({ data: {} }), { status: calls.length === 1 ? 200 : 409 }),
      payload: { data: {} }
    };
  };
  await requestQuickItemStatus("item-watch", 4, "found", request, async () => { reloads += 1; });
  await requestQuickItemStatus("item-watch", 5, "out_there", request, async () => { reloads += 1; });
  assert.equal(reloads, 2);
  assert.deepEqual(calls.map(({ url, init }) => ({
    url,
    method: init?.method,
    body: JSON.parse(String(init?.body))
  })), [
    {
      url: "/api/v1/ops/items/item-watch/status",
      method: "POST",
      body: { expectedVersion: 4, status: "found", confirmed: true }
    },
    {
      url: "/api/v1/ops/items/item-watch/status",
      method: "POST",
      body: { expectedVersion: 5, status: "out_there", confirmed: true }
    }
  ]);
});

test("quick item status controls run through the rendered delegated click path", async () => {
  const [{ chromium }, { build }] = await Promise.all([
    import("@playwright/test"),
    import("esbuild")
  ]);
  const output = await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/client/ops-items.ts"],
    bundle: true,
    format: "iife",
    globalName: "OpsItemsTestModule",
    platform: "browser",
    write: false,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section data-ops-guide="items"><span data-guide-state></span><span data-guide-next></span></section><section data-ops-items></section></main>');
    await page.addScriptTag({ content: output.outputFiles[0]?.text ?? "" });
    await page.addScriptTag({ content: String.raw`window.opsItemsHarness = (async () => {
      const item = (id, status, title, version) => ({
        id, slug: id, owner: "tim", category: "prize", title, description: "Private item detail.",
        finderKeeps: true, closeOnFind: true, status, displayOrder: version,
        collection: "case", collectionOrder: null, audience: "public", showOnBoard: false,
        teaserOrder: null, reportable: true, version, updatedAt: "2026-08-04T00:00:00.000Z",
        uploads: [], history: []
      });
      const state = window;
      state.items = [
        item("item-watch", "out_there", "Tim's precise watch", 4),
        item("item-id", "found", "Tim's ID", 2),
        item("item-draft", "draft", "Private draft", 1)
      ];
      state.requests = [];
      state.confirms = [];
      state.itemLoads = 0;
      state.nextStatus = 200;
      state.releaseStatus = null;
      state.nativeSubmits = 0;
      Object.defineProperty(window, "confirm", { value: (message) => {
        state.confirms.push(message);
        return true;
      } });
      document.querySelector("[data-ops-items]")?.addEventListener("submit", () => { state.nativeSubmits += 1; });
      const module = window.OpsItemsTestModule;
      module.setupOpsItems({
        request: async (url, init) => {
          if (url === "/api/v1/ops/items") {
            state.itemLoads += 1;
            return { response: new Response(JSON.stringify({ data: state.items }), { status: 200 }), payload: { data: structuredClone(state.items) } };
          }
          state.requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
          const status = state.nextStatus;
          const respond = () => {
            if (status === 200) {
              const current = state.items.find((candidate) => candidate.id === "item-watch");
              if (current) {
                current.status = current.status === "out_there" ? "found" : "out_there";
                current.version = Number(current.version) + 1;
              }
            }
            return { response: new Response(JSON.stringify({ data: {} }), { status }), payload: { data: {} } };
          };
          if (status === 200 && state.releaseStatus === null) {
            return await new Promise((resolve) => { state.releaseStatus = () => resolve(respond()); });
          }
          return respond();
        },
        fetchBinary: async () => new Response(null, { status: 404 }),
        onAnnouncementDraft: async () => undefined
      });
      await module.loadOpsItems();
    })()` });
    await page.evaluate("window.opsItemsHarness");

    assert.equal(await page.locator('[data-item-id="item-watch"] [data-item-quick-status="found"]').textContent(), "Mark found");
    assert.equal(await page.locator('[data-item-id="item-id"] [data-item-quick-status="out_there"]').textContent(), "Mark out there");
    assert.equal(await page.locator('[data-item-id="item-draft"] [data-item-quick-status]').count(), 0);
    await page.locator('[data-item-id="item-watch"] [data-item-quick-status="found"]').click();
    await page.locator('[data-item-id="item-watch"] [data-item-quick-status="found"]').click({ force: true });
    await page.waitForFunction(() => (window as typeof window & { requests: unknown[] }).requests.length === 1);
    assert.deepEqual(await page.evaluate(() => {
      const state = window as typeof window & { requests: Array<{ url: string; body: Record<string, unknown> | null }>; confirms: string[]; nativeSubmits: number };
      return { requests: state.requests, confirms: state.confirms, nativeSubmits: state.nativeSubmits };
    }), {
      requests: [{ url: "/api/v1/ops/items/item-watch/status", body: { expectedVersion: 4, status: "found", confirmed: true } }],
      confirms: ["Mark Tim's precise watch as FOUND? This audited status change does not publish an announcement."],
      nativeSubmits: 0
    });
    await page.evaluate(() => (window as typeof window & { releaseStatus: (() => void) | null }).releaseStatus?.());
    await page.waitForFunction(() => {
      const result = document.querySelector<HTMLElement>('[data-item-id="item-watch"] [data-item-result]');
      return result?.textContent === "Item marked FOUND." && document.activeElement === result && result.tabIndex === -1;
    });
    await page.evaluate(() => { (window as typeof window & { nextStatus: number; releaseStatus: (() => void) | null }).nextStatus = 409; });
    await page.locator('[data-item-id="item-watch"] [data-item-quick-status="out_there"]').click();
    await page.waitForFunction(() => {
      const result = document.querySelector<HTMLElement>('[data-item-id="item-watch"] [data-item-result]');
      return result?.textContent === "This item changed. The current item list was refreshed." && document.activeElement === result && result.tabIndex === -1;
    });
    assert.equal(await page.evaluate(() => {
      const state = window as typeof window & { requests: Array<{ url: string }>; itemLoads: number };
      return state.itemLoads === 3 && state.requests.every((request) => request.url.endsWith("/status"));
    }), true);
  } finally {
    await browser.close();
  }
});
