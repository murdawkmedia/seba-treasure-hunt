# Shared Image, Reply Moderation and Public Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every existing image uploader the same 20/50 MB preparation flow, constrain immediate public replies, add audited Ops hide/restore moderation, and display each adult hunter's optional custom public name consistently.

**Architecture:** Reuse the tested browser image preparation and existing D1 rate limiter instead of adding parallel policies. Add a shared server-owned public-identity resolver, project only privacy-safe labels into the public board, and extend the existing moderation namespace over the reply/flag columns already present in D1. Keep all ordinary validation writes isolated from production and require a separate owner decision for production promotion.

**Tech Stack:** Cloudflare Pages Functions and Workers, Hono, D1, R2, Clerk, Turnstile, TypeScript, static HTML/CSS, Node test runner, Miniflare, esbuild.

---

## File Structure

- `src/shared/public-identity.ts`: one privacy-safe adult/minor public-label resolver used by client account presentation and D1 projections.
- `src/shared/report-image-limits.ts`: existing canonical decimal image limits; no second Case Note policy.
- `src/client/report-image-preparation.ts`: existing shared browser decode/optimization implementation.
- `src/client/account.ts`: prefer an optional custom public name in the signed-in account chip.
- `src/client/board.ts`: prepare Case Note images, submit prepared files, render public identities and show bounded reply errors.
- `clue-board.html`: shared upload-limit copy and accessible preparation status.
- `src/server/types.ts`: datastore contracts for moderation replies and flags.
- `src/server/d1-store.ts`: privacy-safe board identity projections plus reply/flag listing and audited soft moderation.
- `src/server/app.ts`: 5-per-10-minute reply rule and Staff-only reply/flag moderation endpoints.
- `src/client/ops.ts`: normalize, render and mutate recent public replies and flags.
- `ops.html`: Public Replies and Received Flags tables inside the existing Moderation Queue.
- `css/board.css`, `css/ops.css`: preparation, rate-limit and moderation states with keyboard-visible controls.
- `tests/public-identity.test.ts`: adult fallback, custom public name and minor privacy rules.
- `tests/board-client.test.ts`: Case Note prepared-payload and public render contracts.
- `tests/account-client.test.ts`: account-chip custom-name preference.
- `tests/api-auth.test.ts`: reply limits, authorization and Staff moderation endpoints.
- `tests/api-store-integration.test.ts`: D1 public projections, flags, soft hide, restore and audit persistence.
- `tests/ops-board-ui-behavior.test.ts`: Ops normalization, escaping, controls and state rendering.
- `tests/ops-board-ui-contract.test.mjs`, `tests/hunter-ui-pages.test.mjs`: accessible markup and upload-copy contracts.

The existing schema already contains reply `published`/`hidden` states,
moderator columns, flag resolution columns and audit events. Do not create a
migration unless a focused integration test proves those deployed columns
cannot represent an approved requirement.

## Checkpoint 1: Shared Identity and Image Preparation

### Task 1: Add the canonical privacy-safe public identity resolver

**Files:**
- Create: `src/shared/public-identity.ts`
- Modify: `src/client/account.ts`
- Modify: `src/server/d1-store.ts`
- Test: `tests/public-identity.test.ts`
- Test: `tests/account-client.test.ts`
- Test: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing identity tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { publicHunterIdentity } from "../src/shared/public-identity";

test("prefers an adult custom public name and preserves the generated fallback", () => {
  assert.equal(publicHunterIdentity({
    participationBasis: "adult",
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
  }), "Nancy & Ron");
  assert.equal(publicHunterIdentity({
    participationBasis: "adult",
    publicDisplayName: "",
    publicHandle: "Hunter 43BA",
  }), "Hunter 43BA");
});

