# Mobile Signup and Account Recovery Implementation Plan

> **Execution contract:** Implement test-first in the validation branch. Preserve the authoritative Privacy Policy, Media Notice, and Participation Waiver bodies and hashes. Do not deploy or mutate production.

**Goal:** Make hunter signup, legal review, email verification, profile completion, returning sign-in, and the shared account header reliable and understandable on mobile, including reloads and delayed Clerk webhooks.

**Architecture:** Keep Clerk as the password, verification, recovery, session, and compromised-password provider. Add one browser-global Clerk/session coordinator shared by the account header and Dashboard bundles, a safe versioned signup-resume record that excludes secrets, a presentation-only legal embed mode, and explicit verification/finishing states. Continue using existing D1 bootstrap, legal-acceptance, waiver-receipt, and profile APIs without schema changes.

**Technology:** TypeScript, Clerk browser SDK, HTML/CSS, esbuild, Node test runner, Playwright QA, Cloudflare Pages/Workers, D1.

---

## Task 1: Make legal review optional, escapable, and accessible

**Files:**

- Modify: `dashboard.html`
- Modify: `css/hunter.css`
- Modify: `src/client/dashboard.ts`
- Create: `src/client/legal-embed.ts`
- Modify: `scripts/build.mjs`
- Modify: `scripts/generate-waiver.mjs`
- Regenerate: `waiver.html`
- Modify: `privacy.html`
- Test: `tests/hunter-account-contract.test.mjs`
- Test: `tests/hunter-ui-client.test.ts`
- Test: `tests/hunter-ui-pages.test.mjs`
- Test: `tests/waiver-document.test.mjs`
- Test: `tests/waiver-qa-contract.test.mjs`

### Step 1: Add failing document and signup contract tests

Add assertions that:

- privacy and waiver acceptance checkboxes are enabled, required, and unchecked before either document is opened;
- loading, opening, or closing a legal document never checks either acceptance box;
- each dialog has a labelled top close control and a sticky bottom `Done — back to account setup` button;
- opening a dialog moves focus into it and either close control restores focus to the triggering button;
- Escape closes the dialog;
- the embedded legal page exposes the authoritative document content but hides the public header, footer, navigation, print/registration action row, and other cyclic navigation;
- the non-embedded `/privacy` and `/waiver` pages remain complete and independently navigable;
- the waiver source version, effective date, body text, and document hash are unchanged.

Run the focused tests and confirm they fail for the missing behavior:

```powershell
npm run legal:verify
node --test tests/hunter-account-contract.test.mjs tests/hunter-ui-pages.test.mjs tests/waiver-document.test.mjs tests/waiver-qa-contract.test.mjs
npx tsx --test tests/hunter-ui-client.test.ts
```

### Step 2: Implement a clean legal embed entry

Create `src/client/legal-embed.ts` as a presentation-only entrypoint that:

- activates only for `?embed=signup`;
- adds a stable embed class/attribute before interactive use;
- hides shared campaign chrome and page-only actions without changing the legal article;
- sends a same-origin `postMessage` readiness event to the parent;
- does not read, write, or infer legal acceptance.

Update `scripts/build.mjs` only as needed so helper modules are not accidentally emitted as unrelated entrypoints. Include the embed script on both legal documents. Update the waiver generator rather than patching only the generated waiver. Regenerate `waiver.html` and confirm the authoritative legal body and hash remain exact.

### Step 3: Replace implicit review state with explicit dialog behavior

In `dashboard.html`, add the bottom Done buttons and dialog descriptions. In `dashboard.ts`:

- remove checkbox disabling/unlocking tied to iframe load;
- keep checkbox state under the participant's direct control;
- open and close the legal dialog without modifying acceptance;
- restore focus to the originating legal-document button;
- handle iframe load failure with a readable error and a safe full-page link;
- ignore untrusted `postMessage` origins.

