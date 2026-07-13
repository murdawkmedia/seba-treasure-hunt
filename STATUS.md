# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-13

## Current state

The hunter-account, privacy/media, pending-waiver and Sunny Pirate Mystery Chest favicon implementation is deployed to the noindex validation branch from `codex/tim-lost-hunter-platform`.

Validation branch alias:

<https://codex-validation.seba-treasure-hunt.pages.dev/>

Unique July 13 deployment:

<https://b9a4d4b7.seba-treasure-hunt.pages.dev/>

Deployed: 2026-07-13 11:46:57 -06:00. The feature branch is pushed to GitHub. No remote D1 migration, production alias, custom-domain, DNS, secret or media-Worker change was made.

The canonical production site remains on its previous working release. This is deliberate: the new report, community and account flows fail closed until Clerk and Turnstile are activated, so the preview must not replace production yet.

The integration branch now also contains a D1 environment sentinel, fail-closed write guard, preview-only binding overrides and a persistent disposable-data notice. These newest changes are locally verified but are not yet included in the July 13 validation deployment listed above.

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
- The validation media processor verifies the D1 sentinel before touching R2 and its configuration resolves only validation D1/R2/queue resources in a Wrangler dry run. The updated validation consumer has not yet been deployed.
- Production D1 migrations 0001 and 0002 are applied and the idempotent campaign seed is loaded. Migration 0003 was validated against local D1 only and is not applied remotely.
- Seed verification: OPEN; 09:00–20:00 America/Edmonton; 12 published waypoints; one published rules version; two published zones; three explicit community feature flags; zero staff principals.
- The current noindex preview and private media consumer are deployed successfully. The July 13 Pages preview is deployment `b9a4d4b7`; production remains on its previous release.

## Verification evidence

- Automated tests: 128/128 passing.
- TypeScript checks: Worker, client and both test environments passing.
- Production Pages and media bundles build successfully.
- Favicon contract: canonical semantic parts, 32/180/192/512-pixel PNG dimensions, 16/32/48-pixel ICO directory, all twelve page references and build output pass; 512- and 32-pixel renders were visually inspected.
- Live validation smoke test: home, Privacy, ICO, SVG, 32-pixel PNG, Apple touch icon and manifest return HTTP 200 with `X-Robots-Tag: noindex`; the deployed SVG byte hash matches the local source and the old money-bag data favicon is absent.
- Local Pages runtime: home, start, dashboard, clue board, Ops and status API all return 200 with clean routes.
- Rendered desktop and 390 px mobile QA for Privacy, Dashboard and Ops: no horizontal overflow and no WCAG 2.1 A/AA axe violations.
- Public edge preview: D1 status, updates, rules, two zones and 12 waypoints return successfully.
- Preview public waypoint payload contains no exact URLs, map URLs, coordinates or private member content.
- Source and built-output privacy scan: no private staff allowlist, exact coordinates, local paths, credentials, deferred claims or ignored planning/source files.
- All 76 source and 76 built raster images contain no EXIF, XMP, IPTC, ICC or GPS markers.
- Route video is below Cloudflare Pages' 25 MiB per-file limit and its final frame is visually verified.
- `npm audit --omit=dev --audit-level=high`: no high or critical findings. Twelve moderate findings are in Clerk's optional Solana dependency chain; the available automated fix is a breaking Clerk downgrade and was not applied.

## Launch blockers

1. Configure the public Clerk application for verified email/password accounts, 12-character passwords, compromised-password checks and emailed recovery.
2. Configure its signed lifecycle webhook and store `HUNTER_CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` as deployment secrets.
3. Apply migrations 0003 and 0004 to the production campaign D1 only with explicit deployment approval. Both are already applied to isolated validation D1.
4. Configure the separate invitation-only staff Clerk application and staff password/recovery/MFA policy.
5. Create a managed Turnstile widget restricted to the canonical and Pages hostnames.
6. Store identity, Turnstile and recovery-mail values as deployment secrets; never commit them.
7. Invite approved operators and privately seed their verified identity subjects.
8. Obtain the authoritative participation waiver, preserve it unchanged, render and hash it, then enable its separate acceptance flow.
9. Run preview end-to-end tests for signup, verification, password login, recovery, session revocation, legal acceptance, private uploads, moderation and FOUND confirmation.
10. Promote `dist/` to production and verify both custom hostnames only after step 9 passes.

## Operational notes

- Scheduled update records do not auto-promote. Publish them manually at the approved time, or add and test a cron promotion job before relying on scheduling.
- Future physical activations and campaign chapters remain outside this release.
- Private launch, identity and incident instructions are maintained outside the public repository.
