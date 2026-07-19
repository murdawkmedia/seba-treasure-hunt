# Private-Report Public Destination Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Keep private, Publish to Case Notes, and Prepare an Official Update real, accessible choices that reveal only their matching workflow, then promote the exact verified artifact to the live website.

**Architecture:** Keep destination selection as local browser state and retain the existing Case Note and Official Update APIs as the only durable/public boundaries. Add a small pure destination model to the existing Ops client, use native radio-card controls and conditional panels, and extend the isolated browser fixture to prove selection is write-free and responsive before validation and production promotion.

**Tech Stack:** Static HTML, TypeScript, CSS, native form semantics, Node test runner, Playwright Chromium, esbuild, Cloudflare Pages, D1 and Wrangler.

---

## File structure

- Modify `ops.html` — replace static explanatory cards with a native radio
  group and mark the private, Case Notes and Official Update panes.
- Modify `css/ops.css` — accessible radio-card states, touch targets, hidden-pane
  behavior and narrow-screen stacking.
- Modify `src/client/ops.ts` — pure destination model, default restoration,
  conditional rendering, media eligibility and confirmation invalidation.
- Modify `tests/ops-board-ui-contract.test.mjs` — semantic markup and responsive
  source contracts.
- Modify `tests/ops-board-ui-behavior.test.ts` — destination defaults, view model,
  media rules and confirmation behavior.
- Modify `scripts/verify-unified-shell-qa.mjs` — isolated desktop/mobile browser
  exercise proving selection is write-free and only the chosen pane appears.
- Modify `docs/operations/2026-07-18-private-report-workflow-validation.md` —
  validation and production evidence for this focused follow-on.
- Modify `docs/operations/2026-07-16-production-release.md` — live commit,
  deployment, verification and rollback point.
- Modify `STATUS.md` — dated implementation and release state.

No database migration, API route, Clerk configuration, legal document, R2
object or media-worker change is planned.

### Task 1: Replace misleading cards with semantic destination controls

**Files:**
- Modify: `tests/ops-board-ui-contract.test.mjs:53-178`
- Modify: `ops.html:365-432`
- Modify: `css/ops.css:379-384,428-466,529-541`

- [ ] **Step 1: Write the failing semantic contract**

Replace the old `Prepare public outcome` expectation in the case-room contract
with these exact assertions:

```js
assert.match(html, /<fieldset[^>]+data-report-public-destinations/);
assert.match(html, /<legend>Choose what happens next<\/legend>/);
for (const value of ["private", "case_note", "official_update"]) {
  assert.match(
    html,
    new RegExp(`<input[^>]+type="radio"[^>]+name="reportPublicDestination"[^>]+value="${value}"`),
  );
}
assert.match(html, /data-report-private-outcome[^>]+hidden/);
assert.match(html, /data-report-publication-form[^>]+hidden/);
assert.match(html, /data-report-official-copy[^>]+hidden/);
assert.equal((html.match(/data-report-destination-state=/g) ?? []).length, 3);
assert.match(html, /data-report-destination-panel="case_note"[^>]+hidden/);
assert.match(html, /data-report-destination-panel="official_update"[^>]+hidden/);
assert.doesNotMatch(html, /data-report-prepare-public/);
assert.doesNotMatch(html, /ops-report-destinations[\s\S]*?<article>/);
```

Add the CSS contract beside the existing report-drawer responsive assertions:

```js
assert.match(css, /\.ops-report-destination\s*\{[^}]*min-height:\s*44px/s);
assert.match(css, /\.ops-report-destination:has\(input:checked\)/);
assert.match(css, /@media[^}]+max-width:\s*760px[\s\S]*?\.ops-report-destinations\s*\{[^}]*grid-template-columns:\s*1fr/s);
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
node --test --test-name-pattern "case-room console|report review drawer" tests/ops-board-ui-contract.test.mjs
```

Expected: FAIL because the current controls are static `article` elements and
the generic Prepare button still exists.

- [ ] **Step 3: Replace the static destination block**

Replace the current `.ops-report-destinations` `div` and generic Prepare button
with:

```html
<fieldset class="ops-report-destinations" data-report-public-destinations>
  <legend>Choose what happens next</legend>
  <label class="ops-report-destination">
    <input type="radio" name="reportPublicDestination" value="private" checked />
    <span><strong>Keep private</strong><span>No part of this report is published. Continue the audited review only.</span><small data-report-destination-state="private">No public action</small></span>
  </label>
  <label class="ops-report-destination">
    <input type="radio" name="reportPublicDestination" value="case_note" />
    <span><strong>Publish to Case Notes</strong><span>Share a reviewed community observation. It is not an Official Update or official clue.</span><small data-report-destination-state="case_note">No Case Note</small></span>
  </label>
  <label class="ops-report-destination">
    <input type="radio" name="reportPublicDestination" value="official_update" />
    <span><strong>Prepare an Official Update</strong><span>Create an official public source. You may save a private draft now; public release requires Verified.</span><small data-report-destination-state="official_update">No Update draft</small></span>
  </label>
</fieldset>
<p class="ops-report-private-outcome" data-report-private-outcome role="status" hidden>
  This report remains private. No public action will be taken.
</p>
```

