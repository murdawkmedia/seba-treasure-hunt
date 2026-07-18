# STATUS — Tim Lost Something?

Last updated: 2026-07-18

## Current state

The Tim Lost Something hunter platform is live at
`https://www.timlostsomething.com`. The public case, password-based hunter
accounts, company-domain Ops access, private reports, moderated Case Notes,
13 Stops route, participation waiver, transactional email, and operator alerts
are active in production.

The validation environment remains separate and disposable. Do not copy
validation accounts, submissions, or credentials into production.

## Update 2026-07-18 — Private Report media-publication repair

- Prepared a validation-first repair for the Ops Private Reports workflow.
  Ready report images remain unselected by default, but eligible reports now
  explain where to select them for Case Notes or an Official Update.
- Resolved reports may be deliberately reopened to `reviewing`; the transition
  is recorded through the existing report-event and audit ledgers. Rejected
  reports remain terminal, and an active public post still blocks a terminal
  state change.
- Older signed-in reports that predate the stored public-attribution snapshot
  may use the fixed privacy-safe label `Community Hunter` only after the
  existing report-time waiver, current legal acceptance and participation
  checks pass. The fallback never copies a private name, email, current display
  name or current hunter handle. Blank or invalid stored snapshots still fail
  closed, and minor protection still forces `Young Hunter`.
- The Moderation Queue was not changed. Publication remains a separate operator
  action, report images remain off by default, only ready derivatives qualify,
  and an Official Update still requires a verified report plus final review.
- Verification completed with a red-green regression cycle, all TypeScript
  projects, a clean build and diff check, the complete legacy/browser suite,
  all TypeScript suites outside the D1 integration file, and the full real-D1
  integration suite. All completed with zero test failures.
- A count-only production D1 baseline read reported 17 players, 6 private
  reports, 0 report-derived Case Notes, 2 Official Updates, 1 staff principal,
  69 audit events, 22 report-media rows and 32 legal acceptances. The database
  sentinel was `production`; the read wrote zero rows and `changed_db` was
  false. No production record or publication was changed.
- Committed the exact candidate as `16f1c23` and deployed it to the
  `codex-validation` Pages branch. The immutable deployment is
  `https://cc1f5835.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=16f1c23`.
  Both return HTTP 200, report the `validation` runtime, and serve the image
  selection instructions, resolved-report reopen control and resolved-state
  guidance. The signed-out browser console contained only Clerk's expected
  development-instance warning and no application error.
- The post-deploy count-only production check exactly matched the baseline and
  again wrote zero rows with `changed_db: false`. Production Pages, D1, R2,
  queues and public content were not deployed or mutated.
- Next: complete an authenticated owner check in validation. Confirm an older
  eligible report exposes ready image checkboxes; reopen the resolved report,
  select only the intended images, and verify the Case Note/Official Update
  preview. Production promotion remains a separate explicit decision.

## Update 2026-07-18 — Production promotion

- Murphy explicitly approved production promotion after validation and owner
  testing. The exact application source at `5e01e7f` is live at
  `https://www.timlostsomething.com` and immutable Pages deployment
  `https://3731fa07.seba-treasure-hunt.pages.dev`.
- Applied additive production migration
  `0015_submission_ops_publication_refinement.sql`, then deployed production
  media processor version `7cc2b2c0-15ae-49a4-899c-be878657d9c5` before the
  Pages application so new Official Update media could not reach an old queue
  consumer.
- Created a gitignored pre-migration D1 export and confirmed a Cloudflare Time
  Travel restore point. Migration 0015 is fully applied with no pending
  migration and a clean foreign-key check.
- Fresh release verification passed the exact legal artifact check, every
  TypeScript project, a clean production build, the complete static/legacy
  suite, 515 TypeScript tests outside the known local Miniflare runner issue,
  and eight focused real-D1 publication/moderation integration tests.
- Isolated browser QA covered 66 navigations and 102 states with zero console,
  page, request or write errors. The waiver/onboarding QA observed 1,106
  requests with zero external writes, forbidden provider attempts or privacy
  findings. The tracked public source scan found no local paths, credentials,
  private keys, live service tokens or private workflow references.
- Live desktop and 390px mobile review found no console warnings/errors or
  horizontal overflow. The signed-in production route hydrated all 13 exact
  links; signed-out waypoint data still exposes 13 stories and zero exact map
  links. All public, legal, account and Ops routes returned successfully; the
  withdrawn sponsorship route returns 404; the apex redirect preserves paths
  and queries.
- Production data was preserved. Before and after release it remained at 15
  player accounts, 4 private reports, 5 Case Notes, 2 Official Updates, 1 staff
  principal, 30 audit events, 18 media rows, 13 published waypoints and 28
  legal acceptances. Final verification reads wrote zero rows.
