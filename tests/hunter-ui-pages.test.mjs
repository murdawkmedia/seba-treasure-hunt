import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { readRenderedCampaignPage } from "./render-campaign-page.mjs";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const pages = {
  "start.html": { canonical: "/start", robots: "noindex,follow" },
  "dashboard.html": { canonical: "/dashboard", robots: "noindex,nofollow" },
  "updates.html": { canonical: "/updates", robots: "index,follow,max-image-preview:large" },
  "report.html": { canonical: "/report", robots: "noindex,follow" },
  "rules.html": { canonical: "/rules", robots: "index,follow,max-image-preview:large" },
  "privacy.html": { canonical: "/privacy", robots: "index,follow" },
  "waiver.html": { canonical: "/waiver", robots: "index,follow" },
  "community-guidelines.html": {
    canonical: "/community-guidelines",
    robots: "index,follow",
  },
};

test("the active waiver is discoverable from legal footers, routing, build, and docs", () => {
  for (const file of [
    "dashboard.html",
    "rules.html",
    "privacy.html",
    "start.html",
    "updates.html",
    "report.html",
    "community-guidelines.html",
    "clue-board.html",
    "sponsors.html",
  ]) {
    assert.match(readRenderedCampaignPage(file), /href="\/waiver"/, `${file} links the active waiver`);
  }
  assert.match(read("src/server/app.ts"), /\["\/waiver", "\/waiver\.html"\]/);
  assert.match(read("scripts/build.mjs"), /"waiver\.html"/);
  const readme = read("README.md");
  assert.match(readme, /\| `\/waiver` \|/);
  assert.match(readme, /TRANSACTIONAL_EMAIL_FROM_ADDRESS/);
  assert.match(readme, /TRANSACTIONAL_EMAIL_REPLY_TO/);
  assert.doesNotMatch(readme, /waiver is pending|forthcoming participation waiver/i);
});

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
    const rendered = readRenderedCampaignPage(file);
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
    assert.match(rendered, /data-case-status/);
    assert.match(rendered, /role="status"/);
    assert.match(rendered, /aria-live="polite"/);
    assert.match(rendered, /Status unavailable/i);
    assert.match(rendered, /href="\/updates"/);
    assert.match(rendered, /href="\/clue-board"/);
    assert.match(rendered, /href="\/report"/);
    assert.match(rendered, /href="\/rules"/);
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
  assert.match(start, /13 waypoints/i);
  assert.doesNotMatch(start, /route video/i);
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
  assert.match(dashboard, /id="hunter-sign-up-form"/);
  assert.match(dashboard, /name="fullName"/);
  assert.match(dashboard, /data-signup-review="privacy-media"/);
  assert.match(dashboard, /data-signup-review="waiver"/);
  assert.match(dashboard, /name="privacyMediaAccepted"/);
  assert.match(dashboard, /name="waiverAccepted"/);
  assert.match(dashboard, /Privacy Policy &amp; Media Notice/);
  assert.match(dashboard, /Participation Waiver/);
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
  assert.match(client, /privacyMediaVersion:\s*"2026\.3"/);
  assert.match(client, /participationBasis/);
  assert.match(client, /guardianPermissionAttested/);
  assert.doesNotMatch(client, /adultAttested/);
  assert.match(client, /reset_password_email_code/);
  assert.doesNotMatch(client, /pk_(?:test|live)_/);
});

