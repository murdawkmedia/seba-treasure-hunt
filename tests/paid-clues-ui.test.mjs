import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { CAMPAIGN_MORE_MENU, CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("Clues is a registered public case file under More", async () => {
  assert.equal(CAMPAIGN_PAGES["clues.html"], "clues");
  assert.deepEqual(
    CAMPAIGN_MORE_MENU.find(({ route }) => route === "clues"),
    { route: "clues", label: "Clues", href: "/clues" },
  );

  const html = await read("clues.html");
  const rendered = renderCampaignPage(html, "clues.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/clues"/);
  assert.match(html, /data-clue-catalogue/);
  assert.match(html, /data-clue-list/);
  assert.match(html, /Clue 01/);
  assert.match(html, /Riddle/);
  assert.match(html, /Decoder/);
  assert.match(rendered, /aria-current="page"[^>]*>Clues<\/a>/);
});

test("the Clues page is answer-first, non-daily, and explains next-clue early access", async () => {
  const html = await read("clues.html");
  assert.match(html, /Clues arrive without a fixed schedule/i);
  assert.match(html, /Released riddles are public/i);
  assert.match(html, /next clue for \$5 CAD/i);
  assert.match(html, /No clue beyond the next one can be purchased/i);
  assert.match(html, /does not affect (?:your )?ability to search or keep an eligible find/i);
  assert.doesNotMatch(html, /Day\s*\d+|30 days|daily clue/i);
  assert.doesNotMatch(html, /tim@businessasaforceforgood\.ca/i, "payment address must come from the environment-aware API");
});

test("the homepage introduces the clue case file without replacing the three primary actions", async () => {
  const html = await read("index.html");
  assert.match(html, /data-paid-clues-teaser/);
  assert.match(html, /href="\/clues"/);
  assert.match(html, /Clue 01/i);
  assert.doesNotMatch(html, /Day\s*1/i);
});

test("My Hunt has a clue ledger and plain waiting-verification language", async () => {
  const html = await read("dashboard.html");
  assert.match(html, /data-my-clues/);
  assert.match(html, /data-my-clue-list/);
  assert.match(html, /My Clues/);
  assert.match(html, /one next clue for \$5 CAD/i);
  assert.match(html, /Waiting for verification/i);
  assert.match(html, /data-clue-order-dialog/);
  assert.match(html, /I sent it/i);
});

test("Ops exposes a task-first Clues & Decoder Sales workspace", async () => {
  const html = await read("ops.html");
  assert.match(html, /data-view="clues"/);
  assert.match(html, /data-view-panel="clues"/);
  assert.match(html, /Clues &amp; Early-Access Sales/);
  assert.match(html, /Release the next clue/);
  assert.match(html, /Pending e-transfer verification/);
  assert.match(html, /data-ops-clue-orders-more/);
  assert.match(html, /Nothing publishes automatically/i);
});

test("public client never embeds private prototype clue content", async () => {
  const client = await read("src/client/clues.ts");
  assert.match(client, /\/api\/v1\/clues/);
  assert.match(client, /campaignHunterSession/);
  assert.doesNotMatch(client, /napkin|internalScore|tim@businessasaforceforgood\.ca/i);
});
