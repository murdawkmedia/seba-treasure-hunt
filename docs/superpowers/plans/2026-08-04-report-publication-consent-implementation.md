# Report Publication Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report-time privacy choices visible in Ops and enforce `Keep private` as a server-side lock on Case Notes and Official Updates.

**Architecture:** Extend the existing report publication preview so the persisted `publication_preference` participates in the same eligibility result already consumed by all public-report mutations. Mirror the rule in the fake store, then render explicit credit and consent rows and reuse the eligibility reason to disable public UI controls.

**Tech Stack:** TypeScript, Cloudflare D1, Node test runner, existing Ops HTML render helpers.

---

### Task 1: Add report-review UI regressions

**Files:**
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `src/client/ops.ts`

- [ ] **Step 1: Write the failing detail-render test**

Add assertions that `renderReportPrivateDetail()` emits `Case Note credit`, the stored safe attribution, `Hunter sharing choice`, and `Keep private — public publishing locked` for a private report.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because the current renderer uses the generic `Sharing choice` label and has no explicit `Case Note credit` row.

- [ ] **Step 3: Implement the minimal rendering change**

Update `renderReportPrivateDetail()` to render the four distinct operator rows from the approved design. Do not expose the private account identity in the public preview.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

### Task 2: Enforce private consent in the real D1 store

**Files:**
- Modify: `tests/api-store-integration.test.ts`
- Modify: `src/server/d1-store.ts`

- [ ] **Step 1: Write failing Case Note and Official Update tests**

Create a `private_reports` row with `publication_preference = 'private'`, otherwise valid attribution and status, then assert that `publishReportToCaseNotes()` and the existing Official Update mutation reject with `report_publication_ineligible` and leave no public record.

- [ ] **Step 2: Run the integration tests and verify RED**

Run: `npx tsx --test tests/api-store-integration.test.ts`

Expected: FAIL because the current publication preview ignores `publication_preference`.

- [ ] **Step 3: Implement the minimal source-of-truth check**

Select `r.publication_preference` in `reportPublicationPreview()`. Before account/profile eligibility, return an ineligible preview with reason `hunter_requested_private` when the stored value is not exactly `share_after_review`.

- [ ] **Step 4: Run the integration tests and verify GREEN**

Run: `npx tsx --test tests/api-store-integration.test.ts`

Expected: PASS.

### Task 3: Mirror consent enforcement in test infrastructure and UI controls

**Files:**
- Modify: `tests/api-test-kit.ts`
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `src/client/ops.ts`

- [ ] **Step 1: Add failing fake-store and UI-control assertions**

Assert that a fake private report produces `publicationEligible: false` with `hunter_requested_private`, and that the Ops review model disables Case Note and Official Update actions while explaining the hunter-selected lock.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-public.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because the fake preview and operator copy do not yet distinguish private consent.

- [ ] **Step 3: Implement the minimal mirror and copy changes**

Update `reportPublicationPreview()` in `tests/api-test-kit.ts` to apply the same exact-value rule. Map `hunter_requested_private` to clear locked-state guidance in the Ops review screen; continue using `publicationEligible` for control disabling.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx tsx --test tests/api-auth.test.ts tests/api-public.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

### Task 4: Verify and checkpoint exact paths

**Files:**
- Modify: `STATUS.md`
- Verify: all files listed above

- [ ] **Step 1: Run complete gates**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands exit 0 with no failed tests or type errors.

- [ ] **Step 2: Review privacy and diff scope**

Run: `git diff --check`

Run: `git diff -- src/client/ops.ts src/server/d1-store.ts tests/ops-board-ui-behavior.test.ts tests/api-store-integration.test.ts tests/api-test-kit.ts docs/superpowers/specs/2026-08-04-report-publication-consent-design.md docs/superpowers/plans/2026-08-04-report-publication-consent-implementation.md STATUS.md`

Expected: only the approved consent/attribution work appears; no private report data or credentials are present.

- [ ] **Step 3: Update handoff status**

Record the behavior change, verification evidence, and deployment status in `STATUS.md` without altering unrelated active-release notes.

- [ ] **Step 4: Create an exact-path local checkpoint**

Stage only the files in this plan and create a focused local commit. Do not push or deploy without a separate explicit instruction.
