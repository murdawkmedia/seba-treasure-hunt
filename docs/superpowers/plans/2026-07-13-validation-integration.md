# Validation Integration Implementation Plan

Date: 2026-07-13

Status: Ready for execution

Design: `docs/superpowers/specs/2026-07-13-validation-integration-and-production-promotion-design.md`

## Objective

Turn the existing noindex `codex-validation` deployment into a disposable, fully isolated integration environment for hunter accounts, staff access, human verification, private uploads, moderation and operations. Keep production unchanged, keep waiver-dependent participation locked, and stop at provider steps that require the project owner to create or confirm an account.

## Task 1: Add an environment sentinel and fail-closed write guard

Files:

- Create `migrations/0004_environment_metadata.sql`.
- Create `src/server/environment-guard.ts`.
- Modify `src/server/types.ts`.
- Modify `src/server/app.ts`.
- Modify `src/worker.ts`.
- Create `tests/api-environment-guard.test.ts`.
- Modify `tests/api-test-kit.ts`.
- Modify `tests/api-schema.test.ts`.

Steps:

1. Write failing tests proving authenticated writes, public report writes, legal acceptances, staff actions and upload reservations return `503 environment_mismatch` before storage or queue mutation when `DEPLOYMENT_ENV` differs from the D1 sentinel.
2. Add an `environment_metadata` table with exactly one expected-environment record and a constrained `validation|production` value.
3. Extend the data-store contract with a read-only environment lookup and implement it in D1 and the test store.
4. Add a request-scoped guard that compares configured `DEPLOYMENT_ENV` to the D1 sentinel and caches only successful comparisons briefly within an isolate.
5. Invoke the guard immediately before every stateful route and before private upload work. Reads remain available when appropriate; writes fail closed when the guard is unavailable.
6. Include `DEPLOYMENT_ENV` in the Worker application-cache signature.
7. Run the focused environment tests, schema tests, type checks and full suite.

## Task 2: Make environment identity visible without leaking configuration

Files:

- Modify `src/server/types.ts`.
- Modify `src/server/app.ts`.
- Modify `src/worker.ts`.
- Modify `scripts/build.mjs` if a dedicated client bundle is required.
- Modify the twelve public HTML pages.
- Modify `css/style.css`.
- Create `src/client/environment-notice.ts` if dynamic rendering is used.
- Modify `tests/api-public.test.ts`.
- Modify `tests/hunter-ui-pages.test.mjs`.

Steps:

1. Write failing API and page-contract tests for a public runtime `deploymentEnvironment` value and a persistent validation notice.
2. Return only `validation` or `production` in runtime configuration; never return binding names, database IDs or secrets.
3. Render the notice `Validation environment — test accounts and submissions will be deleted before launch.` on every validation page, with an accessible status/notice role and a compact mobile-safe layout.
4. Ensure production does not render the notice.
5. Preserve preview `X-Robots-Tag: noindex` behavior and add tests for the stable branch alias.
6. Run page, API, accessibility-oriented and build tests.

## Task 3: Isolate Cloudflare preview bindings

Files:

- Modify `wrangler.toml`.
- Modify `wrangler.media.toml`.
- Create `docs/validation-resource-manifest.example.md` containing names only, never secrets or private principals.
- Modify `README.md`.

Cloudflare resources to provision:

- D1: `tim-lost-hunter-platform-validation`.
- R2: `tim-lost-private-media-validation`.
- KV: `tim-lost-rate-limits-validation`.
- Queue: `tim-lost-media-processing-validation`.
- Dead-letter queue: `tim-lost-media-dlq-validation`.
- Worker: `tim-lost-media-processor-validation`.

Steps:

1. Inventory the active Murdawk Media account and confirm whether each validation-suffixed resource already exists.
2. Provision only missing validation resources.
3. Add `[env.preview.vars]` and preview binding overrides with `DEPLOYMENT_ENV=validation`, the stable validation authorized-party URL and the validation-only Turnstile hostname.
4. Set production `DEPLOYMENT_ENV=production` without changing current production secrets or deploying the feature branch.
5. Give the validation media worker only validation D1, R2, queue and Images bindings.
6. Validate Wrangler configuration and prove that preview and production resolved configs do not share D1, R2, KV or queue identifiers.
7. Record resource names and non-secret IDs in the project-local manifest and keep credentials out of Git.

## Task 4: Initialize validation data safely

Files:

- Modify `migrations/0004_environment_metadata.sql` if remote validation reveals portability issues.
- Modify the existing idempotent seed script or seed SQL used by the project.
- Create `scripts/verify-environment.mjs`.
- Create `tests/environment-script.test.mjs`.

Steps:

1. Write failing script tests for environment verification, wrong-sentinel rejection and production-key rejection in validation.
2. Apply migrations `0001` through `0004` to the validation D1 database only.
3. Insert the validation sentinel and run the existing idempotent public campaign seed.
4. Add a read-only verifier that checks environment, case state, 12 public waypoints, rules, zones and zero staff principals without printing personal rows.
5. Run the verifier against validation and save only aggregate, non-personal evidence in `STATUS.md`.

## Task 5: Guard provider keys and authentication hosts

Files:

- Create `src/server/provider-environment.ts`.
- Modify `src/worker.ts`.
- Modify `src/server/auth.ts`.
- Modify `tests/auth-parties.test.ts`.
- Create `tests/provider-environment.test.ts`.

Steps:

1. Write failing tests proving production rejects Clerk test/development key prefixes and validation rejects immutable deployment URLs as authorized parties.
2. Permit hunter and staff development keys only when `DEPLOYMENT_ENV=validation`.
3. Restrict authenticated validation sessions and redirects to `https://codex-validation.seba-treasure-hunt.pages.dev`.
4. Leave immutable deployment URLs available for unauthenticated smoke tests only.
5. Ensure missing or invalid provider configuration disables the affected flow with a safe `503`, not a permissive fallback.

## Task 6: Deploy and verify the isolated validation media processor

Files:

- Modify `src/media-worker.ts`.
- Modify `wrangler.media.toml`.
- Modify `tests/media-worker.test.ts`.
- Modify `STATUS.md`.

Steps:

1. Write failing tests for media-worker environment mismatch, cross-environment object keys and failure-before-derivative behavior.
2. Add `DEPLOYMENT_ENV` and the D1 sentinel check to queue processing.
3. Namespace validation object keys and reject keys that do not match the active environment.
4. Deploy `tim-lost-media-processor-validation` with validation-only bindings.
5. Send one synthetic raster through the validation queue, verify a metadata-free private derivative is created, verify no public original path exists, then delete the synthetic test objects and rows.

## Task 7: Configure Turnstile or pause for owner action

Provider state:

- Validation widget hostname: `codex-validation.seba-treasure-hunt.pages.dev`.
- Public site key may be exposed through runtime config.
- Secret key must be stored through Cloudflare secret storage only.

Steps:

1. Inspect the active Cloudflare session for permission to create and manage Turnstile widgets.
2. If authorized, create a validation-only managed widget and store its secret for preview without displaying or committing it.
3. If Cloudflare requires an owner-only confirmation, stop this task and provide Murphy the exact one-minute setup action and values to return.
4. Verify valid, missing, wrong-action, wrong-host and replayed/expired token paths against the validation API.

## Task 8: Configure hunter Clerk or pause for owner action

Provider state:

- Dedicated Clerk development application for validation hunters.
- Verified email/password accounts.
- Minimum 12-character password and compromised-password protection.
- Provider-managed email verification, recovery and session revocation.
- Stable validation alias only.

Steps:

1. Inspect whether an authenticated Clerk organization/session is already available without exposing account details.
2. If authorized, create or configure the development application, allowed origins, redirects and webhook endpoint.
3. Store publishable configuration in preview variables and secret/webhook values in Cloudflare secret storage.
4. If owner login, terms acceptance or mailbox confirmation is required, stop and provide the exact setup checklist.
5. Run signup, verification, password login, failed login, recovery and session-revocation tests using disposable validation accounts.
6. Verify a D1 player row appears only after verified identity lifecycle intake and that no password or reset code reaches D1 or logs.

## Task 9: Configure invitation-only staff Clerk or pause for owner action

Files/state:

- Separate Clerk development application.
- Private staff-principal seed, excluded from public source and artifacts.

Steps:

1. Create/configure the staff development application only if the active provider session permits it.
2. Store staff publishable/secret values separately from hunter identity.
3. Invite the four already approved operators through private provider configuration and seed only verified provider subjects in validation D1.
4. Verify password login, recovery, session revocation, D1 authorization repetition, suspension/reactivation and provider-managed password boundaries.
5. Confirm no staff address or allowlist appears in the repository, browser configuration, public API or build output.

## Task 10: Deploy the stable validation branch and battle-test

Files:

- Modify tests as needed for discovered regressions.
- Modify `README.md`.
- Modify `STATUS.md`.

Steps:

1. Run `npm ci`, favicon generation/verification, all tests, all type checks, production builds and `npm audit --omit=dev --audit-level=high`.
2. Run the public-release privacy scan and explicit unconfirmed-partner scan against source and `dist/`.
3. Deploy the exact tested commit to the `codex-validation` preview branch only.
4. Exercise the full battle-test matrix from the approved design on desktop and mobile.
5. Verify account/profile/legal records and uploads live only in validation resources.
6. Verify the waiver remains disabled and exact directions, progress writes and community participation remain locked.
7. Record the immutable deployment URL, stable-alias checks, non-personal resource counts and test evidence in `STATUS.md`.

## Task 11: Add a guarded validation purge tool

Files:

- Create `scripts/purge-validation-data.mjs`.
- Create `tests/purge-validation-data.test.mjs`.
- Modify `README.md`.

Steps:

1. Write failing tests for missing confirmation, wrong environment, wrong sentinel, non-validation resource name and non-empty queue safeguards.
2. Implement dry-run counts for Clerk users, personal D1 rows, R2 objects, KV keys and queue/dead-letter state.
3. Require `DEPLOYMENT_ENV=validation`, a validation D1 sentinel, validation-suffixed resource names and an explicit typed confirmation.
4. Keep destructive execution unavailable by default and never run it before a separately confirmed post-launch purge.
5. Verify the dry run prints aggregate counts only.

## Task 12: Prepare, but do not execute, production promotion

Files:

- Create `docs/production-promotion-checklist.md`.
- Modify `STATUS.md`.

Steps:

1. Record the exact battle-tested commit SHA and validation deployment evidence.
2. List clean production resources and provider applications that must be created separately.
3. Require explicit approval before production migrations, secrets, bindings, custom-domain deployment or validation-data purge.
4. Include rollback to the previous Pages deployment and a write-disable procedure.
5. Keep production empty of validation users, consents, submissions, uploads and activity records.

## Completion Gate

Validation integration is complete only when Tasks 1 through 11 pass, or when provider-owned Tasks 7 through 9 are explicitly documented as the sole remaining blocks. Production promotion remains a separate approval-gated operation under Task 12.
