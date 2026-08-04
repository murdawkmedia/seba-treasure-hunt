# Keep It, Tell Us validation release

Date: 2026-08-02
Application source: `5fbab68`
Environment: isolated Cloudflare validation only

## Candidate

- Immutable Pages deployment:
  `https://a27b6f83.seba-treasure-hunt.pages.dev`
- Stable validation review URL:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=5fbab68`
- Validation Ops:
  `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=5fbab68`
- Validation finder flow:
  `https://codex-validation.seba-treasure-hunt.pages.dev/report?release=5fbab68`
- Validation route:
  `https://codex-validation.seba-treasure-hunt.pages.dev/route?release=5fbab68`

Production was not promoted, migrated or mutated.

## Delivered behavior

- The public finder prompt is **Found something? Keep it. Then tell us.**
- The report starts with four plain choices, supports a known or custom item,
  accepts guest or Hunter submissions, allows up to three optional images, and
  defaults ordinary finds to **Share after staff review**.
- Nothing auto-publishes. Finder-sharing notice `2026.1` is recorded with the
  chosen publication preference and acceptance time.
- Confirmed Case Note publication can close a selected finite item in the same
  D1 batch as publication, selected media, item event and audit event. Cash and
  golf balls do not close. Custom items never change the evidence board.
- Public and Hunter action groups share one responsive contract. Phone actions
  stack full-width, remain separated, and meet the 48 px target minimum.
- Stop 11 keeps waypoint ID `10` and order `11`. Its full label is **The
  Driving Range & Brewing at Seba**, its compact label is **Stop 11 · Driving
  Range / Brewing at Seba**, and normal HTML surfaces link Brewing at Seba to
  `https://brewingatseba.com/`.
- The public wall uses selected photographs for every visible evidence card.
  Hunter-only text records render a deliberate no-photo state.

## Verified purse and public-media reconciliation

The newest Murdawk Media backup was inspected privately. Its authentic purse
photograph matched the preserved private July 31 source. The source was
retained privately and a metadata-free WebP derivative was selected for the
purse item.

Validation now exposes eight public-safe item records: seven evidence-wall
items plus the toy-car teaser. Every public board or teaser placement has one
selected media record, and every public media URL returned HTTP 200 with an
image content type. The purse media selection is versioned and has matching
`case_item.media_uploaded` and `case_item.updated` audit entries.

The temporary 467 MB SMS XML download, 25 extracted MMS previews and temporary
cash derivative were deleted after verification. No backup, unrelated message
or temporary extraction entered Git.

## Verification evidence

- Static and MJS tests: 317 passed, 0 failed.
- TypeScript and real-D1 tests: 606 passed, 0 failed.
- All TypeScript projects compiled.
- Exact legal generation and waiver QA passed with zero public privacy
  findings.
- Production-shaped build passed.
- Unified-shell QA passed its desktop, phone, landscape, keyboard, 200% zoom,
  and route-lightbox matrix.
- Deployed browser checks:
  - seven evidence cards and seven loaded evidence images;
  - eight public-safe API item records and eight working media URLs;
  - no horizontal overflow at 2033 px desktop or 375 px phone width;
  - phone actions measured 48–63 px high and stacked full-width;
  - report defaults to moderated sharing and displays sharing notice `2026.1`;
  - all 13 route cards remain present;
  - Stop 11 has no Digger Café reference and includes live Brewing at Seba
    links.
- `https://brewingatseba.com/` returned HTTP 200 after its current redirect.
- `git diff --check` passed before deployment.

## Production non-mutation proof

Read-only production checks after validation deployment returned:

- 74 player accounts;
- 29 private reports;
- 63 report-media rows;
- no foreign-key violations;
- migrations 0016, 0017 and 0018 still pending;
- `changed_db: false` and zero rows written.

No production Pages deployment, D1 migration, R2 write, Clerk change, DNS
change, email send or public post was performed.

## Owner validation checklist

1. Open the stable validation homepage and confirm the evidence-wall tone,
   photographed purse, ring, watch, camera and golf-ball cards.
2. On a phone, confirm the homepage, finder form and route actions stack
   clearly with no sideways scrolling.
3. Open **I Found Something** and test both a known item and a custom item.
   Confirm **Share after staff review** is the default and that a reference
   number is returned.
4. Submit one private-preference test and confirm Ops displays the preference
   and finder-sharing notice version.
5. Open Stop 11 and confirm the Brewing at Seba label and link.
6. In validation Ops, confirm finite-item **close on find** controls are enabled
   for the camera, watches, jewellery, purse, wallet and toy car, but disabled
   for cash and golf balls.
7. Do not test these changes on production. Production promotion requires a
   separate explicit approval.

## Promotion prerequisites after approval

1. Capture and verify a fresh production D1 export.
2. Confirm rollback commit and current production Pages deployment.
3. Apply production migrations 0016, 0017 and 0018 in order.
4. Import the approved item/media ledger through the guarded production
   procedure.
5. Deploy the exact reviewed source candidate.
6. Run production authentication, report, item-media, route, Ops and public
   smoke checks with rollback ready.