test("never exposes a minor custom name or generated handle", () => {
  assert.equal(publicHunterIdentity({
    participationBasis: "minor_guardian_permission",
    publicDisplayName: "Private Child Name",
    publicHandle: "Hunter CHILD",
  }), "Young Hunter");
});
```

Extend `tests/account-client.test.ts` so `campaignAccountModel()` returns
`Nancy & Ron` when both `publicDisplayName` and `publicHandle` exist. Add an
integration fixture containing adult custom, adult fallback and minor profiles;
assert Case Note and reply author labels match the resolver and serialized
public output contains neither minor source string.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx tsx --test tests/public-identity.test.ts tests/account-client.test.ts tests/api-store-integration.test.ts
```

Expected: FAIL because `src/shared/public-identity.ts` does not exist and the
current account/D1 projections use only `public_handle`.

- [ ] **Step 3: Implement the minimal resolver and account preference**

```ts
export interface PublicIdentityProfile {
  participationBasis?: string | null;
  publicDisplayName?: string | null;
  publicHandle?: string | null;
}

export function publicHunterIdentity(profile: PublicIdentityProfile): string {
  if (profile.participationBasis === "minor_guardian_permission") return "Young Hunter";
  return profile.publicDisplayName?.trim() || profile.publicHandle?.trim() || "Community Hunter";
}

export function privateAccountIdentity(profile: PublicIdentityProfile): string {
  return profile.publicDisplayName?.trim() || profile.publicHandle?.trim() || "Hunter";
}
```

Use `privateAccountIdentity()` in `campaignAccountModel()`. In D1 `listBoard()`,
select each note/reply author's `participation_basis`, `public_display_name` and
`public_handle`, then use `publicHunterIdentity()` while mapping rows. Never
return those source columns from the public API.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npx tsx --test tests/public-identity.test.ts tests/account-client.test.ts tests/api-store-integration.test.ts
```

Expected: PASS with the minor source strings absent from serialized board data.

- [ ] **Step 5: Commit the identity slice**

```powershell
git add src/shared/public-identity.ts src/client/account.ts src/server/d1-store.ts tests/public-identity.test.ts tests/account-client.test.ts tests/api-store-integration.test.ts
git commit -m "feat: unify privacy-safe hunter identity"
```

### Task 2: Reuse shared image preparation in Case Notes

**Files:**
- Modify: `src/client/board.ts`
- Modify: `clue-board.html`
- Modify: `css/board.css`
- Test: `tests/board-client.test.ts`
- Test: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Write failing Case Note preparation tests**

Add a pure payload helper contract to `tests/board-client.test.ts`:

```ts
const form = document.createElement("form");
form.innerHTML = `<textarea name="body">A public observation.</textarea><input name="images" type="file">`;
const source = imageFile(24_000_000, "large.jpg");
const upload = imageFile(2_000_000, "large.webp", "image/webp");
const payload = buildCaseNoteFormData(form, [{ source, upload, optimized: true }]);
assert.deepEqual((payload.getAll("images") as File[]).map((file) => [file.name, file.size]), [
  ["large.webp", 2_000_000],
]);
```

Assert `validateFieldNote()` accepts an 11 MB JPEG after image validation moves
to `prepareReportImages()`. In `tests/hunter-ui-pages.test.mjs`, require copy
matching “Photos up to 20 MB upload directly”, “larger photos up to 50 MB” and
an `aria-live` preparation status tied to `note-images`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx tsx --test tests/board-client.test.ts
node --test tests/hunter-ui-pages.test.mjs
```

Expected: FAIL because Case Notes still reject files above 10 MB and submit the
input's original `FormData`.

- [ ] **Step 3: Add the prepared-payload helper**

```ts
import {
  prepareReportImages,
  ReportImagePreparationError,
  type PreparedReportImage,
} from "./report-image-preparation";

export function buildCaseNoteFormData(
  form: HTMLFormElement,
  prepared: readonly PreparedReportImage[],
): FormData {
  const data = new FormData(form);
  data.delete("images");
  for (const item of prepared) data.append("images", item.upload, item.upload.name);
  return data;
}
```

