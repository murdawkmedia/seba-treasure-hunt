# STATUS — Tim Lost Something?

Last updated: 2026-08-04

## Current state

The Tim Lost Something hunter platform is live at
`https://www.timlostsomething.com`. The public case, password-based hunter
accounts, company-domain Ops access, private reports, moderated Case Notes,
13 Stops route, participation waiver, transactional email, and operator alerts
are active in production.

The live Ops console now supports audited direct staff invitations, immediate
D1-first access suspension/reactivation, and reversible item-status controls.
The public evidence wall is data-driven, the Apple Watch is marked found, and
the governed Fresh Drops ledger contains the approved hunter-only collection,
including the Gucci belt.

The validation environment remains separate and disposable. Do not copy
validation accounts, submissions, or credentials into production.

## Update 2026-08-04 - governed Fresh Drops production reconciliation

- Murphy approved the previously held Gucci-belt photograph and production
  promotion. The manifest now includes it as an Out there, hunter-only Fresh
  Drops item at collection order 18; it is absent from the signed-out public
  item API.
- Exported production D1 before the first write to the ignored private backup
  `source-media/production-backups/2026-08-04-pre-gucci-production.sql`
  (899,820 bytes; SHA-256
  `3c6cf02893bf7fe73e30b422c70880cba89f5ff188e0a378c2a76709c515e97a`).
- Re-applied the canonical production staff issuer/JWKS bindings from ignored
  local configuration and deployed media processor version
  `57f9db4d-a76b-4994-b7c2-3c70a8133e8c`, which adds production support for
  `case_item` media jobs. No credential value was printed or committed.
- Repaired three interrupted, hash-deduplicated story uploads into exact,
  metadata-free WebP derivatives, then completed the guarded production
  importer. The reconciliation pass created 13 records, patched 19 and
  uploaded 19 images with zero failures; the second pass created, patched and
  uploaded zero, with all 19 items and 24 hashes already current.
- Production now has 22 case items, 19 Fresh Drops records, 24 ready item-media
  records, zero processing records, eight public-safe items and two preserved
  Found states. Tim's ID and the Apple Watch remain Found, and the foreign-key
  check is clean.
- Signed-out checks return eight public records, exclude the Gucci belt, and
  deny Fresh Drops with HTTP 401. Fresh source verification passed 632/632
  automated tests, every TypeScript project, exact legal artifacts, 11 focused
  manifest/importer tests, the production build, 53-file privacy scan and
  `git diff --check`.
- Pushed governed release `a8142cff1b3ca792157e6ac2086706d650aa16ec`
  to GitHub `main` and deployed Cloudflare Pages production deployment
  `ed4d0fe8-f91f-49f8-89e2-c0c47e49b3be`, immutable at
  `https://ed4d0fe8.seba-treasure-hunt.pages.dev` and live at
  `https://www.timlostsomething.com`.
- Post-deploy smoke checks passed on canonical and immutable hosts. Live Ops
  loads 22 records and the complete Gucci image. An authenticated hunter
  receives 18 Fresh Drops cards and the Gucci WebP; signed-out visitors cannot
  fetch the collection or see the Gucci record. The apex redirect preserves
  path/query, the public board has no horizontal overflow at 1280 pixels, and
  final D1 counts and foreign keys remain correct.

## Update 2026-08-04 - governed Fresh Drops validation candidate

- Privately triaged the newest live report: it is assigned, Reviewing and
  Private. Nothing from the report was published, no item was marked Found,
  and no public draft was created.
- Reconciled the approved Fresh Drops manifest against validation only. The
  first guarded pass patched 13 existing item records and reused all existing
  processed media; the approved Gucci addendum created and reconciled one more
  item. The final approved validation candidate has 22 item records, 19 Fresh
  Drops records and 27
  selected ready media records.
- Tim's ID and the Apple Watch remain Found. The sideways duplicate remains
  absent. The subsequently approved Gucci-belt
  image is hunter-only. No stale record required archival.
- The clean immutable validation candidate is
  `https://9b9bb1e9.seba-treasure-hunt.pages.dev`; owner-review URLs are
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=9b9bb1e9`
  and
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=9b9bb1e9#fresh-drops`.
- Verification passed: 632/632 automated tests, all TypeScript projects,
  exact legal artifacts, production build, 53-file privacy scan, manifest
  checks, signed-out public/hunter/Ops boundaries, signed-in 18-card Fresh
  Drops rendering, and 1440/390/320-pixel browser checks with no overflow or
  console errors.
