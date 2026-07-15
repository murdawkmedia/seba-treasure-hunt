# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-14

## Current state

The `codex/tim-lost-hunter-platform` branch now contains a locally verified unified public campaign shell in addition to the participation-waiver, guardian, hunter-tool unlock, legal receipt and private Ops workflow. The shell, route-wide accessibility hardening and Graph transactional-mail wiring have not been deployed in this pass.

The stable noindex validation alias still serves the earlier approved validation release from source `5deee85`. It presents Privacy/Media `2026.2`, Participation Waiver `2026.1` and the guardian/receipt/Ops surfaces; its isolated media Worker is also deployed. Production remains on its earlier release from source `5552a57`; production deployment, DNS, domains and data were not changed. No Cloudflare, DNS, provider, authorization, email or deployment mutation occurred during the unified-shell verification.

For historical sponsor-release auditability, the pre-disclosure Privacy/Media `2026.1` hash was `c385974ca255ef14161e89041908f4b4eda97c9e7f207288bd1db304a02925d9`; it is not the active local `2026.2` policy hash below.

Validation identities, profiles, acceptances, reports, notes, uploads and receipt records are disposable test data. They must be wiped before a separately approved live promotion; none may be promoted to production.

Validation inquiries are disposable and must not be promoted to production.

## Legal artifacts in force locally

- Participation waiver: version `2026.1`, effective July 13, 2026, SHA-256 `1a6e50f445fc7c67962e5e0050c7fbe161d7d78e679dab4f6fde951602cf3607`.
- Privacy Policy & Media Notice: version `2026.2`, SHA-256 `47e26763d46441e2e155a6d0ca3869986395c49b60073a8da9256577229f07a8`.
- Legal hashes cover the authoritative legal content, not navigation or decorative page chrome.
- Review, acceptance, adult/minor participant snapshots and delivery evidence are separate append-only records. One adult may cover up to ten directly supervised minors using name and birth year only.
- Private report evidence, exact locations, ID details and cash evidence remain outside promotional-media paths without separate authorization.

## Implemented locally

- Verified-email/password hunter accounts with provider-managed recovery; D1 never stores passwords or reset codes.
- Separate profile completion, Privacy/Media acceptance and Participation Waiver gates.
- Exact waiver review recording before acceptance, guardian attestation for minors and idempotent acceptance.
- Current-document authorization for progress, exact waypoint directions, Field Notes, replies and related participation tools without weakening case, zone, moderation or human-verification gates.
- Private D1 acceptance/participant/outbox ledgers, exact-version access checks and withdrawal-aware projections.
- Fenced receipt jobs with opaque lease tokens and attempt generations; stale completions and in-flight resends cannot overwrite or duplicate winning delivery evidence.
- Idempotent acceptance replay atomically requeues interrupted pending/failed receipts when no lease is active; sent receipts remain silent. Receipt rendering fails before provider access if the stored waiver version/hash does not exactly match the generated legal source.
- Complete plain-text and HTML waiver receipts containing the accepted legal body, covered participants, reference, version, effective/accepted dates and verified account email.
- Transactional mail uses one explicitly selected provider. Graph is locally wired with encrypted refresh-token rotation and no automatic Resend fallback; missing configuration fails retryably. No real receipt has been sent by this implementation pass.
- Player and staff recovery messages use the same encrypted campaign Reply-To as legal receipts, so all transactional replies reach one operations mailbox.
- Participant receipt resend plus private staff waiver detail and audited Ops retry. Concurrent withdrawal/newer acceptance is rechecked inside the fenced retry batch; an active delivery returns `409 waiver_receipt_in_progress`.
- Every private staff waiver-detail view appends a privacy-safe audit event before names or birth years are returned. Browser write APIs require an exact canonical, scoped Pages-preview or explicit local-development Origin.
- D1 enforces atomic fixed-window abuse limits with separate salted hash buckets for every IP/account identifier; changing an IP or account cannot reset the other bucket. The former rate-limit KV bindings are retired and unbound.
- Ops player summaries expose only legal status/version/date, minor count and receipt status. Names, birth years, contact data, provider IDs and private evidence remain out of exports and public output.
- Public `/waiver` route, legal navigation, sitemap entry and active architecture documentation.
- A validation-safe browser QA gate that exercises the built Dashboard, Ops, Clue Board and Report clients at desktop, mobile and zoom-equivalent viewports.
- One build-time public shell source, `scripts/campaign-shell.mjs`, owns the status strip, skip link, canonical eight-item menu, header and footer for all thirteen public and hunter routes. `css/campaign-shell.css` owns shared chrome and tokens while page-family classes preserve landing, route, editorial, ledger, workspace, document and sponsor layouts. Ops remains intentionally separate.

