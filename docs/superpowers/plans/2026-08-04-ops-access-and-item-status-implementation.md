# Ops Access and Item Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct audited operator invitations, reliable D1-authoritative suspension with safe self-suspension, focused reversible item-status controls, and an authoritative Apple Watch FOUND state.

**Architecture:** D1 remains authoritative for Ops eligibility and item state. Clerk supplies invitation delivery and defence-in-depth session operations, but a temporary provider problem cannot reopen a suspended D1 principal. Narrow version-checked mutations update only the intended access or item field, while the existing public item projection drives the FOUND stamp.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1/SQLite migrations, Clerk Backend SDK, browser DOM APIs, Node test runner, Miniflare, esbuild.

---

## Working-tree boundary

This release worktree contains unrelated active changes. Do not use blanket `git add`, do not discard existing edits, and do not commit unrelated hunks. Before every checkpoint:

```powershell
git status --short
git diff --cached --name-only
git diff --check -- <task paths>
```

For already-dirty files such as `ops.html`, `index.html`, `src/client/ops-items.ts`, and their tests, stage only this plan's hunks and verify the cached diff before committing.

## File map

- `src/server/types.ts`: focused staff invitation/access and item-status store contracts.
- `src/server/d1-store.ts`: authoritative staff capabilities, invitation rows, access transitions, provider-warning audit records, and focused item-status transactions.
- `src/server/app.ts`: validation and authenticated same-origin endpoints.
- `src/server/staff-accounts.ts`: Clerk invitation delivery and session operations without making Clerk the Ops authorization authority.
- `tests/api-test-kit.ts`: FakeStore and fake provider parity.
- `tests/api-auth.test.ts`: HTTP authorization, response, and provider-failure contracts.
- `tests/api-store-integration.test.ts`: real D1 invariants, concurrency, idempotency, and audit history.
- `ops.html`, `src/client/ops.ts`, `css/ops.css`: direct invitation and capability-driven access UI.
- `src/client/ops-items.ts`, `tests/ops-items.test.ts`: focused item-status controls and browser behavior.
- `migrations/0022_mark_apple_watch_found.sql`: idempotent Apple Watch transition and system audit history.
- `index.html`, `tests/case-items.test.ts`, `tests/unhinged-evidence-wall.test.mjs`: static fallback and migration contracts.
- `STATUS.md`: dated behavior, verification, and deployment boundary.

### Task 1: Authoritative staff capabilities and access transitions

**Files:**
- Modify: `src/server/types.ts:435-465, 540-565`
- Modify: `src/server/d1-store.ts:5361-5379, 5590-5649`
- Modify: `tests/api-test-kit.ts:2092-2187`
- Test: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing real-D1 tests for staff capabilities and suspension invariants**

Add a test that inserts two active principals and one suspended principal, then asserts:

```ts
const rows = await store.listStaff("user_owner");
const owner = rows.find((row) => row.id === "staff-owner");
assert.equal(owner?.isCurrent, true);
assert.deepEqual(owner?.actions, ["recovery", "revoke-sessions", "suspend"]);

const suspended = await store.changeStaffAccess(
  "staff-owner",
  "suspend",
  "user_owner"
);
assert.equal(suspended?.status, "suspended");
assert.equal(await store.isActiveStaff("user_owner", "owner@example.test"), false);

await assert.rejects(
  () => store.changeStaffAccess("staff-peer", "suspend", "user_peer"),
  (error: unknown) => error instanceof ApiError && error.code === "final_active_staff"
);
```

Also assert that `staff.suspended`, `staff.reactivated`, and `staff.provider_warning` audit rows name the actor and target, and that a repeated or stale transition creates no second event.

- [ ] **Step 2: Run the focused D1 test and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "staff capabilities and suspension invariants" tests/api-store-integration.test.ts
```

Expected: FAIL because `listStaff(actorSubject)`, `changeStaffAccess`, and `recordStaffProviderWarning` do not exist or do not return capability data.

- [ ] **Step 3: Add focused store contracts**

Add these contracts to `src/server/types.ts`:

```ts
export type StaffAccessAction = "suspend" | "reactivate";

