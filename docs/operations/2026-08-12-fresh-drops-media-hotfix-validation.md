# Protected Fresh Drops media hotfix — validation record

Date: 2026-08-12

Source commit: `460c95b`

Pull request: <https://github.com/murdawkmedia/seba-treasure-hunt/pull/7>

Immutable validation deployment:
`https://3c8539a9.seba-treasure-hunt.pages.dev`

Stable validation page:
`https://codex-validation.seba-treasure-hunt.pages.dev/dashboard?release=460c95b#fresh-drops`

## Scope and root cause

The signed-in My Hunt media endpoint rejected valid processed images when the
R2 object lacked a usable HTTP content-type value. The authorized D1 media row
already held the verified JPEG, PNG or WebP type. This code-only hotfix applies
the same guarded fallback used by public media without changing records or
objects.

The protected handler still requires:

- an authenticated, participation-unlocked hunter;
- an authorized selected Fresh Drops media record;
- an existing derivative R2 object;
- an allowlisted D1 image type; and
- private, no-store, nosniff, sandbox and same-origin response protections.

No account, legal, item, media-selection, D1, R2 or public-media behavior was
changed.

## Verification evidence

- Test-driven regression failed with the old handler and passed after the
  guarded fallback was added.
- Complete automated suite: 698 passed, 0 failed.
- Worker, client and test TypeScript projects: passed.
- Authoritative legal-document verification: passed.
- Production build: passed.
- Served-output privacy scan: 56 static files passed.
- Public release diff scan found no credentials, local paths, private
  identities or internal workflow details.
- Validation runtime reports `validation`.
- Validation D1 contains 25 selected Fresh Drops uploads; all 25 have
  allowlisted image types and ready derivative keys.
- Signed-out protected-media requests return 401 and unknown public media
  returns 404.

## Remaining validation gate

Sign in with a disposable validation hunter and confirm the complete Fresh
Drops gallery renders on desktop and mobile, including the three-photo story,
camera and Apple Watch. Open one image in the shared viewer and confirm it
renders at full size. Production promotion remains blocked until this check is
confirmed.

## Release and rollback

Validation contains only the code/static hotfix. No migration or data rollback
is required. If the signed-in check fails, retain the current production
deployment and discard or supersede this validation candidate. After approval,
promote the reviewed source through the normal pull-request path and keep the
current production Pages deployment available for immediate code rollback.
