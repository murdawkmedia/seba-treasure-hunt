# Guided Official Update Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give inexperienced operators one draft-first, image-capable workflow for standalone and report-derived Official Updates, with explicit blockers and consistent guidance throughout Ops.

**Architecture:** Keep the existing `official_updates`, `official_update_uploads`, and selection tables. Add update-scoped Ops store/API operations for standalone drafts and direct media, preserve report-scoped routes as compatible facades, and drive both interfaces from a small pure guidance model. Deliver the shared publisher first, then apply its state/action/error language across the existing Ops console without changing authorization or production data.

**Tech Stack:** Cloudflare Pages Workers, Hono, D1, R2, TypeScript, browser image preparation, Node test runner, Miniflare, Playwright-compatible DOM contracts, HTML/CSS.

---

## File structure

- Create `src/shared/official-update-workflow.ts` — pure stage and blocker model used by Ops rendering.
- Create `tests/official-update-workflow.test.ts` — exhaustive state-model tests.
- Modify `src/server/types.ts` — typed standalone Update lifecycle and media store contracts.
- Modify `src/server/d1-store.ts` — private Ops ledger, standalone draft mutation, and update-owned media operations.
- Modify `tests/api-test-kit.ts` — production-faithful in-memory implementation for API tests.
- Modify `src/server/app.ts` — authenticated update-scoped ledger, draft, media, publish, schedule, and withdrawal routes.
- Modify `tests/api-auth.test.ts` — authorization, privacy, limits, idempotency, and public-visibility API tests.
- Modify `tests/api-store-integration.test.ts` — D1 lifecycle, media selection, audit, and due-schedule tests.
- Modify `ops.html` — three-stage standalone composer and clearer report Public Outcome landmarks.
- Modify `src/client/ops.ts` — standalone composer controller, ledger, report guidance, recovery, and shared success messages.
- Modify `tests/ops-board-ui-behavior.test.ts` — pure client rendering and state behavior.
- Modify `tests/ops-board-ui-contract.test.mjs` — semantic HTML and no-unexplained-disabled-control contract.
- Modify `css/ops.css` — guided stage cards and responsive single-scroll layouts.
- Modify `docs/operations/2026-07-18-private-report-workflow-validation.md` — record the validation checkpoint and owner test script.

No migration is planned: migration `0015_submission_ops_publication_refinement.sql` already owns direct media by `update_id` and records selected media separately.

### Task 1: Add the pure publishing guidance model

**Files:**
- Create: `src/shared/official-update-workflow.ts`
- Create: `tests/official-update-workflow.test.ts`

- [ ] **Step 1: Write failing stage and blocker tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { officialUpdateGuidance } from "../src/shared/official-update-workflow";

test("guides an empty standalone composer to a private draft", () => {
  const state = officialUpdateGuidance({
    hasDraft: false,
    status: null,
    sourceReportStatus: null,
    selectedCount: 0,
    processingSelectedCount: 0,
    confirmed: false,
  });
  assert.equal(state.stage, "write");
  assert.equal(state.primaryAction, "save_draft");
  assert.match(state.uploadBlocker ?? "", /saved private draft/i);
});

test("locks a report Update until its source report is verified", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: "reviewing",
    selectedCount: 1,
    processingSelectedCount: 0,
    confirmed: true,
  });
  assert.equal(state.stage, "verification");
  assert.equal(state.primaryAction, "go_to_review");
  assert.match(state.publishBlocker ?? "", /verified/i);
});

