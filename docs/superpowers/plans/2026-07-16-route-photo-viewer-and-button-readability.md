# Route Photo Viewer and Button Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public action button readable, add an accessible waypoint-scoped route-photo lightbox, and withdraw the single disposable validation test publication without changing production.

**Architecture:** Remove the obsolete public ghost-button variant so equivalent actions share the existing gold/dark button contract. Add a focused `route-lightbox.ts` client that enhances the existing photo links into one native `<dialog>` while preserving the links as progressive fallbacks. Use the existing authenticated Ops unpublish workflow for the validation-only post, then rebuild, run the full regression matrix, and deploy only to the `codex-validation` Pages branch.

**Tech Stack:** Static HTML, documentary CSS tokens, TypeScript ES modules bundled by esbuild, native `<dialog>`, Node test runner, Playwright Chromium, Cloudflare Pages/D1, existing Clerk staff authentication.

---

## File Map

- Modify `index.html` — replace unreadable ghost actions with the canonical filled button.
- Modify `route.html` — remove the last ghost action, add the shared lightbox markup, stylesheet, and module entry.
- Modify `css/style.css` — retire `.btn--ghost` after all public references are removed.
- Create `css/route-lightbox.css` — own all viewer layout, responsive, focus, backdrop, touch-target, loading, and reduced-motion styles.
- Create `src/client/route-lightbox.ts` — own gallery discovery, dialog state, focus restoration, keyboard navigation, backdrop close, and bounded swipe behavior.
- Create `tests/route-lightbox.test.ts` — unit-test index cycling and swipe interpretation.
- Modify `tests/campaign-design-system.test.mjs` — prevent reintroduction of unreadable ghost buttons and verify the canonical button colour contrast.
- Modify `tests/hunter-ui-pages.test.mjs` — lock the lightbox markup/module/fallback contract and the unchanged 61-photo route.
- Modify `scripts/verify-unified-shell-qa.mjs` — exercise the lightbox at desktop, mobile, keyboard, zoom, and reduced-motion states.
- Modify `STATUS.md` — record the validation refinement, tests, deployment, and production hold.

### Task 1: Replace unreadable public action variants

**Files:**
- Modify: `tests/campaign-design-system.test.mjs`
- Modify: `index.html:77-81,172`
- Modify: `route.html:770-775`
- Modify: `css/style.css:97-118`

- [ ] **Step 1: Write the failing button-contract test**

Add a test that scans all public campaign HTML and the shared stylesheet:

```js
test("public case actions use the readable filled button contract", () => {
  const publicMarkup = Object.keys(CAMPAIGN_PAGES)
    .filter((name) => name !== "ops.html")
    .map((name) => read(name))
    .join("\n");
  const publicCss = read("css/style.css");

  assert.doesNotMatch(publicMarkup, /\bbtn--ghost\b/);
  assert.doesNotMatch(publicMarkup, /class="btn"[^>]*style=/);
  assert.doesNotMatch(publicCss, /\.btn--ghost\b/);

  const properties = {
    ...customProperties(read("css/campaign-shell.css")),
    ...customProperties(publicCss),
  };
  const ink = resolveHexColor(properties["--campaign-ink"], properties);
  const gold = resolveHexColor(properties["--campaign-gold-300"], properties);
  assert.ok(contrastRatio(ink, gold) >= 4.5);
});
```

Use the existing `customProperties`, `resolveHexColor`, and `contrastRatio` helpers in this test file.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs
```

Expected: FAIL because `btn--ghost` remains in `index.html`, `route.html`, and `css/style.css`.

- [ ] **Step 3: Apply the minimal readable-button change**

Change the four affected links to the canonical class:

```html
<a class="btn" href="updates.html">Read official updates</a>
<a class="btn" href="rules.html">Rules and safety</a>
<a class="btn" href="rules.html">Read current rules</a>
<a class="btn" href="report.html">Private report</a>
```

Delete both `.btn--ghost` CSS rules and remove the inline `style` attribute from the route action. Do not alter labels or destinations.

- [ ] **Step 4: Verify GREEN and inspect narrow wrapping**

Run:

```powershell
node --test tests/campaign-design-system.test.mjs tests/release2b-documentary.test.mjs
npm run build
```

Expected: all focused tests pass and the build exits 0.

- [ ] **Step 5: Commit the button refinement**

```powershell
git add -- index.html route.html css/style.css tests/campaign-design-system.test.mjs
git commit -m "fix: make public case actions readable"
```

### Task 2: Define the waypoint-scoped viewer state

**Files:**
- Create: `tests/route-lightbox.test.ts`
- Create: `src/client/route-lightbox.ts`

- [ ] **Step 1: Write failing unit tests for cycling and swiping**

Create the test with real exported helpers:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { cyclePhotoIndex, swipePhotoDelta } from "../src/client/route-lightbox";

test("photo navigation wraps only inside the supplied gallery length", () => {
  assert.equal(cyclePhotoIndex(0, -1, 3), 2);
  assert.equal(cyclePhotoIndex(2, 1, 3), 0);
  assert.equal(cyclePhotoIndex(1, 1, 3), 2);
  assert.equal(cyclePhotoIndex(0, 1, 1), 0);
});

test("swipes require a deliberate horizontal distance", () => {
  assert.equal(swipePhotoDelta(180, 80), 1);
  assert.equal(swipePhotoDelta(80, 180), -1);
  assert.equal(swipePhotoDelta(100, 130), 0);
  assert.equal(swipePhotoDelta(null, 100), 0);
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```powershell
npx tsx --test tests/route-lightbox.test.ts
```

Expected: FAIL because `src/client/route-lightbox.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure state helpers**

