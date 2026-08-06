# Scoped Service API production release

Date: 2026-08-05

## Release identity

- Service source: `37ca80283f02b75e46477dee9e05e0a6280f5de9`
- Service pull request: <https://github.com/murdawkmedia/seba-treasure-hunt/pull/2>
- Immutable production deployment:
  `https://7361dfea.seba-treasure-hunt.pages.dev`
- Canonical API base: `https://www.timlostsomething.com/api/v1`
- Console source: `c18edc4af2382699a21fc93d5adcdf2b620198a1`
- Console pull request: <https://github.com/murdawkmedia/sebahub-console/pull/78>
- Console deployment run:
  <https://github.com/murdawkmedia/sebahub-console/actions/runs/31058626776>

The merged service tree is byte-identical to the tested validation candidate.
The Console workflow installed its read credential as a server-side Pages
secret and installed the canonical API base as a server-side variable. No key
is present in browser code or a `VITE_` variable.

## Production data protection

Before the first production write, D1 was exported to an ignored local backup.
The export is 1,031,068 bytes with SHA-256:

`4ADA44F2F312C6C087B73CEAD7B1B1E81DE8B2FD19812DA2E0CEFA931EDE90F3`

Only migration `0023_service_api_keys.sql` was applied. The existing protected
records remained at 90 players, 37 private reports, five Field Notes, 23 case
items, five Official Updates and two staff principals. Foreign-key checks were
clean before and after the release.

The production key pepper was generated cryptographically and stored only as
an encrypted Pages secret. It was finalized before any production key row was
created.

## Credentials and scopes

Two independent production-bound keys exist:

- **SebaHub Console production**: 10 read-only scopes. Its plaintext value is
  stored only in the GitHub Actions secret `TIM_LOST_READ_API_KEY`, which the
  deployment workflow transfers to the Console Pages server secret store.
- **Tim Lost MCP production**: 16 case-operations scopes. Its plaintext value
  is stored only in an ignored local secret store for the dedicated MCP client.

Neither key can write staff access, legal records or service-key
administration. The case-operations key requires explicit confirmation and a
request-bound idempotency key for every mutation. D1 contains only HMAC hashes,
key metadata and append-only events: two active keys, two creation events and
zero idempotency rows at release time.

The ordinary browser confirmation dialog could not be completed reliably by
the automation bridge. A one-time guarded provisioner therefore used the same
production key format, cryptographic randomness, HMAC storage, scopes and
append-only event model as the application. It was removed immediately after
use. No plaintext key was printed, committed, written to D1 or copied into this
record.

## Verification

Service verification passed:

- exact legal-document generation;
- every TypeScript compiler check;
- the production build;
- the complete legacy/static suite;
- 608 TypeScript tests outside the separately documented local Miniflare
  shutdown hang;
- focused production API reads, scope enforcement and environment isolation.

Console verification passed 408 tests, the server build, dashboard build and
the complete GitHub Actions deployment. The production case-operations client
identified the `production` environment, loaded 23 items and exposed 16
scopes. An unconfirmed status mutation returned HTTP 422 and made no write. A
validation key used against production returned HTTP 401. Canonical, apex,
project and immutable service hosts reject unauthenticated service requests.

The Console remains behind Cloudflare Access. The Treasure Hunt workspace is
also intentionally limited to Console administrators. A basic Console profile
therefore does not see its navigation item even when Cloudflare Access itself
is valid.

## Rollback

1. Redeploy the prior known-good immutable service deployment.
2. Revoke both production service keys in the Case Room or directly disable
   their rows if the UI is unavailable.
3. Restore the pre-release D1 export only if migration or service-key data must
   be removed; do not overwrite later player, report or operator writes.
4. Roll the Console Pages project back to the previous deployment and remove
   the Treasure Hunt read secret if the integration itself is suspect.
5. Keep service-key events and idempotency records unless a full, explicitly
   approved database restore is required.
