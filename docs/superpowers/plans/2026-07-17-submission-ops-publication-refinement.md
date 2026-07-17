# Submission, Ops and Publication Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved validation-first submission, moderation, attribution, publication, media-viewer and Ops design refinements without mutating production data or changing existing live content.

**Architecture:** Extend the existing D1/R2/Hono platform with additive publication-source and attribution records, keeping public projections separate from private report records. Reuse the report image preparation and media-worker pipeline, expose only ready derivatives, and progressively enhance the current static pages with small TypeScript modules rather than rebuilding the frontend.

**Tech Stack:** Cloudflare Pages Functions and Workers, Hono, D1, R2, Cloudflare Images, Clerk, Turnstile, TypeScript, static HTML/CSS, Node test runner, Miniflare, esbuild.

---

## File Structure

- `migrations/0015_submission_ops_publication_refinement.sql`: additive report attribution, report-sourced Case Note, Update draft/media and publication metadata.
- `src/shared/waypoints.ts`: canonical short Stop labels and non-stop selection values.
- `src/shared/publication.ts`: publication destination, attribution and draft-state value objects.
- `src/server/types.ts`: typed datastore contracts for moderation detail and publication drafts.
- `src/server/d1-store.ts`: authoritative projections and atomic mutations.
- `src/server/app.ts`: authenticated Ops endpoints and validated public submission inputs.
- `src/server/uploads.ts`: private Ops Update upload producer.
- `src/media-worker.ts`: derivative processing for direct Update uploads.
- `src/client/identity-submission.ts`: reusable report-time attribution model.
- `src/client/report.ts`: private report attribution and clearer receipt behavior.
- `src/client/board.ts`: Case Note routing, receipt, idempotency and stop labels.
- `src/client/ops.ts`: review workflow, Case Note publication, Update drafts, media controls and confirmations.
- `src/client/approved-media-viewer.ts`: shared public/Ops approved-derivative lightbox.
- `src/client/updates.ts`: uncropped linked media and shared viewer initialization.
- `src/client/route-lightbox.ts`: delegate shared viewer behavior while preserving waypoint scope.
- `report.html`, `clue-board.html`, `updates.html`, `route.html`, `ops.html`: accessible controls and viewer/dialog shells.
- `css/hunter.css`, `css/board.css`, `css/route-lightbox.css`, `css/ops.css`: form, viewer, checkbox and documentary Ops presentation.
- `scripts/build.mjs`: bundle the new shared client entry point.
- `tests/*.test.ts`, `tests/*.test.mjs`: contract, datastore, API, client, accessibility and privacy regression coverage.

## Checkpoint 1: Submission Trust and Routing

### Task 1: Canonical Stop labels

**Files:**
- Modify: `src/shared/waypoints.ts`
- Modify: `src/client/report.ts`
- Modify: `src/client/board.ts`
- Modify: `report.html`
- Modify: `clue-board.html`
- Test: `tests/route-client.test.ts`
- Test: `tests/report-image-limits.test.ts`
- Test: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing tests for all thirteen short labels and both non-stop options**

```ts
assert.deepEqual(stopOptions(waypoints).slice(0, 2), [
  { value: "not_sure", label: "Not sure which stop" },
  { value: "different", label: "Different location / outside the Lucky 13" },
]);
assert.equal(stopLabel({ routeOrder: 11, name: "The Driving Range & the Digger Café" }), "Stop 11 · Driving Range / Digger Café");
```

- [ ] **Step 2: Run focused tests and verify the missing exports fail**

Run: `npx tsx --test tests/route-client.test.ts tests/board-client.test.ts`

Expected: FAIL because `stopOptions` and `stopLabel` do not exist.

- [ ] **Step 3: Add the canonical helpers and render selectors from runtime waypoint data**

```ts
export const NON_STOP_VALUES = ["not_sure", "different"] as const;
export function stopLabel(input: { routeOrder: number; name: string }): string {
  const short = input.name
    .replace(/^The /, "")
    .replace("The Driving Range & the Digger Café", "Driving Range / Digger Café");
  return `Stop ${String(input.routeOrder).padStart(2, "0")} · ${short}`;
}
```

Keep stable D1 waypoint IDs as option values. Map the two non-stop values to a
null `waypointId` plus the existing required location description.

