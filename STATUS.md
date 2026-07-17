# STATUS — Tim Lost Something?

Last updated: 2026-07-17

## Current state

The Tim Lost Something hunter platform is live at
`https://www.timlostsomething.com`. The public campaign, password-based hunter
accounts, company-domain Ops access, private reports, moderated Field Notes,
Lucky 13 route, participation waiver, transactional email, and operator alerts
are active in production.

The validation environment remains separate and disposable. Do not copy
validation accounts, submissions, or credentials into production.

## Update 2026-07-16

- Implemented both approved validation-first features. Report photos now accept
  up to 20 MB directly and browser-optimize supported JPEG/PNG/WebP sources
  above 20 MB through 50 MB, with three-file and 30 MB prepared-total limits,
  clear progress/failure states, cancellation and retry.
- Added a Staff-only, GET-only Production Snapshot area to Ops. It reads from
  dedicated validation Preview D1/R2 resources and exposes reports, players,
  staff, audit history and private media without adding any snapshot mutation
  route or production binding.
- Completed a repeatable guarded snapshot refresh. The verified validation
  snapshot matches production at 9 players, 1 report, 1 staff principal,
  10 audit events, 1 media record, 18 legal acceptances and 13 waypoints; both
  databases pass foreign-key checks and the production verification reads
  wrote zero rows. The two referenced private media objects were copied and
  hash-verified in the dedicated private snapshot bucket.
- Verified the final source with 396 passing tests, exact legal artifacts, all
  TypeScript projects, the production build and `git diff --check`. Production
  data was not mutated. After owner validation, commit `2fdefe6` was
  fast-forwarded to GitHub `main` and deployed to production as immutable
  deployment `https://f917fb4f.seba-treasure-hunt.pages.dev`.
- Completed post-release checks on the immutable deployment and
  `https://www.timlostsomething.com`: every public/legal/account/Ops route
  returns successfully, runtime config identifies production, validation-only
  UI is absent, report copy exposes the 50 MB source limit, the apex redirect
  preserves paths and queries, and anonymous waypoint data contains 13 records
  with no exact map links.
- Production D1 matched its pre-release baseline after deployment: 10 players,
  1 report, 1 staff principal, 10 audit events, 20 legal acceptances, 1 update
  and 13 waypoints. Foreign keys are clean and the comparison reads wrote zero
  rows.
- Approved and documented two validation-first designs without starting
  implementation or changing Cloudflare resources. The first adds a manual,
  full-fidelity production snapshot that is visible only through the existing
  server-authorized Staff/Ops experience and can never mutate production. The
  second accepts report photos up to 20 MB directly and browser-optimizes
  supported sources over 20 MB and up to 50 MB, with a 30 MB prepared total.
- The snapshot remains separate from both production and disposable validation
  data. Public validation testing remains link-accessible, Cloudflare Access is
  not required, and production passwords, provider secrets and sessions are
  never copied.
- Prepared the validation-only route-viewer and readability refinement without
  changing production: public secondary actions now use the readable filled
  button contract, and all 61 route photos open in an accessible,
  waypoint-scoped lightbox with keyboard, swipe, failure, reduced-motion,
  mobile and 200%-zoom coverage.
- Confirmed the production D1 environment sentinel remains `production` and
  recorded a read-only pre-deploy baseline of six player-account rows and one
  published update. The check wrote zero rows. All six accounts are protected;
  no production account, report, legal acceptance or update will be treated as
  disposable during validation work.
- Kept the disposable validation update isolated in the validation database.
  A Pages validation deployment does not copy that record, validation accounts
  or validation submissions into production.
- Deployed commit `4fb7a80` to the Cloudflare Pages `codex-validation` branch
  at `https://37b1a236.seba-treasure-hunt.pages.dev` and the stable validation
  alias. Post-deploy smoke checks confirmed the readable homepage actions and
  the route viewer on both URLs. Production remained on its prior public build,
  with the same six account rows and one published update before and after.
- Completed Release 2B in source without deploying it. Production remains unchanged pending explicit owner approval.
- Rebuilt the homepage as a documentary case record: hero status context, case-at-a-glance facts, primary real evidence, exact fictional-reference disclosure, Tim's chronology, Lucky 13 overview, one approved update, safe actions, private reporting, Support the Search and verified FAQ.
- Removed public pirate language, ornament and retired artwork; deleted both `sunny-pirate-treasure-seba-beach` files. Tim's 19 answer bodies, all 13 route waypoint IDs/order, 61 route photos, access controls and legal bodies remain unchanged.
- Renamed visible community identity to Case Notes while preserving `/clue-board` and internal Field Note contracts. Renamed visible sponsorship discovery to Support the Search while preserving `/sponsors`, forms, backend values and private Ops labels.
- Added bounded homepage reuse of `/api/v1/updates?limit=1`; the Updates page retains its 20-item pagination behavior.
- Added recursive source/rendered documentary regressions and refreshed the preservation fixture against reviewed base `c92e598` only after checking the exact public-page changes.
- Prepared Release 2A shared Documentary Case File foundation without deploying it.
- Added tracked `DESIGN.md` as the live campaign design source, including the approved local-mystery tone, visual/media/accessibility rules and the legal, auth, route and report invariants.
- Replaced public campaign typography with Cormorant Garamond, Source Sans 3 and IBM Plex Mono while leaving the private Ops console unchanged; regenerated the waiver from its authoritative source without changing any legal body, version or hash.
- Renamed the visitor navigation label to Case Notes while keeping `/clue-board` and all route/data contracts stable, and moved the existing Sunny Guarantee badge from the homepage hero into every shared campaign footer.
- Replaced the pirate favicon family with a path-only Missing ID mark and regenerated the ICO and 32/180/192/512 derivatives from the tracked SVG.
- Intentionally refreshed only the 13 approved font-loader head hashes and the homepage badge-removal body hash in the preservation fixture.
- Verified 222 static tests and 370 worker/client tests, legal generation, TypeScript checks, the production build and `git diff --check`.
- Prepared Release 1 interview-integrity source: the public feature is now
  Tim’s Account across page metadata, social previews, structured data,
  navigation and internal links.