Keep `data-report-public-guidance` and `data-report-go-to-review`. Remove the
`data-report-prepare-public` button entirely. Add `hidden` to the publication
form's initial markup:

```html
<form class="ops-form ops-form--compact" data-report-publication-form novalidate hidden>
```

Wrap the existing public-headline label and input in
`<div data-report-official-copy hidden>`. Case Notes are body-only in the
existing public API; this keeps their exact preview truthful without a schema
or endpoint change.

Add `data-report-destination-panel="official_update" hidden` to the existing
`data-report-update-upload` fieldset and Official destination section. Add
`data-report-destination-panel="case_note" hidden` to the existing Community
destination section.

- [ ] **Step 4: Add the radio-card styles**

Replace the existing `article` card rules with:

```css
.ops-report-destinations {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0;
  padding: 0;
  border: 0;
}
.ops-report-destinations legend {
  width: 100%;
  margin-bottom: 8px;
  color: var(--ops-ink);
  font-family: var(--ops-font-ledger);
}
.ops-report-destination {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-width: 0;
  min-height: 44px;
  padding: 12px;
  border: 1px solid var(--ops-line);
  border-radius: 5px;
  background: rgba(7, 31, 28, .4);
  cursor: pointer;
}
.ops-report-destination input {
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--ops-gold);
}
.ops-report-destination strong,
.ops-report-destination span { display: block; }
.ops-report-destination > span > span {
  margin-top: 4px;
  color: var(--ops-muted);
  font-size: .82rem;
  line-height: 1.35;
}
.ops-report-destination__state,
.ops-report-destination [data-report-destination-state] {
  margin-top: 8px;
  color: var(--ops-gold);
  font-family: var(--ops-font-ledger);
  font-size: .68rem;
}
.ops-report-destination:has(input:checked) {
  border-color: var(--ops-gold);
  box-shadow: inset 0 0 0 2px rgba(247, 184, 37, .35);
  background: rgba(247, 184, 37, .1);
}
.ops-report-destination:focus-within {
  outline: 3px solid var(--ops-gold);
  outline-offset: 2px;
}
.ops-report-private-outcome {
  padding: 12px;
  border-left: 3px solid var(--ops-gold);
  background: rgba(4, 22, 19, .42);
}
```

Retain the existing mobile `.ops-report-destinations { grid-template-columns:
1fr; }` rule.

- [ ] **Step 5: Run the focused contract and verify GREEN**

Run:

```powershell
node --test --test-name-pattern "case-room console|report review drawer" tests/ops-board-ui-contract.test.mjs
```

Expected: the focused contract passes.

- [ ] **Step 6: Commit the semantic controls**

```powershell
git add ops.html css/ops.css tests/ops-board-ui-contract.test.mjs
git commit -m "fix: make report destinations selectable"
```

### Task 2: Add a pure destination and media-selection model

**Files:**
- Modify: `tests/ops-board-ui-behavior.test.ts:1-60,528-603,919-925`
- Modify: `src/client/ops.ts:380-399,1794-1810`

- [ ] **Step 1: Write failing destination-model tests**

Import `defaultReportPublicDestination`, `reportPublicDestinationView`, and
`reportMediaSelectableForDestination` from `src/client/ops`, then add:

