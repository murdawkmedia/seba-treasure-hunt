# Clerk human-check signup repair — production release

Date: 2026-08-12

Pull request: <https://github.com/murdawkmedia/seba-treasure-hunt/pull/9>

Production source:
`a09966b0c70fe12b6b7e06b3a0063096fb3da6af`

Immutable validation deployment:
`https://375f0f48.seba-treasure-hunt.pages.dev`

Immutable production deployment:
`https://07644280.seba-treasure-hunt.pages.dev`

Canonical site: `https://www.timlostsomething.com`

## Scope

The custom Clerk signup flow no longer races the initial `signUp.create`
promise against the application's ordinary 20-second identity-operation
timeout. Clerk Smart CAPTCHA deliberately leaves that promise pending while a
person completes an interactive challenge. The old race abandoned the form
and moved the user into an unrecoverable-looking restart loop.

The signup form now stays visible, tells the person to complete the human
check if it appears, and proceeds to the existing email-code step when Clerk
finishes. Short timeouts remain in place for sign-in, recovery, resend,
verification preparation and session activation.

This was a code-only release. It did not change D1, R2, accounts, legal
acceptances, clue records, item records or authentication-provider settings.

## Release evidence

- The new browser regression failed against the old timeout behavior and
  passed after the repair.
- Focused signup and registration suite: 52 passed, 0 failed.
- Complete automated suite: 698 passed, 0 failed.
- Worker, client and test TypeScript projects: passed.
- Authoritative legal verification: passed.
- Production build and served-output privacy scans: passed.
- Validation presented Clerk's interactive challenge and retained the same
  signup form, legal choices and entered details for more than 23 seconds,
  beyond the old failure threshold.
- The regression then completes the simulated challenge and verifies that the
  flow advances to email-code verification.
- After promotion, the canonical homepage, My Hunt, public config and status
  endpoints returned HTTP 200. Public config identified the runtime as
  `production`; no validation notice appeared.

## Rollback

The immediately previous production deployment is
`https://ad01795b.seba-treasure-hunt.pages.dev` (source `30dfe84`). If a runtime
regression appears, restore that Pages deployment through the normal
Cloudflare Pages rollback flow.

No database, object-storage, account or legal-ledger rollback is needed because
this release made no data changes.