test("allows an exact confirmed preview to publish", () => {
  const state = officialUpdateGuidance({
    hasDraft: true,
    status: "draft",
    sourceReportStatus: "verified",
    selectedCount: 2,
    processingSelectedCount: 0,
    confirmed: true,
  });
  assert.equal(state.stage, "ready");
  assert.equal(state.primaryAction, "publish_now");
  assert.equal(state.publishBlocker, null);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/official-update-workflow.test.ts`

Expected: FAIL with `Cannot find module '../src/shared/official-update-workflow'`.

- [ ] **Step 3: Implement the complete pure model**

```ts
export type OfficialUpdateStatus = "draft" | "scheduled" | "published" | "withdrawn";
export type OfficialUpdateStage =
  | "write"
  | "processing"
  | "verification"
  | "preview"
  | "ready"
  | "scheduled"
  | "published";

export interface OfficialUpdateGuidanceInput {
  hasDraft: boolean;
  status: OfficialUpdateStatus | null;
  sourceReportStatus: string | null;
  selectedCount: number;
  processingSelectedCount: number;
  confirmed: boolean;
}

export interface OfficialUpdateGuidance {
  stage: OfficialUpdateStage;
  primaryAction: "save_draft" | "add_media" | "wait_for_media" | "go_to_review" | "review_preview" | "publish_now" | "open_scheduled" | "open_published";
  heading: string;
  explanation: string;
  selectedLabel: string;
  uploadBlocker: string | null;
  scheduleBlocker: string | null;
  publishBlocker: string | null;
}

export function officialUpdateGuidance(input: OfficialUpdateGuidanceInput): OfficialUpdateGuidance {
  const selectedLabel = `${Math.max(0, input.selectedCount)} of 3 images selected`;
  if (!input.hasDraft) return {
    stage: "write", primaryAction: "save_draft", heading: "1. Write the Update",
    explanation: "Save a private draft before adding images. Nothing will be published.", selectedLabel,
    uploadBlocker: "Save a private draft before adding images.",
    scheduleBlocker: "Save and review the draft before scheduling.",
    publishBlocker: "Save and review the draft before publishing.",
  };
  if (input.status === "scheduled") return {
    stage: "scheduled", primaryAction: "open_scheduled", heading: "Scheduled",
    explanation: "This Update remains private until its scheduled Edmonton time.", selectedLabel,
    uploadBlocker: "Return the scheduled Update to draft before changing images.",
    scheduleBlocker: null, publishBlocker: "Withdraw or return this Update to draft before publishing it now.",
  };
  if (input.status === "published") return {
    stage: "published", primaryAction: "open_published", heading: "Published",
    explanation: "This exact Update is public.", selectedLabel,
    uploadBlocker: "Published media cannot be changed silently.", scheduleBlocker: "Published Updates cannot be scheduled.", publishBlocker: null,
  };
  if (input.processingSelectedCount > 0) return {
    stage: "processing", primaryAction: "wait_for_media", heading: "2. Images are processing",
    explanation: "Wait, retry, remove, or deselect the affected image before publishing.", selectedLabel,
    uploadBlocker: null, scheduleBlocker: "Selected images must finish processing.", publishBlocker: "Selected images must finish processing.",
  };
  if (input.sourceReportStatus && input.sourceReportStatus !== "verified") return {
    stage: "verification", primaryAction: "go_to_review", heading: "Verification required",
    explanation: "Complete the private review before releasing this as an Official Update.", selectedLabel,
    uploadBlocker: null, scheduleBlocker: "Locked until this report is Verified.", publishBlocker: "Locked until this report is Verified.",
  };
  if (!input.confirmed) return {
    stage: "preview", primaryAction: "review_preview", heading: "3. Review the exact public preview",
    explanation: "Confirm the exact copy and checked images before release.", selectedLabel,
    uploadBlocker: null, scheduleBlocker: "Review and confirm the exact public preview.", publishBlocker: "Review and confirm the exact public preview.",
  };
  return {
    stage: "ready", primaryAction: "publish_now", heading: "Ready to publish",
    explanation: "Choose Publish now or select a future Edmonton time.", selectedLabel,
    uploadBlocker: null, scheduleBlocker: null, publishBlocker: null,
  };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx tsx --test tests/official-update-workflow.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the model**

```powershell
git add src/shared/official-update-workflow.ts tests/official-update-workflow.test.ts
git commit -m "feat: model guided official update stages"
```

### Task 2: Add the standalone Update store contract and private ledger

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `tests/api-test-kit.ts`
- Modify: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing D1 lifecycle tests**

Add a test that creates a standalone private draft, lists it for Ops, schedules
it, confirms it is absent from `listUpdates()`, publishes it, and confirms one
public record and one audit event per deliberate action:

```ts
test("standalone Official Updates use a private draft-first audited lifecycle", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  const store = new D1DataStore(db);
  const draft = await store.createUpdate(
    { title: "Weather delay", body: "The search is paused near the trail." },
    "staff-publisher"
  );
  assert.equal(draft.status, "draft");
  assert.equal((await store.listUpdates()).items.some((item) => item.id === draft.id), false);
  assert.equal((await store.listOpsUpdates()).items[0]?.status, "draft");

  const scheduled = await store.mutateUpdate(String(draft.id), {
    title: "Weather delay", body: "The search is paused near the trail.",
    mediaIds: [], action: "schedule", scheduledFor: "2099-07-20T15:00:00.000Z",
  }, "staff-publisher");
  assert.equal(scheduled?.status, "scheduled");
  assert.equal((await store.listUpdates()).items.some((item) => item.id === draft.id), false);

  const published = await store.mutateUpdate(String(draft.id), {
    title: "Weather delay", body: "The search is paused near the trail.",
    mediaIds: [], action: "publish_now", scheduledFor: null,
  }, "staff-publisher");
  assert.equal(published?.status, "published");
  assert.equal((await store.listUpdates()).items.filter((item) => item.id === draft.id).length, 1);
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npx tsx --test tests/api-store-integration.test.ts --test-name-pattern "standalone Official Updates"`

Expected: FAIL because `listOpsUpdates` and `mutateUpdate` do not exist and `createUpdate` publishes immediately.

- [ ] **Step 3: Add typed contracts**

Add to `src/server/types.ts` and use the same types in the fake store:

```ts
export interface OfficialUpdateMediaSelection {
  id: string;
  altText: string | null;
  caption: string | null;
}

export interface OfficialUpdateMutation {
  title: string;
  body: string;
  mediaIds: string[];
  mediaSelections?: OfficialUpdateMediaSelection[];
  action: "save_draft" | "schedule" | "publish_now";
  scheduledFor: string | null;
}

listOpsUpdates(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
getOpsUpdateDetail(id: string, actorSubject: string): Promise<Record<string, unknown> | null>;
createUpdate(input: { title: string; body: string }, actorSubject: string): Promise<Record<string, unknown>>;
mutateUpdate(id: string, input: OfficialUpdateMutation, actorSubject: string): Promise<Record<string, unknown> | null>;
withdrawUpdate(id: string, actorSubject: string): Promise<Record<string, unknown> | null>;
addUpdateUploads(id: string, media: StoredMedia[], actorSubject: string): Promise<Record<string, unknown> | null>;
getUpdateMedia(id: string, mediaId: string, actorSubject: string): Promise<{ key: string; contentType: string } | null>;
removeUpdateUpload(id: string, mediaId: string, actorSubject: string): Promise<Record<string, unknown> | null>;
```

- [ ] **Step 4: Implement draft creation and the private ledger**

Change `createUpdate` to insert `status = 'draft'`, `published_at = created_at`,
`publisher_name = 'A representative from SebaHub'`, and audit
`update.draft_created`. Add `listOpsUpdates` that selects all standalone
statuses, joins upload counts, and returns private Ops fields only after staff
authorization at the route:

```sql
SELECT u.id, u.title, u.body, u.publisher_name, u.status, u.published_at,
       u.scheduled_for, u.created_at, u.updated_at,
       COUNT(upload.id) AS upload_count
FROM official_updates u
LEFT JOIN official_update_uploads upload ON upload.update_id = u.id
WHERE u.source_report_id IS NULL AND u.created_at <= ?
GROUP BY u.id
ORDER BY u.updated_at DESC, u.id DESC
LIMIT ?
```

Map every record to `{ id, title, body, publisherName, status, publishedAt,
scheduledFor, createdAt, updatedAt, uploadCount }` and return the normal `Page`.

Add `getOpsUpdateDetail` for a standalone Update ID. It returns the same core
fields plus private upload rows `{ id, contentType, size, status, altText,
caption, position }`, and audits `update.detail_viewed`. This is the source used
by **Continue editing**; list responses do not need to carry every upload.

- [ ] **Step 5: Implement standalone mutation and withdrawal**

`mutateUpdate` must load only `source_report_id IS NULL`, validate the desired
status, validate selected ready Update-owned derivatives, require alt text for
every selected image, atomically replace `official_update_uploaded_media`, and
append one of `update.draft_saved`, `update.scheduled`, or `update.published`.
Use this status mapping:

```ts
const desiredStatus = input.action === "save_draft"
  ? "draft"
  : input.action === "schedule"
    ? "scheduled"
    : "published";
const publishedAt = desiredStatus === "scheduled" ? input.scheduledFor! : timestamp;
```

`withdrawUpdate` must update only a scheduled or published standalone Update to
`withdrawn`, clear no private uploads, remove its selected public media rows,
and audit `update.withdrawn`. Repeated withdrawal returns the same withdrawn
record without a duplicate audit event.

Enforce these standalone transitions: Draft may save, schedule or publish;
Scheduled may return to Draft, reschedule or publish now; Published may only be
withdrawn; Withdrawn remains read-only. Reject every other transition with
`409 update_state_invalid` and leave media selections unchanged.

- [ ] **Step 6: Mirror behavior in `FakeStore`**

Implement the same draft, list, mutate and withdrawal state transitions in
`tests/api-test-kit.ts`. Keep `listUpdates()` public-only and strip `status`,
`scheduledFor`, private uploads and audit fields from its projection.

- [ ] **Step 7: Run the focused D1 and type tests**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts --test-name-pattern "standalone Official Updates"
npm run typecheck:worker
npm run typecheck:tests
```

Expected: focused lifecycle PASS; worker and test typechecks PASS.

- [ ] **Step 8: Commit the store lifecycle**

```powershell
git add src/server/types.ts src/server/d1-store.ts tests/api-test-kit.ts tests/api-store-integration.test.ts
git commit -m "feat: add private standalone update lifecycle"
```

### Task 3: Generalize Update-owned media operations

**Files:**
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/types.ts`
- Modify: `tests/api-test-kit.ts`
- Modify: `tests/api-store-integration.test.ts`
- Modify: `tests/api-public.test.ts`

- [ ] **Step 1: Write failing ownership and limit tests**

```ts
test("Update-owned uploads are private, capped at three, and scoped by Update ID", async (t) => {
  const db = await createOperatorAlertDatabase(t);
  const store = new D1DataStore(db);
  const first = await store.createUpdate({ title: "First", body: "Private" }, "staff-a");
  const second = await store.createUpdate({ title: "Second", body: "Private" }, "staff-a");
  const ready = (id: string) => ({
    id,
    key: `private/official_update/${id}/original.jpg`,
    contentType: "image/jpeg",
    size: 1024,
    status: "ready" as const,
  });
  await store.addUpdateUploads(String(first.id), [ready("upload-a")], "staff-a");
  await db.prepare(
    "UPDATE official_update_uploads SET derivative_object_key = ?, status = 'ready' WHERE id = ?"
  ).bind("derivatives/upload-a.webp", "upload-a").run();
  assert.ok(await store.getUpdateMedia(String(first.id), "upload-a", "staff-a"));
  assert.equal(await store.getUpdateMedia(String(second.id), "upload-a", "staff-a"), null);
  await assert.rejects(
    store.addUpdateUploads(String(first.id), [ready("b"), ready("c"), ready("d")], "staff-a"),
    /no more than three/i
  );
  assert.equal((await store.removeUpdateUpload(String(first.id), "upload-a", "staff-a"))?.status, "deleted");
  assert.equal(await store.getUpdateMedia(String(first.id), "upload-a", "staff-a"), null);
  await store.addUpdateUploads(String(first.id), [ready("b"), ready("c"), ready("d")], "staff-a");
  assert.equal((await store.listUpdates()).items.some((item) => item.id === first.id), false);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `npx tsx --test tests/api-store-integration.test.ts --test-name-pattern "Update-owned uploads"`

Expected: FAIL because the generic media methods are not implemented.

- [ ] **Step 3: Implement generic media methods and retain report facades**

Move the current insert and private-derivative lookup to `addUpdateUploads` and
`getUpdateMedia`, both scoped by `official_updates.id`. Keep
`addReportUpdateUploads` and `getReportUpdateMedia` as thin lookups from
`source_report_id` to Update ID followed by the generic method.

Add `removeUpdateUpload` to mark an Update-owned upload `deleted`, remove any
private selection row, and audit the action. It may operate only while the
Update is a draft. Failed, rejected and deleted uploads do not count toward the
three-image limit, allowing an operator to remove a failed file and retry.

Update public `listUpdates()` media projection to collect IDs for every
selected public Update, not only report-sourced Updates. Continue querying
`official_update_media` for report evidence and
`official_update_uploaded_media` for Update-owned images, then include the
resulting `media` array on both standalone and report Update responses. This is
what makes standalone attached images appear publicly after release.

The insertion guard remains:

```ts
if (media.length < 1 || media.length > 3 || Number(update.upload_count) + media.length > 3) {
  throw new ApiError(422, "validation_failed", "An Official Update can have no more than three direct uploads.");
}
```

Audit standalone uploads as `update.media_uploaded` targeting
`official_update`; retain the existing report audit target for the facade.

- [ ] **Step 4: Run focused and existing report-upload tests**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts --test-name-pattern "Update-owned uploads|direct Official Update"
npx tsx --test tests/api-auth.test.ts --test-name-pattern "direct Official Update uploads"
npx tsx --test tests/api-public.test.ts --test-name-pattern "standalone Official Update media"
```

Expected: generic, compatibility, and standalone public-media tests PASS.

- [ ] **Step 5: Commit the generic media boundary**

```powershell
git add src/server/types.ts src/server/d1-store.ts tests/api-test-kit.ts tests/api-store-integration.test.ts tests/api-public.test.ts
git commit -m "refactor: scope official update media by update id"
```

### Task 4: Add authenticated standalone publishing APIs

**Files:**
- Modify: `src/server/app.ts`
- Modify: `tests/api-auth.test.ts`

- [ ] **Step 1: Write failing API lifecycle tests**

Cover these routes and assertions:

```ts
const headers = { authorization: "Bearer staff-token", origin: "https://www.timlostsomething.com" };
const created = await app.request("https://www.timlostsomething.com/api/v1/ops/updates", {
  method: "POST", ...json({ title: "Trail note", body: "Private draft" }, headers),
});
assert.equal(created.status, 201);
const draft = (await responseJson(created)).data;
assert.equal(draft.status, "draft");

const ledger = await app.request("https://www.timlostsomething.com/api/v1/ops/updates", { headers });
assert.equal(ledger.status, 200);
assert.equal((await responseJson(ledger)).data[0].id, draft.id);

const published = await app.request(`https://www.timlostsomething.com/api/v1/ops/updates/${draft.id}/publish`, {
  method: "POST",
  ...json({ title: "Trail note", body: "Reviewed public copy", mediaIds: [], action: "publish_now", scheduledFor: null }, headers),
});
assert.equal(published.status, 200);
```

Also assert anonymous requests return `401`, cross-origin writes fail, a fourth
upload returns `422`, DELETE removes only media owned by that draft, foreign
media returns `404`, invalid schedules return `422`, and draft media never
appears in `/api/v1/updates` or public media URLs.

- [ ] **Step 2: Run focused API tests and verify RED**

Run: `npx tsx --test tests/api-auth.test.ts --test-name-pattern "standalone Official Update"`

Expected: FAIL because GET, media, publish and withdrawal routes do not exist and POST still has the old contract.

- [ ] **Step 3: Reuse the strict publication parser**

Use the existing complete `publicationInput(body)` parser for both standalone
and report mutations. Change only its forbidden-field error text from
`Report publication fields are derived from the private report.` to
`Official Update fields are invalid for this action.` The existing allowlist,
unique media IDs, ordered metadata, maximum three images, action validation and
future-time validation remain unchanged.

- [ ] **Step 4: Add the update-scoped routes**

Implement:

```ts
app.get("/api/v1/ops/updates", async (c) => {
  await requireStaff(deps, c.req.raw);
  const result = await deps.store.listOpsUpdates({
    limit: queryLimit(c.req.query("limit")),
    cursor: c.req.query("cursor") ?? null,
  });
  return success(c, result.items, 200, { nextCursor: result.nextCursor });
});

app.post("/api/v1/ops/updates", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const { body } = await requestBody(c.req.raw);
  return success(c, await deps.store.createUpdate({
    title: requiredString(body, "title", { max: 200 }),
    body: requiredString(body, "body", { max: 10_000 }),
  }, staff.subject), 201);
});