- [ ] **Step 4: Run focused tests**

Run: `npx tsx --test tests/route-client.test.ts tests/board-client.test.ts tests/report-image-limits.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/waypoints.ts src/client/report.ts src/client/board.ts report.html clue-board.html tests/route-client.test.ts tests/board-client.test.ts tests/report-image-limits.test.ts
git commit -m "feat: standardize Lucky 13 stop labels"
```

### Task 2: Moderation media projection and detail

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/ops.ts`
- Test: `tests/api-store-integration.test.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing datastore and API tests**

```ts
assert.deepEqual(pending.items[0]?.media, [
  { id: "note-media-ready", status: "ready", contentType: "image/webp", size: 100_794 },
]);
assert.equal(pending.items[0]?.mediaCount, 1);
```

Also prove processing and rejected media cannot be selected and that the scoped
Ops media endpoint rejects a media ID owned by another note.

- [ ] **Step 2: Run focused tests and verify the projection fails**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because pending notes do not project media.

- [ ] **Step 3: Add a bounded media projection and scoped derivative reader**

```ts
interface PendingNoteMedia {
  id: string;
  status: "processing" | "ready" | "rejected";
  contentType: string;
  size: number;
}
```

Load media in one follow-up query keyed by the selected note IDs. Add
`GET /api/v1/ops/moderation/notes/:noteId/media/:mediaId`, requiring active
staff and returning only the note-owned ready derivative with `private,
no-store` caching.

- [ ] **Step 4: Render counts, states and preview controls with selection off by default**

```ts
const selectable = media.status === "ready";
return `<input type="checkbox" name="publicMedia" value="${escapeOpsHtml(media.id)}" ${selectable ? "" : "disabled"}>`;
```

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/types.ts src/server/d1-store.ts src/server/app.ts src/client/ops.ts tests/api-store-integration.test.ts tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "fix: show Case Note media in moderation"
```

### Task 3: Submission receipts, duplicate protection and route clarification

**Files:**
- Modify: `clue-board.html`
- Modify: `report.html`
- Modify: `src/client/board.ts`
- Modify: `src/client/report.ts`
- Test: `tests/board-client.test.ts`
- Test: `tests/hunter-ui-pages.test.mjs`
- Test: `tests/hunter-ui-client.test.ts`

- [ ] **Step 1: Write failing tests for distinct receipts and cross-links**

```ts
assert.match(caseNoteReceipt("TLS-N-1234"), /received for moderation/i);
assert.doesNotMatch(caseNoteReceipt("TLS-N-1234"), /published/i);
assert.match(privateReportReceipt("TLS-R-1234"), /stays private/i);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/hunter-ui-pages.test.mjs && npx tsx --test tests/board-client.test.ts tests/hunter-ui-client.test.ts`

Expected: FAIL because Case Notes lack a reference receipt model.

- [ ] **Step 3: Add explicit path explanations, cross-links and idempotency keys**

```ts
export function caseNoteReceipt(reference: string): string {
  return `Received for moderation. Reference ${reference}. Nothing is public until an operator approves it.`;
}
```

Generate one idempotency key per untouched form attempt and retain it across a
network retry. Clear it only after success or user input changes.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/hunter-ui-pages.test.mjs && npx tsx --test tests/board-client.test.ts tests/hunter-ui-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add clue-board.html report.html src/client/board.ts src/client/report.ts tests/board-client.test.ts tests/hunter-ui-pages.test.mjs tests/hunter-ui-client.test.ts
git commit -m "fix: clarify Case Note and private report submissions"
```

### Task 4: Turnstile lifecycle guard and validation isolation

