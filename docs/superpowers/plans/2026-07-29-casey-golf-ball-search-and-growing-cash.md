# Casey Golf-Ball Search and Growing Cash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clearly separated Casey golf-ball search, refresh Tim's growing-cash story, and deliver the exact tested result to validation without changing production data or account systems.

**Architecture:** Extend the existing static public campaign shell with one registered `/golf-balls` route, a dedicated progressive HTML page, and a concise homepage teaser. Keep Tim's case primary, preserve the 19-entry interview and 13 Stops, and enforce story separation through focused static/build tests plus the existing responsive shell audit.

**Tech Stack:** Static HTML and CSS, Node.js ESM build scripts, Node test runner, TypeScript checks, Playwright browser QA, Cloudflare Pages validation branch.

---

## Source Map

### Create

- `golf-balls.html` — dedicated public Casey golf-ball search page.
- `tests/golf-ball-search.test.mjs` — focused story, route, metadata, safety and build contract.
- `docs/operations/2026-07-29-casey-golf-ball-search-validation.md` — validation release record after deployment.

### Modify

- `index.html` — growing-cash story, current missing-item facts and Casey teaser.
- `route.html` — update route metadata and cash summary so `$5,000` is the initial amount.
- `css/style.css` — page and teaser layout using existing documentary tokens.
- `scripts/campaign-shell.mjs` — register the route and add **Golf Balls** to shared navigation.
- `scripts/build.mjs` — copy and render `golf-balls.html`.
- `sitemap.xml` — add the canonical public route and update changed-page dates.
- `README.md` — document the new public route and story boundary.
- `tests/interview-integrity.test.mjs` — keep the golf-ball exclusion scoped to Tim's Account.
- `tests/public-content-safety.test.mjs` — replace the obsolete unconfirmed-extension guard with precise confirmed-fact rules.
- `tests/release2b-documentary.test.mjs` — update homepage order/facts and sitemap expectations.
- `tests/public-case-story-cleanup.test.mjs` — include the new route in shared public-copy checks.
- `tests/campaign-shell.test.mjs` — update the exact registered page, menu and descriptor contracts.
- `tests/campaign-design-system.test.mjs` — map the new page to the existing landing-page family.
- `tests/campaign-shell-preservation.test.mjs` — authorize the new page family during preservation hashing.
- `tests/fixtures/campaign-page-preservation.json` — add and refresh only the reviewed public-page hashes.
- `tests/navigation-geometry.test.mjs` — include the new page and menu route in the explicit responsive matrix.
- `scripts/verify-unified-shell-qa.mjs` — add representative screenshots for the new page.
- `tests/unified-shell-qa-contract.test.mjs` — update the exact expanded browser-audit counts.
- `tests/sponsor-page.test.mjs` — keep the new public page inside the no-sponsorship-navigation audit.
- `STATUS.md` — record implementation and validation evidence only after the release exists.

### Preserve unchanged

- `interview.html` and all 19 answer bodies.
- Tim's 13 waypoint sections and authenticated route controls.
- Legal documents and generated legal hashes.
- D1, R2, queue, authentication, reporting, moderation and Ops code.
- Production Pages deployment and custom domains.

## Task 1: Establish the New Story Contract

**Files:**
- Create: `tests/golf-ball-search.test.mjs`
- Modify: `tests/interview-integrity.test.mjs`
- Modify: `tests/public-content-safety.test.mjs`

- [ ] **Step 1: Write the focused failing test**

Create `tests/golf-ball-search.test.mjs` with the exact contracts:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAMPAIGN_MENU,
  CAMPAIGN_PAGES,
  renderCampaignPage,
} from "../scripts/campaign-shell.mjs";
import { buildSite } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => readFileSync(path.join(root, filename), "utf8");
const visibleText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

test("Casey's golf-ball search is one registered public route", () => {
  assert.equal(CAMPAIGN_PAGES["golf-balls.html"], "golf-balls");
  assert.deepEqual(
    CAMPAIGN_MENU.find((item) => item.route === "golf-balls"),
    { route: "golf-balls", label: "Golf Balls", href: "/golf-balls" },
  );
  assert.equal(
    CAMPAIGN_MENU.filter((item) => item.route === "golf-balls").length,
    1,
  );
});