export interface CaseItemStatusMutation {
  expectedVersion: number;
  status: "out_there" | "found";
  confirmed: true;
}

listStaff(actorSubject?: string): Promise<Record<string, unknown>[]>;
changeStaffAccess(
  id: string,
  action: StaffAccessAction,
  actorSubject: string
): Promise<Record<string, unknown> | null>;
recordStaffProviderWarning(
  operation: "invitation" | "revoke-sessions" | "reactivate",
  target: string,
  actorSubject: string
): Promise<void>;
```

Keep the separate production-snapshot store read-only contract unchanged.

- [ ] **Step 4: Implement capability projection and atomic access changes**

Change `D1Store.listStaff(actorSubject)` to count active principals and return explicit server capabilities:

```ts
const activeCount = Number(count?.active_count ?? 0);
const isCurrent = Boolean(actorSubject && row.provider_subject === actorSubject);
const actions = row.status === "invited"
  ? ["resend-invitation"]
  : row.status === "active"
    ? ["recovery", "revoke-sessions", ...(activeCount > 1 ? ["suspend"] : [])]
    : row.status === "suspended"
      ? ["recovery", "reactivate"]
      : [];
```

Implement `changeStaffAccess` with conditional D1 statements. A suspend update must include an active-count guard:

```sql
UPDATE staff_principals
SET status = 'suspended'
WHERE id = ? AND status = 'active'
  AND (SELECT COUNT(*) FROM staff_principals WHERE status = 'active') > 1
```

Append the access event and audit record only when the guarded update changed one row. If the target was the final active principal, throw:

```ts
throw new ApiError(
  409,
  "final_active_staff",
  "At least one active operator must remain. Invite or reactivate another operator first."
);
```

Implement `recordStaffProviderWarning` as a private audit insertion with no credential or provider-payload metadata.

- [ ] **Step 5: Mirror the behavior in FakeStore**

Give FakeStore structured staff records rather than deriving every row from its subject set. Match the real store's final-active invariant, `isCurrent`, explicit `actions`, state transitions, and warning audit names.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npx tsx --test --test-name-pattern "staff capabilities and suspension invariants" tests/api-store-integration.test.ts
npx tsc -p tsconfig.worker.json --noEmit
```

Expected: the focused test and worker typecheck pass.

- [ ] **Step 7: Create an exact-hunk checkpoint**

Stage only Task 1 hunks, verify `git diff --cached`, and commit:

```powershell
git commit -m "feat: make staff access state authoritative"
```

### Task 2: Direct invitations and access API behavior

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts:2485-2488, 2600-2625`
- Modify: `src/server/staff-accounts.ts:34-65, 100-112`
- Modify: `tests/api-test-kit.ts`
- Test: `tests/api-auth.test.ts`
- Test: `tests/account-recovery-links.test.ts`

- [ ] **Step 1: Write failing HTTP tests for invitations and self-suspension**

Add API tests covering anonymous, cross-origin, invalid-email, new invitation, duplicate pending invitation, suspended-address conflict, delivery warning, peer suspension, self-suspension, final-active rejection, and reactivation.

Use the desired request contract:

```ts
const invited = await app.request(`${origin}/api/v1/ops/staff/invitations`, {
  method: "POST",
  ...json({ email: " New.Operator@Example.com " }, staffHeaders)
});
assert.equal(invited.status, 202);
assert.equal((await responseJson(invited)).data.email, "new.operator@example.com");

const suspended = await app.request(`${origin}/api/v1/ops/staff/staff-1/suspend`, {
  method: "POST",
  ...json({ confirmed: true }, staffHeaders)
});
assert.equal(suspended.status, 202);
assert.equal((await responseJson(suspended)).data.selfSuspended, true);
```

Assert that a fake Clerk failure still returns a successful D1 suspension with `providerWarning: true`, while invitation delivery failure returns the pending invitation with `delivery: "failed"` and a resend capability.

- [ ] **Step 2: Run the API tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "direct staff invitations|self-suspension|final active operator" tests/api-auth.test.ts
```