**Files:**
- Create: `src/client/turnstile-lifecycle.ts`
- Modify: `src/client/board.ts`
- Modify: `src/client/report.ts`
- Modify: `src/server/types.ts`
- Modify: `wrangler.toml`
- Test: `tests/turnstile.test.ts`
- Test: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
const lifecycle = createTurnstileLifecycle();
assert.equal(lifecycle.beginRender("report"), true);
assert.equal(lifecycle.beginRender("report"), false);
lifecycle.recordReset("report", "submission_failed");
assert.deepEqual(lifecycle.events().map((event) => event.kind), ["rendered", "reset"]);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/turnstile.test.ts tests/board-client.test.ts`

Expected: FAIL because the lifecycle module does not exist.

- [ ] **Step 3: Implement one-render guards and reasoned resets**

```ts
export type TurnstileResetReason = "submission_failed" | "submitted" | "expired" | "new_form";
export function createTurnstileLifecycle() {
  const rendered = new Set<string>();
  const log: Array<{ kind: string; form: string; reason?: TurnstileResetReason }> = [];
  return {
    beginRender(form: string) { if (rendered.has(form)) return false; rendered.add(form); log.push({ kind: "rendered", form }); return true; },
    recordReset(form: string, reason: TurnstileResetReason) { log.push({ kind: "reset", form, reason }); },
    events: () => [...log],
  };
}
```

Expose only aggregate lifecycle counters to local diagnostics; never include
tokens. Confirm validation and production use separate site keys before any
mode experiment.

- [ ] **Step 4: Run focused tests and environment verification**

Run: `npx tsx --test tests/turnstile.test.ts tests/board-client.test.ts && node scripts/verify-environment.mjs`

Expected: PASS with distinct environment bindings.

- [ ] **Step 5: Commit**

```powershell
git add src/client/turnstile-lifecycle.ts src/client/board.ts src/client/report.ts src/server/types.ts wrangler.toml tests/turnstile.test.ts tests/board-client.test.ts
git commit -m "fix: guard Turnstile verification lifecycle"
```

## Checkpoint 2: Attribution and Publication Workflow

### Task 5: Additive publication schema and shared contracts

**Files:**
- Create: `migrations/0015_submission_ops_publication_refinement.sql`
- Create: `src/shared/publication.ts`
- Modify: `src/server/types.ts`
- Test: `tests/api-schema.test.ts`
- Test: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
assert.deepEqual(await columns(db, "private_reports"), expect.arrayContaining(["public_attribution"]));
assert.deepEqual(await columns(db, "field_notes"), expect.arrayContaining(["source_report_id", "note_kind"]));
```

Verify existing reports, notes and Updates remain byte-for-byte unchanged after
the migration.

- [ ] **Step 2: Run schema tests and verify failure**

Run: `npx tsx --test tests/api-schema.test.ts tests/api-store-integration.test.ts`

Expected: FAIL because migration 0015 and columns do not exist.

- [ ] **Step 3: Add forward-compatible columns and tables**

```sql
ALTER TABLE private_reports ADD COLUMN public_attribution TEXT;
ALTER TABLE private_reports ADD COLUMN attribution_kind TEXT
  CHECK (attribution_kind IN ('display_name', 'hunter_handle', 'community', 'young_hunter'));
ALTER TABLE hunter_profiles ADD COLUMN public_display_name TEXT;
ALTER TABLE field_notes ADD COLUMN source_report_id TEXT REFERENCES private_reports(id);
ALTER TABLE field_notes ADD COLUMN note_kind TEXT NOT NULL DEFAULT 'community'
  CHECK (note_kind IN ('community', 'operator_reviewed'));
CREATE UNIQUE INDEX idx_field_notes_source_report
  ON field_notes(source_report_id) WHERE source_report_id IS NOT NULL;
CREATE TABLE field_note_selected_media (
  note_id TEXT NOT NULL REFERENCES field_notes(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE RESTRICT,
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  alt_text TEXT,
  caption TEXT,
  PRIMARY KEY (note_id, media_id)
);
ALTER TABLE official_update_media ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_update_media ADD COLUMN alt_text TEXT;
ALTER TABLE official_update_media ADD COLUMN caption TEXT;
```

Create additive `official_update_uploads` and
`official_update_uploaded_media` tables for direct Ops media, avoiding a risky
rebuild of the existing `media_uploads` CHECK constraint.

- [ ] **Step 4: Add exact TypeScript unions and validators**

```ts
export type PublicAttributionKind = "display_name" | "hunter_handle" | "community" | "young_hunter";
export type PublicationDestination = "private" | "case_note" | "official_update";
export type OfficialUpdateState = "draft" | "scheduled" | "published" | "withdrawn";
```

- [ ] **Step 5: Run schema and integration tests**

Run: `npx tsx --test tests/api-schema.test.ts tests/api-store-integration.test.ts`

Expected: PASS with foreign keys clean.

- [ ] **Step 6: Commit**