- Production was unchanged during validation. The later approved production
  reconciliation is recorded above and in
  `docs/operations/2026-08-04-governed-fresh-drops-reconciliation.md`.

## Update 2026-08-04 - ops access and item-status production release

- Squash-merged the reviewed release to GitHub `main` as
  `64d303f197f22bbb451fefd417ca2bdecad85b25` without copying feature-branch
  commit history into `main`. The existing remote feature branch was not
  advanced during this release. The prior production source is preserved by
  the annotated tag `production-pre-ops-items-2026-08-04`.
- Verified the release on the actual merged `main`: 632/632 tests, every
  TypeScript project, exact legal artifacts, production build, 53 served-file
  privacy checks, and 111 Playwright states across 13 routes. Browser QA
  recorded zero console, page, request, overflow, local-write, or
  external-write failures.
- Exported production D1 before migration to the private local backup
  `tim-lost-production-pre-64d303f-20260804T202554Z.sql` (869,441 bytes,
  SHA-256 `2E9770190821897D7D3E074FC3E1AA9109552C48434A8B3C64349250A7A49609`).
- Applied only `0022_mark_apple_watch_found.sql`. Production had already
  recorded the watch as found through Ops, so the migration reconciled its
  public description without changing protected row counts or replacing the
  operator event. No migrations remain and `PRAGMA foreign_key_check` is
  clean.
- Cloudflare Pages deployment
  `a6dc3b9c-4339-4ff9-8e73-8ec64b53db88` is immutable at
  `https://a6dc3b9c.seba-treasure-hunt.pages.dev` and promoted at
  `https://www.timlostsomething.com`.
- Live smoke checks passed for Home, Route, Ops, Report, What People Found,
  Latest News, Dashboard, and Golf Balls on both hosts. Runtime identity is
  `production`; signed-out Ops returns 401; the apex redirect preserves path
  and query; and the public Apple Watch state is `found`.

## Update 2026-08-04 - ops access and item-status validation

- Verified the committed local release range `ac429df..ce65ab0`: direct
  invitation persistence is idempotent, self-suspension is D1-first and stops
  privileged reloads, the final-active guard rejects safely, and focused item
  status is reversible and audited. The Apple Watch is consistently FOUND in
  static public copy and API-hydrated case state.
- Final review fixes enforce the same target-state capabilities at the staff
  action API that Ops displays, remove the unsupported MFA-reset action, and
  prevent Fresh Drops imports from reopening an item already marked found.
- Fresh clean detached-checkout gates passed: `npm test` 632/632 in 440.6s;
  `npm run typecheck`, `npm run legal:verify`, and `npm run build` all passed.
  Canonical-LF verification baselines are recorded in commits `107af70` and
  `4e0ee44`.
- The committed-range denylist scan found no prohibited personal identifiers,
  absolute local paths, IPs, API-key/environment markers, or account numbers.
  The clean built-output privacy scanner passed all 53 served static files.
- Isolated Playwright QA passed using temporary output and local API mocks:
  111 responsive states across 13 routes, with zero browser/page/request
  errors, zero local writes, and zero external writes.
- This validation was local only: no push, deploy, production migration,
  invitation, or live access mutation occurred.

## Update 2026-08-02 - Keep It, Tell Us validation candidate

- Completed the approved **Keep It, Tell Us and Responsive Hunt Refinement**
  at application source commit `5fbab68` and deployed it only to the isolated
  Cloudflare Pages validation branch. The immutable deployment is
  `https://a27b6f83.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=5fbab68`.
- The public finder message now says **Found something? Keep it. Then tell
  us.** Ordinary finds default to moderated sharing without ever publishing
  automatically. Guests remain supported, photographs are optional, known
  and custom items are separate, and finder-sharing notice `2026.1` is stored
  with the report.
- Case Note publication can atomically mark a selected finite item Found.
  Cash and Casey's marked golf balls stay open-ended; custom item names never
  create or close evidence-board records. Ops can reverse an incorrect state
  through the existing versioned, audited item workflow.
- Stop 11 remains waypoint ID `10` and route order `11`, but every current
  visitor-facing label now identifies **The Driving Range & Brewing at Seba**.
  Linkable surfaces use `https://brewingatseba.com/`; the stable vanity URL
  currently resolves successfully to the active Brewing at Seba page.
