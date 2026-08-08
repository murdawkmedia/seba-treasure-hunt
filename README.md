# Tim Lost Something?

The public website and hunter platform for Tim's community-led Seba Beach search.

## Public routes

| Route | Purpose |
|---|---|
| `/` | Full investigation board, real evidence and current item status |
| `/route` | Where to Look: 13 public place stories; signed-in hunters receive exact directions and a private checklist |
| `/golf-balls` | Casey's separate search for marked In the Woods golf balls and current festival-ticket redemption details |
| `/clues` | Public released riddles, signed-in decoder access and one optional next-clue early-access offer |
| `/interview` | Tim's Story, preserving the 19-entry account recorded before the ID was found |
| `/updates` | Latest News and approved public reports |
| `/report` | I Found Something: guest-friendly private find, observation and safety intake |
| `/clue-board` | What People Found: moderated public observations; the stable route remains unchanged |
| `/rules` | Rules & Safety, with versioned search rules |
| `/privacy` | Privacy Policy & Media Notice |
| `/waiver` | Participation Acknowledgement, Waiver and Release |

Member tools live at `/start` and `/dashboard`. Staff tools live at `/ops` and are protected by authenticated company-domain access.

## Clues and optional early access

The clue case file contains 30 sequential records. Clue 01 is a complete public
sample with its riddle and decoder. Marketing releases Clues 02–30 manually and
in order, with no public cadence or automatic scheduler. Once released, a
clue's title and riddle are public; any active signed-in hunter receives its
decoder without paying. Unreleased records remain `Clue ## — Sealed`, and their
titles, riddles, decoders and private editorial notes stay server-side.

A signed-in hunter may optionally pay exactly $5 CAD for advance access to the
one next Ready clue—never a later clue or a bundle. The hunter receives one
reusable reference, confirms the sender name after sending an Interac
e-Transfer, and sees **Waiting for verification** until Tim has confirmed the
transfer cleared and an authorized staff user records the audited decision.
Validation creates disposable test orders and never presents a real payment
address. Approval unlocks the upcoming riddle and decoder before email is
attempted, so a mail failure can never relock access.

Marketing uses the private **Clues & Early Access** workspace. Releasing a clue
is blocked while a claimed payment awaits review; unclaimed carts are cancelled
at release. Retraction returns a clue to Draft. There is no banking integration,
automatic Latest News/social post, automatic decoder-mode change, or upfront
purchase of all remaining clues. The reviewed 30-clue source stays in the
gitignored `.private/` controller folder; the public build and tracked-source
leak scan must pass before any import.

Digging remains prohibited by default. A clue can permit controlled shallow
hand digging only inside one open, published and explicitly named loose-sand
area. Exact instructions require a signed-in hunter with the current waiver;
the maximum is 300 mm (12 inches), a smaller clue limit wins, and only hands, a
hand trowel or a short child beach shovel may be authorized. Closures and staff
instructions always override a permit.

Public sponsorship is withdrawn. The dormant `sponsors.html` source remains in the repository for possible future review, but it is not built or routed publicly and no public submission form is available. Existing sponsor inquiry records remain private in the Ops Sponsors ledger.

The current production release advances the public experience to the approved B2
Full Investigation Board while retaining the production authentication,
legal, reporting, moderation, media and rollback contracts.

The interface distinguishes What People Found from private reports, gives
staff independent private, public-observation and draft/scheduled Latest News
outcomes, supports direct news media, and uses one scoped approved-media viewer
across public feeds, Ops and the 13-place route. Mobile signup and password
flows return to explicit, restartable recovery states when the identity
provider does not answer.

Tim's ID and Apple Watch are found. The original roughly $5,000 cash loss
remains the starting point of the case; the current estimate is approaching
$10,000 without being a guarantee. The rings, camera, purse and qualifying golf
balls begin as Out there. Casey's public Cock on the Walk item asks hunters
to return the loose chicken to the front chickens for the stated reward rather
than keep it. All live statuses are maintained by staff through the audited
What's Out There board. Signed-in hunters also receive the governed Fresh Drops
collection, including the public chicken record and the approved hunter-only
Gucci belt record; signed-out visitors cannot fetch private item details or
images.

## Guided private-report workflow

The Private Reports workflow is active in production.
It keeps the private review state separate from every public outcome and uses
this audited state graph:

```text
Received -> Reviewing -> Contacted -> Verified -> Resolved
              |             |            |
              +-------------+------------+-> Rejected
Rejected or Resolved -> Reviewing (explicit reopen)
```

An operator chooses a destination, reviews its explanation, and applies it as
a separate action. Moving backward, rejecting, resolving, or reopening
requires a private reason and confirmation where the transition is
consequential. Unassigning keeps the current review state. Every accepted
change is recorded in the report history; a stale second tab fails closed and
offers Refresh. Review-state changes never publish, withdraw, or republish a
Case Note or Official Update.

Hunters see only **Received**, **Under review**, **Verified**, or **Closed**.
Any edited public use is shown separately as **Published in Case Notes** or
**Used in an Official Update**. Production verification and rollback evidence
are recorded in
[`docs/operations/2026-07-16-production-release.md`](docs/operations/2026-07-16-production-release.md).

## Design source

[`DESIGN.md`](DESIGN.md) records the approved B2 Full Investigation Board direction, shared typography and media rules, and the legal, authentication, route and reporting invariants that future public work must preserve.

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

## Service API and machine access

The versioned `/api/v1` service boundary supports durable, environment-bound,
scoped API keys for server integrations and the dedicated local MCP adapter.
The SebaHub Console uses a read-only key and fetches live production data
through its server-side Pages Function; the key never enters its browser
bundle and Console does not copy Treasure Hunt records into Convex.

Machine mutations require an explicit write scope, `X-Tim-Confirm: true`, and
a durable `Idempotency-Key`. Service clients can never administer keys, staff
access, account security, or legal acceptance. Plaintext keys are shown only
once when created or rotated; only their HMAC hashes and identifying prefixes
are stored.

See [`docs/SERVICE_API_RUNBOOK.md`](docs/SERVICE_API_RUNBOOK.md) and
[`docs/openapi/tim-lost-service-v1.yaml`](docs/openapi/tim-lost-service-v1.yaml).

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
