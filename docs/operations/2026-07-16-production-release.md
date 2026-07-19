# Tim Lost Something production release — 2026-07-16

## Current state

- Canonical site: `https://www.timlostsomething.com`
- Apex redirect: `https://timlostsomething.com` permanently preserves the path and query string when redirecting to `www`.
- Cloudflare Pages project: `seba-treasure-hunt`
- Production application commit: `a1c1e789bf914a1cd2162164ff5998a76e43a988`
- Production Pages deployment: `4e2d9df1-12e7-4205-a4a6-b6f49c1c497e`
- Immutable production URL: `https://4e2d9df1.seba-treasure-hunt.pages.dev`
- D1 migrations applied through `0015_submission_ops_publication_refinement.sql`
- Media worker version: `7cc2b2c0-15ae-49a4-899c-be878657d9c5`
- Production database environment sentinel: `production`
- Production route: 13 waypoints, with separate Seniors Centre and Derby's General Store records.

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

- Current application release tag: `production-guided-ops-2026-07-18`
- Immediate pre-release tag: `production-submission-onboarding-2026-07-18`
- Immediate previous production Pages deployment:
  `https://3731fa07.seba-treasure-hunt.pages.dev`
- Immediate previous production source: `5e01e7f`

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
