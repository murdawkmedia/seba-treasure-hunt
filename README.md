# Tim Lost Something?

The public website and hunter platform for Tim's community-led Seba Beach search.

## Public routes

| Route | Purpose |
|---|---|
| `/` | Documentary case overview, real evidence and current status |
| `/route` | 13 Stops waypoint stories; signed-in hunters receive exact route controls |
| `/interview` | Tim’s Account, organized as the before, along-route, and after-discovery record |
| `/updates` | Official updates and approved community reports |
| `/report` | Private find, tip, and safety reporting |
| `/clue-board` | Moderated community Case Notes; the stable route remains unchanged |
| `/rules` | Versioned search and safety rules |
| `/privacy` | Privacy Policy & Media Notice |
| `/waiver` | Participation Acknowledgement, Waiver and Release |

Member tools live at `/start` and `/dashboard`. Staff tools live at `/ops` and are protected by authenticated company-domain access.

Public sponsorship is withdrawn. The dormant `sponsors.html` source remains in the repository for possible future review, but it is not built or routed publicly and no public submission form is available. Existing sponsor inquiry records remain private in the Ops Sponsors ledger.

The Documentary Case File public-page transition, Submission, Ops and
Publication Refinement, and resilient mobile account onboarding are live in
production on the identifiers recorded in the operations handoff.

The current release distinguishes public Case Notes from private reports, adds
report-time public attribution, gives operators independent private, Case Note
and draft/scheduled Official Update outcomes, supports direct Update media,
and uses one scoped approved-media viewer across Updates, Case Notes, Ops and
the 13 Stops route. Mobile signup and password flows return to explicit,
restartable recovery states when the identity provider does not answer.

## Design source

[`DESIGN.md`](DESIGN.md) records the approved Documentary Case File direction, shared typography and media rules, and the legal, authentication, route and reporting invariants that future public campaign work must preserve.

## Development

```powershell
npm install
npm run legal:verify
npm run typecheck
npm test
npm run build
```

Generated output, local identity configuration, and local provider credentials are ignored. `.env.example` documents variable names only and must never contain values.

## Identity and human verification

Hunter and staff authentication use separate Clerk-compatible configuration contracts. The production environment requires live provider credentials; validation uses disposable development instances. Cloudflare Turnstile protects public write surfaces.

Required identity and verification variables include:

- `HUNTER_CLERK_PUBLISHABLE_KEY`
- `HUNTER_CLERK_SECRET_KEY`
- `HUNTER_AUTH_ISSUER`
- `HUNTER_AUTH_JWKS_URL`
- `STAFF_CLERK_PUBLISHABLE_KEY`
- `STAFF_CLERK_SECRET_KEY`
- `STAFF_AUTH_ISSUER`
- `STAFF_AUTH_JWKS_URL`
- `CLERK_WEBHOOK_SIGNING_SECRET`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

## Transactional email

Microsoft Graph is active only when `TRANSACTIONAL_EMAIL_PROVIDER=microsoft_graph`.
The configured validation mailbox and campaign Reply-To are supplied through Cloudflare Pages Preview secrets, never committed values.

The Graph contract uses:

- `TRANSACTIONAL_EMAIL_PROVIDER`
- `GRAPH_CLIENT_ID`
- `GRAPH_TENANT_ID`
- `GRAPH_REFRESH_TOKEN_BOOTSTRAP`
- `GRAPH_TOKEN_ENCRYPTION_KEY`
- `GRAPH_TOKEN_KEY_VERSION`
- `TRANSACTIONAL_EMAIL_FROM_ADDRESS`
- `TRANSACTIONAL_EMAIL_FROM_NAME`
- `TRANSACTIONAL_EMAIL_REPLY_TO`

Use `scripts/graph-device-login.mjs` only for controlled delegated setup. Refresh-token changes are encrypted rotations; revoked or expired grants require a fresh delegated authorization.

## Deployment

Cloudflare Pages serves `www.timlostsomething.com`; the bare hostname redirects to the canonical `www` host while preserving paths and query strings. `wrangler.toml` separates production from disposable Preview bindings, and `wrangler.media.toml` defines the private media processor.

Deployment requires a clean build, a production D1 checkpoint, applied migrations, a verified `production` environment sentinel, production-only provider secrets, and post-deploy checks on both hostnames.

## Validation production snapshot

Validation Ops includes an explicitly read-only, full-fidelity production snapshot for internal testing. The public validation site remains link-accessible, but snapshot routes repeat the existing server-side Staff authorization check and return `private, no-store`. They never fall back to the disposable validation database.

The dedicated Preview-only resources are:

- D1 binding `PRODUCTION_SNAPSHOT_DB`: `tim-lost-hunter-platform-production-snapshot` (`1281cd83-6eb1-4fd9-8061-8f6ba81b11c1`)
- R2 binding `PRODUCTION_SNAPSHOT_MEDIA`: `tim-lost-private-media-production-snapshot`

Neither binding exists in the production configuration. The ordinary Preview `DB`, `UPLOADS`, and `MEDIA_QUEUE` bindings remain disposable validation resources. The snapshot bucket has no public development URL.

### Manual refresh

The snapshot refresh is a guarded one-way operation:

```powershell
npm run snapshot:refresh
```

Optional exact resource-name overrides live only in gitignored `.env.local` under the `SNAPSHOT_*` names documented by `.env.example`. The command:

1. resolves and compares immutable D1 identifiers;
2. requires the source `environment_metadata` sentinel to identify `production`;
3. requires the destination `snapshot_refresh_metadata` sentinel to identify `production-snapshot`;
4. exports only the reviewed application-table allowlist, excluding provider tokens, delivery leases, alerts, rate limits, idempotency keys and webhook events;
5. copies private media under a new `snapshots/<snapshot-id>/` prefix and verifies each copy by SHA-256;
6. imports the replacement SQL only after every object verifies; and
7. writes a redacted count-only report under gitignored `.wrangler/snapshot-reports/`.

Cloudflare D1 file imports are the atomic boundary: a failed import leaves the prior database state available. If an import result is ambiguous, the command keeps the newly copied objects so it cannot break a snapshot that may have committed. The prior verified, version-prefixed R2 objects are retained for rollback.

The destination schema is the current application schema plus `scripts/production-snapshot-schema.sql`. New application migrations must be applied to this dedicated D1 resource before the next refresh. Snapshot refreshes are manual; a stale or unverified sentinel fails closed in the API and Ops UI.
