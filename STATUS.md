# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-14

## Current state

The participation-waiver, guardian, hunter-tool unlock, legal receipt and private Ops workflow is implemented on `codex/tim-lost-hunter-platform`, verified, pushed and deployed to the stable noindex validation alias from source `65e12bf`.

Validation now presents Privacy/Media `2026.2`, Participation Waiver `2026.1` and the new guardian/receipt/Ops surfaces at `https://codex-validation.seba-treasure-hunt.pages.dev`. Its isolated media Worker is also deployed. Production remains on its earlier release from source `5552a57`; its deployment ID, DNS, domains and data were not changed. No provider secret has been configured, no account or submission has been created, and no email has been sent.

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
- Dedicated Resend configuration through `RESEND_API_KEY`, `LEGAL_RECEIPT_EMAIL_FROM` and `LEGAL_RECEIPT_EMAIL_REPLY_TO`; missing configuration fails retryably. No real receipt has been sent.
- Participant receipt resend plus private staff waiver detail and audited Ops retry. Concurrent withdrawal/newer acceptance is rechecked inside the fenced retry batch; an active delivery returns `409 waiver_receipt_in_progress`.
- Every private staff waiver-detail view appends a privacy-safe audit event before names or birth years are returned. Browser write APIs require an exact canonical, scoped Pages-preview or explicit local-development Origin.
- D1 enforces atomic fixed-window abuse limits with separate salted hash buckets for every IP/account identifier; changing an IP or account cannot reset the other bucket. The former rate-limit KV bindings are retired and unbound.
- Ops player summaries expose only legal status/version/date, minor count and receipt status. Names, birth years, contact data, provider IDs and private evidence remain out of exports and public output.
- Public `/waiver` route, legal navigation, sitemap entry and active architecture documentation.
- A validation-safe browser QA gate that exercises the built Dashboard, Ops, Clue Board and Report clients at desktop, mobile and zoom-equivalent viewports.

Key implementation commits include `a0121c0`, `112e286`, `0553fe2`, `1a8a10d`, `db4aaf5`, `41649f5`, `0dd4436`, `26a43d7`, `79a4278`, `6eeb0c1`, `4c05a9b`, `2e0220a`, `9116778`, `535f760`, `1774882`, `bf098f5` and `65e12bf`.

## Database and provider state

- Validation D1 was backed up, verified against canonical schema `0001`–`0004`, and confirmed to contain the validation sentinel, the 12-waypoint public seed and zero personal/staff data before its empty migration ledger was reconciled.
- Validation migrations `0005` through `0009` are applied and recorded. Post-checks show no pending migration and zero sponsor, waiver-review, participant, delivery, lease or rate-limit rows.
- Wrangler's normal migration command applied `0005` but could not parse the trigger bodies in `0006`. Migrations `0006`–`0009` were therefore imported one at a time through D1's atomic raw-file path, verified by object signature and then recorded in the migration ledger. Preserve this fact for production planning.
- Production migrations, deployment, DNS and data remain unchanged. No waiver, receipt-lease, immutable-ledger or atomic-rate-limit migration is applied there.
- Clerk, Turnstile and Resend preview configuration is absent/unverified. The new flows remain fail-closed until configured through authenticated provider sessions.
- The validation Turnstile action `sponsor_inquiry` is not verified or configured, so the deployed sponsor form remains fail-closed.
- The existing Murdawk Media Wrangler OAuth session was verified and used only for the approved validation migration and deployment work. No raw credential value was opened, copied or logged. Clerk, Resend and Cloudflare dashboard sessions still require interactive sign-in before preview-provider configuration. No real provider delivery occurred.
- Pages domains remain `seba-treasure-hunt.pages.dev`, `timlostsomething.com` and `www.timlostsomething.com`; no domain or DNS change occurred.

## Verification evidence