Remove the Case Note-only `maxImageBytes` check. Keep body, stop and three-file
count validation; let the shared preparation module validate types, 50 MB
sources, 20 MB prepared files and 30 MB prepared total.

- [ ] **Step 4: Prepare on selection and preserve text across failures**

Maintain `preparedNoteImages`, an `AbortController` and the active preparation
promise. On input change, abort stale work, call `prepareReportImages(files)`,
render checking/optimizing/ready messages in `#note-file-list`, and associate
filename-specific failures with the image field. Disable submission while
preparation is pending or failed.

At submit, await the active preparation, call `buildCaseNoteFormData()`, then
add Turnstile and send the prepared payload. Reset prepared state only after a
successful submission or explicit file change; keep the observation text and
stop selection after preparation/upload failure.

- [ ] **Step 5: Update accessible upload guidance**

```html
<p class="control-hint" id="note-images-help">
  Up to 3 JPEG, PNG or WebP photos. Photos up to 20 MB upload directly; larger
  photos up to 50 MB will be optimized on this device. Prepared uploads may
  total up to 30 MB. Location metadata is removed before publication.
</p>
<p id="note-image-status" class="form-result" role="status" aria-live="polite"></p>
```

Set `aria-describedby="note-images-help note-image-status"` on the input and
use visible error text plus `aria-invalid`, not colour alone.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
npx tsx --test tests/report-image-preparation.test.ts tests/report-image-limits.test.ts tests/board-client.test.ts
node --test tests/hunter-ui-pages.test.mjs tests/ops-board-ui-contract.test.mjs
```

Expected: PASS, including an 11 MB direct Case Note file and a prepared 24 MB
source fixture.

- [ ] **Step 7: Commit the upload slice**

```powershell
git add src/client/board.ts clue-board.html css/board.css tests/board-client.test.ts tests/hunter-ui-pages.test.mjs
git commit -m "feat: share large-image preparation with Case Notes"
```

## Checkpoint 2: Reply Abuse Protection and Moderation Data

### Task 3: Tighten reply rate limiting

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/client/board.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/board-client.test.ts`

- [ ] **Step 1: Write failing API rate-limit tests**

```ts
const replies = await Promise.all(Array.from({ length: 6 }, (_, index) =>
  app.request(`https://www.timlostsomething.com/api/v1/board/notes/${noteId}/replies`, {
    method: "POST",
    ...json({ body: `Bounded public reply ${index + 1}` }, {
      ...hunterHeaders,
      "cf-connecting-ip": "203.0.113.44",
    }),
  })
));
assert.deepEqual(replies.map((response) => response.status), [201, 201, 201, 201, 201, 429]);
assert.equal(replies[5]?.headers.get("retry-after"), "600");
assert.equal(store.replies.length, 5);
assert.deepEqual(rateLimits.seen.at(0), {
  scope: "reply",
  identifiers: ["ip:203.0.113.44", "subject:hunter-1"],
  limit: 5,
  windowSeconds: 600,
});
```

Use a real `D1RateLimiter` integration case to prove shared subject across new
IPs and shared IP across new subjects cannot bypass the limit.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/api-rate-limit.test.ts tests/board-client.test.ts
```

Expected: FAIL because the API currently supplies `limit: 20` for replies.

- [ ] **Step 3: Apply the approved reply rule and bounded client error**

```ts
const rateLimitRules = {
  // existing rules unchanged
  reply: { limit: 5, windowSeconds: 600 },
} as const;
```

