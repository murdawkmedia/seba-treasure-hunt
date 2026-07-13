# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-13

## Current state

The hunter-account, privacy/media, pending-waiver and Sunny Pirate Mystery Chest favicon implementation is deployed to the noindex validation branch from `codex/tim-lost-hunter-platform`.

The dedicated sponsor-page and persistent-navigation design is owner-approved and recorded in `docs/superpowers/specs/2026-07-13-sponsor-page-and-persistent-navigation-design.md`. Its reviewed implementation plan is recorded in `docs/superpowers/plans/2026-07-13-sponsor-page-and-persistent-navigation.md` and is ready for an execution-mode decision. The approved direction uses a two-row persistent desktop header, a highlighted sitewide Sponsors destination, a qualified public inquiry form, a private Ops Sponsors workflow and validation-only disposable inquiry data.

Validation branch alias:

<https://codex-validation.seba-treasure-hunt.pages.dev/>

Unique July 13 deployment:

<https://00b10632.seba-treasure-hunt.pages.dev/>

Deployed: 2026-07-13. The feature branch is pushed to GitHub. Validation-only D1 and media-worker changes were made; no production alias, custom-domain, DNS, production migration or production secret was changed.

The canonical production site remains on its previous working release. This is deliberate: the new report, community and account flows fail closed until Clerk and Turnstile are activated, so the preview must not replace production yet.

The deployed validation release contains a D1 environment sentinel, fail-closed write guard, preview-only binding overrides, provider-key protections and a persistent disposable-data notice.

## Implemented

- Rebranded annual campaign hierarchy: **Tim Lost Something?** / **This year: Tim lost his ID.**
- Live OPEN/PAUSED/FOUND status with absolute and relative update time, hunt hours and optional next-clue state.
- Above-fold Start, Report, Updates and Rules actions.
- Permanent `/start` route and reproducible QR asset.
- Public 12-waypoint overview with EXIF/GPS-free photos; exact navigation is authenticated and safety-gated.
- Hunter email/password accounts with verified-email lifecycle intake, 12-character minimum passwords, provider-managed compromised-password checks, sessions and emailed recovery.
- D1 player lifecycle ledger, separate communication permissions and append-only privacy/media legal-acceptance events; passwords and reset codes remain provider-only.
- Required Privacy Policy & Media Notice version `2026.1`; its stored SHA-256 matches the published policy while excluding decorative favicon and manifest links so non-legal head changes do not trigger reacceptance.
- Separate disabled participation-waiver placeholder. Account creation is allowed, while exact directions, progress and community participation remain locked until approved waiver language is supplied and accepted.
- Staff may send provider-managed player recovery instructions or revoke player sessions; they cannot view or choose player passwords.
- Account-optional private reporting with required photo for find claims, optional geolocation and idempotency.
- Moderated virtual clue board with premoderated notes/images, constrained replies, flags, Turnstile actions and rate limits.
- Invitation-only staff case room for status, updates, reports, moderation, zones, rules, players, access and audit. The private Players ledger shows account/profile stage, legal versions and separate email permissions.
- Provider-managed staff recovery, session revocation, suspension/reactivation and optional MFA reset; no peer password visibility or password setting.
- Versioned rules, public zone labels, Privacy Policy & Media Notice and community guidelines.
- SEO/AEO metadata, JSON-LD, sitemap, robots policy, canonical host behavior and SebaStays guarantee links.
- Fictional ID artwork disclosed as a campaign prop.
- Route-video end card updated to `www.timlostsomething.com`; unconfirmed radio copy removed; output is 22,467,397 bytes and 81.222 seconds.
- Sitewide Sunny Pirate Mystery Chest favicon with canonical SVG, 32/180/192/512-pixel PNGs, multi-resolution ICO and minimal browser manifest.
- Edge security policy: CSP, anti-framing, MIME protection, HSTS, referrer policy and limited browser permissions.

## Cloudflare state