```powershell
git add migrations/0015_submission_ops_publication_refinement.sql src/shared/publication.ts src/server/types.ts tests/api-schema.test.ts tests/api-store-integration.test.ts
git commit -m "feat: add publication refinement schema"
```

### Task 6: Report-time public attribution

**Files:**
- Modify: `src/client/identity-submission.ts`
- Modify: `src/client/report.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `report.html`
- Modify: `dashboard.html`
- Modify: `src/server/app.ts`
- Modify: `src/server/d1-store.ts`
- Test: `tests/identity-submission.test.ts`
- Test: `tests/hunter-ui-client.test.ts`
- Test: `tests/api-public.test.ts`
- Test: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing adult, anonymous and minor tests**

```ts
assert.equal(resolvePublicAttribution(adult, "display_name").label, "Nancy & Ron");
assert.equal(resolvePublicAttribution(minor, "display_name").label, "Young Hunter");
assert.equal(resolvePublicAttribution(null, "community").label, "Community Hunter");
```

Prove no email token or private full name appears in public responses.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/identity-submission.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts`

Expected: FAIL because report attribution is not accepted or snapshotted.

- [ ] **Step 3: Add the required attribution selector and server allowlist**

```ts
export function resolvePublicAttribution(profile: AttributionProfile | null, requested: PublicAttributionKind) {
  if (profile?.participationBasis === "minor_guardian_permission") return { kind: "young_hunter", label: "Young Hunter" };
  if (!profile) return { kind: "community", label: "Community Hunter" };
  if (requested === "display_name" && profile.publicDisplayName) return { kind: requested, label: profile.publicDisplayName };
  if (requested === "hunter_handle") return { kind: requested, label: profile.publicHandle };
  return { kind: "community", label: "Community Hunter" };
}
```

Add an optional `Public display name` profile field with an explicit public-use
explanation, length and character validation. Persist the resolved label and
kind on report creation. Existing profiles keep their generated handle and
existing reports with null snapshots retain the current safe fallback logic.

- [ ] **Step 4: Run focused tests**

Run: `npx tsx --test tests/identity-submission.test.ts tests/hunter-ui-client.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/client/identity-submission.ts src/client/report.ts src/client/dashboard.ts report.html dashboard.html src/server/app.ts src/server/d1-store.ts tests/identity-submission.test.ts tests/hunter-ui-client.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts
git commit -m "feat: add report-time public attribution"
```

### Task 7: Guided report state workflow

**Files:**
- Modify: `src/shared/publication.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/client/ops.ts`
- Modify: `ops.html`
- Test: `tests/api-store-integration.test.ts`
- Test: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing transition and UI tests**

```ts
assert.equal(nextReportStates("received").includes("reviewing"), true);
assert.equal(nextReportStates("reviewing").includes("verified"), true);
assert.match(renderReportState({ status: "reviewing", assignedTo: "staff-1" }), /Status: Reviewing/);
assert.doesNotMatch(renderReportState({ status: "reviewing", assignedTo: "staff-1" }), /Begin review/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because the state model and persistent status UI do not exist.

- [ ] **Step 3: Implement transition allowlists, assignment and explicit results**

```ts
const REPORT_TRANSITIONS = {
  received: ["reviewing", "rejected"],
  reviewing: ["contacted", "escalated", "verified", "rejected"],
  contacted: ["reviewing", "verified", "rejected"],
  escalated: ["reviewing", "verified", "rejected"],
  verified: ["resolved"],
  rejected: [],
  resolved: [],
} as const;
```

Beginning review assigns the current staff subject. Keep state and publication
controls in separate Ops regions.

- [ ] **Step 4: Run focused tests**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/publication.ts src/server/d1-store.ts src/client/ops.ts ops.html tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "feat: guide private report review states"
```

### Task 8: Publish a reviewed report to Case Notes

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/ops.ts`
- Modify: `src/client/board.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/api-store-integration.test.ts`
- Test: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing publication, privacy and idempotency tests**

```ts
const note = await store.publishReportToCaseNotes("report-1", input, "staff-1");
assert.equal(note.noteKind, "operator_reviewed");
assert.equal(note.authorHandle, "Nancy & Ron");
assert.equal((await store.listUpdates()).items.length, 0);
```

Prove contact fields and `source_report_id` are absent from the public board
projection and a repeated request returns the same note.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-store-integration.test.ts tests/board-client.test.ts`

