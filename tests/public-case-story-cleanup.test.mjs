import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSite } from "../scripts/build.mjs";
import { CAMPAIGN_MENU, CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the public case shell uses 13 Stops and has no sponsorship destination", () => {
  assert.equal(Object.hasOwn(CAMPAIGN_PAGES, "sponsors.html"), false);
  assert.deepEqual(CAMPAIGN_MENU.find((item) => item.route === "route"), {
    route: "route",
    label: "13 Stops",
    href: "/route",
  });
  assert.equal(CAMPAIGN_MENU.some((item) => item.route === "sponsors"), false);

  const home = renderCampaignPage(readFileSync(path.join(root, "index.html"), "utf8"), "index.html");
  assert.match(home, /Tim Lost Something\?<span>Tim lost his ID<\/span>/);
  assert.doesNotMatch(home, /Support the Search|href=["']\/?sponsors(?:\.html)?["']/i);
});

test("the README documents 13 Stops and the withdrawn public sponsorship surface", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");

  assert.match(readme, /\| `\/route` \| 13 Stops waypoint stories;/);
  assert.doesNotMatch(readme, /Lucky 13|\| `\/sponsors` \||submitted through `\/sponsors`/i);
  assert.match(readme, /Public sponsorship is withdrawn\./);
  assert.match(readme, /`sponsors\.html` source remains in the repository/);
  assert.match(readme, /Existing sponsor inquiry records remain private in the Ops Sponsors ledger\./);
});

test("the public build excludes the withdrawn sponsor page, stylesheet, and browser entries", async () => {
  const output = await buildSite({ temporary: true });
  try {
    assert.equal(existsSync(path.join(output.dist, "sponsors.html")), false);
    assert.equal(existsSync(path.join(output.dist, "css", "sponsors.css")), false);
    assert.equal(existsSync(path.join(output.dist, "assets", "app", "sponsors.js")), false);
    assert.equal(existsSync(path.join(output.dist, "assets", "app", "sponsor-submission.js")), false);
  } finally {
    await output.cleanup();
  }
});