test("report form is accessible, human-checked, and keeps geolocation optional", async () => {
  const html = read("report.html");
  const client = read("src/client/report.ts");
  const css = read("css/hunter.css");
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
  assert.match(html, /Photos up to 20 MB upload directly/i);
  assert.match(html, /larger photos up to 50 MB will be optimized on this device/i);
  assert.match(html, /Prepared uploads may total up to 30 MB/i);
  assert.match(html, /data-report-photo-status[^>]*aria-live="polite"/);
  assert.match(html, /data-report-photo-clear[^>]*hidden/);
  assert.match(client, /prepareReportImages/);
  assert.match(client, /reportImageMegabytes/);
  assert.match(client, /AbortSignal\.timeout\(120_000\)/);
  assert.match(html, /data-report-errors[^>]*role="alert"/);
  assert.match(html, /<option value="not_sure">Not sure \/ between waypoints<\/option>/);
  assert.match(html, /<option value="different_location">Different location<\/option>/);
  const waypointSelect = html.match(/<select id="report-waypoint"[\s\S]*?<\/select>/);
  assert.ok(waypointSelect);
  const waypointValues = [...waypointSelect[0].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(waypointValues, [
    "not_sure",
    "1", "2", "3", "4", "13", "5", "6", "7", "8", "9", "10", "11", "12",
    "different_location",
  ]);
  assert.match(client, /normalizeReportWaypoints/);
  assert.match(client, /mergeReportWaypointChoices\(existingChoices, envelope\)/);
  assert.match(client, /import\s+\{[^}]*waypointId[^}]*\}\s+from\s+"\.\.\/shared\/waypoints"/);
  assert.match(client, /stableWaypointId\s*=\s*waypointId\(draft\.waypointId\)/);
  const { waypointId } = await import("../src/shared/waypoints.ts");
  assert.equal(waypointId(13), 13);
  assert.equal(waypointId(14), null);
  assert.match(client, /for \(const item of waypoints\)[\s\S]*document\.createElement\("option"\)[\s\S]*select\.insertBefore\(option, differentLocation\)/);
  assert.match(client, /campaignHunterSession/);
  assert.match(client, /\/api\/v1\/me\/profile/);
  assert.match(client, /buildReportRequestHeaders\(attemptIdempotencyKey, hunterToken\)/);
  assert.match(client, /failReportAttempt\(attemptIdempotencyKey, resetReportTurnstile\)/);
  assert.match(client, /reportLocationResetModel\(\)/);
  assert.match(client, /stays private unless an operator later approves this report for a public update/i);
  assert.doesNotMatch(client, /It will remain private/i);
  assert.match(html, /data-report-receipt[^>]*hidden/);
  assert.match(html, /id="report-receipt-title">Report received privately<\/h2>/);
  assert.match(html, /data-report-reference/);
  assert.match(html, /review the report before anything is published/i);
  assert.match(html, /data-report-another/);
  assert.match(html, /id="report-turnstile-label"/);
  assert.match(html, /<div\b(?=[^>]*data-turnstile)(?=[^>]*tabindex="-1")(?=[^>]*role="group")(?=[^>]*aria-labelledby="report-turnstile-label")(?=[^>]*aria-describedby="report-turnstile-hint report-turnstile-error")[^>]*>/);
  assert.match(client, /reportErrorSelector\(key\)/);
  assert.match(client, /firstInvalid\?\.focus\(\)/);
  assert.match(client, /state\.textContent = "Human check ready\."/);
  assert.doesNotMatch(client, /state\.remove\(\)/);
  assert.match(css, /\.turnstile-shell:focus\s*\{[^}]*outline:/s);
  assert.doesNotMatch(client, /\[name="\$\{fieldName\}"\][\s\S]{0,200}turnstileToken/);
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
    const html = readRenderedCampaignPage(file);
    assert.equal((html.match(/\bid="campaign-nav"/g) ?? []).length, 1, `${file} has one nav id`);
    assert.equal((html.match(/class="campaign-menu-toggle"/g) ?? []).length, 1, `${file} has one menu toggle`);
    assert.match(html, /<button\b(?=[^>]*class="campaign-menu-toggle")(?=[^>]*type="button")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="campaign-nav")[^>]*>/, `${file} toggle semantics`);
    assert.match(html, /<span class="sr-only">Toggle campaign menu<\/span>/, `${file} toggle label`);
    assert.match(html, /<nav\b(?=[^>]*class="campaign-nav")(?=[^>]*id="campaign-nav")(?=[^>]*aria-label="Campaign")[^>]*>/, `${file} campaign nav`);
    for (const href of ["/start", "/route", "/updates", "/clue-board", "/report", "/rules", "/dashboard", "/sponsors"]) {
      assert.match(html, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`), `${file} retains ${href}`);
    }
    assert.match(read(file), /<script src="\/js\/site\.js"><\/script>/, `${file} loads shared menu behavior`);
  }
});

test("the clue board uses the canonical shell without becoming a navigation exception", () => {
  const html = readRenderedCampaignPage("clue-board.html");
  const source = read("clue-board.html");
  const boardCss = read("css/board.css");
  const shell = read("css/campaign-shell.css");

  assert.equal((html.match(/\bid="campaign-nav"/g) ?? []).length, 1, "clue-board.html has one nav id");
  assert.equal((html.match(/\bclass="campaign-menu-toggle"/g) ?? []).length, 1, "clue-board.html has one menu toggle");
  assert.match(html, /<button\b(?=[^>]*class="campaign-menu-toggle")(?=[^>]*type="button")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="campaign-nav")[^>]*>/);
  assert.match(html, /<nav\b(?=[^>]*class="campaign-nav")(?=[^>]*id="campaign-nav")(?=[^>]*aria-label="Campaign")[^>]*>/);
  for (const href of ["/start", "/route", "/updates", "/clue-board", "/report", "/rules", "/dashboard", "/sponsors"]) {
    assert.match(html, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`), `clue-board.html retains ${href}`);
  }
  assert.doesNotMatch(html, />Interview<\/a>/);
  assert.match(source, /<script src="\/js\/site\.js"><\/script>/);
  assert.match(html, /<section\b(?=[^>]*class="case-strip")(?=[^>]*role="status")(?=[^>]*aria-live="polite")[^>]*>/);
  assert.match(html, /data-case-status/);
  assert.doesNotMatch(
    `${source}\n${html}\n${boardCss}`,
    /(?:case-signal|board-topbar|board-nav|board-brand|board-menu-toggle|board-footer)/,
  );

  assert.match(shell, /\.case-strip\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*min-height:\s*var\(--campaign-case-min-height\)/s);
  assert.doesNotMatch(shell, /\.case-strip\s*\{[^}]*height:\s*var\(--case-strip-height\)/s);
  assert.match(shell, /\.campaign-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--case-strip-height\)[^}]*min-height:\s*var\(--campaign-nav-min-height\)/s);
  assert.match(shell, /\.skip-link\s*\{[^}]*z-index:\s*2000/s);
  assert.match(read("css/board.css"), /\.board-dialog\s*\{[^}]*z-index:\s*3000/s);
  assert.match(shell, /@media\s*\(max-width:\s*760px\)[\s\S]*\.campaign-nav\s*\{[^}]*display:\s*none/s);
  assert.match(shell, /\.campaign-nav\.open\s*\{[^}]*display:\s*flex/s);
  assert.match(shell, /@media\s*\(max-width:\s*760px\)[\s\S]*\.campaign-menu-toggle\s*\{[^}]*display:\s*inline-flex/s);
});

