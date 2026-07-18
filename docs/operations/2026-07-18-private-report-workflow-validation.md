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