Create the module with these contracts before DOM enhancement:

```ts
export function cyclePhotoIndex(current: number, delta: -1 | 1, length: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(length) || length <= 1) return 0;
  return (current + delta + length) % length;
}

export function swipePhotoDelta(startX: number | null, endX: number, threshold = 48): -1 | 0 | 1 {
  if (startX === null || !Number.isFinite(endX)) return 0;
  const distance = endX - startX;
  if (Math.abs(distance) < threshold) return 0;
  return distance < 0 ? 1 : -1;
}
```

- [ ] **Step 4: Run the unit test and verify GREEN**

Run:

```powershell
npx tsx --test tests/route-lightbox.test.ts
npm run typecheck:client
npm run typecheck:tests
```

Expected: 2/2 tests pass and both typechecks exit 0.

- [ ] **Step 5: Commit the viewer state seam**

```powershell
git add -- src/client/route-lightbox.ts tests/route-lightbox.test.ts
git commit -m "test: define waypoint photo viewer state"
```

### Task 3: Build the accessible route-photo lightbox

**Files:**
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `route.html`
- Modify: `src/client/route-lightbox.ts`
- Create: `css/route-lightbox.css`

- [ ] **Step 1: Write the failing route lightbox contract**

Extend the existing route-page test with these assertions:

```js
assert.match(route, /<link rel="stylesheet" href="\/css\/route-lightbox\.css"/);
assert.match(route, /<dialog[^>]*data-route-lightbox[^>]*aria-labelledby="route-lightbox-title"[^>]*>/);
assert.match(route, /data-route-lightbox-image/);
assert.match(route, /data-route-lightbox-caption/);
assert.match(route, /data-route-lightbox-counter/);
assert.match(route, /data-route-lightbox-previous/);
assert.match(route, /data-route-lightbox-next/);
assert.match(route, /data-route-lightbox-close/);
assert.match(route, /data-route-lightbox-original/);
assert.match(route, /\/assets\/app\/route-lightbox\.js/);
assert.equal((route.match(/<a href="assets\/route\//g) ?? []).length, 61);
```

Also assert that each route-photo anchor keeps `target="_blank" rel="noopener"` as the no-JavaScript fallback.

- [ ] **Step 2: Run the route contract and verify RED**

Run:

```powershell
node --test tests/hunter-ui-pages.test.mjs
```

Expected: FAIL because the dialog, stylesheet, and module entry are absent.

- [ ] **Step 3: Add one shared dialog and the focused stylesheet**

Add this semantic structure immediately before `</main>` in `route.html`:

```html
<dialog class="route-lightbox" data-route-lightbox aria-labelledby="route-lightbox-title" aria-describedby="route-lightbox-description">
  <div class="route-lightbox__panel">
    <header class="route-lightbox__header">
      <div>
        <p class="route-lightbox__eyebrow" data-route-lightbox-counter>Photo 1 of 1</p>
        <h2 id="route-lightbox-title" data-route-lightbox-title>Waypoint photo</h2>
      </div>
      <button class="route-lightbox__close" type="button" data-route-lightbox-close aria-label="Close photo viewer">Close</button>
    </header>
    <div class="route-lightbox__stage">
      <button class="route-lightbox__nav route-lightbox__nav--previous" type="button" data-route-lightbox-previous aria-label="Previous photo">Previous</button>
      <img data-route-lightbox-image src="" alt="" />
      <button class="route-lightbox__nav route-lightbox__nav--next" type="button" data-route-lightbox-next aria-label="Next photo">Next</button>
    </div>
    <footer class="route-lightbox__footer">
      <p id="route-lightbox-description" data-route-lightbox-caption></p>
      <a data-route-lightbox-original href="" target="_blank" rel="noopener">Open original image</a>
    </footer>
  </div>
</dialog>
```

