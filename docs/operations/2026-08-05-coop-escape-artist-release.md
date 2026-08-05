# Coop Escape Artist production release

Date: 2026-08-05

## Approved item

The supplied wanted poster is now the authoritative source for a new public
case item:

- owner: Casey;
- title: **The Coop Escape Artist**;
- status: **Out there**;
- location description: Kokanee Springs RV Park;
- outcome: return the chicken to the front chickens for the stated $100
  reward; the finder does not keep the animal;
- public placement: the main evidence board and Fresh Drops collection order
  19; and
- report behavior: reportable and closed when an approved find is published.

The original 1,536 by 2,048 PNG is retained only in the ignored private source
media area. Its SHA-256 is
`de8a5f6baa4bdc926ea59e32e0d0f57db9bb6ebcf5008235ccab7711e1dec7e7`.
Only the metadata-clean WebP derivative is publicly served.

## Validation and production reconciliation

Validation received one public Draft item, one processed image and the exact
approved alternative text before its status changed to Out there. The
validation ledger contained 23 items after reconciliation.

Before the first production write, D1 was exported to the ignored private
backup
`source-media/production-backups/2026-08-05-pre-coop-escape-artist-production.sql`
(1,009,530 bytes; SHA-256
`f5018511548210873c1bfe2dbdb7c0e3ff505fed43b6648f0e7554106fa4e39a`).
The baseline contained 22 items, 19 Fresh Drops records, 24 ready and selected
media records, three operator-maintained Found states and no foreign-key
violations.

The first media attempt exposed that the existing importer labelled every
source as JPEG. The API rejected the PNG while the newly created item remained
Draft and therefore non-public. The importer now derives supported image MIME
types from the source extension, with focused coverage for the PNG contract.
The guarded resume uploaded one image, patched one item and reported zero
failures. The immediate idempotency pass created, patched and uploaded zero;
all 20 items and 25 source hashes were current.

The final production ledger contains:

- 23 total case items;
- 20 Fresh Drops records;
- nine public-safe items;
- 25 ready and selected item-media records;
- three preserved Found states; and
- no foreign-key violations.

## Verification

- Exact legal-document verification: passed.
- All TypeScript projects: passed.
- Complete automated suite after the importer fix: 632 passed, 0 failed.
- Production build: passed.
- Served-output privacy scan: 53 files passed.
- Manifest/importer-focused suite: 12 passed, 0 failed.
- `git diff --check`: passed.
- Canonical and immutable Home, Route, Report, Latest News, What People Found,
  My Hunt and Ops routes: HTTP 200.
- Public item API: nine records, including one Out there Coop Escape Artist.
- Public poster derivative: HTTP 200 `image/webp`.
- Authenticated Fresh Drops: 20 records, including the chicken and the
  hunter-only Gucci belt.
- Browser checks at 1,280 and 390 pixels: nine evidence cards, poster rendered,
  zero horizontal overflow and zero console errors.
- Bare-domain redirect: HTTP 301 with path and query preserved.

## Release and rollback

Source commit `4fc070a` was pushed to GitHub `main`. Cloudflare Pages production
deployment `20cee3a7-25f2-4e30-8444-829ccdb6b9c3` is immutable at
`https://20cee3a7.seba-treasure-hunt.pages.dev` and live at
`https://www.timlostsomething.com`.

The previous immutable Pages release remains
`https://ed4d0fe8.seba-treasure-hunt.pages.dev` for immediate code rollback.
The D1 export above is the pre-item data rollback point. Existing R2 originals
and derivatives remain available if a data rollback is required.
