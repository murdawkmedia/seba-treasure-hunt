# Scoped Service API validation candidate

Date: 2026-08-05

## Candidate

- Source commit: `0835071`
- Immutable Pages deployment:
  `https://5ae129e3.seba-treasure-hunt.pages.dev`
- Stable validation alias:
  `https://codex-validation.seba-treasure-hunt.pages.dev`
- Deployment environment: `validation`
- Production was not deployed or migrated.

## What changed

- Added environment-bound, hashed service keys with explicit scopes, optional
  expiry, one-time secret reveal, rotation overlap and immediate revocation.
- Limited key administration to the configured Murphy and Tech human staff
  identities. Service keys cannot manage keys, staff access, account security
  or legal records.
- Added explicit confirmation, request-bound idempotency and per-key/IP rate
  limits for service mutations.
- Added the Case Room key-control panel, the versioned OpenAPI contract and the
  operating runbook.
- Kept ordinary Clerk staff and hunter sessions unchanged.

## Validation infrastructure

- Applied validation-only migrations
  `0022_mark_apple_watch_found.sql` and `0023_service_api_keys.sql` to
  `tim-lost-hunter-platform-validation`.
- Added `TIM_LOST_API_KEY_PEPPER` only to the Pages preview environment. The
  first attempted value was replaced immediately, before any key existed,
  after the local PowerShell runtime rejected the newer RNG method. The active
  value was generated with the supported cryptographic RNG and remains
  encrypted in Cloudflare.
- Confirmed all three service-key tables exist and initially contain zero
  service keys.

## Verification evidence

- 608 TypeScript tests passed across 54 files. The documented unrelated
  full-file Miniflare hang was excluded; all other TypeScript suites ran.
- Legacy/static, legal-generation and all TypeScript compiler checks passed.
- The production build completed and `git diff --check` was clean.
- Service-key-focused tests passed 14/14, including hashing, environment
  isolation, revocation, rotation, append-only events, scopes, idempotency and
  oversized-body rejection before idempotency storage.
- Both immutable and stable validation hosts return HTTP 200, identify as
  `validation`, emit `noindex, nofollow`, and reject unauthenticated service
  and key-administration requests with HTTP 401.
- No plaintext service key or pepper is present in source, public output or
  this record.

## Remaining owner-gated validation

1. Sign in to the validation Case Room as Murphy or Tech.
2. Create one validation read-only key for SebaHub Console and one separately
   scoped validation operations key for the local MCP adapter.
3. Store each one-time value only in the applicable ignored local environment
   file or Cloudflare preview secret store.
4. Run the live read/scope/mutation/idempotency/revocation smoke matrix.
5. Validate the Console locally. Its existing Pages preview environment has no
   runtime configuration and must not receive copied production secrets.
6. Stop for Murphy's review before any production migration, secret, key,
   deployment or Console production wiring.

## Rollback

- Code: redeploy the previous immutable validation Pages deployment.
- Key access: revoke each validation key from the Case Room.
- Data: validation accounts and submissions remain disposable. Do not apply
  the service-key migration rollback to production; production is unchanged.