Expected: FAIL with the invitation route missing and suspension still provider-first.

- [ ] **Step 3: Add idempotent invitation persistence**

Add this store contract:

```ts
inviteStaff(
  normalizedEmail: string,
  actorSubject: string
): Promise<{ record: Record<string, unknown>; created: boolean }>;
```

In D1:

- return the existing pending row with `created: false`;
- reject active with `staff_already_active`;
- reject suspended with `staff_reactivation_required`;
- reject revoked with `staff_invitation_blocked`;
- otherwise insert one `invited` row with `provider_subject = NULL`, a safe email-derived display label, timestamps, and `staff.invited` audit history.

Mirror these states in FakeStore.

- [ ] **Step 4: Add the invitation endpoint**

In `src/server/app.ts`, validate exact JSON and use the existing `email(body, "email")` helper:

```ts
app.post("/api/v1/ops/staff/invitations", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const { body } = await requestBody(c.req.raw);
  if (Object.keys(body).some((key) => key !== "email")) {
    throw new ApiError(422, "validation_failed", "Invitation fields are invalid.");
  }
  const invitation = await deps.store.inviteStaff(email(body, "email"), staff.subject);
  let delivery: "sent" | "failed" = "sent";
  try {
    if (!deps.staffAccounts) throw new Error("provider unavailable");
    await deps.staffAccounts.execute("resend-invitation", invitation.record);
  } catch {
    delivery = "failed";
    await deps.store.recordStaffProviderWarning("invitation", String(invitation.record.id), staff.subject);
  }
  return success(c, { ...invitation.record, delivery, created: invitation.created }, 202);
});
```

Do not include the caught provider error or Clerk response in the API or audit metadata.

- [ ] **Step 5: Make suspension local-first and provider-safe**

In the staff action route:

- require `{ confirmed: true }` for `suspend` and `reactivate`;
- call `changeStaffAccess` before session defence-in-depth;
- for suspension, call the provider's session-revocation path rather than `banUser`;
- record a warning and return `providerWarning: true` if revocation fails;
- return `selfSuspended` when the target provider subject matches the actor;
- keep recovery, explicit session revocation, and invitation resend provider-managed.

In `ManagedStaffAccounts.execute`, replace the ban operation with the same bounded session revocation used by `revoke-sessions`. Retain `unbanUser` for reactivation so previously banned legacy records can recover.

- [ ] **Step 6: Run API/provider tests and verify GREEN**

Run:

```powershell
npx tsx --test --test-name-pattern "direct staff invitations|self-suspension|final active operator|verified password recovery" tests/api-auth.test.ts
npx tsx --test tests/account-recovery-links.test.ts
npm run typecheck:worker
```

Expected: all selected tests and worker typecheck pass.

- [ ] **Step 7: Commit the server/API slice**

Stage only Task 2 hunks, inspect the cached diff, and commit:

```powershell
git commit -m "feat: invite and suspend operators safely"
```

### Task 3: Users & Access interface

**Files:**
- Modify: `ops.html:333-338`
- Modify: `src/client/ops.ts:54-63, 547-573, 1185-1203, 3592-3606, 5039-5053`
- Modify: `css/ops.css:306-308, 505, 269`
- Test: `tests/ops-board-ui-behavior.test.ts:1426-1468`
- Test: `tests/ops-board-ui-contract.test.mjs`

- [ ] **Step 1: Write failing UI tests**

Add tests asserting that:

```ts
const rows = normalizeOpsStaff({ data: [{
  id: "staff-owner",
  email: "owner@example.test",
  displayName: "Owner",
  status: "active",
  isCurrent: true,
  actions: [],
  suspendBlockedReason: "At least one active operator must remain."
}] });
const html = renderStaffRows(rows);
assert.match(html, />You</);
assert.doesNotMatch(html, /data-staff-action="suspend"/);
assert.match(html, /At least one active operator must remain/);
```