app.get("/api/v1/ops/updates/:id", async (c) => {
  const staff = await requireStaff(deps, c.req.raw);
  const update = await deps.store.getOpsUpdateDetail(c.req.param("id"), staff.subject);
  if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
  return success(c, update);
});

app.post("/api/v1/ops/updates/:id/media", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const { files } = await requestBody(c.req.raw);
  await validateImages(files);
  if (files.length < 1 || files.length > 3) {
    throw new ApiError(422, "validation_failed", "Choose one to three Update images.");
  }
  const media = await deps.uploads.save(files, { kind: "official_update", subject: staff.subject });
  const update = await deps.store.addUpdateUploads(c.req.param("id"), media, staff.subject);
  if (!update) throw new ApiError(404, "update_not_found", "Official Update draft not found.");
  return success(c, update, 201);
});

app.get("/api/v1/ops/updates/:id/media/:mediaId", async (c) => {
  const staff = await requireStaff(deps, c.req.raw);
  const authorized = await deps.store.getUpdateMedia(c.req.param("id"), c.req.param("mediaId"), staff.subject);
  if (!authorized) throw new ApiError(404, "update_media_not_found", "Update image not found.");
  const object = await deps.uploads.read(authorized.key);
  if (!object || !validImageTypes.has(authorized.contentType) || !validImageTypes.has(object.contentType)) {
    throw new ApiError(404, "update_media_not_found", "Update image not found.");
  }
  return new Response(object.body, { headers: {
    "content-type": object.contentType, "cache-control": "private, no-store",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
  }});
});

