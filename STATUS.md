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

## Update 2026-07-17 — Submission, Ops and publication validation

- Completed the approved Submission, Ops and Publication Refinement through
  source commit `5bbce98`. The implementation standardizes the Lucky 13 short
  labels, repairs Case Note moderation media, clarifies public Case Notes versus
  private reports, guards the Turnstile lifecycle, and adds additive publication
  and public-attribution records.
- Operators now have separate Keep private, Publish to Case Notes and Create
  official Update outcomes. Official Updates are draft-first and may be saved,
  scheduled, published now or withdrawn. Direct Update images remain private
  until processed, selected and published; selection is off by default and
  selected direct images require alt text.
- Added one accessible, gallery-scoped approved-media viewer across official
  Updates, public Case Notes, Ops previews and the Lucky 13 route. Real image
  links retain open-in-new-tab behavior; normal activation uses an uncropped,
  `object-fit: contain` dialog with keyboard, focus restoration and mobile swipe
  support.
- Replaced the remaining private Case Room pirate-era type and text seal with
  the Documentary Case File typography and approved missing-ID mark. Ops
  authorization, route IDs and mutation behavior were not changed by the style
  pass. The publication confirmation now renders as one labelled native
  checkbox.
- Deployed the exact application candidate to the Cloudflare Pages
  `codex-validation` branch at
  `https://9e541ec2.seba-treasure-hunt.pages.dev`; the stable alias is
  `https://codex-validation.seba-treasure-hunt.pages.dev`. Applied Preview-only
  migrations `0014` and `0015` and deployed validation media processor version
  `5ec4f8ea-d5ab-428b-a7bf-ee7992634e3f`. Both endpoints report
  `deploymentEnvironment: validation`; production still reports `production`.
- Final verification reports 421 tests passing, exact legal artifacts, all
  TypeScript projects passing, a clean production build, no credential/private
  fixture matches in public output, and unified browser QA across 72 page
  navigations and 111 audited states with zero console, page, request or write
  errors.
- Manual validation confirmed the real validation Updates feed, one uncropped
  approved-report image dialog, a waypoint-scoped `Image 1 of 3` route dialog,
  13 public waypoints, public Case Notes, and the Case Room's Source Sans 3 /
  Cormorant Garamond / missing-ID identity. The existing disposable validation
  `test` Update remains isolated from production.
- Count-only production checks before and after validation deployment were
  identical: 11 players, 2 private reports, 2 Case Notes, 2 Updates, 1 staff
  principal, 30 audit events, 4 media rows, 13 published waypoints and 22 legal
  acceptances. Foreign keys remained clean, both reads reported zero rows
  written, and all 8 D1-referenced private R2 objects were verified by GET only.
- Production was not deployed, migrated or mutated. Authenticated live Ops
  scheduling, withdrawal, direct Update upload and real-provider Turnstile
  interaction remain owner acceptance checks in validation before any separate
  production-promotion decision.

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

## Shutdown checkpoint — 2026-07-17 09:32 MDT

- Objective: finish the validation-only shared image, public reply rate-limit,
  reply/flag moderation, public identity and story-copy refinement plan without
  mutating production data.
- Completed and independently reviewed: privacy-safe public identity
  (`9c0c963`, `1ab755e`), shared 20/50/30 MB Case Note image preparation
  (`12bef9b`), and five-per-ten-minute reply limiting (`24588be`).
- Task 4 D1/FakeStore reply and flag moderation work is preserved in local WIP
  commit `a1874e0`. Its isolated moderation tests passed. The broader
  `tests/api-store-integration.test.ts` run reported 23/24 passing; the single
  failure was a Miniflare local-proxy `EADDRINUSE 127.0.0.1:53309` in an
  unrelated waiver-lifecycle case, not an assertion failure. The interrupted
  retry, typecheck, spec review and code-quality review remain outstanding.
- Worktree: `C:\Users\Murphy\.config\superpowers\worktrees\tim-lost-production-release`;
  branch `codex/tim-lost-production-release`; clean after the checkpoint
  commits; 24 commits ahead of the tracked remote at checkpoint time.
- No test runner, local server, build, migration, deployment or database
  operation remained running. Production and validation services/data were
  not changed during this checkpoint.
- Approved remaining work, in order: finish and review Task 4; add Staff-only
  moderation APIs; add Ops reply/flag controls; reconcile privacy/counts;
  apply the public-story cleanup (remove public “campaign,” “Lucky,” “This
  year,” and sponsorship surfaces; revise fictional-ID and SebaHub wording);
  run full verification; deploy validation only.
- Exact resume action: verify Git/process reality first, then run the focused
  Task 4 integration tests against commit `a1874e0`; if green, run typecheck and
  diff checks, complete spec and quality reviews, and continue with Task 5.

Suggested resume instruction: “Resume from the 2026-07-17 shutdown checkpoint,
verify the worktree and processes first, then continue Task 4 from `a1874e0`
without repeating completed Tasks 1–3.”

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