Also assert that no missing `actions` payload receives client-invented defaults, the invitation form has a labelled email input and live result, and a `selfSuspended` API result calls sign-out once.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "staff actions|invited staff|operator invitation|self-suspension" tests/ops-board-ui-behavior.test.ts
node --test --test-name-pattern="Users & Access" tests/ops-board-ui-contract.test.mjs
```

Expected: FAIL because the invite form, `You` state, and server-only capability rendering are absent.

- [ ] **Step 3: Add the invitation panel and capability-only rows**

Add above the staff table in `ops.html`:

```html
<form class="ops-panel ops-staff-invite" id="staff-invite-form" novalidate>
  <div><p class="ops-kicker">Invite an operator</p><h2>Send a private invitation</h2>
    <p>The address is eligible immediately. Access starts after email verification.</p></div>
  <label for="staff-invite-email">Email address</label>
  <input id="staff-invite-email" name="email" type="email" autocomplete="email" required />
  <div class="ops-action-row"><button class="ops-button ops-button--primary" type="submit">Send invitation</button>
    <span data-staff-invite-result role="status" aria-live="polite"></span></div>
</form>
```

Extend `OpsStaffRecord` with `isCurrent` and `suspendBlockedReason`. Remove client-generated default actions; render only the server's exact list. Add the `You` badge and a short blocked explanation when the final active operator has no suspend capability.

- [ ] **Step 4: Wire invitation and self-suspension behavior**

On invitation submit, POST normalized form data, preserve the typed address on failure, clear it on success, announce `Invitation sent` or `Invitation saved; email delivery needs retry`, then reload staff and audit ledgers.

After a staff action response:

```ts
if (isRecord(payload) && isRecord(payload.data) && payload.data.selfSuspended === true) {
  await staffClerk?.signOut();
  location.reload();
  return;
}
```

Keep focus on the originating control for every non-self action and show provider warnings in the access guide rather than the global page error.

- [ ] **Step 5: Add narrow responsive styling**

Use the existing Ops tokens. Make `.ops-staff-invite` a compact grid on desktop and one column below 700 px. Do not introduce a new colour system or alter the Case Room navigation.

- [ ] **Step 6: Run UI tests and typecheck**

Run:

```powershell
npx tsx --test --test-name-pattern "staff actions|invited staff|operator invitation|self-suspension" tests/ops-board-ui-behavior.test.ts
node --test tests/ops-board-ui-contract.test.mjs
npm run typecheck:client
```

Expected: all selected tests and client typecheck pass.

- [ ] **Step 7: Commit the access UI slice**

Stage only Task 3 hunks and commit:

```powershell
git commit -m "feat: add direct operator invitation controls"
```

### Task 4: Focused item-status mutation and quick controls

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts:3391-3485`
- Modify: `src/server/app.ts:1933-1957`
- Modify: `tests/api-test-kit.ts:477-545`
- Modify: `src/client/ops-items.ts:192-229, 358-381, 608-640`
- Test: `tests/case-items.test.ts:116-206`
- Test: `tests/api-store-integration.test.ts:284-382`
- Test: `tests/ops-items.test.ts`

- [ ] **Step 1: Write failing backend tests for the narrow mutation**

Add HTTP and real-D1 cases for authorization, origin, explicit confirmation, allowed transitions, stale version, missing item, invalid states, reversibility, and exact audit history:

```ts
const found = await app.request(`${origin}/api/v1/ops/items/item-watch/status`, {
  method: "POST",
  ...json({ expectedVersion: 4, status: "found", confirmed: true }, staffHeaders)
});
assert.equal(found.status, 200);
assert.equal((await responseJson(found)).data.status, "found");
```

Assert the mutation preserves title, description, media, placement, visibility, and collection fields.