app.delete("/api/v1/ops/updates/:id/media/:mediaId", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const removed = await deps.store.removeUpdateUpload(c.req.param("id"), c.req.param("mediaId"), staff.subject);
  if (!removed) throw new ApiError(404, "update_media_not_found", "Update image not found.");
  return success(c, removed);
});

app.post("/api/v1/ops/updates/:id/publish", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const { body, files } = await requestBody(c.req.raw, requireJsonMediaType(c.req.raw));
  if (files.length) throw new ApiError(415, "unsupported_media_type", "Update publication accepts JSON only.");
  const update = await deps.store.mutateUpdate(c.req.param("id"), publicationInput(body), staff.subject);
  if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
  return success(c, update);
});

app.post("/api/v1/ops/updates/:id/withdraw", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const update = await deps.store.withdrawUpdate(c.req.param("id"), staff.subject);
  if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
  return success(c, update);
});
```

The media response headers match report evidence: private `no-store`,
`nosniff`, sandbox CSP and same-origin resource policy. All writes call
`sameOrigin` and all routes call `requireStaff`.

- [ ] **Step 5: Run API and public privacy tests**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts --test-name-pattern "standalone Official Update|direct Official Update uploads"
npx tsx --test tests/api-public.test.ts
npx tsx --test tests/api-security.test.ts
```

