# Unified Campaign Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every public and hunter-facing Tim Lost Something? route one build-time campaign shell, canonical eight-item navigation, coherent visual system, and route-wide accessibility/geometry verification while leaving the restricted Ops console distinct.

**Architecture:** A new pure build module owns the route registry and renders the status strip, header, navigation, skip link, and footer from one route descriptor. Source pages retain only declarative shell/footer markers; `scripts/build.mjs` writes complete accessible HTML into `dist`. One canonical stylesheet and the existing shared `js/site.js` own shell appearance and behavior, while page styles keep Route, Interview, Clue Board, Dashboard, Sponsors, and legal documents purpose-specific.

**Tech Stack:** Static HTML, Node.js ESM build scripts, CSS custom properties, browser JavaScript, TypeScript clients, Node test runner, Playwright, axe-core, Cloudflare Pages build output.

---

## File structure and ownership

- Create `scripts/campaign-shell.mjs`: route registry, marker parser, HTML escaping, canonical shell/footer rendering, and page validation.
- Modify `scripts/build.mjs`: render in-scope HTML through `campaign-shell.mjs`; continue copying `/ops` unchanged.
- Create `css/campaign-shell.css`: the only public status-strip/header/navigation/footer/skip-link stylesheet.
- Modify `js/site.js`: canonical shell geometry and mobile-menu behavior only; existing home cards/gallery remain intact.
- Modify the thirteen in-scope HTML files: replace duplicated shell/footer markup with declarative markers, add canonical stylesheet, and apply shared page classes.
- Modify `src/client/board.ts`: remove its duplicate case-status presentation/fetch after the Clue Board adopts the shared status client.
- Modify `css/style.css`, `css/hunter.css`, `css/board.css`, and `css/sponsors.css`: retire competing shell rules and bridge page-specific components to shared tokens.
- Create `tests/campaign-shell.test.mjs`: pure renderer, marker validation, route/current-state, link-order, and build-failure tests.
- Create `tests/campaign-design-system.test.mjs`: shared stylesheet/token and legacy-shell-removal contracts.
- Modify `tests/hunter-ui-pages.test.mjs`, `tests/sponsor-page.test.mjs`, `tests/homepage-actions.test.mjs`, and `tests/navigation-geometry.test.mjs`: inspect rendered pages and canonical selectors.
- Modify `tests/ops-board-ui-contract.test.mjs` only where the Clue Board shell/status contract changes; Ops expectations remain separate.
- Modify `DESIGN.md`, `README.md`, and `STATUS.md`: record the canonical shell source, route contract, verification, and non-deployment state.

## Canonical route descriptors

The implementation uses these exact identifiers and skip targets:

| File | Route id | Primary menu current item | Skip label | Target |
| --- | --- | --- | --- | --- |
| `index.html` | `home` | none | Skip to the campaign | `main` |
| `start.html` | `start` | Start | Skip to the hunt guide | `main` |
| `route.html` | `route` | 12-waypoint Route | Skip to the route | `main` |
| `interview.html` | `interview` | none | Skip to the interview | `main` |
| `updates.html` | `updates` | Updates | Skip to official updates | `main` |
| `clue-board.html` | `clue-board` | Clue Board | Skip to the clue board | `main` |
| `report.html` | `report` | Report | Skip to private reporting | `main` |
| `rules.html` | `rules` | Rules | Skip to the current rules | `main` |
| `dashboard.html` | `dashboard` | Dashboard | Skip to Hunter Dashboard | `main` |
| `sponsors.html` | `sponsors` | Sponsors | Skip to sponsor opportunities | `main` |
| `privacy.html` | `privacy` | none | Skip to the privacy policy | `main` |
| `waiver.html` | `waiver` | none | Skip to the participation waiver | `main` |
| `community-guidelines.html` | `community-guidelines` | none | Skip to the community guidelines | `main` |

The exact canonical menu is:

```js
[
  ["start", "Start", "/start"],
  ["route", "12-waypoint Route", "/route"],
  ["updates", "Updates", "/updates"],
  ["clue-board", "Clue Board", "/clue-board"],
  ["report", "Report", "/report"],
  ["rules", "Rules", "/rules"],
  ["dashboard", "Dashboard", "/dashboard"],
  ["sponsors", "Sponsors", "/sponsors"],
]
```

---

### Task 1: Create the pure campaign-shell renderer

**Files:**
- Create: `scripts/campaign-shell.mjs`
- Create: `tests/campaign-shell.test.mjs`

- [ ] **Step 1: Write failing renderer and validation tests**

Create `tests/campaign-shell.test.mjs` with tests that import the future renderer and assert:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_PAGES,
  CAMPAIGN_MENU,
  renderCampaignPage,
} from "../scripts/campaign-shell.mjs";

