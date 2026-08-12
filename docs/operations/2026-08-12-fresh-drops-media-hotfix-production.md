# Protected Fresh Drops media hotfix — production release

Date: 2026-08-12

Pull request: <https://github.com/murdawkmedia/seba-treasure-hunt/pull/7>

Production source:
`30dfe844aaf3b4dab5f5c6c0c5b1d8ad8b3e8e64`

Immutable production deployment:
`https://ad01795b.seba-treasure-hunt.pages.dev`

Canonical site: `https://www.timlostsomething.com`

## Scope

The protected My Hunt media endpoint now accepts the authorized D1 JPEG, PNG
or WebP content type when an otherwise valid R2 derivative has missing or
generic HTTP content-type metadata. Authentication, participation status,
item/media authorization, object existence and private response protections
remain required.

This was a code-only release. It did not change D1, R2, accounts, legal
acceptances, items, image selections or public-media behavior.

## Release evidence

- The immutable validation candidate passed the real signed-in browser gate
  before production promotion.
- All 25 selected Fresh Drops images loaded on desktop and at a 390 x 844
  mobile viewport, including the three-photo story, camera and Apple Watch.
- Every observed protected image response returned HTTP 200 with an image
  content type, `private, no-store` and `nosniff`.
- Complete automated suite: 698 passed, 0 failed.
- Worker, client and test TypeScript projects: passed.
- Authoritative legal verification: passed.
- Production build and served-output privacy scan: passed.
- After deployment, canonical config and My Hunt returned HTTP 200.
- Signed-out production access to protected Fresh Drops media returned HTTP
  401 as expected.

## Rollback

The immediately previous production deployment is
`https://176996bf.seba-treasure-hunt.pages.dev` (source `a1cdb84`). If a
runtime regression appears, restore that Pages deployment through the normal
Cloudflare Pages rollback flow.

No database or object-storage rollback is needed because this release made no
D1 or R2 changes.