Expected: all selected tests PASS; public responses contain no draft records or private object keys.

- [ ] **Step 6: Commit the API**

```powershell
git add src/server/app.ts tests/api-auth.test.ts
git commit -m "feat: expose guided standalone update API"
```

### Task 5: Build the three-stage standalone composer and ledger

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs`

- [ ] **Step 1: Write failing semantic-contract tests**

Assert the page contains numbered stages, a private save action, update-owned
file input, selected counter, exact preview, schedule/publish actions, ledger
retry, and an announced result:

```js
assert.match(html, /1\. Write the Update/i);
assert.match(html, /Save draft &amp; continue/i);
assert.match(html, /data-update-files/);
assert.match(html, /data-update-selected-count/);
assert.match(html, /data-update-public-preview/);
assert.match(html, /data-update-save-draft/);
assert.match(html, /data-update-publish-now/);
assert.match(html, /data-update-schedule/);
assert.match(html, /data-update-ledger-retry/);
assert.match(html, /id="official-update-result"[^>]*aria-live="polite"/);
```

Add behavior tests for initial guidance, three selected images, processing
blockers, reorder/lead-image behavior, Edmonton schedule labels, and the ledger
states and actions.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts --test-name-pattern "standalone Update"
```

Expected: FAIL because the staged composer and ledger controls are absent.

