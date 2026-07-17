# Public Case Story Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove story-breaking campaign/sponsorship language from the public site, standardize the 13-stop case vocabulary, and withdraw the sponsor page from public delivery without altering private sponsor data or authoritative legal text.

**Architecture:** Change the shared shell and public build boundaries first so every desktop/mobile page inherits the same navigation and sponsor withdrawal. Apply page-specific case copy and legacy publisher-name mapping at the public projection boundary, while preserving stored values, private Ops workflows and internal `campaign-*` implementation contracts. Lock the release with rendered-output tests rather than unsafe global source replacements.

**Tech Stack:** Static HTML/CSS, TypeScript clients, Hono/Cloudflare Pages Functions, esbuild, Node test runner, Miniflare.

---

## File Structure

- `scripts/campaign-shell.mjs`: shared public navigation, brand subline, footer destinations and registered public pages.
- `scripts/build.mjs`: emitted public HTML and browser entry-point allowlist; sponsorship source remains in-repo but is not delivered.
- `src/server/app.ts`: clean-route/public static-route allowlist; `/sponsors` is no longer a public application route.
- `src/server/d1-store.ts`: maps legacy generic publisher names at the public Update projection without rewriting stored rows.
- `index.html`, `route.html`, `interview.html`, `updates.html`, `clue-board.html`, `report.html`, `dashboard.html`, `sponsors.html`: approved public case copy and retained private-source lead.
- `sitemap.xml`: canonical public URLs only.
- `scripts/verify-unified-shell-qa.mjs`: current public-page QA set without sponsor screenshots/routes.
- `scripts/verify-sponsor-qa.mjs`: validates public sponsor withdrawal and retains unauthenticated private-Ops protection checks.
- `tests/public-case-story-cleanup.test.mjs`: rendered-output terminology, fictional-ID and sponsor-withdrawal contract.
- Existing shell, homepage, sponsor, documentary, hunter, Update, build-isolation and preservation tests: replace superseded public expectations while retaining private sponsor API/Ops coverage.

## Task 1: Withdraw sponsorship and update the shared 13-stop shell

**Files:**
- Modify: `scripts/campaign-shell.mjs`
- Modify: `scripts/build.mjs`
- Modify: `src/server/app.ts`
- Modify: `index.html`
- Modify: `sitemap.xml`
- Modify: `scripts/verify-unified-shell-qa.mjs`
- Modify: `scripts/verify-sponsor-qa.mjs`
- Modify: `tests/campaign-shell.test.mjs`
- Modify: `tests/homepage-actions.test.mjs`
- Modify: `tests/sponsor-page.test.mjs`
- Modify: `tests/sponsor-qa-contract.test.mjs`
- Modify: `tests/build-isolation.test.mjs`
- Modify: `tests/unified-shell-qa-contract.test.mjs`
- Test: `tests/public-case-story-cleanup.test.mjs`

- [ ] **Step 1: Write failing public-withdrawal and shell tests**

Add rendered assertions equivalent to:

```js
const publicPages = Object.keys(CAMPAIGN_PAGES);
assert.equal(publicPages.includes("sponsors.html"), false);
assert.deepEqual(CAMPAIGN_MENU.find((item) => item.route === "route"), {
  route: "route", label: "13 Stops", href: "/route",
});
assert.equal(CAMPAIGN_MENU.some((item) => item.route === "sponsors"), false);

const renderedHome = renderCampaignPage(read("index.html"), "index.html");
assert.doesNotMatch(renderedHome, /Support the Search|href=["']\/sponsors/i);
assert.match(renderedHome, /Tim Lost Something\?<span>Tim lost his ID<\/span>/);
```