test("the golf-ball page separates Casey's search from Tim's case", () => {
  const source = read("golf-balls.html");
  const rendered = renderCampaignPage(source, "golf-balls.html");
  const text = visibleText(rendered);

  assert.match(source, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/golf-balls"/);
  assert.match(source, /<meta name="description" content="[^"]*Casey[^"]*In the Woods[^"]*golf balls[^"]*festival ticket/i);
  assert.match(source, /<meta property="og:url" content="https:\/\/www\.timlostsomething\.com\/golf-balls"/);
  assert.match(source, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  for (const block of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    JSON.parse(block[1]);
  }

  assert.match(text, /Casey lost the golf balls/i);
  assert.match(text, /official In the Woods logo/i);
  assert.match(text, /ordinary golf balls do not qualify/i);
  assert.match(text, /one qualifying ball[^.]*one[^.]*festival ticket/i);
  assert.match(text, /return the ball/i);
  assert.match(text, /SebaHub School[^.]*Monday[^.]*Friday/i);
  assert.match(rendered, /href="mailto:casey@sebahub\.com"/i);
  assert.match(rendered, /href="https:\/\/www\.inthewoodsmusicfestival\.com\/"/i);
  assert.match(rendered, /href="\/rules"/i);
  assert.doesNotMatch(text, /Tim lost[^.]*golf balls/i);
  assert.doesNotMatch(text, /Casey lost[^.]*ID|Casey lost[^.]*rings|Casey lost[^.]*cash/i);
});

test("the homepage keeps Tim primary and introduces Casey second", () => {
  const home = read("index.html");
  const text = visibleText(home);
  const timHeading = home.indexOf("<h1>Tim lost his ID.</h1>");
  const caseyHeading = home.indexOf("Casey lost something too.");

  assert.ok(timHeading >= 0);
  assert.ok(caseyHeading > timHeading);
  assert.match(text, /search began with roughly \$5,000/i);
  assert.match(text, /approaching \$10,000/i);
  assert.match(text, /Tim keeps retracing his steps/i);
  assert.match(text, /ID[^.]*still missing/i);
  assert.match(text, /two diamond rings[^.]*still missing/i);
  assert.match(home, /href="\/golf-balls"[^>]*>Follow Casey(?:'|&#39;)s golf-ball search<\/a>/i);
});

test("only approved surfaces publish the new golf-ball story", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const text = visibleText(read(filename));
    if (["index.html", "golf-balls.html"].includes(filename)) {
      assert.match(text, /golf[\s-]+balls?/i, filename);
    } else {
      assert.doesNotMatch(text, /Casey lost the golf balls|one qualifying ball/i, filename);
    }
  }
  assert.doesNotMatch(visibleText(read("interview.html")), /golf[\s-]+balls?/i);
});

test("the production build contains the new canonical page", async () => {
  const output = await buildSite({ temporary: true });
  try {
    const builtPath = path.join(output.dist, "golf-balls.html");
    assert.equal(existsSync(builtPath), true);
    const built = readFileSync(builtPath, "utf8");
    assert.match(built, /aria-current="page"[^>]*>Golf Balls<\/a>/);
    assert.match(built, /class="campaign-footer"/);
  } finally {
    await output.cleanup();
  }
});
```

- [ ] **Step 2: Scope the interview exclusion to Tim's Account**

Replace the existing all-HTML golf-ball exclusion in
`tests/interview-integrity.test.mjs` with:

```js
test("the unpublished golf-ball question stays absent from Tim's Account", () => {
  assert.doesNotMatch(
    visibleTextFromHtml(interview),
    golfBallPhrase,
    "Tim's Account contains no visible golf-ball question or answer",
  );
});
```

Retain the existing bypass-fixture test unchanged so whitespace, entities and
inline markup remain covered.

- [ ] **Step 3: Replace the obsolete unconfirmed-extension assertions**

In `tests/public-content-safety.test.mjs`, replace the `$10,000` and golf-ball
prohibitions with:

```js
test("confirmed case extensions remain qualified and separated", () => {
  const home = read("index.html");
  const golfBalls = read("golf-balls.html");
  const interview = read("interview.html");

  assert.match(home, /approaching \$10,000/i);
  assert.doesNotMatch(home, /\bexactly \$10,000|\$10,000 guaranteed/i);
  assert.match(golfBalls, /current (?:working )?offer|currently/i);
  assert.match(golfBalls, /official In the Woods logo/i);
  assert.doesNotMatch(interview, /golf balls?/i);

  const stillForbidden = [
    /Official Radio Partner/i,
    /Friday[^<\n]{0,100}CFCW|CFCW[^<\n]{0,100}Friday/i,
    /trips and tickets/i,
    /founding sponsor/i,
  ];
  for (const pattern of stillForbidden) {
    assert.doesNotMatch(`${home}\n${golfBalls}`, pattern);
  }
});
```

- [ ] **Step 4: Run the focused test to prove the feature is absent**

Run:

```powershell
node --test tests/golf-ball-search.test.mjs tests/interview-integrity.test.mjs tests/public-content-safety.test.mjs
```

Expected: the new golf-ball tests fail because `golf-balls.html` and the shell
route do not exist; the retained interview integrity tests pass.

- [ ] **Step 5: Commit the red contract**

```powershell
git add tests/golf-ball-search.test.mjs tests/interview-integrity.test.mjs tests/public-content-safety.test.mjs
git commit -m "test: define Casey golf-ball search"
```

## Task 2: Register and Build the Public Route

**Files:**
- Modify: `scripts/campaign-shell.mjs`
- Modify: `scripts/build.mjs`
- Modify: `tests/campaign-shell.test.mjs`
- Modify: `tests/campaign-design-system.test.mjs`
- Test: `tests/golf-ball-search.test.mjs`

- [ ] **Step 1: Register the navigation entry and page**

Add this item after **13 Stops** in `CAMPAIGN_MENU`:

```js
Object.freeze({ route: "golf-balls", label: "Golf Balls", href: "/golf-balls" }),
```

Add this page registration after `route.html` in `CAMPAIGN_PAGES`:

```js
"golf-balls.html": "golf-balls",
```

- [ ] **Step 2: Update the exact shell and design-family contracts**

Add this descriptor to `tests/campaign-shell.test.mjs`:

```js
"golf-balls.html": {
  route: "golf-balls",
  skipLabel: "Skip to Casey's search",
  skipTarget: "main",
},
```

Add the page and menu item in the same positions to that test's exact
`CAMPAIGN_PAGES` and `CAMPAIGN_MENU` expectations. Also add
`"golf-balls.html": "golf-balls"` to the test's `filenames` mapping so its
synthetic renderer can resolve the new route.

Add this entry to `PAGE_FAMILIES` in
`tests/campaign-design-system.test.mjs`:

```js
"golf-balls.html": "landing",
```

The new page uses an established visual family rather than inventing a new
shell family.

- [ ] **Step 3: Add the page to static build output**

Add `"golf-balls.html"` immediately after `"route.html"` in the
`staticFiles` array in `scripts/build.mjs`.

- [ ] **Step 4: Run the route contract**

Run:

```powershell
node --test tests/golf-ball-search.test.mjs tests/campaign-shell.test.mjs tests/campaign-design-system.test.mjs
```

Expected: the route-registration test passes; page-content and build tests
still fail because `golf-balls.html` does not exist.

- [ ] **Step 5: Commit the route registration**

```powershell
git add scripts/campaign-shell.mjs scripts/build.mjs tests/campaign-shell.test.mjs tests/campaign-design-system.test.mjs
git commit -m "feat: register golf-ball search route"
```

## Task 3: Build Casey's Dedicated Golf-Ball Page

**Files:**
- Create: `golf-balls.html`
- Modify: `css/style.css`
- Modify: `tests/campaign-design-system.test.mjs`
- Test: `tests/golf-ball-search.test.mjs`

- [ ] **Step 1: Create the progressive public page**

Create `golf-balls.html` with the existing favicon, font and shared stylesheet
links, this shell descriptor, and these page sections:

```html
<!DOCTYPE html>
<html lang="en-CA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Casey Lost the Golf Balls | Tim Lost Something?</title>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/favicon-32x32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="description" content="Casey lost specially marked In the Woods golf balls around the Seba Beach search area. Return a qualifying ball for the current offer of one festival ticket." />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="https://www.timlostsomething.com/golf-balls" />
  <meta property="og:site_name" content="Tim Lost Something?" />
  <meta property="og:title" content="Casey Lost the Golf Balls" />
  <meta property="og:description" content="Find an official In the Woods golf ball, return it to Casey, and the current offer is one ball for one festival ticket." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://www.timlostsomething.com/golf-balls" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Casey Lost the Golf Balls" />
  <meta name="twitter:description" content="A second Seba Beach search connected to the In the Woods Music Festival." />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": "https://www.timlostsomething.com/golf-balls#webpage",
    "url": "https://www.timlostsomething.com/golf-balls",
    "name": "Casey Lost the Golf Balls",
    "description": "A community search for specially marked In the Woods golf balls that can currently be returned to Casey for festival tickets.",
    "isPartOf": { "@id": "https://www.timlostsomething.com/#website" },
    "about": [
      { "@type": "Place", "name": "Seba Beach, Alberta" },
      { "@type": "Thing", "name": "In the Woods Music Festival golf-ball search" }
    ],
    "inLanguage": "en-CA"
  }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&amp;display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="stylesheet" href="/css/campaign-shell.css" />
</head>
<body class="campaign-page campaign-page--landing" data-campaign-route="golf-balls">
  <!-- CAMPAIGN_SHELL {"route":"golf-balls","skipLabel":"Skip to Casey's search","skipTarget":"main"} -->
  <main id="main" tabindex="-1">
    <section class="golf-ball-hero">
      <div class="wrap">
        <p class="kicker">A second local search · Seba Beach, Alberta</p>
        <h1>Casey lost the golf balls.</h1>
        <p class="sub">Specially marked In the Woods golf balls are hidden throughout the wider area where people are already searching.</p>
      </div>
    </section>

    <section class="answer-block" aria-labelledby="qualifying-ball-title">
      <div class="wrap answer-block__inner">
        <p class="eyebrow">Know what counts</p>
        <h2 id="qualifying-ball-title">Look for the official In the Woods logo.</h2>
        <p class="section-lead">Only the specially marked balls qualify. Ordinary golf balls do not qualify for this offer.</p>
      </div>
    </section>

    <section class="golf-ball-steps" aria-labelledby="golf-ball-steps-title">
      <div class="wrap">
        <p class="eyebrow">How it works</p>
        <h2 class="section-title" id="golf-ball-steps-title">Find it. Return it. See the show.</h2>
        <ol class="case-timeline">
          <li><strong>Find:</strong> Look for a golf ball carrying the official In the Woods logo.</li>
          <li><strong>Return:</strong> Bring the qualifying ball back to Casey.</li>
          <li><strong>Redeem:</strong> The current offer is one qualifying ball for one In the Woods Music Festival ticket.</li>
        </ol>
        <p class="section-note">Finer redemption details may be updated. The marked ball must be returned when redeemed.</p>
      </div>
    </section>

    <section class="golf-ball-contact" aria-labelledby="golf-ball-contact-title">
      <div class="wrap">
        <p class="eyebrow">Talk to Casey</p>
        <h2 class="section-title" id="golf-ball-contact-title">Casey handles golf-ball redemption.</h2>
        <p class="section-lead">Visit Casey at the SebaHub School Monday through Friday, or email to coordinate.</p>
        <div class="cta-row">
          <a class="btn" href="mailto:casey@sebahub.com">Email Casey</a>
          <a class="btn" href="https://www.inthewoodsmusicfestival.com/" target="_blank" rel="noopener" aria-label="Visit the In the Woods Music Festival website (opens in a new tab)">Visit the festival website</a>
          <a class="btn" href="/rules">Read the search rules</a>
        </div>
      </div>
    </section>

    <section class="rules" aria-labelledby="golf-ball-safety-title">
      <div class="wrap">
        <p class="eyebrow">Same search area, same care</p>
        <h2 class="section-title" id="golf-ball-safety-title">A golf ball never overrides a boundary.</h2>
        <p class="section-lead">Follow current open and restricted area labels. Do not enter private, occupied, fenced, closed or hazardous areas.</p>
      </div>
    </section>
  </main>
  <!-- CAMPAIGN_FOOTER -->
  <script src="/js/site.js"></script>
  <script type="module" src="/assets/app/status.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add restrained page styling**

Add these styles before the validation-environment section in `css/style.css`:

```css
/* ---------- Casey's golf-ball search ---------- */
.golf-ball-hero {
  color: var(--cream-100);
  background:
    linear-gradient(90deg, rgba(7, 31, 28, .98), rgba(7, 31, 28, .78)),
    url("../assets/photos/hero-aerial.jpg") center 42% / cover no-repeat;
}
.golf-ball-hero .wrap { max-width: 940px; text-align: left; }
.golf-ball-hero .sub { max-width: 760px; margin-inline: 0; }
.golf-ball-steps { background: var(--cream-100); }
.golf-ball-contact {
  color: var(--cream-100);
  background: var(--green-950);
}
.golf-ball-contact .section-title { color: var(--gold-300); }
.golf-ball-contact .section-lead { color: var(--cream-100); }
.golf-ball-contact .cta-row { justify-content: center; }
```

Add `.golf-ball-steps` to the existing light-surface selector group that sets
`--campaign-focus: var(--campaign-focus-dark)`. Add `.golf-ball-hero`,
`.golf-ball-contact` and `.golf-ball-teaser` to the dark-surface selector group
that sets `--campaign-focus: var(--campaign-focus-light)`.

Update the corresponding exact selector expectations in
`tests/campaign-design-system.test.mjs`. This makes every new surface inherit a
focus color with verified contrast instead of relying on incidental cascade.

Do not add fabricated golf-ball artwork or a festival visual theme.

- [ ] **Step 3: Run the focused page tests**

Run:

```powershell
node --test tests/golf-ball-search.test.mjs tests/campaign-design-system.test.mjs
```

Expected: route, copy, metadata, safety and temporary-build tests pass; the
homepage test remains red until Task 4.

- [ ] **Step 4: Commit the dedicated page**

```powershell
git add golf-balls.html css/style.css tests/campaign-design-system.test.mjs
git commit -m "feat: add Casey golf-ball search page"
```

## Task 4: Refresh Tim's Growing-Cash Story

**Files:**
- Modify: `index.html`
- Modify: `route.html`
- Modify: `sitemap.xml`
- Modify: `README.md`
- Test: `tests/golf-ball-search.test.mjs`
- Test: `tests/release2b-documentary.test.mjs`
- Modify: `tests/campaign-shell-preservation.test.mjs`
- Modify: `tests/fixtures/campaign-page-preservation.json`

- [ ] **Step 1: Update homepage metadata and structured answers**

In `index.html`, make every summary distinguish the initial loss from the
current estimate. Use these exact claims:

```html
<meta name="description" content="Tim's ID and two diamond rings are still missing. The Seba Beach search began with roughly $5,000 cash, and the amount now believed to be out there is approaching $10,000." />
```

Update the WebPage description and FAQ answer for **What did Tim lose?** to:

```json
"Tim originally lost his government ID, roughly $5,000 in cash, and two diamond rings. The ID and rings remain missing, Tim keeps retracing his steps, and the cash now believed to be in the search area is approaching $10,000."
```

Do not describe `$10,000` as exact, guaranteed or continuously available.

- [ ] **Step 2: Refresh the homepage hero, cards and chronology**

Use this hero copy:

```html
<p class="sub">His ID and <strong>two diamond rings are still missing</strong>. The search began with roughly <strong>$5,000 cash</strong>—but Tim keeps retracing his steps, cash keeps falling out, and the amount now believed to be out there is <strong>approaching $10,000</strong>.</p>
```

Change the cash card to:

```html
<article class="case-card"><p class="case-card__label">Finder may keep</p><h3>Cash approaching $10,000</h3><p>The search began with roughly $5,000. The estimate keeps growing as Tim retraces his steps.</p></article>
```

Change the rings card to state that both rings remain missing in separate small
baggies across the wider search area.

Add this chronology entry after the existing back-at-the-school entry:

```html
<li><strong>The search continues:</strong> Tim keeps retracing the same route looking for his ID. Cash keeps falling out along the way, so a place that came up empty earlier may not be empty now.</li>
```

- [ ] **Step 3: Add the homepage Casey teaser**

Insert this section after the latest approved update and before safe
participation:

```html
<section class="golf-ball-teaser" id="casey-search" aria-labelledby="casey-search-title">
  <div class="wrap">
    <p class="eyebrow">A second local search</p>
    <h2 class="section-title" id="casey-search-title">Casey lost something too.</h2>
    <p class="section-lead">Specially marked In the Woods golf balls are hidden throughout the same wider search area. Find one and the current offer may be worth a ticket to the festival.</p>
    <p class="center"><a class="btn" href="/golf-balls">Follow Casey's golf-ball search</a></p>
  </div>
</section>
```

Add this style beside the dedicated-page styles:

```css
.golf-ball-teaser {
  color: var(--cream-100);
  background: var(--green-900);
}
.golf-ball-teaser .section-title { color: var(--gold-300); }
.golf-ball-teaser .section-lead { color: var(--cream-100); }
```

- [ ] **Step 4: Update homepage quick answers**

Use:

```html
<div><dt>What did Tim lose?</dt><dd>His government ID, roughly <strong>$5,000 in initial cash</strong>, and <strong>two diamond rings</strong>. The ID and rings remain missing.</dd></div>
<div><dt>How much cash is out there?</dt><dd>The search began with roughly $5,000. Tim keeps retracing his steps and losing more cash, so the current estimate is <strong>approaching $10,000</strong>.</dd></div>
```

Retain the finder-may-keep answer and the ID return instructions.

- [ ] **Step 5: Update route discovery copy without changing stops**

In `route.html`:

- change meta and social descriptions from “roughly $5,000” to “a search that
  began with roughly $5,000 and now approaches $10,000”;
- change the route cash summary heading to `Cash approaching $10,000`;
- state that the original confirmed photo showed the initial cash;
- preserve all 13 stop sections, photos, waypoint IDs and gated controls
  byte-for-byte outside the affected summary copy.

- [ ] **Step 6: Add sitemap and README discovery**

Add this sitemap record:

```xml
<url>
  <loc>https://www.timlostsomething.com/golf-balls</loc>
  <lastmod>2026-07-29</lastmod>
  <changefreq>daily</changefreq>
  <priority>0.8</priority>
</url>
```

Set the homepage and route `lastmod` values to `2026-07-29`.

Add this README route row:

```markdown
| `/golf-balls` | Casey's separate search for marked In the Woods golf balls and current festival-ticket redemption details |
```

Add one paragraph explaining that Tim's initial `$5,000` story remains the
origin while the current estimate approaches `$10,000`.

- [ ] **Step 7: Update the documentary order test**

In `tests/release2b-documentary.test.mjs`, change the expected homepage order
to:

```js
const ids = [
  "what-is-tim-lost-something",
  "evidence",
  "account",
  "route-overview",
  "latest-update",
  "casey-search",
  "participate",
  "report",
  "hunt-faq",
];
```

Replace its original `$5,000` assertion with:

```js
assert.match(
  visibleText(html),
  /search began with roughly \$5,000[^.]{0,180}approaching \$10,000/i,
);
```

Update sitemap expectations so `/` and `/route` use `2026-07-29`, add
`/golf-balls` with `2026-07-29`, and preserve existing dates for unaffected
routes.

- [ ] **Step 8: Run the story tests**

Before running the story suite, add `"golf-balls.html"` to
`authorizedBodyClasses` only if its body uses a new functional class. With the
approved `campaign-page--landing` implementation, no new authorized class is
needed.

Add `golf-balls.html` to the preservation manifest and refresh only the
`index.html`, `route.html` and `golf-balls.html` hash records using the exported
`preservationHashes()` helper. Keep every unrelated page hash unchanged. Set
the manifest `baseCommit` and the test's `baseCommit` constant to the exact
pre-refresh reviewed source commit:

```powershell
$baseline = git rev-parse HEAD
$env:PRESERVATION_BASELINE = $baseline
@'
import { readFileSync, writeFileSync } from "node:fs";
import { preservationHashes } from "./tests/campaign-shell-preservation.test.mjs";

const manifestPath = "./tests/fixtures/campaign-page-preservation.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.baseCommit = process.env.PRESERVATION_BASELINE;
for (const filename of ["index.html", "route.html", "golf-balls.html"]) {
  manifest.pages[filename] = preservationHashes(readFileSync(filename, "utf8"), filename);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
'@ | node --input-type=module
```

Update the literal `baseCommit` in
`tests/campaign-shell-preservation.test.mjs` to the same `$baseline` value.
Inspect all three hash records before staging; do not recalculate legal
document hashes.

Then run:

Run:

```powershell
node --test tests/golf-ball-search.test.mjs tests/release2b-documentary.test.mjs tests/interview-integrity.test.mjs tests/public-content-safety.test.mjs tests/campaign-shell-preservation.test.mjs
```

Expected: all focused story, interview, safety and build tests pass.

- [ ] **Step 9: Commit the story refresh**

```powershell
git add index.html route.html css/style.css sitemap.xml README.md tests/release2b-documentary.test.mjs tests/campaign-shell-preservation.test.mjs tests/fixtures/campaign-page-preservation.json
git commit -m "feat: connect growing cash and Casey search"
```

## Task 5: Extend Shared-Shell and Responsive QA

**Files:**
- Modify: `tests/public-case-story-cleanup.test.mjs`
- Modify: `tests/navigation-geometry.test.mjs`
- Modify: `scripts/verify-unified-shell-qa.mjs`
- Modify: `tests/unified-shell-qa-contract.test.mjs`
- Modify: `tests/sponsor-page.test.mjs`
- Test: `tests/golf-ball-search.test.mjs`

- [ ] **Step 1: Include the new page in explicit campaign matrices**

Add `"golf-balls.html"` after `"route.html"` in `campaignFiles` in
`tests/navigation-geometry.test.mjs`, and add `"golf-balls"` to `menuRoutes`.

Add `golf-balls.html` to the short-mobile file list:

```js
{
  viewport: { width: 720, height: 500 },
  files: ["index.html", "route.html", "golf-balls.html", "interview.html", "clue-board.html"],
},
```

- [ ] **Step 2: Cover the new public page in copy cleanup**

In `tests/public-case-story-cleanup.test.mjs`, assert:

```js
assert.match(read("golf-balls.html"), /Casey Lost the Golf Balls/);
assert.doesNotMatch(
  visibleText(read("golf-balls.html")),
  /\bcampaign\b|\boperators?\b|Support the Search/i,
);
```

The page will already enter `nonLegalPublicPages` through `CAMPAIGN_PAGES`; do
not create a second hard-coded scan list.

- [ ] **Step 3: Add representative screenshots**

In `scripts/verify-unified-shell-qa.mjs`:

- add `"golf-balls.html"` to `representativeFiles` and `screenshotFiles`;
- add `mobile-390x844-golf-balls.png` and
  `desktop-1440x1000-golf-balls.png` to `expectedScreenshotNames`;
- use the existing filename-to-screenshot naming pattern without a new
  screenshot subsystem.

Update the exact assertions for the expanded matrices:

```js
assert.equal(pageNavigations, 72, "the canonical matrix must navigate 72 page/view combinations");
assert.equal(statesAudited, 111, "the canonical matrix must audit 111 shell states");
assert.equal(screenshotEvidence.length, 21, "the screenshot suite must contain 21 artifacts");
```

The counts derive from thirteen campaign pages across five full matrices plus
seven representative-page navigations, with three menu-open matrices.

Update `tests/unified-shell-qa-contract.test.mjs` to expect:

```js
assert.match(script, /statesAudited,\s*111/);
assert.match(script, /pageNavigations,\s*72/);
assert.match(script, /screenshotEvidence\.length,\s*21/);
assert.match(script, /mobile-390x844-golf-balls\.png/);
assert.match(script, /desktop-1440x1000-golf-balls\.png/);
```

- [ ] **Step 4: Keep sponsorship absent from the new page**

Add `"golf-balls.html"` to the public-page array in the
`public campaign pages do not expose sponsorship navigation or footer links`
test in `tests/sponsor-page.test.mjs`.

- [ ] **Step 5: Run shell and navigation tests**

Run:

```powershell
node --test tests/navigation-geometry.test.mjs tests/public-case-story-cleanup.test.mjs tests/golf-ball-search.test.mjs tests/unified-shell-qa-contract.test.mjs tests/sponsor-page.test.mjs
```

Expected: every page has one shell, one active menu item where applicable, no
horizontal overflow, and a keyboard-reachable menu at all tested widths.

- [ ] **Step 6: Run the isolated browser audit**

Run:

```powershell
$env:UNIFIED_SHELL_QA_PRESERVE_ARTIFACTS='1'
npm run verify:unified-shell-qa
```

Expected: zero console, page, request, overflow and write errors. Inspect both
new golf-ball screenshots and verify readable wrapping, visible actions and no
fabricated imagery.

- [ ] **Step 7: Commit the QA expansion**

```powershell
git add tests/public-case-story-cleanup.test.mjs tests/navigation-geometry.test.mjs scripts/verify-unified-shell-qa.mjs tests/unified-shell-qa-contract.test.mjs tests/sponsor-page.test.mjs
git commit -m "test: cover golf-ball page responsiveness"
```

## Task 6: Run the Complete Local Release Gate

**Files:**
- Modify only if a failing regression identifies a directly related defect.

- [ ] **Step 1: Verify authoritative legal artifacts**

Run:

```powershell
npm run legal:verify
```

Expected: the generated Privacy and Waiver documents match their authoritative
sources exactly.

- [ ] **Step 2: Run every TypeScript project**

Run:

```powershell
npm run typecheck
```

Expected: worker, client and test typechecks pass.

- [ ] **Step 3: Run the complete automated suite**

Run:

```powershell
npm test
```

Expected: all JavaScript and TypeScript tests pass. Do not stop unrelated live
processes to work around a local port conflict; isolate and report the exact
runner if it does not terminate.

- [ ] **Step 4: Produce a clean production-shaped build**

Run:

```powershell
npm run build
```

Expected: `dist/golf-balls.html` exists, the build contains the shared shell,
and no sponsor surface or retired pirate asset enters public output.

- [ ] **Step 5: Verify public output and links**

Run:

```powershell
node --test tests/public-content-safety.test.mjs tests/release2b-documentary.test.mjs tests/golf-ball-search.test.mjs
git diff --check
```

Expected: no privacy fixture, unsafe coordinates, invented claim, malformed
structured data, whitespace error or stale story contract.

- [ ] **Step 6: Review the complete diff**

Run:

```powershell
git status --short
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- index.html route.html golf-balls.html css/style.css scripts/campaign-shell.mjs scripts/build.mjs sitemap.xml README.md tests
```

Expected: only the approved static story, shell, tests and documentation are
present. No legal, API, database, authentication, Ops or credential file is
changed.

## Task 7: Prepare and Deploy the Validation Candidate

**Files:**
- Create: `docs/operations/2026-07-29-casey-golf-ball-search-validation.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Run the public-release privacy gate**

Read and follow the `public-release-privacy-check` skill against the exact
`dist` artifact. Confirm no credential value, private submission, exact gated
route control, customer data or local personal path is present.

- [ ] **Step 2: Commit the exact tested candidate**

Run:

```powershell
git status --short
git add index.html route.html golf-balls.html css/style.css scripts/campaign-shell.mjs scripts/build.mjs sitemap.xml README.md tests/golf-ball-search.test.mjs tests/interview-integrity.test.mjs tests/public-content-safety.test.mjs tests/release2b-documentary.test.mjs tests/public-case-story-cleanup.test.mjs tests/campaign-shell.test.mjs tests/campaign-design-system.test.mjs tests/campaign-shell-preservation.test.mjs tests/fixtures/campaign-page-preservation.json tests/navigation-geometry.test.mjs scripts/verify-unified-shell-qa.mjs tests/unified-shell-qa-contract.test.mjs tests/sponsor-page.test.mjs
git commit -m "feat: add Casey golf-ball search"
$candidate = git rev-parse HEAD
$short = git rev-parse --short HEAD
```

Expected: the candidate commit contains only reviewed application and test
paths. If prior task commits already contain every path and the tree is clean,
record the existing `HEAD` rather than creating an empty commit.

- [ ] **Step 3: Rebuild the exact committed source**

Run:

```powershell
npm run build
git status --short
```

Expected: build passes and tracked source remains clean. Generated `dist`
output is ignored.

- [ ] **Step 4: Deploy only to validation**

Run:

```powershell
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation --commit-hash $candidate --commit-message "Validation: Casey golf-ball search and growing cash"
```

Expected: Wrangler returns an immutable
`*.seba-treasure-hunt.pages.dev` URL. Do not use `--branch main`, change DNS,
run migrations or deploy the media worker.

- [ ] **Step 5: Verify stable and immutable validation**

Check both the immutable URL and:

```text
https://codex-validation.seba-treasure-hunt.pages.dev/?release=<short>
https://codex-validation.seba-treasure-hunt.pages.dev/golf-balls?release=<short>
```

Verify:

- both return HTTP 200;
- `/api/v1/config` identifies `deploymentEnvironment: validation`;
- the validation notice is present;
- homepage Tim and Casey copy matches the reviewed artifact;
- `/golf-balls` has one active **Golf Balls** nav item;
- Casey email and festival links are correct;
- no authenticated route, report or Ops workflow was changed;
- `https://www.timlostsomething.com/` still serves the prior production
  release.

- [ ] **Step 6: Record the validation release**

Create `docs/operations/2026-07-29-casey-golf-ball-search-validation.md` with:

- source commit;
- immutable and stable validation URLs;
- `validation` runtime result;
- test and browser-audit counts;
- confirmed story facts;
- explicit “no migration, production deployment or production data mutation”;
- owner-review checklist for desktop and phone.

Prepend a dated update to `STATUS.md` containing the same durable identifiers
and the next decision: owner approval or requested revisions.

- [ ] **Step 7: Commit the handoff record**

```powershell
git add docs/operations/2026-07-29-casey-golf-ball-search-validation.md STATUS.md
git commit -m "docs: record golf-ball validation release"
git status --short
```

Expected: clean worktree and a validation URL ready for Murphy. Stop before
production promotion.

## Owner Validation Checklist

Murphy should review the validation candidate on desktop and a phone:

1. Confirm Tim remains the homepage lead.
2. Confirm `$5,000` reads as the initial amount and “approaching $10,000” feels
   appropriately mysterious rather than guaranteed.
3. Confirm the ID and both ring baggies remain missing.
4. Confirm the Casey teaser appears after the primary case content.
5. Open **Golf Balls** from the desktop and mobile navigation.
6. Confirm only logo-marked balls qualify.
7. Confirm the current one-ball/one-ticket wording is acceptable pending finer
   terms.
8. Confirm Casey is the only redemption contact.
9. Test the Casey email, festival website and Rules links.
10. Confirm the new page remains readable at normal and enlarged text sizes.

Production promotion requires a new explicit Murphy approval after this
checklist. The production release must use the exact approved candidate and
must repeat the production-preservation and rollback checks documented in the
current operations handoff.