- Verified the newest Murdawk Media SMS backup and matched its authentic purse
  photograph to the preserved July 31 source. Public-safe WebP derivatives
  now exist for the purse, rings, Apple Watch and camera. The validation item
  ledger was reconciled so every one of the seven public evidence-wall cards
  and both homepage teaser slots has selected, working image media. The
  temporary 467 MB SMS backup and all temporary attachment extracts were
  deleted after verification.
- Applied migration `0018_keep_it_tell_us.sql` only to the validation D1.
  Browser checks confirmed the seven-card evidence wall, all seven live card
  images, the finder flow, the 13-place route, the Brewing at Seba links, and
  no horizontal overflow at desktop or 375 px phone width. Mobile actions are
  full-width with 48 px or larger targets.
- Fresh verification passed 317/317 static and MJS tests, 606/606 TypeScript
  and real-D1 tests, every TypeScript project, exact legal and waiver checks,
  the production-shaped build, the complete responsive unified-shell matrix,
  public-output privacy checks, and `git diff --check`.
- Production remained unchanged and read-only: 74 players, 29 private
  reports, 63 report-media rows, migrations 0016-0018 still unapplied, zero
  rows written, and a clean foreign-key check. No production Pages, R2, Clerk,
  DNS, email or database mutation occurred.
- Full evidence and the owner checklist are in
  `docs/operations/2026-08-02-keep-it-tell-us-validation.md`. The next action
  is the owner's validation review; production promotion still requires separate
  explicit approval plus a fresh production D1 backup.

## Update 2026-08-01 - evidence-card media release candidate

- Completed the validation-only evidence-card repair begun in the checkpoint
  below. The Apple Watch's existing processed photograph is now public and the
  verified two-ring jewellery-box photograph was uploaded, processed, selected
  and made public through the audited validation Ops workflow.
- Public validation API checks show one selected public photograph for the
  Apple Watch and one for the two diamond rings. The purse remains text-only:
  no genuine purse photograph could be verified locally or in the connected
  Murdawk Media Drive, so no substitute or generated evidence was used.
- The source manifest now keeps all public evidence-board source media public,
  with a regression test covering the camera and Apple Watch. Fresh Drops
  contrast and link-selector fixes keep headings, status labels and report
  actions readable in the signed-in gallery.
- Validation QA fixtures were brought up to the current hunter-safe report
  projection, Fresh Drops endpoint, Ops copy and measured shared-header
  geometry. These are test-harness corrections only; no API, schema, legal or
  production behavior changed.
- Fresh verification passed 312/312 static and MJS tests, 595/595 TypeScript
  and real-D1 tests, every TypeScript project, exact legal generation, the
  production-shaped build, unified-shell QA across 111 states and 72
  navigations, waiver/signup QA with zero public privacy findings, sponsor
  withdrawal QA, and `git diff --check`.
- The former "Miniflare hang" is confirmed as a timeout misdiagnosis: the real
  D1 integration suite completes normally in about six minutes when given an
  appropriate command timeout.
- Source commit `3843c5c` is deployed only to the Cloudflare Pages
  `codex-validation` branch. The immutable deployment is
  `https://746147da.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is `https://codex-validation.seba-treasure-hunt.pages.dev/?release=3843c5c`.
- Deployed desktop and mobile browser checks confirmed the rings and Watch each
  render one real processed photograph, the purse remains honestly text-only,
  the incomplete-waiver account receives an explicit recovery action instead
  of an indefinite loader, and the console has no application errors. The only
  messages are the expected Clerk development-key warnings in validation.
- Production users, submissions, D1, R2, Clerk and Pages remain untouched. The
  next owner action is the owner's validation review; production promotion still
  requires separate explicit approval.

## Checkpoint 2026-08-01 - evidence-card image verification

- The owner asked why the public Apple Watch, diamond-rings and purse cards on the
  validation evidence wall do not show photographs. Investigation reached a
  safe stopping point before any upload, database write, deployment or public
  change.
- Verified root cause for the Apple Watch: source image
  `source-media/fresh-drops-2026-07-31/12-IMG_5619.jpg` is already processed and
  selected in validation, but its `case_item_media.audience` is
  `hunter_only` while the item itself is public and shown on the main board.
  The source manifest now marks this verified media public. A new regression
  test was first observed failing and then passing; focused result is 7/7.