- [ ] **Step 2: Run backend tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "focused item status|case item mutations" tests/case-items.test.ts
npx tsx --test --test-name-pattern "focused item status" tests/api-store-integration.test.ts
```

Expected: FAIL because the status endpoint and store method do not exist.

- [ ] **Step 3: Add the store method and endpoint**

Add to `Store`:

```ts
updateCaseItemStatus(
  id: string,
  input: CaseItemStatusMutation,
  actorSubject: string
): Promise<Record<string, unknown> | null>;
```

The D1 implementation must load only `status` and `version`, reject same-state and non-paired transitions, and issue a conditional update:

```sql
UPDATE case_items
SET status = ?, version = version + 1, updated_at = ?, updated_by = ?
WHERE id = ? AND version = ? AND status = ?
```

Guard the matching `case_item.status_changed` event and audit insertion on that successful update. Return `case_item_stale` if the version changed and `case_item_status_transition` for any transition outside `out_there <-> found`.

Add `POST /api/v1/ops/items/:id/status` with active-staff, same-origin, exact-field, integer-version, two-state, and `confirmed === true` validation.

- [ ] **Step 4: Mirror the focused mutation in FakeStore**

Update only `status`, `version`, `updatedAt`, and the event/audit arrays. Reject invalid or stale changes with the same API codes as D1.

- [ ] **Step 5: Write failing client tests for quick controls**

Assert `out_there` renders `Mark found`, `found` renders `Mark out there`, ineligible states render no quick action, the exact item title appears in confirmation copy, the request contains only `expectedVersion`, `status`, and `confirmed`, and success reloads the authoritative item list.

- [ ] **Step 6: Run client tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "quick item status" tests/ops-items.test.ts
```

Expected: FAIL because no quick-status control or request helper exists.

- [ ] **Step 7: Add the quick-status UI**

In each eligible item header, render:

```html
<button class="ops-button ops-button--status" type="button"
  data-item-quick-status="found">Mark found</button>
```

Use `data-item-version` already present on the card. Confirm with the exact item title, POST the three-field body, announce progress through `[data-item-result]`, and call `loadOpsItems()` after success or a 409. Do not submit the full editor and do not create an announcement draft.

- [ ] **Step 8: Run focused backend/client tests and typechecks**

Run:

```powershell
npx tsx --test --test-name-pattern "focused item status|case item mutations" tests/case-items.test.ts tests/api-store-integration.test.ts
npx tsx --test --test-name-pattern "quick item status" tests/ops-items.test.ts
npm run typecheck
```

Expected: focused tests and all TypeScript projects pass.

- [ ] **Step 9: Commit the item-status slice**

Stage only Task 4 hunks and commit:

```powershell
git commit -m "feat: add quick audited item status controls"
```

### Task 5: Apple Watch FOUND migration and public fallback

**Files:**
- Create: `migrations/0022_mark_apple_watch_found.sql`
- Modify: `index.html:16-56, 78-110, 245-253`
- Modify: `tests/case-items.test.ts:20-100`
- Modify: `tests/api-store-integration.test.ts`
- Modify: `tests/unhinged-evidence-wall.test.mjs:25-110`

- [ ] **Step 1: Write failing migration and fallback tests**

Assert the new migration:

- updates only `case-item-watch`;
- changes it to `found` conditionally;
- advances the version once;
- records deterministic case-item and audit events;
- is replayable without a second version increase or duplicate event.

In the real-D1 test, apply the case-item base migration, capture the Apple Watch version, apply `0022`, apply `0022` again, and assert one version increase plus one event and one audit row.

Assert the static Apple Watch card contains `data-case-item-status="found"`, `evidence-card--found`, and a FOUND stamp, and that metadata/FAQ/visible copy no longer lists the Apple Watch among items still out there.

- [ ] **Step 2: Run migration/static tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "Apple Watch found migration" tests/case-items.test.ts
npx tsx --test --test-name-pattern "Apple Watch found migration" tests/api-store-integration.test.ts
node --test --test-name-pattern="Apple Watch" tests/unhinged-evidence-wall.test.mjs
```

Expected: FAIL because migration `0022` and the fallback FOUND state are absent.

- [ ] **Step 3: Add the idempotent migration**

Use a guarded update and deterministic events:

```sql
UPDATE case_items
SET status = 'found', version = version + 1,
    updated_at = '2026-08-04T16:00:00.000Z',
    updated_by = 'system:migration:0022'
WHERE id = 'case-item-watch' AND status <> 'found';

INSERT OR IGNORE INTO case_item_events
  (id, item_id, actor_subject, action, from_status, to_status,
   item_version, details_json, occurred_at)