```ts
test("report public destinations default safely and restore durable work", () => {
  const base = normalizeOpsReportDetail({ data: {
    id: "destination-report",
    type: "find",
    hunterSubject: "hunter-adult",
    name: "Private Reporter",
    email: "private@example.test",
    phone: null,
    publicAttribution: "Hunter D48E",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: false, updateId: null, status: null, scheduledFor: null, title: null, body: null, mediaIds: [], uploads: [] },
    caseNote: { published: false, noteId: null, status: null },
    waypointId: "8",
    waypointRouteOrder: 9,
    waypointName: "Vista Lands",
    locationDescription: "Private location",
    latitude: null,
    longitude: null,
    details: "Private details",
    status: "verified",
    assignedTo: null,
    createdAt: "2026-07-18T18:54:31.625Z",
    updatedAt: "2026-07-18T18:54:31.625Z",
    media: [],
    history: [],
  }});
  assert.ok(base);
  assert.equal(defaultReportPublicDestination(base), "private");
  assert.equal(defaultReportPublicDestination({ ...base, caseNote: { published: true, noteId: "note-1", status: "published" } }), "case_note");
  assert.equal(defaultReportPublicDestination({ ...base, publication: { ...base.publication, updateId: "update-1", status: "draft" } }), "official_update");
  assert.equal(defaultReportPublicDestination({
    ...base,
    publication: { ...base.publication, updateId: "update-1", status: "published", published: true },
    caseNote: { published: true, noteId: "note-1", status: "published" },
  }), "official_update");
  assert.equal(defaultReportPublicDestination({ ...base, publication: { ...base.publication, updateId: "update-1", status: "withdrawn" } }), "private");
});

test("report destination view reveals one workflow and scopes selectable media", () => {
  assert.deepEqual(reportPublicDestinationView("private"), {
    formVisible: false,
    caseNoteVisible: false,
    officialUpdateVisible: false,
    evidenceLabel: "Private evidence; no image will be published",
  });
  assert.equal(reportPublicDestinationView("case_note").caseNoteVisible, true);
  assert.equal(reportPublicDestinationView("official_update").officialUpdateVisible, true);
  assert.equal(reportMediaSelectableForDestination("private", "report"), false);
  assert.equal(reportMediaSelectableForDestination("case_note", "report"), true);
  assert.equal(reportMediaSelectableForDestination("case_note", "update"), false);
  assert.equal(reportMediaSelectableForDestination("official_update", "report"), true);
  assert.equal(reportMediaSelectableForDestination("official_update", "update"), true);
});

test("changing a public destination invalidates exact-preview confirmation", () => {
  assert.equal(reportPublicationConfirmationAfterInput(true, "reportPublicDestination"), false);
});

test("Case Note preview omits the Official Update-only headline", () => {
  const detail = normalizeOpsReportDetail({ data: {
    id: "case-note-preview-report",
    type: "tip",
    hunterSubject: "hunter-adult",
    name: "Private Reporter",
    email: "private@example.test",
    phone: null,
    publicAttribution: "Hunter D48E",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: { published: false, updateId: null, status: null, scheduledFor: null, title: null, body: null, mediaIds: [], uploads: [] },
    caseNote: { published: false, noteId: null, status: null },
    waypointId: "8",
    waypointRouteOrder: 9,
    waypointName: "Vista Lands",
    locationDescription: "Private location",
    latitude: null,
    longitude: null,
    details: "Private details",
    status: "verified",
    assignedTo: null,
    createdAt: "2026-07-18T18:54:31.625Z",
    updatedAt: "2026-07-18T18:54:31.625Z",
    media: [],
    history: [],
  }});
  assert.ok(detail);
  const preview = renderReportPublicationPreview(
    detail,
    { title: "Official-only headline", body: "Reviewed observation" },
    "case_note"
  );
  assert.doesNotMatch(preview, /Official-only headline/);
  assert.match(preview, /Reviewed observation/);
});
```

- [ ] **Step 2: Run the focused behavior tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "report public destination|report destination view|changing a public destination|Case Note preview" tests/ops-board-ui-behavior.test.ts
```

Expected: FAIL because the destination model does not exist and destination
changes do not yet invalidate confirmation.

- [ ] **Step 3: Implement the pure model**

Add beside `reportDestinationControls`:

```ts
export type ReportPublicDestination = "private" | "case_note" | "official_update";

export function isReportPublicDestination(value: unknown): value is ReportPublicDestination {
  return value === "private" || value === "case_note" || value === "official_update";
}

export function defaultReportPublicDestination(
  detail: Pick<OpsReportDetail, "publication" | "caseNote">
): ReportPublicDestination {
  if (detail.publication.status !== null && detail.publication.status !== "withdrawn") {
    return "official_update";
  }
  if (detail.caseNote.status !== null) return "case_note";
  return "private";
}

export function reportPublicDestinationView(destination: ReportPublicDestination): {
  formVisible: boolean;
  caseNoteVisible: boolean;
  officialUpdateVisible: boolean;
  evidenceLabel: string;
} {
  return {
    formVisible: destination !== "private",
    caseNoteVisible: destination === "case_note",
    officialUpdateVisible: destination === "official_update",
    evidenceLabel: destination === "case_note"
      ? "Choose ready submitted images for Case Notes"
      : destination === "official_update"
        ? "Choose ready submitted or direct images for the Official Update"
        : "Private evidence; no image will be published",
  };
}

export function reportMediaSelectableForDestination(
  destination: ReportPublicDestination,
  source: "report" | "update"
): boolean {
  if (destination === "private") return false;
  return source === "report" || destination === "official_update";
}
```

Extend the confirmation invalidator:

```ts
return ["title", "body", "publishMedia", "scheduledFor", "reportPublicDestination"].includes(controlName)
  ? false
  : confirmed;