In `hunter.css`, make the legal dialog fit small screens, add the sticky footer action, retain a visible close button, and give checkbox/radio rows a minimum 44-by-44-pixel activation target.

### Step 4: Re-run focused tests and commit

Run the commands from Step 1 plus:

```powershell
npm run legal:generate
npm run legal:verify
npm run typecheck:client
git diff --check
```

Commit only Task 1 files:

```powershell
git add dashboard.html css/hunter.css src/client/dashboard.ts src/client/legal-embed.ts scripts/build.mjs scripts/generate-waiver.mjs waiver.html privacy.html tests/hunter-account-contract.test.mjs tests/hunter-ui-client.test.ts tests/hunter-ui-pages.test.mjs tests/waiver-document.test.mjs tests/waiver-qa-contract.test.mjs
git commit -m "fix: simplify mobile legal review"
```

## Task 2: Persist safe signup progress and recover verification

**Files:**

- Create: `src/client/hunter-signup-resume.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `dashboard.html`
- Modify: `css/hunter.css`
- Test: `tests/hunter-registration.test.ts`
- Test: `tests/hunter-ui-client.test.ts`
- Test: `tests/hunter-account-contract.test.mjs`

### Step 1: Add failing resume-state unit tests

Specify a versioned, expiring safe resume record containing only:

- normalized email and masked display email;
- participant name and participation basis;
- guardian attestation when applicable;
- the exact privacy and waiver document identities selected by the participant;
- the non-secret onboarding stage and creation timestamp.

Add tests proving serialization never stores password, verification code, Clerk token, session token, reset code, or arbitrary unknown fields; invalid, expired, corrupt, or version-mismatched records are discarded.

Add flow tests for:

- page reload while waiting for the email code;
- returning from an email application;
- reconnecting to Clerk's provider-managed pending sign-up attempt;
- a stored local resume record with no matching provider attempt, which must show clear restart and sign-in choices rather than loop;
- resend-code and change-email actions;
- successful verification after a reload.

Run and confirm failure:

```powershell
npx tsx --test tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts
node --test tests/hunter-account-contract.test.mjs
```

### Step 2: Implement the safe resume module

Create pure parse, write, read, and clear functions in `hunter-signup-resume.ts`. Use session storage first and a short-lived local-storage fallback only where mobile browser/email switching requires it. Namespace the key to the validation/production origin, validate every field, enforce a bounded expiry, and never accept secret-shaped keys.

### Step 3: Rework signup and verification state transitions

In `dashboard.ts`:

- persist safe draft state before requesting verification;
- recover the draft and Clerk pending sign-up attempt during initialization;
- show the verification screen with a masked email and clear `Resend code`, `Use a different email`, and `Back to sign in` actions;
- preserve the provider's resend cooldown and display its error clearly;
- clear local resume state only after onboarding has completed or the user deliberately restarts;
- route incomplete or unsupported Clerk statuses to an explicit next action instead of a generic unavailable state.

Do not persist the password or code. Do not create a second password store or recovery mechanism.

### Step 4: Verify and commit

```powershell
npx tsx --test tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts
node --test tests/hunter-account-contract.test.mjs
npm run typecheck:client
git diff --check
```

Commit only Task 2 files:

```powershell
git add src/client/hunter-signup-resume.ts src/client/dashboard.ts dashboard.html css/hunter.css tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts tests/hunter-account-contract.test.mjs
git commit -m "fix: resume mobile email verification"
```

## Task 3: Separate verified identity from delayed profile provisioning

**Files:**

- Modify: `dashboard.html`
- Modify: `css/hunter.css`
- Modify: `src/client/dashboard.ts`
- Test: `tests/hunter-registration.test.ts`
- Test: `tests/hunter-ui-client.test.ts`
- Test: `tests/account-client.test.ts`
- Test: `tests/api-player-lifecycle.test.ts`

### Step 1: Add failing delayed-bootstrap and partial-onboarding tests

Add tests that simulate:

- email verification succeeding before the Clerk lifecycle webhook creates the D1 player record;
- bootstrap returning not-ready/transient responses for 0, 5, and 30 seconds before succeeding;
- bootstrap still unavailable after the bounded automatic wait;
- manual retry succeeding later;
- a valid Clerk session with unavailable D1 profile never rendering the signed-out/bad-login gate;
- an account with only privacy accepted resuming at waiver acceptance;
- an account with legal acceptances but an incomplete profile resuming only profile completion;
- an already complete account entering the dashboard directly;
- exactly-once/idempotent acceptance writes and waiver receipt behavior remaining intact.

Run and confirm failure:

```powershell
npx tsx --test tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts tests/account-client.test.ts tests/api-player-lifecycle.test.ts
```

### Step 2: Add a dedicated finishing-account state

Add a visible `Email verified — finishing your account` panel with:

- a non-alarming explanation that setup may take a moment;
- bounded retry progress with accessible live status;
- a `Try again` button after the automatic window;
- `Sign out` and support/restart guidance that does not destroy a valid provider session accidentally.

Refactor bootstrap/finalization into explicit states. Use longer bounded backoff suitable for webhook delay, classify terminal versus retryable failures, and ensure retry is idempotent. Continue calling the existing bootstrap, profile, privacy, and waiver endpoints in their current authoritative order.

### Step 3: Verify and commit

```powershell
npx tsx --test tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts tests/account-client.test.ts tests/api-player-lifecycle.test.ts
npm run typecheck
npm run legal:verify
git diff --check
```

Commit only Task 3 files:

```powershell
git add dashboard.html css/hunter.css src/client/dashboard.ts tests/hunter-registration.test.ts tests/hunter-ui-client.test.ts tests/account-client.test.ts tests/api-player-lifecycle.test.ts
git commit -m "fix: recover delayed hunter provisioning"
```

## Task 4: Share one effective Clerk session with the account header

**Files:**

- Create: `src/client/hunter-auth-session.ts`
- Modify: `src/client/account.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `scripts/build.mjs`
- Test: `tests/account-client.test.ts`
- Test: `tests/hunter-ui-client.test.ts`
- Test: `tests/campaign-shell-accessibility.test.mjs`

