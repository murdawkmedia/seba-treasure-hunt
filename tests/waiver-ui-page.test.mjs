import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("dashboard keeps profile choices separate from participation-waiver acceptance", () => {
  const html = read("dashboard.html");
  const profileStart = html.indexOf("<form data-profile-form");
  const profileEnd = html.indexOf("</form>", profileStart);
  const waiverStart = html.indexOf('id="waiver"');

  assert.ok(profileStart >= 0 && profileEnd > profileStart, "profile form exists");
  assert.ok(waiverStart > profileEnd, "dedicated waiver panel follows the profile form");
  assert.match(
    html,
    /<label class="check-row"><input name="huntEmail" type="checkbox"\s*\/?>(?:\s*)Email me Tim Lost Something\? clue and hunt updates\.<\/label>/,
  );
  assert.match(
    html,
    /<label class="check-row"><input name="marketing" type="checkbox"\s*\/?>(?:\s*)Email me other SebaHub news and offers\.<\/label>/,
  );
  assert.doesNotMatch(html, /name="(?:huntEmail|marketing)"[^>]*\bchecked\b/);
  assert.doesNotMatch(html.slice(profileStart, profileEnd), /name="participationWaiver"|data-waiver-form/);
});

test("waiver panel progressively exposes legal review before acceptance", () => {
  const html = read("dashboard.html");
  assert.match(
    html,
    /<a\b(?=[^>]*href="\/waiver")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="waiver-legal-body")(?=[^>]*data-waiver-review-link)[^>]*>/,
  );
  assert.match(html, /id="waiver-legal-body"[^>]*hidden/);
  assert.match(html, /<input\b(?=[^>]*name="waiverAccepted")(?=[^>]*type="checkbox")(?=[^>]*disabled)[^>]*>/);
  assert.match(html, /<fieldset[^>]*data-minors-fieldset/);
  assert.match(html, /<template[^>]*data-minor-template/);
  assert.match(html, /name="guardianAttested"/);
  assert.match(html, /data-add-minor/);
});

test("accepted-waiver receipt controls are accessible and status is announced", () => {
  const html = read("dashboard.html");
  assert.match(
    html,
    /data-waiver-receipt-status(?=[^>]*role="status")(?=[^>]*aria-live="polite")/,
  );
  assert.match(html, /data-view-accepted-waiver[^>]*>\s*View accepted waiver/i);
  assert.match(html, /data-print-waiver[^>]*>\s*Print/i);
  assert.match(html, /data-resend-waiver-receipt[^>]*>\s*Email my receipt again/i);
  assert.match(html, /You're registered\./);
  assert.match(html, /Save this confirmation and show it at the official clue station to receive your first clue\. Registration does not permit entry into private, restricted or unsafe areas\. Always follow the official map, posted signs and staff directions\./);
});

test("waiver client wires review, acceptance, status and resend without injecting minor content", () => {
  const client = read("src/client/dashboard.ts");
  for (const route of [
    "/api/v1/legal/waiver",
    "/api/v1/me/waiver/review",
    "/api/v1/me/waiver/accept",
    "/api/v1/me/waiver",
    "/api/v1/me/waiver/receipt",
  ]) {
    assert.match(client, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(client, /crypto\.randomUUID\(\)/);
  assert.match(client, /retainedWaiverIdempotencyKey\s*\?\?=\s*crypto\.randomUUID\(\)/);
  assert.match(client, /headers\.set\("Idempotency-Key", idempotencyKey\)/);
  assert.match(client, /retainedWaiverIdempotencyKey\s*=\s*null/);
  assert.match(client, /privacy\.checked\s*=\s*!privacyMediaRequired/);
  assert.match(client, /add\.disabled\s*=\s*rows\.length\s*>=\s*10/);
  assert.match(client, /document\.createElement\("div"\)/);
  assert.match(client, /nameInput\.value/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /minor[^\n]{0,80}\.innerHTML|innerHTML[^\n]{0,80}minor/i);
  assert.match(client, /addEventListener\("click", \(\) => \{\s*window\.print\(\);/s);
});

test("waiver layout remains usable at 390px and prints the complete legal record", () => {
  const css = read("css/hunter.css");
  assert.match(css, /\.waiver-legal-body\s*\{[^}]*font-size:\s*(?:1rem|16px)/s);
  assert.match(css, /\.minor-remove\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.waiver-panel[^}]*:focus-visible|\.minor-remove[^}]*:focus-visible|\.waiver-action[^}]*:focus-visible/s);
  assert.match(css, /@media\s*\(max-width:\s*430px\)[\s\S]*\.minor-row\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media\s+print\s*\{/);
  assert.match(css, /@media\s+print[\s\S]*\.waiver-actions[\s\S]*display:\s*none/s);
  assert.match(css, /@media\s+print[\s\S]*\.waiver-legal-body[\s\S]*color:\s*#000/s);
});
