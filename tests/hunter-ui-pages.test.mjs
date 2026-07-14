import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const pages = {
  "start.html": { canonical: "/start", robots: "noindex,follow" },
  "dashboard.html": { canonical: "/dashboard", robots: "noindex,nofollow" },
  "updates.html": { canonical: "/updates", robots: "index,follow,max-image-preview:large" },
  "report.html": { canonical: "/report", robots: "noindex,follow" },
  "rules.html": { canonical: "/rules", robots: "index,follow,max-image-preview:large" },
  "privacy.html": { canonical: "/privacy", robots: "index,follow" },
  "community-guidelines.html": {
    canonical: "/community-guidelines",
    robots: "index,follow",
  },
};

const hunterMenuPages = [
  "start.html",
  "dashboard.html",
  "updates.html",
  "report.html",
  "rules.html",
  "privacy.html",
  "community-guidelines.html",
  "sponsors.html",
];

test("hunter pages expose campaign navigation, truthful live status, and canonical metadata", () => {
  assert.equal(existsSync(new URL("../css/hunter.css", import.meta.url)), true);

  for (const [file, expected] of Object.entries(pages)) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} exists`);
    const html = read(file);
    assert.match(html, /<html lang="en-CA">/);
    assert.match(html, /Tim Lost Something\?/);
    assert.match(
      html,
      new RegExp(
        `<link rel="canonical" href="https://www\\.timlostsomething\\.com${expected.canonical.replaceAll("/", "\\/")}"`,
      ),
    );
    assert.match(html, new RegExp(`<meta name="robots" content="${expected.robots}"`));
    assert.match(html, /href="\/css\/hunter\.css"/);
    assert.match(html, /<main id="main" tabindex="-1">/);
    assert.match(html, /data-case-status/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /Status unavailable/i);
    assert.match(html, /href="\/updates"/);
    assert.match(html, /href="\/clue-board"/);
    assert.match(html, /href="\/report"/);
    assert.match(html, /href="\/rules"/);
  }
});

test("public information pages provide parseable AEO metadata without inventing campaign state", () => {
  for (const file of [
    "updates.html",
    "rules.html",
    "privacy.html",
    "community-guidelines.html",
  ]) {
    const html = read(file);
    assert.match(html, /<meta name="description"/);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
    const jsonLd = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ];
    assert.ok(jsonLd.length > 0, `${file} has structured data`);
    for (const block of jsonLd) JSON.parse(block[1]);
    assert.doesNotMatch(html, /data-state="open"/i);
  }
});

test("start and dashboard explain the member tool without pretending historical map data is secret", () => {
  const start = read("start.html");
  assert.match(start, /12 waypoints/i);
  assert.match(start, /member map tools/i);
  assert.match(start, /not secret/i);
  assert.match(start, /href="\/dashboard"/);
  assert.match(start, /href="\/route"/);
  assert.match(start, /href="\/report"/);
  assert.match(start, /data-start-zones/);
  assert.match(start, /Current area labels/i);
  assert.match(read("src/client/start.ts"), /\/api\/v1\/zones/);

  const dashboard = read("dashboard.html");
  assert.match(dashboard, /data-dashboard-state/);
  assert.match(dashboard, /Sign in/i);
  assert.match(dashboard, /Exact directions stay locked/i);
  assert.match(dashboard, /data-dashboard-waypoints/);
  assert.match(dashboard, /data-profile-form/);
  assert.match(dashboard, /id="profile-full-name"/);
  assert.match(dashboard, /name="huntEmail"/);
  assert.match(dashboard, /name="marketing"/);
  assert.match(dashboard, /name="privacyMediaAccepted"/);
  assert.match(dashboard, /data-waiver-form/);
  assert.match(dashboard, /name="waiverAccepted"[^>]*disabled/);
  assert.doesNotMatch(dashboard, /name="sms"|data-profile-turnstile/);
  assert.doesNotMatch(dashboard, /53\.\d+|-114\.\d+/);
});

test("dashboard bootstraps managed hunter identity from runtime-safe public config", () => {
  const client = read("src/client/dashboard.ts");
  assert.match(client, /hunterPublishableKey/);
  assert.match(client, /@clerk\/clerk-js/);
  assert.match(client, /getToken/);
  assert.match(client, /\/api\/v1\/config/);
  assert.match(client, /\/api\/v1\/me\/profile/);
  assert.match(client, /privacyMediaVersion:\s*"2026\.2"/);
  assert.match(client, /reset_password_email_code/);
  assert.doesNotMatch(client, /pk_(?:test|live)_/);
});

test("report form is accessible, human-checked, and keeps geolocation optional", () => {
  const html = read("report.html");
  for (const id of [
    "report-type",
    "report-name",
    "report-email",
    "report-phone",
    "report-waypoint",
    "report-location",
    "report-details",
    "report-photo",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `${id} has a label`);
    assert.match(html, new RegExp(`id="${id}"`), `${id} has a control`);
  }
  assert.match(html, /value="find"/);
  assert.match(html, /value="tip"/);
  assert.match(html, /value="safety"/);
  assert.match(html, /data-report-use-location/);
  assert.match(html, /Location sharing is optional/i);
  assert.match(html, /data-turnstile/);
  assert.match(read("src/client/report.ts"), /action:\s*"report"/);
  assert.match(html, /JPEG, PNG, or WebP/i);
  assert.match(html, /10 MiB/i);
  assert.match(html, /data-report-errors[^>]*role="alert"/);
  for (const errorId of [
    "report-type-error",
    "report-name-error",
    "report-email-error",
    "report-location-error",
    "report-details-error",
    "report-photo-error",
    "report-accuracy-error",
  ]) {
    assert.match(html, new RegExp(`id="${errorId}"`));
    assert.match(html, new RegExp(`aria-describedby="[^"]*${errorId}`));
  }
});

test("public hunter UI contains no staff allowlist or deferred campaign claims", () => {
  const html = Object.keys(pages).map(read).join("\n");
  const sebaHubEmails = [...html.matchAll(/[\w.+-]+@sebahub\.com/gi)].map((match) => match[0].toLowerCase());
  assert.ok(sebaHubEmails.every((email) => email === "info@sebahub.com"));
  for (const unsafe of [
    /[\w.+-]+@businessasaforceforgood\.ca/i,
    /official radio partner/i,
    /CFCW/i,
    /golf ball/i,
    /\$10,000/i,
    /Inspector Clouseau/i,
  ]) {
    assert.doesNotMatch(html, unsafe);
  }
});

test("hunter page menus expose one labelled toggle and retain campaign destinations", () => {
  for (const file of hunterMenuPages) {
    const html = read(file);
    assert.equal((html.match(/\bid="nav"/g) ?? []).length, 1, `${file} has one nav id`);
    assert.equal((html.match(/class="menu-toggle"/g) ?? []).length, 1, `${file} has one menu toggle`);
    assert.match(html, /<button\b(?=[^>]*class="menu-toggle")(?=[^>]*type="button")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="nav")[^>]*>/, `${file} toggle semantics`);
    assert.match(html, /<span class="sr-only">Toggle campaign menu<\/span>/, `${file} toggle label`);
    assert.match(html, /<nav\b(?=[^>]*class="hunter-nav")(?=[^>]*id="nav")(?=[^>]*aria-label="Campaign")[^>]*>/, `${file} campaign nav`);
    for (const href of ["/start", "/route", "/updates", "/clue-board", "/report", "/rules", "/dashboard", "/sponsors"]) {
      assert.match(html, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`), `${file} retains ${href}`);
    }
    assert.match(html, /<script src="\/js\/site\.js"><\/script>/, `${file} loads shared menu behavior`);
  }
});