- Verified the supplied two-ring box photograph by visual review and SHA-256.
  A preserved ignored working copy now exists at
  `source-media/core-evidence/IMG_5280-two-diamond-rings.jpg` with SHA-256
  `9A7C56391EC62B54265BE2AF6EB3CDC20FEFA71701F309F336135F34134A158F`.
  The rings item currently has no validation media row.
- No reliable purse photograph was found in the July 31 source set or the
  private 184-photo inventory. The owner then reported a brand-new backup that
  may contain one. A last-five-minutes local scan was started but timed out
  without identifying a candidate; inspect that newest backup first on resume.
- Working tree is intentionally uncommitted on branch
  `codex/tim-lost-production-release` at `4017c69`. Modified tracked paths are
  `scripts/fresh-drops-manifest.mjs` and
  `tests/fresh-drops-manifest.test.mjs`. The preserved rings source is ignored
  by Git under `source-media/`.
- An authenticated validation Ops item-board tab was opened, but no form was
  submitted and no media was uploaded. The validation D1 inspection was
  read-only. Production remained completely untouched.
- Exact next action after restart: inspect the newest backup for a genuine
  purse photo; then use the audited validation Ops item-media workflow to make
  the verified Apple Watch image public and upload/select the verified rings
  image (and purse image only if confidently matched). Verify the public API
  and desktop/mobile evidence wall, run the full validation gate, deploy only
  to validation, and stop for the owner's review.
- Resume check at 13:34 MDT matched this checkpoint exactly. A targeted local
  search found no SMS archive newer than
  `<local SMS backup>` (last modified July 31),
  and a read-only search of the connected Murdawk Media Drive found no SMS,
  backup or other file modified during the reported upload window. The newest
  backup therefore appears not to have synced into either accessible source
  yet. Re-check both sources before assuming it is absent.
- Focused manifest verification was rerun at 13:41 MDT: 7/7 tests passed and
  `git diff --check` passed. No command, upload, D1/R2 write, Pages deployment
  or production change was started during the resume window.

## Update 2026-08-01 - Fresh Drops registration-gate repair

- Reproduced the apparently stalled Fresh Drops section with a signed-in
  validation hunter. The account was authenticated but had not accepted the
  current participation waiver, so the approved `participationUnlocked` gate
  correctly prevented the private gallery and checklist writes; the client
  incorrectly left both surfaces looking active or permanently loading.
- Validation now states **Finish registration to open Fresh Drops**, links
  directly to the missing profile or waiver step, and disables private
  checklist controls with an explicit registration message until the account
  is unlocked. No legal gate was weakened or bypassed.
- The shared Clerk coordinator now coalesces concurrent token requests within
  one active session while refusing to reuse a token after a session change.
  This removes a second failure mode found while tracing the signed-in load.
- Final source is commit `5080a23` on top of auth repair `ab488b9`. The clean
  validation-only deployment is
  `https://001025e5.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=5080a23#fresh-drops`.
- Release gates passed 311 static/MJS tests, 595 TypeScript and real-D1 tests,
  every TypeScript project, exact legal verification, a production-shaped
  build, the 53-file output privacy scan and whitespace checks. The signed-in
  browser showed the correct locked state, the waiver recovery link opened the
  visible waiver section, and the final console contained zero errors.
- Production was not deployed, migrated or mutated. Next owner action: accept
  the current validation waiver personally, then confirm the 16-item Fresh
  Drops gallery and private checklist load for the newly unlocked account.

## Update 2026-08-01 - Fresh Drops validation candidate

- Completed the approved public-teaser plus signed-in Fresh Drops extension at
  exact source commit `ea29d2556aefb422f50ed63b849f981971892ba6`.
