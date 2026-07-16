# Tim Lost Something?

The public website and hunter platform for the Seba Beach treasure hunt.

## Public routes

| Route | Purpose |
|---|---|
| `/` | Campaign story and current case status |
| `/route` | Lucky 13 waypoint stories; signed-in hunters receive exact route controls |
| `/interview` | Tim’s Account, organized as the before, along-route, and after-discovery record |
| `/updates` | Official updates and approved community reports |
| `/report` | Private find, tip, and safety reporting |
| `/clue-board` | Moderated community Field Notes |
| `/rules` | Versioned hunt rules |
| `/privacy` | Privacy Policy & Media Notice |
| `/waiver` | Participation Acknowledgement, Waiver and Release |
| `/sponsors` | Sponsor information and private sponsorship inquiry form |

Member tools live at `/start` and `/dashboard`. Staff tools live at `/ops` and are protected by authenticated company-domain access.

Sponsor inquiries submitted through `/sponsors` are stored in private D1 records with an append-only event ledger. Staff review them in the Ops Sponsors ledger; there is no automated email for sponsor inquiries.

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