- GitHub `main` was fast-forwarded through the exact deployed source. The prior
  immutable production deployment and source remain available for immediate
  code rollback; database rollback remains a separate, deliberate action.

## Update 2026-07-18 — Validation mobile signup recovery

- Deployed the validation-only mobile onboarding candidate through source
  commit `3705958`. The stable owner-review URL is
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=3705958`;
  the final immutable deployment is
  `https://48f49e54.seba-treasure-hunt.pages.dev`.
- The signup legal viewers now provide both a labelled top close control and a
  bottom `Done — back to account setup` action. Opening either document remains
  optional; the separate Privacy/Media and Waiver checkboxes remain required.
- Identity-provider create, verification preparation, correlated retry,
  resend, verification-code, password sign-in, password recovery, reset and
  session-activation operations now return to an explicit recovery state after
  a bounded wait instead of leaving a disabled spinner indefinitely. Retry is
  shown only when the saved resume and provider attempt are safely correlated;
  stale or missing attempts offer Restart account setup and Back to sign in.
- Real Chrome validation reproduced the Clerk development-instance stall and
  confirmed the deployed 20-second recovery. The provider did not progress to
  a retained email-code attempt, so real email-code completion remains an owner
  acceptance check after the validation Clerk instance is corrected or
  confirmed. The recovery screen itself was verified in the final deployment.
- Fresh verification reports 52/52 signup-browser tests passing, the complete
  legacy/static suite passing, 515 TypeScript tests outside the Miniflare store
  integration file passing, all TypeScript projects passing, exact legal
  artifacts, a clean production build and `git diff --check`. Independent code
  review found no remaining Critical, Important, Minor, privacy or security
  issue in the provider-timeout change.
- `tests/api-store-integration.test.ts` produced no output and did not terminate
  in two isolated local attempts; only its exact test-runner processes were
  stopped. This is the previously observed local Miniflare runner issue. The
  current change is confined to browser identity UI and tests and does not
  change the worker, datastore, schema or migrations.
- Read-only production D1 checks before and after the validation deployments
  were identical: 15 player accounts, 4 private reports, 5 Case Notes, 2
  Official Updates, 1 staff principal, 30 audit events, 18 media rows, 13
  published waypoints and 28 legal acceptances. Both reads wrote zero rows and
  reported `changed_db: false`; foreign-key checks returned no rows.
- Production was not deployed, migrated, routed or mutated. Production
  promotion still requires Murphy's explicit approval after owner validation.

## Update 2026-07-18 — Resilient mobile onboarding verification

- Completed the local verification gate for the mobile signup and recovery
  candidate through source commit `1c7f531`. The implementation sequence spans
  legal-viewer work through `b332056`, signup recovery through `37508d8`,
  provisioning recovery through `e4904b3`, shared session hardening through
  `95bdc31`, signup activation/BFCache fixes `1212d69`, `6d20a3f` and `bd9dd15`,
  and mobile legal-dialog target/focus fixes `e3f8691` and `1c7f531`.
- Added validation-safe, zero-write built-client journeys for iPhone-sized new
  signup and returning password sign-in; legal dialog reading, Done/Escape and
  focus restoration; independent legal acceptance; reload and email-app return;
  resend and changed-email recovery; delayed provisioning plus manual retry;
  incomplete-profile presentation; and reactive shared-header identity.
- Extended automated mobile accessibility coverage for keyboard operation,
  accessible names and statuses, visible focus, 44-pixel targets, 200%-zoom
  equivalent plus real Chromium 2x page scale, reduced motion and horizontal
  overflow. Added storage and public-build checks that forbid passwords,
  verification codes, tokens, legal-acceptance values and private fields beyond
  the approved bounded non-secret signup-resume record; successful finalization
  must clear the exercised name, email and legal-resume fields.
- The exact local gate reports 538 tests passing with zero failures or skips;
  all worker, client and test TypeScript projects passing; a clean production
  build; and exact generated legal artifacts. The focused Task 5 contract suite
  reports 26 tests passing.
- One recorded waiver browser journey completed 1,110 requests with all 74 external reads
  fulfilled locally and zero external writes, continued external requests,
  blocked writes, forbidden provider attempts or rejected writes. It scanned 48
  public files plus one classified private bundle with zero privacy findings.
- Unified-shell browser QA completed 66 navigations and 102 audited states with
  zero console errors, page errors, request failures or local/external write
  attempts. An explicit built-`dist` credential/private-fixture scan found zero
  matches, `git diff --check` passed, and the legal artifacts have no worktree
  changes.