- Deployed only to the Cloudflare Pages `codex-validation` branch. The clean
  immutable candidate is `https://26b5382a.seba-treasure-hunt.pages.dev`; the
  stable owner-review URL is
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=ea29d25`.
- Applied `0017_fresh_drops_hunter_gallery.sql` only to the validation D1 and
  deployed validation media worker version
  `9940977f-bcbd-43a9-a744-27cbc4734c6d` with validation D1, R2 and queue
  bindings.
- The guarded import created 13 records, reconciled all 16 Fresh Drops items,
  processed 17 new source images, patched all 16 records and reported zero
  failures. A second import pass created, patched and uploaded zero records,
  proving the importer is idempotent.
- Validation now contains 21 case items in total: 16 Fresh Drops items, three
  public Fresh Drops records, 13 hunter-only records, two public teasers and
  20 ready, selected media records. The omitted sideways duplicate remains out
  of the public and hunter builds.
- The temporary validation-only import path was removed before the final build
  and the former credential returns HTTP 401. The public API exposes only the
  three public Fresh Drops items; the full gallery endpoint returns HTTP 401 to
  guests.
- Release gates passed exact legal verification, all TypeScript projects, 310
  static/MJS tests, 593 TypeScript/D1 tests, the production-shaped build,
  public-output privacy scanning and `git diff --check`.
- Browser checks found no console errors, no broken populated images, and no
  horizontal overflow at 390 or 320 pixels. The signed-in Ops inventory shows
  the Fresh Drops records; final hunter-account owner review remains the next
  manual check.
- Production remained unchanged: 64 players, 28 private reports, no
  `case_items` or `case_item_media` tables, zero rows written and a clean
  foreign-key check. No production Pages deploy, migration, D1/R2/queue write,
  Clerk change, DNS change or public post occurred.
- Full validation evidence and the owner checklist are in
  `docs/operations/2026-08-01-fresh-drops-validation.md`.

## Update 2026-07-31 - Unhinged Evidence Wall validation candidate

- Completed the approved B2 Full Investigation Board rebuild and froze the
  application source at commit `084234cc08960552c2088ee1cff49dac49f6055a`.
- Deployed only to the Cloudflare Pages `codex-validation` branch. The
  immutable candidate is `https://25925500.seba-treasure-hunt.pages.dev`; the
  stable owner-review URL is
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=084234c`.
- Applied `0016_dynamic_case_items.sql` only to
  `tim-lost-hunter-platform-validation`. The new public-safe item board contains
  seven versioned items and seven append-only seed events: Tim's ID is Found;
  cash, rings, camera, Apple Watch, purse and qualifying golf balls are Out
  there.
- Deployed only the validation media worker. Validation worker version
  `632e9e96-f616-4057-a9ad-7dded5e6cbe9` uses the validation D1, R2 and queue
  bindings.
- The public experience now uses one accessible evidence wall, three primary
  actions, the simplified four-choice I Found Something flow, plain visitor
  terminology and a mobile stacked-card fallback. My Hunt reuses the existing
  private per-hunter progress records as a 13-place checklist.
- Ops now exposes the audited What's Out There item editor, item media and
  announcement-draft workflow. Announcement actions create private Official
  Update drafts only and never publish automatically.
- Release gates passed 299 MJS/static tests, 546 non-D1 TypeScript tests and
  all 27 real-D1 integration tests in bounded groups, plus full TypeScript,
  legal-artifact, production-build, credential-scan, output-privacy and
  whitespace checks. The isolated browser QA passed 72 navigations, 111 states
  and 21 screenshots with zero writes or application errors.
- Deployed desktop and 390-pixel mobile checks found no horizontal overflow.
  The validation API returns all seven public-safe items, the ID has the
  accessible reversible Found treatment, and exact route links remain gated.
  The only browser warning is Clerk's expected development-key notice in the
  validation environment.
- Production remains at runtime `production`; it has no validation banner and
  does not contain the new evidence-wall copy. No production Pages deployment,
  migration, D1/R2/queue write, Clerk change, DNS change or public post
  occurred.
- Owner review and eventual production promotion remain separate. Full release
  evidence and the checklist are in
  `docs/operations/2026-07-31-unhinged-evidence-wall-validation.md`.

## Update 2026-07-29 - Casey golf-ball search promoted to production

- Murphy approved the validation-reviewed Casey golf-ball search and growing
  cash story for production. Exact application source
  `0db0100836368a7345e9905a71074cfe887a1c43` is live at
  `https://www.timlostsomething.com`.
- Cloudflare Pages deployment
  `1ee12c0e-f53f-4f9d-9c73-397b1e273432` is immutable at
  `https://1ee12c0e.seba-treasure-hunt.pages.dev`.
- The production release gate passed exact legal-artifact verification, all
  TypeScript projects, the 572-test complete suite, the production build,
  49-file output privacy scanning, additional credential/path/fixture scans
  and read-only desktop/mobile browser smoke checks.
