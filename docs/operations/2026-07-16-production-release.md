# Tim Lost Something production release — 2026-07-16

## Current state

- Canonical site: `https://www.timlostsomething.com`
- Apex redirect: `https://timlostsomething.com` permanently preserves the path and query string when redirecting to `www`.
- Cloudflare Pages project: `seba-treasure-hunt`
- Production application commit: `64d303f197f22bbb451fefd417ca2bdecad85b25`
- Production Pages deployment: `a6dc3b9c-4339-4ff9-8e73-8ec64b53db88`
- Immutable production URL: `https://a6dc3b9c.seba-treasure-hunt.pages.dev`
- D1 migrations applied through `0022_mark_apple_watch_found.sql`
- Media worker version: `7cc2b2c0-15ae-49a4-899c-be878657d9c5`
- Production database environment sentinel: `production`
- Production route: 13 waypoints, with separate Seniors Centre and Derby's General Store records.

## Production promotion: Ops access and item-status release

- The reviewed release was squash-merged and pushed to GitHub `main` as
  `64d303f197f22bbb451fefd417ca2bdecad85b25`. Feature-branch commit history
  was not copied into `main`, and the existing remote feature branch was not
  advanced during this release.
- Ops now supports direct staff invitations, D1-first suspension/reactivation,
  and versioned, reversible item-status controls. The public evidence wall and
  find flow use the authoritative case-item ledger; the Apple Watch is found.
- The merged result passed 632/632 tests, all TypeScript projects, exact legal
  verification, the production build, 53 served-file privacy checks, and 111
  browser states across 13 routes with zero console, page, request, overflow,
  local-write, or external-write failures.
- Pre-migration D1 counts were 81 players, 35 private reports, 27 reviewed Case
  Notes, 5 Official Updates, 2 staff principals, 73 media rows, 8 case items,
  11 item events, and 576 audit events. The same counts were observed after
  migration.
- The pre-migration private export is
  `tim-lost-production-pre-64d303f-20260804T202554Z.sql` (869,441 bytes,
  SHA-256 `2E9770190821897D7D3E074FC3E1AA9109552C48434A8B3C64349250A7A49609`).
- Only `0022_mark_apple_watch_found.sql` was pending and applied. The watch was
  already found through Ops; the migration reconciled its public description,
  left its version and protected counts unchanged, and passed a clean
  foreign-key check. No migrations remain.
- Deployment `a6dc3b9c-4339-4ff9-8e73-8ec64b53db88` is immutable at
  `https://a6dc3b9c.seba-treasure-hunt.pages.dev` and live at the canonical
  domain. Eight key routes returned HTTP 200 on both hosts; production config,
  signed-out Ops denial, the found watch, and path/query-preserving apex
  redirect were verified.
- Code rollback tag: `production-pre-ops-items-2026-08-04`, pointing to
  `8683a26651987482db57f2db9c7eb5fe12688a13`. Data rollback is separate and
  uses the private export or Cloudflare D1 Time Travel only when required.

## Production promotion: Casey's golf-ball search and growing cash story

- Murphy approved the exact validation candidate for production on
  2026-07-29. Tim remains the primary case; Casey's marked In the Woods golf
  balls are presented as a distinct side search at `/golf-balls`.
- Roughly $5,000 is described as the search's starting amount and the current
  estimate as approaching $10,000 without an exact guarantee. Tim's ID and
  both diamond-ring baggies remain missing.
- Only balls with the official In the Woods logo qualify. The current wording
  is one qualifying ball for one festival ticket, the ball must be returned,
  and Casey is the sole redemption contact.
- Fresh release checks passed exact legal-artifact verification, all
  TypeScript projects, the complete 572-test suite, the production build,
  49-file output privacy scanning, additional credential/path/fixture scans
  and read-only desktop/mobile browser smoke checks.
- Live HTTP checks covered the homepage, Golf Balls, Route, Updates, Case
  Notes, Report and Ops routes. The runtime reports `production`, the apex
  redirect preserves path and query, and no validation banner or horizontal
  overflow appeared.
- Production D1 counts matched exactly before and after deployment: 56
  players, 21 reports, 13 report-derived Case Notes, 4 Official Updates,
  2 staff principals, 343 audit events, 79 report events, 48 media rows,
  106 legal acceptances and 13 waypoints. Both reads wrote zero rows,
  `changed_db` was false and the foreign-key check was clean.
- No migration, D1/R2/queue write, Clerk or account change, media-worker
  deployment, DNS change or public post occurred.
- Rollback tag: `production-casey-golf-balls-2026-07-29`. The immediately
  previous production deployment is
  `cb2ad1cd-f5ce-45e8-a2c8-4b1d232ba45e` at
  `https://cb2ad1cd.seba-treasure-hunt.pages.dev`.

## Release verification

