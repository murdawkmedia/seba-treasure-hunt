# Guided and Reversible Private Report Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each opened Private Report understandable and safely reversible for any authorized operator while giving hunters a simple, privacy-safe status and publication history.

**Architecture:** Put the state vocabulary, allowed transition graph, reason rules, confirmation rules, and hunter labels in one shared TypeScript module. Keep status and assignment mutations server-authoritative and atomic in D1, continue appending both report and audit events, and project only simplified status plus public destinations into the Hunter Dashboard. The Ops drawer consumes the same shared contract but keeps Review Workflow and Public Outcome as separate controls.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/Pages, D1, HTML/CSS, Clerk-backed staff/hunter sessions, Node test runner, Playwright-based QA, Wrangler.

---

## Scope and file map

The following files form the complete change boundary.

- Create `src/shared/report-workflow.ts`: canonical report states, labels, explanations, transition graph, and reason/confirmation helpers.
- Modify `src/shared/publication.ts`: re-export the moved workflow symbols so existing imports remain compatible while attribution logic stays unchanged.
- Modify `src/server/types.ts`: replace the untyped report patch input with a discriminated transition/unassign mutation.
- Modify `src/server/d1-store.ts`: enforce stale-state, reason, confirmation, assignment and publication guards; append atomic report/audit history; project recent Ops history and hunter-safe statuses.
- Modify `src/server/app.ts`: parse the explicit mutation contract and reject ambiguous or malformed changes.
- Modify `tests/api-test-kit.ts`: make the in-memory store obey the same transition, unassign, guard and hunter-projection rules as D1.
- Modify `ops.html`, `src/client/ops.ts`, and `css/ops.css`: replace `Begin review` and prompts with one explained workflow panel, confirmation paths, unassign, refresh and history controls.
- Modify `report.html` and `src/client/report.ts`: explain the private receipt and possible edited public outcomes.
- Modify `dashboard.html`, `src/client/dashboard.ts`, and `css/hunter.css`: render hunter-safe report states and separate public-destination labels.
- Create `tests/report-workflow.test.ts`: pure shared-contract coverage.
- Modify `tests/api-auth.test.ts` and `tests/api-store-integration.test.ts`: authorization, validation, atomic D1, guards, audit and privacy coverage.
- Modify `tests/ops-board-ui-behavior.test.ts` and `tests/ops-board-ui-contract.test.mjs`: Ops normalization, control, copy and accessibility contracts.
- Modify `tests/hunter-ui-client.test.ts`, `tests/hunter-account-contract.test.mjs`, and `tests/hunter-ui-pages.test.mjs`: receipt and Dashboard projections.
- Modify `scripts/verify-unified-shell-qa.mjs` and `tests/unified-shell-qa-contract.test.mjs`: validation-safe browser journeys for the opened-report workflow and private hunter history.
- Modify `README.md`, `STATUS.md`, and create `docs/operations/2026-07-18-private-report-workflow-validation.md`: operator contract, evidence, release boundary and handoff.

Do not modify Moderation Queue handlers, moderation tables, legal documents or hashes, report intake fields, Clerk settings, media processing, email notifications, database migrations, or public publication defaults.

This plan requires no schema migration.

## Task 1: Establish the shared workflow contract

**Files:**

- Create: `src/shared/report-workflow.ts`
- Modify: `src/shared/publication.ts:30-58`
- Create: `tests/report-workflow.test.ts`
- Modify: `tests/ops-board-ui-behavior.test.ts:378-387`

- [ ] **Step 1: Write the failing shared-contract tests**

Create `tests/report-workflow.test.ts` with exact assertions for every state, every allowed destination, every hunter label, and every reason/confirmation requirement:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_REVIEW_STATES,
  hunterReportState,
  nextReportStates,
  reportStateCopy,
  reportTransitionRequiresConfirmation,
  reportTransitionRequiresReason,
} from "../src/shared/report-workflow";

