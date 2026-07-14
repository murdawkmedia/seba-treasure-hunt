import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the third migration adds player lifecycle and append-only legal acceptance ledgers", () => {
  const migration = "migrations/0003_player_accounts_and_legal_acceptance.sql";
  assert.equal(existsSync(new URL(`../${migration}`, import.meta.url)), true, `${migration} exists`);
  const sql = read(migration);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_accounts\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS legal_acceptance_events\b/i);
  assert.match(sql, /document_type\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /document_hash\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /accepted_at\s+TEXT\s+NOT NULL/i);
  assert.doesNotMatch(sql, /password|reset_code|verification_code/i);
});

test("Clerk lifecycle intake requires a verified primary email before creating a player", () => {
  const webhook = read("src/server/clerk-webhooks.ts");
  assert.match(webhook, /verification/);
  assert.match(webhook, /status\s*===\s*"verified"/);
});

test("hunter account UI uses passwords with verified recovery and never stores an SMS preference", () => {
  const html = read("dashboard.html");
  const client = read("src/client/dashboard.ts");

  for (const id of [
    "hunter-sign-in-form",
    "hunter-sign-up-form",
    "hunter-verify-form",
    "hunter-recovery-form",
    "hunter-reset-form",
    "hunter-change-password-form",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} exists`);
  }
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /minlength="12"/);
  assert.match(client, /strategy:\s*"password"/);
  assert.match(client, /reset_password_email_code/);
  assert.match(client, /prepareEmailAddressVerification/);
  assert.match(client, /attemptEmailAddressVerification/);
  assert.match(client, /signOutOfOtherSessions:\s*true/);
  assert.doesNotMatch(html, /name="sms"|id="profile-phone"/);
  assert.doesNotMatch(client, /sms:\s*checked\(|phone:\s*draft\.phone/);
});

test("Ops offers only provider-managed player recovery and session revocation", () => {
  const client = read("src/client/ops.ts");
  assert.match(client, /data-player-action="recovery"/);
  assert.match(client, /data-player-action="revoke-sessions"/);
  assert.match(client, /\/api\/v1\/ops\/players\/.*action/);
  assert.doesNotMatch(client, /data-player-action="(?:set-password|view-password)"/);
});

test("onboarding keeps the active waiver separate and locked until its review is recorded", () => {
  const html = read("dashboard.html");
  assert.match(html, /name="privacyMediaAccepted"[^>]*required/);
  assert.match(html, /href="\/privacy#media-notice"/);
  assert.match(html, /href="\/waiver"/);
  assert.match(html, /name="waiverAccepted"[^>]*disabled/);
  assert.match(html, /name="guardianAttested"/);
  assert.doesNotMatch(html, /Participation waiver[^<]*coming soon|name="participationWaiver"/i);
});

test("privacy page adapts the SebaHub media notice to the hunt without importing unrelated claims", () => {
  const html = read("privacy.html");
  assert.match(html, /<h1[^>]*>Privacy Policy &amp; Media Notice<\/h1>/);
  assert.match(html, /Version 2026\.2/i);
  assert.match(html, /supervised minor[^.]*full name[^.]*birth year/is);
  assert.match(html, /waiver receipt[^.]*verified email/is);
  assert.match(html, /transactional[^.]*not[^.]*marketing consent/is);
  assert.match(html, /id="media-notice"/);
  assert.match(html, /Alberta(?:'s|&rsquo;s) Personal Information Protection Act \(PIPA\)/i);
  assert.match(html, /Canada(?:'s|&rsquo;s) Anti-Spam Legislation \(CASL\)/i);
  assert.match(html, /non-exclusive, royalty-free, perpetual right/i);
  assert.match(html, /edit(?:ed|ing)?, crop(?:ped|ping)?, (?:and )?reformat/i);
  assert.match(html, /private report evidence/i);
  assert.match(html, /exact locations/i);
  assert.match(html, /separate (?:and )?specific authorization/i);
  assert.doesNotMatch(html, /Meta Pixel|reservation details|payment information|mailing address/i);
});

test("the active legal document hash covers the legal main and ignores decorative chrome", () => {
  const html = read("privacy.html");
  const legal = read("src/server/legal-documents.ts");
  const generated = read("src/generated/privacy-media.ts");
  const main = html.match(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/);
  assert.ok(main);
  const canonicalPolicy = `${main[0].replaceAll("\r\n", "\n").trim()}\n`;
  const hash = createHash("sha256").update(canonicalPolicy).digest("hex");
  assert.match(generated, new RegExp(`hash:\\s*"${hash}"`));
  assert.match(generated, /version:\s*"2026\.2"/);
  assert.match(legal, /generatedPrivacyMediaDocument/);
});

test("the clue board routes possible finds to a private report", () => {
  const html = read("clue-board.html");
  assert.match(html, /Think you found it\?/i);
  assert.match(html, /Send the details privately/i);
  assert.match(html, /Do not post ID details, cash evidence, find photos or an exact location/i);
  assert.match(html, /href="\/report"/);
});