```

Extend `renderReportPublicationPreview` with a third destination parameter that
defaults to `official_update`. For `case_note`, render the body, attribution,
waypoint, GPS and selected submitted evidence without the Official Update-only
headline. Keep the current headline rendering for `official_update`.

- [ ] **Step 4: Run the focused behavior tests and verify GREEN**

Run:

```powershell
npx tsx --test --test-name-pattern "report public destination|report destination view|changing a public destination|Case Note preview" tests/ops-board-ui-behavior.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the pure model**

```powershell
git add src/client/ops.ts tests/ops-board-ui-behavior.test.ts
git commit -m "feat: model report public destinations"
```

### Task 3: Wire destination selection without adding a publication path

**Files:**
- Modify: `tests/ops-board-ui-contract.test.mjs:53-178,318-336`
- Modify: `src/client/ops.ts:385-405,2710-2850,2885-3155,4340-4415,4700-4735`

- [ ] **Step 1: Write the failing wiring contract**

Add source assertions proving that destination changes use the local renderer
and do not add a destination API:

```js
assert.match(client, /activeReportPublicDestination/);
assert.match(client, /renderReportPublicDestination/);
assert.match(client, /name === "reportPublicDestination"/);
assert.match(client, /reportPublicationConfirmationAfterInput\([^)]*"reportPublicDestination"/s);
assert.doesNotMatch(client, /\/api\/v1\/ops\/reports\/[^\n]+destination/);
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
node --test --test-name-pattern "case-room console|report publication" tests/ops-board-ui-contract.test.mjs
```

Expected: FAIL because no local destination controller exists.

- [ ] **Step 3: Add the local active destination**

Add beside `activeReportDetail`:

```ts
let activeReportPublicDestination: ReportPublicDestination = "private";
```

When opening a new report, reset it before the fetch and choose the durable
default once the first detail response arrives:

```ts
activeReportPublicDestination = "private";
// after fetchReportDetail succeeds and before renderReportDialog:
activeReportPublicDestination = defaultReportPublicDestination(detail);
```

Do not change the value inside `refreshActiveReportDetail`; this preserves the
operator's choice while a draft, upload, status or withdrawal refreshes the
drawer. Reset it to `private` in the dialog `close` handler.

- [ ] **Step 4: Add the conditional renderer**

Add:

```ts
function renderReportPublicDestination(detail: OpsReportDetail): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return;
  const destination = activeReportPublicDestination;
  const view = reportPublicDestinationView(destination);
  const editable = detail.publicationEligible && detail.status !== "resolved" && detail.status !== "rejected";

  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="reportPublicDestination"]')) {
    radio.checked = radio.value === destination;
    radio.closest<HTMLElement>(".ops-report-destination")?.toggleAttribute("data-selected", radio.checked);
  }
  const stateCopy: Record<ReportPublicDestination, string> = {
    private: detail.caseNote.status === null && detail.publication.status === null
      ? "No public action"
      : "Private source retained",
    case_note: detail.caseNote.status === null
      ? "No Case Note"
      : detail.caseNote.status === "published" ? "Published" : "Hidden",
    official_update: detail.publication.status === null
      ? "No Update draft"
      : detail.publication.status[0]!.toUpperCase() + detail.publication.status.slice(1),
  };
  for (const state of dialog.querySelectorAll<HTMLElement>("[data-report-destination-state]")) {
    const value = state.dataset.reportDestinationState;
    if (isReportPublicDestination(value)) state.textContent = stateCopy[value];
  }
  const privateOutcome = dialog.querySelector<HTMLElement>("[data-report-private-outcome]");
  const form = dialog.querySelector<HTMLFormElement>("[data-report-publication-form]");
  const officialCopy = dialog.querySelector<HTMLElement>("[data-report-official-copy]");
  if (privateOutcome) privateOutcome.hidden = destination !== "private";
  if (form) form.hidden = !view.formVisible;
  if (officialCopy) officialCopy.hidden = destination !== "official_update";
  for (const panel of dialog.querySelectorAll<HTMLElement>("[data-report-destination-panel]")) {
    panel.hidden = panel.dataset.reportDestinationPanel !== destination;
  }

  for (const checkbox of dialog.querySelectorAll<HTMLInputElement>('input[name="publishMedia"]')) {
    const source = checkbox.hasAttribute("data-update-upload-select") ? "update" : "report";
    checkbox.disabled = !editable
      || checkbox.dataset.previewReady !== "true"
      || !reportMediaSelectableForDestination(destination, source);
  }
  const evidenceHelp = dialog.querySelector<HTMLElement>("[data-report-evidence-help]");
  if (evidenceHelp) evidenceHelp.textContent = view.evidenceLabel;
}
```