- [ ] **Step 3: Replace the standalone form markup**

Use one `<form id="official-update-form">` with three labelled `<section>`
stages. Stage 1 contains title/body and **Save draft & continue**. Stage 2
contains a disabled file input until a draft exists, **Prepare & upload
images**, a `0 of 3 images selected` status, and media cards. Stage 3 contains
the exact preview, one confirmation checkbox, Edmonton schedule field,
**Schedule Official Update**, and **Publish Official Update now**.

The ledger table includes State, Headline, When and Action, plus a visible
**Retry loading Updates** control in its unavailable state.

- [ ] **Step 4: Implement standalone composer state**

Add a focused client state object rather than scattering new globals:

```ts
interface StandaloneUpdateEditor {
  updateId: string | null;
  status: OfficialUpdateStatus | null;
  uploads: OpsUpdateUpload[];
  dirty: boolean;
  busy: boolean;
}

const standaloneUpdateEditor: StandaloneUpdateEditor = {
  updateId: null, status: null, uploads: [], dirty: false, busy: false,
};
```

Implement `loadOpsUpdates`, `loadOpsUpdateDetail`, `renderOpsUpdateLedger`, `renderStandaloneUpdateUploads`,
`renderStandaloneUpdatePreview`, and `syncStandaloneUpdateGuidance`. Use
`officialUpdateGuidance` for headings, blockers and the single primary action.
**Continue editing** loads `/api/v1/ops/updates/:id`, restores the draft copy
and private upload cards, then focuses the first incomplete stage.

- [ ] **Step 5: Reuse browser preparation for up to three images**

Call `prepareReportImages` before sending `FormData` to
`/api/v1/ops/updates/:id/media`. Preserve title/body on errors. Show each
file's preparation/upload/processing/ready failure. Direct uploads start
unchecked; enabling **Include in this Update** enables required alt text.

Use DELETE `/api/v1/ops/updates/:id/media/:mediaId` for **Remove image**. For a
failed image, label the same action **Remove and retry** and return focus to the
file picker after removal.

Each selected ready card includes Alt text, optional Caption, **Move earlier**
and **Move later**. The first selected card is labelled **Lead image**. Reorder
buttons change the ordered `mediaIds` and `mediaSelections` arrays and refresh
the exact preview without publishing.