Load `/css/route-lightbox.css` after the route's inline CSS and load `/assets/app/route-lightbox.js` after `/assets/app/route.js`.

In the new stylesheet, implement:

```css
.route-lightbox {
  width: min(1040px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100dvh - 32px);
  padding: 0;
  color: var(--ink-900);
  background: var(--cream-100);
  border: 2px solid var(--gold-500);
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, .58);
}
.route-lightbox::backdrop { background: rgba(7, 31, 28, .82); }
.route-lightbox__panel { display: grid; max-height: calc(100dvh - 36px); grid-template-rows: auto minmax(0, 1fr) auto; }
.route-lightbox__header,
.route-lightbox__footer { padding: 14px 18px; }
.route-lightbox__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.route-lightbox__stage { display: grid; min-height: 0; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 0 14px; background: var(--green-950); }
.route-lightbox__stage img { width: 100%; height: 100%; max-height: calc(100dvh - 230px); object-fit: contain; }
.route-lightbox__close,
.route-lightbox__nav { min-width: 44px; min-height: 44px; color: var(--ink-900); background: var(--gold-300); border: 2px solid var(--ink-900); border-radius: 10px; font: 700 .9rem var(--font-body); }
.route-lightbox__footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
body:has(.route-lightbox[open]) { overflow: hidden; }
@media (max-width: 640px), (max-height: 620px) {
  .route-lightbox { width: 100vw; max-height: 100dvh; margin: 0; border-radius: 0; }
  .route-lightbox__panel { min-height: 100dvh; max-height: 100dvh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  .route-lightbox__stage { grid-template-columns: 1fr; padding: 0; }
  .route-lightbox__nav { position: absolute; top: 50%; z-index: 2; }
  .route-lightbox__nav--previous { left: 8px; }
  .route-lightbox__nav--next { right: 8px; }
  .route-lightbox__footer { max-height: 28dvh; overflow: auto; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .route-lightbox, .route-lightbox * { scroll-behavior: auto; transition: none !important; }
}
```

Refine spacing and positioning during visual QA without changing the state or accessibility contract.

- [ ] **Step 4: Implement progressive enhancement in `route-lightbox.ts`**

Keep the pure exports from Task 2 and add one `initializeRouteLightbox()` that:

1. returns without mutation if the dialog or required controls are missing;
2. discovers each `.stop[data-waypoint-id]` independently;
3. collects only `.stop-gallery .photo > a` entries with an image, href, and caption;
4. adds click and Space-key handlers to each valid link while leaving its href/target/rel intact;
5. opens the dialog with `showModal()`, renders the current waypoint name and photo, focuses Close, and remembers the activating link;
6. updates Previous/Next with `cyclePhotoIndex()` and hides both for single-photo galleries;
7. handles Left/Right Arrow, Escape, backdrop activation, and pointer swipe using `swipePhotoDelta()`;
8. restores focus to the activating link on `close` and clears touch state;
9. leaves the original-image link usable if the displayed image fails.

Use a single state object:

```ts
interface ViewerState {
  gallery: RoutePhoto[];
  waypointName: string;
  index: number;
  trigger: HTMLAnchorElement | null;
  touchStartX: number | null;
}
```