const source = ({ route = "route", target = "main", label = "Skip to the route" } = {}) => `<!doctype html>
<html lang="en-CA"><head><title>Test</title></head>
<body class="campaign-page" data-campaign-route="${route}">
<!-- CAMPAIGN_SHELL ${JSON.stringify({ route, skipLabel: label, skipTarget: target })} -->
<main id="${target}"></main>
<!-- CAMPAIGN_FOOTER -->
</body></html>`;

test("renders one complete canonical shell and footer", () => {
  const html = renderCampaignPage(source(), "route.html");
  assert.equal((html.match(/class="case-strip"/g) ?? []).length, 1);
  assert.equal((html.match(/class="campaign-header"/g) ?? []).length, 1);
  assert.equal((html.match(/class="campaign-nav"/g) ?? []).length, 1);
  assert.equal((html.match(/class="campaign-footer"/g) ?? []).length, 1);
  assert.deepEqual(
    [...html.matchAll(/class="campaign-nav"[\s\S]*?<\/nav>/g)][0][0]
      .match(/href="[^"]+"/g),
    CAMPAIGN_MENU.map((item) => `href="${item.href}"`),
  );
  assert.match(html, /href="\/route" aria-current="page"/);
  assert.match(html, /href="\/sponsors"[^>]*class="nav-sponsors"/);
});

test("home, interview and legal routes do not invent a primary current item", () => {
  for (const route of ["home", "interview", "privacy", "waiver", "community-guidelines"]) {
    const html = renderCampaignPage(source({ route }), `${route}.html`);
    assert.doesNotMatch(html.match(/<nav class="campaign-nav"[\s\S]*?<\/nav>/)[0], /aria-current/);
  }
});

test("fails closed on unknown routes, duplicate or missing markers, unsafe skip data, and missing target", () => {
  assert.throws(() => renderCampaignPage(source({ route: "other" }), "bad.html"), /unknown campaign route/i);
  assert.throws(() => renderCampaignPage(source().replace("<!-- CAMPAIGN_FOOTER -->", ""), "bad.html"), /footer marker/i);
  assert.throws(() => renderCampaignPage(source() + "<!-- CAMPAIGN_FOOTER -->", "bad.html"), /exactly one footer marker/i);
  assert.throws(() => renderCampaignPage(source({ target: "not there" }), "bad.html"), /skip target/i);
  assert.throws(() => renderCampaignPage(source({ label: '\" onfocus=\"alert(1)' }), "bad.html"), /skip label/i);
});

test("registry covers exactly the thirteen approved public and hunter pages", () => {
  assert.deepEqual(Object.keys(CAMPAIGN_PAGES).sort(), [
    "clue-board.html", "community-guidelines.html", "dashboard.html", "index.html",
    "interview.html", "privacy.html", "report.html", "route.html", "rules.html",
    "sponsors.html", "start.html", "updates.html", "waiver.html",
  ]);
});
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run:

```powershell
node --test tests/campaign-shell.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/campaign-shell.mjs`.

- [ ] **Step 3: Implement the pure renderer**

Create `scripts/campaign-shell.mjs` with these public contracts:

```js
export const CAMPAIGN_MENU = Object.freeze([
  { route: "start", label: "Start", href: "/start" },
  { route: "route", label: "12-waypoint Route", href: "/route" },
  { route: "updates", label: "Updates", href: "/updates" },
  { route: "clue-board", label: "Clue Board", href: "/clue-board" },
  { route: "report", label: "Report", href: "/report" },
  { route: "rules", label: "Rules", href: "/rules" },
  { route: "dashboard", label: "Dashboard", href: "/dashboard" },
  { route: "sponsors", label: "Sponsors", href: "/sponsors" },
]);

export const CAMPAIGN_PAGES = Object.freeze({
  "index.html": "home",
  "start.html": "start",
  "route.html": "route",
  "interview.html": "interview",
  "updates.html": "updates",
  "clue-board.html": "clue-board",
  "report.html": "report",
  "rules.html": "rules",
  "dashboard.html": "dashboard",
  "sponsors.html": "sponsors",
  "privacy.html": "privacy",
  "waiver.html": "waiver",
  "community-guidelines.html": "community-guidelines",
});

const allowedRoutes = new Set(Object.values(CAMPAIGN_PAGES));
const safeSkipLabel = /^[A-Za-z0-9 ?'&-]{4,80}$/;
const safeTarget = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function renderCampaignPage(source, filename) {
  // Parse exactly one JSON shell marker and one footer marker.
  // Validate filename-to-route, label, target, and an existing target id.
  // Replace markers with renderCampaignShell(descriptor) and renderCampaignFooter(route).
  // Reject any remaining marker or any legacy public shell class.
}
```

The rendered shell must include complete markup for:

```html
<a class="skip-link" href="#main">Skip to the route</a>
<section class="case-strip" data-case-status data-status="unavailable" role="status" aria-live="polite" aria-atomic="true">...</section>
<header class="campaign-header">
  <div class="campaign-header__inner">
    <a class="campaign-brand" href="/">Tim Lost Something?<span>This year: Tim lost his ID</span></a>
    <button class="campaign-menu-toggle" type="button" aria-expanded="false" aria-controls="campaign-nav"><span class="sr-only">Toggle campaign menu</span><span aria-hidden="true">&#9776;</span></button>
    <nav class="campaign-nav" id="campaign-nav" aria-label="Campaign">...</nav>
  </div>
</header>
```