- Live verification covered the homepage, Golf Balls, Route, Updates, Case
  Notes, Report and Ops routes. The custom domain and immutable deployment
  return HTTP 200, the apex redirect preserves path and query, the runtime
  reports `production`, and the live pages have no validation banner or
  horizontal overflow.
- Production D1 counts were identical immediately before and after deployment:
  56 players, 21 reports, 13 report-derived Case Notes, 4 Official Updates,
  2 staff principals, 343 audit events, 79 report events, 48 media rows,
  106 legal acceptances and 13 waypoints. Both reads wrote zero rows,
  `changed_db` was false and the foreign-key check was clean.
- No migration, D1/R2/queue write, Clerk or account change, media-worker
  deployment, DNS change or public post occurred.
- The application rollback tag is
  `production-casey-golf-balls-2026-07-29`. The immediately previous Pages
  deployment remains
  `cb2ad1cd-f5ce-45e8-a2c8-4b1d232ba45e` at
  `https://cb2ad1cd.seba-treasure-hunt.pages.dev`.

## Update 2026-07-29 - Casey golf-ball search validation candidate

- Completed the approved Casey golf-ball side search and Tim growing-cash
  story through exact source commit
  `0db0100836368a7345e9905a71074cfe887a1c43`.
- Deployed only to the Cloudflare Pages `codex-validation` branch. The
  immutable candidate is `https://87076691.seba-treasure-hunt.pages.dev`; the
  stable owner-review pages are
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=0db0100` and
  `https://codex-validation.seba-treasure-hunt.pages.dev/golf-balls?release=0db0100`.
- Tim remains the homepage lead. Roughly $5,000 is the starting amount, the
  current estimate is approaching $10,000 without a guarantee, and his ID and
  both diamond-ring baggies remain missing. Casey's separate page explains
  official In the Woods logo balls, the current one-ball/one-ticket offer,
  ball return, Casey-only redemption and the festival link.
- Fresh gates passed 572 automated tests, all TypeScript projects, exact legal
  artifacts, 26 focused public-content tests, the production-shaped build,
  49-file output privacy scanning, additional credential/path/fixture scans,
  and a 72-navigation/111-state/21-screenshot isolated browser audit with zero
  errors or writes.
- Validation caught and corrected an omitted Worker clean-route registration
  before handoff. The final immutable and stable homepage and `/golf-balls`
  routes return HTTP 200, and the runtime reports `validation`.
- No migration, D1/R2/queue write, Clerk or account change, media-worker
  deployment, DNS change, production Pages deployment or public post occurred.
  A read-only production comparison confirmed the live site still has neither
  the new route nor the new Casey story.
- Murphy approved this exact candidate and it was promoted byte-for-byte to
  production. Full validation evidence and the owner checklist are in
  `docs/operations/2026-07-29-casey-golf-ball-search-validation.md`.

## Update 2026-07-18 - Selectable report destinations in production

- Murphy approved the validation-reviewed destination selector for production.
  Exact application source `1d21fe556ba3e2c1f6a29bf0f8d4545199224c67`
  is live at `https://www.timlostsomething.com`. Cloudflare Pages deployment
  `cb2ad1cd-f5ce-45e8-a2c8-4b1d232ba45e` is immutable at
  `https://cb2ad1cd.seba-treasure-hunt.pages.dev`.
- An opened Private Report now presents three native selectable cards: Keep
  private, Publish to Case Notes, or Prepare an Official Update. Choosing a
  card is local and write-free; it only reveals the matching workflow. Case
  Notes use submitted report media, while Official Updates may use submitted
  media and direct Update uploads. Images remain private and unchecked until
  an operator deliberately selects and confirms them.
- The exact artifact was first deployed to validation at
  `https://47ecee3e.seba-treasure-hunt.pages.dev`, then promoted byte-for-byte.
  The release gate passed 572 automated tests, all TypeScript projects, exact
  legal artifacts, 16 privacy/isolation tests, 15 environment/security tests,
  the production build, focused destination contracts, `git diff --check`, and
  the 66-navigation/102-state isolated browser audit with zero writes.
- Live HTTP and browser checks covered the homepage, protected Ops entry,
  Updates, Case Notes and Report pages at desktop and 390-pixel phone widths.
  Every route returned HTTP 200, the apex redirect preserved path and query,
  no validation banner or horizontal overflow appeared, and the signed-out Ops
  workspace remained hidden. Cloudflare's injected analytics beacon continues
  to be blocked by the existing site CSP and can log a non-application console
  message; application behavior was unaffected.
