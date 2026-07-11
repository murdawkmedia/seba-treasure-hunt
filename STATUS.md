# STATUS — Tim Lost Something? Hunter Platform

Last updated: 2026-07-11

## Current state

The hunter-platform implementation is complete on branch `codex/tim-lost-hunter-platform` and deployed to a noindex Cloudflare Pages preview:

<https://codex-validation.seba-treasure-hunt.pages.dev/>

The canonical production site remains on its previous working release. This is deliberate: the new report, community and account flows fail closed until Clerk and Turnstile are activated, so the preview must not replace production yet.

## Implemented

- Rebranded annual campaign hierarchy: **Tim Lost Something?** / **This year: Tim lost his ID.**
- Live OPEN/PAUSED/FOUND status with absolute and relative update time, hunt hours and optional next-clue state.
- Above-fold Start, Report, Updates and Rules actions.
- Permanent `/start` route and reproducible QR asset.
- Public 12-waypoint overview with EXIF/GPS-free photos; exact navigation is authenticated and safety-gated.
- Hunter profile, dashboard and progress model using passwordless/social identity.
- Account-optional private reporting with required photo for find claims, optional geolocation and idempotency.
- Moderated virtual clue board with premoderated notes/images, constrained replies, flags, Turnstile actions and rate limits.
- Invitation-only staff case room for status, updates, reports, moderation, zones, rules, subscribers, access and audit.
- Provider-managed staff recovery, session revocation, suspension/reactivation and optional MFA reset; no peer password visibility or password setting.
- Versioned rules, public zone labels, privacy notice and community guidelines.
- SEO/AEO metadata, JSON-LD, sitemap, robots policy, canonical host behavior and SebaStays guarantee links.
- Fictional ID artwork disclosed as a campaign prop.
- Route-video end card updated to `www.timlostsomething.com`; unconfirmed radio copy removed; output is 22,467,397 bytes and 81.222 seconds.
- Edge security policy: CSP, anti-framing, MIME protection, HSTS, referrer policy and limited browser permissions.

## Cloudflare state

- The isolated D1, private R2, KV, queue, dead-letter queue and media consumer are provisioned.
- Production D1 migrations 0001 and 0002 are applied and the idempotent campaign seed is loaded.
- Seed verification: OPEN; 09:00–20:00 America/Edmonton; 12 published waypoints; one published rules version; two published zones; three explicit community feature flags; zero staff principals.
- The current noindex preview and private media consumer are deployed successfully.

## Verification evidence

- Automated tests: 92/92 passing.
- TypeScript checks: Worker, client and both test environments passing.
- Production Pages and media bundles build successfully.
- Local Pages runtime: home, start, dashboard, clue board, Ops and status API all return 200 with clean routes.
- Rendered desktop and 360 px mobile QA: no horizontal overflow, no WCAG 2.1 A/AA axe violations and no unexpected console errors on public surfaces.
- Public edge preview: D1 status, updates, rules, two zones and 12 waypoints return successfully.
- Preview public waypoint payload contains no exact URLs, map URLs, coordinates or private member content.
- Source and built-output privacy scan: no private staff allowlist, exact coordinates, local paths, credentials, deferred claims or ignored planning/source files.
- All 76 source and 76 built raster images contain no EXIF, XMP, IPTC, ICC or GPS markers.
- Route video is below Cloudflare Pages' 25 MiB per-file limit and its final frame is visually verified.
- `npm audit --omit=dev --audit-level=high`: no high or critical findings. Twelve moderate findings are in Clerk's optional Solana dependency chain; the available automated fix is a breaking Clerk downgrade and was not applied.

## Launch blockers

1. Create separate public-hunter and invitation-only staff Clerk applications.
2. Configure the approved public identity methods and staff password/recovery/MFA policy.
3. Create a managed Turnstile widget restricted to the canonical and Pages hostnames.
4. Store identity, Turnstile and recovery-mail values as deployment secrets; never commit them.
5. Invite approved operators and privately seed their verified identity subjects.
6. Run preview end-to-end tests for identity, exact waypoint access, private uploads, moderation, recovery and FOUND confirmation.
7. Promote `dist/` to production and verify both custom hostnames only after step 6 passes.

## Operational notes

- Scheduled update records do not auto-promote. Publish them manually at the approved time, or add and test a cron promotion job before relying on scheduling.
- Future physical activations and campaign chapters remain outside this release.
- Private launch, identity and incident instructions are maintained outside the public repository.