Build to a temporary directory and assert `sponsors.html`,
`assets/app/sponsors.js` and `css/sponsors.css` are absent. Request both
`/sponsors` and `/sponsors.html` through the Hono test app and assert 404 while
`/api/v1/ops/sponsors` remains Staff-protected.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/campaign-shell.test.mjs tests/homepage-actions.test.mjs tests/sponsor-page.test.mjs tests/build-isolation.test.mjs tests/public-case-story-cleanup.test.mjs
npx tsx --test tests/api-public.test.ts tests/sponsor-api.test.ts
```

Expected: failures show the current Lucky label, sponsor navigation/home section,
public sponsor build artifacts and `/sponsors` route.

- [ ] **Step 3: Change the shared shell and public delivery boundary**

Apply these exact shared-shell values:

```js
Object.freeze({ route: "route", label: "13 Stops", href: "/route" })
// no sponsors entry in CAMPAIGN_MENU or footerLinks
// no "sponsors.html" entry in CAMPAIGN_PAGES
```

Render the brand as:

```html
<a class="campaign-brand" href="/">Tim Lost Something?<span>Tim lost his ID</span></a>
```

Keep the internal `campaign-*` class/data names. Remove the homepage sponsor
section. Remove `sponsors.html` from `staticFiles`, remove the sponsor clean
route from `src/server/app.ts`, and filter `src/client/sponsors.ts` from browser
entry points. After copying static directories, remove `css/sponsors.css` from
the build output. Remove `/sponsors` from `sitemap.xml`.

- [ ] **Step 4: Update QA scripts without deleting private sponsor coverage**

Remove sponsor-page screenshots and public navigation expectations from unified
shell QA. Change sponsor QA public assertions to:

```js
assert.equal((await fetch(routeUrl("/sponsors"), { redirect: "manual" })).status, 404);
assert.equal((await fetch(routeUrl("/sponsors.html"), { redirect: "manual" })).status, 404);
```

Retain the unauthenticated `/api/v1/ops/sponsors` 401/privacy checks. Do not
delete sponsor API or private Ops tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/campaign-shell.test.mjs tests/homepage-actions.test.mjs tests/sponsor-page.test.mjs tests/sponsor-qa-contract.test.mjs tests/build-isolation.test.mjs tests/unified-shell-qa-contract.test.mjs tests/public-case-story-cleanup.test.mjs
npx tsx --test tests/api-public.test.ts tests/sponsor-api.test.ts
npm run typecheck
```

Expected: public sponsor routes/artifacts are absent, shared navigation says
13 Stops, and private sponsor API authorization remains intact.

- [ ] **Step 6: Commit the withdrawal slice**

```powershell
git add scripts/campaign-shell.mjs scripts/build.mjs scripts/verify-unified-shell-qa.mjs scripts/verify-sponsor-qa.mjs src/server/app.ts index.html sitemap.xml tests/campaign-shell.test.mjs tests/homepage-actions.test.mjs tests/sponsor-page.test.mjs tests/sponsor-qa-contract.test.mjs tests/build-isolation.test.mjs tests/unified-shell-qa-contract.test.mjs tests/public-case-story-cleanup.test.mjs tests/api-public.test.ts
git commit -m "feat: withdraw public sponsorship surfaces"
```

## Task 2: Apply case vocabulary, fictional-ID disclosure and public attribution

**Files:**
- Modify: `index.html`
- Modify: `route.html`
- Modify: `interview.html`
- Modify: `updates.html`
- Modify: `clue-board.html`
- Modify: `report.html`
- Modify: `dashboard.html`
- Modify: `sponsors.html`
- Modify: `src/server/d1-store.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `tests/release2b-documentary.test.mjs`
- Modify: `tests/campaign-refresh.test.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/updates-client.test.ts`
- Modify: `tests/api-public.test.ts`
- Modify: `tests/fixtures/campaign-page-preservation.json`
- Test: `tests/public-case-story-cleanup.test.mjs`

- [ ] **Step 1: Write failing vocabulary and disclosure tests**

Build/render all non-legal public pages and assert:

```js
assert.equal(matches(renderedPublic, /\bThis year\b/gi), 0);
assert.equal(matches(renderedPublic, /\bLucky 13\b/gi), 0);
assert.equal(matches(renderedPublic, /Campaign reference|fictional reference image/gi), 0);
assert.equal(matches(renderedHome, /A visual representation of what Timâ€™s I\.D\. could look like\./g), 1);
assert.equal(matches(renderedHome, /This image is fictional, not Timâ€™s real ID/gi), 0);
```

Exclude `privacy.html` and `waiver.html` from generic campaign-word scanning.
Assert public Update output maps stored `Campaign Ops` to
`A representative from SebaHub`, while the stored database fixture remains
`Campaign Ops`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/public-case-story-cleanup.test.mjs tests/release2b-documentary.test.mjs tests/campaign-refresh.test.mjs tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/updates-client.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts
```