- [ ] **Step 6: Implement save, schedule, publish and withdrawal actions**

Create the draft with POST `/ops/updates`, then mutate with
`/ops/updates/:id/publish`. Disable only the active action while its request is
running. Use exact success language:

```ts
"Draft saved privately. Nothing was published."
"Images uploaded privately. Select the images to include."
`Official Update scheduled for ${formatOpsTime(scheduledFor)}.`
"Official Update published."
```

Add a public link after publishing. Add `beforeunload` only while `dirty` is
true, and clear it after a successful save.

Ledger actions follow state: Draft has **Continue editing**; Scheduled has
**Reschedule**, **Publish now**, and separately styled **Withdraw**; Published
has **Open public Update** and separately styled **Withdraw**; Withdrawn is
read-only. Rescheduling reopens the same Update rather than creating another.

- [ ] **Step 7: Add responsive stage and ledger styling**

Add `.ops-publish-stage`, `.ops-publish-stage__status`,
`.ops-publish-stage[aria-current="step"]`, `.ops-update-ledger-action`, and
`.ops-action-blocker`. At the existing mobile breakpoint, use one column,
full-width 44-pixel controls and no horizontal scrolling.

- [ ] **Step 8: Run focused UI, client typecheck and build**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts tests/report-image-preparation.test.ts
npm run typecheck:client
npm run build
```

Expected: all commands PASS and `dist/ops.html` contains the three stages.

- [ ] **Step 9: Commit the standalone workspace**

```powershell
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-behavior.test.ts tests/ops-board-ui-contract.test.mjs
git commit -m "feat: guide operators through official updates"
```

### Task 6: Clarify the report-derived public outcome workflow

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs`

- [ ] **Step 1: Write failing guidance and selection tests**

Add behavior assertions that a Reviewing report may save its Update draft and
upload privately but cannot schedule or publish, that the blocker names
Verified, that **Go to Review workflow** focuses the state panel, and that
submitted evidence plus direct uploads share one `N of 3` counter.

```ts
assert.equal(reportPublicationActions(reviewing).canSaveDraft, true);
assert.equal(reportPublicationActions(reviewing).canPublish, false);
assert.match(reportPublicationActions(reviewing).publishBlocker, /Verified/);
assert.equal(reportSelectedMediaCount(["evidence-1", "upload-1"]), "2 of 3 images selected");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/ops-board-ui-behavior.test.ts --test-name-pattern "public outcome|selected media counter|Go to Review"`

Expected: FAIL because the shared guidance and combined counter are absent.

- [ ] **Step 3: Make destinations explicit and progressive**

Keep the three destinations but label them with the approved descriptions:

```html
<strong>Keep private</strong><span>No part of this report is published.</span>
<strong>Publish to Case Notes</strong><span>A reviewed community observation, not an Official Update.</span>
<strong>Prepare an Official Update</strong><span>The official public source; release requires a Verified report.</span>
```

Show the current stage's primary action. Keep later actions visible only with
their inline blocker. Add `data-report-go-to-review` and focus/scroll the Review
Workflow heading when activated.

- [ ] **Step 4: Unify media selection feedback**

Count checked ready report evidence and direct uploads together. Prevent the
fourth selection immediately, restore the checkbox to unchecked, and announce
`Official Updates can include no more than three images.` Preserve the
server-side maximum as authoritative.

- [ ] **Step 5: Preserve exact publication safety**

Continue requiring the exact preview confirmation for Case Notes and Official
Updates. Do not preselect images. Keep save-draft available before verification
and keep schedule/publish disabled in UI and rejected by API until Verified.

- [ ] **Step 6: Run report workflow regression tests**

Run:

```powershell
npx tsx --test tests/ops-board-ui-behavior.test.ts
npx tsx --test tests/report-workflow.test.ts
npx tsx --test tests/api-auth.test.ts --test-name-pattern "report Update drafts|publication-controlled fields|direct Official Update uploads"
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the report guidance**

```powershell
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-behavior.test.ts tests/ops-board-ui-contract.test.mjs
git commit -m "fix: make report publication prerequisites obvious"
```

### Task 7: Apply the Ops-wide clarity and mobile standard

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing cross-Ops guidance contracts**

For Command Desk, Updates, Reports, Moderation, Zones, Rules, Players, Access
and Audit, assert one status region and one retry/recovery affordance for any
remote source. Assert every disabled `.ops-button` either carries
`aria-describedby` pointing to visible blocker text or is explicitly marked
read-only with an accessible label.

```js
for (const view of ["command", "updates", "reports", "moderation", "zones", "rules", "subscribers", "access", "audit"]) {
  assert.match(html, new RegExp(`data-view-panel="${view}"[\\s\\S]*?role="status"`));
}
assert.doesNotMatch(html, /<button(?![^>]*(?:aria-describedby|data-readonly-control))[^>]*disabled[^>]*>/i);
```

- [ ] **Step 2: Run contracts and verify RED**

Run: `node --test tests/ops-board-ui-contract.test.mjs`

Expected: FAIL on unexplained disabled controls and missing recovery/status landmarks.

- [ ] **Step 3: Add shared guidance markup and renderer**

Use one reusable HTML structure for actionable panels:

```html
<div class="ops-workflow-guide" role="status" aria-live="polite">
  <strong data-guide-state>Current state</strong>
  <span data-guide-next>Recommended next action</span>