- Production D1 counts matched immediately before and after deployment: 19
  players, 6 reports, 0 report-derived Case Notes, 2 Official Updates, 2 staff
  principals, 88 audit events, 16 report events, 22 media rows, 34 legal
  acceptances and 13 published waypoints. Both verification reads wrote zero
  rows, `changed_db` was false, and the foreign-key check was clean.
- No migration, D1/R2/queue write, Clerk change, media-worker deployment, DNS
  change or public post occurred. The application rollback tag is
  `production-report-destinations-2026-07-18`; the immediately previous Pages
  deployment remains `https://4e2d9df1.seba-treasure-hunt.pages.dev`.

## Update 2026-07-18 - Guided Official Update production promotion

- Murphy explicitly approved production promotion after validation review. The
  exact application source `a1c1e789bf914a1cd2162164ff5998a76e43a988` is now
  live at `https://www.timlostsomething.com`. Cloudflare Pages deployment
  `4e2d9df1-12e7-4205-a4a6-b6f49c1c497e` is immutable at
  `https://4e2d9df1.seba-treasure-hunt.pages.dev`.
- The guided, draft-first Official Update workflow is live for standalone and
  report-derived posts. Operators can prepare up to three private images,
  preview the exact public result, publish immediately or schedule it, and see
  explicit prerequisite and recovery guidance. Report publication remains
  blocked until the private report is Verified; Case Notes and private review
  remain separate outcomes.
- Fresh release gates passed: 285 JavaScript tests, 568 TypeScript tests, all
  TypeScript projects, exact legal artifacts, 16 privacy/isolation tests, 15
  environment/security tests, the production build, the isolated waiver
  browser audit, the 66-navigation/102-state unified-shell browser audit, 19
  focused QA contracts and `git diff --check`.
- Every expected public route returned HTTP 200; the deliberately withdrawn
  `/sponsors` route returned 404. The bare domain permanently preserved the
  tested path and query while redirecting to `www`. The runtime identified
  itself as `production`, exposed 13 public waypoints, contained no validation
  banner, CFCW reference, public `noindex` or sponsor navigation.
- Read-only desktop and 390x844 phone browser smoke tests found no horizontal
  overflow or console warnings/errors. The anonymous route rendered all 13
  waypoint sections and zero exact Google Maps links. The mobile Ops route
  showed only the protected staff gateway. Hunter Clerk, staff Clerk,
  Turnstile and both account portals all reported configured.
- Post-deploy production D1 counts matched the pre-deploy baseline exactly: 19
  players, 6 private reports, 0 report-derived Case Notes, 2 Official Updates,
  1 staff principal, 73 audit events, 14 report events, 22 media rows, 34 legal
  acceptances and 13 published waypoints. Both read-only checks wrote zero
  rows, `changed_db` was false and the foreign-key check was clean.
- No migration, DNS change, queue change or media-worker deployment was needed.
  The previous live source remains tagged
  `production-submission-onboarding-2026-07-18` at `5e01e7f`; the previous
  immutable Pages deployment is `https://3731fa07.seba-treasure-hunt.pages.dev`.

## Update 2026-07-18 - Guided Official Update publishing validation

- Completed the approved guided Official Update workflow through source commit
  `0ced5f2` and deployed only to the Cloudflare Pages `codex-validation`
  branch. The immutable deployment is
  `https://a1a3cbcc.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=0ced5f2`.
- Standalone Updates now have a private draft/reopen ledger, up to three
  private images, explicit publish-now or schedule-later choices, exact public
  preview confirmation and audited lifecycle actions. Scheduled entries stay
  off the public feed until due.
- Report-linked Updates use the same guided flow. Operators may prepare a draft
  while reviewing, but publication remains blocked until Verified. Case Notes,
  Official Updates and private review remain separate outcomes; submitted and
  direct media share one visible three-image limit and start unchecked.
- Every Ops view now explains its source state, recovery action and retry path.
  Disabled controls identify their missing prerequisite. The report dialog has
  one scroll body, narrow-screen ordering and focus restoration.
- The complete regression gate passed: 285 JavaScript tests and 568 TypeScript
  tests, all TypeScript projects, exact legal artifacts, 16 privacy/isolation
  tests, 15 environment/security tests, a clean production-shaped build and
  `git diff --check`. The 32-test real-D1 file completed successfully in 298.5
  seconds; earlier short-window stops were command timeouts rather than an
  application or Miniflare hang.