- `npm run legal:verify`: authoritative waiver and Privacy/Media generated artifacts match their recorded versions and hashes.
- Focused real-D1 integration passes after migrations through `0009`, including migration replay, populated receipt reconciliation, acceptance rollback, withdrawal ranking, lease fencing, interrupted-receipt replay, Ops retry/view auditing, append-only mutation rejection and atomic multi-identity rate limiting.
- Waiver QA contract: 5/5 passing.
- `npm run verify:waiver-qa`: passing against an isolated temporary build with 232 observed requests; three local bootstrap mocks and one each for review, acceptance, participant resend and Ops retry; zero external writes, zero continued external requests and zero server writes.
- The browser gate covers `/waiver`, Dashboard and Ops at 1440×1000, 390×844 and 720×500; real built clients; print CSS; 0/1/10 minors; validation/focus; receipt pending/sent/failed states; progress, note, reply, find-report and upload boundaries; overflow, console and axe checks.
- QA privacy classification reports zero findings in production source, rendered public output and public bundles. Private server/Ops bundles are classified separately rather than represented as public leaks.
- The earlier sponsor surface remains documented in `docs/qa/2026-07-13-sponsor-feature-verification.md` with its reproducible `scripts/verify-sponsor-qa.mjs` runner and uncommitted `%TEMP%\tim-lost-task10` artifacts; this waiver pass does not replace or redeploy that validation release.
- `npm test`: 88/88 static/contract tests and 194/194 TypeScript tests passed.
- `npm run typecheck`: Worker, client, Worker-test and client-test checks passed.
- `npm run build`: passed; Pages Worker 304.8 kB, media Worker 3.2 kB and client bundles completed.
- Validation provider-isolation hardening: 27/27 focused tests, 88/88 static/contract tests and 201/201 TypeScript tests passed; typecheck and build passed with a 304.8 kB Pages Worker.
- Validation D1 is at migrations `0001`–`0009`, retains the `validation` sentinel and 12-waypoint seed, and reports zero personal/staff or new sponsor/legal/delivery data.
- Validation deployment from `65e12bf` is active at the stable alias with `X-Robots-Tag: noindex, nofollow`; `/api/v1/status`, `/waiver` and `/privacy` return the expected open state and legal versions. Production remains on deployment `ad89ff2a-5818-4546-ba8f-3f1b7cd25359` from source `5552a57`.
- `npm audit --omit=dev --audit-level=high`: exit 0 with zero high/critical findings. Twelve moderate findings remain in Clerk's optional Solana chain; no forced breaking remediation was applied.
- Full evidence and reproduction commands are recorded in `docs/qa/2026-07-14-waiver-guardian-receipt-verification.md`.

## Remaining activation gates

Validation activation is approved, but the following still require authenticated provider access and controlled verification:

1. Complete interactive Cloudflare, Clerk and Resend sign-in without exposing credentials in chat or source.
2. Configure preview-only identity, webhook, Turnstile, sender and secret values.
3. Run one owner-controlled disposable hunter/guardian/receipt/Ops test and a controlled test receipt.
4. Verify password recovery, staff invitation/authorization, all Turnstile actions and private media processing.
5. Wipe disposable validation identities, D1 activity/legal records and validation media after testing. Immutable legal ledgers mean this should be a controlled validation-resource reset, not ad hoc deletes.
6. Apply production migrations, deploy production or change DNS/domains only after a separate production approval.

## Next approved workflow

Resume from the Cloudflare dashboard sign-in tab, then configure preview-only providers without exposing values. Run one owner-controlled acceptance/guardian/receipt/Ops retry, password-recovery, Turnstile and media test; verify no public disclosure; and reset disposable validation records. Production requires another explicit later approval.

## Decisions in force

- Umbrella brand: **Tim Lost Something?**
- 2026 sub-brand: **This year: Tim lost his ID.**
- Descriptor: **The Seba Beach Treasure Hunt**
- Canonical item language is **ID bundle**, not lost wallet.
- The current 12-waypoint route is authoritative.
- Registration is layered, not launch-gated: account creation is available while participation-only tools remain independently gated.
- SMS remains out of scope. Hunt email and SebaHub marketing permissions remain separate and unchecked.