- Production and validation were not contacted, deployed, migrated or mutated.
  Real Clerk email delivery, real mobile Safari, provider-managed password
  recovery and manual VoiceOver/TalkBack/NVDA checks remain Task 6 owner
  acceptance work in validation. The five HTTP 503 responses in the delayed
  provisioning journey are intentional local fixtures and are explicitly
  classified; unexpected console errors still fail the gate.
- Direct Close, bottom Done and Escape focus restoration are covered. A
  non-blocking follow-up is to make the dialog focus-containment installer
  explicitly idempotent and removable if account setup is initialized more than
  once in one document; current production setup installs it once.
- `README.md` was not changed because this verification work does not alter the
  operator or build contract.

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
- Worktree: local release worktree on branch
  `codex/tim-lost-production-release`; clean after the checkpoint
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

## Resume update — 2026-07-17 12:07 MDT

- Completed and reviewed Task 4’s validation-only reply and content-flag
  moderation datastore slice. D1 and FakeStore now provide privacy-safe
  moderation projections plus conditional, audited hide, restore, dismiss and
  hide-target transitions. Hiding a reply resolves every outstanding reply
  flag; restoring leaves resolved flags intact.
- Corrected the preserved D1 `hide_target` batch so it resolves sibling
  outstanding flags before the selected flag no longer qualifies as pending.
  The new regression covers both D1 and FakeStore behavior. No migration was
  required.
- Verification: the two focused Task 4 tests pass (real D1 and FakeStore), all
  TypeScript projects pass, and `git diff --check` is clean. A prior full
  integration-file retry exceeded the local command timeout without output, so
  it was safely isolated to the named Task 4 cases; no process was terminated.
- No production or validation deployment, database migration, or data mutation
  occurred. Next: Task 5, Staff-only reply and flag moderation APIs.

## Task 4 review follow-up — 2026-07-17 12:07 MDT

- Tightened the Task 4 audit contract after spec review. Each private audit
  insertion is now immediately gated by SQLite `changes() = 1` from the
  preceding conditional transition, so a same-actor, same-millisecond repeat
  cannot append a duplicate audit event. `hide_target` audits before resolving
  sibling flags, preserving both the guard and all-outstanding-flags behavior.
- Replaced timestamp-only moderation cursors with opaque versioned timestamp/id
  cursors and strict lexicographic predicates. D1 and FakeStore now sort,
  limit, advance and terminate identically for reply and flag listings.
- Added fixed-clock concurrent-repeat and equal-timestamp pagination
  regressions. Focused D1/FakeStore tests and all TypeScript projects pass;
  no migration, deployment, or data mutation was required.

## Task 4 quality follow-up — 2026-07-17 12:07 MDT

- Moderation listing cursors now fail closed: any supplied cursor without a
  valid `m1` payload, canonical ISO timestamp and nonempty ID raises the
  standard `400 invalid_cursor` error instead of restarting at page one.
- FakeStore moderation projections now match D1 eligibility joins: replies and
  flags require an approved parent Case Note and a matching author profile
  before any public identity or target data is projected. Regression coverage
  includes malformed cursors plus unapproved-parent and missing-profile
  exclusions.
- Focused D1/FakeStore tests and all TypeScript projects pass. No migration,
  deployment, or data mutation occurred.

## Task 4 cursor canonicality follow-up — 2026-07-17 12:07 MDT

- A supplied moderation cursor must now decode to exactly two fields and match
  the canonical versioned `m1` encoding byte-for-byte. Padded base64,
  whitespace-formatted JSON and surplus fields now fail with `400
  invalid_cursor` in D1 and FakeStore.
- Focused D1/FakeStore tests and all TypeScript projects pass. No migration,
  deployment, or data mutation occurred.

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
  SebaHub as host rather than subject. Release 2B and the current submission,
  publication and onboarding refinement are active in production; future
  material departures still require explicit review.

## Current follow-ups

- Monitor the production report-photo flow and operator alerts during ordinary
  use; retain the previous immutable production deployment for immediate code
  rollback if an issue appears.
- Monitor mobile signup recovery, direct Official Update media, scheduled
  Updates, Case Note publication, reply/flag moderation and public hunter
  identity during ordinary production use.
- Unpublish the disposable validation-only `test` update through the audited
  Ops workflow after an authorized validation staff session is available. Do
  not delete its private report or audit history, and do not mutate production.
- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the
  production receipt presentation and email copy.
- Add visible waypoint-progress tracking later; it remains intentionally
  deferred.
- Rotate bootstrap and API credentials after the launch window.
- Diagnose the local Miniflare runner hang separately; it did not reproduce in
  the focused real-D1 integration release gate.

See `README.md` for build and operating contracts and
`docs/operations/2026-07-16-production-release.md` for release and rollback
details. See `docs/ROADMAP.md` for approved future direction.
