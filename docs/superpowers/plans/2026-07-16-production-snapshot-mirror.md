# Production Snapshot Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authenticated validation Ops users a full-fidelity, read-only production snapshot without allowing validation to mutate production.

**Architecture:** Bind validation to dedicated snapshot D1/R2 resources, expose them only through a narrow read-only repository and `/api/v1/ops/production-snapshot/*` GET routes, and render a clearly separate Ops view. A guarded local script performs manual one-way refreshes from production using allowlisted D1 tables, version-prefixed R2 objects and atomic D1 replacement.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/R2/Pages, Wrangler CLI, Node test runner, existing Clerk-compatible Staff authentication.

---

### Task 1: Read-only snapshot repository contract

**Files:**
- Create: `src/server/production-snapshot.ts`
- Create: `tests/production-snapshot.test.ts`
- Modify: `src/server/types.ts:419-470`

- [ ] **Step 1: Write failing repository tests**

Create a fake D1 binding that records SQL and returns snapshot metadata, report, player, staff and audit rows. Assert the public repository exposes only `summary`, `listReports`, `getReport`, `getReportMedia`, `listPlayers`, `listStaff`, `listAudit` and `getWaiver`; assert every recorded SQL statement begins with `SELECT` or `WITH`; and assert metadata must identify `production-snapshot`.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `npx tsx --test tests/production-snapshot.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Add snapshot types and bindings**

```ts
export interface ProductionSnapshotStore {
  summary(): Promise<Record<string, unknown> | null>;
  listReports(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getReport(id: string): Promise<Record<string, unknown> | null>;
  getReportMedia(reportId: string, mediaId: string): Promise<{ key: string; contentType: string } | null>;
  listPlayers(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  listStaff(): Promise<Record<string, unknown>[]>;
  listAudit(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getWaiver(subject: string): Promise<Record<string, unknown> | null>;
}
```

Add optional `productionSnapshot` and `productionSnapshotMedia` dependencies and optional `PRODUCTION_SNAPSHOT_DB`/`PRODUCTION_SNAPSHOT_MEDIA` `PagesEnv` bindings.

- [ ] **Step 4: Implement `D1ProductionSnapshotStore`**

Use parameterized `SELECT`/`WITH` statements only. Return full reporter contact fields, participation/minor state, legal versions, staff records and audit fields. Resolve report media only when it is owned by the selected report, is ready, and has a snapshot-prefixed object key. Return a stale/unavailable summary when `snapshot_refresh_metadata.status` is not `verified`.

- [ ] **Step 5: Run the repository tests**

Run: `npx tsx --test tests/production-snapshot.test.ts`

Expected: PASS and no mutation SQL observed.

- [ ] **Step 6: Commit the repository**

```powershell
git add src/server/production-snapshot.ts src/server/types.ts tests/production-snapshot.test.ts
git commit -m "feat: add read-only production snapshot repository"
```

### Task 2: Staff-only snapshot API

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/worker.ts`
- Create: `tests/api-production-snapshot.test.ts`
- Modify: `tests/api-test-kit.ts`

- [ ] **Step 1: Write failing authorization and method tests**

Test every snapshot GET route as signed out (401), hunter (401), inactive staff (403) and active staff (200). Test POST, PUT, PATCH and DELETE under the snapshot namespace return 404/405 without invoking the repository. Test media responses use `private, no-store`, `nosniff`, sandbox CSP and same-origin resource policy.

- [ ] **Step 2: Run the API test and verify failures**

Run: `npx tsx --test tests/api-production-snapshot.test.ts`

Expected: FAIL because the endpoints and dependency do not exist.

- [ ] **Step 3: Add GET-only routes**

Add:

```text
GET /api/v1/ops/production-snapshot
GET /api/v1/ops/production-snapshot/reports
GET /api/v1/ops/production-snapshot/reports/:id
GET /api/v1/ops/production-snapshot/reports/:id/media/:mediaId
GET /api/v1/ops/production-snapshot/players
GET /api/v1/ops/production-snapshot/players/:subject/waiver
GET /api/v1/ops/production-snapshot/staff
GET /api/v1/ops/production-snapshot/audit
```

Each route calls the existing `requireStaff` against the validation `store`, then the snapshot dependency. Missing bindings return 503 `production_snapshot_unavailable`; they never fall back to `deps.store` or production.

- [ ] **Step 4: Compose snapshot bindings validation-only**

In `worker.ts`, instantiate the snapshot repository and read-only R2 storage only when `DEPLOYMENT_ENV === "validation"`. Production receives `undefined` snapshot dependencies even if a binding is accidentally present.

- [ ] **Step 5: Run API and environment tests**

Run: `npx tsx --test tests/api-production-snapshot.test.ts tests/api-auth.test.ts tests/api-environment-guard.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the API**

```powershell
git add src/server/app.ts src/worker.ts tests/api-production-snapshot.test.ts tests/api-test-kit.ts
git commit -m "feat: expose staff-only production snapshot API"
```

### Task 3: Clearly separate read-only Ops experience

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing UI contract tests**

Assert a `Production snapshot` navigation item and panel exist; the panel contains a persistent `Read-only production snapshot` label, refresh timestamp, Reports, Players, Staff and Audit tables, and a dedicated read-only report dialog. Assert there are no form, approval, publication, email, recovery, session, or mutation controls inside the snapshot panel/dialog.

- [ ] **Step 2: Run the Ops tests and verify failures**

Run: `node --test tests/ops-board-ui-contract.test.mjs && npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: FAIL on the missing snapshot view.

- [ ] **Step 3: Add the snapshot panel and dialog**

Add an eleventh navigation item and a panel with `data-view-panel="production-snapshot"`. Include source state, verified timestamp and counts, four read-only tables, and a separate report-detail dialog containing private detail and evidence output only.

- [ ] **Step 4: Add client loaders and guards**

Load snapshot data only after Staff session initialization and only when the snapshot view is first selected. Prefix every request with `/api/v1/ops/production-snapshot`. Render real full-fidelity values. Use a separate dialog and state object so existing validation report mutation handlers cannot receive a snapshot report ID. Fetch evidence as authenticated blobs, revoke object URLs on dialog close, and show unavailable/stale states without falling back.

- [ ] **Step 5: Add unmistakable read-only styling**

Use a persistent red-accented read-only banner, source timestamp and disabled-action-free layout. Preserve mobile table scrolling, keyboard focus return and 200%-zoom usability.

- [ ] **Step 6: Run focused UI tests**

Run: `node --test tests/ops-board-ui-contract.test.mjs && npx tsx --test tests/ops-board-ui-behavior.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the Ops view**

```powershell
git add ops.html src/client/ops.ts css/ops.css tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts
git commit -m "feat: add read-only production snapshot view"
```

### Task 4: Guarded manual snapshot refresh

**Files:**
- Create: `scripts/refresh-production-snapshot.mjs`
- Create: `tests/production-snapshot-refresh.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write failing refresh-guard tests**

Test exported pure functions for resource-name validation, source sentinel verification, destination sentinel verification, allowlisted tables, reverse delete ordering, version-prefixed media keys, redacted summaries and refusal when source/destination identifiers collide with production or validation.

- [ ] **Step 2: Run the refresh tests and verify the missing-module failure**

Run: `node --test tests/production-snapshot-refresh.test.mjs`

Expected: FAIL because the refresh script does not exist.

- [ ] **Step 3: Implement immutable guard helpers**

Use exact defaults:

```js
export const defaults = Object.freeze({
  sourceDatabase: "tim-lost-hunter-platform",
  sourceBucket: "tim-lost-private-media",
  destinationDatabase: "tim-lost-hunter-platform-production-snapshot",
  destinationBucket: "tim-lost-private-media-production-snapshot",
});
```

Require the destination names to end in `-production-snapshot`, require the source environment to equal `production`, require the destination `snapshot_refresh_metadata.kind` to equal `production-snapshot`, and reject any matching resource names or IDs.

- [ ] **Step 4: Implement the D1 refresh**

Export only campaign/application tables; exclude OAuth provider state, notification delivery/leases, operator-alert recipients, rate-limit buckets, idempotency keys and webhook events. Generate one D1 SQL file containing `BEGIN`, reverse-order deletes, exported inserts, snapshot-prefixed media-key updates, one verified metadata row and `COMMIT`. Execute it remotely only after the export and media copy verify.

- [ ] **Step 5: Implement versioned R2 copy**

Query production `media_uploads` for private and derivative keys, download each source object with `wrangler r2 object get`, hash it locally, and upload it to `snapshots/<snapshot-id>/<source-key>` in the dedicated snapshot bucket. Verify each uploaded object before committing D1. On failure, delete only objects under the new snapshot prefix and retain the previous verified snapshot.

- [ ] **Step 6: Add safe command and environment documentation**

Add `"snapshot:refresh": "node scripts/refresh-production-snapshot.mjs"`. The script reads optional resource overrides from a gitignored `.env.local`, never prints PII, and writes only a redacted JSON report under `.wrangler/snapshot-reports/`.

- [ ] **Step 7: Run refresh tests**

Run: `node --test tests/production-snapshot-refresh.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the refresh workflow**

```powershell
git add scripts/refresh-production-snapshot.mjs tests/production-snapshot-refresh.test.mjs package.json .env.example
git commit -m "feat: add guarded production snapshot refresh"
```

### Task 5: Validation-only Cloudflare bindings

**Files:**
- Modify: `wrangler.toml`
- Modify: `tests/validation-bindings.test.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write failing binding isolation tests**

Assert `PRODUCTION_SNAPSHOT_DB` and `PRODUCTION_SNAPSHOT_MEDIA` exist only under `env.preview`; their names end with `-production-snapshot`; production has no snapshot binding; normal preview `DB`/`UPLOADS` remain validation resources; and the snapshot repository is never used for writes.

- [ ] **Step 2: Run the binding test and verify failure**

Run: `node --test tests/validation-bindings.test.mjs`

Expected: FAIL because the snapshot bindings do not exist.

- [ ] **Step 3: Provision dedicated resources**

Use Wrangler CLI to create `tim-lost-hunter-platform-production-snapshot` and `tim-lost-private-media-production-snapshot`. Apply the current schema to the D1 destination, create the `snapshot_refresh_metadata` sentinel table, and disable any public R2 development URL.

- [ ] **Step 4: Add preview-only bindings**

Add the returned immutable D1 identifier and snapshot R2 bucket to `env.preview`. Do not add production bindings or reuse the production/validation resource identifiers.

- [ ] **Step 5: Run binding and build tests**

Run: `node --test tests/validation-bindings.test.mjs && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 6: Document operation and rollback**

Document manual refresh, read-only Staff behavior, full-fidelity privacy scope, resource identifiers, verification, stale-state handling and rollback to the prior verified snapshot.

- [ ] **Step 7: Commit bindings and docs**

```powershell
git add wrangler.toml tests/validation-bindings.test.mjs README.md
git commit -m "ops: bind validation production snapshot resources"
```

### Task 6: Full validation and first manual refresh

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/operations/2026-07-16-production-release.md`

- [ ] **Step 1: Record production baselines**

Read and record the production environment sentinel, protected table counts and referenced media-object inventory without printing PII. Do not issue any production mutation command.

- [ ] **Step 2: Run the first guarded refresh**

Run: `npm run snapshot:refresh`

Expected: a redacted success report with verified source/destination sentinels, row counts, object counts and zero production writes.

- [ ] **Step 3: Run the complete quality gate**

Run: `npm test && npm run legal:verify && npm run typecheck && npm run build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Deploy validation only**

Deploy `dist` to the `codex-validation` Pages branch. Do not promote to production.

- [ ] **Step 5: End-to-end authorization and visual review**

Verify signed-out and hunter sessions cannot obtain snapshot status, counts, records or media. Verify active Staff can view real mirrored reports, players, staff, audit, waiver and private evidence; no snapshot mutation controls exist; all responses are `private, no-store`; and existing validation report mutations still target only validation.

- [ ] **Step 6: Prove production was untouched**

Repeat the production baselines and compare them to Step 1. Record zero writes/deletes/object mutations caused by validation or refresh.

- [ ] **Step 7: Update handoff documents and commit**

Record snapshot ID/time, validation deployment URL, test totals, production baseline comparison, rollback and remaining follow-ups in `STATUS.md` and the operations release note.

```powershell
git add STATUS.md docs/operations/2026-07-16-production-release.md
git commit -m "docs: verify validation production snapshot"
```
