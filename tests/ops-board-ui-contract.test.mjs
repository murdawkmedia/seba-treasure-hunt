import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the clue board and operations console entry points exist", () => {
  for (const file of [
    "clue-board.html",
    "ops.html",
    "css/board.css",
    "css/ops.css",
    "src/client/board.ts",
    "src/client/ops.ts",
  ]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, file);
  }
});

test("public Case Notes are an accessible, moderated community surface", () => {
  const html = read("clue-board.html");
  const client = read("src/client/board.ts");

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/clue-board"/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /Community observation(?:&mdash;|-)not an official clue/i);
  assert.match(html, /id="waypoint-filter"/);
  assert.match(html, /All 13 waypoints/);
  assert.match(html, /id="board-feed"/);
  assert.match(html, /id="field-note-form"/);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /data-note-turnstile/);
  assert.match(html, /id="board-flag-dialog"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /Up to 3 images.*10 MB/i);
  assert.match(html, /aria-live="polite"/);
  assert.match(client, /\/api\/v1\/board\?waypoint=/);
  assert.match(client, /Community observation/);
  assert.match(client, /Board unavailable/i);
  assert.match(client, /No approved Case Notes/i);
  assert.match(client, /Report .*for review/i);
  assert.match(client, /action:\s*"field_note"/);
  assert.match(client, /action:\s*"reply"/);
  assert.match(client, /action:\s*"flag"/);
  assert.match(client, /turnstileApi\.render/);
  assert.match(client, /turnstileApi\.reset/);
  assert.doesNotMatch(client, /\bsetCaseStatus\b|\/api\/v1\/status|#case-signal/);
});

test("the case-room console exposes every approved ledger and safe account control", () => {
  const html = read("ops.html");
  const client = read("src/client/ops.ts");

  assert.match(html, /<meta name="robots" content="noindex,nofollow/);
  assert.match(html, /id="ops-sign-in-form"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /id="ops-sign-up-form"/);
  assert.match(html, /id="ops-sign-up-verify-form"/);
  assert.match(html, /Create staff account/i);
  assert.match(html, /sebahub\.com/i);
  assert.match(html, /businessasaforceforgood\.ca/i);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /id="ops-recovery-form"/);
  assert.match(html, /verification code/i);
  assert.match(html, /Optional authenticator MFA/i);

  for (const label of [
    "Command Desk",
    "Official Updates",
    "Private Reports",
    "Sponsors",
    "Moderation Queue",
    "Search Zones",
    "Rules Ledger",
    "Players",
    "Users & Access",
    "Audit Trail",
  ]) {
    assert.match(html, new RegExp(label.replace("&", "&amp;")));
  }

  assert.match(html, /Send recovery instructions/i);
  assert.match(html, /Revoke sessions/i);
  assert.match(html, /Suspend access/i);
  assert.match(html, /cannot see or choose another operator(?:&rsquo;|')s password/is);
  assert.doesNotMatch(html, /name="(?:other|peer)[-_ ]?password"/i);
  assert.match(client, /\/api\/v1\/ops\/session/);
  assert.match(client, /signUp\.create/);
  assert.match(client, /prepareEmailAddressVerification/);
  assert.match(client, /attemptEmailAddressVerification/);
  assert.match(client, /createSerializedSubmission/);
  assert.match(client, /\/api\/v1\/ops\/dashboard/);
  assert.match(html, /data-report-review-dialog/);
  assert.match(html, /aria-labelledby="report-review-title"/);
  assert.match(html, /data-report-review-close/);
  assert.match(html, /data-report-private-detail/);
  assert.match(html, /data-report-evidence/);
  assert.match(html, /data-report-status-actions/);
  assert.match(html, /data-report-publication-form/);
  assert.match(html, /data-report-public-preview/);
  assert.match(html, /id="report-publication-result"[^>]*aria-live="polite"/);
  assert.match(client, /\/api\/v1\/ops\/reports\/\$\{encodeURIComponent\([^)]*\)\}/);
  assert.match(client, /\/publish`/);
  assert.match(client, /\/unpublish`/);
  assert.match(client, /name="publishMedia"/);
  assert.match(client, /window\.confirm\([^)]*public/i);
  assert.match(client, /reportReviewTrigger\?\.isConnected/);
  assert.match(client, /data-report-review\]\[data-report-id/);
  assert.match(html, /id="sponsors-table"/);
  assert.match(html, /id="sponsor-state-filter"/);
  assert.match(html, /id="sponsor-support-filter"/);
  assert.match(html, /id="sponsor-search"/);
  assert.match(html, /id="sponsors-state"[^>]*aria-live="polite"/);
  assert.match(client, /\/api\/v1\/ops\/sponsors/);
  assert.match(client, /Accepted is an internal pipeline state\. It does not publish a sponsor\./);
  assert.doesNotMatch(client, /\/api\/v1\/ops\/sponsors\/export/);
  assert.doesNotMatch(html, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
});

test("public UI sources contain no real staff address or generic transition-all", () => {
  const sources = [
    "clue-board.html",
    "ops.html",
    "css/board.css",
    "css/ops.css",
    "src/client/board.ts",
    "src/client/ops.ts",
  ]
    .map(read)
    .join("\n");

  assert.doesNotMatch(sources, /@(?:sebahub|businessasaforceforgood)\.ca/i);
  assert.doesNotMatch(sources, /transition\s*:\s*all\b/i);
});

test("board controls marked hidden cannot be revived by component display rules", () => {
  assert.match(read("css/board.css"), /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("small case-room ledger labels use the accessible muted-ink token", () => {
  const css = read("css/ops.css");
  assert.match(css, /\.ops-sidebar__label\s*\{[^}]*color:\s*var\(--ops-muted\)/s);
  assert.match(css, /\.ops-nav-item\s*>\s*span\s*\{[^}]*color:\s*var\(--ops-muted\)/s);
  assert.match(css, /\.ops-sidebar__foot\s*\{[^}]*color:\s*var\(--ops-muted\)/s);
});

test("the report review drawer is responsive and keeps evidence constrained", () => {
  const css = read("css/ops.css");
  assert.match(css, /\.ops-report-dialog__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.ops-report-evidence img\s*\{[^}]*max-width:\s*100%/s);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.ops-report-dialog__grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("the private player ledger loads authorized rows and exports only in the client", () => {
  const html = read("ops.html");
  const client = read("src/client/ops.ts");
  assert.match(html, /id="subscribers-table"/);
  assert.match(html, /id="subscribers-state"[^>]*aria-live="polite"/);
  assert.match(html, /id="subscriber-load-more"/);
  assert.match(client, /\/api\/v1\/ops\/players/);
  assert.match(client, /new Blob\(/);
  assert.doesNotMatch(client, /\/api\/v1\/ops\/players\/export/);
});

test("legal detail is deliberately loaded in a private dialog and never bulk-exported", () => {
  const html = read("ops.html");
  const client = read("src/client/ops.ts");
  assert.match(html, /id="ops-waiver-dialog"/);
  assert.match(html, /id="waiver-detail-state"[^>]*aria-live="polite"/);
  assert.match(html, /data-waiver-detail/);
  assert.match(html, /data-retry-waiver-receipt/);
  assert.match(client, /\/api\/v1\/ops\/players\/\$\{encodeURIComponent\([^)]*\)\}\/waiver/);
  assert.match(client, /window\.confirm\([^)]*receipt/i);
  assert.doesNotMatch(client, /participant(s)?[^\n]{0,80}buildSubscriberCsv/i);
});
