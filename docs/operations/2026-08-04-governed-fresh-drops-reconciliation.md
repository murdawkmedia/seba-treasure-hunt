# Governed Fresh Drops reconciliation

Date: 2026-08-04

Working-tree base: `d439311`

## Validation candidate

- Immutable Pages deployment:
  `https://9b9bb1e9.seba-treasure-hunt.pages.dev`
- Stable owner-review homepage:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=9b9bb1e9`
- Stable signed-in Fresh Drops review:
  `https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=9b9bb1e9#fresh-drops`
- Validation media worker version:
  `2b46dea9-2b19-4c57-a8fa-bbe7bfdd9a4f`

Murphy approved the Gucci-belt record and production promotion on 2026-08-04.
The production reconciliation and release evidence are recorded below.

## Private report triage

The newest live private report was moved to **Reviewing**, assigned to the
current operator, and kept **Private**. Its processed evidence was reviewed
against the known camera evidence. No item was marked Found, no image or text
was published, and no Case Note or Latest News draft was created.

No reporter identity, contact information, exact report text, or private
evidence is reproduced in this document.

## Manifest and media reconciliation

The existing guarded importer ran against the validation runtime only. The
runtime identified itself as `validation` before the first write.

| Pass | Created | Patched | Uploaded | Failed |
| --- | ---: | ---: | ---: | ---: |
| Reconciliation plus approved Gucci addendum | 1 | 14 | 1 | 0 |
| Idempotency | 0 | 0 | 0 | 0 |

The first pass reused all existing processed uploads and reconciled item
metadata, selection, ordering, audience and alternative text to the approved
manifest. The second pass made no changes.

The final validation ledger contains:

- 22 total case-item records;
- 19 Fresh Drops records (one story plus 18 item cards);
- 8 public-safe item records and 14 hunter-only records;
- 27 selected, ready media records; and
- two preserved Found states: Tim's ID and the Apple Watch.

All approved normalized files are represented through the manifest, with the
separate verified rings image retained. The sideways duplicate remains
omitted. Murphy explicitly approved the Gucci-belt photograph; it is stored as
a hunter-only Fresh Drops item at collection order 18 and is not exposed by
the signed-out item API. No stale validation-only record remains outside the
approved 22-record target, so no archival write was necessary.

## Authorization and privacy verification

- Signed-out `GET /api/v1/me/fresh-drops`: HTTP 401.
- Signed-out hunter-only media request: HTTP 401.
- Signed-out `GET /api/v1/ops/items`: HTTP 401.
- Signed-out public-media request: HTTP 200.
- Signed-in hunter review rendered all 18 Fresh Drops item cards, including
  the Gucci belt, plus the separate three-image story evidence block.
- The temporary validation authorization bridge was removed before the final
  build and immutable deployment. The clean Ops bundle contains no bridge or
  import control, and all one-time token handoff artifacts were removed.

## Production reconciliation

Before the first production write, D1 was exported to the ignored private
backup
`source-media/production-backups/2026-08-04-pre-gucci-production.sql`
(899,820 bytes; SHA-256
`3c6cf02893bf7fe73e30b422c70880cba89f5ff188e0a378c2a76709c515e97a`).
The pre-import ledger contained eight items, three Fresh Drops records, two
Found states, two ready item-media records and no foreign-key violations.

The guarded importer confirmed that the target runtime identified itself as
`production`, used both production approval safeguards, and authenticated with
a short-lived active staff session. Production's canonical staff issuer and
JWKS bindings were re-applied from the existing ignored local provider
configuration; no credential value was printed or committed.

The first attempt exposed a pre-existing media-processing gap: the production
media worker did not yet support `case_item` jobs. The current worker was built
and deployed as version
`57f9db4d-a76b-4994-b7c2-3c70a8133e8c`. Three approved story uploads that had
been left in the deduplicated deleted state were repaired from their exact
source hashes into metadata-free WebP derivatives, then the guarded importer
completed normally.

| Production pass | Created | Patched | Uploaded | Failed | Up to date | Existing hashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reconciliation | 13 | 19 | 19 | 0 | 0 | 5 |
| Idempotency | 0 | 0 | 0 | 0 | 19 | 24 |

The final production ledger contains 22 items, 19 Fresh Drops records, 24
ready item-media records, zero processing records, eight public-safe items and
two preserved Found states. `PRAGMA foreign_key_check` is clean. The Gucci belt
is Out there, hunter-only, not on the public board, and ordered 18 in Fresh
Drops. Signed-out `GET /api/v1/items` returns eight records and excludes the
Gucci belt; signed-out Fresh Drops access returns HTTP 401.

## Verification completed

- Exact legal-document verification: passed.
- All TypeScript projects: passed.
- Complete automated suite on the validation candidate: 632 passed, 0 failed.
- Production-shaped build: passed.
- Served-output privacy scan: 53 files passed.
- Manifest/importer-focused suite: 11 passed.
- `git diff --check`: passed.
- Public browser checks at 1440, 390 and 320 pixels: HTTP 200, eight evidence
  cards, two teaser cards, zero horizontal overflow and zero console errors.
- Live report recheck: Reviewing, Private and unpublished.
- Validation public API: eight public-safe records; hunter-only records remain
  absent.
- Production runtime and public item API: healthy after reconciliation.

## Release and rollback

The previous immutable Pages deployment remains
`https://a6dc3b9c.seba-treasure-hunt.pages.dev` for immediate code rollback.
The D1 export above is the pre-reconciliation data rollback point. The final
source commit, immutable production Pages URL and post-deploy browser smoke
results are appended after the clean release build is promoted.