Expected: current public pages contain the removed wording and the Update
projection still exposes `Campaign Ops`.

- [ ] **Step 3: Apply page-specific approved copy**

Use **13 Stops**, **13-stop route**, **All 13 stops**, and **Choose one of the
13 stops** as the local grammar requires. Replace public operator text with
**a representative from SebaHub**. In `sponsors.html`, keep the dormant-source
lead as exactly:

```html
<p class="sponsor-hero__lead">Help a local story gather momentum.</p>
```

The page remains excluded from public delivery.

Replace the homepage fictional-ID block with one figure whose visible caption
is exactly:

```html
<figcaption>A visual representation of what Timâ€™s I.D. could look like.</figcaption>
```

Use a matching accurate image alt without “campaign.” Remove the separate
eyebrow/title/duplicate disclaimer.

- [ ] **Step 4: Map legacy public publisher names without rewriting storage**

Add a small public projection helper in `src/server/d1-store.ts`:

```ts
const publicPublisherName = (value: unknown): string => {
  const name = String(value ?? "").trim();
  return /^(campaign ops|campaign operator)$/i.test(name)
    ? "A representative from SebaHub"
    : name;
};
```

Use it only when constructing public Update items. Keep inserts, audit rows and
private Ops values unchanged. Change the dashboard presentation fallback from
`Campaign operator` to `A representative from SebaHub`.

- [ ] **Step 5: Refresh only reviewed preservation hashes**

Run the preservation helper/test, inspect the exact changed public bodies and
update only their expected hashes. Do not refresh legal document hashes or use
a blanket fixture rewrite.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/public-case-story-cleanup.test.mjs tests/release2b-documentary.test.mjs tests/campaign-refresh.test.mjs tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs tests/campaign-shell-preservation.test.mjs
npx tsx --test tests/updates-client.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts
npm run legal:verify
npm run typecheck
git diff --check
```

Expected: all current public story copy matches the case direction, legal bodies
remain authoritative and stored legacy publisher values are unchanged.

- [ ] **Step 7: Commit the copy slice**

```powershell
git add index.html route.html interview.html updates.html clue-board.html report.html dashboard.html sponsors.html src/server/d1-store.ts src/client/dashboard.ts tests/public-case-story-cleanup.test.mjs tests/release2b-documentary.test.mjs tests/campaign-refresh.test.mjs tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs tests/updates-client.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts tests/fixtures/campaign-page-preservation.json
git commit -m "feat: present the search as a local case"
```

## Task 3: Verify the complete public-story candidate

**Files:**
- Modify: `STATUS.md`
- Create: `docs/operations/2026-07-17-reply-moderation-validation.md`

- [ ] **Step 1: Build and scan rendered output**

Run:

```powershell
npm run legal:verify
npm run typecheck
npm test
npm run build
npm run verify:unified-shell-qa
node scripts/qa-output-privacy.mjs
git diff --check
```

Expected: every command exits 0. `dist` contains no sponsor page/bundle/style,
no broken sponsor link, and no unapproved public terminology outside legal
documents/internal identifiers.

- [ ] **Step 2: Run validation-only smoke checks**

After the aggregate candidate is deployed to the `codex-validation` branch,
verify desktop/mobile navigation, homepage evidence, 13 Stops labels, Updates
publisher attribution, sponsor-route 404 behavior, private Ops sponsor access,
hunter auth, reporting, moderation and public privacy output. Production must
remain unchanged.

- [ ] **Step 3: Record source/deployment evidence and commit documentation**

Record the source commit, immutable validation URL, test totals, production
before/after read-only baselines, sponsor withdrawal, known limitations and an
explicit statement that production was not promoted.

```powershell
git add STATUS.md docs/operations/2026-07-17-reply-moderation-validation.md
git commit -m "docs: record public case validation release"
```