Keep server order as authentication, rate limit, feature/participation checks,
Turnstile and content validation. When the board client receives HTTP 429,
read `Retry-After` and show “You’ve reached the reply limit. Try again in about
10 minutes.” Do not append an optimistic reply.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/api-rate-limit.test.ts tests/board-client.test.ts
```

Expected: PASS with five stored replies and the sixth rejected.

- [ ] **Step 5: Commit the abuse-protection slice**

```powershell
git add src/server/app.ts src/client/board.ts tests/api-auth.test.ts tests/api-rate-limit.test.ts tests/board-client.test.ts
git commit -m "fix: constrain public Case Note replies"
```

### Task 4: Add D1 reply and flag moderation operations

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `tests/api-test-kit.ts`
- Test: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing D1 moderation tests**

Create one approved Case Note, two published replies and one received flag.
Assert the moderation projection includes public label, parent context, state
and flag count. Then exercise hide and restore:

```ts
const hidden = await store.moderateReply(replyId, "hide", "Spam burst", "staff-1");
assert.equal(hidden?.status, "hidden");
assert.equal((await store.listBoard(null)).items[0]?.replies.length, 1);
assert.equal((await store.listModerationReplies()).items.find((item) => item.id === replyId)?.status, "hidden");

const restored = await store.moderateReply(replyId, "restore", "False positive", "staff-2");
assert.equal(restored?.status, "published");
assert.equal((await store.listBoard(null)).items[0]?.replies.length, 2);
```

Assert hide resolves received flags, dismiss leaves the target published, each
mutation creates exactly one audit event with private reason, and repeating a
transition from the wrong state returns `null` without another audit.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts
```

Expected: FAIL because reply/flag moderation datastore methods do not exist.

- [ ] **Step 3: Add explicit datastore contracts**

```ts
listModerationReplies(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
listContentFlags(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
moderateReply(
  id: string,
  action: "hide" | "restore",
  reason: string,
  actorSubject: string,
): Promise<Record<string, unknown> | null>;
moderateContentFlag(
  id: string,
  action: "dismiss" | "hide_target",
  reason: string,
  actorSubject: string,
): Promise<Record<string, unknown> | null>;
```

Mirror the methods in `FakeStore` with public-output and audit behavior so API
tests exercise the same contract.

- [ ] **Step 4: Implement bounded moderation projections**

`listModerationReplies()` selects recent `published` and `hidden` replies,
joins the parent approved Case Note, waypoint metadata and author profile, and
returns only the resolved public identity plus aggregate flag counts.
`listContentFlags()` returns received/reviewing flags with target kind, target
public excerpt, public identity and current target state; it never returns the
flag reporter subject.

- [ ] **Step 5: Implement conditional audited state changes**

Use conditional updates:

```sql
UPDATE field_note_replies
SET status = ?, moderated_at = ?, moderated_by = ?
WHERE id = ? AND status = ?
```

For hide, resolve outstanding flags for the reply. For restore, leave prior
resolved flags unchanged. For flag dismissal, update only `received` or
`reviewing` to `dismissed`. For `hide_target`, require a reply target, hide the
published reply and resolve its outstanding flags.

Add a private `auditStatement()` factory so the reply/flag updates and
`audit_events` insertion run in one `D1Database.batch()`. Gate the audit insert
on the just-written target state, moderator and timestamp. Return `null` when
the expected prior state did not match.

- [ ] **Step 6: Run the integration test and verify GREEN**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts
```

Expected: PASS with hidden replies absent publicly, restored replies present
once, resolved flags retained privately and exact audit counts.

- [ ] **Step 7: Commit the datastore slice**

```powershell
git add src/server/types.ts src/server/d1-store.ts tests/api-test-kit.ts tests/api-store-integration.test.ts
git commit -m "feat: add audited reply moderation store"
```

### Task 5: Expose Staff-only reply and flag moderation APIs

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/api-public.test.ts`

- [ ] **Step 1: Write failing authorization and mutation tests**

Cover these routes:

```text
GET  /api/v1/ops/moderation/replies
GET  /api/v1/ops/moderation/flags
POST /api/v1/ops/moderation/replies/:id
POST /api/v1/ops/moderation/flags/:id
```

