import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentPath = path.join(root, "docs", "qa", "2026-07-14-unified-campaign-shell-verification.md");
const expectedArtifactNames = [
  "screenshots/mobile-390x844-home.png",
  "screenshots/mobile-390x844-route.png",
  "screenshots/mobile-390x844-interview.png",
  "screenshots/mobile-390x844-clue-board.png",
  "screenshots/mobile-390x844-dashboard.png",
  "screenshots/mobile-390x844-sponsors.png",
  "screenshots/mobile-390x844-privacy.png",
  "screenshots/mobile-390x844-waiver.png",
  "screenshots/desktop-1440x1000-home.png",
  "screenshots/desktop-1440x1000-route.png",
  "screenshots/desktop-1440x1000-interview.png",
  "screenshots/desktop-1440x1000-clue-board.png",
  "screenshots/desktop-1440x1000-dashboard.png",
  "screenshots/desktop-1440x1000-sponsors.png",
  "screenshots/desktop-1440x1000-privacy.png",
  "screenshots/desktop-1440x1000-waiver.png",
  "screenshots/zoom-200-home-tab-focus.png",
  "screenshots/zoom-200-route-menu-open.png",
  "screenshots/zoom-200-waiver-main-focus.png",
];

function parseDocumentEvidence(markdown) {
  const rows = [...markdown.matchAll(/^\| `([^`]+\.png)` \| `([0-9a-f]{64})` \|$/gm)]
    .map(([, name, sha256]) => ({ artifactName: `screenshots/${name}`, sha256 }));
  const run = markdown.match(/The authoritative ledger for this table executed at `([^`]+)` \(run date `([^`]+)`\)\./);
  assert.ok(run, "the evidence document must identify the authoritative execution timestamp and run date");
  return { rows, executedAt: run[1], runDate: run[2] };
}

test("unified-shell evidence document has one complete artifact set and can verify a supplied ledger", async () => {
  const markdown = await readFile(documentPath, "utf8");
  const documented = parseDocumentEvidence(markdown);
  assert.deepEqual(documented.rows.map(({ artifactName }) => artifactName), expectedArtifactNames);
  assert.equal(new Set(documented.rows.map(({ artifactName }) => artifactName)).size, 19);
  assert.match(markdown, /all 19 rows below come from that one preserved unique OS-temporary artifact set/i);

  const suppliedLedgerPath = process.env.TIM_LOST_UNIFIED_SHELL_QA_LEDGER;
  if (!suppliedLedgerPath) return;
  const ledger = JSON.parse(await readFile(suppliedLedgerPath, "utf8"));
  assert.equal(ledger.ok, true);
  assert.equal(ledger.screenshots?.count, 19);
  assert.equal(documented.executedAt, ledger.executedAt);
  assert.equal(documented.runDate, ledger.runDate);
  assert.deepEqual(documented.rows, ledger.screenshots.artifacts);
});