Give the current submitted-evidence help paragraph
`data-report-evidence-help`. In `hydrateReportEvidence`, set
`checkbox.dataset.previewReady = "true"` only after the private preview is
successfully loaded, then call `renderReportPublicDestination(detail)` after
hydration completes.

- [ ] **Step 5: Scope count and preview media to the selected destination**

Change `reportSelectedMediaIds` to:

```ts
function reportSelectedMediaIds(): string[] {
  if (activeReportPublicDestination === "private") return [];
  if (activeReportPublicDestination === "case_note") return reportSelectedReportMediaIds();
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return [];
  return [...dialog.querySelectorAll<HTMLInputElement>('input[name="publishMedia"]:checked')]
    .map((input) => input.value);
}
```

Leave `reportSelectedReportMediaIds` as the Case Note request source and
`reportSelectedMediaSelections` as the Official Update request source. This
preserves hidden direct-upload choices while excluding them from a Case Note
preview or count.

- [ ] **Step 6: Render the exact shape for the chosen destination**

Pass `activeReportPublicDestination` into `renderReportPublicationPreview`
from `updateReportPublicationPreview`, so Case Notes omit the Official
Update-only headline while Official Updates retain it.

- [ ] **Step 7: Apply the renderer after each authoritative detail render**

At the end of `renderReportDialog`, after the existing buttons receive their
authoritative enabled/hidden states, call:

```ts
renderReportPublicDestination(detail);
updateReportSelectedMediaCount();
updateReportPublicationPreview();
```

The destination renderer may narrow controls but must not override a
server-derived blocker or make an ineligible action available.

- [ ] **Step 8: Handle radio changes locally and reset confirmation**

At the beginning of the report dialog `input` listener, add:

```ts
if (target instanceof HTMLInputElement
    && target.name === "reportPublicDestination"
    && isReportPublicDestination(target.value)
    && activeReportDetail) {
  activeReportPublicDestination = target.value;
  const confirmation = reportDialog.querySelector<HTMLInputElement>(
    '[data-report-publication-form] [name="confirmPublication"]'
  );
  if (confirmation) {
    confirmation.checked = reportPublicationConfirmationAfterInput(
      confirmation.checked,
      "reportPublicDestination"
    );
  }
  renderReportPublicDestination(activeReportDetail);
  updateReportSelectedMediaCount();
  updateReportPublicationPreview();
  setReportPublicationResult(
    target.value === "private"
      ? "This report remains private. Nothing was published."
      : target.value === "case_note"
        ? "Case Notes selected. Review the public version and images before publishing."
        : "Official Update selected. Save a private draft or complete the verified publication steps."
  );
  return;
}
```

Delete the obsolete `data-report-prepare-public` click listener.

Change the successful Case Note message to the destination-specific wording:

```ts
result.replaceChildren(
  document.createTextNode("Case Note published. It did not create an Official Update. "),
  link
);
```

- [ ] **Step 9: Run client contracts, behavior tests and typecheck**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts
npm run typecheck:client
```

Expected: every command passes with no new API route or type error.

- [ ] **Step 10: Commit the destination controller**

```powershell
git add ops.html src/client/ops.ts tests/ops-board-ui-contract.test.mjs
git commit -m "fix: reveal the selected report outcome"
```

### Task 4: Prove the workflow in an isolated real browser

**Files:**
- Modify: `scripts/verify-unified-shell-qa.mjs:77-245,338-430,930-1375`

- [ ] **Step 1: Add a failing browser scenario name**

Add `"public destination selection is write-free"` to
`reportWorkflowScenarioNames`, but do not add the scenario yet.

- [ ] **Step 2: Run the browser audit and verify RED**

Run:

```powershell
$env:UNIFIED_SHELL_QA_PRESERVE_ARTIFACTS='0'
npm run verify:unified-shell-qa
```

Expected: FAIL because the named scenario is absent from `scenarioEvidence`.

- [ ] **Step 3: Give the local report fixture three ready images**

Replace the empty fixture media array with:

```js
media: [1, 2, 3].map((index) => ({
  id: `qa-report-media-${index}`,
  contentType: "image/png",
  size: 68,
  status: "ready",
})),
```

Change the injected table row from `0 files` to `3 files`. Add this PNG fixture
near the other QA constants:

```js
const qaPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
```

In `installQaBoundary`, before the generic report endpoint handler, fulfill the
three private preview GETs without exposing an external URL:

```js
if (reportWorkflowFixture && /^\/api\/v1\/ops\/reports\/report-workflow-qa-001\/media\/qa-report-media-[1-3]$/.test(url.pathname)) {
  networkLedger.localApiMocks.push({ method, pathname: url.pathname });
  await route.fulfill({ status: 200, contentType: "image/png", body: qaPng });
  return;
}
```

- [ ] **Step 4: Add the write-free desktop selection scenario**

Before the active-publication-guards scenario, reset the fixture to Verified,
open the report and run:

```js
reportWorkflowFixture.reset({ nextStatus: "verified", nextAssignedTo: "QA Operator" });
await openLocalWorkflowReport(page);
const selectionBaseline = workflowMutationLedger.length;
const privateChoice = page.getByRole("radio", { name: /Keep private/i });
const caseNoteChoice = page.getByRole("radio", { name: /Publish to Case Notes/i });
const officialChoice = page.getByRole("radio", { name: /Prepare an Official Update/i });
assert.equal(await privateChoice.isChecked(), true);
assert.equal(await page.locator("[data-report-publication-form]").isHidden(), true);