- Guided-publishing release gate: 285 JavaScript tests and 568 TypeScript
  tests passing; 16 privacy/isolation tests and 15 environment/security tests
  passing; exact legal artifacts, all TypeScript projects, focused QA
  contracts, production build and diff check passing.
- Isolated browser release audits: waiver journey passing with zero external
  writes or public privacy findings; unified shell passing across 66
  navigations and 102 desktop/mobile/zoom states with zero console, page,
  request, overflow or external-write errors.
- Complete static/legacy suite: passing.
- TypeScript suite outside the known local Miniflare runner issue: 515 passing.
- Focused real-D1 publication and moderation integration suite: 8 passing.
- TypeScript checks: passing.
- Production build: passing.
- D1 migrations: 1–15 applied; no pending migrations.
- D1 foreign-key check: clean.
- Anonymous waypoint API: 13 public waypoints and zero exact member map URLs.
- Live staff password login: verified with an active company-domain operator.
- Production Clerk custom domains: HTTPS-valid for hunter and staff instances.
- Turnstile: production widget active for the canonical, apex, and Pages hostnames.
- Microsoft Graph delegated mail: accepted a self-addressed production delivery test from the configured campaign mailbox with the campaign contact as Reply-To.
- Production crawl state: no `noindex` and no CFCW references in the live home output.
- Production route smoke: every expected route returned HTTP 200; the hidden
  `/sponsors` route returned 404. The anonymous 390x844 route rendered all 13
  stops with zero exact map links and no horizontal overflow. The mobile Ops
  route exposed only the staff gateway. No browser console warning or error
  was observed.
- Post-deploy D1 counts matched the pre-deploy baseline exactly: 19 players,
  6 reports, 0 report-derived Case Notes, 2 Official Updates, 1 staff
  principal, 73 audit events, 14 report events, 22 media rows, 34 legal
  acceptances and 13 published waypoints. The reads wrote zero rows,
  `changed_db` was false and the foreign-key check was clean.

## Production follow-on: Guided Official Update publishing

- Explicit owner approval promoted the validation-reviewed source to GitHub
  `main` and Cloudflare Pages production on 2026-07-18.
- Standalone and report-derived Official Updates now share a draft-first,
  image-capable workflow with exact preview confirmation, immediate or
  scheduled publication, visible prerequisites and clear retry/recovery
  guidance for inexperienced operators.
- Report-derived Official Updates remain server-blocked until the private
  report is Verified. Private review status, Case Notes and Official Updates
  are independent, audited outcomes. Media remains private and unchecked until
  an operator deliberately includes it.
- This follow-on required no D1 migration, DNS change, queue change or media
  processor deployment. The production identity, human-verification, data and
  media bindings were preserved.

## Production follow-on: Selectable Private Report destinations

- Each opened Private Report now exposes three native selectable destination
  cards: Keep private, Publish to Case Notes, and Prepare an Official Update.
  Selection is a local, zero-write UI decision and only reveals the matching
  composer; publication remains a separate confirmed server action.
- Case Notes expose eligible submitted report media only. Official Updates may
  combine eligible submitted media with direct Update uploads. Selections and
  typed copy survive destination switching, while exact-preview confirmation
  is deliberately cleared. No image starts selected.
- The exact 137-file artifact was validated at
  `https://47ecee3e.seba-treasure-hunt.pages.dev` and promoted byte-for-byte to
  production. The gate passed 572 automated tests, all TypeScript projects,
  exact legal artifacts, 16 privacy/isolation tests, 15
  environment/security tests, the production build, focused destination
  contracts, `git diff --check`, and the 66-navigation/102-state isolated
  browser audit.
- Live desktop and 390-pixel phone checks found no horizontal overflow or
  validation banner. The homepage, protected Ops entry, Updates, Case Notes
  and Report pages returned HTTP 200, and the bare-domain redirect preserved
  its tested path and query. Cloudflare's injected analytics beacon remains
  blocked by the existing CSP and may log a non-application console message.
- Production D1 remained unchanged at 19 players, 6 reports, 0 report-derived
  Case Notes, 2 Official Updates, 2 staff principals, 88 audit events, 16
  report events, 22 media rows, 34 legal acceptances and 13 published
  waypoints. Post-deploy reads wrote zero rows and the foreign-key check was
  clean. No migration, D1/R2/queue write, Clerk change, media-worker deploy or
  DNS change was required.

## Validation history and promoted refinements

- The validation-reviewed submission, publication and mobile onboarding work
  was promoted to the production identifiers recorded above on 2026-07-18
  after explicit owner approval.
- Validation source commit: `621ebc9`.
- Immutable validation deployment:
  `https://7f6f435c.seba-treasure-hunt.pages.dev`.
- Stable validation alias:
  `https://codex-validation.seba-treasure-hunt.pages.dev`.
