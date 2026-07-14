# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-13

## Current state

The hunter-account, privacy/media, pending-waiver and Sunny Pirate Mystery Chest favicon implementation is deployed to the noindex validation branch from `codex/tim-lost-hunter-platform`.

The dedicated sponsor page, persistent navigation, protected inquiry intake, private D1 workflow, and staff-only Ops Sponsors ledger are implemented and verified to the local Task 10 scope on `codex/tim-lost-hunter-platform`. The implementation sequence includes sponsor persistence (`b12aca2`), protected intake (`dff10ff`), accessible client (`7e37970`), sponsor page (`7976f0d`), persistent navigation (`1b6988a`), Ops ledger (`219bcb3`), workflow-total correction (`1aae14f`), and private-inquiry disclosure (`2f8d157`). These sponsor commits have not been deployed as part of this work.

Validation branch alias:

<https://codex-validation.seba-treasure-hunt.pages.dev/>

Unique July 13 deployment:

<https://00b10632.seba-treasure-hunt.pages.dev/>

Deployed: 2026-07-13. The feature branch is pushed to GitHub. Validation-only D1 and media-worker changes were made; no production alias, custom-domain, DNS, production migration or production secret was changed.

That deployment statement describes the earlier validation release only. The newer sponsor implementation remains local. Production migration, deployment, DNS, secrets, and data are unchanged by the sponsor work.

The canonical production site remains on its previous working release. This is deliberate: the new report, community and account flows fail closed until Clerk and Turnstile are activated, so the preview must not replace production yet.

The deployed validation release contains a D1 environment sentinel, fail-closed write guard, preview-only binding overrides, provider-key protections and a persistent disposable-data notice.

## Implemented

- Rebranded annual campaign hierarchy: **Tim Lost Something?** / **This year: Tim lost his ID.**
- Live OPEN/PAUSED/FOUND status with absolute and relative update time, hunt hours and optional next-clue state.
- Above-fold Start, Report, Updates and Rules actions.
- Permanent `/start` route and reproducible QR asset.
- Public 12-waypoint overview with EXIF/GPS-free photos; exact navigation is authenticated and safety-gated.
- Hunter email/password accounts with verified-email lifecycle intake, 12-character minimum passwords, provider-managed compromised-password checks, sessions and emailed recovery.
- D1 player lifecycle ledger, separate communication permissions and append-only privacy/media legal-acceptance events; passwords and reset codes remain provider-only.
- Required Privacy Policy & Media Notice version `2026.1`; its stored SHA-256 matches the published policy while excluding decorative favicon and manifest links so non-legal head changes do not trigger reacceptance.
- A narrow sponsorship-inquiry transparency disclosure was added without changing hunter/media purposes, rights, version `2026.1`, effective date, or pending-waiver state. The exact policy hash changed from `c385974ca255ef14161e89041908f4b4eda97c9e7f207288bd1db304a02925d9` to `5c7290339e22b35daaf08c7d561ff94ccb64dfd8d361e69b74ce738664b0c2ee`.
- Separate disabled participation-waiver placeholder. Account creation is allowed, while exact directions, progress and community participation remain locked until approved waiver language is supplied and accepted.
- Staff may send provider-managed player recovery instructions or revoke player sessions; they cannot view or choose player passwords.
- Account-optional private reporting with required photo for find claims, optional geolocation and idempotency.
- Public `/sponsors` conversion surface with a protected, idempotent inquiry form. Submissions do not create marketing consent, an agreement, or publication authorization.
- Private D1 sponsor inquiry and append-only event ledgers with staff-actor audit history, filtered/paginated staff reads, and aggregate workflow totals independent of table filters.
- Moderated virtual clue board with premoderated notes/images, constrained replies, flags, Turnstile actions and rate limits.
- Invitation-only staff case room for status, updates, reports, sponsors, moderation, zones, rules, players, access and audit. Ops Sponsors shows private contact/proposal fields and deliberate audited state changes; it has no email automation or export.
- Provider-managed staff recovery, session revocation, suspension/reactivation and optional MFA reset; no peer password visibility or password setting.
- Versioned rules, public zone labels, Privacy Policy & Media Notice and community guidelines.
- SEO/AEO metadata, JSON-LD, sitemap, robots policy, canonical host behavior and SebaStays guarantee links.
- Fictional ID artwork disclosed as a campaign prop.
- Route-video end card updated to `www.timlostsomething.com`; unconfirmed radio copy removed; output is 22,467,397 bytes and 81.222 seconds.
- Sitewide Sunny Pirate Mystery Chest favicon with canonical SVG, 32/180/192/512-pixel PNGs, multi-resolution ICO and minimal browser manifest.
- Edge security policy: CSP, anti-framing, MIME protection, HSTS, referrer policy and limited browser permissions.