test("defines the complete guided and reversible transition graph", () => {
  assert.deepEqual(REPORT_REVIEW_STATES, [
    "received", "reviewing", "contacted", "escalated",
    "verified", "rejected", "resolved",
  ]);
  assert.deepEqual(nextReportStates("received"), ["reviewing", "rejected"]);
  assert.deepEqual(nextReportStates("reviewing"), ["contacted", "escalated", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("contacted"), ["reviewing", "escalated", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("escalated"), ["reviewing", "contacted", "verified", "rejected"]);
  assert.deepEqual(nextReportStates("verified"), ["reviewing", "resolved"]);
  assert.deepEqual(nextReportStates("resolved"), ["reviewing"]);
  assert.deepEqual(nextReportStates("rejected"), ["reviewing"]);
  assert.deepEqual(nextReportStates("unknown"), []);
});

test("keeps operator explanations separate from hunter-safe states", () => {
  assert.deepEqual(REPORT_REVIEW_STATES.map((state) => hunterReportState(state)), [
    "Received", "Under review", "Under review", "Under review",
    "Verified", "Closed", "Closed",
  ]);
  assert.equal(reportStateCopy("escalated").operatorExplanation,
    "The report needs additional operational or safety attention.");
  assert.equal(reportStateCopy("rejected").operatorLabel, "Rejected");
});

test("requires reasons and confirmations for corrections and terminal decisions", () => {
  assert.equal(reportTransitionRequiresReason("received", "reviewing"), false);
  assert.equal(reportTransitionRequiresReason("reviewing", "contacted"), false);
  assert.equal(reportTransitionRequiresReason("contacted", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("verified", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("resolved", "reviewing"), true);
  assert.equal(reportTransitionRequiresReason("reviewing", "rejected"), true);
  assert.equal(reportTransitionRequiresReason("verified", "resolved"), true);
  assert.equal(reportTransitionRequiresConfirmation("contacted", "reviewing"), true);
  assert.equal(reportTransitionRequiresConfirmation("resolved", "reviewing"), true);
  assert.equal(reportTransitionRequiresConfirmation("reviewing", "rejected"), true);
  assert.equal(reportTransitionRequiresConfirmation("verified", "resolved"), true);
  assert.equal(reportTransitionRequiresConfirmation("reviewing", "verified"), false);
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module fails**

Run:

```powershell
npx tsx --test tests/report-workflow.test.ts
```

Expected: FAIL because `src/shared/report-workflow.ts` does not exist.

- [ ] **Step 3: Implement the shared vocabulary and graph**

Create `src/shared/report-workflow.ts` with this public surface:

```ts
export const REPORT_REVIEW_STATES = [
  "received",
  "reviewing",
  "contacted",
  "escalated",
  "verified",
  "rejected",
  "resolved",
] as const;

export type ReportReviewState = typeof REPORT_REVIEW_STATES[number];
export type HunterReportState = "Received" | "Under review" | "Verified" | "Closed";

export interface ReportStateCopy {
  operatorLabel: string;
  operatorExplanation: string;
  hunterLabel: HunterReportState;
}

const COPY: Record<ReportReviewState, ReportStateCopy> = {
  received: {
    operatorLabel: "Received",
    operatorExplanation: "Waiting for an operator to assess it.",
    hunterLabel: "Received",
  },
  reviewing: {
    operatorLabel: "Reviewing",
    operatorExplanation: "An operator is assessing the report.",
    hunterLabel: "Under review",
  },
  contacted: {
    operatorLabel: "Contacted",
    operatorExplanation: "The reporter has been contacted for more information.",
    hunterLabel: "Under review",
  },
  escalated: {
    operatorLabel: "Escalated",
    operatorExplanation: "The report needs additional operational or safety attention.",
    hunterLabel: "Under review",
  },
  verified: {
    operatorLabel: "Verified",
    operatorExplanation: "The relevant facts have been confirmed. An Official Update may now be prepared.",
    hunterLabel: "Verified",
  },
  rejected: {
    operatorLabel: "Rejected",
    operatorExplanation: "The report is invalid, unsafe, duplicate or spam.",
    hunterLabel: "Closed",
  },
  resolved: {
    operatorLabel: "Resolved",
    operatorExplanation: "Internal work on the report is complete.",
    hunterLabel: "Closed",
  },
};

const TRANSITIONS: Record<ReportReviewState, readonly ReportReviewState[]> = {
  received: ["reviewing", "rejected"],
  reviewing: ["contacted", "escalated", "verified", "rejected"],
  contacted: ["reviewing", "escalated", "verified", "rejected"],
  escalated: ["reviewing", "contacted", "verified", "rejected"],
  verified: ["reviewing", "resolved"],
  rejected: ["reviewing"],
  resolved: ["reviewing"],
};

export function isReportReviewState(value: unknown): value is ReportReviewState {
  return typeof value === "string" && REPORT_REVIEW_STATES.includes(value as ReportReviewState);
}

export function nextReportStates(value: unknown): readonly ReportReviewState[] {
  return isReportReviewState(value) ? TRANSITIONS[value] : [];
}

export function reportStateCopy(value: ReportReviewState): ReportStateCopy {
  return COPY[value];
}

export function hunterReportState(value: ReportReviewState): HunterReportState {
  return COPY[value].hunterLabel;
}

export function reportTransitionRequiresReason(from: ReportReviewState, to: ReportReviewState): boolean {
  return to === "rejected" || to === "resolved" || (to === "reviewing" && from !== "received");
}

export function reportTransitionRequiresConfirmation(from: ReportReviewState, to: ReportReviewState): boolean {
  return reportTransitionRequiresReason(from, to);
}
```

Replace the state definitions in `src/shared/publication.ts` with re-exports so old imports remain valid:

```ts
export {
  REPORT_REVIEW_STATES,
  hunterReportState,
  isReportReviewState,
  nextReportStates,
  reportStateCopy,
  reportTransitionRequiresConfirmation,
  reportTransitionRequiresReason,
  type HunterReportState,
  type ReportReviewState,
} from "./report-workflow";
```

- [ ] **Step 4: Run shared and existing Ops behavior tests**

Run:

```powershell
npx tsx --test tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts
npm run typecheck:worker
npm run typecheck:client
```

Expected: all tests and both typechecks PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/shared/report-workflow.ts src/shared/publication.ts tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "refactor: centralize private report workflow"
```

## Task 2: Make status and assignment mutations explicit and atomic

**Files:**

- Modify: `src/server/types.ts:1-6,357-371`
- Modify: `src/server/app.ts:1737-1756`
- Modify: `src/server/d1-store.ts:3159-3269`
- Modify: `tests/api-test-kit.ts:149-223,1081-1099`
- Modify: `tests/api-auth.test.ts:848-895`
- Modify: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Add failing API and real-D1 workflow tests**

In `tests/api-auth.test.ts`, replace the legacy `{ status, note }` PATCH with explicit requests and cover ambiguous input:

```ts
const transition = await app.request("https://www.timlostsomething.com/api/v1/ops/reports/report-1", {
  method: "PATCH",
  ...json({
    operation: "transition",
    expectedStatus: "received",
    status: "reviewing",
    note: "Checking the supplied details.",
    confirmed: false,
  }, headers),
});
assert.equal(transition.status, 200);
assert.equal((await responseJson(transition)).data.status, "reviewing");

const ambiguous = await app.request("https://www.timlostsomething.com/api/v1/ops/reports/report-1", {
  method: "PATCH",
  ...json({ status: "verified", assignedTo: null }, headers),
});
assert.equal(ambiguous.status, 422);
assert.equal((await responseJson(ambiguous)).error.code, "validation_failed");
```

Add the following exact API cases:

| Starting state | Request | Expected |
|---|---|---|
| `reviewing` | transition to `contacted`, no note, `confirmed: false` | 200 |
| `contacted` | transition to `reviewing`, no note | 422 `report_transition_reason_required` |
| `contacted` | transition to `reviewing`, note present, `confirmed: false` | 422 `report_transition_confirmation_required` |
| `rejected` | transition to `reviewing`, note present, `confirmed: true`, different active staff token | 200 and assignment becomes that staff subject |
| `verified` | transition to `resolved`, note present, `confirmed: true` | 200 |
| any | `expectedStatus` different from stored state | 409 `report_transition_stale` |
| assigned `reviewing` | `operation: "unassign"`, `confirmed: true` | 200, status unchanged, assignment null |
| unassigned `reviewing` | `operation: "unassign"` | 409 `report_assignment_stale` |
| any | request with no `operation` or with browser-supplied `assignedTo` | 422 `validation_failed` |
| any | valid body with hunter or anonymous authorization | 401/403 and zero mutations |

Add one focused D1 integration test named `guided report workflow is atomic, reversible and audited`. Seed one report in each state and assert:

```ts
assert.deepEqual(
  await Promise.all([
    store.updateReport("received", {
      operation: "transition", expectedStatus: "received", status: "reviewing",
      note: null, confirmed: false,
    }, "staff-a"),
    store.updateReport("rejected", {
      operation: "transition", expectedStatus: "rejected", status: "reviewing",
      note: "A second operator supplied corrected evidence.", confirmed: true,
    }, "staff-b"),
  ]).then((items) => items.map((item) => item?.status)),
  ["reviewing", "reviewing"],
);
```

Exercise every allowed edge with separate seeded records:

```ts
const allowedEdges = [
  ["received", "reviewing"], ["received", "rejected"],
  ["reviewing", "contacted"], ["reviewing", "escalated"],
  ["reviewing", "verified"], ["reviewing", "rejected"],
  ["contacted", "reviewing"], ["contacted", "escalated"],
  ["contacted", "verified"], ["contacted", "rejected"],
  ["escalated", "reviewing"], ["escalated", "contacted"],
  ["escalated", "verified"], ["escalated", "rejected"],
  ["verified", "reviewing"], ["verified", "resolved"],
  ["rejected", "reviewing"], ["resolved", "reviewing"],
] as const;
```

For each edge, supply reason/confirmation according to the shared helper and assert one report event plus one audit event. Iterate every other unequal state pair and assert 409 `report_transition_invalid`, unchanged report row, and zero history rows. Race two identical transition calls with `Promise.allSettled`; require exactly one fulfilled result, one rejected conflict, one report event and one audit event. Repeat the successful request once more and require the same one-event counts.

The D1 test must also assert exact previous/new state metadata, assignment changes, actor, reason and timestamp. Snapshot linked Case Note and Official Update rows before each status mutation and prove they are byte-for-byte unchanged afterward.

- [ ] **Step 2: Run the focused tests and confirm old mutation behavior fails**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts
npx tsx --test --test-name-pattern "guided report workflow is atomic" tests/api-store-integration.test.ts
```

Expected: FAIL because the route does not require an operation/expected state, rejected reports cannot reopen, and unassign is not implemented.

- [ ] **Step 3: Add a discriminated server mutation type**

At the top of `src/server/types.ts`, import the shared type and define the exact store input:

```ts
import type { ReportReviewState } from "../shared/report-workflow";
import type { TransactionalMailAcceptance } from "./transactional-mail";

export type ReportWorkflowMutation =
  | {
      operation: "transition";
      expectedStatus: ReportReviewState;
      status: ReportReviewState;
      note: string | null;
      confirmed: boolean;
    }
  | {
      operation: "unassign";
      expectedStatus: ReportReviewState;
      note: string | null;
      confirmed: boolean;
    };
```

Change the data-store interface to:

```ts
updateReport(
  id: string,
  input: ReportWorkflowMutation,
  actorSubject: string,
): Promise<Record<string, unknown> | null>;
```

- [ ] **Step 4: Parse only the explicit API contract**

Replace the current report PATCH body in `src/server/app.ts` with the following validation shape:

```ts
const operation = requiredString(body, "operation", { max: 20 });
const expectedStatus = requiredString(body, "expectedStatus", { max: 20 });
if (Object.hasOwn(body, "assignedTo")) {
  throw new ApiError(422, "validation_failed", "Report assignment cannot be set through a status request.");
}
if (!isReportReviewState(expectedStatus)) {
  throw new ApiError(422, "validation_failed", "Expected report status is invalid.", { field: "expectedStatus" });
}
const note = optionalString(body, "note", 2_000);
const confirmed = body.confirmed === true;

let mutation: ReportWorkflowMutation;
if (operation === "transition") {
  const status = requiredString(body, "status", { max: 20 });
  if (!isReportReviewState(status)) {
    throw new ApiError(422, "validation_failed", "Report status is invalid.", { field: "status" });
  }
  mutation = { operation, expectedStatus, status, note, confirmed };
} else if (operation === "unassign") {
  if (Object.hasOwn(body, "status") || Object.hasOwn(body, "assignedTo")) {
    throw new ApiError(422, "validation_failed", "Unassign does not accept a status or assignment value.");
  }
  mutation = { operation, expectedStatus, note, confirmed };
} else {
  throw new ApiError(422, "validation_failed", "Report operation is invalid.", { field: "operation" });
}
```

Import `isReportReviewState` and `ReportWorkflowMutation`; remove `assignedTo` from browser-controlled input. Continue to call `sameOrigin` and `requireStaff` before mutation parsing.
Remove the now-unused `validReportStates` constant from `src/server/app.ts`.

- [ ] **Step 5: Enforce the transition and public-content guards in D1**

In `src/server/d1-store.ts`, import the new shared helpers and typed mutation. Before any write:

```ts
if (existing.status !== input.expectedStatus) {
  throw new ApiError(409, "report_transition_stale", "The report changed. Refresh and try again.");
}
if (input.operation === "transition") {
  if (!nextReportStates(input.expectedStatus).includes(input.status)) {
    throw new ApiError(409, "report_transition_invalid",
      `Invalid report transition: cannot move from ${input.expectedStatus} to ${input.status}.`);
  }
  if (reportTransitionRequiresReason(input.expectedStatus, input.status) && !input.note?.trim()) {
    throw new ApiError(422, "report_transition_reason_required", "Record a private reason for this status change.");
  }
  if (reportTransitionRequiresConfirmation(input.expectedStatus, input.status) && !input.confirmed) {
    throw new ApiError(422, "report_transition_confirmation_required", "Confirm this audited status change.");
  }
}
```

Treat an Official Update as active when its linked status is `draft`, `scheduled`, or `published`. Block `verified -> reviewing`, all moves to `resolved`, and all moves to `rejected` while it is active. Treat a Case Note as public only when its linked status is `published`; block a move to `rejected` until it is withdrawn. Use these exact errors:

```ts
throw new ApiError(409, "report_official_update_active",
  "Withdraw the linked Official Update before changing this report to that state.",
  { destination: "official_update", action: "withdraw" });

throw new ApiError(409, "report_case_note_active",
  "Withdraw the linked Case Note before rejecting this report.",
  { destination: "case_note", action: "withdraw" });
```

Repeat the same guard predicates inside the conditional D1 `UPDATE`, so a publication created between the read and batch makes the update affect zero rows and returns `report_transition_stale` rather than weakening the state.

- [ ] **Step 6: Preserve assignment and append both histories atomically**

For a transition, calculate assignment exactly as follows:

```ts
const previousAssignedTo = typeof existing.assignedTo === "string" && existing.assignedTo
  ? existing.assignedTo
  : null;
const assignedTo = input.status === "reviewing" &&
    (input.expectedStatus === "received" || input.expectedStatus === "rejected" || input.expectedStatus === "resolved")
  ? actorSubject
  : previousAssignedTo ?? actorSubject;
```

Use the existing operation-token batch pattern. The first statement conditionally writes the temporary marker only when status and prior assignment still match. The report event uses `status.<new-state>`. The audit metadata must be:

```ts
{
  operation: "transition",
  previousStatus: input.expectedStatus,
  status: input.status,
  reason: input.note,
  previousAssignedTo,
  assignedTo,
  assignmentChanged: previousAssignedTo !== assignedTo,
}
```

For `operation: "unassign"`, require `confirmed === true` and a non-null current assignment. Missing confirmation returns 422 `report_transition_confirmation_required`; an already-unassigned or stale assignment returns 409 `report_assignment_stale`. Keep the status unchanged, use `assignment.unassigned` as the report event, `report.unassigned` as the audit action, and record:

```ts
{
  operation: "unassign",
  previousStatus: input.expectedStatus,
  status: input.expectedStatus,
  reason: input.note,
  previousAssignedTo,
  assignedTo: null,
  assignmentChanged: true,
}
```

The conditional update, report-event insert, audit insert, and marker cleanup must all report one changed row. A second identical request must return a 409 conflict and leave the existing one report event and one audit event untouched.

- [ ] **Step 7: Mirror the contract in `FakeStore`**

Add `reportEvents: Array<Record<string, unknown>> = []` to `FakeStore`. Replace `updateReport` with the same graph, reason, confirmation, assignment and publication checks. Push one report event and one audit event only after all validation succeeds. Project active linked Updates and Case Notes from the existing FakeStore maps; never use `Object.assign(report, input)`, because `operation`, `expectedStatus`, `confirmed` and private note are not report columns.

- [ ] **Step 8: Run focused tests, typecheck and commit**

```powershell
npx tsx --test tests/report-workflow.test.ts tests/api-auth.test.ts
npx tsx --test --test-name-pattern "guided report workflow is atomic" tests/api-store-integration.test.ts
npm run typecheck:worker
npm run typecheck:tests
git diff --check
git add src/server/types.ts src/server/app.ts src/server/d1-store.ts tests/api-test-kit.ts tests/api-auth.test.ts tests/api-store-integration.test.ts
git commit -m "feat: add audited reversible report workflow"
```

Expected: all focused tests PASS; no migration file is created.

## Task 3: Project recent Ops history and hunter-safe outcomes

**Files:**

- Modify: `src/server/d1-store.ts:2087-2167,3116-3135`
- Modify: `tests/api-test-kit.ts:706-715,1020-1059`
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Add failing privacy and projection tests**

Add an authenticated hunter API test with one report belonging to the hunter and another belonging to someone else. Give the hunter's report `rejected` state, a private reason, an operator assignment, a published Case Note and a published Official Update. Assert the response contains only:

```ts
assert.deepEqual(dashboard.reports, [{
  id: "report-own",
  type: "tip",
  hunterStatus: "Closed",
  createdAt: "2026-07-18T10:00:00.000Z",
  publications: [
    { kind: "case_note", label: "Published in Case Notes", href: "/clue-board" },
    { kind: "official_update", label: "Used in an Official Update", href: "/updates" },
  ],
}]);
assert.doesNotMatch(JSON.stringify(dashboard.reports),
  /rejected|operator-|private reason|other-hunter|reporter_email|evidence/i);
```

Add D1 cases for all seven internal states, no-publication, Case Note only, Official Update only, both destinations, withdrawn content, a future scheduled Update, and a due scheduled Update. The future scheduled item is not public; the due scheduled item is `Used in an Official Update`.

Add an Ops-detail assertion that `history` contains only recent `status.*` and `assignment.unassigned` events, newest first, with `id`, `type`, `actor`, `note`, and `occurredAt`.

- [ ] **Step 2: Run focused projection tests and confirm they fail**

```powershell
npx tsx --test --test-name-pattern "hunter report projection|recent report workflow history" tests/api-auth.test.ts
npx tsx --test --test-name-pattern "hunter report projection|recent report workflow history" tests/api-store-integration.test.ts
```

Expected: FAIL because the Dashboard still returns raw status and Ops detail has no recent history.

- [ ] **Step 3: Replace the hunter report query with a privacy-safe joined projection**

In `getHunterDashboard`, join only the signed-in subject's reports to their one linked operator-reviewed Case Note and one linked Official Update:

```sql
SELECT r.id, r.report_type, r.status, r.created_at,
       note.id AS case_note_id, note.status AS case_note_status,
       published_update.id AS update_id, published_update.status AS update_status,
       published_update.scheduled_for AS update_scheduled_for
FROM private_reports r
LEFT JOIN operator_reviewed_case_notes note ON note.source_report_id = r.id
LEFT JOIN official_updates published_update ON published_update.source_report_id = r.id
WHERE r.hunter_subject = ?
ORDER BY r.created_at DESC
```

Map each row with `hunterReportState`. Do not include raw status. Build destinations in stable Case Note then Official Update order:

```ts
const publications = [];
if (row.case_note_status === "published") {
  publications.push({ kind: "case_note", label: "Published in Case Notes", href: "/clue-board" });
}
const updateIsPublic = row.update_status === "published" ||
  (row.update_status === "scheduled" && nullable(row.update_scheduled_for) !== null &&
    value(row.update_scheduled_for) <= dashboardTimestamp);
if (updateIsPublic) {
  publications.push({ kind: "official_update", label: "Used in an Official Update", href: "/updates" });
}
```

Return only `id`, `type`, `hunterStatus`, `createdAt`, and `publications` for each report.

- [ ] **Step 4: Add recent workflow history to Ops detail**

In `getReportDetail`, include this read in the existing parallel query group:

```sql
SELECT id, event_type, actor_subject, note, occurred_at
FROM report_events
WHERE report_id = ?
  AND (event_type LIKE 'status.%' OR event_type = 'assignment.unassigned')
ORDER BY occurred_at DESC, id DESC
LIMIT 8
```

Return:

```ts
history: history.results.map((row) => ({
  id: value(row.id),
  type: value(row.event_type),
  actor: nullable(row.actor_subject),
  note: nullable(row.note),
  occurredAt: value(row.occurred_at),
}))
```

This route remains staff-authorized and no new public endpoint is added.

- [ ] **Step 5: Match the same projections in FakeStore**

Use `hunterReportState` in `FakeStore.getHunterDashboard`. Determine Case Note and Official Update visibility from the existing maps and return the same five fields as D1. Include filtered recent `reportEvents` in `getReportDetail`. Do not expose the full report object through the Dashboard.

- [ ] **Step 6: Run projection, privacy and authorization tests; commit**

```powershell
npx tsx --test --test-name-pattern "hunter report projection|recent report workflow history" tests/api-auth.test.ts
npx tsx --test --test-name-pattern "hunter report projection|recent report workflow history" tests/api-store-integration.test.ts
npm run typecheck:worker
npm run typecheck:tests
git diff --check
git add src/server/d1-store.ts tests/api-test-kit.ts tests/api-auth.test.ts tests/api-store-integration.test.ts
git commit -m "feat: project private report outcomes safely"
```

## Task 4: Replace the Ops state controls with a guided workflow panel

**Files:**

- Modify: `ops.html:285-346`
- Modify: `src/client/ops.ts:53-107,523-648,1292-1371,1515-1543,1943-2376,3086-3110,3449-3465`
- Modify: `css/ops.css:328-376,404-438`
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs:99-132,213-250`

- [ ] **Step 1: Add failing Ops normalization and control tests**

Extend `OpsReportDetail` test fixtures with:

```ts
history: [{
  id: "event-1",
  type: "status.reviewing",
  actor: "staff-1",
  note: "Initial assessment",
  occurredAt: "2026-07-18T10:05:00.000Z",
}],
```

Add pure tests for:

```ts
const model = reportWorkflowControls(detail, "reviewing");
assert.equal(model.currentLabel, "Resolved");
assert.match(model.currentExplanation, /internal work.*complete/i);
assert.deepEqual(model.destinations.map((item) => item.value), ["reviewing"]);
assert.equal(model.reasonRequired, true);
assert.equal(model.confirmationRequired, true);

assert.deepEqual(buildReportWorkflowMutation(detail, {
  operation: "transition",
  status: "reviewing",
  note: "New evidence requires another review.",
  confirmed: true,
}), {
  operation: "transition",
  expectedStatus: "resolved",
  status: "reviewing",
  note: "New evidence requires another review.",
  confirmed: true,
});
```

Add contract assertions that `Begin review`, `data-report-begin-review`, the old `Add an optional private note for this status change` prompt, and `assignedTo` report-workflow mutation fields are absent. Do not change the existing Moderation Queue or sponsorship prompts. Require persistent labels for current status, explanation, `Move report to`, private reason, `Apply status`, `Unassign report`, `Refresh report`, recent history, and Public Outcome guidance. Assert the select has no mutation listener and only the Apply button invokes the PATCH.

- [ ] **Step 2: Run the focused Ops tests and confirm they fail**

```powershell
npx tsx --test tests/ops-board-ui-behavior.test.ts
node --test tests/ops-board-ui-contract.test.mjs
```

Expected: FAIL on the missing workflow model and the still-present Begin Review/prompt controls.

- [ ] **Step 3: Extend and strictly normalize Ops report detail**

Add this type beside `OpsReportDetail`:

```ts
export interface OpsReportHistoryEvent {
  id: string;
  type: string;
  actor: string | null;
  note: string | null;
  occurredAt: string;
}
```

Add `history: OpsReportHistoryEvent[]` to `OpsReportDetail`. Normalize only event types matching `status.<known-state>` or `assignment.unassigned`, require a valid id and timestamp string, limit to eight, and drop malformed rows rather than rendering them.

- [ ] **Step 4: Replace the Review State markup**

Replace `ops.html` lines 297-307 with this structure:

```html
<section class="ops-report-status" data-report-status-actions aria-labelledby="report-workflow-title">
  <h4 id="report-workflow-title">Review workflow</h4>
  <p>Private review state and public publication are separate audited decisions.</p>
  <div class="ops-report-state-summary" data-report-state-summary>
    <strong>Status: Loading</strong><span>Assigned to: Loading</span>
  </div>
  <p class="ops-report-status__explanation" data-report-status-explanation></p>
  <label for="report-next-status">Move report to</label>
  <select id="report-next-status" data-report-next-status aria-describedby="report-next-status-help" disabled>
    <option value="">Choose a next stage</option>
  </select>
  <p id="report-next-status-help" class="ops-panel__note" data-report-next-status-help>
    Choose a stage to see what it means. Nothing saves until Apply status.
  </p>
  <label for="report-status-note">Private note or reason <span data-report-reason-requirement>(optional)</span></label>
  <textarea id="report-status-note" data-report-status-note rows="3" maxlength="2000" disabled></textarea>
  <div class="ops-action-row ops-action-row--workflow">
    <button class="ops-button ops-button--primary" type="button" data-report-save-status disabled>Apply status</button>
    <button class="ops-button ops-button--quiet" type="button" data-report-unassign disabled>Unassign report</button>
    <button class="ops-button ops-button--quiet" type="button" data-report-refresh>Refresh report</button>
  </div>
  <p class="ops-inline-result" data-report-workflow-result role="status" aria-live="polite" tabindex="-1"></p>
  <details class="ops-report-history">
    <summary>Recent status history</summary>
    <ol data-report-history></ol>
    <button class="ops-button ops-button--quiet" type="button" data-report-open-audit>Open full audit trail</button>
  </details>
</section>
```

Add `id="report-public-title"` as a focusable Public Outcome heading, a `data-report-public-guidance` status paragraph beneath the destination cards, and a non-mutating `Prepare public outcome` button that is shown only for a verified report and moves focus to the Public Outcome heading.

- [ ] **Step 5: Implement pure control and mutation builders**

Import the shared workflow functions directly from `../shared/report-workflow`. Export:

```ts
export function reportWorkflowControls(
  detail: Pick<OpsReportDetail, "status" | "assignedTo" | "publication" | "caseNote">,
  selected: string,
): {
  currentLabel: string;
  currentExplanation: string;
  destinations: Array<{ value: ReportReviewState; label: string; explanation: string; blockedReason: string | null }>;
  reasonRequired: boolean;
  confirmationRequired: boolean;
  canUnassign: boolean;
} {
  if (!isReportReviewState(detail.status)) {
    return {
      currentLabel: "Unknown",
      currentExplanation: "Refresh this report before changing its workflow.",
      destinations: [],
      reasonRequired: false,
      confirmationRequired: false,
      canUnassign: false,
    };
  }
  const current = detail.status;
  const officialUpdateActive = detail.publication.status !== null && detail.publication.status !== "withdrawn";
  const caseNotePublic = detail.caseNote.status === "published";
  const destinations = nextReportStates(current).map((destination) => {
    const copy = reportStateCopy(destination);
    const officialUpdateBlocks = officialUpdateActive && (
      destination === "resolved" || destination === "rejected" ||
      (current === "verified" && destination === "reviewing")
    );
    const caseNoteBlocks = caseNotePublic && destination === "rejected";
    return {
      value: destination,
      label: copy.operatorLabel,
      explanation: copy.operatorExplanation,
      blockedReason: officialUpdateBlocks
        ? "Withdraw the linked Official Update first."
        : caseNoteBlocks
          ? "Withdraw the linked Case Note first."
          : null,
    };
  });
  const selectedState = isReportReviewState(selected) &&
      nextReportStates(current).includes(selected)
    ? selected
    : null;
  return {
    currentLabel: reportStateCopy(current).operatorLabel,
    currentExplanation: reportStateCopy(current).operatorExplanation,
    destinations,
    reasonRequired: selectedState !== null && reportTransitionRequiresReason(current, selectedState),
    confirmationRequired: selectedState !== null && reportTransitionRequiresConfirmation(current, selectedState),
    canUnassign: detail.assignedTo !== null,
  };
}

export function buildReportWorkflowMutation(
  detail: Pick<OpsReportDetail, "status">,
  intent:
    | { operation: "transition"; status: ReportReviewState; note: string; confirmed: boolean }
    | { operation: "unassign"; note: string; confirmed: boolean },
): Record<string, unknown> {
  return intent.operation === "transition"
    ? {
        operation: "transition",
        expectedStatus: detail.status,
        status: intent.status,
        note: intent.note.trim() || undefined,
        confirmed: intent.confirmed,
      }
    : {
        operation: "unassign",
        expectedStatus: detail.status,
        note: intent.note.trim() || undefined,
        confirmed: intent.confirmed,
      };
}
```

Implement `renderReportHistory` using escaped text and `<time datetime>`. Show the new state, actor or `System`, optional private note, and localized time. Keep the global audit view staff-only.

- [ ] **Step 6: Replace prompts with deliberate Apply and Unassign handlers**

On select `change`, update only helper text, required marker and button disabled state. Do not call `fetch`, `opsRequest`, or `updateActiveReportStatus` from the select listener.
When a destination has `blockedReason`, disable that option and present its exact reason in the helper text; the server remains the final guard.

On Apply:

```ts
const from = activeReportDetail.status as ReportReviewState;
const to = statusSelect.value as ReportReviewState;
const note = noteField.value.trim();
const requiresReason = reportTransitionRequiresReason(from, to);
if (requiresReason && !note) {
  setReportWorkflowResult("Record a private reason before applying this status.", "error");
  noteField.focus();
  return;
}
const confirmed = !reportTransitionRequiresConfirmation(from, to) || window.confirm(
  `Change this report from ${reportStateCopy(from).operatorLabel} to ${reportStateCopy(to).operatorLabel}? ` +
  "This change will be recorded in the audit trail and will not publish anything."
);
if (!confirmed) return;
```

Send the explicit mutation. Clear the note only after a successful response. On failure, leave selection and note untouched. Parse the error code; for `report_transition_stale` or `version_conflict`, show `The report changed. Refresh report and try again.` and leave Refresh enabled.

On Unassign, require `window.confirm("Unassign this report? Its review status will not change, and the action will be recorded.")`; use the same note as an optional private note. Any successful mutation refreshes report detail, queue, command counts and audit.

The `Open full audit trail` handler closes the dialog, switches to `#audit`, and lets the existing view loader run. The report trigger remains the focus fallback when the drawer closes normally.

- [ ] **Step 7: Add exact Public Outcome prerequisites**

Export and render this server-consistent guidance in `data-report-public-guidance`:

```ts
export function reportPublicOutcomeGuidance(detail: OpsReportDetail, selected: string): string {
  const activeUpdate = detail.publication.status !== null && detail.publication.status !== "withdrawn";
  if (activeUpdate) {
    return "Withdraw the linked Official Update before reopening or closing this report.";
  }
  if (detail.caseNote.status === "published" && selected === "rejected") {
    return "Withdraw the linked Case Note before rejecting this report.";
  }
  if (detail.status === "resolved" || detail.status === "rejected") {
    return "Reopen this report for review before preparing a new public outcome.";
  }
  if (detail.status === "verified") {
    return "Facts are verified. Choose and review a public outcome; nothing publishes automatically.";
  }
  return "Case Notes remain a separate editorial decision. Verify the report before scheduling or publishing an Official Update.";
}
```

Keep every media checkbox unchecked by default. Do not modify Case Note or Official Update endpoints.

- [ ] **Step 8: Add responsive and accessible styling**

In `css/ops.css`, make `.ops-report-status` a single-column grid; set labels, select, textarea and buttons to at least 44px; wrap action rows; style the text status badge without relying on colour; make history rows readable; and keep Review Workflow before Public Outcome when `.ops-report-dialog__grid` collapses. At 620px, controls fill the drawer width and no element creates horizontal overflow.

- [ ] **Step 9: Run focused Ops tests and commit**

```powershell
npx tsx --test tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/ops-board-ui-contract.test.mjs
npm run typecheck:client
git diff --check
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-behavior.test.ts tests/ops-board-ui-contract.test.mjs
git commit -m "feat: guide operators through report review"
```

## Task 5: Explain private intake and render hunter-safe history

**Files:**

- Modify: `src/client/report.ts:247-253`
- Modify: `report.html:170-194`
- Modify: `src/client/dashboard.ts:1008-1048`
- Modify: `dashboard.html:175-181`
- Modify: `css/hunter.css:417-445,1044-1052`
- Modify: `tests/hunter-ui-client.test.ts`
- Modify: `tests/hunter-account-contract.test.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Add failing receipt and Dashboard tests**

In `tests/hunter-ui-client.test.ts`, assert the exact receipt meaning:

```ts
assert.deepEqual(reportSuccessModel({ data: { id: "report-123" } }), {
  reference: "report-123",
  heading: "Report received privately",
  message: "Your report was sent privately to the SebaHub case team. It is not public. " +
    "We may contact you to verify details. After review, a representative from SebaHub may publish " +
    "an edited Case Note or Official Update. Your email, phone number and private details will not be published.",
});
```

Add normalization tests for all hunter statuses and publication combinations. Malformed hrefs, unknown kinds, raw status, reasons, operator identities and private fields must never render.

Add static-page assertions that the receipt fallback and `What happens next` section use `Received`, `Under review`, `Verified`, and `Closed` language and distinguish `Not published`, `Published in Case Notes`, and `Used in an Official Update`.

- [ ] **Step 2: Run focused hunter tests and confirm they fail**

```powershell
npx tsx --test tests/hunter-ui-client.test.ts
node --test tests/hunter-account-contract.test.mjs tests/hunter-ui-pages.test.mjs
```

Expected: FAIL on the old one-sentence receipt and raw generic report renderer.

- [ ] **Step 3: Update the persistent submission receipt**

Change `reportSuccessModel` to the tested exact copy. Make the same copy the static fallback in `report.html`. Replace the internal-status list under `What happens next` with:

```html
<ol class="plain-list">
  <li><strong>Received:</strong> your submission and evidence are stored privately.</li>
  <li><strong>Under review:</strong> a representative from SebaHub checks the details and may contact you.</li>
  <li><strong>Verified:</strong> the relevant facts were confirmed.</li>
  <li><strong>Closed:</strong> the team's private work on the report is complete.</li>
</ol>
<p>A public Case Note or Official Update is a separate edited decision. Your report never publishes automatically.</p>
```

- [ ] **Step 4: Add a dedicated hunter-report normalizer and renderer**

In `src/client/dashboard.ts`, define:

```ts
export interface HunterDashboardReport {
  id: string;
  type: string;
  hunterStatus: "Received" | "Under review" | "Verified" | "Closed";
  createdAt: string;
  publications: Array<{
    kind: "case_note" | "official_update";
    label: "Published in Case Notes" | "Used in an Official Update";
    href: "/clue-board" | "/updates";
  }>;
}
```

Export `normalizeHunterReports(value)` and accept only the exact states, kinds, labels and same-origin paths above. Ignore all unknown properties. Replace `renderRecords` for reports with `renderHunterReports`; retain `renderRecords` for the user's Case Notes.

Each report row renders type, reference, received date, hunter status, and a separate publication area. When `publications` is empty, render plain text `Not published`. When destinations exist, render one safe link per destination. Never derive a label from a raw server status.

- [ ] **Step 5: Style the private status and publication labels**

Add `.report-history-item`, `.report-history-status`, and `.report-publications` rules to `css/hunter.css`. Preserve the existing one-column mobile fallback, 44px link targets and wrapping at long references. Add explanatory copy above the list in `dashboard.html`:

```html
<p>Your report stays private. Review status and any edited public use are shown separately.</p>
```

- [ ] **Step 6: Run hunter tests, build, and commit**

```powershell
npx tsx --test tests/hunter-ui-client.test.ts
node --test tests/hunter-account-contract.test.mjs tests/hunter-ui-pages.test.mjs
npm run typecheck:client
npm run build
git diff --check
git add src/client/report.ts report.html src/client/dashboard.ts dashboard.html css/hunter.css tests/hunter-ui-client.test.ts tests/hunter-account-contract.test.mjs tests/hunter-ui-pages.test.mjs
git commit -m "feat: explain hunter report outcomes"
```

## Task 6: Add validation-safe end-to-end workflow coverage

**Files:**

- Modify: `scripts/verify-unified-shell-qa.mjs`
- Modify: `tests/unified-shell-qa-contract.test.mjs`

- [ ] **Step 1: Add failing QA-contract assertions**

Require the unified-shell runner to exercise these local mocked writes and no others:

```text
PATCH /api/v1/ops/reports/report-workflow-qa-001
```

Require named scenarios for received-to-reviewing assignment, contacted-to-reviewing reason confirmation, rejected/resolved reopen, unassign without status change, stale response recovery, active-publication guards, hunter-safe Dashboard projection, and zero Moderation Queue mutation.

Run:

```powershell
node --test tests/unified-shell-qa-contract.test.mjs
```

Expected: FAIL because the runner does not contain the new workflow journey.

- [ ] **Step 2: Extend the local QA fixture and mutation ledger**

Use one in-memory report record and update it only inside the local fixture. For each intercepted PATCH, validate `operation`, `expectedStatus`, reason and confirmation exactly as the worker does. Record the requested mutation, return a normalized Ops detail with recent history, and never contact Clerk, Cloudflare, validation, production or any external origin.

The stale fixture returns:

```json
{
  "error": {
    "code": "report_transition_stale",
    "message": "The report changed. Refresh and try again."
  }
}
```

The hunter fixture returns one owned report with `hunterStatus` and public destinations plus private sentinel fields at the fixture boundary. Assert the rendered Dashboard omits every sentinel.

- [ ] **Step 3: Exercise responsive, keyboard and privacy behavior**

At desktop and 390px mobile sizes, use only keyboard activation to open the report, change the select, enter a reason, cancel then accept confirmation, unassign, open recent history, and close the dialog. Assert:

```text
- changing the select sends zero writes;
- Apply sends exactly one explicit transition write;
- a failed write preserves the entered reason;
- no status is conveyed only by colour;
- all workflow controls have accessible names and at least 44px targets;
- Review Workflow appears before Public Outcome on mobile;
- the drawer and Dashboard have no horizontal overflow;
- no report mutation creates or withdraws a public item;
- Moderation Queue state and request counts remain unchanged;
- no private reason, staff subject, email, phone, evidence key or child identity appears in hunter/public output.
```

- [ ] **Step 4: Run the local browser gate and commit**

```powershell
node --test tests/unified-shell-qa-contract.test.mjs
npm run build
npm run verify:unified-shell-qa
git diff --check
git add scripts/verify-unified-shell-qa.mjs tests/unified-shell-qa-contract.test.mjs
git commit -m "test: verify reversible report workflow"
```

## Task 7: Run the complete local release gate

**Files:**

- None: this task is a verification gate. If a command exposes a defect, return to the task that owns that exact file, add a failing regression, fix it, recommit, and restart this gate.

- [ ] **Step 1: Run focused red-green suites again**

```powershell
npx tsx --test tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts tests/hunter-ui-client.test.ts tests/api-auth.test.ts
npx tsx --test --test-name-pattern "guided report workflow|hunter report projection|recent report workflow history" tests/api-store-integration.test.ts
node --test tests/ops-board-ui-contract.test.mjs tests/hunter-account-contract.test.mjs tests/hunter-ui-pages.test.mjs tests/unified-shell-qa-contract.test.mjs
```

Expected: all focused tests PASS with zero skips.

- [ ] **Step 2: Run exact legal, type, build and full automated gates**

```powershell
npm run legal:verify
npm run typecheck
npm run build
npm run test:legacy
npm run test:unit
npm run verify:unified-shell-qa
npm run verify:waiver-qa
node scripts/qa-output-privacy.mjs dist
git diff --check
```

Expected: all commands PASS; generated legal artifacts remain byte-identical; served-public privacy findings are zero. If the known local Miniflare full-file runner hangs, stop only that exact test process, record the occurrence, rerun the named real-D1 workflow tests above, and do not claim the full D1 file passed.

- [ ] **Step 3: Review the complete diff against explicit exclusions**

```powershell
git status --short
git diff --stat HEAD~6..HEAD
git diff HEAD~6..HEAD -- src/server/app.ts src/server/d1-store.ts src/client/ops.ts src/client/dashboard.ts src/client/report.ts ops.html dashboard.html report.html css/ops.css css/hunter.css
rg -n "Begin review|data-report-begin-review|Add an optional private note for this status change|assignedTo.*body" src/client/ops.ts ops.html src/server/app.ts
```

Expected: no matches. The unrelated Moderation Queue and sponsorship prompts remain unchanged; the diff contains no legal-body, Moderation Queue, notification, migration or automatic-publication change.

## Task 8: Deploy only to validation and prepare owner acceptance

**Files:**

- Modify: `README.md`
- Modify: `STATUS.md`
- Create: `docs/operations/2026-07-18-private-report-workflow-validation.md`

- [ ] **Step 1: Record a count-only production baseline without writes**

Run this read-only query and retain its JSON under gitignored `.wrangler/release-safety/`:

```powershell
New-Item -ItemType Directory -Force .wrangler/release-safety | Out-Null
$baselineSql = @"
SELECT
  (SELECT environment FROM environment_metadata WHERE id = 1) AS environment,
  (SELECT COUNT(*) FROM player_accounts) AS players,
  (SELECT COUNT(*) FROM private_reports) AS reports,
  (SELECT COUNT(*) FROM operator_reviewed_case_notes) AS report_case_notes,
  (SELECT COUNT(*) FROM official_updates) AS updates,
  (SELECT COUNT(*) FROM staff_principals) AS staff,
  (SELECT COUNT(*) FROM audit_events) AS audits,
  (SELECT COUNT(*) FROM report_events) AS report_events,
  (SELECT COUNT(*) FROM media_uploads) AS media,
  (SELECT COUNT(*) FROM legal_acceptance_events) AS legal_acceptances,
  (SELECT COUNT(*) FROM waypoints WHERE is_published = 1) AS waypoints;
PRAGMA foreign_key_check;
"@
npx wrangler d1 execute tim-lost-hunter-platform --remote --json --command $baselineSql |
  Tee-Object .wrangler/release-safety/private-report-workflow-before.json
```

Expected: `environment` is `production`, the foreign-key result is empty, and the command contains no INSERT, UPDATE, DELETE, migration, R2, queue or Pages operation.

- [ ] **Step 2: Verify validation bindings and deploy the exact commit**

```powershell
node scripts/verify-environment.mjs
npm run build
$hash = (git rev-parse --short HEAD).Trim()
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation --commit-hash $hash --commit-message "Validation: guided reversible private report workflow"
```

Expected: Wrangler returns an immutable `*.seba-treasure-hunt.pages.dev` URL. Both that URL and `https://codex-validation.seba-treasure-hunt.pages.dev/api/v1/config` report `deploymentEnvironment: validation`. Do not run migrations; this release has none.

- [ ] **Step 3: Exercise the authenticated owner checklist with disposable validation records**

Using only validation records, verify in the opened Private Report:

```text
1. Received -> Reviewing assigns the acting operator without requiring a reason.
2. Reviewing -> Contacted retains assignment.
3. Contacted -> Reviewing requires a reason and explicit confirmation.
4. Reviewing -> Rejected requires a reason and explicit confirmation.
5. Rejected -> Reviewing works for a different authorized operator and assigns that operator.
6. Verified -> Resolved requires a reason and explicit confirmation.
7. Resolved -> Reviewing works and does not republish withdrawn content.
8. Unassign keeps the same status and records history.
9. A stale second tab fails closed and offers Refresh report.
10. An active Official Update blocks reopening/closing until withdrawal.
11. A public Case Note blocks rejection until withdrawal.
12. Selecting a status alone performs no write.
13. Public media stays unselected until the operator checks it.
14. Review status changes never publish, withdraw or republish Case Notes or Official Updates.
15. Hunter Dashboard shows only Received / Under review / Verified / Closed and separate public destinations.
16. Hunter receipt explains private intake and possible edited public use.
17. Moderation Queue behavior is unchanged.
```

Repeat at desktop width, 390px mobile width, keyboard-only navigation and 200% zoom. Check the browser console and network log for errors or unexpected writes.

- [ ] **Step 4: Prove production stayed unchanged**

Repeat the exact Step 1 query into `.wrangler/release-safety/private-report-workflow-after.json` and compare normalized rows:

```powershell
npx wrangler d1 execute tim-lost-hunter-platform --remote --json --command $baselineSql |
  Tee-Object .wrangler/release-safety/private-report-workflow-after.json
$before = Get-Content .wrangler/release-safety/private-report-workflow-before.json -Raw | ConvertFrom-Json
$after = Get-Content .wrangler/release-safety/private-report-workflow-after.json -Raw | ConvertFrom-Json
if (($before | ConvertTo-Json -Depth 20 -Compress) -ne ($after | ConvertTo-Json -Depth 20 -Compress)) {
  throw "Production baseline changed during validation release."
}
```

Expected: exact match and no production write.

- [ ] **Step 5: Write the validation record and operator documentation**

Update `README.md` with the guided graph, reason/confirmation rules, unassign behavior, status/publication separation and hunter labels. In `docs/operations/2026-07-18-private-report-workflow-validation.md`, record exact commits, automated counts, immutable/stable URLs, owner results, production before/after counts, known limitations and rollback boundary. Update `STATUS.md` with the same dated facts and the explicit statement that production was not promoted.

- [ ] **Step 6: Commit only documentation and stop for production approval**

```powershell
git add README.md STATUS.md docs/operations/2026-07-18-private-report-workflow-validation.md
git commit -m "docs: record private report workflow validation"
git status --short
```

Expected: clean worktree. Report the exact validation commit and URLs to Murphy. Do not deploy, migrate or mutate production without a separate explicit approval.

## Rollback boundary

- Code rollback: redeploy the prior immutable validation commit; no database rollback is required because this plan adds no migration.
- Validation records: disposable workflow records may remain for audit during owner review and may be wiped only through the existing validation-reset process.
- Production: remains untouched throughout implementation and validation. A later production promotion must repeat the complete verification gate, read-only before/after baselines and explicit owner approval.
