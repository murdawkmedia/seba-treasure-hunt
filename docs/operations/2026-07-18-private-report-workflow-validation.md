# Private Report Workflow — Validation Record

Date: 2026-07-18

## Release identity

- Source commit: `c6c8765`
- Cloudflare Pages project: `seba-treasure-hunt`
- Preview branch: `codex-validation`
- Immutable deployment: `https://f7da724f.seba-treasure-hunt.pages.dev`
- Stable owner-review URL:
  `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=c6c8765`
- Runtime on both URLs: `validation`
- Schema migrations: none
- Production promotion: not performed

## Operator behavior in force

Private review status and public publication are separate actions. The guided
state graph is:

```text
Received -> Reviewing -> Contacted -> Verified -> Resolved
              |             |            |
              +-------------+------------+-> Rejected
Rejected or Resolved -> Reviewing (explicit reopen)
```

Choosing a dropdown value performs no write. Apply sends one explicit audited
transition. Consequential backward, reject, resolve, and reopen transitions
require a private reason and confirmation under the reviewed transition rules.
Unassign keeps the current status. Stale writes fail closed and require a
refresh. Any authorized operator may correct a stage or reopen a terminal
report; history remains append-only.

Status changes never publish, withdraw, or republish a Case Note or Official
Update. Eligible media remains unselected by default, and public outcome
prerequisites continue to fail closed. Hunters receive only the safe status
labels Received, Under review, Verified, or Closed; edited public destinations
are presented separately.

## Viewport repair

The original review dialog combined an outer viewport height limit with a
second independent height limit on the inner report body. Header plus body
could exceed the outer dialog, whose hidden overflow clipped the Review state
controls near the bottom.

The shared Ops dialog now reserves one fixed header row and one
`minmax(0, 1fr)` scrolling body, uses dynamic viewport height where supported,
and removes the report body's competing height limit. Automated reachability
checks cover:

- 1440×1000 desktop;
- 390×844 standard phone;
- 360×640 short phone; and
- 360×250, equivalent to a 720×500 viewport at 200% zoom.

In every case the dialog and scroll body remain inside the viewport, the final
Review workflow/history control can be reached, workflow controls retain their
minimum target size, and the dialog has no horizontal overflow.

## Verification evidence

- Focused Ops and unified-shell contracts: 21 passed, 0 failed.
- Legacy/static suite: 284 passed, 0 failed.
- TypeScript worker, client and test projects: passed.
- Authoritative legal-artifact verification: passed.
- Production build: passed.
- Served-public privacy scan: 48 files, 0 findings.
- Isolated browser audit: 66 navigations, 102 states, 0 console errors, 0 page
  errors, 0 request failures, and 0 external or local-server writes.
- Report workflow browser fixture: eight named scenarios, eight allowed local
  synthetic writes, seven applied and one deliberately stale; Moderation Queue
  state remained unchanged.
- Immutable and stable validation endpoints: HTTP 200, `validation` sentinel,
  and the deployed viewport-grid, dynamic-height and single-scroll-body CSS.

The full local D1 integration-file runner retains its previously documented
Miniflare non-termination. Before this viewport-only follow-up, 536 tests had
completed and the named real-D1 workflow tests passed twice; only the exact
hung runner was stopped. The current three-file CSS/QA change does not alter
the API, datastore, schema or migrations.

## Production preservation

The release used count-only D1 reads before and after the validation upload.
Both snapshots matched exactly:

| Measure | Before | After |
|---|---:|---:|
| Players | 17 | 17 |
| Private reports | 6 | 6 |
| Report-derived Case Notes | 0 | 0 |
| Official Updates | 2 | 2 |
| Staff principals | 1 | 1 |
| Audit events | 73 | 73 |
| Report events | 14 | 14 |
| Media rows | 22 | 22 |
| Legal acceptances | 32 | 32 |
| Published waypoints | 13 | 13 |

The production sentinel remained `production`; the reads wrote zero rows and
the foreign-key check returned no issue. No production Pages deployment,
migration, D1/R2/queue write, account change or public publication occurred.

## Known maintenance item