await caseNoteChoice.check();
assert.equal(await page.locator('[data-report-destination-panel="case_note"]').isVisible(), true);
assert.equal(await page.locator('[data-report-destination-panel="official_update"]').isHidden(), true);
assert.equal(await page.locator("[data-report-official-copy]").isHidden(), true);
await page.locator("#report-public-body").fill("Reviewed public observation");
await page.locator('[data-report-evidence] input[name="publishMedia"]').nth(0).check();
await page.locator('[data-report-evidence] input[name="publishMedia"]').nth(2).check();
assert.match(await page.locator("[data-report-selected-count]").innerText(), /2 of 3/);
await page.locator("#report-publication-confirm").check();

await officialChoice.check();
assert.equal(await page.locator("#report-publication-confirm").isChecked(), false);
assert.equal(await page.locator('[data-report-destination-panel="official_update"]').isVisible(), true);
assert.equal(await page.locator('[data-report-destination-panel="case_note"]').isHidden(), true);
assert.equal(await page.locator("[data-report-official-copy]").isVisible(), true);
assert.equal(await page.locator("#report-public-body").inputValue(), "Reviewed public observation");
await page.locator("#report-public-title-input").fill("Official Update draft headline");
assert.equal(await page.locator('[data-report-evidence] input[name="publishMedia"]:checked').count(), 2);