## Cloudflare state

- Validation-only D1, private R2, KV, processing queue and dead-letter queue are provisioned with explicit `-validation` names. Pages preview configuration overrides every stateful production binding together.
- Validation D1 migrations 0001 through 0004 are applied and its sentinel is `validation`.
- Migration `0005_sponsor_inquiries.sql` is exercised against local Miniflare D1, including atomic events, literal search, tuple pagination, state totals, and concurrent transitions. Migration 0005 is not confirmed remotely and there is no repository evidence that it has been applied to the validation D1.
- The sponsor client and server both require the exact Turnstile action `sponsor_inquiry`, and allowed preview hosts are declared. Whether the managed validation widget and preview secret permit `sponsor_inquiry` is not verified; no live sponsor submission is claimed.
- Validation seed verification: OPEN; 12 published waypoints; one published rules version; two published zones; three feature flags; zero player accounts, hunter profiles, reports, Field Notes and staff principals.
- The validation media processor verifies the D1 sentinel before touching R2, resolves only validation D1/R2/queue resources and is deployed as the consumer of `tim-lost-media-processing-validation`.
- Production D1 migrations 0001 and 0002 are applied and the idempotent campaign seed is loaded. Migration 0003 was validated against local D1 only and is not applied remotely.
- Seed verification: OPEN; 09:00–20:00 America/Edmonton; 12 published waypoints; one published rules version; two published zones; three explicit community feature flags; zero staff principals.
- The current noindex preview and private validation media consumer are deployed successfully. The July 13 Pages preview is deployment `00b10632`; production remains on its previous release.
- Any future validation inquiries are disposable test records and must never be promoted to production.

## Verification evidence

- Sponsor implementation commits through `2f8d157` are locally verified. Focused API, authorization, D1 store/integration, client behavior, static privacy, and legal-hash tests pass.
- `npm test`: the fresh Task 10 automated suite reports 70 of 70 static/contract tests and 134 of 134 TypeScript tests passing, with no failures, skips, cancellations, or TODOs.
- `npm run typecheck`: the fresh Task 10 TypeScript checks pass for the Worker, client, Worker tests, and client tests.
- `npm run build`: the fresh Task 10 production build succeeds; the Pages Worker is 268.0 kB, the media Worker is 3.2 kB, and the client bundle completes successfully.
- `npm audit --omit=dev --audit-level=high`: the fresh Task 10 production-dependency audit exits successfully with zero high or critical findings. Twelve moderate findings remain in Clerk's optional Solana dependency chain; the only complete automated remediation offered is a forced breaking Clerk downgrade, which was not applied.
- The [durable sponsor QA record](docs/qa/2026-07-13-sponsor-feature-verification.md) and [reproducible QA runner](scripts/verify-sponsor-qa.mjs) capture the Task 10 browser, accessibility, route, and output checks. Local screenshots and logs use `%TEMP%\tim-lost-task10`; they are uncommitted QA artifacts, not a runtime dependency.
- Local sponsor smoke checks: `/sponsors` returns HTTP 200; `/api/v1/status` returns HTTP 200 with the normal OPEN state, 09:00â€“20:00 America/Edmonton hours, version 1, and the verified update timestamp; unauthenticated `/api/v1/ops/sponsors` returns HTTP 401 with only the safe `staff_auth_required` response and no inquiry data.
- Desktop sponsor QA at 1440Ã—1000 (1425 px effective content width) shows no horizontal overflow. The 54 px case strip remains sticky at the top, the 67 px header remains sticky below it, and the live 121 px stack/anchor offset clears the inquiry, FAQ, and footer. Sponsors remains gold-highlighted and current. Local Turnstile fails closed, the submit button remains disabled, and the console reports zero warnings or errors.
- Mobile sponsor QA at 390Ã—844 (375 px effective content width) shows no horizontal overflow. The 76 px case strip and 59 px header stack correctly; the menu exposes Sponsors, closes on link activation, closes with Escape, and restores focus. The 343 px cards stack with `min-height: auto`; the 343 px form, privacy notice, Turnstile shell, disabled submit button, and result region remain readable.
- A 720Ã—500 zoom-equivalent sponsor check has no overflow or overlap; the sticky stack is 135 px and the hero begins below it. The 390 px Clue Board retains a 76 px case strip and 58 px header, exposes Sponsors in the menu, restores focus after Escape, and has no horizontal overflow.
- Axe reports zero WCAG 2.0 A/AA and WCAG 2.1 A/AA violations on the desktop sponsor page, mobile sponsor page, and unauthenticated Ops gate. A test-only mocked configuration and Turnstile token enabled the sponsor button without sending a POST; empty submission focused `contactName` and set `aria-invalid="true"`.
- Authorized Ops visual QA remains unavailable locally because staff identity configuration is intentionally absent. The static Ops, client, authorization, and axe contracts pass; authenticated Ops Sponsors review is deferred to validation Task 11.
- The broad planned output grep is not clean and must not be cited as a data-leak scan: sponsor table names appear only as executable server code in the bundled Worker, `private note` appears only as UI copy in the downloadable Ops implementation bundle, and the matched SebaHub and Business as a Force for Good addresses are pre-existing intentional public contact details on Home, Privacy, and Route. The Worker bundle is not served at `/_worker.js` (HTTP 404), the Ops API remains staff-gated, and CFCW has zero built-output matches.
- The corrected rendered-public-surface scan, which excludes server and Ops implementation bundles, is clean. The sponsor page contact-address scan is clean, and an actual fixture/data scan for `alex@example.test`, `Good local fit`, and `staff_subject` is clean.
- Favicon contract: canonical semantic parts, 32/180/192/512-pixel PNG dimensions, 16/32/48-pixel ICO directory, all twelve page references and build output pass; 512- and 32-pixel renders were visually inspected.
- Live validation smoke test: home, Privacy, ICO, SVG, 32-pixel PNG, Apple touch icon and manifest return HTTP 200 with `X-Robots-Tag: noindex`; the deployed SVG byte hash matches the local source and the old money-bag data favicon is absent.
- Local Pages runtime: home, start, dashboard, clue board, Ops and status API all return 200 with clean routes.
- Rendered desktop and 390 px mobile QA for Privacy, Dashboard and Ops: no horizontal overflow and no WCAG 2.1 A/AA axe violations.
- Public edge preview: D1 status, updates, rules, two zones and 12 waypoints return successfully.
- Both the stable alias and immutable deployment show the disposable-data notice and `X-Robots-Tag: noindex, nofollow`; production shows neither.
- Preview public waypoint payload contains no exact URLs, map URLs, coordinates or private member content.
- Validation write routes fail closed because preview abuse-protection and identity secrets are not configured; the validation database remains at zero personal and staff records.
- Source and rendered-public-output privacy scans contain no private staff allowlist, exact coordinates, credentials, deferred claims, or ignored planning/source files.
- Public-source safety contracts reject test lead data, private note fixtures, staff identifiers, CFCW, and unsupported sponsor/media claims.
- All 76 source and 76 built raster images contain no EXIF, XMP, IPTC, ICC or GPS markers.
- Route video is below Cloudflare Pages' 25 MiB per-file limit and its final frame is visually verified.

