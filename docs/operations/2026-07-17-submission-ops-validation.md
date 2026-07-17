# Submission, Ops and publication validation — 2026-07-17

## Release boundary

- Application source: `5bbce98`
- Cloudflare Pages branch: `codex-validation`
- Immutable deployment: `https://9e541ec2.seba-treasure-hunt.pages.dev`
- Stable validation alias:
  `https://codex-validation.seba-treasure-hunt.pages.dev`
- Validation media processor version:
  `5ec4f8ea-d5ab-428b-a7bf-ee7992634e3f`
- Preview migrations applied: `0014_park_office_check_in_guidance.sql` and
  `0015_submission_ops_publication_refinement.sql`
- Production promotion: **not performed**

The Pages deployment uses Preview D1, R2, queue, Clerk, Turnstile and campaign
origin bindings. Both validation URLs return `deploymentEnvironment:
validation`; the canonical production config continues to return `production`.

## Delivered behavior

- Lucky 13 stop labels are consistent in filters, moderation and publication.
- Case Note submissions and private reports have distinct user guidance.
- Case Note moderation shows uploaded media and its correct count.
- Turnstile tokens are consumed once and reset without a second-click loop.
- Report-time attribution supports public display name, hunter handle or
  community attribution while forcing minor reports to `Young Hunter`.
- Operators may keep a report private, publish an independently withdrawable
  Case Note, or create a draft-first Official Update.
- Official Updates support save draft, schedule, publish now and withdraw.
- Direct Official Update images are processed through dedicated private records,
  selected off by default and require alt text before publication.
- Approved media opens through one uncropped, gallery-scoped viewer while the
  underlying link remains available for open-in-new-tab use.
- The Ops Case Room uses the Documentary Case File type and identity system and
  one accessible publication-confirmation checkbox.

## Automated evidence

- `git diff --check`: clean
- `npm run legal:verify`: passed
- `npm run typecheck`: passed for worker, client and tests
- `npm test`: 421 passed, 0 failed
- `npm run build`: passed
- `npm run verify:unified-shell-qa`: passed
  - 72 page navigations
  - 111 audited states
  - 13 campaign routes
  - mobile, desktop and 200%-zoom-equivalent layouts
  - 10 route/viewer states
  - 0 console errors
  - 0 page errors
  - 0 request failures
  - 0 external or local writes
- `node scripts/qa-output-privacy.mjs`: passed
- Public-output scan: no credential-shaped values and no private Nancy & Ron
  validation email fixture
- Preview D1 migration list after deployment: no pending migrations

## Manual validation evidence

- The immutable URL and stable alias each report validation and return 13
  public waypoints.
- The validation Updates feed returns its two disposable records after the
  Preview migrations were applied.
- An approved-report thumbnail opened one dialog labelled `Image 1 of 1` with
  the full image link retained and `object-fit: contain` styling.
- The first waypoint image opened a route-scoped dialog labelled `Image 1 of
  3`, proving navigation remains inside the selected waypoint gallery.
- Public Case Notes loaded one approved validation note and kept the private
  report route visually separate.
- The signed-out Case Room rendered the validation warning, company-domain
  login gateway, Source Sans 3 body, Cormorant Garamond heading and approved
  `/assets/favicon.svg` identity mark.

## Production safety comparison

The count-only production D1 baseline was read immediately before and after
the validation deployment. Both reads returned:

| Protected resource | Before | After |
|---|---:|---:|
| Player accounts | 11 | 11 |
| Private reports | 2 | 2 |
| Case Notes | 2 | 2 |
| Official Updates | 2 | 2 |
| Staff principals | 1 | 1 |
| Audit events | 30 | 30 |
| Media rows | 4 | 4 |
| Published waypoints | 13 | 13 |
| Legal acceptances | 22 | 22 |

Both D1 reads reported `rows_written: 0` and `changed_db: false`.
`PRAGMA foreign_key_check` returned no rows both times. The eight private and
derivative R2 objects referenced by production D1 were verified before and
after using remote GET operations only; all eight remained available.

No production Pages deployment, D1 migration, D1 write, R2 write, queue
deployment, published Update change or account change occurred.

## Owner acceptance checks still open

These checks require a deliberate authenticated validation session and may
create or change only disposable validation records:

- save an Official Update draft, then schedule and withdraw it;
- upload a direct Official Update image and verify processing, alt text,
  selection-off-by-default and public display;
- publish and independently withdraw a report-derived Case Note;
- confirm the one-checkbox publication control inside authenticated Ops;
- exercise a real provider Turnstile challenge without a VPN on a second
  device; and
- visually review the Ops review drawer at Windows 100%, 125% and 150% display
  scaling.

The existing validation-only `test` Update is retained as disposable viewer
evidence until an authorized operator deliberately withdraws it. It is not in
production.

## Promotion rule

Do not promote this candidate to production until Murphy completes the owner
acceptance checks and explicitly approves a separate production release. A
production release must repeat legal, type, full test, build, privacy, browser,
production baseline and rollback checks against the exact promoted commit.