Assert anonymous and hunter tokens cannot list or mutate. Assert Staff POSTs
without the exact Origin, JSON media type, action or a 3–500 character private
reason fail. Prove `{"action":"hide","reason":"Automated spam"}` removes the
reply from `GET /api/v1/board`, `restore` returns it, `dismiss` preserves the
target, and `hide_target` resolves the flag and hides the reply.

- [ ] **Step 2: Run focused API tests and verify RED**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/api-public.test.ts
```

Expected: FAIL with 404 because the Ops moderation routes do not exist.

- [ ] **Step 3: Add validated exact-origin routes**

```ts
app.post("/api/v1/ops/moderation/replies/:id", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const mediaType = requireJsonMediaType(c.req.raw);
  const { body, files } = await requestBody(c.req.raw, mediaType);
  if (files.length) throw new ApiError(415, "unsupported_media_type", "Reply moderation accepts JSON only.");
  const action = requiredString(body, "action", { max: 10 });
  if (action !== "hide" && action !== "restore") {
    throw new ApiError(422, "validation_failed", "Choose hide or restore.", { field: "action" });
  }
  const result = await deps.store.moderateReply(
    c.req.param("id"), action, requiredString(body, "reason", { min: 3, max: 500 }), staff.subject,
  );
  if (!result) throw new ApiError(409, "reply_state_conflict", "The reply state changed. Refresh and try again.");
  return success(c, result);
});
```

Add the read projections and flag mutation explicitly:

```ts
app.get("/api/v1/ops/moderation/replies", async (c) => {
  await requireStaff(deps, c.req.raw);
  const result = await deps.store.listModerationReplies({
    limit: queryLimit(c.req.query("limit")),
    cursor: c.req.query("cursor") ?? null,
  });
  return success(c, result.items, 200, { nextCursor: result.nextCursor });
});

app.get("/api/v1/ops/moderation/flags", async (c) => {
  await requireStaff(deps, c.req.raw);
  const result = await deps.store.listContentFlags({
    limit: queryLimit(c.req.query("limit")),
    cursor: c.req.query("cursor") ?? null,
  });
  return success(c, result.items, 200, { nextCursor: result.nextCursor });
});

app.post("/api/v1/ops/moderation/flags/:id", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const mediaType = requireJsonMediaType(c.req.raw);
  const { body, files } = await requestBody(c.req.raw, mediaType);
  if (files.length) throw new ApiError(415, "unsupported_media_type", "Flag moderation accepts JSON only.");
  const action = requiredString(body, "action", { max: 20 });
  if (action !== "dismiss" && action !== "hide_target") {
    throw new ApiError(422, "validation_failed", "Choose dismiss or hide_target.", { field: "action" });
  }
  const result = await deps.store.moderateContentFlag(
    c.req.param("id"), action, requiredString(body, "reason", { min: 3, max: 500 }), staff.subject,
  );
  if (!result) throw new ApiError(409, "flag_state_conflict", "The flag or target state changed. Refresh and try again.");
  return success(c, result);
});
```

Set private/no-store responses through the existing `success()` helper. Do not
add public moderation endpoints.

- [ ] **Step 4: Run focused API tests and verify GREEN**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/api-public.test.ts
```

Expected: PASS with authorization, conflict and privacy assertions intact.

- [ ] **Step 5: Commit the API slice**

```powershell
git add src/server/app.ts tests/api-auth.test.ts tests/api-public.test.ts
git commit -m "feat: expose Staff reply moderation APIs"
```

## Checkpoint 3: Ops Moderation Experience

### Task 6: Add Public Replies and Received Flags to Ops

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Test: `tests/ops-board-ui-contract.test.mjs`
- Test: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing Ops markup and behavior tests**

Require `#moderation-replies-table`, `#moderation-flags-table`, status live
regions and real action buttons. Add normalization and escaping cases:

```ts
const rows = normalizeModerationReplies({ data: [{
  id: "reply-1",
  body: "<img src=x onerror=alert(1)>",
  authorHandle: "Nancy & Ron",
  noteExcerpt: "Public parent note",
  waypointRouteOrder: 4,
  waypointName: "Seniors Centre",
  status: "published",
  flagCount: 1,
  createdAt: "2026-07-17T18:00:00.000Z",
}] });
const html = renderModerationReplyRows(rows);
assert.match(html, /Nancy &amp; Ron/);
assert.doesNotMatch(html, /<img/);
assert.match(html, /data-reply-moderation-action="hide"/);
```

Assert hidden rows offer Restore, received flags offer Hide reply and Dismiss,
and button text communicates the action without relying on colour.

- [ ] **Step 2: Run focused Ops tests and verify RED**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts
```

Expected: FAIL because reply and flag tables/renderers are absent.

- [ ] **Step 3: Add accessible Ops table shells**

Add two panels below pending Case Notes:

```html
<section class="ops-panel" aria-labelledby="moderation-replies-title">
  <header class="ops-panel__header"><h2 id="moderation-replies-title">Public replies</h2></header>
  <p id="moderation-replies-state" role="status" aria-live="polite">Open this ledger to load recent replies.</p>
  <div class="ops-table-wrap"><table><thead><tr><th>Posted</th><th>Hunter</th><th>Context</th><th>Reply</th><th>Flags</th><th>State</th><th><span class="sr-only">Action</span></th></tr></thead><tbody id="moderation-replies-table"></tbody></table></div>
</section>
```

Add the equivalent Received Flags panel with target, reason, state and action
columns. Keep private reasons out of public markup.

- [ ] **Step 4: Normalize, render and load both ledgers**

Add strict normalizers that discard malformed records, escape every string and
render status chips. Extend `loadModeration()` to request pending notes, recent
replies and flags concurrently, updating each table independently so one failed
ledger does not erase the others.

- [ ] **Step 5: Add deliberate hide, restore and flag actions**

Use delegated click handling. Prompt for a private reason, require confirmation
that hide is reversible/audited, disable only the active button, POST JSON to
the relevant endpoint, and refresh replies, flags, dashboard counts and audit
after success. On failure, restore the button and announce the exact error in
the panel status region. After refresh, return focus to the same reply row's
new action or the table heading.

- [ ] **Step 6: Add responsive and focus-visible styles**

Use existing Documentary Case File tokens. Give action buttons at least 44px
pointer height, preserve visible native focus, use evidence red only for Hide,
and ensure tables scroll within their region at 200% zoom without page-wide
horizontal overflow.

- [ ] **Step 7: Run focused Ops tests and verify GREEN**

Run:

```powershell
node --test tests/ops-board-ui-contract.test.mjs tests/campaign-shell-accessibility.test.mjs
npx tsx --test tests/ops-board-ui-behavior.test.ts
```

Expected: PASS with escaped content, distinct actions and accessible table
contracts.

- [ ] **Step 8: Commit the Ops slice**

```powershell
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts tests/campaign-shell-accessibility.test.mjs
git commit -m "feat: add Ops reply moderation controls"
```

### Task 7: Reconcile moderation counts and public identity contracts

**Files:**
- Modify: `src/server/d1-store.ts`
- Modify: `src/client/ops.ts`
- Test: `tests/api-store-integration.test.ts`
- Test: `tests/ops-board-ui-behavior.test.ts`
- Create: `tests/privacy-output.test.mjs`

- [ ] **Step 1: Write failing count and privacy regressions**

Assert the Ops dashboard's moderation count equals pending Case Notes plus
received flags, while Public Replies shows its own current total and does not
inflate “needs attention.” Assert a hidden flagged reply removes its received
flag count. Scan public board output for profile subjects, verified emails,
minor source names, private moderation reasons and object keys.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/privacy-output.test.mjs
```