The footer must contain `/privacy`, `/waiver`, `/community-guidelines`, `/rules`, and `/sponsors` in that order and use `aria-current="page"` only when the current route matches the footer destination.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/campaign-shell.test.mjs
node --check scripts/campaign-shell.mjs
```

Expected: all renderer tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the renderer**

```powershell
git add scripts/campaign-shell.mjs tests/campaign-shell.test.mjs
git commit -m "feat: add canonical campaign shell renderer"
```

---

### Task 2: Integrate rendering into the build and migrate all page markers

**Files:**
- Modify: `scripts/build.mjs`
- Modify: `index.html`
- Modify: `start.html`
- Modify: `route.html`
- Modify: `interview.html`
- Modify: `updates.html`
- Modify: `clue-board.html`
- Modify: `report.html`
- Modify: `rules.html`
- Modify: `dashboard.html`
- Modify: `sponsors.html`
- Modify: `privacy.html`
- Modify: `waiver.html`
- Modify: `community-guidelines.html`
- Create: `tests/render-campaign-page.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `tests/sponsor-page.test.mjs`
- Modify: `tests/homepage-actions.test.mjs`

- [ ] **Step 1: Write failing build-integration tests**

Extend `tests/campaign-shell.test.mjs` to read every registered source page and require its declared marker descriptor to match the route table. Create `tests/render-campaign-page.mjs`:

```js
import { readFileSync } from "node:fs";
import { renderCampaignPage } from "../scripts/campaign-shell.mjs";

export const readRenderedCampaignPage = (filename) =>
  renderCampaignPage(
    readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"),
    filename,
  );
```

In existing static tests, use `readRenderedCampaignPage(file)` only when inspecting shared shell/footer markup. Continue reading source directly for page body, metadata, and script hooks.

Add a test that runs the build and inspects `dist`:

```js
test("build emits complete shells and leaves Ops independent", () => {
  execFileSync(process.execPath, [new URL("../scripts/build.mjs", import.meta.url)], { cwd: root });
  for (const file of Object.keys(CAMPAIGN_PAGES)) {
    const html = readFileSync(path.join(root, "dist", file), "utf8");
    assert.match(html, /class="campaign-header"/);
    assert.doesNotMatch(html, /CAMPAIGN_SHELL|CAMPAIGN_FOOTER/);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "dist", "ops.html"), "utf8"), /class="campaign-header"/);
});
```

- [ ] **Step 2: Run shell/static tests and verify RED**

Run:

```powershell
node --test tests/campaign-shell.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs
```

Expected: FAIL because pages still contain hand-authored shells and `build.mjs` copies them unchanged.

- [ ] **Step 3: Replace duplicated source shells with exact descriptors**

For each in-scope page:

1. retain metadata and body content;
2. set `class="campaign-page ..."` on `<body>` while preserving existing page classes;
3. remove the existing skip link, case strip/signal, public header, and public footer;
4. insert exactly one JSON marker immediately after `<body>`; and
5. insert `<!-- CAMPAIGN_FOOTER -->` immediately before page scripts.

Example for `route.html`:

```html
<body class="campaign-page route-page" data-campaign-route="route">
  <!-- CAMPAIGN_SHELL {"route":"route","skipLabel":"Skip to the route","skipTarget":"main"} -->
  <main id="main" tabindex="-1">
    ...existing route content unchanged...
  </main>
  <!-- CAMPAIGN_FOOTER -->
  ...existing page scripts...
</body>
```

Apply the exact route/skip descriptors from the table above. Ensure `index.html`, `route.html`, and `interview.html` rename their primary content landmark to `id="main"` without changing internal section anchors. Do not add the shell markers to `ops.html`.

- [ ] **Step 4: Render campaign pages instead of copying them**

Modify `scripts/build.mjs` to import `CAMPAIGN_PAGES` and `renderCampaignPage`, then replace the static-file copy loop:

```js
import { readFile, writeFile } from "node:fs/promises";
import { CAMPAIGN_PAGES, renderCampaignPage } from "./campaign-shell.mjs";

for (const file of staticFiles) {
  const source = path.join(root, file);
  const target = path.join(dist, file);
  if (Object.hasOwn(CAMPAIGN_PAGES, file)) {
    const html = await readFile(source, "utf8");
    await writeFile(target, renderCampaignPage(html, file), "utf8");
  } else {
    await cp(source, target);
  }
}
```

The build must throw before emitting a partial site if a registered page is missing or invalid.

- [ ] **Step 5: Update static tests to inspect rendered shell markup**

Use `readRenderedCampaignPage()` for header/footer assertions. Change old expectations:

- `id="nav"` becomes `id="campaign-nav"`;
- `.topbar`, `.hunter-header`, `.board-topbar` become `.campaign-header`;
- `.hunter-nav`, `.board-nav` become `.campaign-nav`;
- all menu/footer destinations become root-relative extensionless paths;
- the Clue Board now contains all eight canonical menu items;
- Interview remains out of the primary menu.

- [ ] **Step 6: Run build/static regression tests and verify GREEN**

Run:

```powershell
node --test tests/campaign-shell.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs
npm run build
```

Expected: tests PASS; build emits thirteen complete shells and an unchanged independent Ops shell.

- [ ] **Step 7: Commit the build migration**

```powershell
git add scripts/build.mjs tests/render-campaign-page.mjs tests/campaign-shell.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs index.html start.html route.html interview.html updates.html clue-board.html report.html rules.html dashboard.html sponsors.html privacy.html waiver.html community-guidelines.html
git commit -m "refactor: generate one public campaign shell"
```

---

### Task 3: Add canonical shell styling and behavior

**Files:**
- Create: `css/campaign-shell.css`
- Modify: `css/style.css`
- Modify: `css/hunter.css`
- Modify: `css/board.css`
- Modify: `css/sponsors.css`
- Modify: `js/site.js`
- Modify: all thirteen in-scope HTML files
- Create: `tests/campaign-design-system.test.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `tests/sponsor-page.test.mjs`

- [ ] **Step 1: Write failing canonical-style and behavior contracts**

Create `tests/campaign-design-system.test.mjs` and assert:

```js
test("one stylesheet owns the public shell", () => {
  const shell = read("css/campaign-shell.css");
  for (const selector of [
    ".case-strip", ".campaign-header", ".campaign-header__inner", ".campaign-brand",
    ".campaign-menu-toggle", ".campaign-nav", ".campaign-footer", ".skip-link",
  ]) assert.match(shell, new RegExp(selector.replace(".", "\\.")));

  for (const legacy of ["css/style.css", "css/hunter.css", "css/board.css", "css/sponsors.css"]) {
    const css = read(legacy);
    assert.doesNotMatch(css, /\.(?:topbar|hunter-header|board-topbar|hunter-nav|board-nav|case-signal)\b/);
  }
});

test("every campaign page loads canonical shell CSS last", () => {
  for (const file of Object.keys(CAMPAIGN_PAGES)) {
    const source = read(file);
    assert.match(source, /<link rel="stylesheet" href="\/css\/campaign-shell\.css"\s*\/?>/);
    assert.ok(source.lastIndexOf("/css/campaign-shell.css") > source.lastIndexOf("/css/"));
  }
});