### Step 1: Add failing shared-session tests

Test that:

- account header and Dashboard use the same browser-global Clerk initialization promise and effective session;
- in-page sign-in immediately changes the header from `Sign in` to the current participant display name without reload;
- in-page sign-out immediately returns the header and Dashboard to signed-out state;
- session changes propagate once, without duplicate listeners or duplicate Clerk instances;
- a custom participant display name is preferred, with the established privacy-safe fallback when absent;
- additional Clerk sign-in statuses show a supported continuation or specific recovery message rather than a generic dead end.

Run and confirm failure:

```powershell
npx tsx --test tests/account-client.test.ts tests/hunter-ui-client.test.ts
node --test tests/campaign-shell-accessibility.test.mjs
```

### Step 2: Implement the browser-global coordinator

Create `hunter-auth-session.ts` around a versioned `window` global containing:

- one Clerk load promise;
- one current session snapshot;
- one provider listener;
- a small same-page subscribe/unsubscribe interface;
- explicit refresh and sign-out operations.

Use the global contract because `account.ts` and `dashboard.ts` are separately built entrypoints and an imported module singleton alone would be duplicated across bundles. Refactor both clients to use the coordinator. Remove competing Clerk constructors and stale one-time header evaluation.

### Step 3: Verify and commit

```powershell
npx tsx --test tests/account-client.test.ts tests/hunter-ui-client.test.ts
node --test tests/campaign-shell-accessibility.test.mjs
npm run typecheck:client
npm run build
git diff --check
```

Commit only Task 4 files:

```powershell
git add src/client/hunter-auth-session.ts src/client/account.ts src/client/dashboard.ts scripts/build.mjs tests/account-client.test.ts tests/hunter-ui-client.test.ts tests/campaign-shell-accessibility.test.mjs
git commit -m "fix: synchronize hunter account sessions"
```

## Task 5: Mobile, accessibility, privacy, and regression verification

**Files:**

- Modify: `scripts/verify-waiver-qa.mjs`
- Modify: `tests/waiver-qa-contract.test.mjs`
- Modify: `tests/navigation-geometry.test.mjs`
- Modify: `tests/privacy-output.test.mjs`
- Modify: `STATUS.md`
- Modify: `README.md` only if the operating contract changed

### Step 1: Extend automated browser journeys

Add validation-safe, zero-write browser coverage for:

- iPhone-sized signup and returning sign-in;
- legal dialog open, scroll, Done, Escape, and focus restoration;
- no nested Dashboard or cyclic registration navigation in either iframe;
- checkbox independence and explicit acceptance;
- reload before verification, email-app round-trip equivalent, resend, and changed email;
- delayed webhook/finishing UI and manual retry;
- valid session versus incomplete profile presentation;
- header synchronization;
- keyboard-only use, screen-reader names/statuses, 200% zoom, reduced motion, visible focus, and 44-pixel targets;
- no horizontal page overflow at supported mobile widths;
- no password, code, token, private profile, or legal acceptance values in public output or unsafe storage.

### Step 2: Run the full local release gate

```powershell
npm run legal:generate
npm run legal:verify
npm test
npm run typecheck
npm run build
npm run verify:waiver-qa
npm run verify:unified-shell-qa
git diff --check
```

Inspect the built `dist` output for credential/private-fixture matches and confirm the legal document hashes are unchanged.

### Step 3: Independent specification and quality review

Have one reviewer compare the complete diff against:

- `docs/superpowers/specs/2026-07-17-mobile-signup-recovery-design.md`
- this implementation plan
- existing privacy, waiver, account, validation-isolation, and production-protection contracts.

Have a second reviewer inspect correctness, mobile accessibility, recovery edge cases, security, privacy, test quality, and accidental production/data behavior. Resolve every material finding and rerun affected gates.

### Step 4: Update durable status and commit

Update `STATUS.md` with the exact commit, test counts, skipped checks, known limitations, and the explicit fact that production was not changed. Update `README.md` only for a real operator/build contract change.

```powershell
git add scripts/verify-waiver-qa.mjs tests/waiver-qa-contract.test.mjs tests/navigation-geometry.test.mjs tests/privacy-output.test.mjs STATUS.md README.md
git commit -m "test: verify resilient mobile onboarding"
```

## Task 6: Validation-only deployment and owner handoff

### Step 1: Record a read-only production baseline

Use the existing count-only/read-only production safety check. Record player, legal acceptance, report, update, audit, media, and waypoint counts plus the environment sentinel. Do not copy, migrate, or mutate production.

### Step 2: Deploy only the approved validation candidate

Deploy the exact reviewed commit through the existing `codex-validation` Pages branch and Preview bindings. Apply no production migration. Confirm the runtime identifies itself as validation.

### Step 3: Smoke-test the real validation provider flow

On mobile and desktop, verify:

- new account creation and both legal acceptances;
- email code verification, resend, browser reload, and return from email;
- password sign-in and provider-managed recovery;
- delayed-profile finishing behavior;
- returning sign-in, sign-out, header identity, and route access;
- no unexpected duplicate verification emails caused by repeated client actions;
- privacy/waiver receipts and Ops visibility remain correct.

Use only disposable validation accounts and submissions. Do not publish validation content to production.

### Step 4: Confirm production stayed unchanged

Repeat the same read-only production baseline and require identical counts plus clean foreign-key checks. Report the immutable validation URL, stable alias, exact commit, automated results, manual results, and any remaining owner checks. Stop for Murphy's approval; do not promote to production.