Expected: FAIL until new reply/flag projections and post-action counts are
fully reconciled.

- [ ] **Step 3: Make count and projection behavior explicit**

Keep `receivedFlags` as action-required flags only. Keep recent published or
hidden replies informational until an operator acts. After hide/dismiss,
dashboard and navigation counts derive from current database state rather than
optimistic subtraction. Ensure all public-author labels pass through
`publicHunterIdentity()` and Ops-only reason fields never enter board payloads.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npx tsx --test tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/privacy-output.test.mjs
```

Expected: PASS with no private identity or moderation values in public output.

- [ ] **Step 5: Commit the reconciliation slice**

```powershell
git add src/server/d1-store.ts src/client/ops.ts tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts tests/privacy-output.test.mjs
git commit -m "test: lock reply moderation privacy contracts"
```

## Final Verification and Validation Deployment

### Task 8: Verify and deploy only to validation

**Files:**
- Modify: `STATUS.md`
- Create: `docs/operations/2026-07-17-reply-moderation-validation.md`
- Test: all repository suites

- [ ] **Step 1: Run complete automated verification**

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

Expected: every command exits 0, all reported tests pass, authoritative legal
artifacts are unchanged and public output contains no private fixture values.

- [ ] **Step 2: Run a public-output and secret scan**

Run:

```powershell
rg -n "re_[A-Za-z0-9_]+|sk_(live|test)|CLERK_SECRET|TURNSTILE_SECRET|Private Child Name|Hunter CHILD" dist src css *.html docs
```

Expected: no credential values in repository/public output and no minor source
identity in `dist`; environment variable names may appear only in expected
server/configuration documentation.

- [ ] **Step 3: Record a read-only production baseline**

Use the guarded workflow documented in
`docs/operations/2026-07-16-production-release.md`. Record protected production
D1 row counts, foreign-key status and referenced R2 object counts. The command
must report zero production writes.

- [ ] **Step 4: Deploy application code only to the validation branch**

Build the exact committed candidate, then use the documented Cloudflare Pages
deployment command with branch `codex-validation`. Do not deploy migrations
because the approved implementation uses existing schema columns.

Expected: the immutable deployment and
`https://codex-validation.seba-treasure-hunt.pages.dev` both return
`deploymentEnvironment: validation`; production continues serving its prior
immutable application release.

- [ ] **Step 5: Complete validation end-to-end checks**

Verify in Chrome desktop and mobile emulation:

1. An 11 MB Case Note JPEG uploads directly.
2. A 21–50 MB supported source shows optimization and submits the prepared file.
3. Report and Ops Update uploads retain the same behavior.
4. Adult custom public name appears in the account chip, approved Case Note and reply.
5. Adult fallback displays the generated Hunter handle.
6. A minor fixture displays Young Hunter publicly and no private identity.
7. Five replies succeed; the sixth returns a visible bounded retry message.
8. A community flag appears in Ops.
9. Ops hides the reply, public Case Notes omit it and Audit records the reason.
10. Ops restores the reply once without changing its body or creation time.
11. Keyboard-only hide/restore works and focus remains useful after refresh.
12. At 200% zoom, upload and moderation controls remain readable without page-wide overflow.

- [ ] **Step 6: Re-run the read-only production baseline**

Expected: protected D1/R2 counts and foreign-key results match Step 3 and the
verification reports zero production writes.

- [ ] **Step 7: Document the validation release and update status**

Record the source commit, immutable validation URL, runtime sentinel, automated
test totals, manual evidence, production before/after baselines, known
limitations and an explicit statement that production was not promoted.

- [ ] **Step 8: Commit release documentation**

```powershell
git add STATUS.md docs/operations/2026-07-17-reply-moderation-validation.md
git commit -m "docs: record reply moderation validation release"
```

Production deployment is not part of this plan. It requires Murphy's explicit
approval after the stable validation release has passed owner review.