Initialize on `DOMContentLoaded` using the same once-only pattern as `route.ts`.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
node --test tests/hunter-ui-pages.test.mjs
npx tsx --test tests/route-lightbox.test.ts
npm run typecheck
npm run build
```

Expected: all focused contracts pass, typechecks exit 0, and the route-lightbox bundle appears at `dist/assets/app/route-lightbox.js`.

- [ ] **Step 6: Commit the working viewer**

```powershell
git add -- route.html css/route-lightbox.css src/client/route-lightbox.ts tests/route-lightbox.test.ts tests/hunter-ui-pages.test.mjs
git commit -m "feat: add waypoint photo viewer"
```

### Task 4: Add browser-level accessibility and mobile regression coverage

**Files:**
- Modify: `scripts/verify-unified-shell-qa.mjs`

- [ ] **Step 1: Write the failing Playwright route-viewer audit**

Add a route-specific audit that opens `/route`, clicks the first photo in Waypoint 1, and asserts:

```js
await assertRouteLightbox(page, {
  waypoint: "The Creek Property — The Starting Point",
  counter: "Photo 1 of 3",
  originalSuffix: "/assets/route/stop-01/IMG_5034.jpg",
});
```

The helper must verify one visible dialog, a contained nonzero image, 44-pixel controls, no viewport overflow, and zero console/page errors. It must then press ArrowRight, assert `Photo 2 of 3`, press Escape, and confirm focus returned to the first photo link.

At the 390-by-844 viewport, reopen the dialog, perform one left swipe across the image using Playwright pointer coordinates, assert `Photo 2 of 3`, and capture `mobile-route-lightbox.png`. At reduced motion, assert every lightbox transition duration resolves to zero or `0.01ms`.

- [ ] **Step 2: Run the QA harness and verify RED**

Run:

```powershell
npm run build
npm run verify:unified-shell-qa
```

Expected: FAIL until the new audit helper can operate the completed viewer in every required state.

- [ ] **Step 3: Make only the minimum viewer adjustments required by real-browser evidence**

Adjust `css/route-lightbox.css` or `src/client/route-lightbox.ts` only where the failing browser evidence identifies a concrete issue. Do not relax the assertions, remove keyboard coverage, or expand navigation across waypoints.

- [ ] **Step 4: Verify GREEN and visually inspect artifacts**

Run:

```powershell
npm run build
npm run verify:unified-shell-qa
```

Expected: `ok: true`, zero external writes, zero console errors, and route-lightbox screenshots at desktop and mobile sizes. Inspect both screenshots before committing.

- [ ] **Step 5: Commit the browser regression gate**

```powershell
git add -- scripts/verify-unified-shell-qa.mjs css/route-lightbox.css src/client/route-lightbox.ts
git commit -m "test: cover route viewer accessibility"
```

### Task 5: Withdraw the validation test post and deploy the refined candidate

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Identify the validation record without exposing private data**

Run this read-only command against the validation-suffixed database:

```powershell
npx wrangler d1 execute tim-lost-hunter-platform-validation --remote --json --command "SELECT environment FROM environment_metadata WHERE id = 1; SELECT id, source_report_id, title, body, status FROM official_updates WHERE lower(trim(title)) = 'test' AND lower(trim(body)) = 'test';"
```

Expected: environment is exactly `validation` and exactly one published test update is returned. Record only its opaque update ID and opaque source-report ID in transient working notes, not project documentation.

- [ ] **Step 2: Withdraw it through the existing authenticated Ops workflow**

Open `https://codex-validation.seba-treasure-hunt.pages.dev/ops#reports`, open the matching private report, choose **Unpublish**, and confirm the existing Ops action. Do not delete the private report or its audit history. If no authorized staff session is available, stop and ask Murphy to sign in; do not substitute a production or unaudited database mutation.

- [ ] **Step 3: Verify the validation cleanup**

Run:

```powershell
$updates = Invoke-RestMethod 'https://codex-validation.seba-treasure-hunt.pages.dev/api/v1/updates?limit=20'
$updates.data | Where-Object { $_.title -eq 'test' -and $_.body -eq 'test' }
```

Expected: no output. Confirm the homepage shows either the next legitimate approved update or the empty-state message. Confirm the production homepage/API were not mutated.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```powershell
npm run legal:verify
npm run typecheck
npm test
npm run build
npm run verify:unified-shell-qa
npm run verify:sponsor-qa
npm run verify:waiver-qa
git diff --check
git status --short
```

Expected: every command exits 0, all automated tests pass, every QA harness reports `ok: true`, privacy findings remain zero, external writes remain zero in mocked QA, and the worktree is clean after the documentation commit.

- [ ] **Step 5: Update the release status and commit**

Add a dated July 16 entry to `STATUS.md` recording:

- canonical filled buttons replaced all public ghost buttons;
- the waypoint-scoped dialog viewer and mobile/keyboard coverage;
- the validation-only test publication was withdrawn through Ops;
- production remains unchanged pending Murphy's approval.

Then run:

```powershell
git add -- STATUS.md
git commit -m "docs: record validation interface refinement"
```

- [ ] **Step 6: Deploy only to validation and smoke-test**

Run:

```powershell
$hash = git rev-parse HEAD
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation --commit-hash $hash --commit-message "Validation: route viewer and readability refinement"
```

Smoke-test the immutable deployment URL and `https://codex-validation.seba-treasure-hunt.pages.dev/?v=$hash`. Verify the four homepage buttons, empty/legitimate latest update, route viewer, Case Notes, Support the Search, Sunny Guarantee footer, and signed-out route gating. Leave the validation homepage open for Murphy and verify `https://www.timlostsomething.com/` remains unchanged.
