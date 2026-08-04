# Fresh Drops validation candidate

Date: 2026-08-01

Source: `ea29d2556aefb422f50ed63b849f981971892ba6`

Branch: `codex/tim-lost-production-release`

## Candidate

- Clean immutable deployment:
  `https://26b5382a.seba-treasure-hunt.pages.dev`
- Stable owner-review homepage:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=ea29d25`
- Stable owner-review My Hunt:
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=ea29d25#fresh-drops`
- Validation media worker version:
  `9940977f-bcbd-43a9-a744-27cbc4734c6d`

Production has not been promoted or changed.

## Data and media reconciliation

Migration `0017_fresh_drops_hunter_gallery.sql` was applied only to
`tim-lost-hunter-platform-validation`.

The guarded manifest import completed as follows:

| Pass | Created | Patched | Uploaded | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial | 13 | 16 | 17 | 3 | 0 |
| Idempotency | 0 | 0 | 0 | 36 | 0 |

The reconciled validation state is:

- 21 total case items;
- 16 Fresh Drops items;
- three public Fresh Drops items;
- 13 hunter-only Fresh Drops items;
- two public teaser items;
- 20 source uploads, all ready;
- 20 selected media records.

The camera and Apple Watch were reconciled with their pre-existing item
records rather than duplicated. The sideways/duplicate source was deliberately
omitted. Original source files remain outside the public build.

## Security and privacy verification

- The temporary import authorization existed only on the validation runtime
  while the importer ran.
- It was removed before the final build and deployment.
- The former import credential returns HTTP 401 against the clean candidate.
- `GET /api/v1/me/fresh-drops` returns HTTP 401 without a hunter session.
- `GET /api/v1/items` exposes only public-safe items and two teaser placements.
- The production-shaped build contains no temporary import bridge, import
  credential, raw source path, raw filename, storage key or private location.
- Public teaser images load through sanitized responsive derivatives.

## Automated verification

- Exact legal artifact verification: passed.
- TypeScript projects: passed.
- Static/MJS tests: 310 passed.
- TypeScript and real-D1 tests: 593 passed.
- Production-shaped build: passed.
- Public-output privacy scan: 53 served files passed.
- `git diff --check`: passed.

## Browser verification

- Public homepage shows the camera and toy-car teaser and a sign-in path to
  the complete Fresh Drops file.
- All 19 public-page images with populated sources loaded; none were broken.
- Signed-in Ops remained authenticated and displayed the Fresh Drops
  inventory, camera and toy car.
- All 22 populated Ops images loaded. The only zero-width image was the
  intentionally empty account-avatar placeholder.
- Browser console: zero application errors.
- Homepage at 390 pixels: no horizontal overflow.
- Homepage at 320 pixels: no horizontal overflow.

## Production non-mutation proof

Read-only production checks before and after validation work matched:

- 64 player accounts;
- 28 private reports;
- no `case_items` table;
- no `case_item_media` table;
- zero rows written and `changed_db: false`;
- clean `PRAGMA foreign_key_check`.

No production Pages deployment, schema migration, D1/R2/queue write, Clerk
change, DNS change or public publication occurred.

## Owner checklist

1. Open the stable validation My Hunt URL and sign in with a disposable hunter
   account.
2. Confirm the Fresh Drops section shows the complete 16-item gallery and that
   every thumbnail opens the full-image viewer.
3. Confirm camera and toy-car teasers are visible while signed out, but the
   hunter-only items are not.
4. Choose **I found this** on one Fresh Drop and confirm the private report
   opens with that item preselected.
5. Confirm the 13 Stops route and its existing progress remain unchanged.
6. Test the section once on a phone and confirm the evidence cards remain easy
   to read and tap.

Production promotion remains a separate explicit approval after this owner
review.

## Registration-gate repair

Date: 2026-08-01

Final source: `5080a23`

Supporting auth repair: `ab488b9`

- Clean immutable validation deployment:
  `https://001025e5.seba-treasure-hunt.pages.dev`
- Stable owner-review My Hunt:
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=5080a23#fresh-drops`

The owner review account was signed in but did not have a current waiver
acceptance, so `participationUnlocked` was false. The Fresh Drops API and
private progress API correctly remained closed, but their controls looked
stalled or broken. The repaired client now provides a direct profile/waiver
recovery action and disables private checklist controls with explanatory copy.
The participation gate and authoritative legal documents are unchanged.

The auth coordinator also coalesces concurrent token reads for one active
Clerk session and invalidates that in-flight reuse across session changes.
Regression tests cover both behaviors.

Final verification passed:

- 311 static/MJS tests;
- 595 TypeScript and real-D1 tests;
- all TypeScript projects;
- exact legal-artifact verification;
- production-shaped build;
- 53-file served-output privacy scan;
- whitespace checks;
- signed-in browser verification of the locked Fresh Drops state, disabled
  checklist controls and working waiver recovery link; and
- zero final browser console errors.

Production was not deployed, migrated or mutated. To finish the authenticated
owner check, the owner must personally review and accept the current validation
waiver, then confirm the complete 16-item gallery and checklist persistence.

## Evidence-card media repair

Date: 2026-08-01

Source commit: `3843c5c`

- Immutable validation deployment:
  `https://746147da.seba-treasure-hunt.pages.dev`
- Stable owner-review homepage:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=3843c5c`
- The validation item board now exposes the verified Apple Watch photograph
  and the verified two-ring jewellery-box photograph as public processed
  media. Both media endpoints return HTTP 200 and both images appear on the
  public evidence wall with descriptive alternative text.
- The purse stays text-only because no genuine purse photograph could be
  verified in the accessible local or Murdawk Drive sources. No generated or
  substitute image was presented as evidence.
- Fresh Drops readability fixes explicitly restore dark headings, an
  accessible status-red, and the intended dark-on-gold report action.
- Validation QA fixtures now represent the current hunter-safe report fields,
  signed-in Fresh Drops read, Ops copy and measured sticky-header geometry.

Final verification passed:

- 312/312 static and MJS tests;
- 595/595 TypeScript and real-D1 tests;
- every TypeScript project and exact legal-artifact verification;
- production-shaped build and 53-file served-output privacy scan;
- unified-shell QA across 111 states and 72 navigations with zero browser
  errors, page errors, request failures or external writes;
- waiver/signup QA with zero public privacy findings;
- sponsor-withdrawal and validation-header QA; and
- deployed desktop and mobile browser review.

The earlier apparent local Miniflare hang was a short command-timeout issue.
The real D1 integration suite completes normally in about six minutes. The
stale local preview process was terminated after verification and port 8788 is
free. Production was not deployed, migrated or otherwise mutated.
