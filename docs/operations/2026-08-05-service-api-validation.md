# Scoped Service API validation candidate

Date: 2026-08-05

## Candidate

- Source commit: `77bdb25`
- Immutable Pages deployment:
  `https://0839ba39.seba-treasure-hunt.pages.dev`
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

## Owner-gated validation completed

- Preview key administration now authorizes the existing validation-only
  `murphy+treasure` and `tech+treasure` operator identities. Production keeps
  the exact `murphy@sebahub.com` and `tech@sebahub.com` allowlist unchanged.
- Created one validation read-only Console key and one separately scoped full
  case-operations MCP key. Plaintext values exist only in an ignored local
  validation environment file; neither value is recorded here or in source.
- Confirmed the service session and capabilities identify as `validation`, all
  15 Console workspace sources connect, and the read-only key receives HTTP
  403 for a mutation.
- Confirmed a private draft mutation, exact idempotent replay, changed-request
  HTTP 409 conflict, validation-prefix isolation, 300-read limit followed by
  HTTP 429, rotation overlap, and immediate old-key revocation.
- Confirmed the local MCP lists 14 tools, reads the live validation workspace,
  rejects an unconfirmed mutation, and creates only a private confirmed draft.
  Validation smoke drafts do not appear in the public Updates feed.
- The Console adapter smoke uncovered and fixed a success-envelope mismatch;
  its regression now accepts the canonical `{ data: ... }` response shape.
- Production remained unchanged throughout this validation stage. Murphy later
  approved promotion; the completed production release is recorded in
  `2026-08-05-service-api-production-release.md`.

## Rollback

- Code: redeploy the previous immutable validation Pages deployment.
- Key access: revoke each validation key from the Case Room.
- Data: validation accounts and submissions remain disposable. Production
  rollback is governed separately by
  `2026-08-05-service-api-production-release.md`.