Key implementation commits include `a0121c0`, `112e286`, `0553fe2`, `1a8a10d`, `db4aaf5`, `41649f5`, `0dd4436`, `26a43d7`, `79a4278`, `6eeb0c1`, `4c05a9b`, `2e0220a`, `9116778`, `535f760`, `1774882`, `bf098f5`, `65e12bf`, `0e701b6`, `765102d`, `e714796` and `5deee85`.

Unified-shell Tasks 1-7 are represented by these local commit groups:

- Task 1 renderer and parser: `2bee863`, `c58124d`, `f295f91`, `174f883`, `e77fb69`.
- Task 2 build integration: `6f29961`, `639b30e`, `46bc766`, `f852a34`.
- Task 3 canonical shell behavior: `86a7abf`, `e92e461`, `e2d645f`, `469586c`.
- Task 4 visual system and focus contexts: `3da787b`, `fb0e031`, `c0ca1b1`, `d21df25`, `3b4b1b7`, `0f2b340`.
- Task 5 Clue Board status integration: `7cb02d3`, `dc0d6d6`.
- Task 6 route-matrix and accessibility QA: `53e1941`, `c234363`.
- Task 7 public-shell drift protection: `4bda466`, `350c297`, `6a6c3eb`, `1bf3935`.

Graph transactional-mail wiring remains locally complete in `17f70c0` and `c23109f`. Applying migration `0010`, configuring Preview-only settings, completing delegated authorization, deploying validation and sending one controlled validation message remain external rollout steps.

## Database and provider state

- Validation D1 was backed up, verified against canonical schema `0001`–`0004`, and confirmed to contain the validation sentinel, the 12-waypoint public seed and zero personal/staff data before its empty migration ledger was reconciled.
- Validation migrations `0005` through `0009` are applied and recorded. Post-checks show no pending migration and zero sponsor, waiver-review, participant, delivery, lease or rate-limit rows.
- Wrangler's normal migration command applied `0005` but could not parse the trigger bodies in `0006`. Migrations `0006`–`0009` were therefore imported one at a time through D1's atomic raw-file path, verified by object signature and then recorded in the migration ledger. Preserve this fact for production planning.
- Production migrations, deployment, DNS and data remain unchanged. No waiver, receipt-lease, immutable-ledger or atomic-rate-limit migration is applied there.
- Clerk and Turnstile Preview configuration is absent/unverified, so identity and human-verified writes remain fail-closed. Resend and the recovery/legal-receipt sender settings are installed as encrypted Preview-only secrets. The verified Murdawk Media sender remains active and receipt replies route to the campaign lead mailbox. A non-delivering API probe confirmed the new SebaHub credential is valid but its Resend account currently has zero sending domains, so it is stored only as `RESEND_API_KEY_SEBAHUB_PENDING` and is not used by the Worker. No credential value is recorded in source or documentation.
- Graph migration `0010`, Preview-only Graph/sender settings and delegated authorization are not applied to validation or production. The local Graph implementation remains fail-closed until that rollout is completed.
- The validation Turnstile action `sponsor_inquiry` is not verified or configured, so the deployed sponsor form remains fail-closed.
- The existing Murdawk Media Wrangler OAuth session was verified and used only for the approved validation migration and deployment work. The authenticated Cloudflare and Resend dashboard sessions were used only for Preview configuration and verified-domain inspection. No raw credential value is stored in the repository or documentation, and no real provider delivery occurred.
- Pages domains remain `seba-treasure-hunt.pages.dev`, `timlostsomething.com` and `www.timlostsomething.com`; no domain or DNS change occurred.

## Verification evidence