test("shared behavior addresses only canonical shell selectors", () => {
  const site = read("js/site.js");
  assert.match(site, /\.case-strip/);
  assert.match(site, /\.campaign-header/);
  assert.match(site, /\.campaign-menu-toggle/);
  assert.match(site, /#campaign-nav/);
  assert.doesNotMatch(site, /\.case-signal|\.topbar|\.hunter-header|\.board-topbar|#nav\b/);
});
```

- [ ] **Step 2: Run the design-system test and verify RED**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs
```

Expected: FAIL because `css/campaign-shell.css` is absent and legacy shell rules remain.

- [ ] **Step 3: Create the canonical stylesheet**

Create `css/campaign-shell.css` with:

```css
:root {
  --campaign-forest-950: #071f1c;
  --campaign-forest-900: #14261c;
  --campaign-forest-800: #1c3527;
  --campaign-gold-500: #e0a01e;
  --campaign-gold-400: #eab63f;
  --campaign-gold-300: #f2cd6a;
  --campaign-paper-100: #f6efdd;
  --campaign-paper-200: #efe4c6;
  --campaign-paper-300: #e5d5ac;
  --campaign-ink: #241b0f;
  --campaign-rust: #a6452a;
  --campaign-open: #69c58d;
  --campaign-found: #8db8dc;
  --campaign-case-min-height: 54px;
  --campaign-nav-min-height: 66px;
  --case-strip-height: var(--campaign-case-min-height);
  --campaign-nav-height: var(--campaign-nav-min-height);
  --stacked-header-height: calc(var(--case-strip-height) + var(--campaign-nav-height));
  --campaign-max: 1120px;
}

html { scroll-padding-top: var(--stacked-header-height); }
:where(main, section, article, aside, div)[id] { scroll-margin-top: var(--stacked-header-height); }
.campaign-page { min-width: 320px; }
.campaign-page :focus-visible { outline: 3px solid var(--campaign-gold-300); outline-offset: 4px; }
.skip-link { /* fixed, hidden until focus, z-index 2000 */ }
.case-strip { /* sticky first row, measured height, live states */ }
.campaign-header { /* sticky second row at var(--case-strip-height) */ }
.campaign-header__inner { /* max-width flex layout */ }
.campaign-brand { /* Pirata One + Special Elite sub-brand */ }
.campaign-nav { /* exact desktop order, wrapping, current states */ }
.nav-sponsors { /* gold action treatment */ }
.campaign-menu-toggle { display: none; /* accessible 48x44 target */ }
.campaign-footer { /* forest/ink footer with legal navigation */ }

@media (max-width: 760px) {
  :root { --campaign-case-min-height: 72px; --campaign-nav-min-height: 58px; }
  .campaign-menu-toggle { display: inline-flex; }
  .campaign-nav { display: none; }
  .campaign-nav.open { display: flex; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .campaign-page *, .campaign-page *::before, .campaign-page *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Move the complete status/header/footer/skip/mobile rules out of the four legacy stylesheets. Preserve page-body rules.

- [ ] **Step 4: Load canonical CSS after page styles**

Add this as the final stylesheet on all thirteen pages:

```html
<link rel="stylesheet" href="/css/campaign-shell.css" />
```

Normalize older relative stylesheet and script URLs to root-relative URLs while touching those tags.

- [ ] **Step 5: Update shared shell behavior**

Refactor `js/site.js`:

```js
function initStackedHeaderGeometry() {
  var firstRow = document.querySelector(".case-strip");
  var secondRow = document.querySelector(".campaign-header");
  // Preserve measured ResizeObserver/MutationObserver fallback logic.
}

function initNav() {
  var toggle = document.querySelector(".campaign-menu-toggle");
  var nav = document.getElementById("campaign-nav");
  if (!toggle || !nav) return;
  // Toggle .open, update aria-expanded, close on any descendant link,
  // close and restore toggle focus on Escape.
  var desktop = window.matchMedia("(min-width: 761px)");
  var resetAtDesktop = function (event) { if (event.matches) closeNav(toggle, nav); };
  desktop.addEventListener?.("change", resetAtDesktop);
}
```

Do not add a focus trap. Navigation links remain normal document links.

- [ ] **Step 6: Run focused design and static tests**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs tests/campaign-shell.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs
npm run build
```

Expected: PASS; rendered pages contain one visually canonical shell and no legacy shell selector dependency.

- [ ] **Step 7: Commit canonical presentation**

```powershell
git add css/campaign-shell.css css/style.css css/hunter.css css/board.css css/sponsors.css js/site.js tests/campaign-design-system.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs index.html start.html route.html interview.html updates.html clue-board.html report.html rules.html dashboard.html sponsors.html privacy.html waiver.html community-guidelines.html
git commit -m "feat: unify campaign navigation and chrome"
```

---

### Task 4: Bridge shared typography, components, and page rhythm

**Files:**
- Modify: `css/campaign-shell.css`
- Modify: `css/style.css`
- Modify: `css/hunter.css`
- Modify: `css/board.css`
- Modify: `css/sponsors.css`
- Modify: all thirteen in-scope HTML files only where shared classes are required
- Modify: `tests/campaign-design-system.test.mjs`

- [ ] **Step 1: Write failing shared-component contracts**

Require the shared layer to define consistent typography, focus, buttons, notices, forms, and surface tokens without forcing one body layout:

```js
test("shared campaign tokens bridge every page family", () => {
  const css = read("css/campaign-shell.css");
  for (const token of [
    "--campaign-font-display", "--campaign-font-body", "--campaign-font-meta",
    "--campaign-space-section", "--campaign-radius-control", "--campaign-focus",
    "--campaign-surface-paper", "--campaign-surface-dark",
  ]) assert.match(css, new RegExp(token));
  assert.match(css, /\.campaign-page\s+:where\(h1, h2, h3\)/);
  assert.match(css, /:where\(\.btn, \.hunter-button, \.board-button, \.sponsor-button\)/);
  assert.match(css, /:where\(input, select, textarea, button\):focus-visible/);
});

test("page families keep deliberate identities", () => {
  assert.match(read("route.html"), /class="[^"]*campaign-page--route/);
  assert.match(read("interview.html"), /class="[^"]*campaign-page--editorial/);
  assert.match(read("clue-board.html"), /class="[^"]*campaign-page--ledger/);
  assert.match(read("dashboard.html"), /class="[^"]*campaign-page--workspace/);
  assert.match(read("privacy.html"), /class="[^"]*campaign-page--document/);
  assert.match(read("sponsors.html"), /class="[^"]*campaign-page--sponsors/);
});
```

- [ ] **Step 2: Run the component contracts and verify RED**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs
```

Expected: FAIL because shared component tokens and page-family classes are absent.

- [ ] **Step 3: Add the shared token/component bridge**

Extend `css/campaign-shell.css` with:

```css
:root {
  --campaign-font-display: "Pirata One", Georgia, serif;
  --campaign-font-body: "IM Fell English", Georgia, serif;
  --campaign-font-meta: "Special Elite", "Courier New", monospace;
  --campaign-space-section: clamp(3rem, 7vw, 6rem);
  --campaign-radius-control: 10px;
  --campaign-focus: var(--campaign-gold-300);
  --campaign-surface-paper: var(--campaign-paper-100);
  --campaign-surface-dark: var(--campaign-forest-950);
}

.campaign-page { font-family: var(--campaign-font-body); line-height: 1.6; }
.campaign-page :where(h1, h2, h3) {
  font-family: var(--campaign-font-display);
  font-weight: 400;
  line-height: 1.05;
  text-wrap: balance;
}
.campaign-page :where(p, li, dd) { text-wrap: pretty; }
:where(.btn, .hunter-button, .board-button, .sponsor-button) {
  border-radius: var(--campaign-radius-control);
  font-family: var(--campaign-font-display);
}
.campaign-page :where(input, select, textarea, button):focus-visible {
  outline: 3px solid var(--campaign-focus);
  outline-offset: 3px;
}
```

Map existing page-local colour variables to campaign tokens rather than changing their factual content or primary layouts.

- [ ] **Step 4: Apply explicit page-family classes**

Use these body variants:

- `campaign-page--landing`: `index.html`, `start.html`, `updates.html`;
- `campaign-page--route`: `route.html`;
- `campaign-page--editorial`: `interview.html`;
- `campaign-page--ledger`: `clue-board.html`;
- `campaign-page--workspace`: `dashboard.html`, `report.html`;
- `campaign-page--document`: `rules.html`, `privacy.html`, `waiver.html`, `community-guidelines.html`;
- `campaign-page--sponsors`: `sponsors.html`.

Preserve existing functional classes such as `hunter-page`, `board-page`, and `sponsor-page` until their body-specific rules are deliberately migrated.

- [ ] **Step 5: Run component and page regressions**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs tests/hunter-ui-pages.test.mjs tests/sponsor-page.test.mjs tests/ops-board-ui-contract.test.mjs
npm run typecheck:client
npm run build
```

Expected: PASS; Ops CSS/markup remains independent and no client hook changes.

- [ ] **Step 6: Commit the visual-system bridge**

```powershell
git add css/campaign-shell.css css/style.css css/hunter.css css/board.css css/sponsors.css tests/campaign-design-system.test.mjs index.html start.html route.html interview.html updates.html clue-board.html report.html rules.html dashboard.html sponsors.html privacy.html waiver.html community-guidelines.html
git commit -m "style: unify campaign visual language"
```

---

### Task 5: Move the Clue Board onto the shared status and shell runtime

**Files:**
- Modify: `clue-board.html`
- Modify: `src/client/board.ts`
- Modify: `css/board.css`
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing Clue Board integration tests**

Update tests to require:

```js
const board = readRenderedCampaignPage("clue-board.html");
assert.match(board, /data-case-status/);
assert.match(board, /src="\/assets\/app\/status\.js"/);
assert.doesNotMatch(board, /case-signal|board-topbar|board-nav|board-brand/);
assert.doesNotMatch(read("src/client/board.ts"), /setCaseStatus|\/api\/v1\/status/);
```

Retain tests for board auth, notes, moderation labels, Turnstile, upload limits, and read-only found-state behavior.

- [ ] **Step 2: Run board tests and verify RED**

Run:

```powershell
node --test tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/board-client.test.ts
```

Expected: FAIL because `board.ts` still owns `case-signal` status presentation and fetches status separately.

- [ ] **Step 3: Use the shared status client**

In `clue-board.html`, load status before the board client:

```html
<script src="/js/site.js"></script>
<script type="module" src="/assets/app/status.js"></script>
<script type="module" src="/assets/app/board.js"></script>
```

In `src/client/board.ts`:

- delete `setCaseStatus()`;
- remove the `/api/v1/status` request from `initialiseBoard()`;
- keep the dashboard/session request and fail-closed signed-in behavior;
- do not use case status from the DOM to authorize writes—the API remains authoritative.

The session portion becomes:

```ts
try {
  const session = await requestJson("/api/v1/me/dashboard");
  signedIn = session.response.ok;
  noteForm.hidden = !signedIn;
  authPrompt.hidden = signedIn;
} catch {
  signedIn = false;
  noteForm.hidden = true;
  authPrompt.hidden = false;
}
```

- [ ] **Step 4: Remove obsolete board-shell CSS**

Delete `.case-signal`, `.board-topbar`, `.board-brand`, `.board-menu-toggle`, `.board-nav`, and `.board-footer` rules from `css/board.css`. Keep ledger, hero, filters, notes, dialogs, form, and moderation styles.

- [ ] **Step 5: Run board/client/build tests and verify GREEN**

Run:

```powershell
node --test tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/board-client.test.ts
npm run typecheck:client
npm run build
```

Expected: PASS; Clue Board uses one shared status fetch/presentation and keeps all community behavior.

- [ ] **Step 6: Commit Clue Board integration**

```powershell
git add clue-board.html src/client/board.ts css/board.css tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs tests/board-client.test.ts
git commit -m "refactor: share campaign shell with clue board"
```

---

### Task 6: Expand navigation, accessibility, and responsive geometry coverage

**Files:**
- Modify: `tests/navigation-geometry.test.mjs`
- Create: `tests/campaign-shell-accessibility.test.mjs`
- Modify: `js/site.js`
- Modify: `css/campaign-shell.css`

- [ ] **Step 1: Write failing route-matrix geometry tests**

Refactor the local test server to render HTML through `renderCampaignPage()` before serving it. Use canonical selectors for every route:

```js
const campaignFiles = [
  "index.html", "start.html", "route.html", "interview.html", "updates.html",
  "clue-board.html", "report.html", "rules.html", "dashboard.html", "sponsors.html",
  "privacy.html", "waiver.html", "community-guidelines.html",
];

for (const width of [360, 768, 1440]) {
  for (const file of campaignFiles) {
    // Assert one case strip and campaign header, sticky offsets synchronized,
    // no documentElement horizontal overflow, skip target exists, and menu state matches width.
  }
}
```

Add tests that:

- open/close the mobile menu with click and Escape;
- restore focus to the toggle on Escape;
- close after a nested element inside any navigation link is clicked;
- close automatically when the viewport crosses to desktop;
- grow and shrink the case strip while measured sticky/anchor offsets follow;
- verify Sponsors stays visible and current state is correct;
- emulate 200% zoom using a 720x500 viewport and assert no covered primary content.

- [ ] **Step 2: Write failing accessibility tests**

Create `tests/campaign-shell-accessibility.test.mjs` using Playwright and axe-core. For each rendered route at 390px and representative desktop routes at 1440px, require:

```js
assert.equal(await page.locator('nav[aria-label="Campaign"]').count(), 1);
assert.equal(await page.locator("#campaign-nav").count(), 1);
assert.equal(await page.locator(".campaign-menu-toggle").count(), 1);
assert.equal(await page.locator(".skip-link").count(), 1);
assert.equal(await page.locator("main").count(), 1);
assert.deepEqual(seriousOrCriticalAxeViolations, []);
```

Block external fonts, analytics, Turnstile, and Clerk requests; navigate with `domcontentloaded` rather than network idle.

- [ ] **Step 3: Run geometry/accessibility tests and verify RED**

Run:

```powershell
node --test tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs
```

Expected: FAIL until canonical selectors, desktop-breakpoint reset, and all route layouts satisfy the matrix.

- [ ] **Step 4: Apply minimal behavior and CSS corrections**

Modify only `js/site.js` and `css/campaign-shell.css` for shell behavior. Fix page-specific overflow in the owning page stylesheet rather than adding route hacks to the shell.

Required behavior:

```js
function closeNav(toggle, nav, restoreFocus) {
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) toggle.focus();
}
```

- link click: close without stealing focus;
- Escape: close and restore focus;
- desktop breakpoint: close without stealing focus;
- resize/status text changes: recompute all three header variables.

- [ ] **Step 5: Run geometry/accessibility tests and verify GREEN**

Run:

```powershell
node --test tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs
```

Expected: all route/viewport/zoom/accessibility checks PASS with no external write.

- [ ] **Step 6: Commit route-wide QA behavior**

```powershell
git add tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs js/site.js css/campaign-shell.css
git commit -m "test: verify unified campaign shell across routes"
```

---

### Task 7: Remove legacy shell drift and protect metadata/legal boundaries

**Files:**
- Modify: `tests/campaign-shell.test.mjs`
- Modify: `tests/campaign-design-system.test.mjs`
- Modify: `tests/public-content-safety.test.mjs`
- Modify: `tests/seo-aeo.test.mjs`
- Modify: `tests/privacy-policy.test.mjs`
- Modify: `tests/waiver-document.test.mjs`
- Modify: source HTML/CSS only if the tests expose residual legacy shell output

- [ ] **Step 1: Add failing final drift/privacy contracts**

For rendered `dist` pages, assert:

```js
for (const file of Object.keys(CAMPAIGN_PAGES)) {
  const html = readDist(file);
  assert.doesNotMatch(html, /CAMPAIGN_SHELL|CAMPAIGN_FOOTER/);
  assert.doesNotMatch(html, /class="[^"]*(?:topbar|hunter-header|board-topbar|case-signal|footer\b)/);
  assert.doesNotMatch(extractShell(html), /href="(?!\/|https?:|#)[^"]+"|href="[^"]+\.html/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, expectedCurrentCount(file));
}
```

Also snapshot or hash each route's metadata block before shell rendering and assert the renderer does not alter it. Run legal generation in check mode and verify the current waiver/privacy hashes remain exact.

- [ ] **Step 2: Run final drift/legal contracts and verify RED or existing GREEN**

Run:

```powershell
npm run build
node --test tests/campaign-shell.test.mjs tests/campaign-design-system.test.mjs tests/public-content-safety.test.mjs tests/seo-aeo.test.mjs tests/privacy-policy.test.mjs tests/waiver-document.test.mjs
npm run legal:verify
```

Expected: any residual legacy selector/link fails explicitly; legal artifacts remain unchanged.

- [ ] **Step 3: Remove only exposed legacy residue**

Delete obsolete public shell markup/rules discovered by the tests. Do not delete page-body selectors with similar names unless rendered pages and tests prove they are unused. Do not alter legal body content, metadata copy, structured data, auth hooks, Turnstile hooks, or private API behavior.

- [ ] **Step 4: Re-run drift/legal contracts and verify GREEN**

Run the same commands from Step 2.

Expected: PASS; the public build contains one shell system, metadata is preserved, and legal hashes are unchanged.

- [ ] **Step 5: Commit drift protection**

```powershell
git add tests/campaign-shell.test.mjs tests/campaign-design-system.test.mjs tests/public-content-safety.test.mjs tests/seo-aeo.test.mjs tests/privacy-policy.test.mjs tests/waiver-document.test.mjs index.html start.html route.html interview.html updates.html clue-board.html report.html rules.html dashboard.html sponsors.html privacy.html waiver.html community-guidelines.html css/style.css css/hunter.css css/board.css css/sponsors.css css/campaign-shell.css
git commit -m "test: prevent public shell drift"
```

Stage only files actually changed; never add `.superpowers/`.

---

### Task 8: Run full verification and record the handoff-ready state

**Files:**
- Modify: `DESIGN.md`
- Modify: `README.md`
- Modify: `STATUS.md`
- Create: `docs/qa/2026-07-14-unified-campaign-shell-verification.md`

- [ ] **Step 1: Update durable design and architecture docs**

Add to `DESIGN.md`:

- `scripts/campaign-shell.mjs` is the only public shell source;
- exact eight-item menu order;
- Ops remains intentionally separate;
- page-family classes preserve route character;
- `css/campaign-shell.css` owns public chrome and shared tokens;
- shell changes require route-matrix mobile/desktop/zoom QA.

Add to `README.md`:

```text
Public campaign pages declare a route marker and are rendered through scripts/campaign-shell.mjs during npm run build. Do not hand-edit generated navigation or footer markup. Update the route registry and its contract tests instead.
```

- [ ] **Step 2: Run the complete local quality gate**

Run:

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm run verify:waiver-qa
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected:

- legal artifacts match current versions/hashes;
- every static and TypeScript test passes;
- all typechecks and build pass;
- waiver QA passes without external writes;
- no high/critical audit finding;
- diff check is clean.

- [ ] **Step 3: Run the rendered visual/privacy gate**

Run:

```powershell
node --test tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs
```

Use the existing QA privacy scanner or `public-release-privacy-check` workflow against `dist/`. Confirm no private evidence, emails beyond approved public contact copy, provider references, OAuth settings, staff allowlists, source paths, or credentials appear in public output.

Capture screenshots outside the repository for representative pages at 390px and 1440px:

- home;
- route;
- interview;
- clue board;
- dashboard;
- sponsors;
- privacy/waiver.

Inspect header alignment, menu consistency, footer consistency, route personality, focus states, overflow, and 200% zoom. Do not publish the screenshots.

- [ ] **Step 4: Write reproducible QA evidence**

Create `docs/qa/2026-07-14-unified-campaign-shell-verification.md` recording:

- source commits;
- exact test counts;
- build size;
- route/viewport matrix;
- axe/console/overflow results;
- legal-hash preservation;
- public-output privacy result;
- known pre-existing moderate dependency findings, if unchanged;
- explicit statement that no Cloudflare, DNS, provider, email, validation deployment, or production mutation occurred.

- [ ] **Step 5: Update STATUS without claiming deployment**

Update `STATUS.md` with:

- Tasks 1-7 implementation commits;
- local verification evidence;
- one canonical shell source and menu decision;
- Task 7 Graph transactional-mail wiring remains locally complete;
- old pre-existing Wrangler dev processes were not used as release evidence;
- validation deployment and provider authorization remain Task 8 rollout work;
- production remains unchanged.

- [ ] **Step 6: Commit documentation**

```powershell
git add DESIGN.md README.md STATUS.md docs/qa/2026-07-14-unified-campaign-shell-verification.md
git commit -m "docs: record unified campaign shell verification"
```

- [ ] **Step 7: Confirm clean, non-deployed handoff**

Run:

```powershell
git status --short --branch
git log -10 --oneline
```

Expected: only the pre-existing untracked `.superpowers/` remains; branch is ahead of origin; no deployment has been attempted.

---

## Execution sequencing

Tasks 1-7 are local implementation and verification. Task 8 records the result but deliberately stops before Cloudflare configuration, Microsoft authorization, controlled email, or validation deployment.

After this plan passes, resume the existing Microsoft Graph rollout plan at its external validation steps:

1. migrate isolated validation D1 through `0010_graph_transactional_email.sql`;
2. configure Preview-only Graph/sender settings;
3. complete owner-controlled `tech@sebahub.com` device authorization;
4. deploy only the validation branch;
5. run one controlled provider test;
6. verify production remains unchanged.

Those actions retain their existing explicit approval, credential, privacy, and production-isolation gates.