test("route stories and photos are public while exact waypoint controls stay session-aware", () => {
  const route = read("route.html");
  const renderedRoute = readRenderedCampaignPage("route.html");
  const client = read("src/client/route.ts");
  const lightboxCss = read("css/route-lightbox.css");
  const routeSections = [...renderedRoute.matchAll(/<section class="stop" id="stop-(\d+)" data-waypoint-id="(\d+)">/g)];
  assert.match(route, /data-route-signed-out/);
  assert.match(route, /data-route-member-content/);
  assert.doesNotMatch(route, /data-route-member-content[^>]*\bhidden\b/);
  assert.doesNotMatch(renderedRoute, /data-route-member-content[^>]*\bhidden\b/);
  assert.deepEqual(routeSections.map((match) => Number(match[1])), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.deepEqual(routeSections.map((match) => Number(match[2])), [1, 2, 3, 4, 13, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal((renderedRoute.match(/class="stop-meta stop-meta--locked"/g) ?? []).length, 13);
  const routePhotos = [...route.matchAll(/<img src="assets\/route\/stop-[^"]+"/g)];
  assert.equal(routePhotos.length, 61);
  const routePhotoAnchors = [...route.matchAll(/<a\b[^>]*href="assets\/route\/stop-[^"]+"[^>]*>/g)];
  assert.equal(routePhotoAnchors.length, 61, "all route photos retain a fallback anchor");
  for (const anchor of routePhotoAnchors) {
    assert.match(anchor[0], /\btarget="_blank"/);
    assert.match(anchor[0], /\brel="noopener"/);
  }
  assert.match(route, /<link rel="stylesheet" href="\/css\/route-lightbox\.css"/);
  assert.ok(
    route.indexOf('<link rel="stylesheet" href="/css/route-lightbox.css"')
      < route.indexOf('<link rel="stylesheet" href="/css/campaign-shell.css"'),
    "the canonical campaign shell loads after route lightbox author CSS",
  );
  assert.equal((route.match(/<dialog\b(?=[^>]*\bdata-route-lightbox\b)(?=[^>]*\baria-labelledby="route-lightbox-title")[^>]*>/g) ?? []).length, 1);
  for (const hook of [
    "image",
    "caption",
    "counter",
    "previous",
    "next",
    "close",
    "original",
  ]) {
    assert.match(route, new RegExp(`\\bdata-route-lightbox-${hook}\\b`));
  }
  assert.match(route, /\/assets\/app\/route-lightbox\.js/);
  assert.match(
    lightboxCss,
    /\.route-lightbox\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-dark\);/s,
  );
  assert.match(
    lightboxCss,
    /\.route-lightbox__stage\s*\{[^}]*--campaign-focus:\s*var\(--campaign-focus-light\);/s,
  );
  assert.doesNotMatch(lightboxCss, /:focus-visible\s*\{[^}]*var\(--campaign-focus-(?:light|dark)/s);
  const stopFour = route.match(/<section class="stop" id="stop-4"[\s\S]*?<\/section>/)?.[0] ?? "";
  const stopFive = route.match(/<section class="stop" id="stop-5"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(stopFour, /IMG_5085\.jpg/);
  assert.doesNotMatch(stopFour, /IMG_5090\.jpg/);
  assert.match(stopFive, /IMG_5090\.jpg/);
  assert.doesNotMatch(stopFive, /IMG_5085\.jpg/);
  const routeJsonLd = [...route.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  const routeItemList = routeJsonLd
    .flatMap((block) => block["@graph"] ?? [block])
    .find((item) => item["@type"] === "ItemList");
  assert.equal(routeItemList?.numberOfItems, 13);
  assert.deepEqual(routeItemList?.itemListElement.map((item) => item.position), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.match(route, /Lucky 13 · a documentary route record/);
  assert.match(read("index.html"), /13 waypoints · 61 public-safe photos/i);
  assert.match(route, /stories and photos are public/i);
  assert.match(route, /exact Google Maps links require a Hunter account/i);
  assert.match(route, /data-route-member-state/);
  assert.match(route, /\/assets\/app\/route\.js/);
  assert.doesNotMatch(route, /https?:\/\/(?:www\.)?(?:google\.[^/]+\/maps|maps\.google\.)/i);
  assert.doesNotMatch(route, /\/api\/v1\/me\/dashboard/);
  assert.doesNotMatch(route, /-?\d{2}\.\d+\s*[,|]\s*-?\d{2,3}\.\d+/);
  assert.match(client, /campaignHunterSession/);
  assert.match(client, /\/api\/v1\/me\/dashboard/);
  assert.match(client, /participationUnlocked/);
  assert.match(client, /signedOut\.hidden = true/);
  assert.match(client, /renderWaypointLinks\(projection\)/);
  assert.doesNotMatch(client, /querySelector<HTMLElement>\("\[data-route-member-content\]"\)/);
  assert.doesNotMatch(client, /content\.hidden\s*=/);
  assert.doesNotMatch(client, /member_exact_url|latitude|longitude/i);
});

test("static community and reporting fallbacks preserve stable waypoint ids in public order", () => {
  for (const [file, selectId] of [
    ["clue-board.html", "waypoint-filter"],
    ["clue-board.html", "note-waypoint"],
  ]) {
    const select = read(file).match(new RegExp(`<select id="${selectId}"[\\s\\S]*?<\\/select>`))?.[0] ?? "";
    const values = [...select.matchAll(/<option value="(\d+)"/g)].map((match) => match[1]);
    assert.deepEqual(values, ["1", "2", "3", "4", "13", "5", "6", "7", "8", "9", "10", "11", "12"]);
  }
});

test("stale route-video assets remain present but are absent from every public static source", () => {
  const publicSource = [
    ...readdirSync(new URL("../", import.meta.url)).filter((file) => file.endsWith(".html")),
    "js/site.js",
  ].map(read).join("\n");
  assert.doesNotMatch(publicSource, /route-video-poster\.jpg|route-video\.mp4/);

  for (const file of [
    "assets/route/route-video-poster.jpg",
    "assets/route/route-video.mp4",
  ]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} remains on disk`);
  }
});

test("public updates explain and render approved report evidence without authentication", () => {
  const html = read("updates.html");
  const client = read("src/client/updates.ts");
  const css = read("css/hunter.css");

  assert.match(html, /operator-approved reports may include public GPS and individually approved images/i);
  assert.match(html, /data-updates-list/);
  assert.doesNotMatch(html, /data-clerk|sign in to view|authorization/i);
  assert.match(client, /Approved hunter report/);
  assert.match(client, /document\.createElement\("img"\)/);
  assert.match(client, /loading = "lazy"/);
  assert.match(client, /referrerPolicy = "no-referrer"/);
  assert.match(client, /document\.createTextNode|\.textContent\s*=/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
  assert.match(css, /\.report-evidence-gallery/);
  assert.match(css, /\.report-coordinates/);
  assert.match(css, /@media[\s\S]*\.report-evidence-gallery/);
});

test("the clue board loads shared status before its board client", () => {
  const source = read("clue-board.html");
  const siteScript = '<script src="/js/site.js"></script>';
  const statusScript = '<script type="module" src="/assets/app/status.js"></script>';
  const boardScript = '<script type="module" src="/assets/app/board.js"></script>';

  for (const script of [siteScript, statusScript, boardScript]) {
    assert.equal(source.split(script).length - 1, 1, `${script} loads exactly once`);
  }
  assert.ok(source.indexOf(siteScript) < source.indexOf(statusScript), "site behavior initializes first");
  assert.ok(source.indexOf(statusScript) < source.indexOf(boardScript), "shared status initializes before the board client");
});

test("shared menu behavior closes consistently without trapping focus", () => {
  const site = read("js/site.js");
  assert.match(site, /function closeNav\(toggle, nav, restoreFocus\)/);
  assert.match(site, /if \(!toggle \|\| !nav\) return/);
  assert.match(site, /toggle\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(site, /event\.target instanceof Element/);
  assert.match(site, /event\.target\.closest\("a"\)/);
  assert.match(site, /document\.addEventListener\("keydown"/);
  assert.match(site, /event\.key === "Escape"/);
  assert.match(site, /nav\.classList\.contains\("open"\)/);
  assert.match(site, /if \(restoreFocus\) toggle\.focus\(\)/);
  assert.match(site, /closest\("a"\)\) closeNav\(toggle, nav, false\)/);
  assert.match(site, /event\.key === "Escape"[\s\S]{0,120}closeNav\(toggle, nav, true\)/);
  assert.match(site, /event\.matches\) closeNav\(toggle, nav, false\)/);
  assert.doesNotMatch(site, /preventDefault\(\)[\s\S]{0,120}(?:Tab|event\.key === "Tab")|focusableElements|focus trap/i);
});

test("shared header geometry observes real row sizes with a safe fallback", () => {
  const site = read("js/site.js");
  assert.match(site, /function initStackedHeaderGeometry\(\)/);
  assert.match(site, /querySelector\("\.case-strip"\)/);
  assert.match(site, /querySelector\("\.campaign-header"\)/);
  assert.match(site, /getBoundingClientRect\(\)\.height/);
  assert.match(site, /--case-strip-height/);
  assert.match(site, /--campaign-nav-height/);
  assert.match(site, /--stacked-header-height/);
  assert.match(site, /requestAnimationFrame/);
  assert.match(site, /typeof window\.ResizeObserver === "function"/);
  assert.match(site, /typeof window\.MutationObserver === "function"/);
  assert.match(site, /window\.addEventListener\("resize"/);
});