Expected: FAIL because the mutation does not exist.

- [ ] **Step 3: Add the atomic allowlisted mutation and endpoint**

```ts
publishReportToCaseNotes(
  reportId: string,
  input: { body: string; mediaIds: string[] },
  actorSubject: string,
): Promise<Record<string, unknown> | null>;
```

Insert one `operator_reviewed` field note linked privately to the report, copy
only the snapshotted attribution, waypoint and edited body, and record selected
ready report derivatives in `field_note_selected_media`. Append report/audit
events in one D1 batch. The public board projection merges ordinary note-owned
media with this allowlisted selection table without exposing the source report.

- [ ] **Step 4: Render the public source label and independent withdrawal action**

Display `Operator-reviewed Case Note`, never `official clue`. Keep withdrawal
independent from official Update publication.

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-store-integration.test.ts tests/board-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/types.ts src/server/d1-store.ts src/server/app.ts src/client/ops.ts src/client/board.ts tests/api-auth.test.ts tests/api-store-integration.test.ts tests/board-client.test.ts
git commit -m "feat: publish reviewed reports to Case Notes"
```

### Task 9: Draft, schedule and publish report Updates

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/ops.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/api-store-integration.test.ts`
- Test: `tests/updates-client.test.ts`

- [ ] **Step 1: Write failing draft and time-gate tests**

```ts
assert.equal((await store.saveReportUpdateDraft("report-1", draft, "staff-1")).status, "draft");
assert.equal((await store.listUpdates({ cursor: "2026-07-17T18:59:59Z" })).items.length, 0);
assert.equal((await store.listUpdates({ cursor: "2026-07-17T19:00:00Z" })).items.length, 1);
```

Also prove publication fails for an unverified report, scheduled content is not
visible early, and a repeated publish is idempotent.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-store-integration.test.ts tests/updates-client.test.ts`

Expected: FAIL because report publication is immediate-only.

- [ ] **Step 3: Split save, schedule, publish-now and withdraw mutations**

```ts
type ReportUpdateMutation = {
  title: string;
  body: string;
  mediaIds: string[];
  action: "save_draft" | "schedule" | "publish_now";
  scheduledFor?: string;
};
```

Use one stable `official_updates` row per source report. Public queries include
published rows and scheduled rows whose server timestamp is due, while all
future scheduled and draft rows remain private. Ops derives `Live` for a due
scheduled row without requiring a mutating GET.

- [ ] **Step 4: Replace immediate publication controls with exact preview and confirmation**

Buttons: `Save draft`, `Schedule`, `Publish now`, `Withdraw`. Final publication
requires the existing legal/media confirmation plus an exact preview.

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-store-integration.test.ts tests/updates-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/types.ts src/server/d1-store.ts src/server/app.ts src/client/ops.ts tests/api-auth.test.ts tests/api-store-integration.test.ts tests/updates-client.test.ts
git commit -m "feat: add draft-first report Updates"
```

## Checkpoint 3: Approved Media and Ops Presentation

### Task 10: Direct official Update uploads

**Files:**
- Modify: `src/server/uploads.ts`
- Modify: `src/media-worker.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/ops.ts`
- Modify: `ops.html`
- Test: `tests/media-worker.test.ts`
- Test: `tests/api-uploads.test.ts`
- Test: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing upload and ownership tests**

```ts
assert.deepEqual(assertMediaMessage(updateMessage), { ownerKind: "official_update" });
assert.equal(await publicMediaForOtherUpdate("update-2", "media-1"), null);
```

Prove a direct upload remains private while processing and is public only when
ready and explicitly selected on its owning Update.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/media-worker.test.ts tests/api-uploads.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because direct Update ownership is unsupported.

- [ ] **Step 3: Extend the producer and worker to the additive Update upload table**

```ts
export interface MediaMessage {
  mediaId: string;
  key: string;
  ownerKind: "field_note" | "report" | "official_update";
}
```

For `official_update`, update only `official_update_uploads`; existing owner
kinds continue updating `media_uploads`. Preserve the same MIME, dimension,
pixel and byte limits and write a pixels-only WebP derivative.

- [ ] **Step 4: Reuse browser preparation and add Ops ordering, alt text and captions**

