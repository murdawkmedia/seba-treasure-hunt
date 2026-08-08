# Paid Clues access refinement — production release

Date: 2026-08-07

Validated source commit: `6ba4236`

Merged production commit: `a1cdb846351f1e49f7c9276ee2389a1be90e99de`

Pull request: <https://github.com/murdawkmedia/seba-treasure-hunt/pull/5>

Immutable production deployment:
`https://176996bf.seba-treasure-hunt.pages.dev`

Canonical page: <https://www.timlostsomething.com/clues>

## Production data protection

Before the first production write, D1 was exported to the ignored local backup
store. The export is 1,112,424 bytes with SHA-256:

`6A9DEE5E8AD35E7E793BE55743A9E8E0CA7F185C0A686A2A97107D568C46CA89`

The pre-release baseline contained 93 player accounts, 39 private reports,
five Field Notes, 23 case items, 25 case-item media records, five Official
Updates, two staff principals, 180 legal-acceptance events, and two service
keys. The maximum case-item version was four. Foreign-key checks were clean.

Only migrations `0024_paid_clue_decoder.sql`,
`0025_clue_notification_jobs.sql`, and
`0026_clue_early_access_confirmation.sql` were pending and applied. All
protected baseline counts and the maximum case-item version remained unchanged
after migration and import.

## Clue ledger import

The production importer required and verified all of its independent guards:

- production D1 environment sentinel;
- exact command-line production confirmation;
- separate process-level production confirmation;
- public build and tracked-source leak scan;
- canonical 30-record reconciliation.

The dry run found zero existing and 30 missing records. The guarded write added
the complete ledger: Clue 01 Released and Clues 02–30 Draft, with zero orders.
An immediate second guarded import found 30 existing and zero missing records
and made no write.

## Released behaviour

- Clue 01 is the complete public riddle-and-decoder sample.
- Later released riddles are public; their decoders are included for active
  signed-in hunters without payment.
- A hunter can buy early access only to the exact next Ready clue.
- Tim-cleared-payment attestation is required before Ops approval.
- Release is manual and sequential. Waiting claims block release; unclaimed
  carts cancel atomically; retraction returns a clue to Draft.
- No digging remains the default. A controlled-digging permit must be attached
  to one clue and a published open zone, with exact instructions restricted to
  current-waiver hunters.

## Verification

- Complete automated suite: 695 passed, 0 failed.
- Worker, client, and test TypeScript projects: passed.
- Authoritative legal-document verification: passed.
- Production build: passed.
- Deploy-output privacy scan: 56 served static files passed.
- Private-clue importer scan: 371 text assets passed before each production
  import attempt.
- Production D1 reported `production`, no migrations remained, all 30 clue
  records reconciled, and foreign-key checks remained clean.
- Canonical homepage and Clues page returned 200 without a validation notice.
- Public API returned 30 records, the complete Clue 01 sample, and 29 sealed
  records without private titles or riddles.
- Signed-out My Hunt and Ops clue endpoints returned 401.
- The bare hostname redirected permanently to `www` while preserving path and
  query.
- Desktop and 390 px mobile pages rendered without horizontal overflow.

Cloudflare's production edge injects its Web Analytics beacon, while the
existing application CSP blocks that external script and logs a console
warning. This does not affect page rendering, Clerk, the clue API, or core
workflows. The CSP was deliberately not broadened during this release.

## Rollback

1. Redeploy the prior production deployment
   `https://7361dfea.seba-treasure-hunt.pages.dev` for a code-only rollback.
2. Leave the additive clue schema in place unless a data rollback is actually
   required; unused additive tables do not affect the prior Worker.
3. If clue data itself must be removed, use the recorded pre-release export or
   Cloudflare D1 Time Travel after preserving any later live writes.
4. Never restore the full database over newer player, report, legal, item,
   update, or staff activity without a separate deliberate reconciliation.