SELECT 'case-item-watch-found-0022', id, 'system:migration:0022',
       'case_item.marked_found_release', 'out_there', 'found', version,
       '{"source":"confirmed-find"}', updated_at
FROM case_items
WHERE id = 'case-item-watch' AND status = 'found'
  AND updated_by = 'system:migration:0022';
```

Add a deterministic `audit_events` insertion with target kind `case_item`, target `case-item-watch`, and no finder identity or private report metadata.

```sql
INSERT OR IGNORE INTO audit_events
  (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
SELECT 'audit-case-item-watch-found-0022', 'system:migration:0022',
       'case_item.marked_found_release', 'case_item', 'case-item-watch',
       '{"source":"confirmed-find"}', updated_at
FROM case_items
WHERE id = 'case-item-watch' AND status = 'found'
  AND updated_by = 'system:migration:0022';
```

- [ ] **Step 4: Update the static public fallback**

Change the Apple Watch card to the same found treatment as Tim's ID and use copy such as `Found. Its finder has it.` Update the Open Graph description, JSON-LD description/FAQ, hero lead, and quick answers so the Watch is not described as still out there. Do not change the independent state of any other item or the overall open-case headline.

- [ ] **Step 5: Run migration/static tests and build**

Run:

```powershell
npx tsx --test --test-name-pattern "Apple Watch found migration" tests/case-items.test.ts
npx tsx --test --test-name-pattern "Apple Watch found migration" tests/api-store-integration.test.ts
node --test --test-name-pattern="Apple Watch" tests/unhinged-evidence-wall.test.mjs
npm run build
```

Expected: tests pass and the production-shaped build completes.

- [ ] **Step 6: Commit the Apple Watch slice**

Stage only Task 5 hunks and commit:

```powershell
git commit -m "feat: mark the Apple Watch found"
```

### Task 6: Full verification, privacy review, and local release checkpoint

**Files:**
- Modify: `STATUS.md`
- Review: every path changed by Tasks 1-5

- [ ] **Step 1: Run focused security regressions**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/case-items.test.ts tests/ops-items.test.ts tests/ops-board-ui-behavior.test.ts
npx tsx --test --test-name-pattern "staff capabilities|focused item status|Apple Watch" tests/api-store-integration.test.ts
node --test tests/ops-board-ui-contract.test.mjs tests/unhinged-evidence-wall.test.mjs
```

Expected: every focused file passes with no unhandled rejection or warning.

- [ ] **Step 2: Run the complete gates**

Run:

```powershell
npm test
npm run typecheck
npm run legal:verify
npm run build
```

Expected: all tests pass, all TypeScript projects pass, legal artifacts are unchanged, and the build completes.

- [ ] **Step 3: Perform privacy and diff review**

Confirm the public build and scoped diff contain no staff email fixtures, provider payloads, credentials, local filesystem paths, invitation records, or private audit content. Confirm only the Apple Watch changes public item facts.

Run:

```powershell
git diff --check
git diff --stat
git diff --cached --check
```

- [ ] **Step 4: Perform browser acceptance**

Using a local production-shaped preview:

- invite a disposable non-company email and observe pending/sent state;
- verify a duplicate invite does not create a second row;
- suspend the current operator while a peer remains and confirm immediate sign-out;
- verify the final active operator cannot be suspended;
- mark a disposable item found and out there again;
- verify the public card and narrow-screen layout update without horizontal overflow;
- verify the Apple Watch shows FOUND from both API-hydrated and static-fallback states.

- [ ] **Step 5: Update project status**

Record the date, behavior, test totals, local commit IDs, and the explicit statement that no push, deployment, production migration, invitation, or live access mutation occurred.

- [ ] **Step 6: Create the final exact-path local checkpoint**

Stage only this plan's remaining documentation/status hunks, inspect the entire cached diff, and commit:

```powershell
git commit -m "docs: record ops access and item status validation"
```

- [ ] **Step 7: Stop at the release gate**

Report the verified local branch, exact commits, tests, and the pending production actions. Do not push, deploy, apply `0022`, send a real invitation, or change a live principal without a separate explicit instruction.
