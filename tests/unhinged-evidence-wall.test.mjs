import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { CAMPAIGN_MENU, CAMPAIGN_MORE_MENU, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const read = (file) => readFile(path.resolve(file), "utf8");

test("the canonical shell exposes three obvious actions and four secondary destinations", async () => {
  assert.deepEqual(CAMPAIGN_MENU.map(({ label, href }) => [label, href]), [
    ["Where to Look", "/route"],
    ["I Found Something", "/report"],
    ["My Hunt", "/dashboard"],
  ]);
  assert.deepEqual(CAMPAIGN_MORE_MENU.map(({ label, href }) => [label, href]), [
    ["Latest News", "/updates"],
    ["What People Found", "/clue-board"],
    ["Tim's Story", "/interview"],
    ["Rules & Safety", "/rules"],
  ]);
  const rendered = renderCampaignPage(await read("index.html"), "index.html");
  assert.match(rendered, /<details class="campaign-more"/);
  assert.match(rendered, /<summary>More<\/summary>/);
  assert.match(rendered, /Tim found his ID|Tim's ID was found/i);
  assert.doesNotMatch(rendered, /Tim lost his ID<\/span>/i);
});

test("the Apple Watch fallback is found everywhere public copy describes the current case", async () => {
  const html = await read("index.html");
  const watch = html.match(/<li\b(?=[^>]*data-case-item="apple-watch")[^>]*>[\s\S]*?<\/li>/)?.[0] ?? "";
  assert.match(watch, /data-case-item-status="found"/);
  assert.match(watch, /evidence-card--found/);
  assert.match(watch, /class="evidence-stamp"[^>]*>FOUND<\/span>/);
  assert.match(watch, /Found\. Its finder has it\./);
  assert.match(html, /<meta property="og:description" content="[^"]*Apple Watch[^\"]*found/i);
  assert.match(html, /"description": "[^\"]*Apple Watch[^\"]*found/i);
  assert.match(html, /What can the finder keep\?[\s\S]*Apple Watch has been found/i);
  assert.match(html, /Was the ID found\?<\/dt><dd>[^<]*Apple Watch has been found/i);
  assert.doesNotMatch(html, /(?:cash, rings, camera, (?:an? )?Apple Watch|Apple Watch, sunglasses)[^<]{0,100}(?:still )?out there/i);
});

test("the homepage is a dynamic evidence wall with a reversible FOUND treatment", async () => {
  const html = await read("index.html");
  assert.match(html, /data-case-item-board/);
  assert.match(html, /data-case-item="tims-id"/);
  assert.match(html, /data-case-item-status="found"/);
  assert.match(html, /tim-lost-id-campaign-prop\.webp/);
  assert.match(html, /class="evidence-stamp"[^>]*>FOUND<\/span>/);
  assert.match(html, /data-case-items-state[^>]*aria-live="polite"/);
  assert.match(html, /assets\/app\/items\.js/);
  assert.match(html, /camera/i);
  assert.match(html, /Apple Watch/i);
  assert.match(html, /purse/i);
  assert.match(html, /orange In the Woods logo/i);
  assert.match(html, /approaching \$10,000[\s\S]{0,120}(?:estimate|not a guarantee)/i);
  assert.doesNotMatch(html, /approaching \$10,000[\s\S]{0,40}(?:is )?guaranteed/i);
  for (const slug of ["diamond-rings", "camera", "apple-watch", "purse"]) {
    const card = html.match(new RegExp(`<li\\b(?=[^>]*data-case-item="${slug}")[^>]*>[\\s\\S]*?<\\/li>`))?.[0] ?? "";
    assert.match(card, /<img\b[^>]*alt="[^"]+"/, `${slug} needs real public evidence`);
  }
});

test("the public finder message tells people to keep ordinary finds and offers human contact", async () => {
  const html = await read("index.html");
  assert.match(html, /Found something\? Keep it\. Then tell us\./i);
  assert.match(html, /Photos are optional/i);
  assert.match(html, /href="tel:\+17809096544"/);
  assert.match(html, /href="sms:\+17809096544"/);
  assert.match(html, /href="mailto:casey@sebahub\.com"/i);
  assert.match(html, /ID was the return-only item[\s\S]*has been found/i);
  assert.match(html, /return the ball when you redeem/i);
  assert.doesNotMatch(html, /Leave it where it is/i);
});

test("Stop 11 keeps its stable identity while linking Brewing at Seba", async () => {
  const route = await read("route.html");
  const report = await read("report.html");
  assert.match(route, /id="stop-11"[\s\S]*?The Driving Range &amp; <a href="https:\/\/brewingatseba\.com\/"/i);
  assert.match(report, /option value="10"[^>]*data-route-order="11"[^>]*>Stop 11 · Driving Range \/ Brewing at Seba<\/option>/);
});

test("public and Hunter action groups stay separated and stack on phones", async () => {
  const [html, shell, fresh] = await Promise.all([
    read("index.html"),
    read("css/campaign-shell.css"),
    read("css/fresh-drops.css"),
  ]);
  assert.match(html, /cta-row action-group/);
  assert.match(html, /fresh-drops-teaser__actions/);
  assert.match(shell, /\.campaign-page:not\(\.ops-page\)[\s\S]*\.action-group[\s\S]*gap:\s*12px/);
  assert.match(shell, /min-height:\s*48px/);
  assert.match(shell, /@media\s*\(max-width:\s*760px\)[\s\S]*flex-direction:\s*column/);
  assert.match(shell, /@media\s*\(max-width:\s*760px\)[\s\S]*width:\s*100%/);
  assert.match(fresh, /\.fresh-drops-teaser__actions[\s\S]*width:\s*min\(100%,\s*860px\)/);
});

test("the evidence board has a semantic mobile fallback instead of a pan-and-zoom canvas", async () => {
  const [html, styles] = await Promise.all([read("index.html"), read("css/evidence-wall.css")]);
  assert.match(html, /<ol class="evidence-wall__items"/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*\.evidence-wall__items/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(styles, /overflow:\s*(?:scroll|auto)[^}]*transform:\s*scale/i);
});

test("evidence-board media opens in the shared full-image viewer and document evidence is never cropped", async () => {
  const [html, client, styles] = await Promise.all([
    read("index.html"),
    read("src/client/items.ts"),
    read("css/evidence-wall.css"),
  ]);

  assert.match(html, /<link rel="stylesheet" href="\/css\/route-lightbox\.css"/);
  assert.match(client, /initializeApprovedMediaViewer/);
  assert.match(client, /data-approved-media/);
  assert.match(client, /data-media-gallery/);
  assert.match(client, /evidence-card__photo--document/);
  assert.match(styles, /\.evidence-card__photo\.evidence-card__photo--document img\s*\{[^}]*max-height:\s*none[^}]*object-fit:\s*contain/s);
});

test("public metadata and answers describe the ID as found", async () => {
  for (const file of ["index.html", "route.html", "start.html", "updates.html", "golf-balls.html"]) {
    const html = await read(file);
    assert.doesNotMatch(html, /ID and (?:two diamond )?rings (?:are |remain )?missing/i, file);
    assert.doesNotMatch(html, /1 Missing ID Bundle/i, file);
  }
  const interview = await read("interview.html");
  assert.match(interview, /recorded before (?:Tim's |the )?ID was found/i);
});

test("signup uses two plain consent cards with View, Accept, and a clear return action", async () => {
  const html = await read("dashboard.html");
  for (const kind of ["privacy-media", "waiver"]) {
    const card = html.match(new RegExp(`<article\\b(?=[^>]*data-signup-consent-card="${kind}")[^>]*>[\\s\\S]*?<\\/article>`))?.[0] ?? "";
    assert.match(card, /data-signup-review/);
    assert.match(card, /data-signup-accept/);
    assert.match(card, />View</);
    assert.match(card, />Accept</);
    const dialog = html.match(new RegExp(`<dialog\\b(?=[^>]*data-signup-dialog="${kind}")[^>]*>[\\s\\S]*?<\\/dialog>`))?.[0] ?? "";
    assert.match(dialog, /data-signup-dialog-accept/);
    assert.match(dialog, /Accept &amp; back to signup/);
    assert.match(dialog, /Done &mdash; back to signup/);
  }
  assert.match(html, />Display name<\/label>/);
  assert.match(html, />Create my account<\/button>/);
});

test("the find flow starts with four human choices and ends with a reference receipt", async () => {
  const html = await read("report.html");
  for (const choice of [
    "I found an item",
    "I noticed something",
    "There is a safety problem",
    "Something else",
  ]) assert.match(html, new RegExp(choice, "i"));
  assert.match(html, /data-report-intake-choice/);
  assert.match(html, /data-report-reference/);
  assert.match(html, /What happens next/i);
});

test("My Hunt presents the existing per-hunter progress as a private 13-place checklist", async () => {
  const html = await read("dashboard.html");
  assert.match(html, /My Hunt/);
  assert.match(html, /Private 13-place checklist/);
  assert.match(html, /data-dashboard-waypoints/);
  assert.doesNotMatch(html, /\b(?:points|leaderboard|streak|ranking)\b/i);
});

test("Ops exposes the four task-first choices and the dynamic item editor", async () => {
  const html = await read("ops.html");
  for (const label of [
    "Review private reports",
    "Moderate public contributions",
    "Update what's out there",
    "Publish Latest News",
  ]) assert.match(html, new RegExp(label, "i"));
  assert.match(html, /data-view="items"/);
  assert.match(html, /data-view-panel="items"/);
  assert.match(html, /data-ops-items/);
  assert.match(html, /Draft[\s\S]*Out there[\s\S]*Found[\s\S]*Paused[\s\S]*Archived/);
});