- Validation-only D1, private R2, KV, processing queue and dead-letter queue are provisioned with explicit `-validation` names. Pages preview configuration overrides every stateful production binding together.
- Validation D1 migrations 0001 through 0004 are applied and its sentinel is `validation`.
- Validation seed verification: OPEN; 12 published waypoints; one published rules version; two published zones; three feature flags; zero player accounts, hunter profiles, reports, Field Notes and staff principals.
- The validation media processor verifies the D1 sentinel before touching R2, resolves only validation D1/R2/queue resources and is deployed as the consumer of `tim-lost-media-processing-validation`.
- Production D1 migrations 0001 and 0002 are applied and the idempotent campaign seed is loaded. Migration 0003 was validated against local D1 only and is not applied remotely.
- Seed verification: OPEN; 09:00–20:00 America/Edmonton; 12 published waypoints; one published rules version; two published zones; three explicit community feature flags; zero staff principals.
- The current noindex preview and private validation media consumer are deployed successfully. The July 13 Pages preview is deployment `00b10632`; production remains on its previous release.

## Verification evidence

- Automated tests: 128/128 passing.
- TypeScript checks: Worker, client and both test environments passing.
- Production Pages and media bundles build successfully.
- Favicon contract: canonical semantic parts, 32/180/192/512-pixel PNG dimensions, 16/32/48-pixel ICO directory, all twelve page references and build output pass; 512- and 32-pixel renders were visually inspected.
- Live validation smoke test: home, Privacy, ICO, SVG, 32-pixel PNG, Apple touch icon and manifest return HTTP 200 with `X-Robots-Tag: noindex`; the deployed SVG byte hash matches the local source and the old money-bag data favicon is absent.
- Local Pages runtime: home, start, dashboard, clue board, Ops and status API all return 200 with clean routes.
- Rendered desktop and 390 px mobile QA for Privacy, Dashboard and Ops: no horizontal overflow and no WCAG 2.1 A/AA axe violations.
- Public edge preview: D1 status, updates, rules, two zones and 12 waypoints return successfully.
- Both the stable alias and immutable deployment show the disposable-data notice and `X-Robots-Tag: noindex, nofollow`; production shows neither.
- Preview public waypoint payload contains no exact URLs, map URLs, coordinates or private member content.
- Validation write routes fail closed because preview abuse-protection and identity secrets are not configured; the validation database remains at zero personal and staff records.
- Source and built-output privacy scan: no private staff allowlist, exact coordinates, local paths, credentials, deferred claims or ignored planning/source files.
- All 76 source and 76 built raster images contain no EXIF, XMP, IPTC, ICC or GPS markers.
- Route video is below Cloudflare Pages' 25 MiB per-file limit and its final frame is visually verified.
- `npm audit --omit=dev --audit-level=high`: no high or critical findings. Twelve moderate findings are in Clerk's optional Solana dependency chain; the available automated fix is a breaking Clerk downgrade and was not applied.

## Launch blockers

1. Refresh the active Cloudflare authorization so it includes Turnstile/challenge-widget write access, then create a managed widget restricted to `codex-validation.seba-treasure-hunt.pages.dev`.
2. Configure validation-only `RATE_LIMIT_SALT`, Turnstile site/secret values and identity secrets in the Pages preview environment. The existing production salt remains unchanged.
3. Configure the public Clerk application for verified email/password accounts, 12-character passwords, compromised-password checks and emailed recovery.
4. Configure its signed lifecycle webhook and store `HUNTER_CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` as preview secrets.
5. Apply migrations 0003 and 0004 to the production campaign D1 only with explicit deployment approval. Both are already applied to isolated validation D1.
6. Configure the separate invitation-only staff Clerk application and staff password/recovery/MFA policy.
7. Store identity, Turnstile and recovery-mail values as deployment secrets; never commit them.
8. Invite approved operators and privately seed their verified identity subjects.
9. Obtain the authoritative participation waiver, preserve it unchanged, render and hash it, then enable its separate acceptance flow.
10. Run preview end-to-end tests for signup, verification, password login, recovery, session revocation, legal acceptance, private uploads, moderation and FOUND confirmation.
11. Promote `dist/` to production and verify both custom hostnames only after step 10 passes.

## Operational notes

- Scheduled update records do not auto-promote. Publish them manually at the approved time, or add and test a cron promotion job before relying on scheduling.
- Future physical activations and campaign chapters remain outside this release.
- Private launch, identity and incident instructions are maintained outside the public repository.