test("the clue board keeps its distinct shell without becoming a navigation exception", () => {
  const html = read("clue-board.html");
  const board = read("css/board.css");

  assert.equal((html.match(/\bid="nav"/g) ?? []).length, 1, "clue-board.html has one nav id");
  assert.equal((html.match(/\bclass="[^"]*\bmenu-toggle\b[^"]*"/g) ?? []).length, 1, "clue-board.html has one menu toggle");
  assert.match(html, /<button\b(?=[^>]*class="[^"]*\bmenu-toggle\b[^"]*")(?=[^>]*type="button")(?=[^>]*aria-label="Toggle campaign menu")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="nav")[^>]*>/);
  assert.match(html, /<nav\b(?=[^>]*id="nav")(?=[^>]*aria-label="Campaign")[^>]*>/);
  for (const href of ["/route", "/updates", "/report", "/sponsors", "/dashboard#sign-in"]) {
    assert.match(html, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`), `clue-board.html retains ${href}`);
  }
  assert.match(html, /<script src="\/js\/site\.js"><\/script>/);
  assert.match(html, /<div\b(?=[^>]*class="case-signal")(?=[^>]*role="status")(?=[^>]*aria-live="polite")[^>]*>/);
  assert.doesNotMatch(html, /class="case-signal"[^>]*aria-hidden="true"/);

  assert.match(board, /\.case-signal\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*1200[^}]*top:\s*0[^}]*min-height:\s*var\(--case-strip-min-height\)/s);
  assert.doesNotMatch(board, /\.case-signal\s*\{[^}]*height:\s*var\(--case-strip-height\)/s);
  assert.match(board, /\.board-topbar\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*1100[^}]*top:\s*var\(--case-strip-height\)[^}]*min-height:\s*var\(--campaign-nav-min-height\)/s);
  assert.match(board, /\.skip-link\s*\{[^}]*z-index:\s*2000/s);
  assert.match(board, /\.board-dialog\s*\{[^}]*z-index:\s*3000/s);
  assert.match(board, /@media\s*\(max-width:\s*940px\)[\s\S]*\.board-topbar nav\s*\{[^}]*display:\s*none/s);
  assert.match(board, /\.board-topbar nav\.open\s*\{[^}]*display:\s*flex/s);
  assert.match(board, /@media\s*\(max-width:\s*940px\)[\s\S]*\.board-menu-toggle\s*\{[^}]*display:\s*inline-flex/s);
  assert.doesNotMatch(board, /nav a:not\(\.board-topbar__account\)\s*\{[^}]*display:\s*none/s);
});

test("shared menu behavior closes consistently without trapping focus", () => {
  const site = read("js/site.js");
  assert.match(site, /function closeNav\(toggle, nav\)/);
  assert.match(site, /if \(!toggle \|\| !nav\) return/);
  assert.match(site, /toggle\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(site, /event\.target instanceof Element/);
  assert.match(site, /event\.target\.closest\("a"\)/);
  assert.match(site, /document\.addEventListener\("keydown"/);
  assert.match(site, /event\.key === "Escape"/);
  assert.match(site, /nav\.classList\.contains\("open"\)/);
  assert.match(site, /toggle\.focus\(\)/);
  assert.doesNotMatch(site, /preventDefault\(\)[\s\S]{0,120}(?:Tab|event\.key === "Tab")|focusableElements|focus trap/i);
});

test("shared header geometry observes real row sizes with a safe fallback", () => {
  const site = read("js/site.js");
  assert.match(site, /function initStackedHeaderGeometry\(\)/);
  assert.match(site, /\.case-strip, \.case-signal/);
  assert.match(site, /\.topbar, \.hunter-header, \.board-topbar/);
  assert.match(site, /getBoundingClientRect\(\)\.height/);
  assert.match(site, /--case-strip-height/);
  assert.match(site, /--campaign-nav-height/);
  assert.match(site, /--stacked-header-height/);
  assert.match(site, /requestAnimationFrame/);
  assert.match(site, /typeof window\.ResizeObserver === "function"/);
  assert.match(site, /typeof window\.MutationObserver === "function"/);
  assert.match(site, /window\.addEventListener\("resize"/);
});