- `npm run legal:verify`: authoritative waiver and Privacy/Media generated artifacts match their recorded versions and hashes.
- Focused real-D1 integration passes after migrations through `0009`, including migration replay, populated receipt reconciliation, acceptance rollback, withdrawal ranking, lease fencing, interrupted-receipt replay, Ops retry/view auditing, append-only mutation rejection and atomic multi-identity rate limiting.
- Waiver QA contract: 5/5 passing.
- `npm run verify:waiver-qa`: passing against an isolated temporary build with 251 observed requests; three local bootstrap mocks and one each for review, acceptance, participant resend and Ops retry; zero external writes, continued external requests, blocked writes, forbidden provider attempts and server-rejected writes.
- The browser gates cover every public route at 390x844, 360x900, 768x900, 1440x900 and the 720x500 200%-zoom equivalent, plus seven representative desktop routes at 1440x1000. They verify collapsed/expanded menus, skip-link focus, sticky geometry, current state, short-menu traversal, overflow, console output and serious/critical axe findings.
- QA privacy classification reports zero findings in production source, rendered public output and public bundles. Private server/Ops bundles are classified separately rather than represented as public leaks.
- The earlier sponsor surface remains documented in `docs/qa/2026-07-13-sponsor-feature-verification.md` with its reproducible `scripts/verify-sponsor-qa.mjs` runner and uncommitted `%TEMP%\tim-lost-task10` artifacts; this waiver pass does not replace or redeploy that validation release.
- `npm test`: 189/189 static/contract tests and 278/278 TypeScript tests passed.
- `npm run typecheck`: Worker, client, Worker-test and client-test checks passed.
- `npm run build`: passed; Pages Worker 316.9 kB, media Worker 3.2 kB and client bundles completed.
- Focused campaign navigation/accessibility verification: 12/12 passed. Nineteen representative screenshots were captured outside the repository with external requests blocked and zero page errors; the artifact names and SHA-256 values are recorded in `docs/qa/2026-07-14-unified-campaign-shell-verification.md`.
- Dedicated console verification covered 72 page navigations and 111 collapsed, expanded, desktop and zoom-equivalent route states with zero console errors and zero uncaught page errors. All 89 external attempts were intercepted locally (72 font stylesheets and 17 Turnstile scripts); zero external request continued.
- `git diff --check`: passed. Pre-existing Wrangler/workerd processes were neither started nor stopped and were not used as release evidence.
- Validation provider-isolation hardening: 27/27 focused tests, 88/88 static/contract tests and 201/201 TypeScript tests passed; typecheck and build passed with a 304.8 kB Pages Worker.
- Validation D1 is at migrations `0001`–`0009`, retains the `validation` sentinel and 12-waypoint seed, and reports zero personal/staff or new sponsor/legal/delivery data.
- Validation deployment `c09b79d9-6a2a-459c-8cd6-a80f4633a2af` from `5deee85` is active at the stable alias with `X-Robots-Tag: noindex, nofollow`; `/api/v1/status`, `/waiver` and `/privacy` return 200. Cloudflare lists the active transactional settings and pending SebaHub credential as encrypted Preview secrets. Production remains on deployment `ad89ff2a-5818-4546-ba8f-3f1b7cd25359` from source `5552a57`.
- `npm audit --omit=dev --audit-level=high`: exit 0 with zero high/critical findings. Twelve moderate findings remain in Clerk's optional Solana chain; no forced breaking remediation was applied.
- Full evidence and reproduction commands are recorded in `docs/qa/2026-07-14-waiver-guardian-receipt-verification.md`.

## Remaining activation gates

Validation activation is approved, but the following still require authenticated provider access and controlled verification:

1. Complete Clerk application setup and Cloudflare Turnstile setup through the authenticated provider sessions without exposing credentials in chat or source.
2. Configure the remaining Preview-only identity, webhook and Turnstile values.
3. Run one owner-controlled disposable hunter/guardian/receipt/Ops test and a controlled test receipt.
4. Verify password recovery, staff invitation/authorization, all Turnstile actions and private media processing.
5. Apply validation migration `0010`, configure Preview-only Graph/sender settings and complete one owner-controlled delegated authorization and controlled validation delivery.
6. Rotate the Resend credentials after controlled delivery/domain verification because both initial credentials were supplied through chat; replace only their encrypted Preview secrets.
7. Wipe disposable validation identities, D1 activity/legal records and validation media after testing. Immutable legal ledgers mean this should be a controlled validation-resource reset, not ad hoc deletes.
8. Apply production migrations, deploy production or change DNS/domains only after a separate production approval.

## Next approved workflow

Resume the Graph validation rollout by migrating the isolated validation D1 database through `0010_graph_transactional_email.sql`, configuring Preview-only Graph/sender settings, completing owner-controlled delegated authorization, deploying only the validation branch and running one controlled provider test. Then finish the separate Clerk/Turnstile and disposable-account checks, verify no public disclosure, and reset disposable validation records. Production requires another explicit later approval.

## Decisions in force

- Umbrella brand: **Tim Lost Something?**
- 2026 sub-brand: **This year: Tim lost his ID.**
- Descriptor: **The Seba Beach Treasure Hunt**
- Canonical item language is **ID bundle**, not lost wallet.
- The current 12-waypoint route is authoritative.
- Registration is layered, not launch-gated: account creation is available while participation-only tools remain independently gated.
- SMS remains out of scope. Hunt email and SebaHub marketing permissions remain separate and unchecked.