- Report photos use decimal MB: direct through 20 MB; browser optimization for
  supported JPEG/PNG/WebP sources above 20 MB through 50 MB; maximum three
  prepared files and 30 MB combined after preparation.
- The Ops Production Snapshot uses dedicated Preview-only resources:
  `tim-lost-hunter-platform-production-snapshot` and
  `tim-lost-private-media-production-snapshot`. There are no production
  bindings or mutation routes for these resources.
- Snapshot refresh is a manual, one-way operation guarded by production and
  destination sentinels, distinct resource IDs, an explicit table allowlist,
  dependency-safe insert ordering, private-media hash verification and a
  redacted completion report.
- The latest verified snapshot matches production at 9 players, 1 report,
  1 staff principal, 10 audit events, 1 media record, 18 legal acceptances and
  13 waypoints. Both foreign-key checks are clean; comparison reads wrote zero
  production rows.
- Final candidate verification: 396 tests passing, legal artifacts exact,
  TypeScript checks passing, production build passing and clean diff check.
- Owner validation was approved and the same artifact was promoted on
  2026-07-17. The production runtime uses only the standard production D1/R2,
  identity and mail bindings; the snapshot controls and bindings remain
  validation-only.
- The promoted release adds independent private, Case Note and Official Update
  outcomes; direct Update media; reply and flag moderation; safe public hunter
  identity; and bounded recovery for stalled signup, verification, sign-in,
  session activation and password-reset provider calls.
- The production D1 was exported to the ignored private backup store and a
  Time Travel restore point was confirmed immediately before migration 0015.
  Existing production row counts were identical before and after promotion,
  and the post-release foreign-key check was clean.

## Production follow-on: Release 2 Documentary Case File

- Release 2A establishes the tracked documentary design source, type system,
  shared shell treatment and non-themed favicon family.
- Release 2B completes the public page/content/media transition, including the
  documentary homepage, real-evidence priority, Case Notes, Support the Search,
  Tim's preserved account, the preserved Lucky 13 route and one-item homepage
  official update.
- The 19 answer bodies, 13 stable waypoint IDs/order, 61 route photos, legal
  bodies/hashes, auth gates, reports, moderation, APIs and private Ops contracts
  remain unchanged.
- Retired public artwork is removed from source and build output; recursive
  regressions reject pirate vocabulary, references and old font tokens.
- This follow-on is included in the production commit and deployment recorded
  above after explicit owner validation approval.
- After an approved deployment, smoke-test `/`, `/route`, `/interview`,
  `/updates`, `/clue-board`, `/sponsors`, `/start` and `/report`, then update the
  production identifiers and verification counts in this document.

## Rollback

- Current application release tag: `production-report-destinations-2026-07-18`
- Immediate pre-release tag: `production-guided-ops-2026-07-18`
- Immediate previous production Pages deployment:
  `https://4e2d9df1.seba-treasure-hunt.pages.dev`
- Immediate previous production source: `a1c1e789bf914a1cd2162164ff5998a76e43a988`

- Earlier rollback tag: `production-submission-onboarding-2026-07-18`
- Earlier immutable Pages deployment:
  `https://3731fa07.seba-treasure-hunt.pages.dev`
- Earlier production source: `5e01e7f`

- Git tag: `production-pre-hunter-platform-2026-07-16`
- Tagged source: `5552a57668417aef2fbd97d63e819807e2ee92dc`
- Previous immutable Pages deployment: `https://34826743.seba-treasure-hunt.pages.dev`
- Previous production source: `20e6da5`
- Pre-promotion D1 backup: retained in the local ignored backup store.
- D1 Time Travel bookmark: recorded in the private release operations log.

Rollback is deliberately separate for code and data: restore the tagged Pages source for a code rollback; use the recorded D1 backup or Time Travel bookmark only when a data rollback is also required.

## Decisions in force

- Validation accounts and submissions remain disposable and separate from production.
- Production staff self-registration is limited to approved company email domains; each verified active operator receives new-submission alerts.
- Password login and provider-managed password recovery are active. Clerk Client Trust is disabled so new devices do not add an unimplemented email challenge after a correct password; lockout, password-strength, compromised-password, bot, and enumeration protections remain enabled.
- Exact route links remain gated to authenticated hunters. Public route stories and approved-report GPS locations remain public as designed.
- Private evidence is never auto-published. Operators must make a separate explicit publication decision, with media publication off by default.
- The RV guest and horseshoe-pit area remains restricted. Hunters planning to go beyond the public approach and enter the park must first check in with office staff and follow their directions.

## Follow-up wishlist

- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the end-user receipt presentation and mail copy in production.
- Add visible waypoint-progress tracking later; it is intentionally deferred from this release.
- Rotate bootstrap and API credentials after the launch window and retain only the production secret-store copies.