await privateChoice.check();
assert.equal(await page.locator("[data-report-publication-form]").isHidden(), true);
await officialChoice.check();
assert.equal(await page.locator("#report-public-title-input").inputValue(), "Official Update draft headline");
assert.equal(await page.locator("#report-public-body").inputValue(), "Reviewed public observation");
await privateChoice.check();
assert.equal(workflowMutationLedger.length, selectionBaseline, "destination selection must send zero writes");
scenarioEvidence.push("public destination selection is write-free");
await closeLocalWorkflowReport(page);
```

The test deliberately stops before any final Case Note or Official Update
action.

- [ ] **Step 5: Add mobile semantics and hit-target checks**

In the 390-by-844 scenario, verify all three destination labels stack, each
input remains keyboard/touch operable, and the drawer has no horizontal
overflow:

```js
for (const choice of [
  mobile.page.getByRole("radio", { name: /Keep private/i }),
  mobile.page.getByRole("radio", { name: /Publish to Case Notes/i }),
  mobile.page.getByRole("radio", { name: /Prepare an Official Update/i }),
]) {
  await choice.waitFor({ state: "visible" });
  const card = choice.locator("xpath=ancestor::label[1]");
  const box = await card.boundingBox();
  assert.ok(box && box.height >= 44, "each public destination card must retain a 44px touch target");
}
```

Select Case Notes and Official Update once each and assert the matching pane is
visible before closing the mobile drawer.

- [ ] **Step 6: Run the browser audit and verify GREEN**

Run:

```powershell
$env:UNIFIED_SHELL_QA_PRESERVE_ARTIFACTS='0'
npm run verify:unified-shell-qa
```

Expected: the complete isolated audit passes with zero console errors, page
errors, request failures, external writes or destination-selection writes.

- [ ] **Step 7: Commit the browser regression**

```powershell
git add scripts/verify-unified-shell-qa.mjs
git commit -m "test: exercise report destination selection"
```

### Task 5: Run the complete local release gate

**Files:**
- No source changes expected

- [ ] **Step 1: Run the complete test suites**

Run:

```powershell
npm test
```

Expected: all JavaScript and TypeScript tests pass. If the long real-D1 test
file exceeds a command timeout, resume the same command with a longer timeout;
do not treat a timeout as a passing result.

- [ ] **Step 2: Run every TypeScript project**

Run:

```powershell
npm run typecheck
```

Expected: worker, client and test projects all pass.

- [ ] **Step 3: Verify authoritative legal artifacts**

Run:

```powershell
npm run legal:verify
```

Expected: generated legal artifacts match their authoritative sources exactly.

- [ ] **Step 4: Run the focused privacy and environment gates**

Run:

```powershell
node --test tests/privacy-output.test.mjs tests/public-output-privacy-scan.test.mjs tests/campaign-shell-preservation.test.mjs tests/build-isolation.test.mjs
npx tsx --test tests/api-security.test.ts tests/api-environment-guard.test.ts tests/api-production-snapshot.test.ts
```

Expected: all tests pass; no private production projection or writable snapshot
path appears.

- [ ] **Step 5: Build the production-shaped artifact**

Run:

```powershell
npm run build
git diff --check
git status --short
```

Expected: build and diff check pass, and the worktree is clean.

### Task 6: Deploy validation and verify the exact candidate

**Files:**
- No tracked file changes before production promotion

- [ ] **Step 1: Freeze the candidate identity**

Run:

```powershell
$candidate = (git rev-parse HEAD).Trim()
$short = (git rev-parse --short HEAD).Trim()
Set-Content -LiteralPath "$env:TEMP\tim-lost-destination-candidate.txt" -Value $candidate
$distRoot = (Resolve-Path dist).Path
Get-ChildItem -LiteralPath dist -Recurse -File | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName.Substring($distRoot.Length).Replace('\', '/')
    Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath "$env:TEMP\tim-lost-destination-dist-manifest.json"
git status --short
```

Expected: a clean worktree and one immutable candidate hash.

- [ ] **Step 2: Capture a read-only production baseline**

Run this SELECT-only command and save its JSON outside the repository's tracked
files:

```powershell
$baselineQuery = @"
SELECT
  (SELECT environment FROM environment_metadata WHERE id = 1) AS environment,
  (SELECT COUNT(*) FROM player_accounts) AS players,
  (SELECT COUNT(*) FROM private_reports) AS reports,
  (SELECT COUNT(*) FROM operator_reviewed_case_notes) AS report_case_notes,
  (SELECT COUNT(*) FROM official_updates) AS official_updates,
  (SELECT COUNT(*) FROM staff_principals) AS staff,
  (SELECT COUNT(*) FROM audit_events) AS audit_events,
  (SELECT COUNT(*) FROM report_events) AS report_events,
  (SELECT COUNT(*) FROM media_uploads) AS media_rows,
  (SELECT COUNT(*) FROM legal_acceptance_events) AS legal_acceptances,
  (SELECT COUNT(*) FROM waypoints WHERE is_published = 1) AS waypoints
"@
npx wrangler d1 execute tim-lost-hunter-platform --remote --json --command $baselineQuery | Set-Content -LiteralPath "$env:TEMP\tim-lost-destination-baseline-before.json"
npx wrangler d1 execute tim-lost-hunter-platform --remote --json --command "PRAGMA foreign_key_check;" | Set-Content -LiteralPath "$env:TEMP\tim-lost-destination-fk-before.json"
```

Expected: environment is `production`, foreign-key results are empty, and
Wrangler reports a read-only query with no changed database.

- [ ] **Step 3: Deploy the existing `dist` artifact to validation**

Run:

```powershell
$candidate = (Get-Content -LiteralPath "$env:TEMP\tim-lost-destination-candidate.txt" -Raw).Trim()
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation --commit-hash $candidate --commit-message "Validation: selectable report destinations"
```

Expected: Cloudflare returns one immutable deployment URL.

- [ ] **Step 4: Verify validation identity and public availability**

Load `$short = (git rev-parse --short HEAD).Trim()`, then open the immutable URL and
`https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=$short`.
Require HTTP 200, the validation banner, the three destination radios in served
Ops source, no horizontal overflow at 390-by-844, and no browser console error.

- [ ] **Step 5: Exercise validation without touching production**

Using a validation report or the isolated fixture, verify:

1. Keep private is selected by default and shows no public composer.
2. Case Notes reveals only the Case Notes path and ready submitted images.
3. Official Update reveals only draft/upload/schedule/publish controls.
4. Switching retains typed copy and image choices but clears confirmation.
5. Selecting any card sends no request and publishes nothing.
6. Existing Case Note and Official Update records restore their destination.
7. No image starts selected.

Do not use the production report for a publication, status transition,
withdrawal or media mutation.

- [ ] **Step 6: Re-run the read-only production baseline**

Repeat Step 2 into `tim-lost-destination-baseline-after-validation.json` and
`tim-lost-destination-fk-after-validation.json`.

Expected: the deployment caused zero production writes. If real activity
changed a count, inspect timestamps and audit rows read-only and prove it was a
participant/operator action before continuing.

### Task 7: Promote the exact verified candidate to production

**Files:**
- Modify after live verification: `docs/operations/2026-07-18-private-report-workflow-validation.md`
- Modify after live verification: `docs/operations/2026-07-16-production-release.md`
- Modify after live verification: `STATUS.md`

- [ ] **Step 1: Confirm artifact identity before promotion**

Run:

```powershell
$candidate = (Get-Content -LiteralPath "$env:TEMP\tim-lost-destination-candidate.txt" -Raw).Trim()
if ((git rev-parse HEAD).Trim() -ne $candidate) { throw "Candidate changed after validation." }
git status --short
npm run build
$distRoot = (Resolve-Path dist).Path
$currentManifest = Get-ChildItem -LiteralPath dist -Recurse -File | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName.Substring($distRoot.Length).Replace('\', '/')
    Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
} | ConvertTo-Json -Depth 3
$validatedManifest = Get-Content -LiteralPath "$env:TEMP\tim-lost-destination-dist-manifest.json" -Raw
if ($currentManifest.Trim() -ne $validatedManifest.Trim()) { throw "Built assets changed after validation." }
```

Expected: the same candidate hash, a clean worktree and a successful rebuild.
Repeat the Task 6 Step 2 SELECT-only baseline into
`tim-lost-destination-baseline-before-production.json` immediately before the
production push.

- [ ] **Step 2: Push the verified source to GitHub main**

Run:

```powershell
git push origin HEAD:main
```

Expected: GitHub `main` points to the verified candidate. If Cloudflare Git
integration creates a deployment automatically, verify its commit hash before
choosing it as the recorded production deployment.

- [ ] **Step 3: Deploy the exact artifact to the production Pages branch**

Run:

```powershell
$candidate = (Get-Content -LiteralPath "$env:TEMP\tim-lost-destination-candidate.txt" -Raw).Trim()
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch main --commit-hash $candidate --commit-message "Production: selectable report destinations"
```

Expected: one immutable Pages deployment for the same candidate. No migration,
D1 write, R2 write, queue change, media-worker deploy, DNS change or Clerk
change is performed.

- [ ] **Step 4: Run production smoke checks**

Require:

- `https://www.timlostsomething.com/`, `/ops`, `/updates`, `/clue-board` and
  `/report` return HTTP 200;
- the apex domain preserves a test path/query while redirecting permanently to
  `www`;
- the live site has no validation banner;
- the served Ops source contains all three native destination radios;
- signed-out Ops remains protected;
- the live public Updates and Case Notes remain unchanged by deployment; and
- desktop and 390-by-844 browser checks show no horizontal overflow or console
  error.

With an existing authorized staff session, open the approximately 12:54 p.m.
report read-only, switch among the three local choices, and confirm its three
ready images become selectable only in the appropriate panes. Do not confirm a
preview or invoke a final action.

- [ ] **Step 5: Compare the post-production baseline**

Repeat the exact SELECT and foreign-key commands from Task 6 Step 2. Compare
the results with the immediate pre-production baseline.

Expected: environment remains `production`, foreign keys remain clean and the
deployment itself writes no application rows. Investigate legitimate concurrent
activity read-only instead of deleting or editing it.

- [ ] **Step 6: Tag the rollback point**

Run:

```powershell
$candidate = (Get-Content -LiteralPath "$env:TEMP\tim-lost-destination-candidate.txt" -Raw).Trim()
git tag production-report-destinations-2026-07-18 $candidate
git push origin production-report-destinations-2026-07-18
```

Expected: the live application candidate has an immutable Git rollback tag;
the previous `production-guided-ops-2026-07-18` tag and previous Pages
deployment remain intact.

- [ ] **Step 7: Record validation and production evidence**

Append a dated section to
`docs/operations/2026-07-18-private-report-workflow-validation.md` containing
the candidate hash, immutable validation URL, commands, test totals, browser
viewports and zero-write baseline conclusion.

Update `docs/operations/2026-07-16-production-release.md` with the live
candidate, Pages deployment ID/URL, verification totals, post-deploy baseline,
new tag and immediate previous deployment. Add the same concise current-state
entry at the top of `STATUS.md`. Record no credentials, private report body,
reporter contact data or private media URLs.

- [ ] **Step 8: Commit and push the release record**

```powershell
git add STATUS.md docs/operations/2026-07-16-production-release.md docs/operations/2026-07-18-private-report-workflow-validation.md
git commit -m "docs: record report destination production release"
git push origin HEAD:main
```

Expected: source and handoff documentation reflect the live deployment while
the application commit recorded in the release document remains the exact
candidate tested on validation.
