import assert from "node:assert/strict";
import test from "node:test";
import { freshDropReportHref, normalizeFreshDrops } from "../src/client/fresh-drops";
import { publicFreshDropTeaser } from "../src/client/items";

test("Fresh Drops keeps story first and accepts only authenticated media URLs", () => {
  const items = normalizeFreshDrops([
    { id: "item", slug: "wallet", category: "accessory", title: "A wallet", description: "Out there", owner: "tim", status: "out_there", reportable: true, collectionOrder: 7, media: [{ id: "m1", url: "/public/leak.jpg", alt: "A wallet" }] },
    { id: "story", slug: "fresh-drops-story", category: "story_evidence", title: "Tim went looking again.", description: "More fell out.", owner: "tim", status: "out_there", reportable: false, collectionOrder: 0, media: [] },
  ]);
  assert.deepEqual(items.map((item) => item.id), ["story", "item"]);
  assert.equal(items[0]?.reportable, false);
  assert.equal(items[1]?.media[0]?.url, "/api/v1/me/fresh-drops/media/m1");
});

test("report links contain only the stable item identifier", () => {
  assert.equal(freshDropReportHref("case-item-wallet"), "/report?item=case-item-wallet&source=fresh-drops");
  assert.equal(freshDropReportHref("../../private"), "/report");
});

test("public teaser uses only slots one and two", () => {
  const teaser = publicFreshDropTeaser([
    { slug: "camera", owner: "tim", title: "A camera", description: "Out there", finderKeeps: true, status: "out_there", media: [{ id: "camera-media", url: "/api/v1/media/camera-media", alt: "A camera" }], audience: "public", showOnBoard: false, teaserOrder: 1 },
    { slug: "wallet", owner: "tim", title: "A wallet", description: "Out there", finderKeeps: true, status: "out_there", media: [], audience: "hunter_only", showOnBoard: false, teaserOrder: null },
    { slug: "toy-car", owner: "tim", title: "A tiny toy car", description: "Yes, really.", finderKeeps: true, status: "out_there", media: [{ id: "toy-media", url: "/api/v1/media/toy-media", alt: "A tiny toy car" }], audience: "public", showOnBoard: false, teaserOrder: 2 },
  ]);
  assert.deepEqual(teaser.map((item) => item.slug), ["camera", "toy-car"]);
});
