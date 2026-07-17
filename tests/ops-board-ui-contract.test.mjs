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
  assert.match(html, /All Lucky 13 stops/);
  assert.match(html, /id="board-feed"/);
  assert.match(html, /id="field-note-form"/);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /data-note-turnstile/);
  assert.match(html, /id="board-flag-dialog"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /Up to 3 JPEG, PNG or WebP photos/i);
  assert.match(html, /Photos up to 20 MB upload directly/i);
  assert.match(html, /larger photos up to 50 MB will be optimized on this device/i);
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
  assert.match(html, /data-view="production-snapshot"[^>]*hidden/);
  assert.match(client, /deploymentEnvironment/);
  assert.match(client, /setProductionSnapshotAvailability/);
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
  assert.match(html, /Choose public destination/i);
  assert.match(html, /Keep private/i);
  assert.match(html, /Publish to Case Notes/i);
  assert.match(html, /Official Update/i);
  assert.match(html, /data-report-publish-case-note/);
  assert.match(html, /data-report-withdraw-case-note/);
  assert.match(html, /data-report-save-draft/);
  assert.match(html, /data-report-schedule/);
  assert.match(html, /data-report-scheduled-for/);
  assert.match(html, /data-report-publish-now/);
  assert.match(html, /id="report-publication-result"[^>]*aria-live="polite"/);
  assert.match(client, /\/api\/v1\/ops\/reports\/\$\{encodeURIComponent\([^)]*\)\}/);
  assert.match(client, /\/publish`/);
  assert.match(client, /\/unpublish`/);
  assert.match(client, /\/case-note`/);
  assert.match(client, /\/case-note\/withdraw`/);
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

test("the moderation queue provides separate accessible reply and flag controls", () => {
  const html = read("ops.html");
  const client = read("src/client/ops.ts");
  const css = read("css/ops.css");

  for (const id of ["moderation-replies-table", "moderation-flags-table"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["moderation-replies-state", "moderation-flags-state"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"`));
  }
  assert.match(html, /<h2[^>]*>Public replies<\/h2>/);
  assert.match(html, /<h2[^>]*>Received flags<\/h2>/);
  assert.match(client, /\/api\/v1\/ops\/moderation\/replies/);
  assert.match(client, /\/api\/v1\/ops\/moderation\/flags/);
  assert.match(client, /data-reply-moderation-action/);
  assert.match(client, /data-flag-moderation-action/);
  assert.match(client, /window\.prompt\([^)]*private reason/i);
  assert.match(client, /window\.confirm\([^)]*reversible[^)]*audited/i);
  assert.match(client, /Promise\.allSettled\(/);
  assert.match(client, /loadModerationReplies\(\), loadContentFlags\(\), loadDashboard\(\), loadAudit\(\)/);
  assert.doesNotMatch(html, /moderation[^<]{0,80}<input[^>]+name="reason"/i);
  assert.match(css, /\.ops-moderation-action\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.ops-moderation-table\s*\{[^}]*min-width:/s);
  assert.match(css, /\.ops-moderation-action--hide\s*\{[^}]*var\(--ops-danger\)/s);
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

test("report publication uses one native labelled confirmation checkbox", () => {
  const html = read("ops.html");
  const css = read("css/ops.css");
  assert.equal((html.match(/id="report-publication-confirm"/g) ?? []).length, 1);
  assert.match(html, /<label[^>]+for="report-publication-confirm"[^>]*class="ops-confirmation"/);
  assert.match(html, /<input[^>]+id="report-publication-confirm"[^>]+type="checkbox"/);
  assert.doesNotMatch(css, /\.ops-confirmation[^}]*appearance\s*:\s*none/is);
  assert.doesNotMatch(css, /\.ops-confirmation(?:::\w+|\s+\w+::\w+)[^{]*\{[^}]*content\s*:/is);
});

test("Ops exposes a clearly separate read-only production snapshot workspace", () => {
  const html = read("ops.html");
  const client = read("src/client/ops.ts");
  assert.match(html, /data-view="production-snapshot"/);
  assert.match(html, /data-view-panel="production-snapshot"/);
  assert.match(html, /Read-only production snapshot/);
  assert.match(html, /id="production-snapshot-state"[^>]*aria-live="polite"/);
  for (const id of [
    "production-snapshot-reports",
    "production-snapshot-players",
    "production-snapshot-staff",
    "production-snapshot-audit",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="production-snapshot-report-dialog"/);
  assert.match(html, /id="production-snapshot-waiver-dialog"/);

  const panel = html.match(/<section[^>]+data-view-panel="production-snapshot"[\s\S]*?<\/section>\s*<\/main>/)?.[0] ?? "";
  assert.ok(panel);
  assert.doesNotMatch(panel, /<form\b|approve|publish|recovery|revoke|session|data-(?:staff|player|moderation)-action/i);
  const snapshotDialogs = html.slice(html.indexOf('id="production-snapshot-report-dialog"'), html.indexOf('id="ops-account-dialog"'));
  assert.doesNotMatch(snapshotDialogs, /<form\b|approve|publish|recovery|revoke|retry|data-report-(?:publish|save|begin)/i);

  for (const path of ["reports", "players", "staff", "audit"]) {
    assert.match(client, new RegExp(`/api/v1/ops/production-snapshot/${path}`));
  }
  assert.doesNotMatch(client, /\/api\/v1\/ops\/production-snapshot[^\n]+method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
});
