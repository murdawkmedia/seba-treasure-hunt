# Evidence poster viewer release - 2026-08-05

## Outcome

The Coop Escape Artist wanted poster is no longer cropped on the homepage.
Its evidence card preserves the full 3:4 document, and selecting the poster
opens the shared full-image viewer. The same viewer now works for every
data-driven image on the evidence wall.

No D1, R2, item-ledger, account, legal, report or authentication state changed.

## Source changes

- Feature commit: `59035df` (`fix: show full evidence posters in image viewer`)
- Cache-release commit: `034ce6d` (`fix: refresh cached evidence viewer assets`)
- Document evidence uses a scoped `contain` treatment; ordinary photographic
  evidence retains the established card framing.
- Evidence media uses real links as progressive fallbacks and the existing
  delegated, accessible viewer for enhanced interaction.
- Homepage asset references carry `20260805-poster-viewer` so returning
  browsers cannot continue running the older unversioned item bundle.

## Verification

- Type checks passed for Worker, client and test projects.
- Feature candidate: 325/325 static/browser/privacy tests and 632/632
  TypeScript/real-D1 tests passed.
- Cache-release candidate: 325/325 static/browser/privacy tests passed.
- Production build passed.
- Public-output privacy scan passed across 53 served files.
- Validation and production returned HTTP 200 for the homepage and public item
  API.
- Browser QA confirmed:
  - the poster link exists on both validation and production;
  - the rendered poster is 344 by 459 pixels from a 1086 by 1448 source, with
    a negligible ratio delta and `object-fit: contain`;
  - the dialog identifies the current evidence gallery and poster;
  - closing the dialog restores focus to the poster link.

## Deployments

- Validation: `https://c3baa1fa.seba-treasure-hunt.pages.dev`
- Production candidate: `https://31664366.seba-treasure-hunt.pages.dev`
- Canonical: `https://www.timlostsomething.com/?release=034ce6d`

## Rollback

The previous immutable production release is
`https://20cee3a7.seba-treasure-hunt.pages.dev`. Because this release contains
no data mutation, rollback is limited to the Pages code/static deployment; no
D1 or R2 restoration is required.