`scripts/verify-environment.mjs` still asserts retired waypoint display text
and that validation contains no accounts, reports, Case Notes or staff. Those
assumptions predate current internal testing. It therefore fails even though a
direct read confirms the validation sentinel, 13 ordered waypoint IDs and the
distinct Seniors Centre and Derby's exact URLs. The verifier was not weakened
or edited as part of this release; modernizing it requires a separate reviewed
contract for allowed validation data.

## Owner acceptance still required

Using disposable validation records only:

1. Open a long report and scroll to Review workflow/history without changing
   browser zoom.
2. Repeat at desktop and phone widths.
3. Change Received to Reviewing and confirm selecting alone writes nothing.
4. Apply, reverse, reject, reopen and unassign with the required reasons and
   confirmations.
5. Confirm every workflow history entry remains reachable.
6. Confirm publication controls remain separate and images start unselected.
7. Confirm the hunter Dashboard shows only the safe private status and any
   separately edited public destination.

Production promotion requires Murphy's separate explicit approval after this
authenticated owner check.

## Guided Official Update publishing candidate

### Release identity

- Source commit: `0ced5f2bef2719b83c233bc345c8a62a5bc9d489`
- Cloudflare Pages project: `seba-treasure-hunt`
- Preview branch: `codex-validation`
- Immutable deployment: `https://a1a3cbcc.seba-treasure-hunt.pages.dev`
- Stable owner-review URL:
  `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=0ced5f2`
- Runtime on both validation URLs: `validation`
- Schema migrations: none
- Production deployment, migration and data mutation: not performed

### Candidate behavior

The Official Updates ledger now uses an explicit private lifecycle: an operator
creates or reopens a private draft, reviews the copy and up to three private
images, chooses **Publish now** or **Schedule for later**, and completes one
clearly labelled final confirmation. Scheduled entries stay absent from the
public feed until their due time. Drafts, media selections and publication
state remain private and auditable until that confirmation succeeds.

Report-linked publishing uses the same guided steps and keeps three outcomes
separate: private review only, publication to Case Notes, and publication or
scheduling as an Official Update. A report draft may be prepared during review,
but Official Update publication remains blocked until the report is Verified.
Submitted evidence and direct Update uploads share one visible three-image
limit, and every publishable image starts unchecked.

Every Ops view now presents a source/status explanation, a recovery action and
an explicit retry control. Disabled controls identify the missing prerequisite.
The report dialog uses one scroll body, restores focus on close, and collapses
to a single ordered column at narrow widths.

### Verification evidence

- JavaScript/MJS regression suite: 285 passed, 0 failed.
- TypeScript regression suite: 568 passed, 0 failed. The real-D1 integration
  file completed all 32 tests in 298.5 seconds; the earlier short-window stop
  was a command timeout, not a Miniflare or application hang.
- TypeScript worker, client and test projects: passed.
- Authoritative legal-artifact verification: passed.
- Public-output privacy and build-isolation suite: 16 passed, 0 failed.
- Environment, API-security and production-snapshot suite: 15 passed, 0 failed.
- Production-shaped build: passed.
- `git diff --check`: passed.
- Stable and immutable Ops routes: HTTP 200.
- Stable and immutable runtime configuration: `validation`.
- In-app browser mobile smoke test at 390 x 844: no horizontal overflow and no
  console errors on the validation staff-entry page.
- Production homepage: HTTP 200 and no validation banner. It was not deployed,
  migrated or otherwise changed during this release.

### Authenticated owner checks still required

Use disposable validation records only:

1. Create a standalone Official Update draft, leave the view and reopen it.
2. Exercise zero, one and three images, including a supported source over
   20 MB, and confirm every image starts private and unchecked.
3. Schedule an Update and confirm it is absent from the public feed before its
   due time; then publish a separate Update and open the public result.
4. Open a Reviewing report, save an Update draft and confirm publication is
   blocked until the report reaches Verified.
5. Move that report to Verified, select submitted evidence and direct uploads
   together, then publish or schedule the exact preview.
6. Publish the same report to Case Notes and confirm the Case Note remains
   visibly distinct from the Official Update.
7. Exercise the report dialog at desktop 100%, Windows 125% and 150%, and a
   narrow phone width. Confirm keyboard navigation, status announcements,
   scroll reachability and focus restoration.

Production promotion still requires Murphy's separate explicit approval after
these authenticated owner checks.