- Both validation URLs return HTTP 200 and identify the runtime as
  `validation`. A 390 x 844 browser smoke test found no horizontal overflow or
  console errors. Production was not deployed, migrated or mutated.
- Next: Murphy should run the authenticated owner checklist in
  `docs/operations/2026-07-18-private-report-workflow-validation.md` using
  disposable validation records. Production promotion remains a separate
  explicit decision.

## Update 2026-07-18 — Guided report workflow validation candidate

- Completed the approved reversible Private Reports workflow through source
  commit `c6c8765` and deployed only to the Cloudflare Pages
  `codex-validation` branch. The immutable deployment is
  `https://f7da724f.seba-treasure-hunt.pages.dev`; the stable owner-review URL
  is `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=c6c8765`.
- The report drawer now uses one viewport-bounded grid with one scrolling body.
  The Review workflow, history and public-outcome controls remain reachable at
  1440×1000, 390×844, a short 360×640 phone, and a 360×250 200%-zoom
  equivalent. The fix is shared by the other Ops dialogs as well.
- Fresh validation passed 21 focused static contracts, 284 legacy/static
  tests, all TypeScript projects, exact legal artifacts, a clean production
  build, a 48-file public-output privacy scan, and the isolated browser audit
  across 66 navigations and 102 states. The browser audit reported no console,
  page, request, overflow or external-write error.
- Both the immutable and stable validation URLs return HTTP 200, identify the
  runtime as `validation`, and serve the viewport-safe dialog rules. No schema
  migration was required.
- Count-only production reads before and after the validation upload matched
  exactly: 17 players, 6 reports, 0 report-derived Case Notes, 2 Official
  Updates, 1 staff principal, 73 audit events, 14 report events, 22 media rows,
  32 legal acceptances and 13 waypoints. Both reads wrote zero rows and the
  foreign-key check was clean. Production Pages, D1, R2, queues and public
  content were not deployed or mutated.
- `scripts/verify-environment.mjs` is stale: it still requires an empty
  validation database and retired waypoint wording. The release instead used
  read-only checks that confirmed the validation sentinel, the 13 ordered
  waypoint IDs, and the distinct Seniors Centre and Derby's URLs. Updating the
  old verifier is a separate maintenance task; it was not weakened during this
  release.
- Next: Murphy should open a disposable validation report on desktop and phone,
  scroll to Review workflow/history, change and reverse a status, and confirm
  the public-outcome controls remain deliberate. Production promotion remains
  a separate explicit decision.

## Update 2026-07-18 — Approved guided report-workflow design

- Approved and documented the next Private Reports refinement in
  `docs/superpowers/specs/2026-07-18-private-report-guided-reversible-workflow-design.md`.
- Converted the approved design into the test-first implementation sequence in
  `docs/superpowers/plans/2026-07-18-private-report-guided-reversible-workflow.md`.
  The plan fixes the shared state graph and copy, explicit transition/unassign
  API, atomic D1 audit behavior, recent Ops history, hunter-safe status and
  publication projections, guided responsive controls, full regression gate
  and validation-only owner checklist. It requires no schema migration.
- The opened report will replace `Begin review` with one explained status
  dropdown plus an explicit apply action. Any authorized operator may correct
  a non-terminal stage or reopen a rejected/resolved report to `reviewing`,
  with reasons, confirmations, assignment and append-only audit history.
- Private review status remains separate from Case Note and Official Update
  publication. Hunters receive simplified private statuses and distinct public
  outcome labels; their submissions never auto-publish or become an "official
  report" directly.
- The working Moderation Queue, legal text, intake fields and existing privacy
  defaults remain out of scope. Application implementation has not started.
  Next: execute the approved plan inline or with explicitly requested delegated
  workers, then deploy only to validation and stop for owner approval.

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
- A read-only validation D1 check found one received report and one verified
  report with a ready image; it wrote zero rows. Next: complete an authenticated
  owner check on that verified report, select only the intended image, and
  verify the Case Note/Official Update preview. The resolved-report reopen path
  is covered by real-D1 regression; it can also be exercised by deliberately
  moving a disposable validation report through resolve and reopen. Production
  promotion remains a separate explicit decision.

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
