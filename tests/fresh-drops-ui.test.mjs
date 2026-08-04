import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const read = (file) => readFile(path.resolve(file), "utf8");

test("Ops explains Fresh Drops visibility and previews both audiences", async () => {
  const [html, client, styles] = await Promise.all([
    read("ops.html"),
    read("src/client/ops-items.ts"),
    read("css/ops.css")
  ]);

  assert.match(html, /Choose who can see it, then choose where it appears/i);
  for (const field of ["collection", "collectionOrder", "audience", "teaserOrder", "showOnBoard", "reportable"]) {
    assert.match(html, new RegExp(`name=["']${field}["']`));
  }
  assert.match(client, /Public preview/);
  assert.match(client, /Signed-in hunter preview/);
  assert.match(client, /Keep current teaser/);
  assert.match(client, /Replace it/);
  assert.match(client, /Image visibility/);
  assert.match(styles, /\.ops-item-previews/);
  assert.match(styles, /\.ops-teaser-conflict/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
});

test("My Hunt places the authenticated Fresh Drops case file before the private 13-place checklist", async () => {
  const [html, client, styles] = await Promise.all([
    read("dashboard.html"),
    read("src/client/dashboard.ts"),
    read("css/fresh-drops.css")
  ]);

  assert.match(html, /id="fresh-drops"[^>]*data-fresh-drops/);
  assert.ok(html.indexOf("data-fresh-drops") < html.indexOf("data-dashboard-waypoints"));
  assert.match(html, /data-fresh-drops-story/);
  assert.match(html, /data-fresh-drops-items/);
  assert.match(html, /\/css\/route-lightbox\.css/);
  assert.match(client, /participationUnlocked === true[\s\S]*initializeFreshDrops/);
  assert.match(client, /destination\.hash === "#fresh-drops"/);
  assert.match(styles, /object-fit:\s*contain/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /\.fresh-drops__item h3[\s\S]*color:\s*var\(--fresh-ink\)/);
  assert.match(styles, /\.hunter-page \.fresh-drops__report[\s\S]*color:\s*#092b24/);
  assert.match(styles, /\.fresh-drops__status[\s\S]*background:\s*#a63a2c/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("the public board teases exactly two Fresh Drops and sends hunters to the locked file", async () => {
  const html = await read("index.html");
  assert.match(html, /data-fresh-drops-teaser/);
  assert.match(html, /data-fresh-drops-teaser-items/);
  assert.equal((html.match(/data-fresh-drop-teaser=/g) ?? []).length, 2);
  assert.match(html, /href="\/dashboard\?returnTo=%2Fdashboard%23fresh-drops"/);
});

test("Fresh Drops preserve semantic order, descriptive alternatives, and keyboard-operable media", async () => {
  const [client, viewer, styles] = await Promise.all([
    read("src/client/fresh-drops.ts"),
    read("src/client/approved-media-viewer.ts"),
    read("css/fresh-drops.css"),
  ]);

  assert.ok(client.indexOf("storyItem") < client.indexOf("reportableItems"));
  assert.match(client, /if \(!mediaId \|\| !alt\) return \[\]/);
  assert.match(client, /No photo released/);
  assert.match(client, /Image temporarily unavailable/);
  assert.match(client, /aria-label`, `I found this: \$\{item\.title\}`|setAttribute\("aria-label", `I found this: \$\{item\.title\}`\)/);
  for (const control of ["Close", "Previous image", "Next image"]) assert.match(viewer, new RegExp(control));
  assert.match(viewer, /ArrowLeft/);
  assert.match(viewer, /ArrowRight/);
  assert.match(viewer, /Escape/);
  assert.match(viewer, /restore\?\.focus\(\)/);
  assert.match(styles, /@media\s*\(max-width:\s*360px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(client, /\b(?:latitude|longitude|sourceSha256|privateObjectKey)\b/);
});

test("incomplete registration never presents Fresh Drops or private progress as stalled", async () => {
  const [dashboard, freshDrops] = await Promise.all([
    read("src/client/dashboard.ts"),
    read("src/client/fresh-drops.ts"),
  ]);

  assert.match(freshDrops, /export function showFreshDropsLocked/);
  assert.match(freshDrops, /Finish registration to open Fresh Drops/);
  assert.match(freshDrops, /href\s*=\s*target/);
  assert.match(dashboard, /showFreshDropsLocked\(/);
  assert.match(dashboard, /checkbox\.disabled\s*=\s*!participationUnlocked/);
  assert.match(dashboard, /Finish registration to save private progress/);
});