- Kept the authoritative 19 entries and Tim’s answers intact, corrected the
  entry sequence to 1–19, and grouped the account under Before the route, Along
  the route and After the discovery.
- Kept the unpublished golf-ball question out of public sources and added
  focused regression coverage for count, numbering, sections, naming and
  excluded copy.
- Verified 218 static tests and 370 worker/client tests, legal generation,
  TypeScript checks and the production build.
- Release 1 changes are source-ready but are not recorded here as deployed to
  production. The later site-wide local-mystery rebrand remains pending.
- Kept the RV guest and horseshoe-pit area published as `restricted`.
- Updated its public instruction to require hunters to check in with office
  staff before going beyond the public approach and entering the park.
- Applied production D1 migration `0014_park_office_check_in_guidance.sql`.
- Verified the production API and rendered `/start` page show the new wording,
  one Restricted badge, and no browser console errors.
- Added a migration contract test; the static suite reports 211 passing tests,
  the worker/client suite reports 370, and TypeScript checks pass.
- Added an approved future creative direction to `docs/ROADMAP.md`: move from
  pirate theatre to a genuine local mystery. No production copy, artwork or
  styling changed as part of the roadmap update.

## Update 2026-07-17

- Approved and documented the validation-first Submission, Ops and
  Publication Refinement design. It clarifies Case Notes versus private
  reports, repairs moderation media counts and the overlapping Ops checkbox,
  introduces privacy-safe report-time attribution, and defines separate Keep
  private, Publish to Case Notes and Create official Update outcomes.
- The approved design adds a draft-first official Update workflow with
  preview, scheduling and withdrawal; direct Update media; a shared uncropped,
  orientation-correct approved-media viewer; Lucky 13 short labels; Turnstile
  friction diagnostics; and Documentary Case File styling for Ops.
- No application code, database, Cloudflare resource, production record or
  live Nancy & Ron Update changed during design documentation. Implementation
  remains gated on owner review of the written specification and a subsequent
  implementation plan.
- Murphy approved the written specification and requested implementation. The
  test-first execution plan is recorded at
  `docs/superpowers/plans/2026-07-17-submission-ops-publication-refinement.md`
  with three validation checkpoints. Inline execution is next; production
  promotion remains explicitly out of scope.

## Decisions in force

- Any production snapshot used by validation must be a manual, one-way,
  read-only copy in dedicated D1/R2 resources. Full-fidelity personal and
  private report data is permitted only behind existing server-side Ops
  authorization; public and hunter routes must never query the snapshot.
- Large report-photo support uses decimal MB: direct upload through 20 MB,
  browser optimization above 20 MB through a 50 MB source ceiling, no more
  than three prepared files and a 30 MB combined prepared payload. HEIC/HEIF
  conversion remains out of scope for the first release.
- Treat every production player-account row as real until an owner-led review
  identifies otherwise. Never wipe, reseed or copy validation data into the
  production D1 database.
- Validation releases may deploy code only through the `codex-validation`
  Pages branch with Preview bindings. Production data mutations and published
  update changes require a separate explicit approval and audited Ops action.
- Exact route controls remain available only to authenticated hunters.
- Public route stories and approved-report GPS locations remain public.
- Private evidence is never auto-published; operators make a separate explicit
  publication decision, with media publication off by default.
- Production and validation data must remain isolated.
- The RV guest and horseshoe-pit area remains restricted even when office staff
  check-in guidance is displayed.
- `DESIGN.md` is the source of truth for the suspenseful, conversational,
  community-led and lightly playful Documentary Case File direction, with
  SebaHub as host rather than subject. Release 2B applies that direction to the
  public source while production remains unchanged pending approval.

## Current follow-ups

- Review
  `docs/superpowers/specs/2026-07-17-submission-ops-publication-refinement-design.md`,
  then prepare the implementation plan only after owner approval of the written
  specification.

- Monitor the production report-photo flow and operator alerts during ordinary
  use; retain the previous immutable production deployment for immediate code
  rollback if an issue appears.
- Unpublish the disposable validation-only `test` update through the audited
  Ops workflow after an authorized validation staff session is available. Do
  not delete its private report or audit history, and do not mutate production.
- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the
  production receipt presentation and email copy.
- Add visible waypoint-progress tracking later; it remains intentionally
  deferred.
- Rotate bootstrap and API credentials after the launch window.
- Review the complete Release 2 source in validation, then seek explicit owner
  approval before any production rollout.
- After an approved deployment, smoke-test `/`, `/route`, `/interview`,
  `/updates`, `/clue-board`, `/sponsors`, `/start` and `/report` before updating
  production commit and deployment identifiers.

See `README.md` for build and operating contracts and
`docs/operations/2026-07-16-production-release.md` for release and rollback
details. See `docs/ROADMAP.md` for approved future direction.
