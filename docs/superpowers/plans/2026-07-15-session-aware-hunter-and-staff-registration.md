# Session-Aware Hunter and Staff Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require legal review in hunter signup, expose authenticated route links and a global account control, prevent duplicate Clerk code requests, and allow verified company-domain staff to self-register for Ops.

**Architecture:** Clerk remains the password, verification and session provider. D1 remains the authorization and append-only legal authority. Browser controls collect and carry the approved signup intent through verification, while existing authenticated APIs write the final profile and legal events. Staff domain enrollment is an atomic D1 authorization decision made only from a verified staff JWT email claim.

**Tech Stack:** TypeScript, Clerk JS/backend JWTs, Hono, Cloudflare Pages Workers, D1, esbuild, Node test runner, Playwright.

---

### Task 1: Serialize identity submissions

**Files:**
- Create: `src/client/identity-submission.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `src/client/ops.ts`
- Test: `tests/identity-submission.test.ts`

- [ ] Write a failing unit test proving a second concurrent call is ignored and a later call is permitted after the first settles.
- [ ] Run `npx tsx --test tests/identity-submission.test.ts` and confirm the missing helper fails.
- [ ] Implement `createSerializedSubmission()` with a closure-scoped in-flight flag and apply it to hunter signup/recovery and staff signup/recovery submit handlers, including disabled-button progress copy.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Enforce company-domain staff enrollment

**Files:**
- Modify: `src/server/d1-store.ts`
- Modify: `tests/api-test-kit.ts`
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/api-store-integration.test.ts`

- [ ] Add failing API and D1 tests for exact `sebahub.com` and `businessasaforceforgood.ca` activation, lookalike-domain rejection, and suspended/revoked preservation.
- [ ] Run the focused API/store tests and confirm the new cases fail.
- [ ] Implement an exact-domain parser and atomic first-login principal insertion inside `isActiveStaff`; preserve invitation activation and audit both paths.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Add staff signup and verification UI

**Files:**
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] Add failing contract and behavior tests for Create staff account, the two approved domain hints, email/password validation, email-code verification and post-verification `/api/v1/ops/session` authorization.
- [ ] Run the focused Ops tests and confirm failure for missing UI/behavior.
- [ ] Implement Clerk staff `signUp.create`, `prepareEmailAddressVerification`, verification, session activation and server authorization. Do not grant browser-side roles.
- [ ] Run the focused Ops tests and confirm they pass.

### Task 4: Gate hunter signup on current legal review and finalize after verification

**Files:**
- Modify: `dashboard.html`
- Modify: `src/client/dashboard.ts`
- Modify: `css/hunter.css`
- Modify: `tests/hunter-ui-pages.test.mjs`
- Modify: `tests/hunter-ui-client.test.ts`
- Modify: `tests/waiver-ui-client.test.ts`

- [ ] Add failing tests requiring full name, adult attestation, opened Privacy/Media and waiver documents, separate acceptance boxes, and no Clerk signup call before validation passes.
- [ ] Add a failing orchestration test requiring this order after email verification: bootstrap, profile/Privacy write, waiver document fetch, waiver review write, waiver acceptance write, dashboard refresh.
- [ ] Run the focused hunter tests and confirm the intended failures.
- [ ] Implement same-page document viewers, a retained signup draft, validation, serialized code delivery and post-verification legal finalization using the existing versioned APIs.
- [ ] Preserve fail-closed recovery for pre-existing incomplete accounts and confirm focused tests pass.

### Task 5: Add canonical account control

**Files:**
- Modify: `scripts/campaign-shell.mjs`
- Modify: `css/campaign-shell.css`
- Create: `src/client/account.ts`
- Modify: `tests/campaign-shell.test.mjs`
- Modify: `tests/campaign-shell-accessibility.test.mjs`
- Create: `tests/account-client.test.ts`

- [ ] Add failing shell and client tests for signed-out Sign in, signed-in avatar/initial plus privacy-safe handle, Dashboard/Edit profile links, Sign out and mobile navigation containment.
- [ ] Run focused tests and confirm failure.
- [ ] Render the fail-safe account container in the canonical shell and inject the bundled account module on every campaign page.
- [ ] Implement Clerk session detection, private profile lookup, accessible menu behavior and sign out without deriving a name from email.
- [ ] Run focused tests and confirm they pass.

### Task 6: Make the route session-aware

**Files:**
- Modify: `route.html`
- Create: `src/client/route.ts`
- Create: `tests/route-client.test.ts`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] Add failing tests showing signed-out detail is concealed, incomplete accounts receive an onboarding action, and unlocked hunters receive twelve protected waypoint projections with exact links only when provided by the server.
- [ ] Run focused tests and confirm failure.
- [ ] Mark the detailed route ledger as authenticated content, add a signed-out gate, and implement the Clerk-aware route client against `/api/v1/member/waypoints`.
- [ ] Ensure zone/case-locked rows never synthesize links, then run the focused tests.

### Task 7: Verify, review and stage

**Files:**
- Modify: `STATUS.md`
- Create: `docs/qa/2026-07-15-session-aware-authentication-verification.md`

- [ ] Run `npm test`, `npm run typecheck`, `npm run legal:verify`, `npm run build`, `npm run verify:unified-shell-qa`, and the public-output privacy scan.
- [ ] Run a read-only STRIDE/OWASP review over the new staff enrollment, legal finalization and protected route paths; fix any High/Critical issue through a new failing test before continuing.
- [ ] Run browser QA against a local build, then deploy only to `codex-validation.seba-treasure-hunt.pages.dev` under the preview bindings.
- [ ] Verify hunter signup, one verification email request, legal finalization, header identity, protected route links, sign out and approved-domain staff enrollment. Do not reset validation data.
- [ ] Record evidence and remaining production gates in QA and STATUS docs, stage only scoped files, commit and push the current `codex/` branch.