## Launch blockers

1. Refresh the active Cloudflare authorization so it includes Turnstile/challenge-widget write access, then create or verify a managed widget restricted to `codex-validation.seba-treasure-hunt.pages.dev` and confirm that it returns the exact `sponsor_inquiry` action.
2. Configure validation-only `RATE_LIMIT_SALT`, Turnstile site/secret values and identity secrets in the Pages preview environment. The existing production salt remains unchanged.
3. Configure the public Clerk application for verified email/password accounts, 12-character passwords, compromised-password checks and emailed recovery.
4. Configure its signed lifecycle webhook and store `HUNTER_CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` as preview secrets.
5. Apply migration 0005 to the isolated validation D1 only after explicit validation approval, then verify its environment sentinel and empty disposable sponsor tables. Apply migrations 0003, 0004, and 0005 to production only after separate production promotion and legal approval; production is unchanged today.
6. Configure the separate invitation-only staff Clerk application and staff password/recovery/MFA policy.
7. Store identity, Turnstile and recovery-mail values as deployment secrets; never commit them.
8. Invite approved operators and privately seed their verified identity subjects.
9. Obtain the authoritative participation waiver, preserve it unchanged, render and hash it, then enable its separate acceptance flow.
10. Run preview end-to-end tests for signup, verification, password login, recovery, session revocation, legal acceptance, sponsor inquiry/receipt/Ops transition, private uploads, moderation and FOUND confirmation.
11. Promote `dist/` to production and verify both custom hostnames only after step 10 passes.

## Operational notes

- Scheduled update records do not auto-promote. Publish them manually at the approved time, or add and test a cron promotion job before relying on scheduling.
- The sponsorship workflow does not send automated email. Staff follow-up happens outside the application after authorized review.
- Existing validation users may be required to accept the updated exact privacy hash even though the version remains `2026.1`. Validation accounts and inquiries are disposable; production requires a separate promotion and legal decision.
- Future physical activations and campaign chapters remain outside this release.
- Private launch, identity and incident instructions are maintained outside the public repository.