Use `prepareReportImages` for up to three files. Store position, alt text and
caption on the owning Update selection record. Public selection starts empty.

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/media-worker.test.ts tests/api-uploads.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/uploads.ts src/media-worker.ts src/server/d1-store.ts src/server/app.ts src/client/ops.ts ops.html tests/media-worker.test.ts tests/api-uploads.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "feat: add official Update media uploads"
```

### Task 11: Shared uncropped approved-media viewer

**Files:**
- Create: `src/client/approved-media-viewer.ts`
- Modify: `src/client/updates.ts`
- Modify: `src/client/board.ts`
- Modify: `src/client/route-lightbox.ts`
- Modify: `updates.html`
- Modify: `clue-board.html`
- Modify: `route.html`
- Modify: `ops.html`
- Modify: `css/route-lightbox.css`
- Modify: `css/hunter.css`
- Modify: `css/board.css`
- Modify: `css/ops.css`
- Modify: `scripts/build.mjs`
- Test: `tests/route-lightbox.test.ts`
- Test: `tests/updates-client.test.ts`
- Test: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing gallery-scope and linked-thumbnail tests**

```ts
assert.equal(cycleApprovedMediaIndex(0, 1, 2), 1);
assert.match(renderApprovedMedia(media), /<a[^>]+href="\/api\/v1\/media\/media-1"/);
assert.match(renderApprovedMedia(media), /object-fit/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test tests/route-lightbox.test.ts tests/updates-client.test.ts tests/board-client.test.ts`

Expected: FAIL because approved media is rendered as inert `<img>` elements.

- [ ] **Step 3: Implement the shared dialog controller**

```ts
export interface ApprovedMediaItem {
  href: string;
  src: string;
  alt: string;
  caption: string;
  trigger: HTMLAnchorElement;
}
```

Intercept only an unmodified primary click. Keep the anchor functional for
right-click/new-tab. Scope navigation to the closest `[data-media-gallery]`,
restore focus on close, support arrows, Escape, backdrop and horizontal swipe.

- [ ] **Step 4: Render full-composition linked thumbnails and normalize orientation**

Apply `object-fit: contain`, width/height or `aspect-ratio`, lazy loading and
async decoding. Continue decoding large browser-optimized sources with
`imageOrientation: "from-image"`; add media-worker regression coverage that
the produced derivative dimensions reflect the decoded orientation.

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/route-lightbox.test.ts tests/updates-client.test.ts tests/board-client.test.ts tests/media-worker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/approved-media-viewer.ts src/client/updates.ts src/client/board.ts src/client/route-lightbox.ts updates.html clue-board.html route.html ops.html css/route-lightbox.css css/hunter.css css/board.css css/ops.css scripts/build.mjs tests/route-lightbox.test.ts tests/updates-client.test.ts tests/board-client.test.ts tests/media-worker.test.ts
git commit -m "feat: add shared approved-media viewer"
```

### Task 12: Repair the Ops confirmation checkbox

**Files:**
- Modify: `ops.html`
- Modify: `css/ops.css`
- Modify: `src/client/ops.ts`
- Test: `tests/ops-board-ui-contract.test.mjs`
- Test: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing semantic and class-contract tests**

```ts
assert.equal(document.querySelectorAll("#report-publication-confirm").length, 1);
assert.equal(document.querySelector("label[for=report-publication-confirm]") !== null, true);
assert.doesNotMatch(opsCss, /appearance:\s*none/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/ops-board-ui-contract.test.mjs && npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because the visual layers overlap.

- [ ] **Step 3: Keep one native input and one associated label**

```html
<label class="ops-confirmation" for="report-publication-confirm">
  <input id="report-publication-confirm" type="checkbox" />
  <span>I reviewed this exact public preview.</span>
</label>
```

Remove pseudo-elements that draw extra boxes. Keep a 44px target and visible
focus without hiding the native semantic control.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/ops-board-ui-contract.test.mjs && npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add ops.html css/ops.css src/client/ops.ts tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts
git commit -m "fix: render one Ops publication checkbox"
```

### Task 13: Align Ops with the Documentary Case File system

**Files:**
- Modify: `ops.html`
- Modify: `css/ops.css`
- Modify: `src/client/ops.ts`
- Test: `tests/ops-board-ui-contract.test.mjs`
- Test: `tests/campaign-design-system.test.mjs`
- Test: `tests/campaign-shell-accessibility.test.mjs`

- [ ] **Step 1: Write failing design-contract tests**

```ts
assert.doesNotMatch(opsHtml, /Pirata One|IM Fell English|Special Elite/);
assert.match(opsHtml, /Cormorant\+Garamond/);
assert.match(opsHtml, /Source\+Sans\+3/);
assert.match(opsHtml, /IBM\+Plex\+Mono/);
```

Assert the approved missing-ID mark, plain Case Room identity, visible focus and
distinct destructive-action classes.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/ops-board-ui-contract.test.mjs tests/campaign-design-system.test.mjs tests/campaign-shell-accessibility.test.mjs`

Expected: FAIL because Ops still loads pirate-era fonts and the `T?` seal.

- [ ] **Step 3: Replace fonts, mark and design tokens without changing authorization markup**

```css
:root {
  --ops-font-display: "Cormorant Garamond", Georgia, serif;
  --ops-font-body: "Source Sans 3", system-ui, sans-serif;
  --ops-font-mono: "IBM Plex Mono", ui-monospace, monospace;
}
```

Use the approved missing-ID asset, documentary labels, restrained evidence red
and responsive two-column review layout. Preserve every data attribute and ID
used by `src/client/ops.ts`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/ops-board-ui-contract.test.mjs tests/campaign-design-system.test.mjs tests/campaign-shell-accessibility.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add ops.html css/ops.css src/client/ops.ts tests/ops-board-ui-contract.test.mjs tests/campaign-design-system.test.mjs tests/campaign-shell-accessibility.test.mjs
git commit -m "style: align Ops with documentary case file"
```

## Final Verification and Validation Deployment

### Task 14: Full regression, privacy check and validation release

**Files:**
- Modify: `STATUS.md`
- Create: `docs/operations/2026-07-17-submission-ops-validation.md`
- Test: all repository suites

- [ ] **Step 1: Run formatting and complete automated verification**

Run:

```powershell
git diff --check
npm run legal:verify
npm run typecheck
npm test
npm run build
npm run verify:unified-shell-qa
node scripts/qa-output-privacy.mjs
```

Expected: all commands exit 0; the reported test totals contain zero failures.

- [ ] **Step 2: Run a production-leak and secret scan**

Run:

```powershell
rg -n "re_[A-Za-z0-9_]+|sk_(live|test)|CLERK_SECRET|TURNSTILE_SECRET|tech\+nancyandron" dist src css *.html docs
```

Expected: no credential values and no private Nancy & Ron email in public
output. Environment variable names may appear only in server/configuration
source where expected.

- [ ] **Step 3: Record a read-only production baseline**

Use the existing guarded environment verification and production-snapshot
workflow. Record protected D1 counts, foreign-key status and R2 object counts;
perform no production write.

- [ ] **Step 4: Deploy only to the `codex-validation` Pages branch**

Run the repository's documented validation deployment command from
`docs/operations/2026-07-16-production-release.md`, confirming Preview D1/R2,
validation Clerk and validation Turnstile bindings before upload.

Expected: the immutable validation deployment and stable validation alias both
report `deploymentEnvironment: validation`.

- [ ] **Step 5: Complete manual validation checks**

Verify signup, Case Note submission, private report submission, large photo
preparation, one-click/non-interactive Turnstile behavior, moderation media
counts, report review, all three publication destinations, scheduling, public
attribution, minor protection, linked uncropped media, keyboard focus, Windows
100/125/150% scaling and mobile layout. Confirm snapshot views remain read-only
and validation actions do not send production notifications.

- [ ] **Step 6: Re-run the read-only production baseline**

Expected: every protected D1 and R2 count matches Step 3, foreign keys remain
clean and the verification reports zero production writes.

- [ ] **Step 7: Document the release and update project status**

Record commit, immutable validation URL, binding verification, automated test
totals, manual results, production before/after baselines, known limitations
and the explicit statement that production was not promoted.

- [ ] **Step 8: Commit validation documentation**

```powershell
git add STATUS.md docs/operations/2026-07-17-submission-ops-validation.md
git commit -m "docs: record submission Ops validation release"
```

Production deployment is not part of this implementation plan. It requires
Murphy's explicit approval after reviewing the stable validation release.