</div>
```

Add `setOpsGuide(root, { state, next, blocker, kind })` in `ops.ts`. Replace
generic `Source not loaded` text with distinct empty, permission, and retryable
source-failure states. Do not change the screens' business rules.

- [ ] **Step 4: Explain read-only and destructive controls**

Label intentionally read-only switch controls with `data-readonly-control` and
visible text such as `Read-only status; change requires a configured feature
control.` Separate withdrawal, rejection, suspension, revocation and delete
actions from primary action rows and retain explicit confirmation.

- [ ] **Step 5: Finish responsive dialog behavior**

At widths below the two-column safe breakpoint, force the report dialog to one
column in document order and one vertical scroll container. Make the Review
Workflow fully visible before Public Outcome, keep action rows in flow, and
remove nested max-height/overflow rules that hide the bottom status controls.

Verify close controls use the visible/accessible label `Close review` and focus
returns to the invoking report row.

- [ ] **Step 6: Run UI contracts and responsive static checks**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs tests/navigation-geometry.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts
npm run typecheck:client
npm run build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the Ops clarity pass**

```powershell
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts
git commit -m "fix: explain operator states and recovery actions"
```

### Task 8: Complete regression verification and validation handoff

**Files:**
- Modify: `docs/operations/2026-07-18-private-report-workflow-validation.md`

- [ ] **Step 1: Run the full automated gate**

Run:

```powershell
npm test
npm run typecheck
npm run legal:verify
npm run build
git diff --check
```

Expected: every command exits `0`; no warning represents a privacy, type,
authorization or build failure.

- [ ] **Step 2: Run privacy and preservation gates**

Run:

```powershell
node --test tests/privacy-output.test.mjs tests/public-output-privacy-scan.test.mjs tests/campaign-shell-preservation.test.mjs tests/build-isolation.test.mjs
npx tsx --test tests/api-security.test.ts tests/api-environment-guard.test.ts tests/api-production-snapshot.test.ts
```

Expected: all tests PASS; production snapshot remains GET-only and normal validation mutations remain disposable.

- [ ] **Step 3: Deploy validation only**

Use the repository's existing validation deployment command/configuration. Do
not deploy the production Pages project or bind production D1/R2 for writes.
Record the immutable deployment identifier and validation URL.

- [ ] **Step 4: Exercise the owner validation script**

Using validation records only, verify:

1. Save a standalone private draft and leave/reopen it from the ledger.
2. Upload zero, one and three images, including one supported source over 20 MB.
3. Confirm uploaded media starts private and unchecked.
4. Schedule an Update and prove it is absent from the public feed before due.
5. Publish an Update and open its public result.
6. Open a Reviewing report, save a draft, and observe the Verified blocker.
7. Move the report to Verified, select submitted and direct images together,
   and publish or schedule the exact preview.
8. Publish the same report to Case Notes and confirm it remains visibly distinct.
9. Test dialog scrolling at desktop 100%, Windows 125% and 150%, and narrow mobile width.
10. Use keyboard-only navigation and confirm status announcements and focus restoration.

- [ ] **Step 5: Record results and known follow-ups**

Append the release hash, validation URL, commands, pass/fail evidence, tested
browsers/viewports, and any explicitly deferred wishlist items to
`docs/operations/2026-07-18-private-report-workflow-validation.md`. Do not record
credentials, private report contents or personal information.

- [ ] **Step 6: Commit the validation record**

```powershell
git add docs/operations/2026-07-18-private-report-workflow-validation.md
git commit -m "docs: record guided publishing validation"
```

- [ ] **Step 7: Stop before production**

Report the validation URL and exact remaining production checks to Murphy.
Production promotion requires a separate explicit approval and a protected
production-data baseline comparison.
